import 'package:firebase_auth/firebase_auth.dart';
import 'firebase_sync_auth.dart';
import 'http_sync_transport.dart';
import 'local_database.dart';
import 'remote_account_applier.dart';
import 'sqlite_remote_change_store.dart';
import 'sync_engine.dart';

class SyncRuntime {
  static bool _running = false;
  static Future<void> run(String workspaceId, String expectedUid) async {
    if (_running) throw StateError('Sync already running');
    _running = true;
    try {
      await FirebaseSyncAuth.initialize();
      if (FirebaseAuth.instance.currentUser?.uid != expectedUid ||
          expectedUid.isEmpty || workspaceId.isEmpty) {
        throw StateError('Workspace session mismatch');
      }
      const endpoint = String.fromEnvironment('NASQO_SYNC_ENDPOINT');
      if (endpoint.isEmpty) throw StateError('Sync endpoint not configured');
      final local = LocalDatabase.instance;
      final db = await local.database;
      // Existing domain tables are single-workspace. Never mix tenants.
      await db.transaction((txn) async {
        final rows = await txn.query('erp_state', where: 'stateKey = ?',
            whereArgs: ['sync_workspace_binding']);
        if (rows.isEmpty) {
          throw StateError('Explicit local workspace enrollment required');
        }
        if (rows.single['payloadJson'] != workspaceId) {
          throw StateError('Local workspace mismatch');
        }
      });
      final transport = HttpSyncTransport(Uri.parse(endpoint), () async {
        if (FirebaseAuth.instance.currentUser?.uid != expectedUid) {
          throw StateError('Session changed');
        }
        return FirebaseSyncAuth.token();
      });
      final remote = SqliteRemoteChangeStore(local, applyRemoteAccount);
      await SyncEngine(local, transport, remote).synchronize(workspaceId);
    } finally {
      _running = false;
    }
  }
}
