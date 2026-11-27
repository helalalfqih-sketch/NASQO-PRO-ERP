import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'automatic_stock_baseline.dart';
import 'stock_quantity_approval_state.dart';
import 'unassigned_catalog.dart';

/// A first receipt in another warehouse creates a zero opening there. It never
/// moves an existing warehouse's quantity or guesses identity from names/SKUs.
class InventoryLocations {
  static const prefix = 'inventory_location:';
  static Future<Map<String, dynamic>?> link(
      DatabaseExecutor db, String id) async {
    final rows = await db
        .query('erp_state', where: 'stateKey = ?', whereArgs: ['$prefix$id']);
    return rows.isEmpty
        ? null
        : Map<String, dynamic>.from(
            jsonDecode(rows.single['payloadJson'] as String) as Map);
  }

  static Future<String> purchase(
      Transaction t, String id, String warehouse) async {
    await UnassignedCatalog.bindFirstPurchase(t, id, warehouse);
    final rows =
        await t.query('inventory_items', where: 'id = ?', whereArgs: [id]);
    if (rows.length != 1) throw StateError('Stock item missing');
    final row = rows.single;
    if (row['warehouseId'] == warehouse) return id;
    await LocalDatabase.requireVerifiedStock(t, id);
    final baseline = await AutomaticStockBaseline.forItem(t, id);
    final prior = await link(t, id);
    final counted = (await StockQuantityApprovalState.read(t))[id];
    final old = await t
        .query('legacy_stock_openings', where: 'item_id = ?', whereArgs: [id]);
    final source = (prior?['source_item_id'] ??
        baseline?['source_item_id'] ??
        counted?['source_item_id'] ??
        (old.isEmpty ? null : old.single['source_item_id']) ??
        id) as String;
    final master =
        (await t.query('inventory_items', where: 'id = ?', whereArgs: [source]))
            .single;
    if (master['warehouseId'] == warehouse) return source;
    final digest = sha256.convert(utf8.encode('$source|$warehouse')).toString();
    final location = 'legacy-location-$digest';
    final existing = await t
        .query('inventory_items', where: 'id = ?', whereArgs: [location]);
    if (existing.isNotEmpty) {
      if (existing.single['warehouseId'] != warehouse)
        throw StateError('Warehouse identity mismatch');
      return location;
    }
    await t.insert('inventory_items', {
      ...row,
      'id': location,
      'warehouseId': warehouse,
      'quantity': 0,
      'avgCost': 0
    });
    final units = await t.query('inventory_unit_settings',
        where: 'item_id = ?', whereArgs: [id]);
    if (units.isNotEmpty)
      await t.insert('inventory_unit_settings', {
        'item_id': location,
        'settings_json': units.single['settings_json']
      });
    await t.insert('erp_state', {
      'stateKey': '$prefix$location',
      'payloadJson': jsonEncode({
        'source_item_id': source,
        'warehouse_id': warehouse,
        'item_id': location
      }),
      'updatedAt': DateTime.now().toUtc().toIso8601String()
    });
    return location;
  }

  static Future<void> attach(
      DatabaseExecutor t, Map<String, dynamic> data) async {
    final items = {
      for (final i in (data['inventory'] as List).cast<Map<String, dynamic>>())
        i['id']: i
    };
    for (final r in await t.query('erp_state',
        where: 'stateKey GLOB ?', whereArgs: ['$prefix*'])) {
      final meta = jsonDecode(r['payloadJson'] as String) as Map;
      final item = items[meta['item_id']],
          source = items[meta['source_item_id']];
      if (item == null ||
          source == null ||
          item['warehouseId'] != meta['warehouse_id'])
        throw StateError('Invalid warehouse stock link');
      item['catalogSourceItemId'] = meta['source_item_id'];
      for (final k in [
        'legacyId',
        'currencyCode',
        'isActive',
        'expiryDate',
        'legacyRef'
      ]) {
        if (source[k] != null) item[k] = source[k];
      }
    }
  }
}
