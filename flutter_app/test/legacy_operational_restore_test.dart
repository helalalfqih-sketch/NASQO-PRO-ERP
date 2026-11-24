import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
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
      await src.execute('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER)');
      await src.execute('CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER,curprice REAL,cboxid INTEGER)');
      await src.execute('CREATE TABLE bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,store_id INTEGER,amount REAL,price REAL,total REAL)');
      await src.insert('currencies',{'id':1,'name':'ريال','amount':1});
      await src.insert('boxes',{'id':1,'name':'العملاء','cur':1});
      await src.insert('customers',{'id':1,'name':'Client','type':1,'lim':0});
      await src.insert('customers',{'id':2,'name':'Counterpart','type':1,'lim':0});
      await src.insert('stores',{'id':1,'name':'Main'});
      await src.insert('products',{'id':1,'name':'Product','unit':'piece','price':5,'price2':3,'cur':1});
      for(final movement in [
        {'id':1,'dain':10,'madin':0,'cur':1,'bill_type':2},
        {'id':2,'dain':7,'madin':7,'cur':1,'bill_type':2},
        {'id':3,'dain':0,'madin':4,'cur':1,'bill_type':1},
        {'id':4,'dain':900,'madin':0,'cur':99,'bill_type':1},
        {'id':5,'dain':8,'madin':3,'cur':1,'bill_type':1},
      ]){
        await src.insert('input_move',{...movement,'per_id':1,'year':2026,'month':11,'day':8,'curprice':0,'cboxid':0});
      }
      await src.insert('bill_details',{'id':1,'bill_id':1,'prod_id':1,'store_id':1,'amount':2.5,'price':4,'total':10});
      await src.close();
      final candidate=await backup.inspect(file,'fixture.back');
      expect(candidate.meta['unknownCurrencies'],1);
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
      expect(rows.where((r)=>r['postingStatus']=='posted'),hasLength(3));
      expect(rows.firstWhere((r)=>r['id']=='legacy-ent-4')['currency'],'عملة غير معرّفة (99)');
      final posted=rows.where((r)=>r['postingStatus']=='posted');
      expect(posted.fold<num>(0,(sum,e)=>sum+(e['rawMadin'] as num)-(e['rawDain'] as num)),-6);
      final detail=await LegacyOperationalRestore.invoice(db,'legacy-ent-1');
      expect((detail!['lines'] as List).single['quantity'],2.5);
      expect((view['inventory'] as List).single['quantityUnverified'],true);
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
      final export=await backup.exportNative();
      final saved=await File('${dir.path}/native.back').writeAsBytes(export);
      final restored=await backup.inspect(saved,'native.back');
      expect(restored.native,isTrue);
      expect(restored.counts['legacy_operational_source'],1);
      expect(restored.counts['legacy_unverified_stock'],1);
      // Test-only simulation of an empty destination; no production erase path.
      await db.transaction((t)async{
        for(final table in LocalBackupRestore.tables.reversed){await t.delete(table);}
      });
      await backup.restoreNative(restored);
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      expect((await db.query('ledger_entries')),hasLength(6));
      expect((await db.query('journal_lines')),hasLength(2));
    }finally{await db.close();await dir.delete(recursive:true);}
  });
}
