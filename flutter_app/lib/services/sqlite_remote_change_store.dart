import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'sync_engine.dart';

typedef RemoteOperationApplier = Future<void> Function(
    Transaction txn, String workspaceId, Map<String, dynamic> operation);

class SqliteRemoteChangeStore implements RemoteChangeStore {
  SqliteRemoteChangeStore(this.local, this.applyOperation);
  final LocalDatabase local;
  final RemoteOperationApplier applyOperation;

  @override
  Future<String?> cursor(String workspaceId) async {
    final db = await local.database;
    final rows = await db.query('sync_state',
        where: 'workspace_id = ?', whereArgs: [workspaceId]);
    return rows.isEmpty ? null : rows.single['pull_cursor'] as String?;
  }

  @override
  Future<void> applyPage(String workspaceId, String? expectedCursor,
      SyncPage page) async {
    if (workspaceId.isEmpty || page.nextCursor.isEmpty) {
      throw ArgumentError('Missing workspace or cursor');
    }
    final db = await local.database;
    await db.transaction((txn) async {
      final state = await txn.query('sync_state',
          where: 'workspace_id = ?', whereArgs: [workspaceId]);
      final actual = state.isEmpty ? null : state.single['pull_cursor'];
      if (actual != expectedCursor) throw StateError('Stale sync cursor');
      for (final operation in page.operations) {
        final id = operation['operation_id'];
        if (id is! String || id.isEmpty ||
            operation['workspace_id'] != workspaceId) {
          throw StateError('Invalid remote operation identity');
        }
        final seen = await txn.query('sync_inbox',
            where: 'workspace_id = ? AND operation_id = ?',
            whereArgs: [workspaceId, id]);
        if (seen.isNotEmpty) continue;
        final own = await txn.query('sync_outbox',
            where: 'workspace_id = ? AND operation_id = ?',
            whereArgs: [workspaceId, id]);
        if (own.isNotEmpty) {
          if (own.single['acknowledged_at'] == null ||
              own.single['server_revision'] != operation['server_revision']) {
            throw StateError('Unverified local operation echo');
          }
        } else {
          await applyOperation(txn, workspaceId, operation);
        }
        await txn.insert('sync_inbox', {
          'workspace_id': workspaceId, 'operation_id': id,
        });
      }
      await txn.insert('sync_state', {
        'workspace_id': workspaceId,
        'pull_cursor': page.nextCursor,
        'last_success_at': DateTime.now().toUtc().toIso8601String(),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    });
  }
}
