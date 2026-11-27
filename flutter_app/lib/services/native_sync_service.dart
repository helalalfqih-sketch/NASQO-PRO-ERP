import 'package:firebase_auth/firebase_auth.dart';
import 'local_database.dart';
import 'firebase_sync_auth.dart';
import 'sync_runtime.dart';

/// Compatibility entry point for the old scheduler. Uses the same restricted
/// runtime and explicit local binding; never a compiled global workspace or a
/// second unrestricted outbox writer. Enrollment is a separate user operation.
class NativeSyncService {
  static Future<void> synchronize() async {
    await FirebaseSyncAuth.initialize();
    final uid=FirebaseAuth.instance.currentUser?.uid;
    if(uid==null)throw StateError('Sign in required');
    final db=await LocalDatabase.instance.database;
    final rows=await db.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding']);
    if(rows.length!=1||rows.single['payloadJson'] is! String||(rows.single['payloadJson'] as String).isEmpty){
      throw StateError('Explicit authorized workspace enrollment required');
    }
    // The HTTP server must authorize this uid's membership for every operation.
    await SyncRuntime.run(rows.single['payloadJson'] as String,uid);
  }
}
