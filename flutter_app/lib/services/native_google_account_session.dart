import 'package:google_sign_in/google_sign_in.dart';
import 'native_cloud_errors.dart';

/// Owns Android's single google_sign_in platform client. The Android 6.x plugin
/// builds access tokens from INIT scopes; requestScopes alone only grants
/// consent. Never reuse an initialized wrapper after changing its scope mode.
class NativeGoogleAccountSession {
  NativeGoogleAccountSession({required this.serverClientId});
  final String serverClientId;
  static const driveScope = 'https://www.googleapis.com/auth/drive.file';
  GoogleSignIn? _client;
  bool _driveMode = false;
  GoogleSignInAccount? _authorizedDriveAccount;
  Future<void> _tail = Future<void>.value();

  Future<T> _serialized<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  GoogleSignIn _activate(bool withDrive) {
    // Every explicit authentication gets a fresh wrapper, including same-mode
    // reconnects: Android getTokens cannot refresh its cached login ID token.
    // Header refreshes keep this owner and never trigger a new sign-in.
    // Initialization is lazy and serialized; retired wrappers are never reused.
    _client = GoogleSignIn(
      scopes: withDrive ? const ['email', driveScope] : const ['email'],
      serverClientId: serverClientId,
    );
    _driveMode = withDrive;
    return _client!;
  }

  /// [withDrive] is used only by the explicit Connect Drive action. Identity
  /// sign-in always activates the email-only mode, even after a Drive session.
  Future<T?> authenticate<T>({
    required bool withDrive,
    bool chooseAccount = false,
    required Future<T> Function(GoogleSignInAccount, GoogleSignInAuthentication)
        verify,
  }) =>
      _serialized(() async {
        _authorizedDriveAccount = null;
        final client = _activate(withDrive);
        if (chooseAccount) await client.signOut();
        final account = await client.signIn();
        if (account == null) return null;
        if (withDrive && !await client.requestScopes(const [driveScope])) {
          throw NativeCloudErrors.scopeDenied;
        }
        final authentication = await account.authentication;
        final result = await verify(account, authentication);
        if (!identical(client, _client) ||
            !identical(client.currentUser, account)) {
          throw NativeCloudErrors.accountMismatch;
        }
        if (withDrive) _authorizedDriveAccount = account;
        return result;
      });

  bool matchesDriveAccount(GoogleSignInAccount account) =>
      _driveMode &&
      identical(_authorizedDriveAccount, account) &&
      identical(_client?.currentUser, account);

  Future<Map<String, String>> driveAuthHeaders(GoogleSignInAccount account) =>
      _serialized(() async {
        if (!matchesDriveAccount(account)) {
          throw NativeCloudErrors.accountMismatch;
        }
        final authentication = await account.authentication;
        if (!matchesDriveAccount(account)) {
          throw NativeCloudErrors.accountMismatch;
        }
        final token = authentication.accessToken;
        if (token == null || token.isEmpty) throw NativeCloudErrors.expired;
        return {'Authorization': 'Bearer $token', 'X-Goog-AuthUser': '0'};
      });

  Future<void> signOut({required Future<void> Function() signOutIdentity}) =>
      _serialized(() async {
        _authorizedDriveAccount = null;
        try {
          await signOutIdentity();
          await _client?.signOut();
        } finally {
          _client = null;
          _driveMode = false;
        }
      });
}
