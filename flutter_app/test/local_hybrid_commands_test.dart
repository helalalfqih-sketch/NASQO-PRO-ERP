import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/remote_account_applier.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main() {
  test('account create and edit, canonical sync, voucher and credit invoice are atomic', () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_local_commands_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance;
    final db = await local.database;
    const workspace = 'local-erp-workspace';
    final accountCommands = LocalAccountCommands(local);
    final documents = LocalDocumentCommands(local);
    Map<String,dynamic> account(String name,String category,{bool cash=false}) => {
      'name':name,'category':category,'currency':'ريال',
      'isCashAccount':cash,'openingBalance':0,'creditLimit':1000,
    };
    try {
      final client = await accountCommands.save(workspace,'create-client',account('Client','clients'));
      final cash = await accountCommands.save(workspace,'create-cash',account('Cash','transfers',cash:true));
      final revenue = await accountCommands.save(workspace,'create-revenue',account('Revenue','sales'));
      expect(await accountCommands.save(workspace,'create-client',account('Client','clients')),client);
      await expectLater(accountCommands.save(workspace,'duplicate',account('Client','clients')),throwsArgumentError);
      final edited = {...account('Renamed','clients'),'phone':'123'};
      await accountCommands.save(workspace,'edit-client',edited,accountId:client);
      expect(await accountCommands.save(workspace,'edit-client',edited,accountId:client),client);
      await expectLater(accountCommands.save(workspace,'bad-edit',
        {...edited,'currency':'دولار'},accountId:client),throwsArgumentError);
      final pending = await local.pendingOperations(workspace);
      expect(pending,hasLength(4));
      final creation = pending.firstWhere((r)=>r['operation_id']=='create-client');
      expect(creation['operation_type'],'account.create');
      final canonical = jsonDecode(creation['payload_json'] as String) as Map<String,dynamic>;
      expect(canonical['codeNumber'],1);
      expect(canonical['id'],client);
      final update = pending.firstWhere((r)=>r['operation_id']=='edit-client');
      final patch = jsonDecode(update['payload_json'] as String) as Map<String,dynamic>;
      expect(patch['before']['name'],'Client');
      expect(patch['after']['name'],'Renamed');
      final otherDb = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
      try {
        await otherDb.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, category TEXT, phone TEXT, currency TEXT, note TEXT, openingDirection TEXT, creditLimit REAL, openingBalance REAL, isCashAccount INTEGER, codeNumber INTEGER)');
        Map<String,dynamic> remote(String type,Map<String,dynamic> data) => {
          'workspace_id':workspace,'operation_type':type,'payload':data,
        };
        await otherDb.transaction((txn)=>applyRemoteAccount(txn,workspace,remote('account.create',canonical)));
        await otherDb.transaction((txn)=>applyRemoteAccount(txn,workspace,remote('account.update',patch)));
        expect((await otherDb.query('accounts')).single['name'],'Renamed');
        await expectLater(otherDb.transaction((txn)=>applyRemoteAccount(txn,workspace,remote('account.update',patch))),throwsStateError);
      } finally { await otherDb.close(); }

      final voucher = <String,dynamic>{
        'id':'receipt-1','kind':'voucher','accountId':client,'counterpartAccountId':cash,
        'currency':'ريال','direction':'credit','payment':'cash','amount':125.25,
        'entryNumber':1001,'entryDate':'2026-11-24','typeLabel':'Receipt',
      };
      expect(await documents.post(workspace,'receipt-op',voucher),'receipt-1');
      expect(await documents.post(workspace,'receipt-op',voucher),'receipt-1');
      await expectLater(documents.post(workspace,'duplicate-document',
        {...voucher,'id':'receipt-2'}),throwsStateError);
      await expectLater(documents.post(workspace,'bad-precision',
        {...voucher,'id':'bad','entryNumber':1002,'amount':1.001}),throwsArgumentError);
      await expectLater(documents.post(workspace,'bad-cash',
        {...voucher,'id':'bad','entryNumber':1002,'counterpartAccountId':revenue}),throwsArgumentError);
      final invoice = {...voucher,'id':'free-invoice','kind':'invoice','payment':'credit',
        'direction':'debit','invoiceContent':'free','counterpartAccountId':revenue,
        'entryNumber':1002,'amount':100.01,'lines':[]};
      await documents.post(workspace,'invoice-op',invoice);
      await expectLater(documents.post(workspace,'bad-invoice',
        {...invoice,'id':'stock-invoice','entryNumber':1003,'invoiceContent':'items',
          'lines':[{'itemName':'Stock'}]}),throwsArgumentError);
      final rows = await db.rawQuery('SELECT journal_id,SUM(debit_minor) AS debit,SUM(credit_minor) AS credit FROM journal_lines GROUP BY journal_id');
      expect(rows,hasLength(2));
      for(final row in rows) { expect(row['debit'],row['credit']); }
      expect(await db.query('ledger_entries'),hasLength(2));
      expect(await local.pendingOperations(workspace),hasLength(6));
      final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
      final ledger = (snapshot['ledger'] as List).cast<Map<String,dynamic>>();
      expect(ledger.firstWhere((e)=>e['id']=='receipt-1')['counterpartAccountId'],cash);
      expect(ledger.firstWhere((e)=>e['id']=='free-invoice')['invoiceContent'],'free');
    } finally {
      await db.close();
      await dir.delete(recursive:true);
    }
  });
}
