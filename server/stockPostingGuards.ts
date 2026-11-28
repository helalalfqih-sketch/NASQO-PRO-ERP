import type { DatabaseSync } from 'node:sqlite';
import { SqliteValidationError } from './sqliteDb.ts';

/** Called inside the document transaction, including draft posting/reversals.
 * A location is an accounting identity, not a warehouse label supplied by UI.
 */
export function requireStockPostingLocations(db: DatabaseSync, workspace: string, entryId: string, firstPurchase: boolean) {
  const lines = db.prepare(`
    SELECT il.inventory_item_id AS item_id, il.warehouse_id AS line_warehouse,
           le.warehouse_id AS document_warehouse, le.kind, le.reversed_entry_id, ii.warehouse_id AS item_warehouse,
           ii.id AS found_item, ii.name, ii.quantity, ii.avg_cost, ii.quantity_unverified,
           ii.legacy_ref, ii.bstate, il.unit_num, ii.unit2, ii.unit3, ii.count2, ii.count3
    FROM invoice_lines il
    JOIN ledger_entries le ON le.id=il.entry_id AND le.workspace_id=il.workspace_id
    LEFT JOIN inventory_items ii ON ii.id=il.inventory_item_id AND ii.workspace_id=il.workspace_id
    WHERE il.workspace_id=? AND il.entry_id=? AND il.line_kind='item'
  `).all(workspace, entryId) as Array<Record<string, any>>;
  const bind = new Map<string, string>();
  for (const line of lines) {
    if (!line.found_item) throw new SqliteValidationError('الصنف المرتبط ببند الفاتورة غير موجود في مساحة العمل.');
    if (line.bstate !== 1 && line.kind !== 'return' && !line.reversed_entry_id) throw new SqliteValidationError(`الصنف «${line.name}» غير نشط؛ اختر صنفًا نشطًا.`);
    const warehouse = String(line.line_warehouse || line.document_warehouse || '');
    if (!warehouse || !db.prepare('SELECT 1 FROM warehouses WHERE workspace_id=? AND id=?').get(workspace, warehouse)) {
      throw new SqliteValidationError('اختر مخزنًا موجودًا لترحيل بنود الأصناف.');
    }
    if (line.document_warehouse && line.document_warehouse !== warehouse) {
      throw new SqliteValidationError('مخزن البند لا يطابق مخزن الفاتورة؛ أعد اختيار الصنف من المخزن المحدد.');
    }
    const unit = Number(line.unit_num ?? 1);
    if (unit > 1 && (!String(line.unit2 || '').trim() || !Number.isSafeInteger(line.count2) || line.count2 <= 0) ||
        unit === 3 && (!String(line.unit3 || '').trim() || !Number.isSafeInteger(line.count3) || line.count3 <= 0)) {
      throw new SqliteValidationError(`وحدة الصنف «${line.name}» غير معرّفة؛ اختر وحدة معرفة في بطاقته.`);
    }
    if (line.item_warehouse === warehouse) continue;
    if (line.item_warehouse || !firstPurchase || line.quantity !== 0 || line.avg_cost !== 0 || line.quantity_unverified || line.legacy_ref) {
      throw new SqliteValidationError(`الصنف «${line.name}» لا يخص مخزن الفاتورة؛ اختر رصيده من المخزن المحدد.`);
    }
    const hasHistory = db.prepare(`SELECT 1 FROM invoice_lines il JOIN ledger_entries le ON le.id=il.entry_id
      WHERE il.workspace_id=? AND il.inventory_item_id=? AND il.entry_id<>? AND le.posting_status<>'draft' LIMIT 1`).get(workspace, line.item_id, entryId) ||
      db.prepare('SELECT 1 FROM stock_transfer_lines WHERE workspace_id=? AND inventory_item_id=? LIMIT 1').get(workspace, line.item_id) ||
      db.prepare('SELECT 1 FROM archived_document_lines WHERE workspace_id=? AND inventory_item_id=? LIMIT 1').get(workspace, line.item_id);
    if (hasHistory || bind.has(line.item_id) && bind.get(line.item_id) !== warehouse) {
      throw new SqliteValidationError('لا يمكن إعادة ربط صنف له تاريخ مخزني بمخزن آخر.');
    }
    bind.set(line.item_id, warehouse);
  }
  for (const [id, warehouse] of bind) db.prepare('UPDATE inventory_items SET warehouse_id=? WHERE workspace_id=? AND id=?').run(warehouse, workspace, id);
}
