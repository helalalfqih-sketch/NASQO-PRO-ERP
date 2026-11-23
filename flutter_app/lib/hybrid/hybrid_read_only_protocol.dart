import 'dart:convert';

/// Minimal, fail-closed protocol endpoint for the offline React -> Flutter
/// bridge. It never accepts raw SQL, filesystem, or financial write commands.
///
/// The Android WebView host can pass received JSON to [handle], then deliver
/// its JSON response to window.__nasqoHybridReceive(...). No mutations occur
/// in this protocol layer.
class HybridReadOnlyProtocol {
  HybridReadOnlyProtocol({required this.readSnapshot});

  final Future<Map<String, dynamic>> Function() readSnapshot;
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
    if (actionName != 'getSnapshot') {
      return _error(id, actionName, 'UNAUTHORIZED_ACTION',
          'الوصول المالي للقراءة فقط حتى اكتمال ربط معاملات SQLite واختبارها.');
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
