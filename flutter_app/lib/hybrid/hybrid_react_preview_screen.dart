import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'hybrid_read_only_protocol.dart';
import '../services/local_account_commands.dart';
import '../services/local_document_commands.dart';
import 'local_snapshot_adapter.dart';
import '../services/local_database.dart';

/// Android-only debug preview of the original React/Vite UI.
///
/// Kotlin WebViewAssetLoader serves the bundled React files from an isolated
/// local HTTPS origin; no network or external navigation is permitted.
/// Explicit local account commands are enabled; other financial commands fail closed.
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
    createAccount: (key,payload) => _saveAccount(key,payload),
    updateAccount: (key,id,payload) => _saveAccount(key,payload,accountId:id),
    postDocument: _postDocument,
  );

  static Future<Map<String,dynamic>> _saveAccount(
      String key, Map<String,dynamic> payload, {String? accountId}) async {
    final id = await LocalAccountCommands(LocalDatabase.instance).save(
      HybridLocalSnapshotAdapter.workspaceId,key,payload,accountId:accountId);
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
    final account = (snapshot['accounts'] as List).cast<Map<String,dynamic>>()
      .firstWhere((a) => a['id'] == id);
    return {'account':account,'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _postDocument(String key,Map<String,dynamic> payload) async {
    final id = await LocalDocumentCommands(LocalDatabase.instance).post(
      HybridLocalSnapshotAdapter.workspaceId,key,payload);
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
    final entry = (snapshot['ledger'] as List).cast<Map<String,dynamic>>()
        .firstWhere((e) => e['id'] == id);
    return {'entry':entry,'snapshot':snapshot};
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
              'وضع محلي تجريبي: إنشاء الحسابات وتعديل بياناتها متاحان. '
              'السندات والقيود البسيطة والفواتير الحرة الآجلة مدعومة؛ المزامنة والفواتير المخزنية قيد التطوير.',
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
