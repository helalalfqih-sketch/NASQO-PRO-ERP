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

test("HTTP API preserves invoice lines on JSON export/restore, rejects {}, honors replaceExisting: false, and enforces stock/invoice integrity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nasqo-http-erp-test-"));
  const file = join(dir, "nasqo.sqlite");
  const port = await freePort();
  let srv;
  try {
    srv = await startServer(port, file);
    const prefix = srv.base + "/api/db/workspace/local-erp-workspace";
    const jsonHeaders = { "Content-Type": "application/json", "X-NASQO-CSRF": "1" };

    const whRes = await fetch(prefix + "/warehouses", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ warehouse: { name: "مخزن HTTP", isDefault: true, codeNumber: 1 } }),
    });
    assert.equal(whRes.status, 201);
    const { warehouse } = await whRes.json();

    const accRes = await fetch(prefix + "/accounts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ account: { name: "حساب HTTP", category: "clients", currency: "ريال" } }),
    });
    assert.equal(accRes.status, 201);
    const { account } = await accRes.json();

    const itemRes = await fetch(prefix + "/inventory", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ item: { name: "صنف HTTP", unit: "حبة", quantity: 5, avgCost: 10, warehouseId: warehouse.id } }),
    });
    assert.equal(itemRes.status, 201);
    const { item } = await itemRes.json();

    // Reject overselling 8 units against stock 5; inventory must remain unchanged.
    const oversellRes = await fetch(prefix + "/ledger", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        entry: {
          accountId: account.id,
          accountName: account.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 80,
          currency: "ريال",
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          invoiceContent: "items",
          entryNumber: 1,
          entryDate: "2026-11-18",
          lines: [{ inventoryItemId: item.id, warehouseId: warehouse.id, itemName: item.name, unit: "حبة", quantity: 8, price: 10, total: 80 }],
        },
      }),
    });
    assert.equal(oversellRes.status, 400);
    let wsAfter = await (await fetch(prefix)).json();
    assert.equal(wsAfter.inventory.find((x) => x.id === item.id).quantity, 5);
    assert.equal(wsAfter.ledger.length, 0, "A rejected oversell cannot create a ledger entry");

    // Post a valid sale against the same stock; soft delete/restore must preserve exact quantities.
    const saleRes = await fetch(prefix + "/ledger", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        entry: {
          accountId: account.id,
          accountName: account.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 20,
          currency: "ريال",
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          invoiceContent: "items",
          entryNumber: 1,
          entryDate: "2026-11-18",
          lines: [{ inventoryItemId: item.id, warehouseId: warehouse.id, itemName: item.name, unit: "حبة", quantity: 2, price: 10, total: 20 }],
        },
      }),
    });
    assert.equal(saleRes.status, 201);
    const { entry: savedSale } = await saleRes.json();
    wsAfter = await (await fetch(prefix)).json();
    assert.equal(wsAfter.inventory.find((x) => x.id === item.id).quantity, 3);

    // Mismatched invoice header vs line total -> HTTP 400
    const mismatchRes = await fetch(prefix + "/ledger", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        entry: {
          accountId: account.id,
          accountName: account.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 100,
          currency: "ريال",
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          invoiceContent: "items",
          entryNumber: 2,
          entryDate: "2026-11-18",
          lines: [{ inventoryItemId: item.id, warehouseId: warehouse.id, itemName: item.name, unit: "حبة", quantity: 2, price: 10, total: 999 }],
        },
      }),
    });
    assert.equal(mismatchRes.status, 400);

    // Soft-delete valid sale (3 -> 5), restore (5 -> 3), then hard-delete (3 -> 5).
    await fetch(`${prefix}/ledger/${savedSale.id}/deleted`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ deleted: true }),
    });
    wsAfter = await (await fetch(prefix)).json();
    assert.equal(wsAfter.inventory.find((x) => x.id === item.id).quantity, 5);

    await fetch(`${prefix}/ledger/${savedSale.id}/deleted`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ deleted: false }),
    });
    wsAfter = await (await fetch(prefix)).json();
    assert.equal(wsAfter.inventory.find((x) => x.id === item.id).quantity, 3);

    await fetch(`${prefix}/ledger/${savedSale.id}`, {
      method: "DELETE",
      headers: { "X-NASQO-CSRF": "1" },
    });
    wsAfter = await (await fetch(prefix)).json();
    assert.equal(wsAfter.inventory.find((x) => x.id === item.id).quantity, 5);

    // Re-create a real invoice with 1 line and verify HTTP JSON export/restore + {} rejection + native SQLite replaceExisting: false rejection
    const liveInvRes = await fetch(prefix + "/ledger", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        entry: {
          accountId: account.id,
          accountName: account.name,
          kind: "invoice",
          typeLabel: "فاتورة بيع آجل",
          payment: "credit",
          direction: "debit",
          amount: 30,
          currency: "ريال",
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          invoiceContent: "items",
          entryNumber: 4,
          entryDate: "2026-11-18",
          lines: [{ inventoryItemId: item.id, warehouseId: warehouse.id, itemName: item.name, unit: "حبة", quantity: 3, price: 10, total: 30 }],
        },
      }),
    });
    assert.equal(liveInvRes.status, 201);
    const { entry: liveEntry } = await liveInvRes.json();

    const jsonExport = await (await fetch(prefix + "/export/json")).json();
    assert.equal(jsonExport.format, "nasqo-unified-sqlite-export-v2");
    assert.equal(jsonExport.ledger[0].lines.length, 1);

    // Export native SQLite bytes via HTTP
    const sqliteBuf = Buffer.from(await (await fetch(prefix + "/export/sqlite")).arrayBuffer());

    // Reject {} on /restore/json with 400 and keep data intact
    for (const badBody of [{}, { payload: {} }, { payload: { hello: "world" } }]) {
      const badRes = await fetch(prefix + "/restore/json", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(badBody),
      });
      assert.equal(badRes.status, 400);
      const stillThere = await (await fetch(prefix)).json();
      assert.equal(stillThere.accounts.length, 1);
      assert.equal(stillThere.ledger.length, 1);
    }

    // Reset, restore JSON via HTTP -> confirm invoice line survives!
    await fetch(prefix + "/reset", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ confirmation: "RESET:local-erp-workspace" }),
    });
    const restoreRes = await fetch(prefix + "/restore/json", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ payload: jsonExport }),
    });
    assert.equal(restoreRes.status, 200);
    const detailAfter = await (await fetch(`${prefix}/invoices/${liveEntry.id}`)).json();
    assert.equal(detailAfter.lines.length, 1);
    assert.equal(detailAfter.lines[0].itemName, "صنف HTTP");

    // Import native SQLite with replaceExisting: false -> must reject 400 and keep existing account!
    const nativeMergeRes = await fetch(prefix + "/import/sqlite-legacy", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        base64: sqliteBuf.toString("base64"),
        fileName: "native.sqlite",
        mode: "import",
        replaceExisting: false,
      }),
    });
    assert.equal(nativeMergeRes.status, 400);
    const preserved = await (await fetch(prefix)).json();
    assert.equal(preserved.accounts.length, 1);
    assert.equal(preserved.ledger.length, 1);

    // Malformed JSON request must return JSON error (never Express HTML)
    const malformedRes = await fetch(prefix + "/restore/json", {
      method: "POST",
      headers: jsonHeaders,
      body: "{broken-json",
    });
    assert.equal(malformedRes.status, 400);
    assert.match(malformedRes.headers.get("content-type") ?? "", /application\/json/i);
    const malformedBody = await malformedRes.json();
    assert.ok(typeof malformedBody.error === "string" && malformedBody.error.length > 0);

    // Chunked binary restore for SQLite snapshot (works across multi-chunk payloads)
    await fetch(prefix + "/reset", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ confirmation: "RESET:local-erp-workspace" }),
    });
    const initRes = await fetch(prefix + "/restore/upload/init", {
      method: "POST",
      headers: { "X-NASQO-CSRF": "1" },
    });
    assert.equal(initRes.status, 201);
    const { uploadId } = await initRes.json();
    const mid = Math.floor(sqliteBuf.length / 2);
    for (const part of [sqliteBuf.subarray(0, mid), sqliteBuf.subarray(mid)]) {
      const chunkRes = await fetch(`${prefix}/restore/upload/${uploadId}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-NASQO-CSRF": "1" },
        body: part,
      });
      assert.equal(chunkRes.status, 200);
    }
    const commitRes = await fetch(`${prefix}/restore/upload/${uploadId}/commit`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ kind: "sqlite", fileName: "chunked.sqlite", mode: "restore", replaceExisting: true }),
    });
    assert.equal(commitRes.status, 200);
    const afterChunked = await commitRes.json();
    assert.equal(afterChunked.bundle.accounts.length, 1);
    assert.equal(afterChunked.bundle.ledger.length, 1);
  } finally {
    if (srv) await stopServer(srv.child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Cloud Run managed production boots without NASQO_SQLITE_* env vars and enforces Origin checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nasqo-cloudrun-test-"));
  const port = await freePort();
  const cleanEnv = { ...process.env };
  delete cleanEnv.NASQO_SQLITE_PATH;
  delete cleanEnv.NASQO_SQLITE_ADMIN_PASSWORD;
  delete cleanEnv.NASQO_SQLITE_SESSION_SECRET;
  delete cleanEnv.NASQO_SQLITE_PUBLIC_ORIGIN;
  delete cleanEnv.NASQO_SQLITE_SECURE_COOKIE;
  delete cleanEnv.NASQO_SQLITE_STRICT_PRODUCTION;

  let child;
  try {
    child = spawn(process.execPath, [resolve(process.cwd(), "server.ts"), "--port", String(port)], {
      cwd: dir,
      env: {
        ...cleanEnv,
        NODE_ENV: "production",
        K_SERVICE: "nasqo-pro-test",
        NASQO_SKIP_AUTO_SQL_IMPORT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const base = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 100; i += 1) {
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(`${base}/api/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        // retry until listening
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(healthy, true, `Cloud Run server failed to start: ${stderr}`);

    const status = await (await remoteRequest(port, "/api/db/auth/status")).json();
    assert.equal(status.mode, "local");
    assert.equal(status.authenticated, true);

    const wsRes = await remoteRequest(port, "/api/db/workspace/local-erp-workspace");
    assert.equal(wsRes.status, 200);

    const csrfBlocked = await remoteRequest(port, "/api/db/workspace/local-erp-workspace/accounts", {
      method: "POST",
      headers: { Origin: "http://evil.example.test" },
      body: { account: { name: "حساب مرفوض", category: "clients", currency: "ريال" } },
    });
    assert.equal(csrfBlocked.status, 403);

    const sameOriginCreate = await remoteRequest(port, "/api/db/workspace/local-erp-workspace/accounts", {
      method: "POST",
      headers: { Origin: "http://nasqo.example.test" },
      body: { account: { name: "حساب سحابي", category: "clients", currency: "ريال" } },
    });
    assert.equal(sameOriginCreate.status, 201);
    assert.ok(existsSync(join(dir, "data", "nasqo.sqlite")));
  } finally {
    if (child) await stopServer(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

