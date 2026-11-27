import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import '../hybrid/local_snapshot_adapter.dart';
import 'local_database.dart';
import 'local_inventory_reports.dart';
import 'stock_quantity.dart';
import 'stock_invoice_commands.dart';
import 'stock_quantity_approval_state.dart';

/// Explicitly freezes the reviewed, all-time warehouse quantity as a baseline.
/// No source movement, financial entry or inventory valuation is replayed.
class LegacyQuantityApproval {
  LegacyQuantityApproval(this.local);
  final LocalDatabase local;
  static String digest(Object v)=>sha256.convert(utf8.encode(jsonEncode(v))).toString();

  Future<Map<String,dynamic>> preview(String warehouse)async {
    final db=await local.database;
    return db.transaction((t)=>_preview(t,warehouse));
  }

  Future<Map<String,dynamic>> _preview(Transaction t,String warehouse)async {
    await LocalDatabase.requireLiveWorkspace(t);
    await StockInvoiceCommands.workspace(t,'local-erp-workspace');
    final source=await t.query('legacy_operational_source',columns:['sha'],limit:1);
    final wh=await t.query('warehouses',where:'id = ?',whereArgs:[warehouse]);
    if(source.length!=1||wh.length!=1)throw StateError('اختر مخزنًا من النسخة المستوردة الحالية.');
    final snapshot=await HybridLocalSnapshotAdapter.readInTransaction(t,local);
    final items={for(final p in (snapshot['inventory'] as List).cast<Map<String,dynamic>>())p['id']:p};
    final report=await LocalInventoryReports.report(t,snapshot,{'warehouseId':warehouse});
    final rows=<Map<String,dynamic>>[];
    for(final row in (report['itemRows'] as List).cast<Map<String,dynamic>>()){
      final p=items[row['id']]!;
      // Each source/warehouse can be approved only once. Never use a period-
      // filtered quantity, assumed zero, or an already operational balance.
      if(row['quantityUnverified']!=true||p['legacySourceItemId']!=null&&p['warehouseId']==warehouse)continue;
      final q=row['availableQty'];
      String? reason;
      if(row['hasMovement']!=true)reason='لا توجد كمية محفوظة قابلة للمراجعة لهذا المخزن';
      try{StockQuantity.ticks(q);}catch(_){reason='كمية سالبة أو خارج الدقة المدعومة';}
      rows.add({'sourceItemId':p['id'],'warehouseId':warehouse,'name':p['name'],'unit':p['unit'],
        'quantity':q,'reason':reason,'transferIncomplete':p['legacyTransferIncomplete']==true});
    }
    rows.sort((a,b)=>a['sourceItemId'].toString().compareTo(b['sourceItemId'].toString()));
    final latest=(await t.rawQuery('SELECT MAX(entryDate) AS d FROM ledger_entries')).single['d']?.toString()??'';
    final today=DateTime.now().toIso8601String().substring(0,10);
    final value=<String,dynamic>{'sourceSha':source.single['sha'],'warehouseId':warehouse,
      'warehouseName':wh.single['name'],'entryDate':latest.compareTo(today)>0?latest:today,'rows':rows};
    return {...value,'reviewHash':digest(value)};
  }

  Future<int> approve(String warehouse,List<String> selected,{required String sourceSha,
      required String reviewHash,required bool confirmed})async {
    if(!confirmed||selected.isEmpty||selected.length>10000||selected.toSet().length!=selected.length){
      throw ArgumentError('تأكيد ومراجعة الكميات مطلوبان.');
    }
    final ids=[...selected]..sort();
    final request={'warehouseId':warehouse,'sourceSha':sourceSha,'reviewHash':reviewHash,'selected':ids};
    final key='quantity-approval-${digest(request)}';
    final db=await local.database;
    return db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      await StockInvoiceCommands.workspace(t,'local-erp-workspace');
      final source=await t.query('legacy_operational_source',columns:['sha'],limit:1);
      if(source.length!=1||source.single['sha']!=sourceSha)throw StateError('تغيرت النسخة؛ أعد مراجعة الكميات.');
      final result=await local.commitOperationInTransaction(t,workspaceId:'local-erp-workspace',
        operationId:key,operationType:'legacy.stock.quantityApproval',payload:request,apply:(txn)async{
          final review=await _preview(txn,warehouse);
          if(review['reviewHash']!=reviewHash)throw StateError('تغيرت الكميات أو حالة الاعتماد؛ أعد المراجعة.');
          final rows={for(final r in (review['rows'] as List).cast<Map<String,dynamic>>())r['sourceItemId']:r};
          for(final id in ids){
            final row=rows[id];
            if(row==null||row['reason']!=null)throw ArgumentError('الصنف غير قابل لاعتماد الكمية الحالية.');
            final master=(await txn.query('inventory_items',where:'id = ?',whereArgs:[id])).single;
            final locationDigest=sha256.convert(utf8.encode('$id|$warehouse')).toString();
            final item=master['warehouseId']==warehouse?id:'legacy-location-$locationDigest';
            final existing=await txn.query('inventory_items',where:'id = ?',whereArgs:[item]);
            if(item==id){
              if(master['quantity']!=0||master['avgCost']!=0||
                  (await txn.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[id])).length!=1||
                  (await txn.query('stock_movements',where:'item_id = ?',whereArgs:[id],limit:1)).isNotEmpty){
                throw StateError('الصنف يحتوي رصيدًا تشغيليًا؛ أعد المراجعة.');
              }
              await txn.update('inventory_items',{'quantity':row['quantity']},where:'id = ?',whereArgs:[id]);
            }else{
              if(existing.isNotEmpty)throw StateError('يوجد رصيد معتمد لهذا الصنف والمخزن.');
              await txn.insert('inventory_items',{...master,'id':item,'warehouseId':warehouse,'quantity':row['quantity'],'avgCost':0});
              await txn.insert('legacy_unverified_stock',{'item_id':item});
              final units=await txn.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[id]);
              if(units.isNotEmpty)await txn.insert('inventory_unit_settings',{'item_id':item,'settings_json':units.single['settings_json']});
            }
            await txn.insert('erp_state',{'stateKey':'${StockQuantityApprovalState.prefix}$item',
              'payloadJson':jsonEncode({'source_item_id':id,'warehouse_id':warehouse,'item_id':item,
                'quantity':StockQuantity.normalized(row['quantity']),'entry_date':review['entryDate'],
                'source_sha':sourceSha,'review_hash':reviewHash,'operation_id':key}),
              'updatedAt':DateTime.now().toUtc().toIso8601String()});
          }
          return {'count':ids.length};
        });
      return result['count'] as int;
    });
  }
}
