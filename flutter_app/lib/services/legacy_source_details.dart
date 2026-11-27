import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'local_backup_restore.dart';
import 'local_database.dart';

/// Read-only display recovery for imports made before complete source notes and
/// reference/discount metadata were mapped. This never activates a backup.
class LegacySourceDetails {
  static const version = 1;
  // The source hash identifies immutable contents. Keep only one business's
  // derived metadata in memory; a restart safely reconstructs it from SQLite.
  static String? _sha;
  static Future<Map<String, Map<String, dynamic>>>? _pending;

  static Future<Map<String, Map<String, dynamic>>> load(
    String sha, Future<Uint8List> Function() readOriginal,
  ) async {
    if (_sha == sha && _pending != null) return _pending!;
    final pending = _read(sha, readOriginal);
    _sha = sha;
    _pending = pending;
    try {
      return await pending;
    } catch (_) {
      if (identical(_pending, pending)) { _sha = null; _pending = null; }
      rethrow;
    }
  }

  static Future<Map<String, Map<String, dynamic>>> _read(
    String sha, Future<Uint8List> Function() readOriginal,
  ) async {
    final bytes = await readOriginal();
    if (sha256.convert(bytes).toString() != sha) {
      throw StateError('Original source checksum mismatch');
    }
    final dir = await Directory.systemTemp.createTemp('nasqo-source-details-');
    try {
      final file = await File('${dir.path}/source.back').writeAsBytes(bytes);
      final source = await LocalBackupRestore(LocalDatabase.instance)
          .inspect(file, 'source.back');
      if (!source.legacy || source.sha != sha) {
        throw StateError('Unsupported original metadata source');
      }
      return {
        for (final row in source.collections['ledger']!) row['id'] as String: {
          'details': row['details'],
          if (row.containsKey('sourceReference')) 'sourceReference': row['sourceReference'],
          if (row.containsKey('headerDiscount')) 'headerDiscount': row['headerDiscount'],
        },
      };
    } finally {
      await dir.delete(recursive: true);
    }
  }

  /// Expand only the exact old importer output. A changed live description or
  /// independently changed archive description always wins over source text.
  static void overlay(Map<String, dynamic> target,
      Map<String, dynamic> archived, Map<String, dynamic>? original) {
    if (original == null) return;
    final full = original['details'] as String? ?? '';
    final trimmed = full.trim();
    final oldPreview = trimmed.length > 600 ? trimmed.substring(0, 600) : trimmed;
    if (archived['details'] == oldPreview && target['details'] == oldPreview) {
      target['details'] = full;
    }
    for (final key in ['sourceReference', 'headerDiscount']) {
      if (!target.containsKey(key) && !archived.containsKey(key) && original.containsKey(key)) {
        target[key] = original[key];
      }
    }
  }
}
