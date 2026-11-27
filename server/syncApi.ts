import express, { type Express, type Request, type Response } from "express";
import { Pool } from "pg";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9:_-]{1,180}$/.test(v);

const accountKeys = ["id","name","category","phone","currency","note","openingDirection",
  "creditLimit","openingBalance","isCashAccount","codeNumber"] as const;
const editable = new Set<string>(["name","phone","note","creditLimit"]);
function validAccount(p: any): boolean {
  return !!p && typeof p === "object" && !Array.isArray(p) &&
    Object.keys(p).length === accountKeys.length && accountKeys.every(k => Object.hasOwn(p,k)) &&
    validId(p.id) && typeof p.name === "string" && p.name.trim().length > 0 && p.name.length <= 100 &&
    ["purchases","sales","clients","employees","transfers","shop"].includes(p.category) &&
    ["sar","usd","eur","currency2"].includes(p.currency) &&
    ["credit","debit"].includes(p.openingDirection) &&
    typeof p.phone === "string" && p.phone.length <= 32 &&
    typeof p.note === "string" && p.note.length <= 300 &&
    Number.isFinite(p.creditLimit) && p.creditLimit >= 0 && p.creditLimit <= 1000000000000 &&
    Number.isFinite(p.openingBalance) && [0,1].includes(p.isCashAccount) &&
    Number.isSafeInteger(p.codeNumber) && p.codeNumber > 0;
}
function validAccountCommand(t: unknown,p: any): boolean {
  if (t === "account.create") return validAccount(p) && p.openingBalance === 0;
  return t === "account.update" && p && Object.keys(p).length === 3 &&
    validAccount(p.before) && validAccount(p.after) && p.id === p.before.id &&
    p.after.id === p.id && accountKeys.every(k => editable.has(k) || p.before[k] === p.after[k]);
}

export function mountSyncApi(app: Express) {
  const router = express.Router();
  app.use("/api/sync", router);
  if (process.env.NASQO_SYNC_ENABLED !== "1") {
    router.use((_req, res) => { res.status(503).json({error:"SYNC_DISABLED"}); });
    return;
  }
  const projectId = process.env.NASQO_FIREBASE_PROJECT_ID;
  if (!projectId || !process.env.SQL_HOST || !process.env.SQL_USER ||
      !process.env.SQL_DB_NAME || !process.env.SQL_PASSWORD) {
    throw new Error("Missing sync configuration");
  }
  const firebase = getApps().find(a => a.name === "nasqo-sync") ??
    initializeApp({projectId}, "nasqo-sync");
  const pool = new Pool({host:process.env.SQL_HOST,user:process.env.SQL_USER,
    database:process.env.SQL_DB_NAME,password:process.env.SQL_PASSWORD,
    max:5,connectionTimeoutMillis:10000});
  router.use(express.json({limit:"64kb"}));
  router.use(async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) { res.sendStatus(401); return; }
    try {
      const user = await getAuth(firebase).verifyIdToken(token, true);
      if (!user.email_verified) { res.sendStatus(403); return; }
      res.locals.uid = user.uid;
      next();
    } catch { res.sendStatus(401); }
  });
  router.post("/push", async (req:Request,res:Response) => {
    const {workspace_id:w,operation_id:id,operation_type:t,payload:p} = req.body ?? {};
    if (!validId(w) || !validId(id) || !validAccountCommand(t,p)) {
      res.status(400).json({error:"UNSUPPORTED_OR_INVALID_OPERATION"}); return;
    }
    const client = await pool.connect().catch(() => null);
    if (!client) { res.sendStatus(503); return; }
    try {
      await client.query("BEGIN");
      const member = await client.query("SELECT can_write FROM nasqo_sync_members WHERE workspace_id=$1 AND firebase_uid=$2 FOR SHARE",[w,res.locals.uid]);
      if (!member.rows[0]?.can_write) { await client.query("ROLLBACK"); res.sendStatus(403); return; }
      await client.query("INSERT INTO nasqo_sync_heads(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",[w]);
      await client.query("SELECT revision FROM nasqo_sync_heads WHERE workspace_id=$1 FOR UPDATE",[w]);
      const prior = await client.query("SELECT revision, operation_type=$3 AND payload=$4::jsonb AS matches FROM nasqo_sync_operations WHERE workspace_id=$1 AND operation_id=$2",[w,id,t,JSON.stringify(p)]);
      if (prior.rowCount) {
        if (!prior.rows[0].matches) { await client.query("ROLLBACK"); res.sendStatus(409); return; }
        await client.query("COMMIT");
        res.json({workspace_id:w,operation_id:id,server_revision:String(prior.rows[0].revision)}); return;
      }
      // The locked workspace head serializes edits. Compare the full previous
      // canonical record rather than using last-write-wins.
      const current = await client.query(
        "SELECT (CASE WHEN operation_type='account.update' THEN payload->'after' ELSE payload END)=$3::jsonb AS matches FROM nasqo_sync_operations WHERE workspace_id=$1 AND operation_type IN ('account.create','account.update') AND payload->>'id'=$2 ORDER BY revision DESC LIMIT 1",
        [w,p.id,JSON.stringify(t === "account.update" ? p.before : p)]);
      if ((t === "account.create" && current.rowCount) ||
          (t === "account.update" && !current.rows[0]?.matches)) {
        await client.query("ROLLBACK"); res.sendStatus(409); return;
      }
      const head = await client.query("UPDATE nasqo_sync_heads SET revision=revision+1 WHERE workspace_id=$1 RETURNING revision",[w]);
      const revision = head.rows[0].revision;
      await client.query("INSERT INTO nasqo_sync_operations(workspace_id,operation_id,revision,operation_type,payload,actor_uid) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[w,id,revision,t,JSON.stringify(p),res.locals.uid]);
      await client.query("COMMIT");
      res.json({workspace_id:w,operation_id:id,server_revision:String(revision)});
    } catch { await client.query("ROLLBACK").catch(()=>{}); res.sendStatus(503); }
    finally { client.release(); }
  });
  router.post("/pull", async (req:Request,res:Response) => {
    const {workspace_id:w,cursor} = req.body ?? {};
    const c = cursor ?? "0";
    if (!validId(w) || typeof c !== "string" || !/^\d{1,18}$/.test(c)) { res.sendStatus(400); return; }
    try {
      const result = await pool.query("SELECT o.workspace_id,o.operation_id,o.operation_type,o.payload,o.revision::text AS server_revision FROM nasqo_sync_operations o JOIN nasqo_sync_members m ON m.workspace_id=o.workspace_id AND m.firebase_uid=$2 WHERE o.workspace_id=$1 AND o.revision>$3::bigint ORDER BY o.revision LIMIT 100",[w,res.locals.uid,c]);
      const member = await pool.query("SELECT 1 FROM nasqo_sync_members WHERE workspace_id=$1 AND firebase_uid=$2",[w,res.locals.uid]);
      if (!member.rowCount) { res.sendStatus(403); return; }
      res.json({workspace_id:w,next_cursor:result.rows.at(-1)?.server_revision ?? c,operations:result.rows});
    } catch { res.sendStatus(503); }
  });
}
