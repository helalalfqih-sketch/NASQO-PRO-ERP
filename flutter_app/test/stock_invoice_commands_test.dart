import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';

void main(){
  test('stock purchase, sale, discount, tax and full linked reversal are atomic',()async{
    sqfliteFfiInit();
    databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo_stock_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    const w='local-erp-workspace';
    final a=LocalAccountCommands(local),s=StockInvoiceCommands(local);
    Future<String> acc(String name,String category)=>a.save(w,name,{'name':name,'category':category,'currency':'ريال'});
    try{
      final supplier=await acc('Supplier','purchases'),customer=await acc('Customer','clients');
      final inventory=await acc('Inventory','shop'),revenue=await acc('Revenue','sales');
      final cost=await acc('Cost','shop'),tax=await acc('Tax','shop');
      await db.insert('warehouses',{'id':'wh','name':'Warehouse','details':'','isDefault':1});
      await db.insert('inventory_items',{'id':'item','name':'Item','unit':'piece','quantity':0,'avgCost':0,'warehouseId':'wh','minThreshold':0,'sku':''});
      Map<String,dynamic> invoice(String id,int n,bool sale,int quantity,int price,int discount,int taxAmount)=>{
        'id':id,'kind':'invoice','payment':'credit','direction':sale?'debit':'credit','invoiceContent':'items',
        'accountId':sale?customer:supplier,'counterpartAccountId':sale?revenue:inventory,
        'inventoryAccountId':inventory,'costAccountId':cost,'taxAccountId':tax,
        'taxAmount':taxAmount,'amount':quantity*price-discount+taxAmount,
        'currency':'ريال','warehouseId':'wh','entryNumber':n,'entryDate':'2026-11-24',
        'lines':[{'inventoryItemId':'item','quantity':quantity,'price':price,'discount':discount,'total':quantity*price-discount}],
      };
      Future<Map<String,Object?>> stock()async=>(await db.query('inventory_items')).single;
      final buy=invoice('buy',1,false,10,5,10,4);
      await s.post(w,'buy-op',buy);
      expect((await stock())['quantity'],10);
      expect((await stock())['avgCost'],4);
      final sell=invoice('sell',2,true,3,10,2,3);
      await s.post(w,'sell-op',sell);
      await s.post(w,'sell-op',sell);
      expect((await stock())['quantity'],7);
      expect((await stock())['avgCost'],4);
      await expectLater(s.post(w,'oversell',invoice('bad',3,true,8,10,0,0)),throwsStateError);
      await expectLater(s.post(w,'bad-total',{...invoice('bad2',3,true,1,10,0,0),'amount':99}),throwsArgumentError);
      expect(await db.query('ledger_entries'),hasLength(2));
      await expectLater(s.post(w,'early-return',{'id':'early','kind':'return','originalInvoiceId':'buy','entryNumber':3,'entryDate':'2026-11-24'}),throwsStateError);
      final ret={'id':'ret','kind':'return','originalInvoiceId':'sell','entryNumber':3,'entryDate':'2026-11-24'};
      await s.post(w,'return-op',ret);
      await s.post(w,'return-op',ret);
      expect((await stock())['quantity'],10);
      await expectLater(s.post(w,'duplicate-return',{...ret,'id':'ret2','entryNumber':4}),throwsStateError);
      final sums=await db.rawQuery('SELECT journal_id,SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id');
      expect(sums,hasLength(3));
      for(final row in sums){expect(row['d'],row['c']);}
      final saleLegs=await db.query('journal_lines',where:'journal_id = ?',whereArgs:['sell']);
      expect(saleLegs,hasLength(5));
      expect(saleLegs.firstWhere((l)=>l['account_id']==cost)['debit_minor'],1200);
      expect(saleLegs.firstWhere((l)=>l['account_id']==tax)['credit_minor'],300);
      expect(await db.query('stock_movements'),hasLength(3));
      expect(await local.pendingOperations(w),hasLength(9));
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
