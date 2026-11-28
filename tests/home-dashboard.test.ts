import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, getFullWorkspaceBundle, upsertAccountRow, insertLedgerEntryRow, upsertCurrencyRow, upsertWarehouseRow, insertJournalEntryRow, reverseLedgerEntryRow, getCashboxesReport, saveWorkspaceSettingsRow, exportWorkspaceJsonBackup, DEFAULT_WORKSPACE_ID as w } from '../server/sqliteDb.ts';
import { completeBusinessSetup } from '../server/businessSetup.ts';
import { readHomeDashboard } from '../server/homeDashboard.ts';
import { mountSqliteApi } from '../server/sqliteApi.ts';
import { getTrialBalanceReport } from '../server/financialReports.ts';
import { saveCashboxRecord } from '../server/masterCrud.ts';
import { defaultBusinessProfile, defaultUserPreferences } from '../src/utils/businessSetup.ts';
import { buildHomeSnapshot, buildHomeDetail, resolveHomeScope, HOME_POLICIES, type HomeSnapshot } from '../src/dashboard/model.ts';

async function fixture(run:(db:ReturnType<typeof getSqliteDb>)=>Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-home-')),prior=process.env.NASQO_SQLITE_PATH;closeSqliteDb();process.env.NASQO_SQLITE_PATH=path.join(dir,'qa.sqlite');
 try {const db=getSqliteDb();ensureEmptyWorkspace(db,w);await run(db);}finally{closeSqliteDb();if(prior===undefined)delete process.env.NASQO_SQLITE_PATH;else process.env.NASQO_SQLITE_PATH=prior;fs.rmSync(dir,{recursive:true,force:true});}
}
function seed(db:ReturnType<typeof getSqliteDb>){
 const customer=upsertAccountRow(db,w,{name:'QA Customer',category:'clients',currency:'ريال',openingBalance:50,openingDirection:'debit'}),supplier=upsertAccountRow(db,w,{name:'QA Vendor',category:'purchases',currency:'ريال'});
 const warehouse=upsertWarehouseRow(db,w,{name:'QA Warehouse'}), box=saveCashboxRecord(db,w,{name:'QA Cash',currencyCode:'ريال'});
 const post=(amount:number,extra:Record<string,unknown>={})=>insertLedgerEntryRow(db,w,{accountId:customer.id,accountName:customer.name,kind:'invoice',payment:'credit',direction:'debit',amount,currency:'ريال',entryDate:'2026-11-28',warehouseId:warehouse.id,invoiceContent:'free',...extra});
 post(300);post(100,{accountId:supplier.id,accountName:supplier.name,direction:'credit'});
 post(80,{kind:'voucher',typeLabel:'قبض',direction:'credit',payment:'cash',cashboxId:box.id});
 post(900,{postingStatus:'draft'});post(800,{entryDate:'2026-11-27'});
 upsertCurrencyRow(db,w,{name:'دولار',ratePrimary:1});post(700,{currency:'دولار'});
 return {customer,supplier,warehouse,box,post};
}
const when=new Date('2026-11-28T10:00:00Z');
const summary=(db:ReturnType<typeof getSqliteDb>,scope={})=>readHomeDashboard(db,w,scope,when) as Promise<HomeSnapshot>;
test('home values use committed SQLite records, reconcile AR/cash, separate currencies and preserve every stored row',()=>fixture(async db=>{
 const {customer,box}=seed(db);const counter=upsertAccountRow(db,w,{name:'QA Journal Counter',category:'shop',currency:'ريال'});
 insertJournalEntryRow(db,w,{entryDate:'2026-11-28',currency:'ريال',lines:[{accountId:customer.id,debit:25},{accountId:counter.id,credit:25}]});
 const before=exportWorkspaceJsonBackup(db,w).sqliteSnapshot;
 const home=await summary(db);assert.equal(home.kpis.length,4);const values=Object.fromEntries(home.kpis.map(k=>[k.id,k.value]));
 assert.equal(values.sales,300);assert.equal(values.purchases,100);assert.equal(values.cash,getCashboxesReport(db,w,{currency:'ريال',toDate:'2026-11-28'}).cashboxes.find(b=>b.id===box.id)!.netBalance);
 assert.equal(values.receivables,getTrialBalanceReport(db,w,{currency:'ريال',toDate:'2026-11-28'}).rows.find(r=>r.accountId===customer.id)!.closingDebit);
 assert(home.recent.every(r=>r.currency==='ريال'));assert(home.recent.length<=5);assert.equal((await summary(db,{currency:'دولار'})).kpis[0].value,700);
 assert.deepEqual(exportWorkspaceJsonBackup(db,w).sqliteSnapshot,before);
}));
test('timezone, fiscal period, warehouse, inactive cashboxes and invalid references are explicit',()=>fixture(async db=>{
 const {warehouse,box}=seed(db);completeBusinessSetup(db,w,{companyName:'QA Company',currency:'ريال',warehouseName:'QA First',cashboxName:'QA Cash',bankName:'',profile:{...defaultBusinessProfile(),fiscalYearStartMonth:7},preferences:defaultUserPreferences()});
 const d=await readHomeDashboard(db,w,{},new Date('2026-11-27T22:30:00Z')) as HomeSnapshot;assert.equal(d.today,'2026-11-28');assert.equal(d.scope.fromDate,'2026-07-01');assert.equal(d.kpis[0].value,300);
 db.prepare('UPDATE cashboxes SET state=0 WHERE id=?').run(box.id);assert.equal((await summary(db)).kpis[2].value,0);
 const another=upsertWarehouseRow(db,w,{name:'QA Other'});const filtered=await summary(db,{warehouseId:another.id});assert.equal(filtered.kpis[0].value,0);assert.match(filtered.kpis[3].caption,/كل المخازن/);
 for(const scope of [{currency:'الكل'},{currency:'missing'},{warehouseId:'missing'},{branchId:'other'},{fromDate:'2026-02-30'},{fromDate:'2026-11-29',toDate:'2026-11-28'}]) await assert.rejects(summary(db,scope),/نطاق/);
 assert.equal((await summary(db,{warehouseId:warehouse.id,fromDate:'2026-11-27',toDate:'2026-11-27'})).kpis[0].value,0);
}));
test('role projections redact financial totals, actions and counterparties; role cannot be a preference or query',()=>fixture(async db=>{
 seed(db);const input=getFullWorkspaceBundle(db,w),scope=resolveHomeScope(input,{},when),cash=getCashboxesReport(db,w,{currency:'ريال'});
 for(const role of Object.keys(HOME_POLICIES) as (keyof typeof HOME_POLICIES)[]){
  const home=await buildHomeSnapshot(input,scope,cash,{id:'trusted-test-principal',workspaceId:w,role},when);
  assert.equal(home.kpis.length,4);assert.deepEqual(home.actions,HOME_POLICIES[role].actions);assert.deepEqual(home.modules,HOME_POLICIES[role].modules);
  if(role==='warehouse'){assert.equal(home.recent.length,0);assert(!JSON.stringify(home).includes('QA Customer'));assert(home.kpis.every(k=>k.unit===''));}
  if(role==='sales'){assert(!home.kpis.some(k=>k.id==='cash'||k.id==='purchases'));assert(!JSON.stringify(home).includes('QA Vendor'));}
 }
 await assert.rejects(buildHomeSnapshot(input,scope,cash,{id:'x',workspaceId:'foreign',role:'manager'}),/صلاحية/);
 assert.throws(()=>resolveHomeScope(input,{role:'manager'} as any),/مرشح/);
}));
test('summary details open the exact same scoped committed records and alerts reference real accounts',()=>fixture(async db=>{
 const {customer}=seed(db);db.prepare("UPDATE ledger_entries SET due_date='2026-11-27' WHERE amount=300").run();
 const input=getFullWorkspaceBundle(db,w),scope=resolveHomeScope(input,{},when),cash=getCashboxesReport(db,w,{currency:'ريال'}),principal={id:'owner',workspaceId:w,role:'manager' as const};
 const details=await buildHomeDetail(input,scope,cash,principal,'receivables');assert.equal(details.rows.length,1);assert.equal(details.rows[0].target.kind,'account');assert.equal(details.rows[0].id,customer.id);assert.equal(details.total,1070);
 const home=await summary(db);assert.equal(home.alerts[0].target.kind,'account');assert.equal(home.alerts[0].amount,1070);
}));
test('HTTP worker reads are real, access is enforced, personal preferences cannot mutate company settings and survive reopen',()=>fixture(async db=>{
 seed(db);const app=express();mountSqliteApi(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}/api/db/workspace/`,headers={'content-type':'application/json','x-nasqo-csrf':'1'};
 try {
  const home=await fetch(base+w+'/home');assert.equal(home.status,200);assert.equal((await home.json()).kpis.length,4);
  assert.equal((await fetch(base+'foreign/home')).status,403);assert.equal((await fetch(base+w+'/home?role=manager')).status,400);
  assert.equal((await fetch(base+w+'/personal-preferences',{method:'PUT',headers,body:JSON.stringify({preferences:defaultUserPreferences(),companyName:'intrusion'})})).status,400);
  const original=getFullWorkspaceBundle(db,w),pref={...defaultUserPreferences(),theme:'dark',homeColumns:2,favoriteActions:['receipt','payment','journal']};
  assert.equal((await fetch(base+w+'/personal-preferences',{method:'PUT',headers,body:JSON.stringify({preferences:pref})})).status,200);
  const result=getFullWorkspaceBundle(db,w);assert.deepEqual(result.ledger,original.ledger);assert.equal(result.workspace.companyName,original.workspace.companyName);assert.deepEqual(result.workspace.businessProfile,original.workspace.businessProfile);
  closeSqliteDb();assert.deepEqual(getFullWorkspaceBundle(getSqliteDb(),w).workspace.userPreferences,pref);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
}));

test('returns and reversal dates net the original invoice side, and journal activity opens the actual balanced record',()=>fixture(async db=>{
 const {post,customer}=seed(db);
 const sale=post(150);reverseLedgerEntryRow(db,w,sale.id,{reversalDate:'2026-11-28'});
 post(50,{kind:'return',direction:'credit'});
 const other=upsertAccountRow(db,w,{name:'Journal counterpart QA',category:'shop',currency:'ريال'});
 insertJournalEntryRow(db,w,{entryDate:'2026-11-28',currency:'ريال',description:'QA journal detail',lines:[{accountId:customer.id,debit:25},{accountId:other.id,credit:25}]});
 const home=await summary(db);assert.equal(home.kpis[0].value,250);
 const detail=await readHomeDashboard(db,w,{},when,'sales') as import('../src/dashboard/model.ts').HomeDetail;
 assert.equal(detail.rows.reduce((n,r)=>n+(r.amount??0),0),250);
 const journal=home.recent.find(r=>r.target.kind==='journal');assert(journal&&journal.target.kind==='journal');
 assert.equal(journal.target.document.description,'QA journal detail');assert.equal(journal.target.document.lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
 const input=getFullWorkspaceBundle(db,w);assert.equal(resolveHomeScope(input,{currency:input.currencies[0].code},when).currency,input.currencies[0].name);
}));
