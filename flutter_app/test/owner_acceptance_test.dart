import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/legacy_history_reports.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

class OfflineOnly extends HttpOverrides {
 @override HttpClient createHttpClient(SecurityContext? context)=>throw StateError('NETWORK_DISABLED_FOR_ACCEPTANCE');
}
void main(){test('owner acceptance: money, stock, rollback, catalogs, backup and disk reopen',()async{
 HttpOverrides.global=OfflineOnly();sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
 final dir=await Directory.systemTemp.createTemp('nasqo-owner-acceptance-');await databaseFactory.setDatabasesPath(dir.path);
 final local=LocalDatabase.instance,db=await local.database;const w='local-erp-workspace';
 final out=Directory(Platform.environment['NASQO_ACCEPTANCE_OUT']??'/tmp/nasqo-owner-evidence');await out.create(recursive:true);
 final results=<Map<String,dynamic>>[];
 void evidence(String id,Object actual){results.add({'id':id,'status':'ناجح بدليل','environment':'Flutter Dart + real isolated SQLite, network forbidden; NOT Android','actual':actual});print('ACCEPTANCE $id ${jsonEncode(actual)}');}
 Future<void> write(String name,Object value)=>File('${out.path}/$name.json').writeAsString(const JsonEncoder.withIndent('  ').convert(value));
 final accounts=LocalAccountCommands(local),masters=LocalMasterCatalog(local),stock=LocalStockCatalog(local),posting=StockInvoiceCommands(local),roles=LocalInvoiceRoles(local),backup=LocalBackupRestore(local);
 Future<String> acc(String id,String category,{bool cash=false,String currency='ريال'})=>accounts.save(w,id,{'name':'اختبار $id','category':category,'currency':currency,'isCashAccount':cash});
 Future<num> bal(String id)async=>(await db.rawQuery('SELECT COALESCE(SUM(debit_minor-credit_minor),0) AS n FROM journal_lines WHERE account_id = ?',[id])).single['n'] as num;
 Future<num> qty()async=>(await db.query('inventory_items',where:'id = ?',whereArgs:['golden-item'])).single['quantity'] as num;
 try{
 final client=await acc('client','clients'),cash=await acc('cash','shop',cash:true),inventory=await acc('asset','shop'),revenue=await acc('revenue','sales'),cost=await acc('cost','shop'),supplier=await acc('supplier','purchases'),expense=await acc('expense','shop');
 await db.insert('warehouses',{'id':'golden-wh','name':'مخزن اختبار','details':'','isDefault':1});
 await db.insert('inventory_items',{'id':'golden-item','name':'صنف القبول العربي','unit':'حبة','quantity':10,'avgCost':5,'warehouseId':'golden-wh','minThreshold':0,'sku':'TEST-GOLDEN'});
 await db.transaction((t)=>LocalMasterCatalog.write(t,'cashboxes',[{'id':7,'name':'صندوق اختبار','currencyCode':'ريال','isActive':true}]));
 await roles.save('sar',{'revenue':revenue,'inventory':inventory,'cost':cost,'expense':expense,'cashbox:7':cash,'cash':cash,'balanceVoucher':expense});
 await LocalWorkspaceSettings(local).save(w,{'companyName':'محل اختبار القبول فقط','defaultCurrency':'ريال'});
 Map<String,dynamic> sale(String id,int number,{bool credit=false})=>{'id':id,'kind':'invoice','payment':credit?'credit':'cash','direction':'debit','accountId':client,'currency':'ريال',if(!credit)'cashboxId':7,'settledOnReceipt':!credit,'amount':16,'entryDate':'2026-11-25','entryNumber':number,'warehouseId':'golden-wh','invoiceContent':'items','lines':[{'inventoryItemId':'golden-item','quantity':2,'price':8,'total':16}]};
 final resolved=await roles.resolve(sale('golden-sale',1));final timer=Stopwatch()..start();await posting.post(w,'golden-sale-op',resolved);timer.stop();
 expect(await qty(),8);expect(await bal(cash),1600);expect(await bal(cost),1000);expect(await bal(client),0);expect(await bal(inventory),-1000);expect(await bal(revenue),-1600);
 final legs=await db.query('journal_lines',where:'journal_id = ?',whereArgs:['golden-sale']);num debit=0,credit=0;for(final l in legs){debit+=l['debit_minor'] as num;credit+=l['credit_minor'] as num;}expect(debit,credit);
 evidence('G01-cash-sale',{'initialQty':10,'cost':5,'soldQty':2,'price':8,'remainingQty':await qty(),'cashIncrease':16,'cogs':10,'journalDebitMinor':debit,'journalCreditMinor':credit,'saveMs':timer.elapsedMicroseconds/1000});
 final snap=await HybridLocalSnapshotAdapter.readFromDevice();final report=await db.transaction((t)=>LocalInventoryReports.report(t,snap,{}));final cashReport=LegacyHistoryReports.cashboxes(snap,{'currency':'ريال'});
 expect((report['itemRows'] as List).firstWhere((r)=>r['id']=='golden-item')['availableQty'],8);
 expect((cashReport['cashboxes'] as List).single['netBalance'],16);
 await write('golden-snapshot',snap);await write('golden-inventory-report',report);await write('golden-cash-report',cashReport);await write('golden-journal',legs);
 evidence('G02-report-trace',{'inventoryQuantity':8,'cashboxBalance':16,'snapshotLedgerCount':(snap['ledger'] as List).length});
 await Future.wait([posting.post(w,'golden-sale-op',resolved),posting.post(w,'golden-sale-op',resolved)]);expect(await qty(),8);expect(await db.query('stock_posting_documents'),hasLength(1));expect(await db.query('stock_movements'),hasLength(1));
 evidence('G03-duplicate-ack-loss',{'documentCount':1,'movementCount':1,'remainingQty':8,'note':'replay after committed result ignored + concurrent repeats; native SQLite only'});
 final beforeFailure=await backup.exportNative();await db.execute("CREATE TRIGGER test_save_failure BEFORE INSERT ON journal_lines WHEN NEW.journal_id='failed-sale' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END");
 await expectLater(posting.post(w,'failed-sale-op',await roles.resolve(sale('failed-sale',2))),throwsA(anything));await db.execute('DROP TRIGGER test_save_failure');expect(await backup.exportNative(),orderedEquals(beforeFailure));
 evidence('G04-mid-save-rollback',{'nativeExportByteEqualBeforeAfter':true,'remainingQty':8});
 await posting.post(w,'partial-return-op',{'id':'partial-return','kind':'return','originalInvoiceId':'golden-sale','entryNumber':2,'entryDate':'2026-11-25','returnLines':[{'itemId':'golden-item','quantity':1}]});expect(await qty(),9);expect(await bal(cash),800);expect(await bal(cost),500);
 evidence('G05-partial-return',{'quantity':9,'cashNet':8,'cogsNet':5,'lateReturnScenario':'ERP-001-RET-LATE deferred, no replenishment tested here'});
 await posting.post(w,'credit-sale-op',await roles.resolve(sale('credit-sale',3,credit:true)));expect(await qty(),7);expect(await bal(cash),800);expect(await bal(client),1600);
 evidence('G06-credit-sale',{'quantity':7,'cashNet':8,'customerDebit':16});
 final buy=await roles.resolve({...sale('credit-buy',4,credit:true),'direction':'credit','accountId':supplier,'amount':10,'lines':[{'inventoryItemId':'golden-item','quantity':2,'price':5,'total':10}]});await posting.post(w,'credit-buy-op',buy);expect(await qty(),9);expect(await bal(supplier),-1000);
 evidence('G07-purchase',{'quantity':9,'supplierCredit':10});
 final docs=LocalDocumentCommands(local);for(final p in [{'id':'receipt','direction':'credit','amount':4,'entryNumber':5},{'id':'payment','direction':'debit','amount':2,'entryNumber':6}]){await docs.post(w,'${p['id']}-op',await roles.resolve({...p,'kind':'voucher','accountId':client,'payment':'cash','currency':'ريال','cashboxId':7,'entryDate':'2026-11-25'}));}
 expect(await bal(cash),1000);expect(await bal(client),1400);evidence('G08-receipt-payment',{'cashNet':10,'customerDebit':14});
 final guarded=await backup.exportNative();for(final id in [client,cash]){await expectLater(masters.deleteAccount(w,'delete-$id',id),throwsStateError);}await expectLater(stock.deleteItem(w,'delete-golden','golden-item'),throwsStateError);expect(await backup.exportNative(),orderedEquals(guarded));
 evidence('G09-linked-delete-guard',{'customerAndCashAccountsAndItemBlocked':true,'unchangedNativeExport':true,'cashboxRegistryDelete':'no dedicated delete command certified'});
 for(final category in LocalMasterCatalog.categories){final id=await acc('new-$category',category);await accounts.save(w,'edit-$category',{'name':'معدل $category','category':category,'currency':'ريال'},accountId:id);expect((await db.query('accounts',where:'id = ?',whereArgs:[id])).single['name'],'معدل $category');await masters.deleteAccount(w,'remove-$category',id);expect(await db.query('accounts',where:'id = ?',whereArgs:[id]),isEmpty);evidence('M-$category',{'createEditReadDeleteUnused':true});}
 for(final currency in ['دولار','يورو']){await masters.saveCurrency(w,'cur-$currency',{'name':currency,'ratePrimary':2,'rateSecondary':2});}
 await LocalWorkspaceSettings(local).save(w,{'defaultCurrency':'دولار'});expect((await HybridLocalSnapshotAdapter.readFromDevice())['workspace']['defaultCurrency'],'دولار');expect((await db.query('ledger_entries',where:'id = ?',whereArgs:['golden-sale'])).single['currency'],'sar');await expectLater(masters.deleteCurrency(w,'delete-default',2),throwsStateError);await LocalWorkspaceSettings(local).save(w,{'defaultCurrency':'ريال'});
 evidence('M-currencies-setting',{'currencies':['ريال','دولار','يورو'],'defaultChangePersisted':true,'oldInvoiceCurrencyUnchanged':true,'defaultDeleteBlocked':true});
 final before=await backup.exportNative();await File('${out.path}/synthetic-native.back').writeAsBytes(before);final f=await File('${dir.path}/restore.back').writeAsBytes(before);final candidate=await backup.inspect(f,'restore.back');final lease=await backup.replacementBackup();await backup.restoreNative(candidate,replacementSha:sha256.convert(lease!).toString());final afterRestore=await backup.exportNative();await File('${out.path}/after-restore.back').writeAsBytes(afterRestore);final preTables=jsonDecode((jsonDecode(utf8.decode(before)) as Map)['payload'] as String)['tables'] as Map;final postTables=jsonDecode((jsonDecode(utf8.decode(afterRestore)) as Map)['payload'] as String)['tables'] as Map;for(final key in preTables.keys){expect(postTables[key],unorderedEquals(preTables[key] as List),reason:'Restored table $key');}
 expect((await db.rawQuery('PRAGMA integrity_check')).single.values.single,'ok');expect(await db.rawQuery('PRAGMA foreign_key_check'),isEmpty);evidence('G10-native-backup-restore',{'allTableRowsAndValuesEqual':true,'serializedOrderChanged':'stock_posting_documents places originals before returns','foreignKeysClean':true,'quantity':await qty(),'cashNet':(await bal(cash))/100});
 final dbPath=db.path;await db.close();final reopened=await databaseFactoryFfi.openDatabase(dbPath,options:OpenDatabaseOptions(readOnly:true,singleInstance:false));
 expect((await reopened.query('inventory_items',where:'id = ?',whereArgs:['golden-item'])).single['quantity'],9);expect(await reopened.query('stock_posting_documents'),hasLength(4));expect(await reopened.query('ledger_entries'),hasLength(6));
 final balance=(await reopened.rawQuery('SELECT SUM(debit_minor-credit_minor) AS n FROM journal_lines WHERE account_id = ?',[cash])).single['n'];expect(balance,1000);await reopened.close();evidence('G11-disk-reopen-offline',{'quantity':9,'documents':6,'stockDocuments':4,'cashNet':10,'network':'HttpClient disabled','scope':'new SQLite connection; not Android process kill'});
 }finally{await write('native-acceptance-results',results);if(db.isOpen)await db.close();await dir.delete(recursive:true);HttpOverrides.global=null;}
});}
