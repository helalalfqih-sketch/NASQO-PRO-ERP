import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
void main(){test('document references validate all hierarchy levels and survive native backup without posting',()async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
 final dir=await Directory.systemTemp.createTemp('nasqo-references-');await databaseFactory.setDatabasesPath(dir.path);
 final local=LocalDatabase.instance,db=await local.database,stock=LocalStockCatalog(local),settings=LocalWorkspaceSettings(local);
 const workspace='local-erp-workspace';
 try{
 final wh=await stock.createWarehouse(workspace,'cashier-wh',{'name':'Synthetic warehouse'});
 final item=await stock.createItem(workspace,'cashier-item',{'name':'Synthetic item','unit':'piece','warehouseId':wh,'quantity':0,'avgCost':0});
 await db.insert('accounts',{'id':'customer','name':'Synthetic customer','category':'clients','phone':'','creditLimit':0,'currency':'sar','isCashAccount':0,'note':'','openingBalance':0,'openingDirection':'debit','codeNumber':1});
 await LocalMasterCatalog.write(db,'cashboxes',[{'id':1,'name':'Synthetic cashbox','currencyCode':'ريال','isActive':true}]);
 final beforeItems=jsonEncode(await db.query('inventory_items')),beforeAccounts=jsonEncode(await db.query('accounts'));
 await LocalMasterCatalog.write(db,'accountGroups',[{'id':7,'name':'Synthetic group','currencyCode':'ريال','category':'clients'}]);
 final prefs=<String,dynamic>{'warehouseId':wh,'accountId':'customer','systemCashboxes':{'ريال':1},'accountCashboxes':{'customer':1},'groupCashboxes':{'7':1}};
 await settings.save(workspace,{'referenceDefaults':prefs});expect((await LocalWorkspaceSettings.read(db))['referenceDefaults'],prefs);
 final before=await LocalBackupRestore(local).exportNative();expect(utf8.decode(before),contains('referenceDefaults'));
 for(final patch in [{'warehouseId':'missing'},{'accountId':'missing'},{'systemCashboxes':{'دولار':1}},{'accountCashboxes':{'foreign':1}},{'groupCashboxes':{'99':1}},{'systemCashboxes':{'ريال':0}}]){
 await expectLater(settings.save(workspace,{'referenceDefaults':{...prefs,...patch}}),throwsArgumentError);expect(await LocalBackupRestore(local).exportNative(),orderedEquals(before));}
 await settings.save(workspace,{'companyName':'Synthetic company'});expect((await LocalWorkspaceSettings.read(db))['referenceDefaults'],prefs);
 await settings.save(workspace,{'referenceDefaults':{...prefs,'accountCashboxes':<String,dynamic>{}}});expect((await LocalWorkspaceSettings.read(db))['referenceDefaults']['accountCashboxes'],isEmpty);
 expect(jsonEncode(await db.query('inventory_items')),beforeItems);expect(jsonEncode(await db.query('accounts')),beforeAccounts);
 final file=File('${dir.path}/synthetic.back');await file.writeAsBytes(before);
 final candidate=await LocalBackupRestore(local).inspect(file,'synthetic.back');await LocalBackupRestore(local).restoreNative(candidate,replacementSha:sha256.convert(await LocalBackupRestore(local).exportNative()).toString());
 expect((await LocalWorkspaceSettings.read(db))['referenceDefaults'],prefs);
 expect(await db.query('stock_movements'),isEmpty);expect(await db.query('ledger_entries'),isEmpty);
 }finally{await db.close();await dir.delete(recursive:true);}
});}
