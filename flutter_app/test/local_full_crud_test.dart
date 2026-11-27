import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'local_erp_records_test.dart' show restoreIndependent;
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_erp_records.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';

void main(){test('full administrative/master CRUD persists; revisions, references, leaves and failed batches are atomic',()async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;final dir=await Directory.systemTemp.createTemp('nasqo-full-crud-');await databaseFactory.setDatabasesPath(dir.path);
 final local=LocalDatabase.instance,db=await local.database,erp=LocalErpRecords(LocalDatabase.instance),masters=LocalMasterCatalog(LocalDatabase.instance),stock=LocalStockCatalog(LocalDatabase.instance);const w='local-erp-workspace';
 final fixtures=jsonDecode(await File('../tests/fixtures/erp-crud.json').readAsString()) as Map<String,dynamic>;
 var op=0;
 Future<Map<String,dynamic>> command(String c,Map<String,dynamic> r,[String operation='create'])async{
  final old=LocalErpRecords.rows(await LocalErpRecords.read(db),c).where((v)=>v['id']==r['id']).toList();
  return {'collection':c,'record':r,'operation':operation,'expectedRevision':operation=='create'?0:old.single['_revision']};
 }
 Future<void> save(String c,Map<String,dynamic> r,[String operation='create'])async{await erp.save(w,'crud-${op++}',[await command(c,r,operation)]);}
 try{
  await db.insert('accounts',{'id':'crud-account','name':'حساب اختبار','category':'clients','currency':'sar','openingBalance':0,'openingDirection':'debit','phone':'','creditLimit':0,'isCashAccount':0,'note':'','codeNumber':1});
  await stock.createWarehouse(w,'wh',{'name':'مخزن اختبار','isDefault':false});await db.update('warehouses',{'id':'crud-wh'},where:'id = ?',whereArgs:['wh_wh']);
  for(final id in ['crud-raw','crud-finished'])await db.insert('inventory_items',{'id':id,'name':id,'unit':'حبة','quantity':0,'avgCost':0,'warehouseId':'crud-wh','minThreshold':0,'sku':id});
  await expectLater(erp.save(w,'invalid-unit',[await command('purchaseOrders',{...fixtures['purchaseOrders'],'lines':[{...fixtures['purchaseOrders']['lines'][0],'unit':'carton'}]})]),throwsStateError);
  final beforeStock=await db.query('inventory_items'),beforeLedger=await db.query('ledger_entries');
  for(final c in fixtures.keys){
   final record=Map<String,dynamic>.from(fixtures[c]);final create=await command(c,record);await erp.save(w,'create-$c',[create]);await erp.save(w,'create-$c',[create]);
   final row=LocalErpRecords.rows(await LocalErpRecords.read(db),c).single;expect(row['_revision'],1);
   final edits={'employees':{'name':'موظف معدل'},'leaveRequests':{'note':'معدلة'},'deals':{'value':600},'purchaseOrders':{'notes':'معدل'},'boms':{'name':'تركيبة معدلة'},'costCenters':{'budget':2000},'productionOrders':{'quantityToProduce':3}};
   await save(c,{...record,...edits[c]!},'update');expect(LocalErpRecords.rows(await LocalErpRecords.read(db),c).single['_revision'],2);
   await expectLater(erp.save(w,'stale-$c',[{...create,'operation':'update','expectedRevision':1}]),throwsStateError);
  }
  for(final c in ['employees','boms','costCenters'])await expectLater(save(c,{'id':fixtures[c]['id']},'delete'),throwsStateError);
  await expectLater(masters.deleteAccount(w,'used-account','crud-account'),throwsStateError);await expectLater(stock.deleteItem(w,'used-item','crud-raw'),throwsStateError);await expectLater(stock.deleteWarehouse(w,'used-wh','crud-wh'),throwsStateError);
  final completeArchive=await LocalBackupRestore(local).exportNative();
  final leave=Map<String,dynamic>.from(fixtures['leaveRequests']);
  await save('leaveRequests',{...leave,'status':'approved'},'update');expect(LocalErpRecords.rows(await LocalErpRecords.read(db),'employees').single['leaveBalanceDays'],19);
  await save('leaveRequests',{...leave,'status':'approved','days':3},'update');expect(LocalErpRecords.rows(await LocalErpRecords.read(db),'employees').single['leaveBalanceDays'],18);
  await save('leaveRequests',{'id':leave['id']},'delete');expect(LocalErpRecords.rows(await LocalErpRecords.read(db),'employees').single['leaveBalanceDays'],21);
  final backup=await LocalBackupRestore(local).exportNative();
  await expectLater(erp.save('foreign','foreign',[await command('employees',{'id':'other'})]),throwsA(anything));
  await expectLater(erp.save(w,'bad-batch',[await command('employees',{...fixtures['employees'],'id':'emp-new','name':'جديد'}),await command('deals',{...fixtures['deals'],'id':'deal-new','probability':101})]),throwsArgumentError);
  expect(await LocalBackupRestore(local).exportNative(),orderedEquals(backup));
  for(final c in ['productionOrders','deals','purchaseOrders','boms','costCenters','employees'])await save(c,{'id':fixtures[c]['id']},'delete');
  for(final c in fixtures.keys)expect(LocalErpRecords.rows(await LocalErpRecords.read(db),c),isEmpty);
  // Tombstones stop an old creation retry from resurrecting a deleted record.
  await expectLater(erp.save(w,'resurrect',[{'collection':'employees','record':fixtures['employees'],'expectedRevision':0,'operation':'create'}]),throwsStateError);
  final group=await masters.saveGroup(w,'group-create',{'name':'مجموعة','category':'clients','currencyCode':'ريال'});
  await masters.saveGroup(w,'group-edit',{'id':group['id'],'name':'مجموعة معدلة','category':'clients','currencyCode':'ريال'});await masters.deleteMaster(w,'group-delete','accountGroups',group['id']);expect(await LocalMasterCatalog.read(db,'accountGroups'),isEmpty);
  final replacement=await masters.saveGroup(w,'replacement-group',{'name':'مجموعة أخرى','category':'clients','currencyCode':'ريال'});expect(replacement['id'],greaterThan(group['id']));
  await expectLater(masters.saveGroup(w,'stale-group',{'id':group['id'],'name':'قديم','category':'clients','currencyCode':'ريال'}),throwsStateError);await masters.deleteMaster(w,'replacement-delete','accountGroups',replacement['id']);
  final box=await masters.saveCashbox(w,'box-create',{'name':'صندوق اختبار','currencyCode':'ريال','accountId':'','isActive':true});
  await masters.saveCashbox(w,'box-edit',{'id':box['id'],'name':'صندوق معدل','currencyCode':'ريال','accountId':box['accountId'],'isActive':false});await masters.deleteMaster(w,'box-delete','cashboxes',box['id']);expect(await LocalMasterCatalog.read(db,'cashboxes'),isEmpty);
  final wh=await stock.createWarehouse(w,'empty-wh',{'name':'فارغ','isDefault':false});await stock.createWarehouse(w,'edit-wh',{'name':'فارغ معدل','isDefault':false},existingId:wh);await stock.deleteWarehouse(w,'delete-wh',wh);
  expect(await db.query('inventory_items'),beforeStock);expect(await db.query('ledger_entries'),beforeLedger);expect(await db.query('journal_lines'),isEmpty);expect(await db.query('stock_movements'),isEmpty);
  expect((await db.rawQuery('PRAGMA integrity_check')).single.values.single,'ok');
  final deletedArchive=await LocalBackupRestore(local).exportNative();
  await db.close();
  // A new isolate/database avoids any in-memory store from the source.
  for(final bytes in [completeArchive,deletedArchive]){
    final index=identical(bytes,completeArchive)?'complete':'deleted';
    final archive=await File('${dir.path}/$index.back').writeAsBytes(bytes);
    final restorePath='${dir.path}/restored-$index',archivePath=archive.path;
    final restored=await Isolate.run(()=>restoreIndependent(restorePath,archivePath));
    final tables=jsonDecode(jsonDecode(utf8.decode(bytes))['payload'])['tables'] as Map;
    for(final table in tables.keys)expect(restored['tables'][table],unorderedEquals(tables[table] as List),reason:table);
    expect(await archive.readAsBytes(),orderedEquals(bytes));
  }
 }finally{if(db.isOpen)await db.close();await dir.delete(recursive:true);}
 });}
