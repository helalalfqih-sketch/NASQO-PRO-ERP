import 'dart:convert';
import 'stock_quantity.dart';
import 'package:sqflite/sqflite.dart';

/// Quantity approval is independent of the valuation/financial opening.
/// This metadata is included in native backups through erp_state.
class StockQuantityApprovalState {
  static const prefix='stock_quantity_approval:';
  static Future<Map<String,Map<String,dynamic>>> read(DatabaseExecutor db)async => {
    for(final r in await db.query('erp_state',where:'stateKey GLOB ?',whereArgs:['$prefix*']))
      (r['stateKey'] as String).substring(prefix.length):Map<String,dynamic>.from(jsonDecode(r['payloadJson'] as String) as Map),
  };
  static Future<void> validate(DatabaseExecutor db)async{
    final records=await read(db);
    if(records.isEmpty)return;
    final source=await db.query('legacy_operational_source',columns:['sha'],limit:1);
    for(final e in records.entries){
      final r=e.value;
      final items=await db.query('inventory_items',where:'id = ?',whereArgs:[e.key]);
      final archived=await db.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['inventory',r['source_item_id']]);
      final pending=(await db.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[e.key])).isNotEmpty;
      final opening=(await db.query('legacy_stock_openings',where:'item_id = ?',whereArgs:[e.key])).isNotEmpty;
      final quantity=StockQuantity.normalized(r['quantity']);
      if(source.length!=1||source.single['sha']!=r['source_sha']||r['item_id']!=e.key||items.length!=1||archived.length!=1||
          items.single['warehouseId']!=r['warehouse_id']||(!pending&&!opening)||
          (pending&&(items.single['quantity']!=quantity||items.single['avgCost']!=0))||
          r['entry_date'] is! String||!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(r['entry_date'] as String)){
        throw StateError('Invalid quantity approval audit');
      }
    }
  }
}
