import {captureWorkspaceSnapshot, restoreWorkspaceSnapshot, snapshotFromTables} from "../server/workspaceSnapshot.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeBusinessSetup, recordRecentAction } from '../server/businessSetup.ts';
import { defaultBusinessProfile, defaultUserPreferences, businessToday } from '../src/utils/businessSetup.ts';
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, getFullWorkspaceBundle, saveWorkspaceSettingsRow, exportWorkspaceJsonBackup, restoreUnifiedJsonBundle, upsertWarehouseRow } from '../server/sqliteDb.ts';
import { deleteMasterRecord } from '../server/masterCrud.ts';

test('atomic setup, retry, rollback, preferences, master guards and backup round trip on isolated SQLite', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-setup-')), db=getSqliteDb(path.join(dir,'test.sqlite')), w='synthetic';
  const input={companyName:'شركة اختبار',currency:'ريال',warehouseName:'مخزن اختبار',cashboxName:'نقدية اختبار',bankName:'بنك اختبار',profile:defaultBusinessProfile(),preferences:defaultUserPreferences()};
  try {
    ensureEmptyWorkspace(db,w);
    const before=JSON.stringify(captureWorkspaceSnapshot(db,w));
    assert.throws(()=>completeBusinessSetup(db,w,{...input,preferences:{...input.preferences,defaultWarehouseId:'foreign'}}));
    assert.equal(JSON.stringify(captureWorkspaceSnapshot(db,w)),before,'partial accounts/boxes/setup must roll back');
    let bundle=completeBusinessSetup(db,w,input);
    assert.equal(bundle.workspace.companyName,input.companyName);
    assert.equal(bundle.warehouses.length,1); assert.equal(bundle.cashboxes.length,2);
    assert(bundle.workspace.businessProfile?.completedAt); assert.equal(bundle.ledger.length,0); assert.equal(bundle.inventory.length,0);
    assert(bundle.accounts.every(a=>a.openingBalance===0));
    assert.equal(bundle.cashboxes.filter(b=>b.boxType===2).length,1);
    const count=()=>Number(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()!.n);
    const audits=count(); completeBusinessSetup(db,w,input); assert.equal(count(),audits);
    assert.throws(()=>completeBusinessSetup(db,w,{...input,companyName:'changed'}));
    const p=bundle.workspace.userPreferences!;
    assert.throws(()=>deleteMasterRecord(db,w,'warehouse',p.defaultWarehouseId));
    assert.throws(()=>saveWorkspaceSettingsRow(db,w,{userPreferences:{...p,defaultCashboxId:99999}}));
    saveWorkspaceSettingsRow(db,w,{userPreferences:{...p,theme:'dark',favoriteActions:['backup']}});
    recordRecentAction(db,w,'sale'); recordRecentAction(db,w,'inventory'); recordRecentAction(db,w,'sale');
    bundle=getFullWorkspaceBundle(db,w);
    assert.deepEqual(bundle.workspace.userPreferences?.recentActions,['sale','inventory']);
    assert.deepEqual(bundle.workspace.userPreferences?.favoriteActions,['backup']);
    const intact=captureWorkspaceSnapshot(db,w), invalid=structuredClone(intact.tables);
    invalid.workspaces[0].user_preferences_json=JSON.stringify({...bundle.workspace.userPreferences,defaultWarehouseId:'outside-backup'});
    assert.throws(()=>restoreWorkspaceSnapshot(db,w,snapshotFromTables(invalid)));
    assert.deepEqual(captureWorkspaceSnapshot(db,w),intact,'invalid restored preferences must not change any row');
    const settings=bundle.workspace;
    const backup=exportWorkspaceJsonBackup(db,w); restoreUnifiedJsonBundle(db,w,backup);
    bundle=getFullWorkspaceBundle(db,w);
    assert.deepEqual(bundle.workspace.businessProfile,settings.businessProfile);
    assert.deepEqual(bundle.workspace.userPreferences,settings.userPreferences);
    assert.equal(bundle.ledger.length,0);
    const portable={...backup} as Record<string,any>;delete portable.sqliteSnapshot;
    restoreUnifiedJsonBundle(db,w,portable);
    const portablyRestored=getFullWorkspaceBundle(db,w);
    assert.deepEqual(portablyRestored.workspace.businessProfile,settings.businessProfile);
    assert.equal(portablyRestored.workspace.userPreferences?.defaultWarehouseId,portablyRestored.warehouses[0].id);
    assert(portablyRestored.cashboxes.some(b=>b.id===portablyRestored.workspace.userPreferences?.defaultCashboxId));
    const portableBefore=captureWorkspaceSnapshot(db,w);
    assert.throws(()=>restoreUnifiedJsonBundle(db,w,{...portable,workspace:{...portable.workspace,userPreferences:{...portable.workspace.userPreferences,defaultWarehouseId:'missing'}}}));
    assert.deepEqual(captureWorkspaceSnapshot(db,w),portableBefore);
    // A different business keeps its explicitly created master rather than resetting it.
    ensureEmptyWorkspace(db,'other'); const existing=upsertWarehouseRow(db,'other',{name:'Existing',details:'keep',isDefault:true});
    const other=completeBusinessSetup(db,'other',{...input,bankName:''});
    assert.equal(other.warehouses.length,1); assert.equal(other.warehouses[0].id,existing.id); assert.equal(other.warehouses[0].name,'Existing');
  } finally {closeSqliteDb();fs.rmSync(dir,{recursive:true,force:true});}
});
test('invoice date follows configured timezone at the UTC day boundary',()=>{
  const instant=new Date('2026-11-28T23:30:00Z');
  assert.equal(businessToday('Asia/Aden',instant),'2026-11-29');
  assert.equal(businessToday('America/New_York',instant),'2026-11-28');
});
