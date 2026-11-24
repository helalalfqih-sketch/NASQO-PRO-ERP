import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

class FirebaseSyncAuth {
  // OAuth client_type 3 from the Android Firebase configuration. Client IDs
  // are public identifiers; no OAuth client secret belongs in the application.
  static const googleServerClientId = String.fromEnvironment(
    'NASQO_GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '944118860365-ormd81q2o9h66n4ddn2t7gqraios5c4q.apps.googleusercontent.com',
  );
  static const configured = String.fromEnvironment('NASQO_FIREBASE_API_KEY') != '';
  static final GoogleSignIn _google = GoogleSignIn(
    scopes: const ['email'],
    serverClientId: googleServerClientId,
  );

  /// User-initiated native Google chooser. No tokens are passed to React,
  /// no Drive permissions are requested, and no financial data is uploaded.
  static Future<UserCredential?> signInWithGoogle() async {
    await initialize();
    final selected = await _google.signIn();
    if (selected == null) return null;
    final googleAuth = await selected.authentication;
    final idToken = googleAuth.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw StateError('Google ID token unavailable');
    }
    final credential = GoogleAuthProvider.credential(idToken: idToken);
    final result = await FirebaseAuth.instance.signInWithCredential(credential);
    if (result.user == null || !result.user!.emailVerified) {
      await FirebaseAuth.instance.signOut();
      await _google.signOut();
      throw StateError('Verified Google identity required');
    }
    return result;
  }

  static Future<void> initialize() async {
    if (Firebase.apps.isNotEmpty) return;
    const apiKey = String.fromEnvironment('NASQO_FIREBASE_API_KEY');
    const appId = String.fromEnvironment('NASQO_FIREBASE_APP_ID', defaultValue: '1:944118860365:android:af6a1eb1ff4217b0802a04');
    const sender = String.fromEnvironment('NASQO_FIREBASE_SENDER_ID', defaultValue: '944118860365');
    const project = String.fromEnvironment('NASQO_FIREBASE_PROJECT_ID', defaultValue: 'gen-lang-client-0457000612');
    if (apiKey.isEmpty || appId.isEmpty || sender.isEmpty || project.isEmpty) {
      throw StateError('Official Android Firebase configuration required');
    }
    if (!appId.startsWith('1:$sender:android:')) {
      throw StateError('Invalid Android Firebase app configuration');
    }
    await Firebase.initializeApp(options: const FirebaseOptions(
      apiKey: apiKey, appId: appId, messagingSenderId: sender, projectId: project,
    ));
  }

  static Future<UserCredential> signIn(String email, String password) async {
    await initialize();
    return FirebaseAuth.instance.signInWithEmailAndPassword(
      email: email.trim(), password: password);
  }

  static Future<String> token() async {
    await initialize();
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('Sign in required');
    await user.reload();
    final current = FirebaseAuth.instance.currentUser;
    if (current == null || !current.emailVerified) {
      throw StateError('Verified email required');
    }
    final token = await current.getIdToken();
    if (token == null || token.isEmpty) throw StateError('Missing ID token');
    return token;
  }

  static Future<void> signOut() async {
    await initialize();
    await FirebaseAuth.instance.signOut();
    await _google.signOut();
  }
}
