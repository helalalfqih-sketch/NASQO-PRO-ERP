import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";

async function remoteRequest(port, target, { method = "GET", headers = {}, body } = {}) {
  // Node fetch normalizes Host. Native http.request verifies the actual
  // untrusted-host / reverse-proxy access path, not a localhost shortcut.
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, path: target, method,
      headers: { Host: "nasqo.example.test", ...headers,
        ...(data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
    }, res => {
      let output = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { output += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: { get: name => (Array.isArray(res.headers[name.toLowerCase()]) ? res.headers[name.toLowerCase()][0] : res.headers[name.toLowerCase()]) ?? null },
        json: async () => JSON.parse(output),
      }));
    });
    req.on("error", reject);
    req.end(data);
  });
}
async function freePort() {
  const server=net.createServer();
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const port=server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function startServer(port, dbFile, envOverrides = {}) {
  const child=spawn(process.execPath, ["server.ts","--port",String(port)], {
    cwd:process.cwd(),
    env:{...process.env,NODE_ENV:"development",NASQO_SQLITE_PATH:dbFile,
      NASQO_SKIP_AUTO_SQL_IMPORT:"1",
      NASQO_SQLITE_ADMIN_PASSWORD:"test-password-only-123456",
      NASQO_SQLITE_SESSION_SECRET:"test-session-secret-longer-than-thirty-two-characters",
      ...envOverrides},
    stdio:["ignore","pipe","pipe"],
  });
  let errors="";
  child.stderr.on("data",chunk=>errors+=String(chunk).slice(0,500));
  const base="http://127.0.0.1:"+port;
  for(let i=0;i<200;i++) {
    if(child.exitCode!==null)break;
    try {
      const reply=await fetch(base+"/api/health");
      if(reply.ok)return {child,base,port};
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill("SIGTERM");
  throw new Error("Test server did not start: "+errors.slice(-1000));
}
async function stopServer(child) {
  if (child.exitCode!==null)return;
  const done=new Promise(resolve => child.once("exit",resolve));
  child.kill("SIGTERM");
  await Promise.race([done,new Promise(resolve=>setTimeout(resolve,5000))]);
  if(child.exitCode===null)child.kill("SIGKILL");
}
test("one empty SQLite database persists master data across restarts; backup is verified; remote API requires login", async()=>{
  const dir=mkdtempSync(join(tmpdir(),"nasqo-single-db-test-"));
  const file=join(dir,"nasqo.sqlite");
  const copy=join(dir,"backup","nasqo-backup.sqlite");
  const port=await freePort();
  let srv;
  try {
    srv=await startServer(port,file);
    const status=await (await fetch(srv.base+"/api/db/auth/status")).json();
    assert.equal(status.mode,"local");
    assert.equal(status.authenticated,true);
    const stats=await (await fetch(srv.base+"/api/db/status")).json();
    for(const k of ["accountsCount","ledgerCount","invoiceLinesCount","warehousesCount","inventoryCount"])
      assert.equal(stats[k],0,k);
    // An unconfirmed reset must never clear even an empty workspace.
    const resetWithoutConfirmation = await fetch(srv.base + "/api/db/workspace/local-erp-workspace/reset", {
      method: "POST", headers: { "X-NASQO-CSRF": "1" },
    });
    assert.equal(resetWithoutConfirmation.status, 400);
    const remoteHeaders = {};
    const remoteStatus = await (await remoteRequest(port, "/api/db/auth/status")).json();
    assert.equal(remoteStatus.mode, "password");
    assert.equal(remoteStatus.authenticated, false);
    let result = await remoteRequest(port, "/api/db/workspace/local-erp-workspace");
    assert.equal(result.status, 401);
    result = await remoteRequest(port, "/api/db/workspace/local-erp-workspace/reset",{
      method:"POST",headers:{"X-NASQO-CSRF":"1"},
    });
    assert.equal(result.status,401);
    result = await remoteRequest(port, "/api/db/auth/login",{
      method:"POST",headers:{Origin:"http://nasqo.example.test"},
      body:{password:"wrong-password"},
    });
    assert.equal(result.status,401);
    result = await remoteRequest(port, "/api/db/auth/login",{
      method:"POST",headers:{Origin:"http://nasqo.example.test"},
      body:{password:"test-password-only-123456"},
    });
    assert.equal(result.status,200);
    const cookie=result.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("nasqo_sqlite_session="));
    result=await remoteRequest(port,"/api/db/workspace/local-erp-workspace",{
      headers:{Cookie:cookie},
    });
    assert.equal(result.status,200);
    result=await remoteRequest(port,"/api/db/workspace/local-erp-workspace/reset",{
      method:"POST",headers:{Cookie:cookie,Origin:"http://evil.example.test"},
    });
    assert.equal(result.status,403);
    // Logout must revoke the previous session token server-side so a replayed copy fails
    const logoutRes = await remoteRequest(port, "/api/db/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://nasqo.example.test" },
    });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get("set-cookie") ?? "", /Max-Age=0/);
    const replayAfterLogout = await remoteRequest(port, "/api/db/workspace/local-erp-workspace", {
      headers: { Cookie: cookie },
    });
    assert.equal(replayAfterLogout.status, 401);
    const replayStatus = await (await remoteRequest(port, "/api/db/auth/status", {
      headers: { Cookie: cookie },
    })).json();
    assert.equal(replayStatus.authenticated, false);
    const prefix=srv.base+"/api/db/workspace/local-erp-workspace";
    result=await fetch(prefix+"/groups",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:srv.base},
      body:JSON.stringify({group:{name:"المشتريات",category:"purchases",currencyCode:"ريال"}}),
    });
    assert.equal(result.status,201);
    result=await fetch(prefix+"/accounts",{
      method:"POST",headers:{"Content-Type":"application/json",Origin:srv.base},
      body:JSON.stringify({account:{name:"حساب فعلي",category:"purchases",currency:"ريال"}}),
    });
    assert.equal(result.status,201);
    const before=await(await fetch(srv.base+"/api/db/status")).json();
    assert.equal(before.accountsCount,1);
    assert.ok(existsSync(file));
    await stopServer(srv.child);srv=null;
    srv=await startServer(port,file);
    const after=await(await fetch(srv.base+"/api/db/status")).json();
    assert.equal(after.accountsCount,1);
    const replayAfterRestart = await remoteRequest(port, "/api/db/workspace/local-erp-workspace", {
      headers: { Cookie: cookie },
    });
    assert.equal(replayAfterRestart.status, 401);
    const bundle=await(await fetch(prefix)).json();
    assert.ok(bundle.accounts.some(a=>a.name==="حساب فعلي"));
    execFileSync(process.execPath,["scripts/backup-sqlite.mjs",copy],{
      cwd:process.cwd(),env:{...process.env,NASQO_SQLITE_PATH:file},stdio:"pipe",
    });
    assert.ok(statSync(copy).size>0);
    const db=new DatabaseSync(copy,{readOnly:true});
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,1);
    db.close();
  } finally {
    if(srv)await stopServer(srv.child);
    rmSync(dir,{recursive:true,force:true});
  }
});


test("production refuses ephemeral SQLite without a persistent volume", async () => {
  if (process.platform !== "linux") return;
  const dir = mkdtempSync(join(tmpdir(), "nasqo-no-volume-test-"));
  const file = join(dir, "forbidden.sqlite");
  const port = await freePort();
  try {
    const result = await new Promise(resolve => {
      let errors = "";
      const child = spawn(process.execPath, ["server.ts", "--port", String(port)], {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "production", NASQO_SQLITE_PATH: file,
          NASQO_SKIP_AUTO_SQL_IMPORT: "1", NASQO_SQLITE_ADMIN_PASSWORD: "test-long-password-123",
          NASQO_SQLITE_SESSION_SECRET: "test-secret-more-than-thirty-two-characters" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.on("data", part => { errors += String(part); });
      child.once("exit", code => resolve({ code, errors }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.errors, /persistent mount/i);
    assert.equal(existsSync(file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
