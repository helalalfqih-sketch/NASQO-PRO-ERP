import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { mountSqliteApi } from '../server/sqliteApi.ts';
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, DEFAULT_WORKSPACE_ID as w, upsertAccountRow, insertJournalEntryRow, exportWorkspaceJsonBackup, restoreUnifiedJsonBundle, exportCleanSqliteSnapshotBytes, importInventoryCatalogRows, importAccountCardsRows } from '../server/sqliteDb.ts';
import { importLegacySqliteIntoUnifiedDb } from '../server/legacySqliteImporter.ts';
import { captureWorkspaceSnapshot, snapshotFromTables } from '../server/workspaceSnapshot.ts';
import { prepareWorkspaceRestore, withApprovedRestore, readRestoreSafetyBackup } from '../server/restoreSafety.ts';

async function fixture(run: (db: ReturnType<typeof getSqliteDb>, dir: string) => Promise<void> | void) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-restore-regression-'));
 const db=getSqliteDb(path.join(dir,'test.sqlite'));
 try { ensureEmptyWorkspace(db,w,'Synthetic'); await run(db,dir); }
 finally { closeSqliteDb(); fs.rmSync(dir,{recursive:true,force:true}); }
}

test('all 31 populated tables survive JSON and SQLite restore with every value intact, repeatedly', async () => fixture(async (db,dir) => {
 const at='2026-11-27T12:00:00.000Z';
  ensureEmptyWorkspace(db,w,'شركة فحص الجداول الاصطناعية');
  const a=upsertAccountRow(db,w,{name:'حساب اصطناعي أ',category:'clients',currency:'ريال',codeNumber:1});
  const b=upsertAccountRow(db,w,{name:'حساب اصطناعي ب',category:'clients',currency:'ريال',codeNumber:2});
  insertJournalEntryRow(db,w,{entryDate:'2026-11-27',description:'قيد اصطناعي مستقل',idempotencyKey:'audit-all-tables',lines:[{accountId:a.id,debit:10},{accountId:b.id,credit:10}]});
  function seed(table:string,overrides:Record<string,any>={}) {
    const cols=db.prepare(`PRAGMA table_info("${table}")`).all() as any[];
    const row:Record<string,any>={};
    for(const c of cols) {
      if(c.pk && c.type==='TEXT') row[c.name]=`audit-${table}`;
      if(c.notnull && c.dflt_value===null) row[c.name]=c.type.includes('INT')||c.type==='REAL'?1:`اصطناعي ${c.name}`;
      if(c.name==='workspace_id') row[c.name]=w;
      if(['created_at','updated_at','exported_at_iso','imported_at'].includes(c.name)) row[c.name]=at;
      if(['entry_date','order_date','created_date','start_date','end_date','offer_date','transfer_date','doc_date','alert_date'].includes(c.name)) row[c.name]='2026-11-27';
      if(c.name==='created_at_ms') row[c.name]=Date.parse(at);
    }
    Object.assign(row,overrides);
    const keys=Object.keys(row);
    const r=db.prepare(`INSERT INTO "${table}" (${keys.map(x=>`"${x}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
    return row.id??Number(r.lastInsertRowid);
  }
  const group=seed('account_groups',{name:'مجموعة اصطناعية',category:'clients'});
  db.prepare('UPDATE accounts SET group_id=? WHERE id IN (?,?)').run(group,a.id,b.id);
  const box=seed('cashboxes',{name:'صندوق اصطناعي',currency_code:'ريال'});
  const wh=seed('warehouses',{name:'مخزن اصطناعي'});
  const wh2=seed('warehouses',{id:'audit-warehouse-2',name:'مخزن اصطناعي ثانٍ'});
  const item=seed('inventory_items',{name:'صنف اصطناعي',warehouse_id:wh,sku:'000123',quantity:2,avg_cost:5,selling_price:8});
  const entry=seed('ledger_entries',{account_id:a.id,account_name:a.name,kind:'invoice',type_label:'فاتورة اصطناعية',payment:'credit',direction:'debit',amount:8,currency:'ريال',invoice_content:'items',warehouse_id:wh});
  seed('invoice_lines',{entry_id:entry,inventory_item_id:item,warehouse_id:wh,item_name:'صنف اصطناعي',unit:'حبة',quantity:1,price:8,total:8,details:'بند اصطناعي'});
  const transfer=seed('stock_transfers',{from_warehouse_id:wh,to_warehouse_id:wh2,details:'تحويل اصطناعي محفوظ',legacy_id:4001});
  seed('stock_transfer_lines',{transfer_id:transfer,inventory_item_id:item,quantity:1,unit:'حبة',details:'بند تحويل اصطناعي'});
  const offer=seed('price_offers',{account_id:a.id,name:'عرض اصطناعي',currency:'ريال',legacy_id:4002});
  seed('price_offer_lines',{offer_id:offer,inventory_item_id:item,quantity:1,price:8,total:8,unit:'حبة',details:'بند عرض اصطناعي'});
  const archive=seed('archived_documents',{legacy_id:5001,account_id:a.id,account_name:a.name,details:'أرشيف اصطناعي',dain:8});
  seed('archived_document_lines',{archived_doc_id:archive,inventory_item_id:item,warehouse_id:wh,quantity:1,price:8,total:8,details:'بند أرشيف اصطناعي'});
  seed('alerts',{account_id:a.id,details:'تنبيه اصطناعي',legacy_id:6001});
  const employee=seed('erp_employees',{id:'audit-employee',name:'موظف اصطناعي',account_id:a.id,basic_salary:100});
  seed('erp_leave_requests',{id:'audit-leave',employee_id:employee,employee_name:'موظف اصطناعي',leave_type:'annual',days:1});
  seed('erp_deals',{id:'audit-deal',title:'صفقة اصطناعية',client_account_id:a.id,client_name:a.name,value:10});
  seed('erp_purchase_orders',{id:'audit-po',po_number:'AUDIT-PO',supplier_account_id:b.id,supplier_name:b.name,warehouse_id:wh,warehouse_name:'مخزن اصطناعي',lines_json:'[]'});
  const bom=seed('erp_boms',{id:'audit-bom',name:'تركيبة اصطناعية',finished_item_id:item,finished_item_name:'صنف اصطناعي',components_json:'[]'});
  const cost=seed('erp_cost_centers',{id:'audit-cost',code:'AUDIT',name:'مركز اصطناعي',budget:100});
  seed('erp_production_orders',{id:'audit-production',order_number:'AUDIT-MO',bom_id:bom,bom_name:'تركيبة اصطناعية',finished_item_id:item,finished_item_name:'صنف اصطناعي',warehouse_id:wh,quantity_to_produce:1,cost_center_id:cost});
  seed('backups',{name:'سجل نسخة اصطناعية'});
  seed('legacy_imports',{source_name:'synthetic.back',source_format:'sqlite',source_sha256:'a'.repeat(64),tables_count:1,total_rows:1});
  seed('legacy_users',{legacy_id:8001,name:'مستخدم اصطناعي',username:'synthetic-user'});
  seed('legacy_permissions',{legacy_id:8002,name:'صلاحية اصطناعية'});

 const before=captureWorkspaceSnapshot(db,w);
 assert.equal(Object.keys(before.tables).length,31);
 assert(Object.values(before.tables).every(rows=>rows.length>0));
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const json=exportWorkspaceJsonBackup(db,w);
 const bytes=await exportCleanSqliteSnapshotBytes(db,path.join(dir,'export.sqlite'),w);
 for(let i=0;i<2;i++) {
   restoreUnifiedJsonBundle(db,w,json);
   assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
   importLegacySqliteIntoUnifiedDb(db,bytes,{workspaceId:w,replaceExisting:true});
   assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 }
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('bad checksum, missing tables and invalid relations roll back without touching either workspace', async () => fixture(db => {
 const live=upsertAccountRow(db,w,{name:'Live',category:'clients',currency:'ريال'});
 const peer=upsertAccountRow(db,w,{name:'Peer',category:'clients',currency:'ريال'});
 insertJournalEntryRow(db,w,{entryDate:'2026-11-27',description:'Balanced source',idempotencyKey:'rollback-journal',lines:[{accountId:live.id,debit:2},{accountId:peer.id,credit:2}]});
 ensureEmptyWorkspace(db,'other-workspace','Other');
 const other=upsertAccountRow(db,'other-workspace',{name:'Other',category:'clients',currency:'ريال'});
 const before=captureWorkspaceSnapshot(db,w), otherBefore=captureWorkspaceSnapshot(db,'other-workspace');
 const json=exportWorkspaceJsonBackup(db,w);
 for(const mutate of [
  (x:any)=>{x.sqliteSnapshot.tables.accounts[0].name='Changed';},
  (x:any)=>{delete x.sqliteSnapshot.tables.journal_entries;},
  (x:any)=>{x.sqliteSnapshot.tables.accounts[0].group_id='missing-group';x.sqliteSnapshot=snapshotFromTables(x.sqliteSnapshot.tables);},
  (x:any)=>{x.sqliteSnapshot.tables.accounts[0].id=other.id;x.sqliteSnapshot=snapshotFromTables(x.sqliteSnapshot.tables);},
  (x:any)=>{delete x.sqliteSnapshot.tables.accounts[0].id;x.sqliteSnapshot=snapshotFromTables(x.sqliteSnapshot.tables);},
  (x:any)=>{x.sqliteSnapshot.tables.journal_entry_lines[0].debit_minor+=1;x.sqliteSnapshot=snapshotFromTables(x.sqliteSnapshot.tables);}
 ]) {
  const bad=structuredClone(json);mutate(bad);
  assert.throws(()=>restoreUnifiedJsonBundle(db,w,bad));
  assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
  assert.deepEqual(captureWorkspaceSnapshot(db,'other-workspace'),otherBefore);
 }
}));

test('replacement requires current confirmation, durable downloadable safety backup, and rolls back failures', async () => fixture((db,dir) => {
 upsertAccountRow(db,w,{name:'Before review',category:'clients',currency:'ريال'});
 const before=captureWorkspaceSnapshot(db,w);
 assert.throws(()=>withApprovedRestore(db,w,undefined,()=>db.prepare('DELETE FROM accounts').run()));
 const review=prepareWorkspaceRestore(db,w);
 const safety=JSON.parse(readRestoreSafetyBackup(w,review.token).toString());
 assert.deepEqual(safety.sqliteSnapshot,JSON.parse(JSON.stringify(before)));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'restore-safety',review.backupFileName),'utf8')),safety);
 assert.throws(()=>readRestoreSafetyBackup('other',review.token));
 assert.throws(()=>withApprovedRestore(db,w,review.token,()=>{ db.prepare('DELETE FROM accounts WHERE workspace_id=?').run(w); throw new Error('simulated failure'); }));
 assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 upsertAccountRow(db,w,{name:'Written after review',category:'clients',currency:'ريال'});
 const changed=captureWorkspaceSnapshot(db,w);
 assert.throws(()=>withApprovedRestore(db,w,review.token,()=>restoreUnifiedJsonBundle(db,w,safety)),/تغيرت/);
 assert.deepEqual(captureWorkspaceSnapshot(db,w),changed);
 const current=prepareWorkspaceRestore(db,w);
 withApprovedRestore(db,w,current.token,()=>restoreUnifiedJsonBundle(db,w,safety));
 assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 assert.throws(()=>withApprovedRestore(db,w,current.token,()=>{}));
}));

test('catalog inserts are unassigned zero-stock cards with separate purchase reference; duplicates leave values intact', async () => fixture(db=>{
 const row={name:'Part',sku:'000123',unit:'حبة',catalogReferenceCost:17.5,sellingPrice:25,currencyCode:'ريال',isActive:false};
 assert.equal(importInventoryCatalogRows(db,w,[row],{mode:'skip'}).inserted,1);
 const item=db.prepare('SELECT * FROM inventory_items').get() as any;
 assert.equal(item.warehouse_id,null);assert.equal(item.quantity,0);assert.equal(item.avg_cost,0);assert.equal(item.catalog_reference_cost,17.5);assert.equal(item.sku,'000123');assert.equal(item.bstate,0);
 db.prepare('UPDATE inventory_items SET quantity=5,avg_cost=11 WHERE id=?').run(item.id);
 const preserved=db.prepare('SELECT * FROM inventory_items').all();
 assert.equal(importInventoryCatalogRows(db,w,[{...row,catalogReferenceCost:99}],{mode:'skip'}).skipped,1);
 assert.deepEqual(db.prepare('SELECT * FROM inventory_items').all(),preserved);
 const before=captureWorkspaceSnapshot(db,w);
 for(const bad of [{quantity:9},{avgCost:2},{unit2:'box',count2:0}]) {
  assert.throws(()=>importInventoryCatalogRows(db,w,[{...row,name:'Valid new',sku:'001'},{...row,name:'Invalid',sku:'002',...bad}],{mode:'skip'}));
  assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 }
}));

test('account cards import atomically without opening balances, preserve phone and do not create postings', async () => fixture(db=>{
 const row={name:'شركة، فرع\nالمدينة',phone:'001234',category:'clients' as const,currency:'ريال',openingBalance:0,openingDirection:'credit' as const};
 assert.equal(importAccountCardsRows(db,w,[row]).inserted,1);
 const before=captureWorkspaceSnapshot(db,w);
 assert.equal(before.tables.accounts[0].phone,'001234');
 assert.equal(importAccountCardsRows(db,w,[row]).skipped,1);
 assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 for(const bad of [{openingBalance:50},{currency:'unknown'},{category:'invalid'}]) {
  assert.throws(()=>importAccountCardsRows(db,w,[{...row,name:'valid new'},{...row,name:'bad',...bad}] as any));
  assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
 }
 assert.equal(before.tables.journal_entries.length,0);assert.equal(before.tables.ledger_entries.length,0);
}));

test('HTTP restore and chunked commit enforce confirmation; downloaded safety file matches current database', async () => fixture(async (db,dir) => {
 const previousPath=process.env.NASQO_SQLITE_PATH;
 process.env.NASQO_SQLITE_PATH=path.join(dir,'test.sqlite');
 const app=express();mountSqliteApi(app);
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}/api/db/workspace/${w}`;
 const post=(route:string,data:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','x-nasqo-csrf':'1'},body:JSON.stringify(data)});
 try {
  const original=exportWorkspaceJsonBackup(db,w);
  upsertAccountRow(db,w,{name:'Current HTTP account',category:'clients',currency:'ريال'});
  const before=captureWorkspaceSnapshot(db,w);
  assert.equal((await post('/restore/json',{payload:original})).status,400);
  assert.equal((await post('/import/smartpro-sql',{sqlText:'-- synthetic request '.repeat(5),replaceExisting:true})).status,400);
  const upload=async()=>{
    const {uploadId}=await (await post('/restore/upload/init',{})).json() as any;
    const sent=await fetch(`${base}/restore/upload/${uploadId}/chunk`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-nasqo-csrf':'1'},body:Buffer.from(JSON.stringify(original))});
    assert.equal(sent.status,200);return uploadId;
  };
  const denied=await upload();
  assert.equal((await post(`/restore/upload/${denied}/commit`,{kind:'json'})).status,400);
  assert.deepEqual(captureWorkspaceSnapshot(db,w),before);
  const review=await (await post('/restore/prepare',{})).json() as any;
  const saved=await (await fetch(`${base}/restore/safety/${review.token}`)).json() as any;
  assert.deepEqual(saved.sqliteSnapshot,JSON.parse(JSON.stringify(before)));
  const approved=await upload();
  const restored=await post(`/restore/upload/${approved}/commit`,{kind:'json',restoreToken:review.token});
  assert.equal(restored.status,200,await restored.text());
  assert.deepEqual(captureWorkspaceSnapshot(db,w),original.sqliteSnapshot);
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  if(previousPath===undefined)delete process.env.NASQO_SQLITE_PATH;else process.env.NASQO_SQLITE_PATH=previousPath;
 }
}));
