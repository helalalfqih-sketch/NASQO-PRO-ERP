import 'dart:convert';
import 'local_database.dart';

abstract class SyncTransport {
  Future<String> push(String workspaceId, String operationId,
      String operationType, Map<String, dynamic> payload);
  Future<SyncPage> pull(String workspaceId, String? cursor);
}

class SyncPage {
  const SyncPage(this.nextCursor, this.operations);
  final String nextCursor;
  final List<Map<String, dynamic>> operations;
}

/// The implementation must apply changes, deduplicate remote operations and
/// advance the cursor in one SQLite transaction. Conflicts must not be lost.
abstract class RemoteChangeStore {
  Future<String?> cursor(String workspaceId);
  Future<void> applyPage(String workspaceId, String? expectedCursor, SyncPage page);
}

class SyncEngine {
  SyncEngine(this.local, this.transport, this.remote);
  final LocalDatabase local;
  final SyncTransport transport;
  final RemoteChangeStore remote;
  bool _running = false;

  Future<void> synchronize(String workspaceId) async {
    if (workspaceId.isEmpty) throw ArgumentError('Missing workspace');
    if (_running) throw StateError('Synchronization already running');
    _running = true;
    try {
      final pending = await local.pendingOperations(workspaceId);
      for (final row in pending) {
        final id = row['operation_id'] as String;
        final revision = await transport.push(workspaceId, id,
            row['operation_type'] as String,
            jsonDecode(row['payload_json'] as String) as Map<String, dynamic>);
        await local.acknowledgeOperation(workspaceId, id, revision);
      }
      final cursor = await remote.cursor(workspaceId);
      final page = await transport.pull(workspaceId, cursor);
      if (page.nextCursor.isEmpty) throw StateError('Invalid remote cursor');
      await remote.applyPage(workspaceId, cursor, page);
    } finally {
      _running = false;
    }
  }
}
