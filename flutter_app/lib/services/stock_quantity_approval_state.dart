import 'dart:convert';
import 'automatic_stock_baseline.dart';
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
  /// Read already-validated posting balances in one query for large catalogs.
  /// Posting and backup restore use pending() to verify the entire chain.
  static Future<Map<String,double>> purchaseValues(DatabaseExecutor db)async => {
    for(final r in await db.rawQuery('''SELECT l.item_id,l.after_value FROM stock_posting_lines l
      JOIN (SELECT item_id,MAX(rowid) AS last_row FROM stock_posting_lines GROUP BY item_id) latest ON latest.last_row=l.rowid
      JOIN legacy_unverified_stock u ON u.item_id=l.item_id
      JOIN erp_state a ON a.stateKey=?||l.item_id''',[prefix]))
      r['item_id'] as String:(r['after_value'] as num).toDouble()/100,
  };
  /// Purchases have their own known acquisition value even when the approved
  /// opening quantity has no approved cost. Never average that opening at zero.
  static Future<PendingPurchaseBalance?> pending(DatabaseExecutor db,String id,
      {String? inventoryAccountId,String? entryDate})async {
    if((await db.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[id])).isEmpty)return null;
    final audits=await db.query('erp_state',where:'stateKey = ?',whereArgs:['$prefix$id']);
    if(audits.length!=1)throw StateError('رصيد المخزون غير معتمد للمخزن المحدد.');
    final qa=jsonDecode(audits.single['payloadJson'] as String) as Map;
    final source=await db.query('legacy_operational_source',columns:['sha'],limit:1);
    final items=await db.query('inventory_items',where:'id = ?',whereArgs:[id]);
    if(source.length!=1||qa['source_sha']!=source.single['sha']||items.length!=1||
        qa['item_id']!=id||items.single['warehouseId']!=qa['warehouse_id']||items.single['avgCost']!=0) {
      throw StateError('Invalid pending stock valuation');
    }
    if(entryDate!=null&&entryDate.compareTo(qa['entry_date'] as String)<0)
      throw StateError('Stock posting predates the approved opening count');
    final baseline=StockQuantity.ticks(qa['quantity']);
    var quantity=baseline,value=0;
    String? asset;
    final lines=await db.rawQuery('''SELECT l.*,d.document_json,d.return_original_id,e.entryDate,e.warehouseId,
      e.postingStatus,m.quantity_delta FROM stock_posting_lines l
      JOIN stock_posting_documents d ON d.id=l.document_id
      JOIN ledger_entries e ON e.id=l.document_id
      LEFT JOIN stock_movements m ON m.id=l.id AND m.item_id=l.item_id
      WHERE l.item_id=? ORDER BY l.rowid''',[id]);
    final movements=await db.query('stock_movements',columns:['id'],where:'item_id = ?',whereArgs:[id]);
    if(movements.length!=lines.length)throw StateError('Unexplained pending stock movement');
    for(final l in lines){
      final d=jsonDecode(l['document_json'] as String) as Map;
      final detail=jsonDecode(l['line_json'] as String) as Map;
      final returned=l['return_original_id']!=null;
      final q=StockQuantity.ticks(l['quantity']);
      final cost=detail['cost_minor'];
      asset??=d['inventoryAccountId'] as String?;
      if(d['sale']!=false||asset==null||asset!=d['inventoryAccountId']||cost is! int||cost<0||
          cost!=detail['net_minor']||q==0||l['warehouseId']!=qa['warehouse_id']||
          !['posted','reversed'].contains(l['postingStatus'])||
          (l['entryDate'] as String).compareTo(qa['entry_date'] as String)<0||
          StockQuantity.ticks(l['before_quantity'])!=quantity||l['before_value']!=value||
          l['quantity_delta']!=StockQuantity.units(returned?-q:q)) {
        throw StateError('Invalid pending purchase history');
      }
      quantity+=returned?-q:q;value+=returned?-cost:cost;
      if(quantity<baseline||value<0||value>1000000000000||(quantity==baseline&&value!=0)||
          StockQuantity.ticks(l['after_quantity'])!=quantity||l['after_value']!=value)
        throw StateError('Invalid pending purchase balance');
    }
    if(StockQuantity.ticks(items.single['quantity'])!=quantity)
      throw StateError('Pending purchase quantity mismatch');
    if(asset!=null&&inventoryAccountId!=null&&asset!=inventoryAccountId)
      throw StateError('Select the inventory account used for the pending purchases');
    return PendingPurchaseBalance(baseline,quantity-baseline,value,asset);
  }
  static Future<void> validate(DatabaseExecutor db)async{
    final records=await read(db);
    if(records.isEmpty)return;
    final source=await db.query('legacy_operational_source',columns:['sha'],limit:1);
    for(final e in records.entries){
      final r=e.value;
      final items=await db.query('inventory_items',where:'id = ?',whereArgs:[e.key]);
      final archived=await db.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['inventory',r['source_item_id']]);
      final pending=(await db.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[e.key])).isNotEmpty;
      final opening=(await db.query('legacy_stock_openings',where:'item_id = ?',whereArgs:[e.key])).isNotEmpty||await AutomaticStockBaseline.forItem(db,e.key)!=null;
      StockQuantity.normalized(r['quantity']);
      if(source.length!=1||source.single['sha']!=r['source_sha']||r['item_id']!=e.key||items.length!=1||archived.length!=1||
          items.single['warehouseId']!=r['warehouse_id']||(!pending&&!opening)||
          (pending&&items.single['avgCost']!=0)||
          r['entry_date'] is! String||!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(r['entry_date'] as String)){
        throw StateError('Invalid quantity approval audit');
      }
      if(pending)await StockQuantityApprovalState.pending(db,e.key);
    }
  }
}

class PendingPurchaseBalance {
  const PendingPurchaseBalance(this.openingTicks,this.purchasedTicks,this.valueMinor,this.inventoryAccountId);
  final int openingTicks,purchasedTicks,valueMinor;
  final String? inventoryAccountId;
}
