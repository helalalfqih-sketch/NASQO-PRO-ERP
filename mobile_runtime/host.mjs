// Transport-only host for the original web SQLite API. No domain rules here.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { DatabaseSync, backup } from "node:sqlite";
import { mountSqliteApi } from "../server/sqliteApi.ts";
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, DEFAULT_WORKSPACE_ID } from "../server/sqliteDb.ts";

const cookieName = "nasqo_mobile_session";
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbidden = /\.(?:back|db|sqlite|sqlite3|dump|sql)(?:\.gz)?$/i;
const originHost = "127.0.0.1";
function equal(a,b){
  const left=Buffer.from(String(a??"")),right=Buffer.from(b);
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function privateDirectory(dir){
  if(typeof dir!=="string"||!path.isAbsolute(dir))throw new Error("A private absolute data directory is required");
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const actual=fs.realpathSync(dir);
  if(actual!==path.resolve(dir)||!fs.statSync(actual).isDirectory())throw new Error("Invalid private data directory");
  if(process.platform!=="win32")fs.chmodSync(actual,0o700);
  return actual;
}
function assertSqliteRuntime(){
  if(Number(process.versions.node.split(".")[0])!==24||typeof backup!=="function")throw new Error("Full Node 24 runtime with node:sqlite required");
  const probe=new DatabaseSync(":memory:");
  try{
    if(typeof probe.isTransaction!=="boolean")throw new Error("Nested transaction support required");
    probe.exec("BEGIN");
    if(!probe.isTransaction)throw new Error("SQLite transaction probe failed");
    probe.exec("ROLLBACK");
  }finally{probe.close();}
}
function validSession(req,token){
  return String(req.headers.cookie??"").split(";").map(v=>v.trim()).some(v=>v.startsWith(cookieName+"=")&&equal(v.slice(cookieName.length+1),token));
}
export async function startLocalWeb({dataDir, webDir=path.join(base,"dist","client"),port=39861,token=crypto.randomBytes(32).toString("hex"),serveUi=true}={}){
  assertSqliteRuntime();
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))throw new Error("Invalid runtime session");
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error("Invalid port");
  const dir=privateDirectory(dataDir);
  const dbPath=path.join(dir,"nasqo.sqlite");
  for(const suffix of ["","-wal","-shm","-journal"]){
    const p=dbPath+suffix;
    if(fs.existsSync(p)&&!fs.lstatSync(p).isFile())throw new Error("Unsafe database path");
  }
  const staticDir=path.resolve(webDir);
  if(serveUi&&(!fs.existsSync(path.join(staticDir,"index.html"))||staticDir===dir||dir.startsWith(staticDir+path.sep)||staticDir.startsWith(dir+path.sep)))
    throw new Error("UI and database must be in separate directories");
  // This is an app-private, capability-authenticated host, not a public deployment.
  // No server fallback to Cloud Run storage and no automatic legacy bootstrapping.
  process.env.NODE_ENV="development";
  delete process.env.K_SERVICE;
  delete process.env.NASQO_SQLITE_ADMIN_PASSWORD;
  delete process.env.NASQO_SQLITE_SESSION_SECRET;
  delete process.env.NASQO_SQLITE_PUBLIC_ORIGIN;
  process.env.NASQO_SQLITE_PATH=dbPath;
  process.env.NASQO_AUTO_BOOTSTRAP_SQL="0";
  process.env.NASQO_SKIP_AUTO_SQL_IMPORT="1";
  process.env.TMPDIR=privateDirectory(path.join(dir,"tmp"));
  const db=getSqliteDb();
  try {
    const integrity=db.prepare("PRAGMA quick_check").get();
    if(Object.values(integrity)[0]!=="ok")throw new Error("Existing SQLite database failed integrity check");
    ensureEmptyWorkspace(db,DEFAULT_WORKSPACE_ID);
  } catch(e){closeSqliteDb();throw e;}

  const app=express();
  app.disable("x-powered-by");
  let actualPort=port;
  const origin=()=> "http://"+originHost+":"+actualPort;
  app.use((req,res,next)=>{
    // Host check is mandatory even for loopback: no DNS rebinding.
    if(req.socket.remoteAddress!==originHost||req.headers.host!==originHost+":"+actualPort){
      res.status(403).end();return;
    }
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    const supplied=req.headers.origin;
    if((supplied&&supplied!==origin())||
       (req.headers["sec-fetch-site"]&& !["same-origin","none"].includes(req.headers["sec-fetch-site"]))){
      res.status(403).end();return;
    }
    if(!validSession(req,token)){
      res.status(401).json({error:"Local application session required"});return;
    }
    // The web client's fetch automatically supplies Origin for browser writes.
    // Allow authenticated app-local requests without Origin only with the
    // original SQLite CSRF header, which remains checked by sqliteAccess.ts.
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.get("/api/health",(_req,res)=>res.json({ok:true,service:"nasqo-original-web-local",engine:"node:sqlite"}));
  // Central SmartPro and AI network services are not part of the offline host.
  // The original UI selects its SQLite mode from this normal status endpoint.
  app.get("/api/smartpro/status",(_req,res)=>res.json({primary:false,configured:false,connected:false}));
  mountSqliteApi(app);
  app.use("/api",(_req,res)=>res.status(503).json({error:"الخدمة الخارجية غير متاحة في وضع العمل المحلي."}));
  if(serveUi){
    app.use((req,res,next)=>{
      let p;try{p=decodeURIComponent(req.path);}catch{res.status(400).end();return;}
      if(forbidden.test(p)||p.split("/").some(s=>s.startsWith("."))){res.status(404).end();return;}
      next();
    });
    app.use(express.static(staticDir,{dotfiles:"deny",index:"index.html",redirect:false,fallthrough:false}));
  }
  app.use((_req,res)=>res.status(404).end());
  app.use((_err,_req,res,_next)=>res.status(500).json({error:"تعذر إكمال الطلب المحلي."}));
  let server;
  try{
    server=await new Promise((resolve,reject)=>{
      const s=app.listen({host:originHost,port,exclusive:true},()=>resolve(s));
      s.once("error",reject);
    });
    actualPort=server.address().port;
  }catch(e){closeSqliteDb();throw e;}
  const url=origin();
  return {origin:url,port:actualPort,dbPath,cookie:cookieName+"="+token,
    async close(){await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections?.();});closeSqliteDb();}};
}

// The Android launcher writes this configuration in its private directory.
// The capability is never included in a URL or public readiness response.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv[2];
  if(!arg||!path.isAbsolute(arg))throw new Error("Pass the absolute path of a private runtime configuration file");
  const config=JSON.parse(fs.readFileSync(arg,"utf8"));
  const dataDir=privateDirectory(config.dataDir);
  const readyFile=path.join(dataDir,"runtime-ready.json");
  fs.rmSync(readyFile,{force:true});
  const handle=await startLocalWeb({dataDir,port:config.port,token:config.token,webDir:config.webDir});
  const temporary=readyFile+".tmp";
  fs.writeFileSync(temporary,JSON.stringify({origin:handle.origin,engine:"node:sqlite",generation:config.generation}),{mode:0o600});
  fs.renameSync(temporary,readyFile);
}
