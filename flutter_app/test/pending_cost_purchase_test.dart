import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_quantity_approval.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_opening.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/stock_quantity_approval_state.dart';
import 'package:nasqo_pro_erp/services/accounting_engine.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('priced purchases and linked returns preserve unvalued opening, backup and later valuation',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-pending-purchase-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    final backup=LocalBackupRestore(local),roles=LocalInvoiceRoles(local),post=StockInvoiceCommands(local);
    const w='local-erp-workspace',wh='legacy-wh-1',a='legacy-prod-1',b='legacy-prod-2';
    try{
      final file=File('${dir.path}/synthetic.back');
      final src=await databaseFactoryFfi.openDatabase(file.path);
      for(final sql in [
        'CREATE TABLE currencies(id INTEGER PRIMARY KEY,name TEXT,amount REAL)',
        'CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,type INTEGER,lim REAL)',
        'CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT)',
        'CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER)',
        'CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER)',
        'CREATE TABLE bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,store_id INTEGER,amount REAL,price REAL,total REAL,unitnum INTEGER)',
        'CREATE TABLE store_trans(id INTEGER PRIMARY KEY,store_id1 INTEGER,store_id2 INTEGER,type INTEGER,year INTEGER,month INTEGER,day INTEGER)',
        'CREATE TABLE trans_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,amount REAL,unitnum INTEGER)',
      ]){await src.execute(sql);}
      await src.insert('currencies',{'id':1,'name':'ريال','amount':1});
      await src.insert('customers',{'id':1,'name':'QA Supplier','type':1,'lim':0});
      await src.insert('stores',{'id':1,'name':'QA Warehouse'});
      for(var n=1;n<=2;n++){
        final q=n==1?3:5;
        await src.insert('products',{'id':n,'name':n==1?'QA Pending A':'QA Pending B','unit':'حبة','price':6000,'price2':0,'cur':1});
        await src.insert('input_move',{'id':n,'per_id':1,'dain':0,'madin':q*5000,'cur':1,'bill_type':3,'year':2026,'month':11,'day':1});
        await src.insert('bill_details',{'id':n,'bill_id':n,'prod_id':n,'store_id':1,'amount':q,'price':5000,'total':q*5000,'unitnum':1});
      }
      await src.close();
      final candidate=await backup.inspect(file,'synthetic.back');
      await LegacyOperationalRestore(local).activate(candidate);
      final approval=LegacyQuantityApproval(local),review=await LegacyQuantityApproval(local).preview(wh);
      await approval.approve(wh,[a,b],sourceSha:candidate.sha,reviewHash:review['reviewHash'] as String,confirmed:true);
      final date=review['entryDate'] as String;
      final accounts=LocalAccountCommands(local);
      Future<String> account(String id,{bool cash=false})=>accounts.save(w,id.replaceAll(' ','-'),{'name':id,'category':'shop','currency':'ريال','isCashAccount':cash});
      final asset=await account('QA Inventory'),offset=await account('QA Opening'),revenue=await account('QA Sales'),cost=await account('QA Cost'),cash=await account('QA Cash',cash:true);
      final box=await LocalMasterCatalog(local).saveCashbox(w,'qa-box',{'name':'QA Cashbox','currencyCode':'ريال','accountId':cash});
      await roles.save('sar',{'inventory':asset,'revenue':revenue,'cost':cost,'cash':cash,'cashbox:${box['id']}':cash});
      final units=jsonDecode((await db.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[b])).single['settings_json'] as String) as Map;
      await db.update('inventory_unit_settings',{'settings_json':jsonEncode({...units,'unit2':'علبة','count2':2})},where:'item_id = ?',whereArgs:[b]);
      await db.update('warehouses',{'isDefault':1},where:'id = ?',whereArgs:[wh]);
      await LocalWorkspaceSettings(local).save(w,{'companyName':'اختبار شراء اصطناعي','referenceDefaults':{
        'warehouseId':wh,'accountId':'legacy-acc-1','systemCashboxes':{'ريال':box['id']},'accountCashboxes':<String,dynamic>{},'groupCashboxes':<String,dynamic>{}}});
      final archive=await db.query('legacy_operational_rows');
      final journalsBefore=await db.query('journal_entries');
      expect(journalsBefore,isEmpty);expect(await db.query('stock_movements'),isEmpty);
      final fixture=Platform.environment['NASQO_PENDING_FIXTURE'];
      if(fixture!=null)await File(fixture).writeAsBytes(await backup.exportNative());
      final databaseFixture=Platform.environment['NASQO_PENDING_DB'];
      if(databaseFixture!=null){
        final target=File(databaseFixture);if(await target.exists())await target.delete();
        await db.execute('VACUUM INTO ?',[databaseFixture]);
      }
      Future<Map<String,dynamic>> snapshot()=>HybridLocalSnapshotAdapter.readFromDevice();
      Future<Map<String,dynamic>> item(String id)async=>(await snapshot())['inventory'].cast<Map<String,dynamic>>().firstWhere((x)=>x['id']==id);
      Future<Map<String,dynamic>> report({String? to})async=>LocalInventoryReports.report(db,await snapshot(),{'warehouseId':wh,if(to!=null)'toDate':to});
      Map<String,dynamic> invoice(String id,int num,{bool cashPayment=false,bool sale=false})=>{
        'id':id,'kind':'invoice','invoiceContent':'items','payment':cashPayment?'cash':'credit','direction':sale?'debit':'credit',
        'accountId':'legacy-acc-1','warehouseId':wh,'currency':'ريال','entryNumber':num,'entryDate':date,
        if(cashPayment)'cashboxId':box['id'],'amount':10000,
        'lines':[for(final id in [a,b]){'inventoryItemId':id,'quantity':1,'price':5000,'total':5000,'unitNum':1}]
      };
      Future<String> submit(String key,Map<String,dynamic> input)async=>post.post(w,key,await roles.resolve(input));
      final stats=await LocalInventoryReports.priceStats(db,await snapshot(),a);
      expect(stats['lastPurchasePrice'],5000);
      final before=await backup.exportNative();
      await expectLater(submit('sale-blocked',invoice('sale-blocked',10,sale:true)),throwsA(isA<InvoicePostingSetupRequired>()));
      final invalid=invoice('bad-second-line',10);invalid['lines'][1]['unitNum']=3;
      await expectLater(submit('bad-second-line',invalid),throwsArgumentError);
      expect(await backup.exportNative(),orderedEquals(before));
      final purchase=invoice('purchase',10,cashPayment:true);
      await Future.wait([submit('purchase',purchase),submit('purchase',purchase)]);
      expect((await item(a))['quantity'],4);expect((await item(b))['quantity'],6);
      for(final id in [a,b]){
        final row=await item(id);expect(row['avgCost'],0);expect(row['costUnverified'],true);
        expect(row['approvedStockValue'],5000);
      }
      expect(await db.query('stock_movements'),hasLength(2));expect(await db.query('journal_entries'),hasLength(1));
      expect((await report())['totals']['totalRemainingValue'],10000);
      expect(AccountingEngine.computeInventoryValue((await local.loadSnapshot()).inventory),10000);
      await StockQuantityApprovalState.validate(db);
      Future<void> roundtrip()async{
        final bytes=await backup.exportNative(),path=await File('${dir.path}/roundtrip.back').writeAsBytes(await backup.exportNative());
        await backup.restoreNative(await backup.inspect(path,'roundtrip.back'),replacementSha:sha256.convert(bytes).toString());
        Map<String,dynamic> records(List<int> content){
          final tables=jsonDecode(jsonDecode(utf8.decode(content))['payload'] as String)['tables'] as Map<String,dynamic>;
          // Restore orders parent documents before returns for foreign keys.
          // Compare every record; document insertion order is not business data.
          (tables['stock_posting_documents'] as List).sort((a,b)=>(a['id'] as String).compareTo(b['id'] as String));
          return tables;
        }
        expect(records(await backup.exportNative()),records(bytes));
      }
      await roundtrip();
      final approved=await backup.exportNative();
      final envelope=jsonDecode(utf8.decode(approved)) as Map<String,dynamic>;
      final payload=jsonDecode(envelope['payload'] as String) as Map<String,dynamic>;
      payload['tables']['stock_posting_lines'][0]['after_value']=1;
      envelope['payload']=jsonEncode(payload);
      envelope['sha256']=sha256.convert(utf8.encode(envelope['payload'] as String)).toString();
      final corrupt=await File('${dir.path}/corrupt.back').writeAsString(jsonEncode(envelope));
      await expectLater(backup.restoreNative(await backup.inspect(corrupt,'corrupt.back'),replacementSha:sha256.convert(approved).toString()),throwsStateError);
      expect(await backup.exportNative(),orderedEquals(approved));
      await expectLater(submit('sale-still-blocked',invoice('sale-still-blocked',11,sale:true)),throwsA(isA<InvoicePostingSetupRequired>()));
      expect(await backup.exportNative(),orderedEquals(approved));
      // Explicit original-account binding must survive changes in default roles.
      final resolved=await roles.resolve(invoice('second',11));expect(resolved['counterpartAccountId'],asset);
      final second=invoice('second',11);
      second['lines']=[{'inventoryItemId':b,'quantity':1,'price':10000,'total':10000,'unitNum':2}];
      await submit('second',second);
      expect((await item(b))['quantity'],8);expect((await item(b))['approvedStockValue'],15000);
      expect((await LocalInventoryReports.priceStats(db,await snapshot(),b))['lastPurchasePrice'],5000);
      await post.reverse(w,'return-one','return-one','purchase',12,date,[{'itemId':a,'quantity':0.5}]);
      expect((await item(a))['quantity'],3.5);expect((await item(a))['approvedStockValue'],2500);
      expect((await report())['totals']['totalRemainingValue'],17500);
      await roundtrip();
      final prior=await backup.exportNative();
      await expectLater(post.reverse(w,'too-many','too-many','purchase',13,date,[{'itemId':a,'quantity':1}]),throwsStateError);
      expect(await backup.exportNative(),orderedEquals(prior));
      // Valuation is only for the three old units: keep the new 0.5 units and
      // their 2500 acquisition value, and post only the 12000 opening value.
      final valuation={'sourceItemId':a,'warehouseId':wh,'quantity':3,'totalValue':12000,'inventoryAccountId':asset,
        'offsetAccountId':offset,'entryDate':date,'evidence':'Synthetic old stock value','confirmed':true};
      await LegacyStockOpening(local).approve(w,valuation,expectedSourceSha:candidate.sha);
      await LegacyStockOpening(local).approve(w,valuation,expectedSourceSha:candidate.sha);
      expect((await item(a))['quantity'],3.5);expect((await item(a))['avgCost'],closeTo(14500/3.5,0.000001));
      expect((await item(a))['costUnverified'],false);expect((await report())['totals']['totalRemainingValue'],29500);
      expect(await db.query('stock_movements'),hasLength(4));expect(await db.query('journal_entries'),hasLength(4));
      final sale=invoice('sale-valued',14,sale:true);sale['amount']=6000;
      sale['lines']=[{'inventoryItemId':a,'quantity':1,'price':6000,'total':6000,'unitNum':1}];
      await submit('sale-valued',sale);expect((await item(a))['quantity'],2.5);
      expect((await report())['totals']['totalRemainingValue'],25357.14);
      expect(await db.query('legacy_operational_rows'),archive);
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      for(final j in await db.rawQuery('SELECT journal_id,SUM(debit_minor) d,SUM(credit_minor) c FROM journal_lines GROUP BY journal_id')){expect(j['d'],j['c']);}
      await roundtrip();expect(await db.rawQuery('PRAGMA foreign_key_check'),isEmpty);
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
