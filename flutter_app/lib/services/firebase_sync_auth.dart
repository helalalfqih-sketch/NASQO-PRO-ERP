import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';

class FirebaseSyncAuth {
  static Future<void> initialize() async {
    if (Firebase.apps.isNotEmpty) return;
    const apiKey = String.fromEnvironment('NASQO_FIREBASE_API_KEY');
    const appId = String.fromEnvironment('NASQO_FIREBASE_APP_ID');
    const sender = String.fromEnvironment('NASQO_FIREBASE_SENDER_ID');
    const project = String.fromEnvironment('NASQO_FIREBASE_PROJECT_ID');
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
  }
}
