import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/services.dart';

/// Only fixed messages/codes cross the bridge. Never forward provider exception
/// text, HTTP bodies, credentials, account identifiers, or OAuth configuration.
class NativeCloudException implements Exception {
  const NativeCloudException(this.message, {this.code = 'SERVICE_UNAVAILABLE'});
  final String message, code;
}

class NativeCloudErrors {
  static const configMissing = NativeCloudException(
    'إعداد Google غير مكتمل في هذه النسخة. يلزم إصدار يتضمن إعداد Firebase المعتمد.',
    code: 'GOOGLE_CONFIG_MISSING',
  );
  static const providerConfig = NativeCloudException(
    'رفض Google إعداد التطبيق. يلزم التحقق من عميل OAuth وشهادة توقيع Android وتفعيل تسجيل Google.',
    code: 'GOOGLE_PROVIDER_CONFIG',
  );
  static const cancelled = NativeCloudException(
    'أُلغي اختيار حساب Google. يمكنك إعادة الربط عندما تكون مستعدًا.',
    code: 'GOOGLE_AUTH_CANCELLED',
  );
  static const scopeDenied = NativeCloudException(
    'لم تُمنح صلاحية ملفات التطبيق في Google Drive. أعد الربط ووافق على الصلاحية المطلوبة.',
    code: 'GOOGLE_SCOPE_DENIED',
  );
  static const accountMismatch = NativeCloudException(
    'لا يتطابق حساب Drive مع هوية Google المسجلة. أعد الربط باستخدام الحساب نفسه.',
    code: 'GOOGLE_ACCOUNT_MISMATCH',
  );
  static const expired = NativeCloudException(
    'انتهت جلسة Google. أعد ربط الحساب.',
    code: 'GOOGLE_AUTH_EXPIRED',
  );
  static const authFailed = NativeCloudException(
    'لم تكتمل مصادقة Google. أعد المحاولة؛ إذا استمر الخطأ يلزم فحص إعداد التطبيق.',
    code: 'GOOGLE_AUTH_FAILED',
  );
  static const network = NativeCloudException(
    'تعذر الاتصال بخدمة Google. تحقق من الإنترنت؛ بيانات SQLite المحلية متاحة.',
    code: 'GOOGLE_NETWORK_ERROR',
  );
  static const timeout = NativeCloudException(
    'انتهت مهلة الاتصال بخدمة Google. تحقق من الملفات قبل تكرار أي رفع.',
    code: 'GOOGLE_TIMEOUT',
  );

  static NativeCloudException fromException(Object error) {
    if (error is NativeCloudException) return error;
    if (error is TimeoutException) return timeout;
    if (error is SocketException ||
        error is HandshakeException ||
        error is HttpException) {
      return network;
    }
    if (error is FirebaseException) {
      if (error.code == 'network-request-failed') return network;
      if (const {
        'invalid-api-key',
        'app-not-authorized',
        'operation-not-allowed',
        'invalid-app-credential',
        'configuration-not-found'
      }.contains(error.code)) {
        return providerConfig;
      }
      if (const {
        'user-token-expired',
        'invalid-user-token',
        'requires-recent-login'
      }.contains(error.code)) {
        return expired;
      }
      return authFailed;
    }
    if (error is PlatformException) {
      if (error.code == 'network_error') return network;
      if (const {'sign_in_canceled', 'sign_in_cancelled'}
          .contains(error.code)) {
        return cancelled;
      }
      if (error.code == 'sign_in_required') return expired;
      // google_sign_in_android 6.x transports ApiException status only inside
      // its message. Read only this numeric status; never expose the message.
      final match = RegExp(r'\bApiException:\s*(\d+)\s*:')
          .firstMatch(error.message ?? '');
      final status = int.tryParse(match?.group(1) ?? '');
      if (error.code == 'sign_in_failed') {
        if (status == 10) return providerConfig; // DEVELOPER_ERROR
        if (status == 7) return network; // NETWORK_ERROR
        if (status == 12501) return cancelled;
      }
      return authFailed;
    }
    return const NativeCloudException(
      'تعذر إكمال العملية؛ لم يُؤكد نجاح الرفع أو الاستعادة.',
    );
  }

  static NativeCloudException fromHttp(int status, List<int> body) {
    if (status == 401) return expired;
    // Error bodies are bounded by the caller. Parse only allowlisted reason
    // fields: Google's free-form message may contain private request details.
    final reasons = <String>{};
    try {
      final decoded = jsonDecode(utf8.decode(body));
      if (decoded is Map && decoded['error'] is Map) {
        final error = decoded['error'] as Map;
        for (final field in ['errors', 'details']) {
          final values = error[field];
          if (values is List) {
            for (final item in values) {
              if (item is Map && item['reason'] is String) {
                reasons.add(item['reason'] as String);
              }
            }
          }
        }
      }
    } on FormatException {
      // A malformed/HTML error still receives a safe status-based result.
    }
    if (status == 429 ||
        reasons.any(const {
          'rateLimitExceeded',
          'userRateLimitExceeded',
          'dailyLimitExceeded',
          'RATE_LIMIT_EXCEEDED',
          'QUOTA_EXCEEDED',
        }.contains)) {
      return const NativeCloudException(
        'بلغت خدمة Drive حد الطلبات. انتظر ثم أعد المحاولة.',
        code: 'DRIVE_RATE_LIMITED',
      );
    }
    if (status == 403) {
      if (reasons
          .any(const {'accessNotConfigured', 'SERVICE_DISABLED'}.contains)) {
        return const NativeCloudException(
          'Google Drive API غير مفعّل لهذا التطبيق. يلزم تفعيله في مشروع Google المرتبط قبل إعادة الربط.',
          code: 'DRIVE_API_DISABLED',
        );
      }
      if (reasons.any(const {
        'insufficientPermissions',
        'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
      }.contains)) {
        return scopeDenied;
      }
      return const NativeCloudException(
        'رفض Google Drive الوصول إلى هذا الطلب. تحقق من صلاحية الحساب والملف، ثم أعد الربط إذا لزم.',
        code: 'DRIVE_PERMISSION_DENIED',
      );
    }
    return NativeCloudException('رفض Google Drive العملية (HTTP $status).');
  }
}
