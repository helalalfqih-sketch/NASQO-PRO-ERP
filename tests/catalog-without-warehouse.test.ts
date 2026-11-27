import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSqliteDb, closeSqliteDb, ensureEmptyWorkspace, insertInventoryItemRow, upsertWarehouseRow, DEFAULT_WORKSPACE_ID } from '../server/sqliteDb.ts';

test('web catalog zero-stock cards never select a warehouse implicitly',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nasqo-card-'));
 try {
  const db=getSqliteDb(path.join(dir,'test.sqlite'));ensureEmptyWorkspace(db,DEFAULT_WORKSPACE_ID);
  const first=insertInventoryItemRow(db,DEFAULT_WORKSPACE_ID,{name:'بطاقة اصطناعية',quantity:0,avgCost:0});
  assert(!first.warehouseId);assert.equal(first.quantity,0);
  upsertWarehouseRow(db,DEFAULT_WORKSPACE_ID,{name:'مخزن افتراضي اصطناعي',isDefault:true});
  const second=insertInventoryItemRow(db,DEFAULT_WORKSPACE_ID,{name:'بطاقة أخرى',quantity:0,avgCost:0});
  assert(!second.warehouseId);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get() as any).n,0);
 }finally{closeSqliteDb();fs.rmSync(dir,{recursive:true,force:true});}
});
