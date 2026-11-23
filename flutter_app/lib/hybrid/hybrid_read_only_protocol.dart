import 'dart:convert';

/// Minimal, fail-closed protocol endpoint for the offline React -> Flutter
/// bridge. It never accepts raw SQL, filesystem, or financial write commands.
///
/// The Android WebView host can pass received JSON to [handle], then deliver
/// its JSON response to window.__nasqoHybridReceive(...). Only explicitly
/// whitelisted appearance preferences may be written; financial data is read-only.
class HybridReadOnlyProtocol {
  HybridReadOnlyProtocol({
    required this.readSnapshot,
    this.saveUiPreferences,
    this.createAccount,
  });

  final Future<Map<String, dynamic>> Function() readSnapshot;
  final Future<void> Function(Map<String, dynamic>)? saveUiPreferences;
  final Future<Map<String, dynamic>> Function(String, Map<String, dynamic>)? createAccount;
  static const String version = '1.0.0';
  static const int maxRequestLength = 32768;

  Future<String> handle(String rawMessage) async {
    if (rawMessage.length > maxRequestLength) {
      return _error('', null, 'VALIDATION_ERROR', 'حجم الرسالة غير مسموح به.');
    }

    Map<String, dynamic> request;
    try {
      final parsed = jsonDecode(rawMessage);
      if (parsed is! Map<String, dynamic>) {
        return _error('', null, 'VALIDATION_ERROR', 'تنسيق الرسالة غير صالح.');
      }
      request = parsed;
    } on FormatException {
      return _error('', null, 'VALIDATION_ERROR', 'JSON غير صالح.');
    }

    final requestId = request['requestId'];
    final action = request['action'];
    final id = requestId is String ? requestId : '';
    final actionName = action is String ? action : null;

    if (id.isEmpty || id.length > 150 ||
        request['protocolVersion'] != version ||
        request['kind'] != 'request') {
      return _error(id, actionName, 'VALIDATION_ERROR', 'إصدار البروتوكول أو معرف الطلب غير صالح.');
    }
    if (actionName == 'saveUiPreferences') {
      final params = request['payload'];
      if (params is! Map<String, dynamic> ||
          params.length != 1 ||
          params['preferences'] is! Map<String, dynamic>) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'بيانات المظهر غير صالحة.');
      }
      final prefs = params['preferences'] as Map<String, dynamic>;
      const allowed = {
        'themeMode', 'brandColor', 'extendedSettings', 'homeTileLayout',
        'homeMetricOrder', 'widgetOrder', 'favorites', 'hapticsEnabled',
        'readNotifIds', 'dismissedNotifIds', 'lastBackupIso',
      };
      if (prefs.keys.any((key) => !allowed.contains(key)) ||
          (prefs['themeMode'] != null &&
              !const ['dark', 'light', 'system'].contains(prefs['themeMode'])) ||
          (prefs['brandColor'] != null && prefs['brandColor'] is! String) ||
          (prefs['hapticsEnabled'] != null && prefs['hapticsEnabled'] is! bool) ||
          (prefs['homeMetricOrder'] != null && prefs['homeMetricOrder'] is! List) ||
          (prefs['widgetOrder'] != null && prefs['widgetOrder'] is! List) ||
          (prefs['favorites'] != null && prefs['favorites'] is! List) ||
          (prefs['extendedSettings'] != null && prefs['extendedSettings'] is! Map) ||
          (prefs['homeTileLayout'] != null && prefs['homeTileLayout'] is! Map)) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'إعدادات المظهر غير صالحة.');
      }
      if (saveUiPreferences == null) {
        return _error(id, actionName, 'UNAUTHORIZED_ACTION',
            'حفظ إعدادات المظهر غير متاح.');
      }
      try {
        await saveUiPreferences!(prefs);
        return jsonEncode({
          'protocolVersion': version,
          'kind': 'response',
          'requestId': id,
          'action': actionName,
          'ok': true,
          'data': <String, dynamic>{},
        });
      } catch (_) {
        return _error(id, actionName, 'SERVICE_UNAVAILABLE',
            'تعذر حفظ إعدادات المظهر في SQLite.');
      }
    }

    if (actionName == 'saveAccount' && createAccount != null) {
      final params = request['payload'];
      final key = request['idempotencyKey'];
      if (key is! String || key.isEmpty || key.length > 150 ||
          params is! Map<String, dynamic> ||
          params['workspaceId'] != 'local-erp-workspace' ||
          params['accountId'] != null ||
          params.keys.any((k) => !const ['workspaceId', 'payload', 'accountId'].contains(k)) ||
          params['payload'] is! Map<String, dynamic>) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'طلب إنشاء الحساب غير صالح.');
      }
      try {
        final result = await createAccount!(key, params['payload'] as Map<String, dynamic>);
        return jsonEncode({
          'protocolVersion': version, 'kind': 'response',
          'requestId': id, 'action': actionName, 'ok': true, 'data': result,
        });
      } on ArgumentError {
        return _error(id, actionName, 'VALIDATION_ERROR', 'حقول الحساب غير مدعومة أو غير صالحة.');
      } catch (_) {
        return _error(id, actionName, 'SERVICE_UNAVAILABLE', 'تعذر تأكيد حفظ الحساب المحلي.');
      }
    }

    if (actionName != 'getSnapshot') {
      return _error(id, actionName, 'UNAUTHORIZED_ACTION',
          'الترحيل المالي عبر React معطّل إلى حين استكمال ضمانات SQLite.');
    }

    final payload = request['payload'];
    if (payload is! Map<String, dynamic> ||
        payload.keys.any((key) => key != 'workspaceId' && key != 'forceRefresh') ||
        (payload['workspaceId'] != null && payload['workspaceId'] is! String) ||
        (payload['forceRefresh'] != null && payload['forceRefresh'] is! bool)) {
      return _error(id, actionName, 'VALIDATION_ERROR', 'معطيات قراءة البيانات غير صالحة.');
    }

    try {
      final snapshot = await readSnapshot();
      if (snapshot['workspaceId'] is! String ||
          (snapshot['workspaceId'] as String).isEmpty ||
          const ['currencies', 'accountGroups', 'accounts', 'cashboxes',
            'ledger', 'warehouses', 'inventory']
              .any((key) => snapshot[key] is! List)) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'لقطة بيانات Flutter غير مكتملة.');
      }

      return jsonEncode({
        'protocolVersion': version,
        'kind': 'response',
        'requestId': id,
        'action': actionName,
        'ok': true,
        'data': snapshot,
      });
    } catch (_) {
      // Do not expose database contents or internal errors to JavaScript.
      return _error(id, actionName, 'SERVICE_UNAVAILABLE',
          'تعذرت قراءة بيانات SQLite المحلية.');
    }
  }

  String _error(String id, String? action, String code, String message) {
    return jsonEncode({
      'protocolVersion': version,
      'kind': 'response',
      'requestId': id,
      if (action != null) 'action': action,
      'ok': false,
      'error': {'code': code, 'message': message, 'retryable': false},
    });
  }
}
