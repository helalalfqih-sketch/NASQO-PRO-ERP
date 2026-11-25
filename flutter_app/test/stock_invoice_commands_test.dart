import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

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
      final beforeConflict=await LocalBackupRestore(local).exportNative();
      await expectLater(s.post(w,'sell-op',invoice('sell',2,true,2,10,2,3)),throwsStateError);
      expect(await LocalBackupRestore(local).exportNative(),orderedEquals(beforeConflict));
      expect((await stock())['quantity'],7);
      expect((await stock())['avgCost'],4);
      await expectLater(s.post(w,'oversell',invoice('bad',3,true,8,10,0,0)),throwsStateError);
      await expectLater(s.post(w,'bad-total',{...invoice('bad2',3,true,1,10,0,0),'amount':99}),throwsArgumentError);
      expect(await db.query('ledger_entries'),hasLength(2));
      await expectLater(s.post(w,'early-return',{'id':'early','kind':'return','originalInvoiceId':'buy','entryNumber':3,'entryDate':'2026-11-24'}),throwsStateError);
      final ret={'id':'ret','kind':'return','originalInvoiceId':'sell','entryNumber':3,'entryDate':'2026-11-24','returnLines':[{'itemId':'item','quantity':1}]};
      await s.post(w,'return-op',ret);
      await s.post(w,'return-op',ret);
      expect((await stock())['quantity'],8);
      await expectLater(s.post(w,'over-return',{...ret,'id':'ret2','entryNumber':4,'returnLines':[{'itemId':'item','quantity':3}]}),throwsStateError);
      await s.post(w,'remaining-return',{...ret,'id':'ret3','entryNumber':4,'returnLines':[{'itemId':'item','quantity':2}]});
      expect((await stock())['quantity'],10);
      final creditRefunds=await db.rawQuery("SELECT SUM(credit_minor) AS total FROM journal_lines WHERE account_id = ? AND journal_id IN ('ret','ret3')",[customer]);
      expect(creditRefunds.single['total'],3100);
      final creditTax=await db.rawQuery("SELECT SUM(debit_minor) AS total FROM journal_lines WHERE account_id = ? AND journal_id IN ('ret','ret3')",[tax]);
      expect(creditTax.single['total'],300);
      await expectLater(s.post(w,'duplicate-return',{...ret,'id':'ret2','entryNumber':5}),throwsStateError);
      final sums=await db.rawQuery('SELECT journal_id,SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id');
      expect(sums,hasLength(4));
      for(final row in sums){expect(row['d'],row['c']);}
      final saleLegs=await db.query('journal_lines',where:'journal_id = ?',whereArgs:['sell']);
      expect(saleLegs,hasLength(5));
      expect(saleLegs.firstWhere((l)=>l['account_id']==cost)['debit_minor'],1200);
      expect(saleLegs.firstWhere((l)=>l['account_id']==tax)['credit_minor'],300);
      expect(await db.query('stock_movements'),hasLength(4));
      expect(await local.pendingOperations(w),hasLength(10));
      final cash=await a.save(w,'Cash',{'name':'Cash','category':'transfers','currency':'ريال','isCashAccount':true});
      final catalog=LocalStockCatalog(local);
      final carton=await catalog.createItem(w,'carton-op',{'name':'Carton item','warehouseId':'wh','unit':'piece','unit2':'carton','count2':12,'defaultUnit':2});
      final cashBuy={...invoice('cash-buy',5,false,2,30,0,3),'accountId':cash,'payment':'cash','settledOnReceipt':true,'taxRateBps':500,
        'lines':[{'inventoryItemId':carton,'quantity':2,'unitNum':2,'price':30,'discount':0,'total':60}]};
      await s.post(w,'cash-buy-op',cashBuy);
      final box=(await db.query('inventory_items',where:'id = ?',whereArgs:[carton])).single;
      expect(box['quantity'],24);
      expect(box['avgCost'],2.5);
      final cashLeg=(await db.query('journal_lines',where:'journal_id = ? AND account_id = ?',whereArgs:['cash-buy',cash])).single;
      expect(cashLeg['credit_minor'],6300);
      final cashSale={...invoice('cash-sale',6,true,1,40,0,2),'accountId':cash,'payment':'cash','taxRateBps':500,
        'lines':[{'inventoryItemId':carton,'quantity':1,'unitNum':2,'price':40,'discount':0,'total':40}]};
      await s.post(w,'cash-sale-op',cashSale);
      expect((await db.query('inventory_items',where:'id = ?',whereArgs:[carton])).single['quantity'],12);
      await s.post(w,'carton-return',{'id':'carton-ret','kind':'return','originalInvoiceId':'cash-sale','entryNumber':7,'entryDate':'2026-11-24',
        'returnLines':[{'itemId':carton,'quantity':1}]});
      await s.post(w,'carton-return',{'id':'carton-ret','kind':'return','originalInvoiceId':'cash-sale','entryNumber':7,'entryDate':'2026-11-24',
        'returnLines':[{'itemId':carton,'quantity':1}]});
      expect((await db.query('inventory_items',where:'id = ?',whereArgs:[carton])).single['quantity'],24);
      final refundLeg=(await db.query('journal_lines',where:'journal_id = ? AND account_id = ?',whereArgs:['carton-ret',cash])).single;
      expect(refundLeg['credit_minor'],4200);
      final refundTax=(await db.query('journal_lines',where:'journal_id = ? AND account_id = ?',whereArgs:['carton-ret',tax])).single;
      expect(refundTax['debit_minor'],200);
      expect(await db.query('stock_movements',where:'operation_id = ?',whereArgs:['carton-return']),hasLength(1));

      final fractional=await catalog.createItem(w,'fractional-op',{'name':'Fractional item','warehouseId':'wh','unit':'kg','unit2':'pack','count2':4});
      Map<String,dynamic> fractionalInvoice(String id,int n,bool sale,num q,num price,num amount,int unitNum)=>{
        ...invoice(id,n,sale,1,1,0,0),'amount':amount,
        'lines':[{'inventoryItemId':fractional,'quantity':q,'unitNum':unitNum,'price':price,'discount':0,'total':amount}],
      };
      Future<Map<String,Object?>> fractionalStock()async=>(await db.query('inventory_items',where:'id = ?',whereArgs:[fractional])).single;
      // 1.125 packs = 4.5 kg. 1.125 * 8 = 9.
      await s.post(w,'fraction-buy',fractionalInvoice('fraction-buy',8,false,1.125,8,9,2));
      expect((await fractionalStock())['quantity'],4.5);
      expect((await fractionalStock())['avgCost'],2);
      // Half-up line rounding: 0.375 * 3 = 1.125 -> 1.13.
      final fractionSale=fractionalInvoice('fraction-sale',9,true,0.375,3,1.13,1);
      await s.post(w,'fraction-sale',fractionSale);
      await s.post(w,'fraction-sale',fractionSale);
      expect((await fractionalStock())['quantity'],4.125);
      final beforeInvalid=await LocalBackupRestore(local).exportNative();
      await expectLater(s.post(w,'too-precise',fractionalInvoice('too-precise',10,true,0.0001,100,0.01,1)),throwsArgumentError);
      await expectLater(s.post(w,'too-much',fractionalInvoice('too-much',10,true,4.126,10,41.26,1)),throwsStateError);
      expect(await LocalBackupRestore(local).exportNative(),orderedEquals(beforeInvalid));
      final partial={'kind':'return','originalInvoiceId':'fraction-sale','entryDate':'2026-11-24'};
      await s.post(w,'fraction-return-1',{...partial,'id':'fraction-return-1','entryNumber':10,
        'returnLines':[{'itemId':fractional,'quantity':0.125}]});
      expect((await fractionalStock())['quantity'],4.25);
      final snap=await HybridLocalSnapshotAdapter.readFromDevice();
      final sold=(snap['ledger'] as List).firstWhere((x)=>x['id']=='fraction-sale');
      expect((sold['returnableLines'] as List).single['quantity'],0.25);
      await expectLater(s.post(w,'fraction-over',{...partial,'id':'fraction-over','entryNumber':11,
        'returnLines':[{'itemId':fractional,'quantity':0.251}]}),throwsStateError);
      await s.post(w,'fraction-return-2',{...partial,'id':'fraction-return-2','entryNumber':11});
      expect((await fractionalStock())['quantity'],4.5);
      expect((await fractionalStock())['avgCost'],2);
      final refunds=await db.rawQuery("SELECT SUM(amount) AS total FROM ledger_entries WHERE id IN ('fraction-return-1','fraction-return-2')");
      expect(refunds.single['total'],closeTo(1.13,0.000001));
      final balances=await db.rawQuery('SELECT journal_id,SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id');
      for(final row in balances){expect(row['d'],row['c']);}
      final backup=LocalBackupRestore(local),bytes=await backup.exportNative();
      final file=await File('${dir.path}/fractions.back').writeAsBytes(bytes);
      final inspected=await backup.inspect(file,'fractions.back');
      expect(inspected.native,true);
      final lines=inspected.nativeTables!['stock_posting_lines']!;
      expect(lines.firstWhere((x)=>x['document_id']=='fraction-sale')['quantity'],0.375);

      // A later purchase changes the average cost before a sale is returned.
      await s.post(w,'late-sale-op',invoice('late-sale',12,true,2,10,0,0));
      await s.post(w,'restock-op',invoice('restock',13,false,2,14,0,0));
      final lateReturn={
        'id':'late-return','kind':'return','originalInvoiceId':'late-sale',
        'entryNumber':14,'entryDate':'2026-11-25',
      };
      await s.post(w,'late-return-op',lateReturn);
      await s.post(w,'late-return-op',lateReturn);
      final returnedStock=(await db.query('inventory_items',where:'id = ?',whereArgs:['item'])).single;
      expect(returnedStock['quantity'],12);
      expect(returnedStock['avgCost'],closeTo(68/12,0.000001));
      final returnedLegs=await db.query('journal_lines',where:'journal_id = ?',whereArgs:['late-return']);
      expect(returnedLegs.firstWhere((l)=>l['account_id']==inventory)['debit_minor'],800);
      expect(returnedLegs.firstWhere((l)=>l['account_id']==cost)['credit_minor'],800);
      expect(returnedLegs.firstWhere((l)=>l['account_id']==customer)['credit_minor'],2000);
      expect(returnedLegs.firstWhere((l)=>l['account_id']==revenue)['debit_minor'],2000);
      final returnedDoc=(await db.query('stock_posting_documents',where:'id = ?',whereArgs:['late-return'])).single;
      expect(jsonDecode(returnedDoc['document_json'] as String)['documentNumber'],'14');
      expect(returnedDoc['return_original_id'],'late-sale');
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
