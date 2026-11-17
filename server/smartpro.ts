import { createHash } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { Router } from "express";
import { initializeApp, getApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { TABLES, tableName, ident, editable, visible, validateFields, authorize, validId, InputError, type Role, type Column, type TableName } from "./smartproPolicy.ts";

type Actor = { uid: string; email: string; role: Role; bootstrap: boolean };
type DataRow = Record<string, unknown>;
type ActorRequest = Request & { smartproActor?: Actor };
const bootstrapAdmins = new Set((process.env.SMARTPRO_ADMIN_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
const verifiedProject = process.env.SMARTPRO_FIREBASE_PROJECT_ID ?? "";
const databaseName = process.env.SMARTPRO_DB_NAME ?? "smartprodb";
const enabled = () => Boolean(
  process.env.SMARTPRO_DB_HOST &&
  process.env.SMARTPRO_DB_USER &&
  process.env.SMARTPRO_DB_PASSWORD &&
  verifiedProject &&
  bootstrapAdmins.size
);
const writesEnabled = () => process.env.SMARTPRO_WRITE_ENABLED === "1";
let databasePool: Pool | undefined;

function pool(): Pool {
  if (!enabled()) throw new InputError("ربط قاعدة SmartPro غير مُفعّل على الخادم.", 503);
  if (!databasePool) {
    databasePool = mysql.createPool({
      host: process.env.SMARTPRO_DB_HOST!,
      port: Number(process.env.SMARTPRO_DB_PORT || "3306"),
      user: process.env.SMARTPRO_DB_USER!,
      password: process.env.SMARTPRO_DB_PASSWORD!,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 20,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: "utf8mb4",
      multipleStatements: false,
    });
  }
  return databasePool;
}
function publicRow(row: DataRow): DataRow {
  const copy = { ...row };
  delete copy.password;
  return copy;
}
function etag(row: DataRow): string {
  return createHash("sha256").update(JSON.stringify(publicRow(row))).digest("hex");
}
function actor(req: ActorRequest): Actor {
  if (!req.smartproActor) throw new InputError("يتطلب تسجيل الدخول.", 401);
  return req.smartproActor;
}
function requireWrite(role: Role, action: "create" | "update" | "delete" | "roles"): void {
  if (!writesEnabled()) throw new InputError("النسخة المركزية لم تُفعّل للتعديل بعد.", 503);
  authorize(role, action);
}
function asParam(req: Request, key: string): string {
  const raw = req.params[key];
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}
async function columns(table: TableName): Promise<Column[]> {
  const [rows] = await pool().query<RowDataPacket[]>(
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [databaseName, table],
  );
  if (!rows.length) throw new InputError("الجدول غير موجود في قاعدة SmartPro.", 404);
  return rows.map(row => ({
    name: String(row.COLUMN_NAME),
    type: String(row.DATA_TYPE),
    nullable: row.IS_NULLABLE === "YES",
    hasDefault: row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== undefined,
    defaultValue: row.COLUMN_DEFAULT === null || row.COLUMN_DEFAULT === undefined ? null : String(row.COLUMN_DEFAULT),
    autoIncrement: String(row.EXTRA ?? "").includes("auto_increment"),
    maxLength: row.CHARACTER_MAXIMUM_LENGTH === null ? null : Number(row.CHARACTER_MAXIMUM_LENGTH),
  }));
}
async function lockedRow(conn: PoolConnection, table: TableName, id: string): Promise<DataRow | null> {
  const safe = ident(table);
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM " + safe + " WHERE id=? LIMIT 1 FOR UPDATE", [id]);
  return rows.length ? (rows[0] as DataRow) : null;
}
// SmartPro has ON DELETE CASCADE foreign keys. Capture every dependent row
// inside the same transaction before the database deletes it implicitly.
const CASCADE_CHILDREN: Partial<Record<TableName, readonly { table: TableName; foreignKey: string }[]>> = {
  bounds: [{ table: "bill_details", foreignKey: "bill_id" }, { table: "bill_details2", foreignKey: "bill_id" }],
  bin: [{ table: "bin_bill_details", foreignKey: "bill_id" }, { table: "bin_bill_details2", foreignKey: "bill_id" }],
  offers: [{ table: "offer_bill_details", foreignKey: "bill_id" }, { table: "offer_sbill_details", foreignKey: "bill_id" }],
  store_trans: [{ table: "trans_details", foreignKey: "bill_id" }],
  products: [{ table: "bin_bill_details", foreignKey: "prod_id" }],
};
const CASCADE_AUDIT_LIMIT = 2000;

async function audit(
  conn: PoolConnection,
  user: Actor,
  table: string,
  rowId: string,
  action: "insert" | "update" | "delete" | "grant" | "revoke",
  before: DataRow | null,
  after: DataRow | null,
): Promise<void> {
  await conn.execute(
    "INSERT INTO nasqo_audit_log (actor_uid,actor_email,table_name,row_id,action,before_json,after_json) VALUES (?,?,?,?,?,?,?)",
    [user.uid, user.email, table, rowId, action,
      before ? JSON.stringify(publicRow(before)) : null,
      after ? JSON.stringify(publicRow(after)) : null],
  );
}
async function auditDeleteCascade(conn: PoolConnection, user: Actor, table: TableName, id: string): Promise<void> {
  for (const dependency of CASCADE_CHILDREN[table] ?? []) {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM " + ident(dependency.table) + " WHERE " + ident(dependency.foreignKey) +
      "=? ORDER BY id LIMIT ? FOR UPDATE",
      [id, CASCADE_AUDIT_LIMIT + 1],
    );
    if (rows.length > CASCADE_AUDIT_LIMIT) {
      throw new InputError("الحذف يشمل أكثر من 2000 سجل تابع؛ أوقف العملية واطلب مراجعة محاسبية.", 409);
    }
    // Deleting products with archived invoice rows would irreversibly remove
    // historical evidence. Admins can update/deactivate products instead.
    if (table === "products" && rows.length) {
      throw new InputError("هذا الصنف مرتبط بفواتير محذوفة محفوظة؛ ألغِ تنشيطه بدل حذف أرشيفه.", 409);
    }
    for (const row of rows) {
      await audit(conn, user, dependency.table, String(row.id), "delete", row, null);
    }
  }
}
function routeError(res: Response, error: unknown): void {

  if (error instanceof InputError) {
    res.status(error.status).json({ error: error.message }); return;
  }
  if (error && typeof error === "object") {
    const code = String((error as { code?: unknown }).code ?? "");
    if (["ER_ROW_IS_REFERENCED_2","ER_NO_REFERENCED_ROW_2"].includes(code)) {
      res.status(409).json({error:"عملية غير مسموحة لأن السجل مرتبط بسجلات محاسبية أخرى."}); return;
    }
    if (code === "ER_DUP_ENTRY") {
      res.status(409).json({error:"يوجد سجل آخر بالقيمة نفسها."}); return;
    }
    if (["ER_BAD_NULL_ERROR","ER_DATA_TOO_LONG","ER_TRUNCATED_WRONG_VALUE"].includes(code)) {
      res.status(400).json({error:"القيم المرسلة لا توافق بنية قاعدة البيانات."}); return;
    }
  }
  console.error("SmartPro operation failed", error);
  res.status(500).json({ error: "تعذر تنفيذ العملية في قاعدة SmartPro." });
}

async function authorizeActor(req: ActorRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!enabled()) throw new InputError("ربط SmartPro غير متاح بعد.", 503);
    const authHeader = req.get("authorization") ?? "";
    if (!/^Bearer \S+$/.test(authHeader)) throw new InputError("يجب تسجيل الدخول بحساب Google موثّق.",401);
    const verifier = getApps().some(a => a.name === "nasqo-smartpro-auth")
      ? getApp("nasqo-smartpro-auth")
      : initializeApp({ projectId: verifiedProject }, "nasqo-smartpro-auth");
    let decoded;
    try {
      decoded = await getAuth(verifier).verifyIdToken(authHeader.slice(7));
    } catch {
      throw new InputError("انتهت صلاحية تسجيل الدخول أو تعذر التحقق منه. أعد تسجيل الدخول.", 401);
    }
    const email = String(decoded.email ?? "").toLowerCase();
    if (!decoded.email_verified || !email) throw new InputError("يلزم حساب بريد إلكتروني موثّق.",403);
    const bootstrap = bootstrapAdmins.has(email);
    let role: Role | null = bootstrap ? "admin" : null;
    if (!role) {
      const [rows] = await pool().query<RowDataPacket[]>("SELECT role FROM nasqo_access_roles WHERE email=? LIMIT 1", [email]);
      if (rows.length && ["admin","editor","viewer"].includes(String(rows[0].role))) role = String(rows[0].role) as Role;
    }
    if (!role) throw new InputError("هذا الحساب غير مخوّل لدخول قاعدة SmartPro.",403);
    req.smartproActor = { uid:decoded.uid, email, role, bootstrap };
    next();
  } catch (error) {
    routeError(res, error);
  }
}
function asyncRoute(fn:(req:ActorRequest,res:Response)=>Promise<void>) {
  return (req:Request,res:Response) => {
    void fn(req as ActorRequest,res).catch(error => routeError(res,error));
  };
}
function tableFrom(req: Request): TableName { return tableName(asParam(req,"table")); }
function recordIdFrom(req: Request): string { return validId(asParam(req,"id")); }

export function mountSmartProApi(app: Express): void {
  const router = Router();
  router.get("/status", (_req,res) => {
    // No data or account identifiers are exposed to anonymous clients.
    res.json({
      available: enabled(),
      writeEnabled: enabled() && writesEnabled(),
      primary: enabled() && writesEnabled() && process.env.SMARTPRO_PRIMARY_ENABLED === "1",
    });
  });
  router.use((req,res,next) => { void authorizeActor(req as ActorRequest,res,next); });
  router.get("/meta", asyncRoute(async (req,res) => {
    const tableSpecs = await Promise.all(TABLES.map(async name => {
      const cols = await columns(name);
      return { name, columns: visible(cols), editableColumns: editable(name,cols).map(c => c.name) };
    }));
    const user = actor(req);
    res.json({ tables:tableSpecs, role:user.role, writeEnabled:writesEnabled(), email:user.email });
  }));
  router.get("/table/:table", asyncRoute(async (req,res) => {
    authorize(actor(req).role,"read");
    const table = tableFrom(req);
    const allColumns = await columns(table);
    const names = visible(allColumns).map(c=>ident(c.name)).join(",");
    const limit = Math.min(100,Math.max(1,Number(req.query.limit)||40));
    const offset = Math.min(100000,Math.max(0,Number(req.query.offset)||0));
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0,100) : "";
    const searchColumn = allColumns.find(c=>c.name==="name") ?? allColumns.find(c=>c.name==="details");
    const where = term && searchColumn ? " WHERE " + ident(searchColumn.name) + " LIKE ?" : "";
    const params:unknown[] = term && searchColumn ? ["%"+term.replace(/[\\%_]/g,"\\$&")+"%"] : [];
    params.push(limit+1,offset);
    const [rows] = await pool().query<RowDataPacket[]>(
      "SELECT "+names+" FROM "+ident(table)+where+" ORDER BY id DESC LIMIT ? OFFSET ?", params);
    const hasMore=rows.length>limit;
    res.json({ table, rows:rows.slice(0,limit).map(r=>({ data:publicRow(r), etag:etag(r) })), hasMore, offset, limit });
  }));
  router.post("/table/:table", asyncRoute(async (req,res) => {
    const user=actor(req);requireWrite(user.role,"create");
    const table=tableFrom(req);
    if(table==="users")throw new InputError("مستخدمو SmartPro القدامى محفوظون لأغراض التوافق؛ أضف مستخدمي النظام الحديث من إدارة الصلاحيات.",403);
    const cols=await columns(table);
    const values=validateFields(table,cols,req.body?.values);
    const keys=Object.keys(values);
    const args=keys.map(k=>values[k]);
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [result]=await conn.execute<ResultSetHeader>(
        "INSERT INTO "+ident(table)+" ("+keys.map(ident).join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")",args);
      const id=String(result.insertId);
      if(!result.insertId)throw new InputError("لم يُرجع المحرك رقم السجل الجديد.",409);
      const row=await lockedRow(conn,table,id);
      await audit(conn,user,table,id,"insert",null,row);
      await conn.commit();
      res.status(201).json({ data:publicRow(row??{}),etag:etag(row??{}) });
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }));
  router.patch("/table/:table/:id", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"update");
    const table=tableFrom(req),id=recordIdFrom(req),cols=await columns(table);
    if(table==="users")throw new InputError("لا يمكن تعديل حسابات SmartPro القديمة. استخدم إدارة صلاحيات NASQO.",403);
    const values=validateFields(table,cols,req.body?.values);
    if(typeof req.body?.etag!=="string"||!/^[a-f0-9]{64}$/.test(req.body.etag))throw new InputError("المراجعة السابقة للسجل مطلوبة.");
    const conn=await pool().getConnection();
    try {
      await conn.beginTransaction();
      const old=await lockedRow(conn,table,id);
      if(!old)throw new InputError("السجل لم يعد موجودًا.",404);
      if(etag(old)!==req.body.etag)throw new InputError("تم تغيير السجل بواسطة مستخدم آخر؛ أعد تحميله قبل التعديل.",409);
      const keys=Object.keys(values);
      await conn.execute("UPDATE "+ident(table)+" SET "+keys.map(k=>ident(k)+"=?").join(",")+" WHERE id=?",
        [...keys.map(k=>values[k]),id]);
      const next=await lockedRow(conn,table,id);
      await audit(conn,user,table,id,"update",old,next);
      await conn.commit();
      res.json({data:publicRow(next??{}),etag:etag(next??{})});
    } catch(error) { await conn.rollback(); throw error; }
    finally {conn.release();}
  }));
  router.delete("/table/:table/:id", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"delete");
    const table=tableFrom(req),id=recordIdFrom(req);
    if(table==="users")throw new InputError("لا يمكن حذف مستخدمي SmartPro القديمة. استخدم إدارة صلاحيات NASQO.",403);
    if(req.body?.confirmation!==table+":"+id)throw new InputError("تأكيد الحذف غير مطابق.",400);
    if(typeof req.body?.etag!=="string"||!/^[a-f0-9]{64}$/.test(req.body.etag))throw new InputError("المراجعة السابقة للسجل مطلوبة.");
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const old=await lockedRow(conn,table,id);
      if(!old)throw new InputError("السجل لم يعد موجودًا.",404);
      if(etag(old)!==req.body.etag)throw new InputError("السجل تغير قبل الحذف. أعد تحميله.",409);
      await auditDeleteCascade(conn,user,table,id);
      await conn.execute("DELETE FROM "+ident(table)+" WHERE id=?",[id]);
      await audit(conn,user,table,id,"delete",old,null);
      await conn.commit();
      res.json({ deleted:true, id });
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  router.get("/audit", asyncRoute(async(req,res) => {
    authorize(actor(req).role,"roles");
    const [rows]=await pool().query<RowDataPacket[]>(
      "SELECT id,actor_email,table_name,row_id,action,created_at FROM nasqo_audit_log ORDER BY id DESC LIMIT 100");
    res.json({rows});
  }));
  router.get("/roles", asyncRoute(async(req,res) => {
    authorize(actor(req).role,"roles");
    const [rows]=await pool().query<RowDataPacket[]>("SELECT email,role,granted_by,updated_at FROM nasqo_access_roles ORDER BY email LIMIT 100");
    res.json({rows});
  }));
  router.put("/roles/:email", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"roles");
    const email=decodeURIComponent(asParam(req,"email")).trim().toLowerCase();
    if(!/^[^@\s]{1,90}@[^@\s]{1,140}$/.test(email))throw new InputError("البريد الإلكتروني غير صالح");
    const role=req.body?.role as Role;
    if(!["admin","editor","viewer"].includes(role))throw new InputError("صلاحية المستخدم غير صحيحة");
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const [oldRows]=await conn.query<RowDataPacket[]>("SELECT email,role FROM nasqo_access_roles WHERE email=? FOR UPDATE",[email]);
      await conn.execute("INSERT INTO nasqo_access_roles(email,role,granted_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),granted_by=VALUES(granted_by)",[email,role,user.email]);
      await audit(conn,user,"nasqo_access_roles",email,"grant",oldRows[0]??null,{email,role});
      await conn.commit();res.json({email,role});
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  router.delete("/roles/:email", asyncRoute(async(req,res) => {
    const user=actor(req);requireWrite(user.role,"roles");
    const email=decodeURIComponent(asParam(req,"email")).trim().toLowerCase();
    if(bootstrapAdmins.has(email))throw new InputError("صلاحية المدير الأساسي محمية.",403);
    const conn=await pool().getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.query<RowDataPacket[]>("SELECT email,role FROM nasqo_access_roles WHERE email=? FOR UPDATE",[email]);
      if(!rows.length)throw new InputError("المستخدم غير موجود.",404);
      await conn.execute("DELETE FROM nasqo_access_roles WHERE email=?",[email]);
      await audit(conn,user,"nasqo_access_roles",email,"revoke",rows[0],null);
      await conn.commit();res.json({deleted:true});
    }catch(error){await conn.rollback();throw error;}
    finally{conn.release();}
  }));
  app.use("/api/smartpro",router);
}
