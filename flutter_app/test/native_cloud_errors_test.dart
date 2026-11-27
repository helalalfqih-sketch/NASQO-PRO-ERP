import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';
import 'package:nasqo_pro_erp/services/native_cloud_errors.dart';
import 'package:nasqo_pro_erp/services/native_cloud_session.dart';

void main() {
  const privateDetail = 'synthetic-private-token-and-account';

  test('native provider errors keep useful codes without provider details', () {
    final cases = <(Object, String)>[
      (
        PlatformException(code: 'network_error', message: privateDetail),
        'GOOGLE_NETWORK_ERROR'
      ),
      (
        PlatformException(code: 'sign_in_canceled', message: privateDetail),
        'GOOGLE_AUTH_CANCELLED'
      ),
      (
        PlatformException(
            code: 'sign_in_failed',
            message:
                'com.google.android.gms.common.api.ApiException: 10: $privateDetail'),
        'GOOGLE_PROVIDER_CONFIG'
      ),
      (
        PlatformException(
            code: 'sign_in_failed',
            message:
                'com.google.android.gms.common.api.ApiException: 7: $privateDetail'),
        'GOOGLE_NETWORK_ERROR'
      ),
      (
        PlatformException(
            code: 'sign_in_failed',
            message:
                'com.google.android.gms.common.api.ApiException: 12500: $privateDetail'),
        'GOOGLE_AUTH_FAILED'
      ),
      (
        PlatformException(code: 'sign_in_required', message: privateDetail),
        'GOOGLE_AUTH_EXPIRED'
      ),
      (
        FirebaseAuthException(
            code: 'operation-not-allowed', message: privateDetail),
        'GOOGLE_PROVIDER_CONFIG'
      ),
      (
        FirebaseAuthException(code: 'invalid-api-key', message: privateDetail),
        'GOOGLE_PROVIDER_CONFIG'
      ),
      (
        FirebaseAuthException(
            code: 'network-request-failed', message: privateDetail),
        'GOOGLE_NETWORK_ERROR'
      ),
      (
        FirebaseAuthException(
            code: 'invalid-credential', message: privateDetail),
        'GOOGLE_AUTH_FAILED'
      ),
      (const SocketException(privateDetail), 'GOOGLE_NETWORK_ERROR'),
      (TimeoutException(privateDetail), 'GOOGLE_TIMEOUT'),
      (StateError(privateDetail), 'SERVICE_UNAVAILABLE'),
    ];
    for (final (error, expected) in cases) {
      final safe = NativeCloudErrors.fromException(error);
      expect(safe.code, expected);
      expect(safe.message, isNot(contains(privateDetail)));
      expect(safe.message, isNot(contains('ApiException')));
    }
  });

  test(
      '403 reason distinguishes API disabled, scope, quota and unknown refusal',
      () {
    List<int> body(
            {String? oldReason,
            String? reason,
            String message = privateDetail}) =>
        utf8.encode(jsonEncode({
          'error': {
            'message': message,
            if (oldReason != null)
              'errors': [
                {'reason': oldReason}
              ],
            if (reason != null)
              'details': [
                {
                  'reason': reason,
                  'metadata': {'secret': privateDetail}
                }
              ],
          }
        }));
    for (final input in [
      body(oldReason: 'accessNotConfigured'),
      body(reason: 'SERVICE_DISABLED')
    ]) {
      expect(NativeCloudErrors.fromHttp(403, input).code, 'DRIVE_API_DISABLED');
    }
    expect(
        NativeCloudErrors.fromHttp(
                403, body(oldReason: 'insufficientPermissions'))
            .code,
        'GOOGLE_SCOPE_DENIED');
    expect(
        NativeCloudErrors.fromHttp(
                403, body(reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))
            .code,
        'GOOGLE_SCOPE_DENIED');
    expect(
        NativeCloudErrors.fromHttp(
                403, body(oldReason: 'userRateLimitExceeded'))
            .code,
        'DRIVE_RATE_LIMITED');
    expect(NativeCloudErrors.fromHttp(429, []).code, 'DRIVE_RATE_LIMITED');
    expect(NativeCloudErrors.fromHttp(401, []).code, 'GOOGLE_AUTH_EXPIRED');
    for (final input in [
      body(oldReason: 'forbidden'),
      body(reason: 'UNKNOWN'),
      body(message: 'SERVICE_DISABLED'),
      utf8.encode('<html>$privateDetail</html>'),
      utf8.encode('{"error":'),
      [0xff],
    ]) {
      final safe = NativeCloudErrors.fromHttp(403, input);
      expect(safe.code, 'DRIVE_PERMISSION_DENIED');
      expect(safe.message, isNot(contains(privateDetail)));
    }
  });

  test(
      'missing build configuration fails before chooser, file or accounting actions',
      () async {
    var sideEffects = 0;
    final session = NativeCloudSession(
      confirm: (_, __) async {
        sideEffects++;
        return false;
      },
      exportWorkspace: () async {
        sideEffects++;
        throw StateError('unexpected');
      },
      restoreWorkspace: (_, __) async {
        sideEffects++;
        return false;
      },
      pickFile: () async {
        sideEffects++;
        return null;
      },
      saveFile: (_, __) async {
        sideEffects++;
        return false;
      },
    );
    await expectLater(
        session.handle('googleDriveAction', 'connect', {}),
        throwsA(isA<NativeCloudException>()
            .having((e) => e.code, 'code', 'GOOGLE_CONFIG_MISSING')));
    // Failure releases the session lock and cannot report a connected account.
    final status = await session.handle('googleDriveAction', 'status', {});
    expect(status['connected'], false);
    expect(sideEffects, 0);
  });

  test(
      'cloud bridge preserves structured diagnostics and never serializes provider text',
      () async {
    for (final failure in [
      NativeCloudErrors.configMissing,
      NativeCloudErrors.scopeDenied,
      NativeCloudErrors.cancelled,
      NativeCloudErrors.accountMismatch,
      NativeCloudErrors.fromException(PlatformException(
          code: 'sign_in_failed',
          message:
              'com.google.android.gms.common.api.ApiException: 10: $privateDetail')),
      NativeCloudErrors.fromHttp(403, []),
    ]) {
      final endpoint = HybridReadOnlyProtocol(
          readSnapshot: () async => {},
          cloudAction: (_, __, ___) async => throw failure);
      final response = await endpoint.handle(jsonEncode({
        'protocolVersion': '1.0.0',
        'kind': 'request',
        'requestId': 'synthetic-cloud',
        'action': 'googleDriveAction',
        'payload': {'operation': 'connect', 'args': {}},
      }));
      final decoded = jsonDecode(response);
      expect(decoded['ok'], false);
      expect(decoded['error']['code'], failure.code);
      expect(decoded['error']['message'], failure.message);
      expect(response, isNot(contains(privateDetail)));
      expect(decoded['error'].keys.toSet(), {'code', 'message', 'retryable'});
    }
  });
}
