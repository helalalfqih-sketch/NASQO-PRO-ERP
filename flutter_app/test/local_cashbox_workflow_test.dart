import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/legacy_history_reports.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('original cashbox form settles customer, stock return and voucher without repeated role fields',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-cashbox-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    const w='local-erp-workspace';
    try{
      final roles=LocalInvoiceRoles(local),stock=StockInvoiceCommands(local),docs=LocalDocumentCommands(local);
      final file=await File('${dir.path}/web.json').writeAsString(jsonEncode({
        'format':'nasqo-unified-sqlite-export-v2','version':2,
        'workspace':{'companyName':'Original','defaultCurrency':'ريال'},
        'currencies':[{'id':1,'name':'ريال','code':'ريال'}],
        'cashboxes':[{'id':7,'name':'صندوق','currencyCode':'ريال','isActive':true}],
        'accounts':[for(final id in ['client','revenue','asset','cost','cash','expense','clearing'])
          {'id':id,'name':id,'category':'shop','currency':'ريال','isCashAccount':id=='cash','openingBalance':0}],
        'warehouses':[{'id':'wh','name':'Main','isDefault':true}],
        'inventory':[{'id':'item','name':'Item','warehouseId':'wh','currencyCode':'ريال','unit':'piece',
          'quantityUnverified':false,'quantity':10,'avgCost':2}],
        'ledger':[],'stockTransfers':[],'priceOffers':[],
      }));
      final backup=LocalBackupRestore(local),candidate=await backup.inspect(file,'web.json');
      await LegacyOperationalRestore(local).activate(candidate);
      await LocalWorkspaceSettings(local).save(w,{'companyName':'Edited','defaultCurrency':'ريال','whatsappInstantEnabled':true});
      expect((await HybridLocalSnapshotAdapter.readFromDevice())['workspace']['companyName'],'Edited');
      final invoice=<String,dynamic>{'id':'sale','kind':'invoice','payment':'cash','direction':'debit',
        'accountId':'client','currency':'ريال','cashboxId':7,'settledOnReceipt':true,'amount':9,
        'entryDate':'2026-11-24','entryNumber':1,'warehouseId':'wh','invoiceContent':'items',
        'lines':[{'inventoryItemId':'item','quantity':1.5,'price':6,'total':9}]};
      await expectLater(roles.resolve(invoice),throwsA(isA<InvoicePostingSetupRequired>()));
      await roles.save('sar',{'revenue':'revenue','inventory':'asset','cost':'cost','expense':'expense',
        'cashbox:7':'cash','cash':'cash','balanceVoucher':'clearing'});
      final resolved=await roles.resolve(invoice);
      expect(resolved['accountId'],'client');expect(resolved['cashSettlementAccountId'],'cash');
      await stock.post(w,'sale-op',resolved);
      await stock.post(w,'sale-op',resolved);
      expect((await db.query('inventory_items')).single['quantity'],8.5);
      Future<num> balance(String id)async=>(await db.rawQuery(
        'SELECT COALESCE(SUM(debit_minor-credit_minor),0) AS n FROM journal_lines WHERE account_id = ?',[id])).single['n'] as num;
      expect(await balance('client'),0);expect(await balance('cash'),900);
      await stock.post(w,'return-op',{'id':'ret','kind':'return','originalInvoiceId':'sale','entryNumber':2,
        'entryDate':'2026-11-24','returnLines':[{'itemId':'item','quantity':0.5}]});
      expect(await balance('client'),0);expect(await balance('cash'),600);
      final free=await roles.resolve({...invoice,'id':'free','invoiceContent':'free','lines':[],
        'entryNumber':3,'amount':5});
      await docs.post(w,'free-op',free);
      expect(await balance('cash'),1100);expect(await balance('client'),0);
      final voucher=await roles.resolve({'id':'voucher','kind':'voucher','accountId':'client','payment':'cash',
        'direction':'credit','currency':'ريال','cashboxId':7,'amount':4,'entryNumber':4,'entryDate':'2026-11-24'});
      await docs.post(w,'voucher-op',voucher);
      expect(await balance('cash'),1500);expect(await balance('client'),-400);
      final snap=await HybridLocalSnapshotAdapter.readFromDevice();
      final ledger=(snap['ledger'] as List).cast<Map<String,dynamic>>();
      expect(ledger.firstWhere((e)=>e['id']=='ret')['kind'],'return');
      expect(ledger.where((e)=>e['cashboxId']==7),hasLength(4));
      final report=LegacyHistoryReports.cashboxes(snap,{'currency':'ريال'});
      expect(report['historicalRegisterOnly'],false);
      expect((report['cashboxes'] as List).single['netBalance'],15);
      for(final row in await db.rawQuery('SELECT SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id')){
        expect(row['d'],row['c']);
      }
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
