import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_erp_records.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

Future<Map<String,dynamic>> restoreIndependent(String dir,String file)async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;await databaseFactory.setDatabasesPath(dir);
 final local=LocalDatabase.instance,backup=LocalBackupRestore(LocalDatabase.instance);
 final candidate=await backup.inspect(File(file),'synthetic.back');await backup.restoreNative(candidate);
 final bytes=await backup.exportNative();final db=await local.database;
 final result={'tables':jsonDecode(jsonDecode(utf8.decode(bytes))['payload'])['tables'],'integrity':(await db.rawQuery('PRAGMA integrity_check')).single.values.single};await db.close();return result;
}
void main(){test('bounded ERP records confirm native commit, survive independent restore, reject conflict/foreign writes',()async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;final dir=await Directory.systemTemp.createTemp('nasqo-erp-records-');await databaseFactory.setDatabasesPath('${dir.path}/source');
 final local=LocalDatabase.instance,db=await local.database,store=LocalErpRecords(LocalDatabase.instance);
 const w='local-erp-workspace';final employee={'id':'emp-1','name':'موظف اصطناعي','roleTitle':'بائع','department':'المحل','basicSalary':5000,'allowances':500,'deductions':0,'status':'active','hireDate':'2026-11-25','leaveBalanceDays':21,'attendanceToday':'present'};
 Map<String,dynamic> change(String c,Map<String,dynamic> r,[int rev=0])=>{'collection':c,'record':r,'expectedRevision':rev};
 try{
  await db.insert('accounts',{'id':'account-a','name':'اختبار','category':'clients','currency':'sar','openingBalance':125,'openingDirection':'debit','phone':'','creditLimit':0,'isCashAccount':0,'note':'','codeNumber':1});
  await db.insert('warehouses',{'id':'warehouse-a','name':'مخزن','details':'','isDefault':1});
  await db.insert('inventory_items',{'id':'item-a','name':'صنف','unit':'حبة','quantity':0,'avgCost':0,'warehouseId':'warehouse-a','minThreshold':0,'sku':'TEST'});
  final create=[change('employees',employee)];await Future.wait([store.save(w,'employee-create',create),store.save(w,'employee-create',create)]);
  expect((await LocalErpRecords.read(db))['employees'],hasLength(1));
  await store.save(w,'employee-edit',[change('employees',{...employee,'name':'موظف معدل'},1)]);
  expect((await LocalErpRecords.read(db))['employees'][0]['name'],'موظف معدل');
  await expectLater(store.save(w,'employee-stale',[change('employees',employee,1)]),throwsStateError);
  await expectLater(store.save('foreign','foreign',[change('employees',employee)]),throwsA(anything));
  await expectLater(store.save(w,'rawsql',[change('employees',{...employee,'sql':'DELETE FROM accounts'})]),throwsArgumentError);
  await store.save(w,'crm-save',[change('deals',{'id':'deal-1','title':'فرصة','clientAccountId':'account-a','clientName':'اختبار','value':16,'currency':'ريال','stage':'lead','probability':50,'expectedCloseDate':'2026-11-25','assignedTo':'المحل'})]);
  await store.save(w,'procurement-save',[change('purchaseOrders',{'id':'po-1','poNumber':'PO-1','supplierAccountId':'account-a','supplierName':'اختبار','warehouseId':'warehouse-a','warehouseName':'مخزن','currency':'ريال','orderDate':'2026-11-25','expectedDate':'2026-11-25','status':'draft','lines':[{'inventoryItemId':'item-a','itemName':'صنف','unit':'حبة','quantity':2,'unitCost':5}],'notes':'مسودة فقط'})]);
  await store.save(w,'manufacturing-center',[change('costCenters',{'id':'cc-1','code':'CC-1','name':'مركز','managerName':'مسؤول','budget':100,'extraPostedSpend':0,'linkedCategories':['مصروفات تشغيلية'],'status':'active'})]);
  await store.save(w,'finance-vat',[change('vatConfig',{'id':'config','jurisdiction':'sa_15','ratePercent':15,'basis':'recorded_only'})]);
  final before=await LocalBackupRestore(local).exportNative();
  await db.execute("CREATE TRIGGER synthetic_erp_failure BEFORE INSERT ON erp_state WHEN NEW.stateKey='erp-record:employees:emp-fail' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_WRITE_FAILURE'); END");
  await expectLater(store.save(w,'failure',[change('employees',{...employee,'id':'emp-fail'})]),throwsA(anything));await db.execute('DROP TRIGGER synthetic_erp_failure');
  expect(await LocalBackupRestore(local).exportNative(),orderedEquals(before));expect(await db.query('journal_lines'),isEmpty);expect(await db.query('stock_movements'),isEmpty);
  final protocol=HybridReadOnlyProtocol(readSnapshot:()async=>{},saveErpRecords:store.save,exportBackup:()async=>false);
  Future<Map> request(String action,Map<String,dynamic> payload)async=>jsonDecode(await protocol.handle(jsonEncode({'protocolVersion':'1.0.0','kind':'request','requestId':'test-request','idempotencyKey':'test-native-key','action':action,'payload':payload})));
  expect((await request('saveErpData',{'workspaceId':w,'data':{}}))['ok'],false);
  expect((await request('saveErpRecords',{'workspaceId':'foreign','changes':create}))['ok'],false);
  expect((await request('backupWorkspace',{'workspaceId':w,'target':'local'}))['data']['saved'],false);
  final broken=HybridReadOnlyProtocol(readSnapshot:()async=>{},exportBackup:()async=>throw StateError('مساحة التخزين ممتلئة'));
  final response=jsonDecode(await broken.handle(jsonEncode({'protocolVersion':'1.0.0','kind':'request','requestId':'failed-backup','action':'backupWorkspace','payload':{'workspaceId':w,'target':'local'}})));expect(response['ok'],false);expect(response['error']['message'],contains('مساحة'));
  final file=await File('${dir.path}/original.back').writeAsBytes(before);final originalHash=sha256.convert(before).toString();
  // Separate isolate = new singleton/database, no memory cache from the source.
  final target='${dir.path}/restored';final filePath=file.path;
  await db.close();
  final restored=await Isolate.run(()=>restoreIndependent(target,filePath));
  expect(restored['integrity'],'ok');final tables=jsonDecode(jsonDecode(utf8.decode(before))['payload'])['tables'] as Map;
  for(final k in tables.keys){expect(restored['tables'][k],unorderedEquals(tables[k] as List),reason:k);}
  expect(sha256.convert(await file.readAsBytes()).toString(),originalHash);
  print('ERP ACCEPTANCE: employee create/edit/replay/rejection; CRM/PO/cost-center/VAT each saved; independent SQLite restore all rows equal; original backup preserved. Android not tested.');
 }finally{if(db.isOpen)await db.close();await dir.delete(recursive:true);}
 });}
