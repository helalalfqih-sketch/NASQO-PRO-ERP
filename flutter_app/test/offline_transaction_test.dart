import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';

void main() {
  test('atomic operation replay, rollback and acknowledgement', () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_test_');
    await databaseFactory.setDatabasesPath(dir.path);
    final store = LocalDatabase.instance;
    final db = await store.database;
    try {
      await db.execute('CREATE TABLE test_effect (id TEXT PRIMARY KEY)');
      Future<Map<String, dynamic>> commit(String id, {bool fail = false, int amount = 8000}) =>
          store.commitOperation(
            workspaceId: 'test',
            operationId: id,
            operationType: 'test',
            payload: {'id': id, 'amount': amount},
            apply: (txn) async {
              await txn.insert('test_effect', {'id': id});
              if (fail) throw StateError('rollback');
              return {'id': id};
            },
          );
      expect(await commit('one'), {'id': 'one'});
      expect(await commit('one'), {'id': 'one'});
      expect(await db.query('test_effect'), hasLength(1));
      expect(await store.pendingOperations('test'), hasLength(1));
      await expectLater(commit('two', fail: true), throwsStateError);
      expect(await db.query('test_effect'), hasLength(1));
      expect(await store.pendingOperations('test'), hasLength(1));
      await expectLater(commit('one', amount: 9000), throwsStateError);
      expect(await db.query('test_effect'), hasLength(1));
      expect(await store.pendingOperations('test'), hasLength(1));
      expect(await commit('two'), {'id': 'two'});
      expect(await commit('two'), {'id': 'two'});
      expect(await db.query('test_effect'), hasLength(2));
      expect(await store.pendingOperations('test'), hasLength(2));
      await expectLater(
        store.acknowledgeOperation('test', 'two', 'rev2'), throwsArgumentError);
      expect(await store.pendingOperations('test'), hasLength(2));
      await store.acknowledgeOperation('test', 'two', '2');
      await store.acknowledgeOperation('test', 'one', '1');
      await store.acknowledgeOperation('test', 'one', '1');
      expect(await store.pendingOperations('test'), isEmpty);
      await expectLater(
        store.acknowledgeOperation('test', 'one', '2'), throwsStateError);
    } finally {
      await db.close();
      await dir.delete(recursive: true);
    }
  });
}
