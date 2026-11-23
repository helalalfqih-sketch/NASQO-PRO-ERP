import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'hybrid_protocol.dart';

/// Structured receipt mirroring NASQO Flutter's `PostingReceipt` protection model.
///
/// When integrating on branch `integration/hybrid-seven-20261121` (commit 0d734ca),
/// map this directly to/from the existing `PostingReceipt` class in your financial
/// posting service via [ExternalPostingReceiptBridge] so there is a single
/// receipt source across Flutter and React Hybrid.
class HybridPostingReceipt {
  const HybridPostingReceipt({
    required this.receiptId,
    required this.idempotencyKey,
    required this.action,
    required this.requestHash,
    required this.postedAtMs,
    this.ledgerEntryId,
    this.entryNumber,
    this.replayed = false,
  });

  final String receiptId;
  final String idempotencyKey;
  final String action;
  final String requestHash;
  final int postedAtMs;
  final String? ledgerEntryId;
  final int? entryNumber;
  final bool replayed;

  Map<String, Object?> toJson() => <String, Object?>{
        'receiptId': receiptId,
        'idempotencyKey': idempotencyKey,
        'action': action,
        'requestHash': requestHash,
        'postedAtMs': postedAtMs,
        if (ledgerEntryId != null) 'ledgerEntryId': ledgerEntryId,
        if (entryNumber != null) 'entryNumber': entryNumber,
        'replayed': replayed,
      };
}

/// Optional delegate to plug in the existing `PostingReceipt` store/service
/// from commit 0d734ca if it already persists receipts inside `LocalDatabase`.
abstract class ExternalPostingReceiptBridge {
  Future<HybridPostingReceipt?> findByIdempotencyKey(String idempotencyKey);
  Future<void> recordReceipt(
    HybridPostingReceipt receipt,
    String responseJson,
  );
}

/// Guard that prevents duplicate financial posting using the EXISTING
/// `LocalDatabase` SQLite connection (`nasqo_pro_erp.db` — NEVER a parallel DB).
///
/// Adds one lightweight guard table (`posting_receipts`) inside the SAME
/// SQLite database with `idempotency_key TEXT PRIMARY KEY` and executes the
/// check + write atomically inside `db.transaction`.
class PostingReceiptGuard {
  PostingReceiptGuard({
    required Future<Database> Function() databaseProvider,
    this.externalBridge,
  }) : _databaseProvider = databaseProvider;

  final Future<Database> Function() _databaseProvider;
  final ExternalPostingReceiptBridge? externalBridge;
  bool _tableEnsured = false;

  static const String tableName = 'posting_receipts';

  static Future<void> ensureTable(DatabaseExecutor db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS $tableName (
        idempotency_key TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        action TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        ledger_entry_id TEXT,
        entry_number INTEGER,
        response_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      )
    ''');
  }

  /// Executes [postWork] exactly once for a given [idempotencyKey].
  ///
  /// - First call: executes [postWork], persists both the domain changes and
  ///   the `PostingReceipt` record, and returns `{...result, 'postingReceipt': ...}`.
  /// - Identical retry (same key + action + canonical payload hash): returns
  ///   the cached response with `postingReceipt.replayed == true` without re-posting.
  /// - Conflicting reuse (same key + different action or altered payload):
  ///   throws `HybridBridgeException('DUPLICATE_REQUEST', ...)`.
  Future<Map<String, Object?>> executeProtected({
    required String action,
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required Future<Map<String, Object?>> Function(
      Transaction txn,
      String receiptId,
    ) postWork,
  }) async {
    final db = await _databaseProvider();
    if (!_tableEnsured) {
      await ensureTable(db);
      _tableEnsured = true;
    }

    final requestHash = computeCanonicalRequestHash(action, payload);
    final nowMs = DateTime.now().millisecondsSinceEpoch;

    if (externalBridge != null) {
      final externalExisting =
          await externalBridge!.findByIdempotencyKey(idempotencyKey);
      if (externalExisting != null &&
          (externalExisting.action != action ||
              externalExisting.requestHash != requestHash)) {
        throw const HybridBridgeException(
          'DUPLICATE_REQUEST',
          'تم رفض العملية: مفتاح PostingReceipt مستخدم مسبقًا لعملية مختلفة.',
        );
      }
    }

    return db.transaction<Map<String, Object?>>((txn) async {
      await ensureTable(txn);

      final existing = await txn.query(
        tableName,
        where: 'idempotency_key = ?',
        whereArgs: [idempotencyKey],
        limit: 1,
      );

      if (existing.isNotEmpty) {
        final row = existing.first;
        final prevAction = row['action'] as String? ?? '';
        final prevHash = row['request_hash'] as String? ?? '';

        if (prevAction == action && prevHash == requestHash) {
          final decoded = jsonDecode(row['response_json'] as String);
          final resultMap = decoded is Map
              ? decoded.map((k, v) => MapEntry(k.toString(), v))
              : <String, Object?>{};
          final receipt = HybridPostingReceipt(
            receiptId: row['receipt_id'] as String? ?? '',
            idempotencyKey: idempotencyKey,
            action: prevAction,
            requestHash: prevHash,
            postedAtMs: (row['created_at_ms'] as num?)?.toInt() ?? nowMs,
            ledgerEntryId: row['ledger_entry_id'] as String?,
            entryNumber: (row['entry_number'] as num?)?.toInt(),
            replayed: true,
          );
          resultMap['postingReceipt'] = receipt.toJson();
          return resultMap;
        }

        throw const HybridBridgeException(
          'DUPLICATE_REQUEST',
          'تم رفض الطلب: مفتاح عدم التكرار (PostingReceipt) مستخدم مسبقًا ببيانات مختلفة.',
        );
      }

      final receiptId = 'rcpt_${nowMs}_${idempotencyKey.hashCode.abs()}';
      final result = await postWork(txn, receiptId);

      String? ledgerEntryId;
      int? entryNumber;
      final entryObj = result['entry'];
      if (entryObj is Map) {
        ledgerEntryId = entryObj['id'] as String?;
        entryNumber = (entryObj['entryNumber'] as num?)?.toInt();
      }

      final receipt = HybridPostingReceipt(
        receiptId: receiptId,
        idempotencyKey: idempotencyKey,
        action: action,
        requestHash: requestHash,
        postedAtMs: nowMs,
        ledgerEntryId: ledgerEntryId,
        entryNumber: entryNumber,
        replayed: false,
      );

      final enriched = <String, Object?>{
        ...result,
        'postingReceipt': receipt.toJson(),
      };
      final encodedResponse = jsonEncode(enriched);

      await txn.insert(
        tableName,
        <String, Object?>{
          'idempotency_key': idempotencyKey,
          'receipt_id': receiptId,
          'action': action,
          'request_hash': requestHash,
          'ledger_entry_id': ledgerEntryId,
          'entry_number': entryNumber,
          'response_json': encodedResponse,
          'created_at_ms': nowMs,
        },
        conflictAlgorithm: ConflictAlgorithm.abort,
      );

      if (externalBridge != null) {
        await externalBridge!.recordReceipt(receipt, encodedResponse);
      }

      return enriched;
    });
  }
}
