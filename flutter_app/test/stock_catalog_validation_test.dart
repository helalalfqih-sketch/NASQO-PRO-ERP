import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

void main(){
 test('catalog validation gives accurate reasons, keeps all units and never posts stock',()async{
  sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
  final dir=await Directory.systemTemp.createTemp('nasqo-catalog-validation-');await databaseFactory.setDatabasesPath(dir.path);
  final local=LocalDatabase.instance,db=await local.database,stock=LocalStockCatalog(local);
  const workspace='local-erp-workspace';
  try{
   final warehouse=await stock.createWarehouse(workspace,'validation-wh',{'name':'Synthetic warehouse'});
   final endpoint=HybridReadOnlyProtocol(readSnapshot:()async=>{},createStockRecord:(action,key,input)async=>{'id':await stock.createItem(workspace,key,input)});
   Future<Map<String,dynamic>> create(String key,Map<String,dynamic> fields)async=>jsonDecode(await endpoint.handle(jsonEncode({'protocolVersion':'1.0.0','kind':'request','requestId':key,'idempotencyKey':key,'action':'createInventoryItem','payload':{'workspaceId':workspace,'payload':{'name':'Synthetic item','unit':'piece','warehouseId':warehouse,'quantity':0,'avgCost':0,...fields}}}))) as Map<String,dynamic>;
   final units={'unit2':'box','count2':12,'unit3':'carton','count3':6,'defaultUnit':3,'sellingPrice':2,'sprice2':24,'sprice3':144,'expiryDate':'2027-01-31'};
   final created=await create('valid',units);expect(created['ok'],true);expect((await create('valid',units))['data'],created['data']);
   expect(await db.query('inventory_items'),hasLength(1));
   final settings=jsonDecode((await db.query('inventory_unit_settings')).single['settings_json'] as String);expect(settings['count2'],12);expect(settings['count3'],6);expect(settings['defaultUnit'],3);expect(settings['expiryDate'],'2027-01-31');
   final before=await LocalBackupRestore(local).exportNative();
   final cases=<({String key,Map<String,dynamic> fields,String message})>[
    (key:'cost',fields:{'name':'Cost item','avgCost':25},message:'تكلفة صفر'),
    (key:'duplicate',fields:{},message:'الاسم أو الباركود'),
    (key:'factor',fields:{'unit2':'box','count2':0},message:'عددًا صحيحًا موجبًا'),
    (key:'third',fields:{'unit3':'carton','count3':6},message:'الوحدة الثانية'),
    (key:'default',fields:{'defaultUnit':2},message:'الافتراضية'),
    (key:'currency',fields:{'currencyCode':'دولار'},message:'الريال'),
   ];
   for(final c in cases){final result=await create(c.key,c.fields);expect(result['ok'],false);expect(result['error']['message'],contains(c.message));expect(await LocalBackupRestore(local).exportNative(),orderedEquals(before));}
   expect((await db.query('inventory_items')).single['quantity'],0);expect((await db.query('inventory_items')).single['avgCost'],0);
   expect(await db.query('stock_movements'),isEmpty);expect(await db.query('ledger_entries'),isEmpty);
   expect(HybridReadOnlyProtocol.catalogValidationMessage(ArgumentError('private diagnostic should not be returned')),isNot(contains('private diagnostic')));
  }finally{await db.close();await dir.delete(recursive:true);}
 });
}
