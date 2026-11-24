import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'firebase_sync_auth.dart';

class NativeCloudException implements Exception {
  const NativeCloudException(this.message,{this.code='SERVICE_UNAVAILABLE'});
  final String message,code;
}

/// OAuth credentials stay in Dart and the official Google plugin.
/// React receives a status/profile only, never an OAuth or Firebase token.
/// The app-specific Drive scope and fixed API origin limit all operations.
class NativeCloudSession {
  NativeCloudSession({required this.confirm,required this.exportWorkspace,
    required this.restoreWorkspace,required this.pickFile,required this.saveFile});
  final Future<bool> Function(String,String) confirm;
  final Future<Uint8List> Function() exportWorkspace;
  final Future<bool> Function(Uint8List,String) restoreWorkspace;
  final Future<({Uint8List bytes,String name})?> Function() pickFile;
  final Future<bool> Function(Uint8List,String) saveFile;
  static const maxBytes=32*1024*1024;
  static const maxJson=2*1024*1024;
  static const fields='id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed,description';
  static const folderMime='application/vnd.google-apps.folder';
  GoogleSignInAccount? _drive;
  Map<String,dynamic>? _about;
  bool _busy=false;
  final Map<String,_PendingUpload> _uploads={};

  static String boundedText(Object? value,{int max=240,bool optional=false}){
    if(optional&&(value==null||value is String&&value.trim().isEmpty))return '';
    if(value is! String||value.trim().isEmpty||value.length>max||
      value.runes.any((v)=>v<32||v==127))throw const NativeCloudException('قيمة الطلب غير صالحة.',code:'VALIDATION_ERROR');
    return value.trim();
  }

  static String fileId(Object? value){
    final id=boundedText(value,max:180);
    if(!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(id))
      throw const NativeCloudException('معرّف الملف غير صالح.',code:'VALIDATION_ERROR');
    return id;
  }

  static String fileName(Object? value){
    final name=boundedText(value,max:180);
    if(name.contains('/')||name.contains('\\')||name=='.'||name=='..')
      throw const NativeCloudException('اسم الملف غير صالح.',code:'VALIDATION_ERROR');
    return name;
  }

  static void validateKeys(Map<String,dynamic> args,Set<String> allowed){
    if(args.keys.any((k)=>!allowed.contains(k)))throw const NativeCloudException('معطيات الطلب غير صالحة.',code:'VALIDATION_ERROR');
  }

  static Map<String,dynamic> _identity(User? u)=>{'configured':FirebaseSyncAuth.configured,
    'signedIn':u!=null&&u.emailVerified,
    if(u!=null&&u.emailVerified)'email':u.email,
    if(u!=null&&u.emailVerified)'displayName':u.displayName};

  Future<Map<String,dynamic>> identityStatus()async{
    if(!FirebaseSyncAuth.configured)return _identity(null);
    await FirebaseSyncAuth.initialize();
    return _identity(FirebaseAuth.instance.currentUser);
  }

  Map<String,dynamic> driveStatus(){
    final account=_drive;
    if(account==null||!FirebaseSyncAuth.matchesDriveAccount(account)){
      _clearDrive();
      return {'connected':false,'configured':FirebaseSyncAuth.configured};
    }
    return {'connected':true,'configured':true,'email':account.email,'displayName':account.displayName};
  }

  void _clearDrive(){_drive=null;_about=null;_uploads.clear();}

  Future<dynamic> handle(String action,String operation,Map<String,dynamic> args)async{
    if(_busy)throw const NativeCloudException('توجد عملية Google جارية؛ انتظر اكتمالها.',code:'DUPLICATE_REQUEST');
    _busy=true;
    try{
      if(action=='cloudIdentityAction'){
        validateKeys(args,operation=='signIn'?{'chooseAccount'}:{});
        if(operation=='status')return await identityStatus();
        if(operation=='signOut'){
          _clearDrive();
          if(FirebaseSyncAuth.configured)await FirebaseSyncAuth.signOut();
          return _identity(null);
        }
        if(operation=='signIn'){
          if(!FirebaseSyncAuth.configured)throw const NativeCloudException('إعداد Firebase غير متاح في هذه النسخة.');
          if(args['chooseAccount']!=null&&args['chooseAccount'] is! bool)throw ArgumentError('Invalid account choice');
          _clearDrive();
          final u=await FirebaseSyncAuth.signInWithGoogle(chooseAccount:args['chooseAccount']==true);
          return {...await identityStatus(),'cancelled':u==null};
        }
        throw const NativeCloudException('إجراء الهوية غير مسموح.',code:'VALIDATION_ERROR');
      }
      if(action!='googleDriveAction')throw ArgumentError('Invalid action');
      if(operation=='status'){validateKeys(args,{});return driveStatus();}
      if(operation=='disconnect'){validateKeys(args,{});_clearDrive();return driveStatus();}
      if(operation=='connect'){
        validateKeys(args,{'chooseAccount'});
        if(args['chooseAccount']!=null&&args['chooseAccount'] is! bool)throw ArgumentError('Invalid account choice');
        _clearDrive();
        if(!FirebaseSyncAuth.configured)throw const NativeCloudException('إعداد Firebase غير متاح في هذه النسخة.');
        final account=await FirebaseSyncAuth.authorizeDrive(chooseAccount:args['chooseAccount']==true);
        if(account==null)return {'connected':false,'cancelled':true};
        _drive=account;
        try{
          _about=await _json('GET','/drive/v3/about',query:{'fields':'user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive)'});
          final user=_about!['user'];
          if(user is! Map||user['emailAddress']?.toString().toLowerCase()!=account.email.toLowerCase())
            throw const NativeCloudException('تعذر التحقق من تطابق حساب Drive.');
          return driveStatus();
        }catch(_){_clearDrive();rethrow;}
      }
      _requireDrive();
      switch(operation){
        case 'getAbout':
          validateKeys(args,{});
          return _about??await _json('GET','/drive/v3/about',query:{'fields':'user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive)'});
        case 'listFiles':
          validateKeys(args,{'folderId','pageSize','queryText'});
          final parent=args['folderId']==null?null:fileId(args['folderId']);
          final term=boundedText(args['queryText'],optional:true);
          final page=args['pageSize']??60;
          if(page is! int||page<1||page>100)throw ArgumentError('Invalid page size');
          return await _list(parent:parent,term:term,pageSize:page);
        case 'createFolder':
        case 'findOrCreateFolder':
          validateKeys(args,{'folderName','parentId'});
          return await _folder(fileName(args['folderName']),args['parentId']==null?null:fileId(args['parentId']),find:operation=='findOrCreateFolder');
        case 'backupNative':
        case 'overwriteNative':
          validateKeys(args,{'name','parentId','fileId'});
          final raw=fileName(args['name']);
          final name=raw.toLowerCase().endsWith('.back')?raw:raw.replaceFirst(RegExp(r'\.(json|db|sqlite|backup)$',caseSensitive:false),'')+'.back';
          final existing=operation=='overwriteNative'?fileId(args['fileId']):null;
          final parent=args['parentId']==null?null:fileId(args['parentId']);
          if(!await confirm('حفظ نسخة في Google Drive','ستُرفع نسخة كاملة غير مشفّرة من قاعدة العمل إلى حساب '+_drive!.email+
              (existing==null?'':' مع استبدال الملف المحدد.')))return {'cancelled':true};
          final confirmedAccount=_requireDrive();
          final bytes=await exportWorkspace();
          if(!identical(confirmedAccount,_requireDrive()))throw const NativeCloudException('تغير الحساب بعد تأكيد النسخ الاحتياطي.',code:'UNAUTHORIZED_ACTION');
          return await _upload(bytes,name,'application/octet-stream',parent:parent,existing:existing);
        case 'uploadLocal':
          validateKeys(args,{'parentId'});
          final parent=args['parentId']==null?null:fileId(args['parentId']);
          final pickerAccount=_requireDrive();
          final picked=await pickFile();
          if(!identical(pickerAccount,_requireDrive()))throw const NativeCloudException('تغير الحساب أثناء اختيار الملف.',code:'UNAUTHORIZED_ACTION');
          if(picked==null)return {'cancelled':true};
          final name=fileName(picked.name);
          if(!await confirm('رفع ملف إلى Drive','رفع الملف '+name+' إلى حساب '+_drive!.email+'؟'))return {'cancelled':true};
          return await _upload(picked.bytes,name,'application/octet-stream',parent:parent);
        case 'restoreNative':
        case 'saveFile':
          validateKeys(args,{'fileId'});
          final id=fileId(args['fileId']);
          final meta=await _metadata(id);
          final name=fileName(meta['name']);
          final mime=meta['mimeType'];
          if(mime is! String||mime.startsWith('application/vnd.google-apps.'))
            throw const NativeCloudException('تنزيل مستندات Google الأصلية غير مدعوم؛ اختر ملفًا عاديًا.');
          final size=int.tryParse(meta['size']?.toString()??'');
          if(size==null||size<1||size>maxBytes)throw const NativeCloudException('حجم الملف غير مدعوم (الحد 32 ميغابايت).');
          final bytes=(await _request('GET',Uri.https('www.googleapis.com','/drive/v3/files/$id',{'alt':'media'}),limit:maxBytes)).bytes;
          if(bytes.length!=size||(meta['md5Checksum'] is String&&md5.convert(bytes).toString()!=meta['md5Checksum']))
            throw const NativeCloudException('لم يكتمل تنزيل الملف أو فشل التحقق منه.');
          if(operation=='restoreNative'&&!await confirm('استعادة نسخة احتياطية','استعادة الملف '+name+' من حساب '+_drive!.email+' قد تستبدل بيانات العمل الحالية. هل تريد المتابعة؟'))return {'completed':false,'cancelled':true,'name':name};
          final ok=operation=='restoreNative'?await restoreWorkspace(bytes,name):await saveFile(bytes,name);
          return {'completed':ok,'name':name};
        case 'trashFile':
          validateKeys(args,{'fileId'});
          final id=fileId(args['fileId']),meta=await _metadata(id);
          if(!await confirm('نقل إلى سلة المهملات','نقل '+fileName(meta['name'])+' إلى سلة Drive؟'))return {'cancelled':true};
          await _json('PATCH','/drive/v3/files/$id',body:{'trashed':true});
          return {'completed':true};
        case 'beginUpload':
          validateKeys(args,{'name','mimeType','parentId','fileId','sizeBytes','description'});
          final size=args['sizeBytes'];
          if(size is! int||size<1||size>maxBytes)throw ArgumentError('Invalid size');
          final mime=boundedText(args['mimeType'],max:120);
          if(!RegExp(r'^[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+$').hasMatch(mime))throw ArgumentError('Invalid mime type');
          _uploads.clear();
          final uploadId=DateTime.now().microsecondsSinceEpoch.toString();
          _uploads[uploadId]=_PendingUpload(fileName(args['name']),mime,size,
            args['parentId']==null?null:fileId(args['parentId']),args['fileId']==null?null:fileId(args['fileId']));
          return {'uploadId':uploadId};
        case 'appendUpload':
          validateKeys(args,{'uploadId','offset','base64'});
          final uploadId=boundedText(args['uploadId'],max:64);
          final upload=_uploads[uploadId];
          final chunk=args['base64'];
          if(upload==null||args['offset']!=upload.bytes.length||chunk is! String||chunk.length>22000)
            throw ArgumentError('Invalid upload chunk');
          final data=base64Decode(chunk);
          if(data.isEmpty||upload.bytes.length+data.length>upload.size)throw ArgumentError('Invalid upload length');
          upload.bytes.add(data);
          return {'received':upload.bytes.length};
        case 'abortUpload':
          validateKeys(args,{'uploadId'});
          _uploads.remove(boundedText(args['uploadId'],max:64));return {'cancelled':true};
        case 'finishUpload':
          validateKeys(args,{'uploadId'});
          final upload=_uploads.remove(boundedText(args['uploadId'],max:64));
          if(upload==null||upload.bytes.length!=upload.size)throw ArgumentError('Incomplete upload');
          if(!await confirm('رفع ملف إلى Drive','رفع '+upload.name+' إلى '+_drive!.email+(upload.existing==null?'؟':' مع استبدال الملف المحدد؟')))return {'cancelled':true};
          return await _upload(upload.bytes.takeBytes(),upload.name,upload.mime,parent:upload.parent,existing:upload.existing);
        default:
          throw const NativeCloudException('هذا الإجراء غير مفعّل في Drive المحلي.',code:'VALIDATION_ERROR');
      }
    }on NativeCloudException{rethrow;}
    on FirebaseAuthException catch(e){
      throw NativeCloudException(e.code=='network-request-failed'?'لا يوجد اتصال بخدمة Firebase.':'تعذر تسجيل الدخول إلى Firebase. تحقق من تفعيل Google وإعداد التطبيق.');
    }on PlatformException catch(e){
      throw NativeCloudException(e.code=='network_error'?'لا يوجد اتصال بخدمة Google.':'تعذر إكمال مصادقة Google. تحقق من شهادة APK وإعداد OAuth.');
    }on TimeoutException{
      throw const NativeCloudException('انتهت مهلة الاتصال بخدمة Google. تحقق من الملفات قبل تكرار أي رفع.');
    }on SocketException{
      throw const NativeCloudException('تعذر الاتصال بخدمة Google. بيانات SQLite المحلية متاحة دون الإنترنت.');
    }on ArgumentError{
      throw const NativeCloudException('معطيات العملية غير صالحة.',code:'VALIDATION_ERROR');
    }catch(_){
      throw const NativeCloudException('تعذر إكمال العملية. تحقق من إعدادات Google والاتصال؛ لم يُؤكد نجاح الرفع أو الاستعادة.');
    }finally{_busy=false;}
  }

  GoogleSignInAccount _requireDrive(){
    final account=_drive;
    if(account==null||!FirebaseSyncAuth.matchesDriveAccount(account)){
      _clearDrive();throw const NativeCloudException('أعد ربط حساب Google Drive.',code:'UNAUTHORIZED_ACTION');
    }
    return account;
  }

  Future<({Uint8List bytes,String? location})> _request(String method,Uri uri,
      {Uint8List? body,String? contentType,Map<String,String> headers=const {},int limit=maxJson})async{
    if(uri.scheme!='https'||uri.host!='www.googleapis.com'||uri.userInfo.isNotEmpty||uri.hasPort&&uri.port!=443)
      throw const NativeCloudException('عنوان Google API غير صالح.',code:'VALIDATION_ERROR');
    final account=_requireDrive(),client=HttpClient()..connectionTimeout=const Duration(seconds:20);
    try{
      final auth=await account.authHeaders;
      if(!identical(account,_drive)||!FirebaseSyncAuth.matchesDriveAccount(account))throw const NativeCloudException('تغير حساب Google.',code:'UNAUTHORIZED_ACTION');
      final request=await client.openUrl(method,uri).timeout(const Duration(seconds:40));
      request.followRedirects=false;
      auth.forEach((key,value)=>request.headers.set(key,value));
      headers.forEach((key,value)=>request.headers.set(key,value));
      if(contentType!=null)request.headers.set('Content-Type',contentType);
      if(body!=null){request.contentLength=body.length;request.add(body);}
      final response=await request.close().timeout(const Duration(seconds:90));
      if(response.statusCode==401){_clearDrive();throw const NativeCloudException('انتهت جلسة Drive. أعد الربط.',code:'UNAUTHORIZED_ACTION');}
      if(response.statusCode==403)throw const NativeCloudException('رفض Google Drive الطلب. تحقق من تفعيل Drive API والموافقة على الصلاحية.');
      if(response.statusCode<200||response.statusCode>=300)throw NativeCloudException('رفض Drive العملية (HTTP '+response.statusCode.toString()+').');
      if(response.contentLength>limit)throw const NativeCloudException('الملف أكبر من الحجم المدعوم.');
      final out=BytesBuilder(copy:false);
      await for(final chunk in response.timeout(const Duration(seconds:40))){
        if(out.length+chunk.length>limit)throw const NativeCloudException('الملف أكبر من الحجم المدعوم.');
        out.add(chunk);
      }
      return (bytes:out.takeBytes(),location:response.headers.value('location'));
    }finally{client.close(force:true);}
  }

  Future<Map<String,dynamic>> _json(String method,String path,{Map<String,String>? query,Map<String,dynamic>? body})async{
    final data=await _request(method,Uri.https('www.googleapis.com',path,query),
      body:body==null?null:Uint8List.fromList(utf8.encode(jsonEncode(body))),contentType:body==null?null:'application/json');
    return Map<String,dynamic>.from(jsonDecode(utf8.decode(data.bytes)) as Map);
  }
  static String _escape(String value)=>value.replaceAll('\\','\\\\').replaceAll("'","\\'");
  Future<List<dynamic>> _list({String? parent,String term='',String? folderName,int pageSize=100})async{
    final q=["trashed = false",if(parent!=null)"'${_escape(parent)}' in parents",
      if(term.isNotEmpty)"name contains '${_escape(term)}'",
      if(folderName!=null)"name = '${_escape(folderName)}' and mimeType = '$folderMime'"].join(' and ');
    final out=<dynamic>[];
    String? next;
    // Bounded pagination; never expose other files outside drive.file.
    for(var page=0;page<5;page++){
      final result=await _json('GET','/drive/v3/files',query:{'q':q,'pageSize':pageSize.toString(),'fields':'nextPageToken,files($fields)','orderBy':'folder,modifiedTime desc',if(next!=null)'pageToken':next});
      out.addAll(result['files'] as List? ??[]);
      next=result['nextPageToken'] as String?;
      if(next==null||next.isEmpty)break;
    }
    if(next!=null&&next.isNotEmpty)throw const NativeCloudException('نتائج البحث كثيرة؛ ضيّق نطاق البحث لعرض جميع النتائج.');
    return out;
  }
  Future<Map<String,dynamic>> _metadata(String id)=>_json('GET','/drive/v3/files/$id',query:{'fields':fields});
  Future<Map<String,dynamic>> _folder(String name,String? parent,{required bool find})async{
    if(find){
      final rows=await _list(parent:parent??'root',folderName:name);
      if(rows.isNotEmpty)return Map<String,dynamic>.from(rows.first as Map);
    }
    return _json('POST','/drive/v3/files',query:{'fields':fields},body:{'name':name,'mimeType':folderMime,if(parent!=null)'parents':[parent]});
  }
  Future<Map<String,dynamic>> _upload(Uint8List bytes,String name,String mime,{String? parent,String? existing})async{
    if(bytes.isEmpty||bytes.length>maxBytes)throw const NativeCloudException('حجم الملف غير مدعوم.');
    final meta={'name':name,'mimeType':mime,if(existing==null&&parent!=null)'parents':[parent]};
    final session=await _request(existing==null?'POST':'PATCH',Uri.https('www.googleapis.com',
      existing==null?'/upload/drive/v3/files':'/upload/drive/v3/files/$existing',{'uploadType':'resumable','fields':fields}),
      body:Uint8List.fromList(utf8.encode(jsonEncode(meta))),contentType:'application/json',
      headers:{'X-Upload-Content-Type':mime,'X-Upload-Content-Length':bytes.length.toString()});
    final location=session.location;
    if(location==null)throw const NativeCloudException('لم تبدأ جلسة رفع Drive.');
    final uri=Uri.parse(location);
    if(!uri.path.startsWith('/upload/drive/v3/files'))throw const NativeCloudException('جلسة رفع غير صالحة.');
    final saved=await _request('PUT',uri,body:bytes,contentType:mime,
      headers:{'Content-Range':'bytes 0-${bytes.length-1}/${bytes.length}'});
    final result=Map<String,dynamic>.from(jsonDecode(utf8.decode(saved.bytes)) as Map);
    if(result['id'] is! String||int.tryParse(result['size']?.toString()??'')!=bytes.length||
        result['md5Checksum']!=md5.convert(bytes).toString())
      throw const NativeCloudException('لم يتأكد تطابق الملف المرفوع. تحقق من Drive قبل إعادة المحاولة.');
    return result;
  }
}

class _PendingUpload {
  _PendingUpload(this.name,this.mime,this.size,this.parent,this.existing);
  final String name,mime;
  final int size;
  final String? parent,existing;
  final bytes=BytesBuilder(copy:false);
}
