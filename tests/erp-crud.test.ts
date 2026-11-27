import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { executeErpAction } from '../server/erpActions.ts';
import { deleteMasterRecord, saveCashboxRecord } from '../server/masterCrud.ts';
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, loadErpDataRows, DEFAULT_WORKSPACE_ID as w, upsertAccountRow, upsertWarehouseRow, insertInventoryItemRow, exportWorkspaceJsonBackup, restoreUnifiedJsonBundle, upsertAccountGroupRow, deleteAccountRow, deleteInventoryCatalogRow, getFullWorkspaceBundle } from '../server/sqliteDb.ts';
import { saveErpRecords } from '../server/erpRecords.ts';
import { erpRows, type ErpCollection, type ErpRow } from '../src/erpRecordRules.ts';
import { mountSqliteApi } from '../server/sqliteApi.ts';
const samples=JSON.parse(fs.readFileSync(new URL('./fixtures/erp-crud.json',import.meta.url),'utf8')) as Record<ErpCollection,ErpRow>;
async function fixture(run:(db:ReturnType<typeof getSqliteDb>)=>Promise<void>|void){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-full-crud-')),prev=process.env.NASQO_SQLITE_PATH;process.env.NASQO_SQLITE_PATH=path.join(dir,'isolated.sqlite');
 const db=getSqliteDb();try{
  ensureEmptyWorkspace(db,w);
  const a=upsertAccountRow(db,w,{name:'حساب اختبار',category:'clients',currency:'ريال'});db.prepare('UPDATE accounts SET id=? WHERE id=?').run('crud-account',a.id);
  const wh=upsertWarehouseRow(db,w,{name:'مخزن اختبار',details:'',isDefault:false});db.prepare('UPDATE warehouses SET id=? WHERE id=?').run('crud-wh',wh.id);
  for(const id of ['crud-raw','crud-finished']){const i=insertInventoryItemRow(db,w,{name:id,unit:'حبة',warehouseId:'crud-wh',quantity:0,avgCost:0});db.prepare('UPDATE inventory_items SET id=? WHERE id=?').run(id,i.id);}
  await run(db);
 }finally{closeSqliteDb();if(prev===undefined)delete process.env.NASQO_SQLITE_PATH;else process.env.NASQO_SQLITE_PATH=prev;fs.rmSync(dir,{recursive:true,force:true});}
}
function command(db:ReturnType<typeof getSqliteDb>,c:ErpCollection,r:ErpRow,operation:'create'|'update'|'delete'='create'){
 const old=erpRows(loadErpDataRows(db,w),c).find(v=>v.id===r.id);
 return {collection:c,record:r,operation,expectedRevision:operation==='create'?0:old?._revision??0};
}
test('each administrative collection has persisted create, read, update and guarded delete; repeated restore retains it',async()=>fixture(db=>{
 const initialStock=db.prepare('SELECT * FROM inventory_items').all(),initialLedger=db.prepare('SELECT * FROM ledger_entries').all();
 for(const [name,record] of Object.entries(samples)){
  const c=name as ErpCollection;saveErpRecords(db,w,[command(db,c,record)]);
  const saved=erpRows(loadErpDataRows(db,w),c).find(v=>v.id===record.id)!;assert.equal(typeof saved._revision,'string');
  const edit={...record,...({employees:{name:'موظف معدل'},leaveRequests:{note:'مراجعة'},deals:{value:600},purchaseOrders:{notes:'معدّل'},boms:{name:'تركيبة معدلة'},costCenters:{budget:2000},productionOrders:{quantityToProduce:3}}[c]??{})};
  saveErpRecords(db,w,[command(db,c,edit,'update')]);assert.notEqual(erpRows(loadErpDataRows(db,w),c).find(v=>v.id===record.id)!._revision,saved._revision);
  assert.throws(()=>saveErpRecords(db,w,[{collection:c,record,operation:'update',expectedRevision:saved._revision}]),/تغيّر/);
 }
 assert.throws(()=>saveErpRecords(db,w,[command(db,'employees',{id:'crud-employee'},'delete')]),/الموظف/);
 assert.throws(()=>saveErpRecords(db,w,[command(db,'boms',{id:'crud-bom'},'delete')]),/المواد/);
 assert.throws(()=>saveErpRecords(db,w,[command(db,'costCenters',{id:'crud-center'},'delete')]),/التكلفة/);
 const backup=exportWorkspaceJsonBackup(db,w),data=loadErpDataRows(db,w);restoreUnifiedJsonBundle(db,w,backup);assert.deepEqual(loadErpDataRows(db,w),data);
 for(const c of ['productionOrders','leaveRequests','deals','purchaseOrders','boms','costCenters','employees'] as ErpCollection[])saveErpRecords(db,w,[command(db,c,{id:samples[c].id},'delete')]);
 for(const c of Object.keys(samples) as ErpCollection[])assert.equal(erpRows(loadErpDataRows(db,w),c).length,0,c);
 assert.deepEqual(db.prepare('SELECT * FROM inventory_items').all(),initialStock);assert.deepEqual(db.prepare('SELECT * FROM ledger_entries').all(),initialLedger);
}));
test('leave approval/edit/rejection/deletion adjusts balance once; rejected batches and foreign refs have no effect',async()=>fixture(db=>{
 const save=(c:ErpCollection,r:ErpRow,op:'create'|'update'|'delete'='create')=>saveErpRecords(db,w,[command(db,c,r,op)]);
 save('employees',samples.employees);save('leaveRequests',{...samples.leaveRequests,status:'approved'});assert.equal(loadErpDataRows(db,w).employees[0].leaveBalanceDays,19);
 save('leaveRequests',{...samples.leaveRequests,status:'approved',days:3},'update');assert.equal(loadErpDataRows(db,w).employees[0].leaveBalanceDays,18);
 save('leaveRequests',{...samples.leaveRequests,status:'rejected',days:3},'update');assert.equal(loadErpDataRows(db,w).employees[0].leaveBalanceDays,21);
 save('leaveRequests',{...samples.leaveRequests,status:'approved'},'update');save('leaveRequests',{id:samples.leaveRequests.id},'delete');assert.equal(loadErpDataRows(db,w).employees[0].leaveBalanceDays,21);
 const before=exportWorkspaceJsonBackup(db,w).sqliteSnapshot;
 assert.throws(()=>saveErpRecords(db,w,[command(db,'purchaseOrders',{...samples.purchaseOrders,lines:[{...samples.purchaseOrders.lines[0],unit:'carton'}]})]),/وحدة/);
 for(const row of [{...samples.deals,probability:101},{...samples.deals,currency:'دولار'},{...samples.deals,clientAccountId:'foreign'},{...samples.deals,expectedCloseDate:'2026-02-30'},{...samples.deals,convertedInvoiceEntryId:'forged'}])assert.throws(()=>saveErpRecords(db,w,[command(db,'deals',row)]));
 assert.throws(()=>saveErpRecords(db,w,[command(db,'costCenters',samples.costCenters),command(db,'purchaseOrders',{...samples.purchaseOrders,status:'received'})]));
 assert.deepEqual(exportWorkspaceJsonBackup(db,w).sqliteSnapshot,before);
 assert.throws(()=>saveErpRecords(db,'unknown',[command(db,'deals',samples.deals)]),/مساحة/);
}));
test('HTTP command boundary enforces access, validates and rejects whole-list replacement',async()=>fixture(async db=>{
 const app=express();app.use(express.json());mountSqliteApi(app);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address() as {port:number};
 const url=`http://127.0.0.1:${addr.port}/api/db/workspace/${w}/erp`;
 try{
  let response=await fetch(url,{method:'PUT',headers:{'content-type':'application/json','x-nasqo-csrf':'1'},body:JSON.stringify({changes:[command(db,'employees',samples.employees)]})});assert.equal(response.status,200);assert.equal((await response.json() as any).erpData.employees.length,1);
  response=await fetch(url,{method:'PUT',headers:{'content-type':'application/json','x-nasqo-csrf':'1'},body:JSON.stringify({employees:[]})});assert.equal(response.status,400);assert.equal(loadErpDataRows(db,w).employees.length,1);
  const status=await new Promise<number>((resolve,reject)=>{const req=http.request(url,{method:'PUT',headers:{'content-type':'application/json','x-nasqo-csrf':'1',host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end(JSON.stringify({changes:[command(db,'employees',{id:'crud-employee'},'delete')]}));});assert([401,403,503].includes(status),`untrusted status ${status}`);assert.equal(loadErpDataRows(db,w).employees.length,1);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
}));

test('master CRUD persists, rejects foreign edits and protects administrative references',async()=>fixture(db=>{
 const group=upsertAccountGroupRow(db,w,{name:'مجموعة اختبار',category:'clients',currencyCode:'ريال'});
 assert.equal(upsertAccountGroupRow(db,w,{...group,name:'مجموعة معدلة'}).name,'مجموعة معدلة');
 const bound=upsertAccountRow(db,w,{name:'تابع',category:'clients',currency:'ريال',groupId:group.id});
 assert.throws(()=>deleteMasterRecord(db,w,'group',group.id),/مرتبط/);deleteAccountRow(db,w,bound.id);deleteMasterRecord(db,w,'group',group.id);
 const wh=upsertWarehouseRow(db,w,{name:'فارغ',isDefault:false});upsertWarehouseRow(db,w,{name:'فارغ معدل',isDefault:false},wh.id);deleteMasterRecord(db,w,'warehouse',wh.id);
 assert.throws(()=>deleteMasterRecord(db,w,'warehouse','crud-wh'),/مرتبط/);
 const box=saveCashboxRecord(db,w,{name:'صندوق اختبار',currencyCode:'ريال',isActive:true});assert(box.accountId);
 assert.equal(saveCashboxRecord(db,w,{id:box.id,name:'صندوق معدل',currencyCode:'ريال',isActive:false}).isActive,false);
 assert.equal(getFullWorkspaceBundle(db,w).cashboxes.find(b=>b.id===box.id)?.name,'صندوق معدل');
 const snapshot=exportWorkspaceJsonBackup(db,w);restoreUnifiedJsonBundle(db,w,snapshot);assert.equal(getFullWorkspaceBundle(db,w).cashboxes.find(b=>b.id===box.id)?.accountId,box.accountId);
 assert.throws(()=>deleteAccountRow(db,w,box.accountId!),/صندوق/);deleteMasterRecord(db,w,'cashbox',box.id);
 assert.throws(()=>upsertWarehouseRow(db,w,{name:'مفقود'},'unknown'),/غير موجود/);
 assert.throws(()=>upsertAccountRow(db,w,{name:'مفقود'},'unknown'),/غير موجود/);
 saveErpRecords(db,w,[command(db,'deals',samples.deals),command(db,'boms',samples.boms)]);
 assert.throws(()=>deleteAccountRow(db,w,'crud-account'),/مرتبط/);assert.throws(()=>deleteInventoryCatalogRow(db,w,'crud-raw'),/مرتبط/);
}));

test('existing ERP posting actions are atomic, repeat safe and protect completed records',async()=>fixture(db=>{
 for(const [c,r] of Object.entries(samples))saveErpRecords(db,w,[command(db,c as ErpCollection,r)]);
 const action=(a:string,c:ErpCollection)=>{const record=erpRows(loadErpDataRows(db,w),c)[0];return executeErpAction(db,w,{action:a,id:record.id,expectedRevision:record._revision});};
 saveErpRecords(db,w,[command(db,'purchaseOrders',{...samples.purchaseOrders,status:'approved'},'update')]);
 const before=exportWorkspaceJsonBackup(db,w).sqliteSnapshot;
 db.exec("CREATE TRIGGER fail_erp_receive BEFORE UPDATE ON erp_purchase_orders BEGIN SELECT RAISE(ABORT,'synthetic ERP failure'); END");
 assert.throws(()=>action('receivePurchaseOrder','purchaseOrders'));assert.deepEqual(exportWorkspaceJsonBackup(db,w).sqliteSnapshot,before);db.exec('DROP TRIGGER fail_erp_receive');
 action('receivePurchaseOrder','purchaseOrders');action('receivePurchaseOrder','purchaseOrders');assert.equal(db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get('crud-raw')?.quantity,2);
 assert.throws(()=>saveErpRecords(db,w,[command(db,'purchaseOrders',{id:'crud-po'},'delete')]),/مرحّل/);
 saveErpRecords(db,w,[command(db,'deals',{...samples.deals,stage:'won'},'update')]);action('convertDeal','deals');action('convertDeal','deals');assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_entries').get()?.n,2);
 db.prepare('UPDATE inventory_items SET quantity=10,avg_cost=4 WHERE id=?').run('crud-raw');
 action('completeProduction','productionOrders');action('completeProduction','productionOrders');assert.equal(db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get('crud-raw')?.quantity,6);assert.equal(db.prepare('SELECT avg_cost FROM inventory_items WHERE id=?').get('crud-finished')?.avg_cost,8);
 const payroll={action:'postPayroll',currency:'ريال',month:new Date().toISOString().slice(0,7)};executeErpAction(db,w,payroll);executeErpAction(db,w,payroll);assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_entries').get()?.n,3);
}));
