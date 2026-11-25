import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_quantity_approval.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_opening.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/stock_quantity_approval_state.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('warehouse quantity approval, retry, backup, separate valuation and later sale never replay historical stock',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo_quantity_synthetic_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    final backups=LocalBackupRestore(local),approval=LegacyQuantityApproval(local);
    const w='local-erp-workspace',wh='legacy-wh-1',item='legacy-prod-1';
    try{
      final file=File('${dir.path}/synthetic.back'),src=await databaseFactoryFfi.openDatabase('${dir.path}/synthetic.back');
      for(final sql in [
        'CREATE TABLE currencies(id INTEGER PRIMARY KEY,name TEXT,amount REAL)',
        'CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,type INTEGER,lim REAL)',
        'CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT)',
        'CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER)',
        'CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER)',
        'CREATE TABLE bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,store_id INTEGER,amount REAL,price REAL,total REAL,unitnum INTEGER)',
        'CREATE TABLE store_trans(id INTEGER PRIMARY KEY,store_id1 INTEGER,store_id2 INTEGER,type INTEGER,year INTEGER,month INTEGER,day INTEGER)',
        'CREATE TABLE trans_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,amount REAL,unitnum INTEGER)',
      ]){await src.execute(sql);}
      await src.insert('currencies',{'id':1,'name':'ريال','amount':1});
      await src.insert('customers',{'id':1,'name':'Synthetic','type':1,'lim':0});
      for(var n=1;n<=2;n++){await src.insert('stores',{'id':n,'name':'Warehouse $n'});}
      for(var n=1;n<=4;n++){await src.insert('products',{'id':n,'name':'Synthetic $n','unit':'piece','price':6,'price2':3,'cur':1});}
      for(final d in [(1,1,3,50.125),(2,1,2,10.0),(3,2,3,1.0),(4,2,2,1.0),(5,3,2,1.0)]){
        await src.insert('input_move',{'id':d.$1,'per_id':1,'dain':d.$3==2?d.$4*6:0,'madin':d.$3==3?d.$4*6:0,'cur':1,'bill_type':d.$3,'year':2026,'month':11,'day':8});
        await src.insert('bill_details',{'id':d.$1,'bill_id':d.$1,'prod_id':d.$2,'store_id':1,'amount':d.$4,'price':6,'total':d.$4*6,'unitnum':1});
      }
      for(var n=1;n<=2;n++){
        await src.insert('store_trans',{'id':n,'store_id1':1,'store_id2':n==1?2:999,'type':1,'year':2026,'month':11,'day':9});
        await src.insert('trans_details',{'id':n,'bill_id':n,'prod_id':1,'amount':n==1?5:7,'unitnum':1});
      }
      await src.close();
      final candidate=await backups.inspect(file,'synthetic.back');
      await LegacyOperationalRestore(local).activate(candidate);
      final archived=await db.query('legacy_operational_rows'),ledger=await db.query('ledger_entries');
      Future<Map<String,dynamic>> report(String warehouse,{String? to})async=>LocalInventoryReports.report(db,
        await HybridLocalSnapshotAdapter.readFromDevice(),{'warehouseId':warehouse,if(to!=null)'toDate':to});
      Map<String,dynamic> row(Map<String,dynamic> r,String id)=>(r['itemRows'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
      final review=await approval.preview(wh);
      final rows=(review['rows'] as List).cast<Map<String,dynamic>>();
      expect(rows.firstWhere((r)=>r['sourceItemId']==item)['quantity'],35.125);
      expect(rows.firstWhere((r)=>r['sourceItemId']==item)['transferIncomplete'],true);
      expect(rows.firstWhere((r)=>r['sourceItemId']=='legacy-prod-2')['quantity'],0);
      expect(rows.firstWhere((r)=>r['sourceItemId']=='legacy-prod-3')['reason'],isNotNull);
      expect(rows.firstWhere((r)=>r['sourceItemId']=='legacy-prod-4')['reason'],isNotNull);
      Future<int> submit(Map<String,dynamic> r,List<String> ids,{bool confirmed=true,String? sha})=>approval.approve(
        r['warehouseId'] as String,ids,sourceSha:sha??r['sourceSha'] as String,reviewHash:r['reviewHash'] as String,confirmed:confirmed);
      await expectLater(submit(review,[item],confirmed:false),throwsArgumentError);
      await expectLater(submit(review,[item],sha:'wrong'),throwsStateError);
      await db.insert('erp_state',{'stateKey':'sync_workspace_binding','payloadJson':'another-workspace','updatedAt':'2026-11-25'});
      await expectLater(submit(review,[item]),throwsStateError);
      await db.delete('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding']);
      final beforeInvalid=await backups.exportNative();
      await expectLater(submit(review,[item,'legacy-prod-3']),throwsArgumentError);
      expect(await backups.exportNative(),orderedEquals(beforeInvalid));
      await db.update('inventory_items',{'name':'changed'},where:'id = ?',whereArgs:[item]);
      await expectLater(submit(review,[item]),throwsStateError);
      await db.update('inventory_items',{'name':'Synthetic 1'},where:'id = ?',whereArgs:[item]);
      expect(await submit(review,[item,'legacy-prod-2']),2);
      expect(await submit(review,[item,'legacy-prod-2']),2);
      expect(await db.query('ledger_entries'),ledger);expect(await db.query('legacy_operational_rows'),archived);
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      expect(await db.query('journal_entries'),isEmpty);expect(await db.query('stock_movements'),isEmpty);
      var current=row(await report(wh),item);
      expect(current['availableQty'],35.125);expect(current['quantityUnverified'],false);
      expect(current['costUnverified'],true);expect(current['remainingValue'],0);
      await expectLater(LocalDatabase.requireVerifiedStock(db,item),throwsStateError);
      final second=await approval.preview('legacy-wh-2');
      expect((second['rows'] as List).single['quantity'],5);
      await submit(second,[item]);
      final states=await StockQuantityApprovalState.read(db);
      final secondId=states.entries.firstWhere((e)=>e.value['warehouse_id']=='legacy-wh-2').key;
      expect(row(await report('legacy-wh-2'),secondId)['availableQty'],5);
      expect(row(await report(''),item)['availableQty'],35.125);expect(row(await report(''),secondId)['availableQty'],5);
      await StockQuantityApprovalState.validate(db);
      Future<void> roundtrip()async{
        final bytes=await backups.exportNative(),path=await File('${dir.path}/native.back').writeAsBytes(await backups.exportNative());
        final native=await backups.inspect(path,'native.back'),lease=await backups.replacementBackup();
        await backups.restoreNative(native,replacementSha:sha256.convert(lease!).toString());
        expect(await backups.exportNative(),orderedEquals(bytes));
      }
      await roundtrip();
      expect(row(await report(wh),item)['availableQty'],35.125);
      final accounts=LocalAccountCommands(local);
      final asset=await accounts.save(w,'asset',{'name':'Asset','category':'shop','currency':'ريال'});
      final offset=await accounts.save(w,'offset',{'name':'Offset','category':'shop','currency':'ريال'});
      final revenue=await accounts.save(w,'revenue',{'name':'Revenue','category':'sales','currency':'ريال'});
      final cost=await accounts.save(w,'cost',{'name':'Cost','category':'shop','currency':'ريال'});
      final valuation={'sourceItemId':item,'warehouseId':wh,'quantity':35.125,'totalValue':140.5,
        'inventoryAccountId':asset,'offsetAccountId':offset,'entryDate':review['entryDate'],'evidence':'Synthetic cost review','confirmed':true};
      final opening=LegacyStockOpening(local);
      await expectLater(opening.approve(w,{...valuation,'quantity':36},expectedSourceSha:candidate.sha),throwsStateError);
      await opening.approve(w,valuation,expectedSourceSha:candidate.sha);
      await opening.approve(w,valuation,expectedSourceSha:candidate.sha);
      current=row(await report(wh),item);
      expect(current['availableQty'],35.125);expect(current['costUnverified'],false);expect(current['remainingValue'],140.5);
      expect(await db.query('stock_movements'),isEmpty);expect(await db.query('journal_entries'),hasLength(1));
      expect(await submit(review,[item,'legacy-prod-2']),2);
      expect(row(await report(wh,to:'2026-11-09'),item)['quantityUnverified'],true);
      await StockInvoiceCommands(local).post(w,'sale-after-cost',{'id':'sale-after-cost','kind':'invoice','invoiceContent':'items',
        'payment':'credit','direction':'debit','currency':'ريال','accountId':'legacy-acc-1','counterpartAccountId':revenue,
        'inventoryAccountId':asset,'costAccountId':cost,'warehouseId':wh,'entryNumber':100,'entryDate':review['entryDate'],
        'amount':6.75,'lines':[{'inventoryItemId':item,'warehouseId':wh,'itemName':'Synthetic 1','unit':'piece','unitNum':1,'quantity':1.125,'price':6,'discount':0,'total':6.75}]});
      expect(row(await report(wh),item)['availableQty'],34);expect(row(await report('legacy-wh-2'),secondId)['availableQty'],5);
      await roundtrip();expect(await db.rawQuery('PRAGMA foreign_key_check'),isEmpty);
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
