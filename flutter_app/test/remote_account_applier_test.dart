import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../lib/services/remote_account_applier.dart';

void main() {
  sqfliteFfiInit();
  test('remote account rejects cross-workspace and rolls back duplicate page', () async {
    final db = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
    try {
      await db.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, category TEXT, phone TEXT, currency TEXT, note TEXT, openingDirection TEXT, creditLimit REAL, openingBalance REAL, isCashAccount INTEGER, codeNumber INTEGER)');
      final op = <String,dynamic>{
        'workspace_id':'w1','operation_type':'account.create',
        'payload': <String,dynamic>{
          'id':'a1','name':'Account','category':'clients','phone':'',
          'currency':'sar','note':'','openingDirection':'debit',
          'creditLimit':0,'openingBalance':0,'isCashAccount':0,'codeNumber':1,
        },
      };
      await expectLater(db.transaction((txn) => applyRemoteAccount(txn,'w2',op)), throwsStateError);
      await expectLater(db.transaction((txn) async {
        await applyRemoteAccount(txn,'w1',op);
        await applyRemoteAccount(txn,'w1',op);
      }), throwsA(isA<DatabaseException>()));
      expect(await db.query('accounts'), isEmpty);
      await db.transaction((txn) => applyRemoteAccount(txn,'w1',op));
      expect((await db.query('accounts')).single['id'],'a1');
    } finally {
      await db.close();
    }
  });
}
