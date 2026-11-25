import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_history_archive.dart';
import 'package:nasqo_pro_erp/services/legacy_archive_records.dart';
import 'package:nasqo_pro_erp/services/local_document_lifecycle.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

void main(){
  test('normal destinations read all archive records and persist only explicit reminder state',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-archive-records-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    final file=File('${dir.path}/synthetic.back');
    final src=await databaseFactoryFfi.openDatabase(file.path);
    try{
      for(final sql in [
        'CREATE TABLE currencies(id INTEGER PRIMARY KEY,name TEXT)',
        'CREATE TABLE boxes(id INTEGER PRIMARY KEY,name TEXT,cur INTEGER)',
        'CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,type INTEGER)',
        'CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT)',
        'CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER)',
        'CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER)',
        'CREATE TABLE offers(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER,details TEXT)',
        'CREATE TABLE offer_bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,amount REAL,price REAL,total REAL,unit TEXT,unitnum INTEGER)',
        'CREATE TABLE bin(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,ndate TEXT,details TEXT)',
        'CREATE TABLE bin_bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,amount REAL,price REAL,total REAL,store_id INTEGER,unitnum INTEGER)',
        'CREATE TABLE alerts(id INTEGER PRIMARY KEY,per_id INTEGER,mdate TEXT,det TEXT)',
      ]){await src.execute(sql);}
      await src.insert('currencies',{'id':1,'name':'ريال'});
      await src.insert('boxes',{'id':1,'name':'العملاء','cur':1});
      await src.insert('customers',{'id':1,'name':'Synthetic account','type':1});
      await src.insert('stores',{'id':1,'name':'Synthetic warehouse'});
      await src.insert('products',{'id':1,'name':'Synthetic item','unit':'حبة','price':10,'price2':5,'cur':1});
      for(var i=1;i<=55;i++){
        await src.insert('offers',{'id':i,'per_id':1,'dain':10,'madin':0,'cur':1,'bill_type':1,'year':2026,'month':11,'day':8,'details':i==1?'ط'.padRight(900,'ط'):'Synthetic offer $i'});
        await src.insert('offer_bill_details',{'id':i,'bill_id':i,'prod_id':1,'amount':1,'price':10,'total':10,'unit':'حبة','unitnum':1});
      }
      await src.insert('bin',{'id':1,'per_id':1,'dain':10,'madin':0,'cur':1,'bill_type':2,'ndate':'20261108','details':'Deleted original'});
      await src.insert('bin_bill_details',{'id':1,'bill_id':1,'prod_id':1,'amount':1,'price':10,'total':10,'store_id':1,'unitnum':1});
      await src.insert('alerts',{'id':1,'per_id':1,'mdate':'2026-11-08 08:00:00','det':'Original reminder'});
      await src.close();
      final backup=LocalBackupRestore(local),candidate=await LocalBackupRestore(local).inspect(file,'synthetic.back');
      await LegacyOperationalRestore(local).activate(candidate);
      final service=LegacyArchiveRecords(local),base={'workspaceId':'local-erp-workspace'};
      final before=await backup.exportNative();
      final page=await service.handle({...base,'operation':'list','recordKind':'offers','limit':50});
      expect(page['totalCount'],55);expect(page['nextOffset'],50);
      final next=await service.handle({...base,'operation':'list','recordKind':'offers','offset':50,'limit':50});
      expect(next['nextOffset'],null);
      expect({...((page['items'] as List).map((e)=>e['id'])),...((next['items'] as List).map((e)=>e['id']))},hasLength(55));
      final detail=(await service.handle({...base,'operation':'detail','recordKind':'offers','recordId':'1','sourceSha':candidate.sha}))['record'];
      expect(detail['details'].length,900);expect(detail['entryDate'],'2026-11-08');
      expect(detail['accountId'],'legacy-acc-1');expect(detail['amount'],10);expect(detail['payment'],'credit');expect(detail['exchangeRate'],1);
      expect(detail['lines'].single['inventoryItemId'],'legacy-prod-1');
      expect((await HybridLocalSnapshotAdapter.readFromDevice())['workspace']['legacySourceSha'],candidate.sha);
      final trash=(await service.handle({...base,'operation':'detail','recordKind':'trash','recordId':'1','sourceSha':candidate.sha}))['record'];
      expect(trash['deleted'],true);expect(trash['lines'],hasLength(1));
      final alert=(await service.handle({...base,'operation':'detail','recordKind':'alerts','recordId':'1','sourceSha':candidate.sha}))['record'];
      expect(alert['entryDate'],'2026-11-08');expect(alert['read'],false);
      expect(await backup.exportNative(),orderedEquals(before));
      await service.handle({...base,'operation':'alertState','recordKind':'alerts','recordId':'1','sourceSha':candidate.sha,'read':true,'dismissed':true});
      final reloaded=(await LegacyArchiveRecords(local).handle({...base,'operation':'detail','recordKind':'alerts','recordId':'1','sourceSha':candidate.sha}))['record'];
      expect(reloaded['read'],true);expect(reloaded['dismissed'],true);
      await expectLater(service.handle({...base,'operation':'alertState','recordKind':'alerts','recordId':'1','sourceSha':'0'*64,'read':false,'dismissed':false}),throwsStateError);
      // A normalized unified offer retains exact IDs, currency, fields and money.
      await db.insert('legacy_operational_rows',{'collection':'source_offers','record_id':'unified-offer-0','row_json':jsonEncode({'id':'unified-offer-0','per_id':'legacy-acc-1','rawDain':12,'rawMadin':0,'currency':'sar','offerType':1,'offerDate':'2026-11-09','documentNumber':'S-1','sourceReference':'REF','headerDiscount':2})});
      await db.insert('legacy_operational_rows',{'collection':'source_offer_bill_details','record_id':'unified-offer-0:0','row_json':jsonEncode({'id':'unified-offer-0:0','bill_id':'unified-offer-0','prod_id':'legacy-prod-1','quantity':1,'price':12,'total':12,'unitNum':1})});
      final meta=Map<String,dynamic>.from(candidate.meta);
      meta['sourceExtraCounts']={...(meta['sourceExtraCounts'] as Map),'offers':56,'offer_bill_details':56};
      await db.update('legacy_operational_source',{'meta_json':jsonEncode(meta)});
      final unified=(await service.handle({...base,'operation':'detail','recordKind':'offers','recordId':'unified-offer-0','sourceSha':candidate.sha}))['record'];
      expect(unified['accountId'],'legacy-acc-1');expect(unified['currency'],'ريال');expect(unified['amount'],12);expect(unified['entryDate'],'2026-11-09');
      expect(unified['documentNumber'],'S-1');expect(unified['sourceReference'],'REF');expect(unified['headerDiscount'],2);
      expect(unified['lines'].single['inventoryItemId'],'legacy-prod-1');expect(unified['lines'].single['quantity'],1);
      await db.update('legacy_operational_rows',{'row_json':jsonEncode({'id':'unified-offer-0','per_id':'legacy-acc-1','dain':'invalid','madin':0,'currency':'sar'})},where:'collection = ? AND record_id = ?',whereArgs:['source_offers','unified-offer-0']);
      final invalid=(await service.handle({...base,'operation':'detail','recordKind':'offers','recordId':'unified-offer-0','sourceSha':candidate.sha}))['record'];
      expect(invalid['amountValid'],false);expect(invalid['draftBlockedReason'],isNotEmpty);
      for(final table in ['ledger_entries','journal_entries','journal_lines','stock_movements','sync_outbox']){expect(await db.query(table),isEmpty);}
      final copiedId='legacy-copy-${candidate.sha}-offers-2';
      final draftPayload=<String,dynamic>{'id':copiedId,'kind':'quote','accountId':'legacy-acc-1','payment':'credit',
        'direction':'debit','currency':'ريال','warehouseId':'legacy-wh-1','invoiceContent':'items','entryNumber':1,
        'entryDate':'2026-11-08','amount':10,'details':'Explicit copied draft','lines':[
          {'inventoryItemId':'legacy-prod-1','itemName':'Synthetic item','warehouseId':'legacy-wh-1','quantity':1,'price':10,'total':10,'unitNum':1}
        ]};
      await LocalDocumentLifecycle(local).saveDraft('local-erp-workspace','copy-once',draftPayload);
      expect((await db.query('ledger_entries')).single['postingStatus'],'draft');
      await db.update('legacy_operational_source',{'sha':'b'*64});
      await expectLater(LocalDocumentLifecycle(local).saveDraft('local-erp-workspace','copy-once',draftPayload),throwsStateError);
      await db.update('legacy_operational_source',{'sha':candidate.sha});
      await LocalDocumentLifecycle(local).saveDraft('local-erp-workspace','copy-once',draftPayload);
      expect(await db.query('ledger_entries'),hasLength(1));expect(await db.query('sync_outbox'),hasLength(1));
      for(final table in ['journal_entries','journal_lines','stock_movements']){expect(await db.query(table),isEmpty);}
      expect(await LegacyOperationalRestore.original(db),orderedEquals(candidate.bytes));
      final protocol=HybridReadOnlyProtocol(readSnapshot:()async=>{},legacyArchiveAction:service.handle);
      final invalidRequest=jsonDecode(await protocol.handle(jsonEncode({'protocolVersion':'1.0.0','kind':'request','requestId':'bad','action':'legacyArchiveAction','payload':{...base,'operation':'alertState','recordKind':'trash','recordId':'1','sourceSha':candidate.sha,'read':true,'dismissed':false}})));
      expect(invalidRequest['ok'],false);
      final archive=await LegacyHistoryArchive(local).load();expect(archive['source_bin']!.single['details'],'Deleted original');
    }finally{if(src.isOpen)await src.close();await db.close();await dir.delete(recursive:true);}
  });
  test('archive dates reject invalid or fractional calendar components',(){
    expect(LegacyArchiveRecords.date({'year':2026,'month':2,'day':30}),'');
    expect(LegacyArchiveRecords.date({'year':2026.5,'month':11,'day':8}),'');
    expect(LegacyArchiveRecords.date({'mdate':'2024-02-29 08:00:00'}),'2024-02-29');
  });
}
