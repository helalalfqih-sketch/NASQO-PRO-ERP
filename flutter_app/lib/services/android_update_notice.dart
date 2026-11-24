import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const androidPreviewChannel = bool.fromEnvironment('NASQO_ANDROID_PREVIEW');
const androidBuildNumber = int.fromEnvironment('NASQO_ANDROID_BUILD_NUMBER');
const _repository = 'helalalfqih-sketch/NASQO-PRO-ERP';
const _asset = 'NASQO-PRO-ERP.apk';

class AndroidPreviewRelease {
  const AndroidPreviewRelease(this.code, this.tag);
  final int code;
  final String tag;
  Uri get download => Uri.https('github.com', '/$_repository/releases/download/$tag/$_asset');

  static AndroidPreviewRelease? newest(Object? data, int current) {
    if (data is! List) return null;
    AndroidPreviewRelease? best;
    final pattern = RegExp(r'^android-preview-v([1-9][0-9]{0,8})$');
    for (final item in data) {
      if (item is! Map || item['draft'] != false || item['prerelease'] != true) continue;
      final tag = item['tag_name'];
      if (tag is! String) continue;
      final code = int.tryParse(pattern.firstMatch(tag)?.group(1) ?? '');
      if (code == null || code <= current || code <= (best?.code ?? current)) continue;
      final assets = item['assets'];
      if (assets is! List || !assets.any((a) => a is Map &&
          a['name'] == _asset && a['state'] == 'uploaded' &&
          a['size'] is int && (a['size'] as int) > 0)) continue;
      best = AndroidPreviewRelease(code, tag);
    }
    return best;
  }
}

Future<AndroidPreviewRelease?> checkAndroidPreviewUpdate() async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
  try {
    final request = await client.getUrl(Uri.https('api.github.com',
        '/repos/$_repository/releases', {'per_page':'30'}))
        .timeout(const Duration(seconds: 10));
    request.followRedirects = false;
    request.headers.set('Accept', 'application/vnd.github+json');
    request.headers.set('User-Agent', 'NASQO-Android-Preview');
    final response = await request.close().timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) return null;
    final bytes = <int>[];
    await for (final part in response.timeout(const Duration(seconds: 10))) {
      bytes.addAll(part);
      if (bytes.length > 2 * 1024 * 1024) return null;
    }
    return AndroidPreviewRelease.newest(jsonDecode(utf8.decode(bytes)), androidBuildNumber);
  } finally {
    client.close(force: true);
  }
}

/// Offline-first: never blocks startup or makes updates mandatory.
/// Android's normal installer verifies the package signature and asks for consent.
class AndroidUpdateNotice extends StatefulWidget {
  const AndroidUpdateNotice({super.key, required this.child});
  final Widget child;

  @override
  State<AndroidUpdateNotice> createState() => _AndroidUpdateNoticeState();
}

class _AndroidUpdateNoticeState extends State<AndroidUpdateNotice>
    with WidgetsBindingObserver {
  static const _channel = MethodChannel('nasqo/android_updates');
  bool _busy = false;
  DateTime? _lastCheck;
  int _notified = 0;

  @override
  void initState() {
    super.initState();
    if (androidPreviewChannel && androidBuildNumber > 0) {
      WidgetsBinding.instance.addObserver(this);
      WidgetsBinding.instance.addPostFrameCallback((_) => _check());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    if (!mounted || !androidPreviewChannel || androidBuildNumber <= 0 ||
        !Platform.isAndroid || _busy) return;
    final now = DateTime.now();
    if (_lastCheck != null && now.difference(_lastCheck!) < const Duration(minutes: 15)) return;
    _busy = true;
    _lastCheck = now;
    try {
      final release = await checkAndroidPreviewUpdate();
      if (!mounted || release == null || release.code <= _notified) return;
      final messenger = ScaffoldMessenger.maybeOf(context);
      if (messenger == null) return;
      _notified = release.code;
      messenger.showSnackBar(SnackBar(
        duration: const Duration(seconds: 20),
        content: Text('يتوفر إصدار تجريبي أحدث (${release.code}).'),
        action: SnackBarAction(label: 'تحميل التحديث', onPressed: () async {
          try {
            await _channel.invokeMethod<void>('openDownload', release.download.toString());
          } catch (_) {
            if (mounted) {
              ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                const SnackBar(content: Text('تعذر فتح رابط التحديث.')));
            }
          }
        }),
      ));
    } catch (_) {
      // Offline and network errors never prevent use of the local application.
    } finally {
      _busy = false;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
