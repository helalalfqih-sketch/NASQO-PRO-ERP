import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';
import 'local_database.dart';

/// Amounts are already converted to integer minor units by the caller.
/// No implicit conversion, floating point arithmetic or exchange rates.
class JournalLine {
  const JournalLine({
    required this.accountId,
    this.debitMinor = 0,
    this.creditMinor = 0,
  });

  final String accountId;
  final int debitMinor;
  final int creditMinor;

  Map<String, dynamic> toJson() => {
    'account_id': accountId,
    'debit_minor': debitMinor,
    'credit_minor': creditMinor,
  };
}

class JournalPosting {
  JournalPosting(this.local);
  final LocalDatabase local;

  // Within exact JSON / JavaScript integer range, including accumulated totals.
  static const int maxMinor = 9007199254740991;
  static final _id = RegExp(r'^[A-Za-z0-9:_-]{1,120}$');

  /// Experimental repository API, not yet enabled in UI or cloud sync.
  /// Each request must retain its original ID, timestamp, and lines on retry.
  Future<Map<String, dynamic>> post({
    required String workspaceId,
    required String operationId,
    required String journalId,
    required CurrencyCode currency,
    required DateTime createdAt,
    required List<JournalLine> lines,
  }) async {
    if (!_id.hasMatch(workspaceId) || !_id.hasMatch(operationId) ||
        !_id.hasMatch(journalId) || lines.length < 2 || lines.length > 200) {
      throw ArgumentError('Invalid journal identity or line count');
    }
    // Currency 2 has no defined minor-unit convention in the current model.
    if (currency == CurrencyCode.currency2) {
      throw ArgumentError('Currency minor units are not configured');
    }
    final frozen = List<JournalLine>.unmodifiable(lines);
    var debit = 0;
    var credit = 0;
    final accounts = <String>{};
    for (final line in frozen) {
      if (!_id.hasMatch(line.accountId) || line.debitMinor < 0 ||
          line.creditMinor < 0 || (line.debitMinor == 0) == (line.creditMinor == 0) ||
          line.debitMinor > maxMinor - debit || line.creditMinor > maxMinor - credit) {
        throw ArgumentError('Invalid journal line or amount');
      }
      debit += line.debitMinor;
      credit += line.creditMinor;
      accounts.add(line.accountId);
    }
    if (debit == 0 || debit != credit || accounts.length < 2) {
      throw ArgumentError('Journal is not balanced across distinct accounts');
    }
    final timestamp = createdAt.toUtc().toIso8601String();
    final payload = <String, dynamic>{
      'journal_id': journalId,
      'currency': currency.name,
      'created_at': timestamp,
      'lines': frozen.map((line) => line.toJson()).toList(growable: false),
    };

    return local.commitOperation(
      workspaceId: workspaceId,
      operationId: operationId,
      operationType: 'journal.post',
      payload: payload,
      apply: (txn) async {
        // Legacy domain tables are not tenant-keyed. Require an explicitly
        // enrolled single workspace before writing to these tables.
        final binding = await txn.query('erp_state', columns: ['payloadJson'],
          where: 'stateKey = ?', whereArgs: ['sync_workspace_binding']);
        if (binding.length != 1 || binding.single['payloadJson'] != workspaceId) {
          throw StateError('Local workspace enrollment mismatch');
        }
        for (final id in accounts) {
          final row = await txn.query('accounts', columns: ['currency'],
            where: 'id = ?', whereArgs: [id], limit: 1);
          if (row.length != 1 || row.single['currency'] != currency.name) {
            throw StateError('Missing account or currency mismatch');
          }
        }
        await txn.insert('journal_entries', {
          'id': journalId, 'currency': currency.name, 'created_at': timestamp,
        }, conflictAlgorithm: ConflictAlgorithm.abort);
        for (var i = 0; i < frozen.length; i++) {
          await txn.insert('journal_lines', {
            'id': '$journalId:$i', 'journal_id': journalId,
            ...frozen[i].toJson(),
          }, conflictAlgorithm: ConflictAlgorithm.abort);
        }
        // All inserts and the outbox are committed by one SQLite transaction.
        return {'id': journalId, 'total_minor': debit};
      },
    );
  }
}
