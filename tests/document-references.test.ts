import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {eligibleCashbox,emptyReferenceDefaults,resolveCashbox,validateReferenceDefaultsShape} from '../src/utils/documentReferences.ts';
import type {CashboxRecord} from '../src/types.ts';
import {getSqliteDb,closeSqliteDb,ensureStarterWorkspace,getFullWorkspaceBundle,saveWorkspaceSettingsRow,exportWorkspaceJsonBackup,restoreUnifiedJsonBundle} from '../server/sqliteDb.ts';
const boxes=[1,2,3,4].map(id=>({id,currencyCode:'ريال',state:1,isActive:true})) as CashboxRecord[];
const account={id:'a',groupId:7,currency:'ريال'};
const defaults={...emptyReferenceDefaults(),systemCashboxes:{'ريال':1},groupCashboxes:{'7':2},accountCashboxes:{a:3}};
test('account then group then cashier then system, never arbitrary or incompatible box',()=>{
 assert.equal(resolveCashbox(defaults,boxes,'ريال',account,4),3);
 assert.equal(resolveCashbox({...defaults,accountCashboxes:{}},boxes,'ريال',account,4),2);
 assert.equal(resolveCashbox({...defaults,accountCashboxes:{},groupCashboxes:{}},boxes,'ريال',account,4),4);
 assert.equal(resolveCashbox(defaults,boxes,'ريال',undefined),1);
 assert.equal(resolveCashbox(undefined,boxes,'ريال',account),undefined);
 assert.equal(resolveCashbox(defaults,boxes,'دولار',account),undefined);
 assert.equal(resolveCashbox(defaults,boxes.map(b=>({...b,state:0})), 'ريال',account),undefined);
 assert.equal(resolveCashbox(defaults,boxes.filter(b=>b.id!==3), 'ريال',account),2);
 assert.equal(eligibleCashbox(boxes,undefined,'ريال'),undefined);
 assert.equal(eligibleCashbox(boxes,4,'ريال'),4);
 assert.equal(eligibleCashbox(boxes,4,'دولار'),undefined);
 assert.throws(()=>validateReferenceDefaultsShape({...defaults,accountCashboxes:{a:0}}));
});
test('workspace SQLite settings reject foreign references atomically; backup remaps all IDs without ledger or stock writes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-references-'));const db=getSqliteDb(path.join(dir,'test.db')),w='synthetic';
 try{
 ensureStarterWorkspace(db,w,'Synthetic');const b=getFullWorkspaceBundle(db,w),a=b.accounts.find(a=>a.currency==='ريال'&&!a.isCashAccount)!,box=b.cashboxes.find(b=>b.currencyCode==='ريال')!;
 const g=b.accountGroups.find(g=>g.currencyCode==='ريال')!;
 const r={...emptyReferenceDefaults(),warehouseId:b.warehouses[0].id,accountId:a.id,systemCashboxes:{'ريال':box.id},accountCashboxes:{[a.id]:box.id},groupCashboxes:{[g.id]:box.id}};
 const financial=()=>JSON.stringify(db.prepare('SELECT * FROM ledger_entries WHERE workspace_id = ?').all(w));
 const before=financial();saveWorkspaceSettingsRow(db,w,{referenceDefaults:r});assert.deepEqual(getFullWorkspaceBundle(db,w).workspace.referenceDefaults,r);assert.equal(financial(),before);
 const stable=()=>JSON.stringify(["workspaces","accounts","cashboxes","inventory_items","ledger_entries","account_groups","warehouses"].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
 const saved=stable();
 for(const patch of [{warehouseId:'foreign'},{accountId:'foreign'},{accountCashboxes:{foreign:box.id}},{groupCashboxes:{'99999':box.id}},{systemCashboxes:{'دولار':box.id}}]){
 assert.throws(()=>saveWorkspaceSettingsRow(db,w,{companyName:'Rejected',referenceDefaults:{...r,...patch}}));assert.equal(stable(),saved);
 }
 const backup=exportWorkspaceJsonBackup(db,w);restoreUnifiedJsonBundle(db,w,backup);const restored=getFullWorkspaceBundle(db,w),rr=restored.workspace.referenceDefaults!;
 assert(restored.accounts.some(a=>a.id===rr.accountId));assert(restored.warehouses.some(a=>a.id===rr.warehouseId));
 assert(restored.cashboxes.some(b=>b.id===rr.systemCashboxes['ريال']));assert.equal(rr.accountCashboxes[rr.accountId],rr.systemCashboxes['ريال']);
 assert(restored.accountGroups.some(g=>rr.groupCashboxes[String(g.id)]===rr.systemCashboxes['ريال']));
 assert.equal(restored.ledger.length,b.ledger.length);assert.deepEqual(restored.inventory.map(i=>[i.quantity,i.avgCost]),b.inventory.map(i=>[i.quantity,i.avgCost]));
 saveWorkspaceSettingsRow(db,w,{companyName:'Renamed'});assert.deepEqual(getFullWorkspaceBundle(db,w).workspace.referenceDefaults,rr);
 }finally{closeSqliteDb();fs.rmSync(dir,{recursive:true,force:true});}
});
