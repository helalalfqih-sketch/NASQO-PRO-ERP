import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_opening.dart';
import 'package:nasqo_pro_erp/services/legacy_history_archive.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('unified JSON restores core records, explicit journal and stock evidence without replay',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-unified-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    final backup=LocalBackupRestore(local),restore=LegacyOperationalRestore(local);
    const workspace='local-erp-workspace';
    try{
      Map<String,dynamic> account(String id,int code)=>{'id':id,'name':id,'category':'shop','currency':'ريال',
        'codeNumber':code,'openingBalance':id=='client'?5:0,'openingDirection':'debit','isCashAccount':false};
      Map<String,dynamic> item(String id,bool verified)=>{'id':id,'name':id,'unit':'kg','warehouseId':'wh-a',
        'quantity':verified?7.5:999,'avgCost':2,'currencyCode':'ريال','quantityUnverified':!verified};
      Map<String,dynamic> entry(String id,int no,String kind,String direction,num amount)=>{'id':id,'accountId':'client',
        'accountName':'client','counterpartAccountId':'','kind':kind,'payment':'credit','direction':direction,
        'amount':amount,'currency':'ريال','exchangeRate':1,'entryNumber':no,'entryDate':'2026-01-01',
        'invoiceContent':'none','postingStatus':'posted','deleted':false};
      final bundle=<String,dynamic>{
        'format':'nasqo-unified-sqlite-export-v2','version':2,
        'workspace':{'companyName':'Unified fixture','defaultCurrency':'ريال'},
        'currencies':[{'id':1,'name':'ريال','code':'ريال'}],
        'accountGroups':[{'id':1,'name':'Group','category':'shop','currencyCode':'ريال'}],
        'cashboxes':[{'id':1,'name':'Cash','currencyCode':'ريال','isActive':true}],
        'accounts':[account('client',1),account('asset',2),account('revenue',3),account('cost',4)],
        'warehouses':[{'id':'wh-a','name':'Main','isDefault':true},{'id':'wh-b','name':'Second'}],
        'inventory':[item('verified',true),item('pending',false)],
        'ledger':[
          {...entry('purchase',1,'invoice','credit',24),'invoiceContent':'items','warehouseId':'wh-a',
            'lines':[{'inventoryItemId':'pending','warehouseId':'wh-a','lineKind':'item','itemName':'pending','quantity':12,'price':2,'total':24}]},
          {...entry('legacy',2,'voucher','debit',10),'sourceOrigin':'legacy_sqlite','docType':1,'rawDain':10,'rawMadin':3},
          {...entry('explicit',3,'simple-entry','debit',4),'counterpartAccountId':'revenue','journalLines':[
            {'accountId':'client','debitMinor':400,'creditMinor':0},{'accountId':'revenue','debitMinor':0,'creditMinor':400}]},
          {...entry('draft',4,'invoice','debit',100),'postingStatus':'draft'},
          {...entry('deleted',5,'voucher','debit',100),'deleted':true},
        ],
        'stockTransfers':[{'id':10,'fromWarehouseId':'wh-a','toWarehouseId':'wh-b','lines':[
          {'id':11,'inventoryItemId':'pending','quantity':2.5,'unitNum':1}]}],
        'priceOffers':[{'id':20,'name':'Offer','accountId':'client','lines':[
          {'id':21,'lineKind':'item','inventoryItemId':'verified','quantity':1,'price':3,'total':3}]}],
        'erpData':{'unsupportedExample':[{'id':'retained-in-source'}]},
      };
      final file=await File('${dir.path}/web.json').writeAsString(jsonEncode(bundle));
      final candidate=await backup.inspect(file,'web.json');
      expect(candidate.unified,true);expect(candidate.operational,true);
      await backup.openReview(candidate);
      await restore.activate(candidate);
      expect(await backup.isReview(),false);
      expect(await db.query('accounts'),hasLength(4));
      expect(await db.query('ledger_entries'),hasLength(5));
      expect(await db.query('journal_entries'),hasLength(1));
      expect(await db.query('journal_lines'),hasLength(2));
      expect(await db.query('sync_outbox'),isEmpty);
      expect(await LegacyOperationalRestore.original(db),orderedEquals(await file.readAsBytes()));
      var snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
      expect(snapshot['workspace']['companyName'],'Unified fixture');
      final ledger=(snapshot['ledger'] as List).cast<Map<String,dynamic>>();
      expect(ledger.firstWhere((e)=>e['id']=='legacy')['rawMadin'],3);
      expect(ledger.firstWhere((e)=>e['id']=='draft')['postingStatus'],'draft');
      expect(ledger.firstWhere((e)=>e['id']=='deleted')['deleted'],true);
      final explicit=ledger.firstWhere((e)=>e['id']=='explicit');
      expect(explicit['kind'],'simple-entry');expect(explicit['counterpartAccountId'],'revenue');
      expect(explicit['journalLines'],hasLength(2));
      final inventory=(snapshot['inventory'] as List).cast<Map<String,dynamic>>();
      final verified=inventory.firstWhere((i)=>i['id']=='verified'),pending=inventory.firstWhere((i)=>i['id']=='pending');
      expect(verified['quantity'],7.5);expect(verified['quantityUnverified'],false);
      expect(pending['quantity'],0);expect(pending['quantityUnverified'],true);
      expect(pending['legacyStoredQuantity'],999);
      expect(pending['legacyHistoricalQtyByWarehouse'],{'wh-a':9.5,'wh-b':2.5});
      final historyReport=await db.transaction((t)=>LocalInventoryReports.report(t,snapshot,{}));
      final reportRows=historyReport['itemRows'] as List;
      expect(reportRows.firstWhere((r)=>r['id']=='verified')['remainingValue'],15);
      expect(reportRows.firstWhere((r)=>r['id']=='pending')['availableQty'],12);
      expect(reportRows.firstWhere((r)=>r['id']=='pending')['remainingValue'],0);
      final scopedReport=await db.transaction((t)=>LocalInventoryReports.report(t,snapshot,{'itemId':'pending','warehouseId':'wh-a'}));
      expect((scopedReport['itemRows'] as List).single['availableQty'],9.5);
      final stats=await db.transaction((t)=>LocalInventoryReports.priceStats(t,snapshot,'pending'));
      expect(stats['txCount'],1);expect(stats['minPrice'],2);expect(stats['lastPrice'],2);
      expect(await db.query('sync_outbox'),isEmpty);
      final archive=await LegacyHistoryArchive(local).load();
      expect(archive['source_store_trans'],hasLength(1));expect(archive['source_trans_details'],hasLength(1));
      expect(archive['source_offers'],hasLength(1));expect(archive['source_offer_bill_details'],hasLength(1));
      final opening=await LegacyStockOpening(local).load();
      expect((opening['products'] as List).map((p)=>p['id']),['pending']);
      final detail=await LegacyOperationalRestore.invoice(db,'purchase');
      expect((detail!['lines'] as List).single['quantity'],12);
      final roles=LocalInvoiceRoles(local);
      await roles.save('sar',{'revenue':'revenue','inventory':'asset','cost':'cost'});
      final sale=await roles.resolve({'id':'new-sale','kind':'invoice','invoiceContent':'items','payment':'credit',
        'direction':'debit','accountId':'client','currency':'ريال','warehouseId':'wh-a','amount':3,
        'entryDate':'2026-01-02','entryNumber':6,
        'lines':[{'inventoryItemId':'verified','quantity':1,'price':3,'total':3}]});
      await StockInvoiceCommands(local).post(workspace,'new-sale-op',sale);
      snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
      expect((snapshot['inventory'] as List).firstWhere((i)=>i['id']=='verified')['quantity'],6.5);
      expect(await db.query('journal_entries'),hasLength(2));
      final saleReport=await db.transaction((t)=>LocalInventoryReports.report(t,snapshot,{'itemId':'verified'}));
      final saleRow=(saleReport['itemRows'] as List).single;
      expect(saleRow['availableQty'],6.5);expect(saleRow['sellQty'],1);
      expect(saleRow['remainingValue'],13);expect(saleRow['profit'],1);
      final previousReport=await db.transaction((t)=>LocalInventoryReports.report(t,snapshot,{'itemId':'verified','toDate':'2026-01-01'}));
      expect((previousReport['itemRows'] as List).single['availableQty'],7.5);
      final saved=await backup.exportNative();
      final safeFile=await File('${dir.path}/native.back').writeAsBytes(saved);
      final native=await backup.inspect(safeFile,'native.back');
      // Failed validation after destination preparation must roll back all rows.
      final broken=Map<String,dynamic>.from(bundle);
      broken['ledger']=[for(final e in bundle['ledger'] as List)
        if(e['id']=='explicit'){...Map<String,dynamic>.from(e as Map),'journalLines':[
          {'accountId':'client','debitMinor':400,'creditMinor':0},{'accountId':'revenue','debitMinor':0,'creditMinor':300}]}
        else e];
      final badFile=await File('${dir.path}/bad.json').writeAsString(jsonEncode(broken));
      final bad=await backup.inspect(badFile,'bad.json');
      await expectLater(restore.activate(bad,replacementSha:sha256.convert(saved).toString()),throwsFormatException);
      expect(await backup.exportNative(),orderedEquals(saved));
      await restore.activate(candidate,replacementSha:sha256.convert(saved).toString());
      final current=await backup.exportNative();
      await backup.restoreNative(native,replacementSha:sha256.convert(current).toString());
      expect(await LegacyOperationalRestore.original(db),orderedEquals(await file.readAsBytes()));
      expect((await db.query('inventory_items',where:'id = ?',whereArgs:['verified'])).single['quantity'],6.5);
      expect(await db.query('journal_entries'),hasLength(2));
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
