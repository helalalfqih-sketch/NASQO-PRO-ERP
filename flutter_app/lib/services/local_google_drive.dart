import 'dart:convert';
import 'dart:io';
import 'package:google_sign_in/google_sign_in.dart';
import 'firebase_sync_auth.dart';

/// Drive authorization is separate from the local workspace identity.
/// Tokens remain in Dart and only app-authorized files are listed.
class LocalGoogleDrive {
  static final _google=GoogleSignIn(scopes:const ['https://www.googleapis.com/auth/drive.file'],
    serverClientId:FirebaseSyncAuth.googleServerClientId);
  static GoogleSignInAccount? _account;
  static bool _busy=false;
  static Future<dynamic> handle(String operation,Map<String,dynamic> args)async{
    if(operation=='connect'||operation=='disconnect'){
      if(args.isNotEmpty||_busy)throw StateError('Invalid Drive session request');
      _busy=true;
      try{
        if(operation=='disconnect'){await _google.signOut();_account=null;return {'connected':false};}
        _account=await _google.signIn();
        if(_account==null)return {'connected':false};
        final auth=await _account!.authentication;
        if(auth.accessToken==null){_account=null;throw StateError('Drive authorization required');}
        return {'connected':true,'email':_account!.email,'displayName':_account!.displayName};
      }finally{_busy=false;}
    }
    final account=_account;
    if(account==null||_busy)throw StateError('Connect Google Drive first');
    if(operation=='getAbout'){
      if(args.isNotEmpty)throw ArgumentError('Invalid about request');
      return _get(account,'about',{'fields':'user(displayName,emailAddress,photoLink),storageQuota'});
    }
    if(operation=='listFiles'){
      if(args.keys.any((k)=>!['folderId','pageSize','queryText'].contains(k)))throw ArgumentError('Invalid list request');
      final folder=args['folderId'];
      if(folder!=null&&(folder is! String||!RegExp(r'^[A-Za-z0-9_-]{1,200}$').hasMatch(folder)))throw ArgumentError('Invalid folder');
      final size=args['pageSize']??60;
      if(size is! int||size<1||size>100)throw ArgumentError('Invalid page size');
      final query="trashed = false and '${folder??'root'}' in parents";
      final result=await _get(account,'files',{'q':query,'pageSize':'$size','fields':'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,description,parents,webViewLink,trashed)','orderBy':'modifiedTime desc'});
      return result['files']??[];
    }
    throw StateError('Drive file changes and backup transfer are not enabled yet');
  }

  static Future<Map<String,dynamic>> _get(GoogleSignInAccount account,String path,Map<String,String> query)async{
    final auth=await account.authentication,token=auth.accessToken;
    if(token==null)throw StateError('Drive authorization expired');
    final client=HttpClient()..connectionTimeout=const Duration(seconds:20);
    try{
      final request=await client.getUrl(Uri.https('www.googleapis.com','/drive/v3/$path',query));
      request.followRedirects=false;
      request.headers.set(HttpHeaders.authorizationHeader,'Bearer $token');
      final response=await request.close().timeout(const Duration(seconds:30));
      if(response.statusCode==401){_account=null;throw StateError('Reconnect Drive');}
      if(response.statusCode!=200)throw StateError('Drive request failed');
      final bytes=<int>[];
      await for(final chunk in response.timeout(const Duration(seconds:30))){
        if(bytes.length+chunk.length>512*1024)throw StateError('Drive response too large');
        bytes.addAll(chunk);
      }
      return jsonDecode(utf8.decode(bytes)) as Map<String,dynamic>;
    }finally{client.close(force:true);}
  }
}
