import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'hybrid_read_only_protocol.dart';
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
  );
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
