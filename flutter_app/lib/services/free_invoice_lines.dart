import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'stock_quantity.dart';

/// Descriptive invoice lines. They never identify stock or produce movements.
/// Stored in existing backup-covered tables, in the posting transaction.
class FreeInvoiceLines {
  static const prefix = 'free_invoice_lines:';
  static int money(Object? v) {
    if (v is! num || !v.isFinite || v < 0 || v > 10000000000 ||
        (v * 100 - (v * 100).round()).abs() > 0.00001) {
      throw ArgumentError('Invalid free line money');
    }
    return (v * 100).round();
  }

  static List<Map<String, dynamic>> normalize(Object? raw, int amount) {
    if (raw == null) return [];
    if (raw is! List || raw.length > 150) throw ArgumentError('Invalid free lines');
    final result = <Map<String, dynamic>>[];
    var sum = 0;
    for (final v in raw) {
      if (v is! Map<String, dynamic> ||
          (v['inventoryItemId'] != null && v['inventoryItemId'] != '') ||
          (v['warehouseId'] != null && v['warehouseId'] != '') ||
          (v['lineKind'] != null && v['lineKind'] != 'free') ||
          (v['unitNum'] ?? 1) != 1 || (v['discount'] ?? 0) != 0 ||
          (v['bonus'] ?? 0) != 0) {
        throw ArgumentError('Free line cannot reference stock');
      }
      final name = v['itemName'], unit = v['unit'] ?? 'حبة';
      if (name is! String || name.trim().isEmpty || name.length > 200 ||
          unit is! String || unit.trim().isEmpty || unit.length > 40) {
        throw ArgumentError('Invalid free line description');
      }
      final qty = StockQuantity.ticks(v['quantity']), price = money(v['price']);
      final total = StockQuantity.lineGrossMinor(qty, price);
      if (qty <= 0 || total != money(v['total'])) throw ArgumentError('Free line total mismatch');
      sum += total;
      result.add({'id':result.length + 1, 'lineKind':'free', 'itemName':name.trim(),
        'unit':unit.trim(), 'unitNum':1, 'quantity':StockQuantity.units(qty),
        'price':price / 100, 'total':total / 100, 'discount':0, 'bonus':0,
        'sku':'', 'warehouseName':'', 'details':'', 'expiryDate':''});
    }
    if (result.isNotEmpty && sum != amount) throw ArgumentError('Free invoice total mismatch');
    return result;
  }

  static Future<void> store(Transaction t, String id, List<Map<String,dynamic>> lines) async {
    if (lines.isEmpty) return;
    for (var i = 0; i < lines.length; i++) {
      final l = lines[i];
      await t.insert('invoice_lines', {'id':'$id:$i', 'ledger_id':id, 'item_id':null,
        'quantity':l['quantity'], 'unit_price_minor':money(l['price'])});
    }
    await t.insert('erp_state', {'stateKey':'$prefix$id', 'payloadJson':jsonEncode(lines),
      'updatedAt':DateTime.now().toUtc().toIso8601String()});
  }

  static Future<List<Map<String,dynamic>>> read(DatabaseExecutor db, String id) async {
    final rows = await db.query('erp_state', where:'stateKey = ?', whereArgs:['$prefix$id']);
    if (rows.isEmpty) return [];
    return (jsonDecode(rows.single['payloadJson'] as String) as List)
        .map((v) => Map<String,dynamic>.from(v as Map)).toList();
  }
}
