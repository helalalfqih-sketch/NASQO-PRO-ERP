import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'hybrid_read_only_protocol.dart';
import 'local_snapshot_adapter.dart';

/// Opt-in offline preview of the original React UI, hosted inside Flutter.
///
/// The bridge deliberately exposes only getSnapshot while native SQLite
/// posting/rollback and idempotency are reviewed. Unsupported mutations are
/// rejected, never silently emulated or posted to a remote server.
class HybridReactPreviewScreen extends StatefulWidget {
  const HybridReactPreviewScreen({super.key});

  @override
  State<HybridReactPreviewScreen> createState() => _HybridReactPreviewScreenState();
}

class _HybridReactPreviewScreenState extends State<HybridReactPreviewScreen> {
  late final WebViewController _web = WebViewController();
  late final HybridReadOnlyProtocol _protocol = HybridReadOnlyProtocol(
    readSnapshot: HybridLocalSnapshotAdapter.readFromDevice,
  );
  String? _error;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      await _web.setJavaScriptMode(JavaScriptMode.unrestricted);
      await _web.addJavaScriptChannel(
        'NasqoFlutterBridge',
        onMessageReceived: (message) => _onBridgeMessage(message.message),
      );
      await _web.setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          // Bundled files only: no external websites, deep links, or network.
          final uri = Uri.tryParse(request.url);
          return uri != null && (uri.scheme == 'file' || uri.scheme == 'about')
              ? NavigationDecision.navigate
              : NavigationDecision.prevent;
        },
      ));
      await _web.loadFlutterAsset('assets/web/index.html');
      if (mounted) setState(() => _ready = true);
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'تعذر فتح واجهة React المحلية. نفّذ npm run sync:flutter-hybrid ثم أعد بناء تطبيق Flutter.');
      }
    }
  }

  Future<void> _onBridgeMessage(String rawMessage) async {
    final response = await _protocol.handle(rawMessage);
    if (!mounted) return;
    try {
      // Double JSON encoding transports an inert string, not executable code.
      await _web.runJavaScript(
        'window.__nasqoHybridReceive(' + jsonEncode(response) + ');',
      );
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر إيصال رد SQLite إلى واجهة React.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('نسقو — واجهة React المحلية')),
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
                ? Center(child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Text(_error!, textAlign: TextAlign.center),
                  ))
                : _ready
                    ? WebViewWidget(controller: _web)
                    : const Center(child: CircularProgressIndicator()),
          ),
        ],
      ),
    );
  }
}
