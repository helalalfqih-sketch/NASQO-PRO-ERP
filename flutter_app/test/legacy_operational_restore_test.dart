import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_opening.dart';
import 'package:nasqo_pro_erp/services/legacy_history_archive.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){
  test('legacy account migration preserves raw history, accepts new balanced journal, protects stock and round-trips archive',()async{
    sqfliteFfiInit();
    databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo_legacy_live_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    final backup=LocalBackupRestore(local);
    final migrate=LegacyOperationalRestore(local);
    const w='local-erp-workspace';
    try{
      final file=File('${dir.path}/fixture.back');
      final src=await databaseFactoryFfi.openDatabase(file.path);
      await src.execute('CREATE TABLE currencies(id INTEGER PRIMARY KEY,name TEXT,amount REAL)');
      await src.execute('CREATE TABLE boxes(id INTEGER PRIMARY KEY,name TEXT,cur INTEGER)');
      await src.execute('CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,type INTEGER,lim REAL)');
      await src.execute('CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT)');
      await src.execute('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER,count2 REAL,count3 REAL)');
      await src.execute('CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER,curprice REAL,cboxid INTEGER)');
      await src.execute('CREATE TABLE bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,store_id INTEGER,amount REAL,price REAL,total REAL,unitnum INTEGER,bonus REAL)');
      await src.insert('currencies',{'id':1,'name':'ريال','amount':1});
      await src.insert('boxes',{'id':1,'name':'العملاء','cur':1});
      await src.insert('customers',{'id':1,'name':'Client','type':1,'lim':0});
      await src.insert('customers',{'id':2,'name':'Counterpart','type':1,'lim':0});
      await src.insert('stores',{'id':1,'name':'Main'});
      await src.insert('stores',{'id':2,'name':'Second'});
      await src.insert('products',{'id':1,'name':'Product','unit':'piece','price':5,'price2':3,'cur':1,'count2':12,'count3':2});
      await src.execute('CREATE TABLE store_trans(id INTEGER PRIMARY KEY,store_id1 INTEGER,store_id2 INTEGER,type INTEGER)');
      await src.insert('store_trans',{'id':1,'store_id1':1,'store_id2':2,'type':1});
      await src.execute('CREATE TABLE trans_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,amount REAL,unitnum INTEGER)');
      await src.insert('trans_details',{'id':1,'bill_id':1,'prod_id':1,'amount':1.5,'unitnum':2});
      for(final movement in [
        {'id':1,'dain':10,'madin':0,'cur':1,'bill_type':2},
        {'id':2,'dain':7,'madin':7,'cur':1,'bill_type':2},
        {'id':3,'dain':0,'madin':4,'cur':1,'bill_type':1},
        {'id':4,'dain':900,'madin':0,'cur':99,'bill_type':1},
        {'id':5,'dain':8,'madin':3,'cur':1,'bill_type':1},
      ]){
        await src.insert('input_move',{...movement,'per_id':1,'year':2026,'month':11,'day':8,'curprice':0,'cboxid':0});
      }
      await src.insert('bill_details',{'id':1,'bill_id':1,'prod_id':1,'store_id':1,'amount':2.5,'price':4,'total':10,'unitnum':2,'bonus':1});
      await src.insert('bill_details',{'id':2,'bill_id':2,'prod_id':1,'store_id':2,'amount':1,'price':7,'total':7,'unitnum':3,'bonus':0});
      await src.close();
      final candidate=await backup.inspect(file,'fixture.back');
      final compressed=await File('${dir.path}/fixture.back.gz').writeAsBytes(gzip.encode(candidate.bytes));
      final unpacked=await backup.inspect(compressed,'fixture.back.gz');
      expect(unpacked.sha,candidate.sha);
      expect(unpacked.bytes,orderedEquals(candidate.bytes));
      expect(unpacked.counts,candidate.counts);
      expect(await backup.replacementBackup(),isNull);
      expect(candidate.meta['unknownCurrencies'],1);
      expect(candidate.collections['inventory']!.single['computedQuantity'],-55);
      expect(candidate.collections['inventory']!.single['legacyInvoiceQtyByWarehouse'],{'legacy-wh-1':-31,'legacy-wh-2':-24});
      expect(candidate.collections['source_store_trans'],hasLength(1));
      await backup.openReview(candidate);
      await migrate.activate(candidate);
      expect(await backup.isReview(),false);
      expect(await LocalDatabase.hasLegacyOperational(db),true);
      expect(await db.query('accounts'),hasLength(2));
      expect(await db.query('ledger_entries'),hasLength(5));
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('sync_outbox'),isEmpty);
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      var view=await HybridLocalSnapshotAdapter.readFromDevice();
      final rows=(view['ledger'] as List).cast<Map<String,dynamic>>();
      expect(rows.where((r)=>r['postingStatus']=='posted'),hasLength(4));
      expect((await db.query('legacy_operational_rows',where:'collection = ?',whereArgs:['source_store_trans'])),hasLength(1));
      expect(rows.firstWhere((r)=>r['id']=='legacy-ent-4')['currency'],'عملة غير معرّفة (99)');
      final posted=rows.where((r)=>r['postingStatus']=='posted');
      expect(posted.fold<num>(0,(sum,e)=>sum+(e['rawMadin'] as num)-(e['rawDain'] as num)),-11);
      final detail=await LegacyOperationalRestore.invoice(db,'legacy-ent-1');
      expect((detail!['lines'] as List).single['quantity'],2.5);
      expect((view['inventory'] as List).single['quantityUnverified'],true);
      expect((view['inventory'] as List).single['computedQuantity'],-55);
      expect((view['inventory'] as List).single['quantity'],0);
      await expectLater(LocalDatabase.requireVerifiedStock(db,'legacy-prod-1'),throwsStateError);
      final edited=await LocalAccountCommands(local).save(w,'rename',{'name':'Client updated','category':'clients','currency':'ريال','creditLimit':0,'openingDirection':'debit'},accountId:'legacy-acc-1');
      expect(edited,'legacy-acc-1');
      await LocalDocumentCommands(local).post(w,'new-doc',{'id':'new-doc','accountId':'legacy-acc-1','counterpartAccountId':'legacy-acc-2','kind':'voucher','direction':'credit','payment':'balance','currency':'ريال','entryNumber':6,'entryDate':'2026-11-24','amount':2});
      expect(await db.query('journal_lines'),hasLength(2));
      view=await HybridLocalSnapshotAdapter.readFromDevice();
      expect((view['ledger'] as List),hasLength(6));
      expect((view['ledger'] as List).firstWhere((r)=>r['id']=='new-doc')['journalLines'],hasLength(2));
      await expectLater(migrate.activate(candidate),throwsStateError);
      await expectLater(local.clearAll(),throwsStateError);
      final archive=await LegacyHistoryArchive(local).load();
      expect(archive['source_trans_details'],hasLength(1));
      final opening=LegacyStockOpening(local);
      final counted=await opening.load();
      expect((counted['products'] as List).single['legacyTransferNetByWarehouse'],{'legacy-wh-1':-18,'legacy-wh-2':18});
      // Simulate an older activated archive that has the original source but
      // no structured transfer rows. Recovery is read-only.
      await db.delete('legacy_operational_rows',where:'collection = ?',whereArgs:['source_trans_details']);
      final recovered=await LegacyHistoryArchive(local).load();
      expect(recovered['source_trans_details'],hasLength(1));
      expect(await db.query('legacy_operational_rows',where:'collection = ?',whereArgs:['source_trans_details']),isEmpty);
      final stock=StockInvoiceCommands(local);
      final a=await LocalAccountCommands(local).save(w,'inventory-asset',{'name':'Stock asset','category':'shop','currency':'ريال'});
      final b=await LocalAccountCommands(local).save(w,'opening-offset',{'name':'Opening offset','category':'shop','currency':'ريال'});
      final cost=await LocalAccountCommands(local).save(w,'cost-account',{'name':'Cost','category':'shop','currency':'ريال'});
      final req=<String,dynamic>{'sourceItemId':'legacy-prod-1','warehouseId':'legacy-wh-1','inventoryAccountId':a,
        'offsetAccountId':b,'quantity':10,'totalValue':30,'entryDate':'2026-11-24','evidence':'Synthetic count','confirmed':true};
      final secondReq=<String,dynamic>{...req,'warehouseId':'legacy-wh-2','quantity':4.5,'totalValue':22.5};
      final beforeBatch=await backup.exportNative();
      await expectLater(opening.approveBatch(w,[req,{...secondReq,'totalValue':0}]),throwsArgumentError);
      expect(await backup.exportNative(),orderedEquals(beforeBatch));
      await expectLater(opening.approveBatch(w,[req,req]),throwsArgumentError);
      final batchIds=await opening.approveBatch(w,[req,secondReq]);
      expect(batchIds,hasLength(2));
      expect(batchIds.first,'legacy-prod-1');
      final second=batchIds.last;
      expect(await opening.approveBatch(w,[req,secondReq]),batchIds);
      expect(await opening.approve(w,req),'legacy-prod-1');
      await expectLater(opening.approve(w,{...req,'quantity':11}),throwsStateError);
      expect(second,isNot('legacy-prod-1'));
      expect(await db.query('legacy_stock_openings'),hasLength(2));
      expect(await db.query('legacy_unverified_stock'),isEmpty);
      final sale=<String,dynamic>{'id':'sale-counted','kind':'invoice','invoiceContent':'items','direction':'debit','payment':'credit',
        'accountId':'legacy-acc-1','counterpartAccountId':'legacy-acc-2','inventoryAccountId':a,'costAccountId':cost,
        'warehouseId':'legacy-wh-2','currency':'ريال','entryNumber':9,'entryDate':'2026-11-24','amount':9,
        'lines':[{'inventoryItemId':second,'quantity':1,'price':9,'total':9,'unitNum':1}]};
      await expectLater(stock.post(w,'bad-account',{...sale,'inventoryAccountId':b}),throwsStateError);
      await expectLater(stock.post(w,'bad-date',{...sale,'entryDate':'2026-11-23'}),throwsStateError);
      final roles=LocalInvoiceRoles(local);
      final originalForm={...sale}..remove('counterpartAccountId')..remove('inventoryAccountId')..remove('costAccountId');
      final beforeRoles=await db.query('ledger_entries');
      await expectLater(roles.resolve(originalForm),throwsA(isA<InvoicePostingSetupRequired>()));
      expect(await db.query('ledger_entries'),beforeRoles);
      await roles.save('sar',{'revenue':'legacy-acc-2','inventory':b,'cost':cost,'expense':b});
      final resolved=await roles.resolve(originalForm);
      expect(resolved['counterpartAccountId'],'legacy-acc-2');
      // Approved opening overrides the unrelated default inventory account.
      expect(resolved['inventoryAccountId'],a);
      expect(resolved['costAccountId'],cost);
      await stock.post(w,'sale-counted',resolved);
      final purchase=<String,dynamic>{'id':'purchase-counted','kind':'invoice','invoiceContent':'items','direction':'credit','payment':'credit',
        'accountId':'legacy-acc-1','counterpartAccountId':a,'warehouseId':'legacy-wh-1','currency':'ريال',
        'entryNumber':10,'entryDate':'2026-11-24','amount':10,
        'lines':[{'inventoryItemId':'legacy-prod-1','quantity':2,'price':5,'total':10,'unitNum':1}]};
      final purchaseForm={...purchase}..remove('counterpartAccountId');
      final resolvedPurchase=await roles.resolve(purchaseForm);
      expect(resolvedPurchase['counterpartAccountId'],a);
      await stock.post(w,'purchase-counted',resolvedPurchase);
      final inv=await db.query('inventory_items',where:'id = ?',whereArgs:['legacy-prod-1']);
      final inv2=await db.query('inventory_items',where:'id = ?',whereArgs:[second]);
      expect(inv.single['quantity'],12);
      expect(inv2.single['quantity'],3.5);
      expect((inv.single['avgCost'] as num),closeTo(40/12,0.000001));
      expect(inv2.single['avgCost'],5);
      expect((await db.query('journal_entries')),hasLength(5));
      final export=await backup.exportNative();
      final saved=await File('${dir.path}/native.back').writeAsBytes(export);
      final restored=await backup.inspect(saved,'native.back');
      expect(restored.native,isTrue);
      expect(restored.counts['legacy_operational_source'],1);
      expect(restored.counts['legacy_unverified_stock'],0);
      expect(restored.counts['legacy_stock_openings'],2);
      final replacement=(await backup.replacementBackup())!;
      expect(replacement,orderedEquals(export));
      final proof=sha256.convert(replacement).toString();
      // A stale lease cannot remove changes made after the saved copy.
      await db.update('accounts',{'note':'newer note'},where:'id = ?',whereArgs:['legacy-acc-1']);
      await expectLater(migrate.activate(candidate,replacementSha:proof),throwsStateError);
      expect((await db.query('accounts',where:'id = ?',whereArgs:['legacy-acc-1'])).single['note'],'newer note');
      expect(await db.query('ledger_entries'),hasLength(10));
      final newer=(await backup.replacementBackup())!;
      final newerProof=sha256.convert(newer).toString();
      // Force validation to fail after destination deletion has begun.
      final damaged=BackupCandidate(candidate.name,candidate.format,candidate.bytes,candidate.sha,
        {...candidate.collections,'accounts':[for(final a in candidate.collections['accounts']!)
          {...a,'creditLimit':-1}]},candidate.meta,null);
      await expectLater(migrate.activate(damaged,replacementSha:newerProof),throwsFormatException);
      expect(await backup.replacementBackup(),orderedEquals(newer));
      // Remote enrollment must never be displaced by the local restore.
      await db.insert('erp_state',{'stateKey':'sync_workspace_binding','payloadJson':'{}','updatedAt':'2026-11-24'});
      await expectLater(backup.replacementBackup(),throwsStateError);
      await expectLater(migrate.activate(candidate,replacementSha:newerProof),throwsStateError);
      await db.delete('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding']);
      expect(await backup.replacementBackup(),orderedEquals(newer));
      // Activate the historical file on a nonempty database only with the
      // exact exported lease. No duplicate rows or historical replay.
      await backup.openReview(candidate);
      expect(await backup.replacementBackup(),orderedEquals(newer));
      await migrate.activate(candidate,replacementSha:newerProof);
      expect(await backup.isReview(),false);
      expect(await db.query('ledger_entries'),hasLength(5));
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('sync_outbox'),isEmpty);
      expect((await roles.load())['roles'],isEmpty);
      // Restore the saved native safety copy, also with an explicit lease.
      final activated=(await backup.replacementBackup())!;
      await backup.restoreNative(restored,replacementSha:sha256.convert(activated).toString());
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      expect((await db.query('ledger_entries')),hasLength(10));
      expect((await db.query('journal_lines')),hasLength(12));
      expect(await db.query('legacy_stock_openings'),hasLength(2));
      expect(((await roles.load())['roles'] as Map)['sar']['revenue'],'legacy-acc-2');
      final snap=await HybridLocalSnapshotAdapter.readFromDevice();
      expect((snap['inventory'] as List).firstWhere((e)=>e['id']==second)['legacySourceItemId'],'legacy-prod-1');

      final sql=await File('${dir.path}/legacy.sql').writeAsString("""
INSERT INTO currencies(id,name,amount) VALUES(1,'ريال',1);
INSERT INTO boxes(id,name,cur) VALUES(1,'العملاء',1);
INSERT INTO cboxes(id,name,cur,state) VALUES(1,'Cashbox',1,1);
INSERT INTO accounts(id,name,box_id,lim) VALUES(1,'اسم العميل',1,0);
INSERT INTO stores(id,name) VALUES(1,'Main');
INSERT INTO products(id,name,unit,price,price2,cur) VALUES(1,'Item','piece',8,3,1);
INSERT INTO bounds(id,acc_id,dain,madin,cur_id,doc_type,date,cboxid)
 VALUES(1,1,10,0,1,2,'2026-11-08',0),(2,1,6,6,1,1,'2026-11-08',1);
INSERT INTO bill_details(id,bill_id,prod_id,store_id,amount,price,total)
 VALUES(1,1,1,1,2.5,4,10);
""");
      final parsed=await backup.inspect(sql,'legacy.sql');
      expect(parsed.format,'legacy-sql');
      expect(parsed.legacy,true);
      expect(parsed.counts['ledger'],2);
      expect(parsed.collections['accounts']!.single['groupId'],1);
      expect(parsed.collections['ledger']!.last['direction'],'debit');
      final beforeSql=(await backup.replacementBackup())!;
      await migrate.activate(parsed,replacementSha:sha256.convert(beforeSql).toString());
      expect(await LegacyOperationalRestore.original(db),orderedEquals(await sql.readAsBytes()));
      expect((await db.query('ledger_entries')),hasLength(2));
      expect((await db.query('journal_entries')),isEmpty);
      final sqlDetail=await LegacyOperationalRestore.invoice(db,'legacy-ent-1');
      expect((sqlDetail!['lines'] as List).single['quantity'],2.5);
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
