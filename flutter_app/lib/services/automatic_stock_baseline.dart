import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'stock_quantity.dart';

/// Source-bound cutover, including zero-cost and negative historical balances.
/// Kept in native backups without replaying archived invoices or transfers.
class AutomaticStockBaseline {
  static const prefix = 'automatic_stock_baseline:';
  static Future<Map<String, Map<String, dynamic>>> read(
          DatabaseExecutor db) async =>
      {
        for (final r in await db.query('erp_state',
            where: 'stateKey GLOB ?', whereArgs: ['$prefix*']))
          (r['stateKey'] as String).substring(prefix.length):
              Map<String, dynamic>.from(
                  jsonDecode(r['payloadJson'] as String) as Map),
      };
  static Future<Map<String, dynamic>?> forItem(
      DatabaseExecutor db, String id) async {
    final rows = await db
        .query('erp_state', where: 'stateKey = ?', whereArgs: ['$prefix$id']);
    return rows.isEmpty
        ? null
        : Map<String, dynamic>.from(
            jsonDecode(rows.single['payloadJson'] as String) as Map);
  }

  static Future<void> validate(DatabaseExecutor db) async {
    final records = await read(db);
    if (records.isEmpty) return;
    final source =
        await db.query('legacy_operational_source', columns: ['sha'], limit: 1);
    for (final e in records.entries) {
      final r = e.value;
      final items = await db
          .query('inventory_items', where: 'id = ?', whereArgs: [e.key]);
      final archived = await db.query('legacy_operational_rows',
          where: 'collection = ? AND record_id = ?',
          whereArgs: ['inventory', r['source_item_id']]);
      final q = StockQuantity.balanceTicks(r['quantity']), v = r['value_minor'];
      final accounts = await db.query('accounts',
          where: 'id IN (?,?) AND currency = ? AND isCashAccount = 0',
          whereArgs: [
            r['inventory_account_id'],
            r['offset_account_id'],
            r['currency']
          ]);
      if (source.length != 1 ||
          r['source_sha'] != source.single['sha'] ||
          r['item_id'] != e.key ||
          items.length != 1 ||
          archived.length != 1 ||
          items.single['warehouseId'] != r['warehouse_id'] ||
          accounts.length != 2 ||
          v is! int ||
          v.abs() > 1000000000000 ||
          (q == 0 && v != 0) ||
          (q * v < 0) ||
          r['entry_date'] is! String ||
          !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(r['entry_date'] as String) ||
          (await db.query('legacy_unverified_stock',
                  where: 'item_id = ?', whereArgs: [e.key]))
              .isNotEmpty) throw StateError('Invalid automatic stock baseline');
      if (v != 0) {
        final legs = await db.query('journal_lines',
            where: 'journal_id = ?', whereArgs: [r['ledger_id']]);
        if (legs.length != 2 ||
            !legs.any((l) =>
                l['account_id'] == r['inventory_account_id'] &&
                l['debit_minor'] == (v > 0 ? v : 0) &&
                l['credit_minor'] == (v < 0 ? -v : 0)) ||
            !legs.any((l) =>
                l['account_id'] == r['offset_account_id'] &&
                l['credit_minor'] == (v > 0 ? v : 0) &&
                l['debit_minor'] == (v < 0 ? -v : 0)))
          throw StateError('Automatic stock opening journal mismatch');
      } else if (r['ledger_id'] != null) {
        throw StateError('Unexpected zero-value opening journal');
      }
    }
  }
}
