import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:nasqo_pro_erp/services/native_cloud_errors.dart';
import 'package:nasqo_pro_erp/services/native_google_account_session.dart';

/// Models google_sign_in_android 6.2.1: init records requestedScopes;
/// requestScopes grants consent only; getTokens uses the INIT scopes.
/// The public Dart GoogleSignIn wrapper remains real in these regressions.
class InitialScopesPlatform extends GoogleSignInPlatform {
  final initializations = <List<String>>[];
  final tokenScopes = <List<String>>[];
  final consentScopes = <List<String>>[];
  final events = <String>[];
  List<String> _scopes = [];
  bool cancelled = false;
  bool consentGranted = true;
  bool emptyAccessToken = false;
  Completer<void>? tokenGate;
  Completer<void>? tokenStarted;
  int activeCalls = 0;
  int maxActiveCalls = 0;
  int loginSequence = 0;

  Future<T> call<T>(String name, Future<T> Function() operation) async {
    events.add(name);
    activeCalls++;
    if (activeCalls > maxActiveCalls) maxActiveCalls = activeCalls;
    try {
      return await operation();
    } finally {
      activeCalls--;
    }
  }

  @override
  Future<void> initWithParams(SignInInitParameters params) =>
      call('init', () async {
        _scopes = List.of(params.scopes);
        initializations.add(List.of(_scopes));
      });

  @override
  Future<GoogleSignInUserData?> signIn() => call(
      'signIn',
      () async => cancelled
          ? null
          : GoogleSignInUserData(
              id: 'synthetic-google-id',
              email: 'synthetic@example.invalid',
              displayName: 'Synthetic',
              idToken: 'synthetic-id-token-${++loginSequence}'));

  @override
  Future<bool> requestScopes(List<String> scopes) => call('consent', () async {
        consentScopes.add(List.of(scopes));
        // Deliberately DO NOT update _scopes: this is the pinned Android behavior.
        return consentGranted;
      });

  @override
  Future<GoogleSignInTokenData> getTokens(
          {required String email, bool? shouldRecoverAuth}) =>
      call('token', () async {
        final requested = List<String>.of(_scopes);
        tokenScopes.add(requested);
        if (tokenStarted != null && !tokenStarted!.isCompleted) {
          tokenStarted!.complete();
        }
        await tokenGate?.future;
        // Android cannot refresh the ID token here; the real Dart wrapper
        // falls back to the one returned by the latest native signIn.
        return GoogleSignInTokenData(
            idToken: null,
            accessToken:
                emptyAccessToken ? null : 'synthetic:${requested.join('|')}');
      });

  @override
  Future<void> signOut() => call('signOut', () async {});
}

void main() {
  const scope = NativeGoogleAccountSession.driveScope;
  late GoogleSignInPlatform original;
  late InitialScopesPlatform platform;
  late NativeGoogleAccountSession owner;
  setUp(() {
    original = GoogleSignInPlatform.instance;
    platform = InitialScopesPlatform();
    GoogleSignInPlatform.instance = platform;
    owner = NativeGoogleAccountSession(
        serverClientId: 'synthetic-client.apps.googleusercontent.com');
  });
  tearDown(() {
    GoogleSignInPlatform.instance = original;
  });

  Future<GoogleSignInAccount?> authenticate(bool drive) => owner.authenticate(
      withDrive: drive, verify: (account, _) async => account);

  test('regression: permission grant alone leaves old Android token email-only',
      () async {
    final oldClient = GoogleSignIn(scopes: const ['email']);
    final account = (await oldClient.signIn())!;
    expect(await oldClient.requestScopes(const [scope]), true);
    final headers = await account.authHeaders;
    expect(platform.consentScopes.single, [scope]);
    expect(platform.tokenScopes.single, ['email']);
    expect(headers['Authorization'], isNot(contains(scope)));
  });

  test('identity sign-in initializes only email and never asks Drive consent',
      () async {
    final account = (await authenticate(false))!;
    expect(platform.initializations, [
      ['email']
    ]);
    expect(platform.tokenScopes, [
      ['email']
    ]);
    expect(platform.consentScopes, isEmpty);
    expect(owner.matchesDriveAccount(account), false);
  });

  test(
      'explicit Drive connect initializes exactly email and drive.file before any token',
      () async {
    final account = (await authenticate(true))!;
    expect(platform.initializations, [
      ['email', scope]
    ]);
    expect(platform.consentScopes, [
      [scope]
    ]);
    expect(platform.events.indexOf('consent'),
        lessThan(platform.events.indexOf('token')));
    expect(platform.tokenScopes.single, ['email', scope]);
    expect(owner.matchesDriveAccount(account), true);
    final headers = await owner.driveAuthHeaders(account);
    expect(platform.tokenScopes.last, ['email', scope]);
    expect(headers['Authorization'], contains(scope));
  });

  test('same-mode reconnect refreshes the cached Android login ID token',
      () async {
    final tokens = <String?>[];
    Future<GoogleSignInAccount?> connect() => owner.authenticate(
        withDrive: true,
        verify: (account, auth) async {
          tokens.add(auth.idToken);
          return account;
        });
    final first = (await connect())!;
    final second = (await connect())!;
    expect(tokens, ['synthetic-id-token-1', 'synthetic-id-token-2']);
    expect(platform.initializations, [
      ['email', scope],
      ['email', scope]
    ]);
    expect(platform.events.where((event) => event == 'signIn').length, 2);
    expect(owner.matchesDriveAccount(first), false);
    expect(owner.matchesDriveAccount(second), true);
  });

  test(
      'identity and Drive transitions reinitialize singleton and reject retired accounts',
      () async {
    await authenticate(false);
    final oldDrive = (await authenticate(true))!;
    await owner.driveAuthHeaders(oldDrive);
    await authenticate(false);
    expect(owner.matchesDriveAccount(oldDrive), false);
    final newDrive = (await authenticate(true))!;
    expect(platform.initializations, [
      ['email'],
      ['email', scope],
      ['email'],
      ['email', scope],
    ]);
    // Same Google UID is insufficient: the old wrapper has the wrong owner.
    expect(newDrive.id, oldDrive.id);
    final before = platform.tokenScopes.length;
    await expectLater(
        owner.driveAuthHeaders(oldDrive),
        throwsA(isA<NativeCloudException>()
            .having((e) => e.code, 'code', 'GOOGLE_ACCOUNT_MISMATCH')));
    expect(platform.tokenScopes.length, before);
    await owner.driveAuthHeaders(newDrive);
    expect(platform.tokenScopes.last, ['email', scope]);
    expect(platform.maxActiveCalls, 1);
  });

  test(
      'cancelled selection and denied consent never verify identity or fetch a token',
      () async {
    var verified = 0;
    Future<GoogleSignInAccount?> connect() => owner.authenticate(
        withDrive: true,
        verify: (account, _) async {
          verified++;
          return account;
        });
    platform.cancelled = true;
    expect(await connect(), null);
    platform.cancelled = false;
    platform.consentGranted = false;
    await expectLater(
        connect(),
        throwsA(isA<NativeCloudException>()
            .having((e) => e.code, 'code', 'GOOGLE_SCOPE_DENIED')));
    expect(verified, 0);
    expect(platform.tokenScopes, isEmpty);
    // A failed operation must not poison the serialized owner queue.
    expect(await authenticate(false), isNotNull);
    expect(platform.initializations.last, ['email']);
  });

  test('failed Firebase identity verification never authorizes Drive headers',
      () async {
    GoogleSignInAccount? rejected;
    await expectLater(
        owner.authenticate<void>(
            withDrive: true,
            verify: (account, _) async {
              rejected = account;
              throw NativeCloudErrors.accountMismatch;
            }),
        throwsA(isA<NativeCloudException>()));
    expect(owner.matchesDriveAccount(rejected!), false);
    final before = platform.tokenScopes.length;
    await expectLater(owner.driveAuthHeaders(rejected!),
        throwsA(isA<NativeCloudException>()));
    expect(platform.tokenScopes.length, before);
  });

  test(
      'pending token retrieval serializes mode switch and signout on the active client',
      () async {
    final account = (await authenticate(true))!;
    platform.tokenGate = Completer<void>();
    platform.tokenStarted = Completer<void>();
    final headers = owner.driveAuthHeaders(account);
    await platform.tokenStarted!.future;
    final identity = authenticate(false);
    var firebaseSignedOut = false;
    final signOut = owner.signOut(signOutIdentity: () async {
      firebaseSignedOut = true;
    });
    await Future<void>.delayed(Duration.zero);
    expect(platform.initializations.length, 1);
    expect(firebaseSignedOut, false);
    expect(platform.events.where((event) => event == 'signOut'), isEmpty);
    platform.tokenGate!.complete();
    expect((await headers)['Authorization'], contains(scope));
    await identity;
    await signOut;
    expect(platform.initializations, [
      ['email', scope],
      ['email']
    ]);
    expect(platform.tokenScopes.last, ['email']);
    expect(firebaseSignedOut, true);
    expect(platform.events.last, 'signOut');
    expect(owner.matchesDriveAccount(account), false);
    expect(platform.maxActiveCalls, 1);
  });

  test('empty token cannot produce an authenticated Drive header', () async {
    final account = (await authenticate(true))!;
    platform.emptyAccessToken = true;
    await expectLater(
        owner.driveAuthHeaders(account),
        throwsA(isA<NativeCloudException>()
            .having((e) => e.code, 'code', 'GOOGLE_AUTH_EXPIRED')));
  });
}
