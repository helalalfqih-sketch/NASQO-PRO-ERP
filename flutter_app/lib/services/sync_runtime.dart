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
        await LocalDatabase.requireLiveWorkspace(txn);
        if(await LocalDatabase.hasLegacyOperational(txn))throw StateError('Imported workspace needs separate server migration');
        if((await txn.query('sync_outbox',where:"operation_type = 'account.delete'",limit:1)).isNotEmpty)
          throw StateError('Workspace contains local-only account deletions; migrate before synchronization');
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
      // Only the server-supported account operations may leave the device.
      // Other financial operations remain pending until their server handlers are implemented.
      await SyncEngine(local, transport, remote,
        allowedOperationTypes: const {'account.create','account.update'}).synchronize(workspaceId);
    } finally {
      _running = false;
    }
  }
}
