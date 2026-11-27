import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'native_cloud_errors.dart';
import 'native_google_account_session.dart';

class FirebaseSyncAuth {
  // OAuth client_type 3 from the Android Firebase configuration. Client IDs
  // are public identifiers; no OAuth client secret belongs in the application.
  static const googleServerClientId = String.fromEnvironment(
    'NASQO_GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '944118860365-ormd81q2o9h66n4ddn2t7gqraios5c4q.apps.googleusercontent.com',
  );
  static const configured = String.fromEnvironment('NASQO_FIREBASE_API_KEY') != '';
  static final NativeGoogleAccountSession _google = NativeGoogleAccountSession(
    serverClientId: googleServerClientId,
  );

  /// User-initiated native Google chooser. No tokens are passed to React,
  /// no Drive permissions are requested, and no financial data is uploaded.
  static Future<UserCredential?> signInWithGoogle({bool chooseAccount=false}) async {
    await initialize();
    return _google.authenticate<UserCredential>(withDrive:false,
      chooseAccount:chooseAccount,verify:_verifyGoogleIdentity);
  }

  static Future<UserCredential> _verifyGoogleIdentity(
      GoogleSignInAccount account,GoogleSignInAuthentication googleAuth)async{
    final idToken = googleAuth.idToken;
    if (idToken == null || idToken.isEmpty) {
      throw NativeCloudErrors.authFailed;
    }
    final credential = GoogleAuthProvider.credential(idToken: idToken);
    final result = await FirebaseAuth.instance.signInWithCredential(credential);
    if (result.user == null || !result.user!.emailVerified) {
      await FirebaseAuth.instance.signOut();
      throw NativeCloudErrors.authFailed;
    }
    if(!result.user!.providerData.any((p)=>p.providerId=='google.com'&&p.uid==account.id)){
      await FirebaseAuth.instance.signOut();
      throw NativeCloudErrors.accountMismatch;
    }
    return result;
  }

  static Future<void>? _initializing;
  static Future<void> initialize() async {
    if(Firebase.apps.isNotEmpty)return;
    final pending=_initializing??=_initialize();
    try{await pending;}finally{if(identical(_initializing,pending))_initializing=null;}
  }

  static Future<void> _initialize() async {
    const apiKey = String.fromEnvironment('NASQO_FIREBASE_API_KEY');
    const appId = String.fromEnvironment('NASQO_FIREBASE_APP_ID', defaultValue: '1:944118860365:android:af6a1eb1ff4217b0802a04');
    const sender = String.fromEnvironment('NASQO_FIREBASE_SENDER_ID', defaultValue: '944118860365');
    const project = String.fromEnvironment('NASQO_FIREBASE_PROJECT_ID', defaultValue: 'gen-lang-client-0457000612');
    if (apiKey.isEmpty || appId.isEmpty || sender.isEmpty || project.isEmpty) {
      throw NativeCloudErrors.configMissing;
    }
    if (!appId.startsWith('1:$sender:android:')) {
      throw NativeCloudErrors.providerConfig;
    }
    await Firebase.initializeApp(options: const FirebaseOptions(
      apiKey: apiKey, appId: appId, messagingSenderId: sender, projectId: project,
    ));
  }

  static const driveScope=NativeGoogleAccountSession.driveScope;

  /// Request Drive consent only after a user explicitly chooses to connect.
  /// The same Google account must back the verified Firebase identity.
  static Future<GoogleSignInAccount?> authorizeDrive({bool chooseAccount=false})async{
    await initialize();
    return _google.authenticate<GoogleSignInAccount>(withDrive:true,
      chooseAccount:chooseAccount,verify:(account,authentication)async{
        await _verifyGoogleIdentity(account,authentication);
        return account;
      });
  }

  static bool matchesDriveAccount(GoogleSignInAccount account){
    if(Firebase.apps.isEmpty||!_google.matchesDriveAccount(account))return false;
    final user=FirebaseAuth.instance.currentUser;
    return user!=null&&user.emailVerified&&user.providerData.any((p)=>p.providerId=='google.com'&&p.uid==account.id);
  }

  static Future<Map<String,String>> driveAuthHeaders(GoogleSignInAccount account)async{
    if(!matchesDriveAccount(account))throw NativeCloudErrors.accountMismatch;
    final headers=await _google.driveAuthHeaders(account);
    if(!matchesDriveAccount(account))throw NativeCloudErrors.accountMismatch;
    return headers;
  }

  static Future<UserCredential> signIn(String email, String password) async {
    await initialize();
    return FirebaseAuth.instance.signInWithEmailAndPassword(
      email: email.trim(), password: password);
  }

  static Future<String> token({String? expectedUid}) async {
    await initialize();
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('Sign in required');
    final uid = expectedUid ?? user.uid;
    if (user.uid != uid) throw StateError('Authentication changed');
    await user.reload();
    final current = FirebaseAuth.instance.currentUser;
    if (current == null || current.uid != uid || !current.emailVerified) {
      throw StateError('Verified email required');
    }
    final token = await current.getIdToken();
    if (FirebaseAuth.instance.currentUser?.uid != uid) {
      throw StateError('Authentication changed');
    }
    if (token == null || token.isEmpty) throw StateError('Missing ID token');
    return token;
  }

  static Future<void> signOut() async {
    await initialize();
    await _google.signOut(signOutIdentity:FirebaseAuth.instance.signOut);
  }
}
