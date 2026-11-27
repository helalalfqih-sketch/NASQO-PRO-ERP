import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/models/erp_models.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/journal_posting.dart';

void main() {
  test('balanced journal and outbox commit together; invalid journals leave no effects', () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_journal_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance;
    final db = await local.database;
    const workspace = 'journal-test';
    final time = DateTime.utc(2026,1,1);
    final posting = JournalPosting(local);
    final lines = [
      const JournalLine(accountId:'cash',debitMinor:10001),
      const JournalLine(accountId:'revenue',creditMinor:9999),
      const JournalLine(accountId:'revenue',creditMinor:2),
    ];
    Future<Map<String,dynamic>> post(String id,List<JournalLine> rows,
        {String tenant=workspace,String? journalId}) =>
      posting.post(workspaceId:tenant,operationId:id,
        journalId:journalId ?? id,currency:CurrencyCode.sar,
        createdAt:time,lines:rows);
    try {
      await local.createAccountAtomic(workspace,'op-cash',const AccountRecord(
        id:'cash',name:'Cash',category:AccountCategory.transfers,isCashAccount:true));
      await local.createAccountAtomic(workspace,'op-revenue',const AccountRecord(
        id:'revenue',name:'Revenue',category:AccountCategory.sales));
      await local.createAccountAtomic(workspace,'op-usd',const AccountRecord(
        id:'foreign',name:'USD account',category:AccountCategory.clients,
        currency:CurrencyCode.usd));
      final before = await local.pendingOperations(workspace);
      await expectLater(post('not-enrolled',lines),throwsStateError);
      await db.insert('erp_state',{'stateKey':'sync_workspace_binding',
        'payloadJson':workspace,'updatedAt':time.toIso8601String()});
      await expectLater(post('unbalanced',[
        const JournalLine(accountId:'cash',debitMinor:101),
        const JournalLine(accountId:'revenue',creditMinor:100),
      ]),throwsArgumentError);
      await expectLater(post('both-sides',[
        const JournalLine(accountId:'cash',debitMinor:100,creditMinor:1),
        const JournalLine(accountId:'revenue',creditMinor:99),
      ]),throwsArgumentError);
      await expectLater(post('wrong-currency',[
        const JournalLine(accountId:'cash',debitMinor:100),
        const JournalLine(accountId:'foreign',creditMinor:100),
      ]),throwsStateError);
      await expectLater(post('missing-account',[
        const JournalLine(accountId:'cash',debitMinor:100),
        const JournalLine(accountId:'missing',creditMinor:100),
      ]),throwsStateError);
      await expectLater(post('other-tenant',lines,tenant:'other'),throwsStateError);
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('journal_lines'),isEmpty);
      expect(await local.pendingOperations(workspace),before);

      expect(await post('valid',lines),{'id':'valid','total_minor':10001});
      expect(await post('valid',lines),{'id':'valid','total_minor':10001});
      expect(await db.query('journal_entries'),hasLength(1));
      expect(await db.query('journal_lines'),hasLength(3));
      final sum = (await db.rawQuery('SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit FROM journal_lines')).single;
      expect(sum['debit'],10001);
      expect(sum['credit'],10001);
      expect(await local.pendingOperations(workspace),hasLength(before.length+1));
      await expectLater(post('different-operation',lines,journalId:'valid'),
        throwsA(isA<DatabaseException>()));
      await expectLater(post('valid',[
        const JournalLine(accountId:'cash',debitMinor:1),
        const JournalLine(accountId:'revenue',creditMinor:1),
      ]),throwsStateError);
      expect(await db.query('journal_entries'),hasLength(1));
      expect(await db.query('journal_lines'),hasLength(3));
      expect(await local.pendingOperations(workspace),hasLength(before.length+1));
    } finally {
      await db.close();
      await dir.delete(recursive:true);
    }
  });
}
