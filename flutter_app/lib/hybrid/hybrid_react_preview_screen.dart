import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'hybrid_read_only_protocol.dart';
import '../models/erp_models.dart';
import 'local_snapshot_adapter.dart';
import '../services/local_database.dart';

/// Android-only debug preview of the original React/Vite UI.
///
/// Kotlin WebViewAssetLoader serves the bundled React files from an isolated
/// local HTTPS origin; no network or external navigation is permitted.
/// Only getSnapshot is implemented, with financial mutations explicitly denied.
class HybridReactPreviewScreen extends StatefulWidget {
  const HybridReactPreviewScreen({super.key, this.onShowNative});

  final VoidCallback? onShowNative;

  @override
  State<HybridReactPreviewScreen> createState() => _HybridReactPreviewScreenState();
}

class _HybridReactPreviewScreenState extends State<HybridReactPreviewScreen> {
  final HybridReadOnlyProtocol _protocol = HybridReadOnlyProtocol(
    readSnapshot: HybridLocalSnapshotAdapter.readFromDevice,
    saveUiPreferences: LocalDatabase.instance.saveUiPreferences,
    createAccount: _createAccount,
  );
  static Future<Map<String, dynamic>> _createAccount(
      String key, Map<String, dynamic> payload) async {
    final name = payload['name'];
    final category = payload['category'];
    final currency = payload['currency'];
    if (name is! String || name.trim().isEmpty || name.length > 100 ||
        !AccountCategory.values.any((v) => v.name == category) ||
        currency != 'ريال' || (payload['openingBalance'] ?? 0) != 0 ||
        payload['groupId'] != null ||
        !RegExp(r'^[A-Za-z0-9_-]{1,150}
  String? _error;

  Future<void> _attach(int viewId) async {
    final channel = MethodChannel('nasqo/offline_hybrid/$viewId');
    _channel = channel;
    channel.setMethodCallHandler((call) async {
      if (call.method != 'message' || call.arguments is! String) return null;
      try {
        final response = await _protocol.handle(call.arguments as String);
        await channel.invokeMethod<void>('respond', response);
      } catch (_) {
        if (mounted) {
          setState(() => _error = 'تعذر قراءة SQLite المحلية أو إيصال رد Flutter إلى React.');
        }
      }
      return null;
    });

    try {
      // Prevent a bootstrap race: native WebView starts after this handler exists.
      await channel.invokeMethod<void>('start');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تشغيل WebView المحلي على جهاز Android.');
      }
    }
  }

  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('نسقو — واجهة React المحلية'),
        actions: [
          if (widget.onShowNative != null)
            TextButton(
              onPressed: widget.onShowNative,
              child: const Text('واجهة Flutter'),
            ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.all(10),
            child: const Text(
              'وضع محلي تجريبي: إنشاء الحسابات متاح دون رصيد افتتاحي. '
              'ترحيل الفواتير والسندات لا يزال غير مفعّل.',
              textAlign: TextAlign.center,
            ),
          ),
          Expanded(
            child: _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Text(_error!, textAlign: TextAlign.center),
                    ),
                  )
                : AndroidView(
                    viewType: 'nasqo/offline_hybrid',
                    onPlatformViewCreated: _attach,
                  ),
          ),
        ],
      ),
    );
  }
}
).hasMatch(key)) {
      throw ArgumentError('Unsupported account');
    }
    final phone = payload['phone'] ?? '';
    final note = payload['note'] ?? '';
    final limit = payload['creditLimit'] ?? 0;
    final cash = payload['isCashAccount'] ?? false;
    if (phone is! String || phone.length > 32 || note is! String ||
        note.length > 300 || limit is! num || !limit.isFinite ||
        limit < 0 || cash is! bool) {
      throw ArgumentError('Invalid account fields');
    }
    final local = LocalDatabase.instance;
    final db = await local.database;
    final workspace = HybridLocalSnapshotAdapter.workspaceId;
    final bindings = await db.query('erp_state', where: 'stateKey = ?',
        whereArgs: ['sync_workspace_binding']);
    if (bindings.isNotEmpty && bindings.single['payloadJson'] != workspace) {
      throw StateError('Workspace mismatch');
    }
    final accountId = 'account_$key';
    final request = <String,dynamic>{
      'id': accountId, 'name': name.trim(), 'category': category,
      'phone': phone, 'note': note, 'creditLimit': limit.toDouble(),
      'currency': CurrencyCode.sar.name, 'isCashAccount': cash ? 1 : 0,
      'openingBalance': 0, 'openingDirection': 'credit',
    };
    await local.commitOperation(workspaceId: workspace, operationId: key,
      operationType: 'account.create.local', payload: request, apply: (txn) async {
        final binding = await txn.query('erp_state', where: 'stateKey = ?',
          whereArgs: ['sync_workspace_binding']);
        if (binding.isNotEmpty && binding.single['payloadJson'] != workspace) {
          throw StateError('Workspace mismatch');
        }
        final duplicates = await txn.query('accounts',
          where: 'name = ? AND category = ?', whereArgs: [name.trim(), category]);
        if (duplicates.isNotEmpty) throw ArgumentError('Account already exists');
        final max = (await txn.rawQuery('SELECT COALESCE(MAX(codeNumber),0) AS n FROM accounts')).single['n'] as int;
        await txn.insert('accounts', {...request, 'codeNumber': max + 1});
        return {'id': accountId};
      });
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
    final accounts = snapshot['accounts'] as List;
    final account = accounts.cast<Map<String,dynamic>>().firstWhere((a) => a['id'] == accountId);
    return {'account': account, 'snapshot': snapshot};
  }

  MethodChannel? _channel;
  String? _error;

  Future<void> _attach(int viewId) async {
    final channel = MethodChannel('nasqo/offline_hybrid/$viewId');
    _channel = channel;
    channel.setMethodCallHandler((call) async {
      if (call.method != 'message' || call.arguments is! String) return null;
      try {
        final response = await _protocol.handle(call.arguments as String);
        await channel.invokeMethod<void>('respond', response);
      } catch (_) {
        if (mounted) {
          setState(() => _error = 'تعذر قراءة SQLite المحلية أو إيصال رد Flutter إلى React.');
        }
      }
      return null;
    });

    try {
      // Prevent a bootstrap race: native WebView starts after this handler exists.
      await channel.invokeMethod<void>('start');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تشغيل WebView المحلي على جهاز Android.');
      }
    }
  }

  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('نسقو — واجهة React المحلية'),
        actions: [
          if (widget.onShowNative != null)
            TextButton(
              onPressed: widget.onShowNative,
              child: const Text('واجهة Flutter'),
            ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.all(10),
            child: const Text(
              'معاينة تجريبية دون إنترنت: قراءة SQLite فقط. '
              'الترحيل المالي من React غير مفعّل حتى اجتياز اختبارات المعاملات.',
              textAlign: TextAlign.center,
            ),
          ),
          Expanded(
            child: _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Text(_error!, textAlign: TextAlign.center),
                    ),
                  )
                : AndroidView(
                    viewType: 'nasqo/offline_hybrid',
                    onPlatformViewCreated: _attach,
                  ),
          ),
        ],
      ),
    );
  }
}
