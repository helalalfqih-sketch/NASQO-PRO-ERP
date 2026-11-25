import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getSqliteDb,closeSqliteDb,ensureStarterWorkspace,getFullWorkspaceBundle,saveWorkspaceSettingsRow,exportWorkspaceJsonBackup,restoreUnifiedJsonBundle} from '../server/sqliteDb.ts';
test('cashier settings persist, reject foreign references and restore mapped shortcuts without posting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-cashier-web-'));const db=getSqliteDb(path.join(dir,'test.db'));const w='synthetic';
 try{
  ensureStarterWorkspace(db,w,'Synthetic');const bundle=getFullWorkspaceBundle(db,w);const currency='ريال';
  const prefs={warehouseId:bundle.warehouses[0].id,accountId:bundle.accounts.find(a=>a.currency===currency&&!a.isCashAccount)!.id,cashboxId:bundle.cashboxes.find(b=>b.currencyCode===currency)!.id,currency,quickItemIds:[bundle.inventory[0].id]};
  const before=JSON.stringify([bundle.accounts,bundle.inventory,bundle.ledger]);
  saveWorkspaceSettingsRow(db,w,{cashierSettings:prefs});assert.deepEqual(getFullWorkspaceBundle(db,w).workspace.cashierSettings,prefs);
  assert.throws(()=>saveWorkspaceSettingsRow(db,w,{cashierSettings:{...prefs,accountId:'foreign'}}));
  const backup=exportWorkspaceJsonBackup(db,w);restoreUnifiedJsonBundle(db,w,backup);const restored=getFullWorkspaceBundle(db,w);const c=restored.workspace.cashierSettings!;
  assert.equal(c.quickItemIds.length,1);assert(restored.inventory.some(i=>i.id===c.quickItemIds[0]));assert(restored.cashboxes.some(b=>b.id===c.cashboxId));
  const stable=JSON.stringify([restored.accounts,restored.inventory,restored.ledger]);saveWorkspaceSettingsRow(db,w,{cashierSettings:{...c,quickItemIds:[]}});
  const after=getFullWorkspaceBundle(db,w);assert.equal(JSON.stringify([after.accounts,after.inventory,after.ledger]),stable);assert(before.length>0);
 }finally{closeSqliteDb();fs.rmSync(dir,{recursive:true,force:true});}
});
