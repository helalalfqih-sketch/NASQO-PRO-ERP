import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'stock_quantity_approval_state.dart';

/// A zero-stock catalog card has no warehouse until an explicit first purchase.
/// The marker is native-owned; empty/missing legacy warehouse references alone
/// must never turn historical stock into a verified local card.
class UnassignedCatalog {
  static Future<Map<String, dynamic>> requireClean(Transaction t, String id) async {
    final rows = await t.query('inventory_items', where: 'id = ?', whereArgs: [id]);
    final saved = await t.query('inventory_unit_settings', where: 'item_id = ?', whereArgs: [id]);
    final units = saved.length == 1
        ? jsonDecode(saved.single['settings_json'] as String) as Map<String, dynamic>
        : <String, dynamic>{};
    if (rows.length != 1 || rows.single['warehouseId'] != '' ||
        rows.single['quantity'] != 0 || rows.single['avgCost'] != 0 || units['catalogOnly'] != true) {
      throw StateError('Invalid unassigned catalog card');
    }
    for (final table in ['invoice_lines', 'stock_movements', 'stock_posting_lines', 'legacy_unverified_stock']) {
      if ((await t.query(table, columns: ['item_id'], where: 'item_id = ?', whereArgs: [id], limit: 1)).isNotEmpty) {
        throw StateError('Unassigned catalog card has stock history');
      }
    }
    if ((await t.query('legacy_operational_rows', where: 'collection = ? AND record_id = ?', whereArgs: ['inventory', id], limit: 1)).isNotEmpty ||
        (await t.query('legacy_stock_openings', where: 'item_id = ? OR source_item_id = ?', whereArgs: [id, id], limit: 1)).isNotEmpty ||
        (await StockQuantityApprovalState.read(t)).containsKey(id)) {
      throw StateError('Unassigned catalog card has imported history');
    }
    return units;
  }

  static Future<void> bindFirstPurchase(Transaction t, String id, String warehouse) async {
    final rows = await t.query('inventory_items', where: 'id = ? AND warehouseId = ?', whereArgs: [id, '']);
    if (rows.isEmpty) return;
    final units = await requireClean(t, id);
    final card = rows.single;
    if ((await t.query('inventory_items', columns: ['id'],
        where: 'warehouseId = ? AND id <> ? AND (name = ? OR (sku <> ? AND sku = ?))',
        whereArgs: [warehouse, id, card['name'], '', card['sku']], limit: 1)).isNotEmpty) {
      throw StateError('Duplicate item or barcode in purchase warehouse');
    }
    units.remove('catalogOnly');
    await t.update('inventory_items', {'warehouseId': warehouse}, where: 'id = ?', whereArgs: [id]);
    await t.update('inventory_unit_settings', {'settings_json': jsonEncode(units)}, where: 'item_id = ?', whereArgs: [id]);
    // Both changes share the invoice transaction: any later posting failure
    // rolls back the binding as well as all journal/stock writes.
  }
}
