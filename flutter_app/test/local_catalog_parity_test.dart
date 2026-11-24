import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('local master settings and stock catalog edits keep accounting values and rollback batches',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-catalog-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    const w='local-erp-workspace';
    final master=LocalMasterCatalog(local),accounts=LocalAccountCommands(local),stock=LocalStockCatalog(local);
    try{
      await master.saveCurrency(w,'usd-add',{'name':'دولار','ratePrimary':3.5,'rateSecondary':3.4});
      final group=await master.saveGroup(w,'group-add',{'name':'Customers','category':'clients','currencyCode':'ريال'});
      final account=await accounts.save(w,'acc-add',{'name':'Customer','category':'clients','currency':'ريال',
        'groupId':group['id'],'sortOrder':10,'accountImage':'2','messageMethod':'whatsapp'});
      await master.saveGroup(w,'group-edit',{'id':group['id'],'name':'Clients','category':'clients','currencyCode':'ريال'});
      await LocalWorkspaceSettings(local).save(w,{'companyName':'Fixture','defaultCurrency':'دولار'});
      await expectLater(master.deleteCurrency(w,'usd-delete-blocked',2),throwsStateError);
      final wh=await stock.createWarehouse(w,'wh-add',{'name':'A','isDefault':true});
      await stock.createWarehouse(w,'wh-edit',{'name':'B','isDefault':true},existingId:wh);
      final item=await stock.createItem(w,'item-add',{'name':'Item','warehouseId':wh,'quantity':0,'avgCost':0,
        'unit':'piece','unit2':'box','count2':12,'sellingPrice':3});
      await stock.updateItem(w,'item-edit',item,{'name':'Edited item','sellingPrice':4,'minThreshold':2});
      final imported=await stock.importItems(w,'import-1',[
        {'name':'Second','warehouseId':wh,'unit':'piece','quantity':0},
        {'name':'Third','warehouseId':wh,'unit':'piece','quantity':0},
      ],'upsert');
      expect(imported['inserted'],2);
      expect(await stock.importItems(w,'import-1',[
        {'name':'Second','warehouseId':wh,'unit':'piece','quantity':0},
        {'name':'Third','warehouseId':wh,'unit':'piece','quantity':0},
      ],'upsert'),imported);
      final before=await LocalBackupRestore(local).exportNative();
      await expectLater(stock.batchUpdate(w,'invalid-batch',[
        {'id':item,'data':{'sellingPrice':8}},
        {'id':'item_import-1_0','data':{'quantity':1}},
      ]),throwsStateError);
      expect(await LocalBackupRestore(local).exportNative(),orderedEquals(before));
      await stock.batchUpdate(w,'valid-batch',[{'id':item,'data':{'sellingPrice':9,'minThreshold':5}}]);
      final snap=await HybridLocalSnapshotAdapter.readFromDevice();
      expect(snap['workspace']['companyName'],'Fixture');
      expect(snap['workspace']['defaultCurrency'],'دولار');
      expect((snap['accountGroups'] as List).single['name'],'Clients');
      final a=(snap['accounts'] as List).single;
      expect(a['id'],account);expect(a['groupId'],group['id']);expect(a['accountImage'],'2');
      final i=(snap['inventory'] as List).firstWhere((r)=>r['id']==item);
      expect(i['quantity'],0);expect(i['avgCost'],0);expect(i['sellingPrice'],9);
      expect((snap['warehouses'] as List).single['name'],'B');
      await stock.deleteItem(w,'delete-item','item_import-1_0');
      await master.deleteAccount(w,'delete-account',account);
      expect(await db.query('accounts'),isEmpty);
      expect(await db.query('inventory_items'),hasLength(2));
      await LocalWorkspaceSettings(local).save(w,{'defaultCurrency':'ريال'});
      await master.deleteCurrency(w,'delete-usd',2);
      expect((await HybridLocalSnapshotAdapter.readFromDevice())['currencies'],hasLength(1));
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
