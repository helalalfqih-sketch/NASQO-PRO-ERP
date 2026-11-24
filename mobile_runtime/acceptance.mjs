import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startLocalWeb } from "./host.mjs";
import { computeAccountGroupsSummary } from "../src/accounting.ts";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nasqo-original-engine-"));
const uid="local-erp-workspace",ws="/api/db/workspace/"+uid;
let host;
const start=()=>startLocalWeb({dataDir:dir,port:0,serveUi:false});
async function request(route,body,method=body===undefined?"GET":"POST"){
  const res=await fetch(host.origin+route,{method,headers:{cookie:host.cookie,origin:host.origin,"x-nasqo-csrf":"1",
    ...(body!==undefined?{"content-type":"application/json"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.ok(res.ok,"Original API request failed: "+method+" "+route+" (HTTP "+res.status+")");
  return res.json();
}
function totals(bundle){
  return computeAccountGroupsSummary(bundle.accountGroups,bundle.accounts,bundle.ledger,{},"ريال")
    .map(({id,accountCount,netDebitMinusCredit})=>({id,accountCount,netDebitMinusCredit}));
}
try{
  host=await start();
  assert.equal((await fetch(host.origin+"/api/db/status")).status,401);
  assert.equal((await fetch(host.origin+"/api/db/status",{headers:{cookie:host.cookie,origin:"https://example.invalid"}})).status,403);
  assert.equal((await request("/api/smartpro/status")).primary,false);
  const backupPath=process.env.NASQO_PRIVATE_LEGACY_BACKUP;
  let expected;
  if(backupPath){
    const bytes=fs.readFileSync(backupPath),hash=crypto.createHash("sha256").update(bytes).digest("hex");
    const inspected=await request(ws+"/import/sqlite-legacy",{base64:bytes.toString("base64"),fileName:"private.back",mode:"inspect"});
    assert.equal(inspected.integrity,"ok");
    const restored=await request(ws+"/import/sqlite-legacy",{base64:bytes.toString("base64"),fileName:"private.back",mode:"restore",replaceExisting:true});
    const bundle=restored.bundle;
    assert.ok(bundle.accounts.length>0&&bundle.ledger.length>0);
    expected={counts:[bundle.accounts.length,bundle.inventory.length,bundle.ledger.length],totals:totals(bundle)};
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex"),hash);
    console.log("Original private-file importer: PASS (aggregate counts only):",expected.counts.join("/"));
  }else{
    const account=(await request(ws+"/accounts",{account:{name:"Synthetic account",category:"clients",currency:"ريال"}})).account;
    assert.ok(account.id);
    const entry=(await request(ws+"/ledger",{entry:{accountId:account.id,accountName:account.name,kind:"voucher",typeLabel:"سند",payment:"credit",direction:"debit",currency:"ريال",exchangeRate:1,amount:125,entryNumber:1,entryDate:"2026-01-01",details:"Synthetic acceptance"}})).entry;
    assert.equal(entry.amount,125);
    const bundle=await request(ws);
    assert.ok(bundle.accounts.some(a=>a.id===account.id));
    assert.ok(bundle.ledger.some(e=>e.id===entry.id));
    expected={counts:[bundle.accounts.length,bundle.inventory.length,bundle.ledger.length],totals:totals(bundle)};
  }
  await host.close();host=null;
  host=await start();
  const reopened=await request(ws);
  assert.deepEqual([reopened.accounts.length,reopened.inventory.length,reopened.ledger.length],expected.counts);
  assert.deepEqual(totals(reopened),expected.totals);
  const backup=await request(ws+"/export/json");
  assert.ok(backup.format);
  const exported=await fetch(host.origin+ws+"/export/sqlite",{headers:{cookie:host.cookie}});
  assert.ok(exported.ok);
  const bytes=Buffer.from(await exported.arrayBuffer());
  assert.equal(bytes.subarray(0,15).toString("ascii"),"SQLite format 3");
  console.log("PASS: original SQLite API, protected loopback, persistence after restart, original reports and JSON/SQLite export");
}finally{
  if(host)await host.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
