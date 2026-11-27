import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/sync_engine.dart';
import 'package:nasqo_pro_erp/services/sqlite_remote_change_store.dart';

void main() {
  test('remote pages are atomic and replay safe', () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_remote_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance;
    final db = await local.database;
    try {
      await db.execute('CREATE TABLE remote_effect (id TEXT PRIMARY KEY)');
      final store = SqliteRemoteChangeStore(local, (txn, workspace, op) async {
        await txn.insert('remote_effect', {'id': op['operation_id']});
        if (op['fail'] == true) throw StateError('unsupported change');
      });
      Map<String, dynamic> op(String id, {bool fail = false, String workspace = 'w'}) =>
          {'operation_id': id, 'workspace_id': workspace, 'fail': fail};
      await store.applyPage('w', null, SyncPage('c1', [op('a')]));
      await store.applyPage('w', 'c1', SyncPage('c2', [op('a')]));
      expect(await db.query('remote_effect'), hasLength(1));
      await expectLater(store.applyPage('w', 'c2',
          SyncPage('c3', [op('b'), op('c', fail: true)])), throwsStateError);
      expect(await store.cursor('w'), 'c2');
      expect(await db.query('remote_effect'), hasLength(1));
      await expectLater(store.applyPage('w', 'c2',
          SyncPage('c3', [op('d', workspace: 'other')])), throwsStateError);
      expect(await store.cursor('w'), 'c2');
      await expectLater(store.applyPage('w', 'c1',
          SyncPage('c4', [])), throwsStateError);
    } finally {
      await db.close();
      await dir.delete(recursive: true);
    }
  });
}
