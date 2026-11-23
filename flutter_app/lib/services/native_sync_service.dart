import 'package:firebase_auth/firebase_auth.dart';
import 'local_database.dart';
import 'firebase_sync_auth.dart';
import 'http_sync_transport.dart';
import 'remote_account_applier.dart';
import 'sqlite_remote_change_store.dart';
import 'sync_engine.dart';

class NativeSyncService {
  static bool _running = false;

  static Future<void> synchronize() async {
    if (_running) return;
    _running = true;
    try {
      const endpoint = String.fromEnvironment('NASQO_SYNC_ENDPOINT');
      const workspace = String.fromEnvironment('NASQO_SYNC_WORKSPACE');
      if (endpoint.isEmpty || workspace.isEmpty) {
        throw StateError('Sync configuration missing');
      }
      await FirebaseSyncAuth.initialize();
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) throw StateError('Sign in required');
      final local = LocalDatabase.instance;
      final db = await local.database;
      // Existing domain tables are single-workspace. Require explicit local
      // enrollment rather than silently attaching existing data to a cloud user.
      final binding = await db.query('erp_state',
          where: 'stateKey = ?', whereArgs: ['sync_binding']);
      if (binding.length != 1 ||
          binding.single['payloadJson'] != '$uid:$workspace') {
        throw StateError('Local workspace enrollment required');
      }
      final transport = HttpSyncTransport(Uri.parse(endpoint), () async {
        if (FirebaseAuth.instance.currentUser?.uid != uid) {
          throw StateError('Authentication changed');
        }
        return FirebaseSyncAuth.token();
      });
      await SyncEngine(local, transport,
          SqliteRemoteChangeStore(local, applyRemoteAccount))
          .synchronize(workspace);
    } finally {
      _running = false;
    }
  }
}
