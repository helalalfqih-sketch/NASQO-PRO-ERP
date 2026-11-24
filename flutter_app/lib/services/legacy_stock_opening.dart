import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'stock_invoice_commands.dart';
import 'stock_quantity.dart';
import 'local_document_commands.dart';
import 'local_backup_restore.dart';
import 'legacy_stock_projection.dart';
import 'legacy_history_reports.dart';
import 'legacy_history_archive.dart';

/// One-time opening count per imported product and warehouse. Opening stock
/// is NOT calculated from historical movements. The operator must substantiate
/// physical count, total cost and the opening/adjustment accounting treatment.
class LegacyStockOpening {
  LegacyStockOpening(this.local);
  final LocalDatabase local;

  Future<Map<String,dynamic>> load() async {
    final db=await local.database;
    final data=await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      if(!await LocalDatabase.hasLegacyOperational(t))throw StateError('Imported workspace required');
      final source=(await t.query('legacy_operational_source',columns:['sha'],limit:1)).single['sha'] as String;
      final items=(await t.query('legacy_operational_rows',where:'collection = ?',whereArgs:['inventory']))
        .map((r)=>LocalBackupRestore.object(jsonDecode(r['row_json'] as String))).toList()
        ..sort((a,b)=>a['name'].toString().compareTo(b['name'].toString()));
      final ledger=(await t.query('legacy_operational_rows',where:'collection = ?',whereArgs:['ledger']))
        .map((r)=>LocalBackupRestore.object(jsonDecode(r['row_json'] as String)));
      LegacyStockProjection.attach(items,ledger);
      return {
        'products':items,'sourceSha':source,
        'warehouses':await t.query('warehouses',orderBy:'name'),
        'accounts':await t.query('accounts',where:'currency = ? AND isCashAccount = 0',whereArgs:['sar'],orderBy:'name'),
        'openings':await t.query('legacy_stock_openings'),
      };
    });
    final extra=await LegacyHistoryArchive(local).load();
    final products=(data['products'] as List).cast<Map<String,dynamic>>();
    final warehouses=(data['warehouses'] as List).map((r)=>Map<String,dynamic>.from(r as Map));
    final report=LegacyHistoryReports.transfers(products,warehouses,extra['source_store_trans']!,extra['source_trans_details']!);
    final nets=report['netByItem'] as Map;
    final affected=report['affectedItemIds'] as List;
    for(final p in products){
      p['legacyTransferNetByWarehouse']=nets[p['id']]??<String,num>{};
      p['legacyTransferIncomplete']=affected.contains(p['id']);
    }
    final source=await db.query('legacy_operational_source',columns:['sha'],limit:1);
    if(source.length!=1||source.single['sha']!=data['sourceSha'])throw StateError('Imported workspace changed');
    return {...data,'unresolvedTransfers':report['unresolvedIds']};
  }

  static Future<void> requireSource(Transaction t,String? sha)async{
    if(sha==null)return; // compatibility for existing internal callers
    final source=await t.query('legacy_operational_source',columns:['sha'],limit:1);
    if(source.length!=1||source.single['sha']!=sha)throw StateError('تغيرت النسخة المستوردة؛ أعد تحميل مسودة الجرد');
  }

  Future<String> approve(String workspace,Map<String,dynamic> input,{String? expectedSourceSha})async{
    final db=await local.database;
    return db.transaction((t)async{
      await requireSource(t,expectedSourceSha);
      return _approve(t,workspace,input);
    });
  }

  /// Every row uses the existing individual opening idempotency key and
  /// balanced posting rules. A failure rolls back every row in the batch.
  Future<List<String>> approveBatch(String workspace,List<Map<String,dynamic>> inputs,{String? expectedSourceSha})async{
    if(workspace!='local-erp-workspace'||inputs.isEmpty||inputs.length>10000)
      throw ArgumentError('Invalid stock count batch');
    final seen=<String>{};
    for(final row in inputs){
      final source=StockInvoiceCommands.identity(row['sourceItemId']);
      final warehouse=StockInvoiceCommands.identity(row['warehouseId']);
      if(!seen.add('$source|$warehouse'))throw ArgumentError('Duplicate product and warehouse in batch');
    }
    final db=await local.database;
    return db.transaction((t)async{
      await requireSource(t,expectedSourceSha);
      final ids=<String>[];
      for(final row in inputs){ids.add(await _approve(t,workspace,row));}
      return ids;
    });
  }

  Future<String> _approve(Transaction txn,String workspace,Map<String,dynamic> input)async{
    final source=StockInvoiceCommands.identity(input['sourceItemId']);
    final wh=StockInvoiceCommands.identity(input['warehouseId']);
    final asset=StockInvoiceCommands.identity(input['inventoryAccountId']);
    final offset=StockInvoiceCommands.identity(input['offsetAccountId']);
    final quantity=StockQuantity.normalized(input['quantity']);
    final value=StockInvoiceCommands.money(input['totalValue']);
    final date=StockInvoiceCommands.date(input);
    final evidence=LocalDocumentCommands.field(input,'evidence',300).trim();
    if(input['confirmed']!=true||evidence.isEmpty||asset==offset||
      (quantity==0&&value!=0)||(quantity>0&&value<=0)){
      throw ArgumentError('Approve counted quantity, total valuation and distinct accounting roles');
    }
    final digest=sha256.convert(utf8.encode('$source|$wh')).toString();
    final key='legacy-opening-$digest';
    final request=<String,dynamic>{'sourceItemId':source,'warehouseId':wh,'quantity':quantity,'valueMinor':value,
      'inventoryAccountId':asset,'offsetAccountId':offset,'entryDate':date,'evidence':evidence};
    final result=await local.commitOperationInTransaction(txn,workspaceId:workspace,operationId:key,operationType:'legacy.stock.opening',
      payload:request,apply:(t)async{
        await StockInvoiceCommands.workspace(t,workspace);
        if(!await LocalDatabase.hasLegacyOperational(t))throw StateError('Imported workspace required');
        if((await t.query('legacy_stock_openings',where:'source_item_id = ? AND warehouse_id = ?',whereArgs:[source,wh])).isNotEmpty)
          throw StateError('This product and warehouse have already been counted');
        final archive=await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['inventory',source]);
        final master=await t.query('inventory_items',where:'id = ?',whereArgs:[source]);
        final stores=await t.query('warehouses',where:'id = ?',whereArgs:[wh]);
        if(archive.length!=1||master.length!=1||stores.length!=1)throw StateError('Imported product or warehouse missing');
        final historical=LocalBackupRestore.object(jsonDecode(archive.single['row_json'] as String));
        if(historical['currencyCode']!='ريال')throw StateError('Only base-currency imported stock can be approved');
        final a=await StockInvoiceCommands.account(t,asset,'sar');
        final b=await StockInvoiceCommands.account(t,offset,'sar');
        final latest=(await t.rawQuery('SELECT MAX(entryDate) AS last_date FROM ledger_entries')).single['last_date'];
        if(latest is String&&latest.isNotEmpty&&date.compareTo(latest)<0)
          throw StateError('Opening date must not precede the most recent document');
        final item=master.single['warehouseId']==wh?source:'legacy-location-$digest';
        final existing=await t.query('inventory_items',where:'id = ?',whereArgs:[item]);
        if(item==source){
          if(existing.length!=1||existing.single['quantity']!=0||existing.single['avgCost']!=0||
            (await t.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[item])).length!=1||
            (await t.query('stock_movements',where:'item_id = ?',whereArgs:[item],limit:1)).isNotEmpty){
            throw StateError('Source stock already contains operational history');
          }
        }else if(existing.isNotEmpty){throw StateError('Warehouse stock identity already exists');}
        final avg=quantity==0?0.0:value/quantity/100;
        if(item==source){
          await t.update('inventory_items',{'quantity':quantity,'avgCost':avg},where:'id = ?',whereArgs:[item]);
          await t.delete('legacy_unverified_stock',where:'item_id = ?',whereArgs:[item]);
        }else{
          await t.insert('inventory_items',{...master.single,'id':item,'warehouseId':wh,'quantity':quantity,'avgCost':avg});
          final units=await t.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[source]);
          if(units.isNotEmpty)await t.insert('inventory_unit_settings',{'item_id':item,'settings_json':units.single['settings_json']});
        }
        String? ledger;
        if(value>0){
          ledger=key;
          final max=(await t.rawQuery('SELECT COALESCE(MAX(entryNumber),0) AS n FROM ledger_entries')).single['n'] as int;
          final number=StockInvoiceCommands.number(max+1);
          await t.insert('ledger_entries',{'id':ledger,'accountId':asset,'accountName':a['name'],
            'counterpartAccountId':offset,'counterpartAccountName':b['name'],'kind':'opening',
            'typeLabel':'افتتاح مخزون معتمد','payment':'balance','direction':'debit','amount':value/100,
            'currency':'sar','exchangeRate':1,'details':evidence,'documentNumber':'',
            'warehouseId':wh,'warehouseName':stores.single['name'],'expenseCategory':'',
            'entryNumber':number,'deleted':0,'entryDate':date,'invoiceContent':'none','postingStatus':'posted'});
          await StockInvoiceCommands.journal(t,ledger,'sar',[StockInvoiceCommands.leg(asset,value,true),StockInvoiceCommands.leg(offset,value,false)]);
          await t.insert('stock_movements',{'id':ledger,'item_id':item,'quantity_delta':quantity,'operation_id':key});
        }
        await t.insert('legacy_stock_openings',{'source_item_id':source,'warehouse_id':wh,'item_id':item,
          'quantity':quantity,'value_minor':value,'inventory_account_id':asset,'offset_account_id':offset,
          'ledger_id':ledger,'operation_id':key,'entry_date':date,'evidence':evidence});
        return {'id':item};
      });
    return result['id'] as String;
  }
}
