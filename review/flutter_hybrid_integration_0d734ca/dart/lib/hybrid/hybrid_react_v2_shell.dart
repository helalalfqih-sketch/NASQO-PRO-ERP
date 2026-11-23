import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/local_database.dart';
import '../state/erp_controller.dart';
import 'erp_hybrid_adapter.dart';
import 'hybrid_bridge_router.dart';
import 'hybrid_protocol.dart';
import 'nasqo_hybrid_flags.dart';
import 'posting_receipt_guard.dart';

/// Non-destructive Feature Flag shell wrapper preserving `0d734ca` compatibility.
///
/// - In experimental **Debug APK** (`kDebugMode == true`), defaults to mounting
///   the current offline React Hybrid V2 UI inside the existing single Android
///   WebView (`HybridHomeView.kt` + `NasqoHome`), WITH a one-tap fallback button
///   (`العودة للنسخة السابقة`) that switches instantly back to [existingHybridChild].
/// - When `NasqoHybridFlags.useReactHybridV2` is `false` (after tapping fallback,
///   in Release mode, or with `--dart-define=NASQO_REACT_HYBRID_V2=false`), renders
///   [existingHybridChild] untouched.
class HybridReactV2FeatureGate extends StatelessWidget {
  const HybridReactV2FeatureGate({
    super.key,
    required this.controller,
    required this.existingHybridChild,
    this.platformViewType = 'nasqo/home',
    this.legacyMessageHandler,
    this.showDebugFallbackButton = kDebugMode,
  });

  final ErpController controller;
  final Widget existingHybridChild;

  /// Must match the existing PlatformView viewType registered in `MainActivity.kt`
  /// at commit 0d734ca2ce1716de8f7005f8339f395fbd396da6.
  final String platformViewType;
  final LegacyNasqoHomeHandler? legacyMessageHandler;
  final bool showDebugFallbackButton;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: NasqoHybridFlags.useReactHybridV2,
      builder: (context, useV2, _) {
        if (!useV2) {
          if (!showDebugFallbackButton) {
            return existingHybridChild;
          }
          return Stack(
            children: [
              existingHybridChild,
              Positioned(
                left: 12,
                bottom: 16,
                child: SafeArea(
                  child: Material(
                    color: Colors.transparent,
                    child: ActionChip(
                      key: const Key('nasqo_open_react_v2_chip'),
                      avatar: const Icon(Icons.auto_awesome, size: 16),
                      label: const Text('واجهة React الحالية'),
                      onPressed: () =>
                          NasqoHybridFlags.setUseReactHybridV2(true),
                    ),
                  ),
                ),
              ),
            ],
          );
        }
        return _HybridReactV2Host(
          controller: controller,
          platformViewType: platformViewType,
          legacyMessageHandler: legacyMessageHandler,
          showFallbackButton: showDebugFallbackButton,
          onReturnToStableHybrid: () =>
              NasqoHybridFlags.setUseReactHybridV2(false),
        );
      },
    );
  }
}

class _HybridReactV2Host extends StatefulWidget {
  const _HybridReactV2Host({
    required this.controller,
    required this.platformViewType,
    required this.onReturnToStableHybrid,
    required this.showFallbackButton,
    this.legacyMessageHandler,
  });

  final ErpController controller;
  final String platformViewType;
  final VoidCallback onReturnToStableHybrid;
  final bool showFallbackButton;
  final LegacyNasqoHomeHandler? legacyMessageHandler;

  @override
  State<_HybridReactV2Host> createState() => _HybridReactV2HostState();
}

class _HybridReactV2HostState extends State<_HybridReactV2Host> {
  late final HybridBridgeRouter _router;
  late final ErpHybridAdapter _adapter;
  MethodChannel? _channel;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    final guard = PostingReceiptGuard(
      databaseProvider: () => LocalDatabase.instance.database,
    );
    _adapter = ErpHybridAdapter(
      controller: widget.controller,
      receiptGuard: guard,
    );
    // Upgrade-safe initialization: preserves existing LocalDatabase records on
    // APK upgrade and starts clean & empty on brand-new installs.
    unawaited(_adapter.loadOrInitializeUpgradeSafe());
    _router = HybridBridgeRouter(
      adapter: _adapter,
      allowFinancialWrites: () => NasqoHybridFlags.allowFinancialWrites.value,
      legacyHandler: widget.legacyMessageHandler,
      onGoBack: (_, depth) {
        if ((depth ?? 0) <= 1) {
          widget.onReturnToStableHybrid();
        }
      },
      onShowMessage: (message, level) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      },
    );
  }

  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }

  void _onPlatformViewCreated(int viewId) {
    final ch = MethodChannel('nasqo/home/$viewId');
    _channel = ch;
    ch.setMethodCallHandler((call) async {
      if (call.method == 'onWebMessage' || call.method == 'message') {
        final raw = call.arguments as String?;
        if (raw == null || raw.isEmpty) return false;
        final response = await _router.handleRawMessage(raw);
        if (response != null) {
          await ch.invokeMethod<void>('postMessage', response);
        }
        return true;
      }
      if (call.method == 'onPageFinished') {
        if (mounted) setState(() => _ready = true);
        final evt = HybridHostEventEnvelope.create(
          'themeChanged',
          <String, Object?>{
            'mode': widget.controller.isDarkMode ? 'dark' : 'light',
          },
        );
        await ch.invokeMethod<void>('postMessage', evt.toJsonString());
        return true;
      }
      return null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final isAndroid = !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_ready && _channel != null) {
          final evt = HybridHostEventEnvelope.create(
            'backPressed',
            const <String, Object?>{'source': 'android_system_back'},
          );
          unawaited(
            _channel!.invokeMethod<void>('postMessage', evt.toJsonString()),
          );
        } else {
          widget.onReturnToStableHybrid();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (isAndroid)
                AndroidView(
                  viewType: widget.platformViewType,
                  layoutDirection: TextDirection.rtl,
                  creationParams: const <String, Object?>{
                    'useReactHybridV2': true,
                  },
                  creationParamsCodec: const StandardMessageCodec(),
                  onPlatformViewCreated: _onPlatformViewCreated,
                )
              else
                Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'React Hybrid V2 يتطلب Android WebViewCompat (com.indexesstore.nasqo_qa).',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: widget.onReturnToStableHybrid,
                        child: const Text('العودة للنسخة السابقة'),
                      ),
                    ],
                  ),
                ),
              if (widget.showFallbackButton)
                Positioned(
                  left: 10,
                  bottom: 72,
                  child: Material(
                    color: Colors.transparent,
                    child: Tooltip(
                      message: 'العودة الفورية للواجهة السابقة (0d734ca)',
                      child: ActionChip(
                        key: const Key('nasqo_fallback_previous_ui_btn'),
                        avatar: const Icon(Icons.undo_rounded, size: 15),
                        label: const Text(
                          'العودة للسابقة',
                          style: TextStyle(fontSize: 11),
                        ),
                        visualDensity: VisualDensity.compact,
                        onPressed: widget.onReturnToStableHybrid,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
