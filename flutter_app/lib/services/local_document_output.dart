import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/services.dart';

typedef DocumentDestination=Future<bool> Function(File file,String name,String mime,String mode);

/// Bounded native document handoff. Only explicitly selected PDF/PNG/CSV
/// content is accepted, in ordered chunks. Never accepts a filesystem path
/// or arbitrary URL from the WebView.
class LocalDocumentOutput {
  LocalDocumentOutput({Future<String> Function()? cachePath,DocumentDestination? destination})
    :_cachePath=cachePath??_nativeCache,_destination=destination??_nativeDestination;
  final Future<String> Function() _cachePath;
  final DocumentDestination _destination;
  static const _channel=MethodChannel('nasqo/local_backup');
  static const _output=MethodChannel('nasqo/document_output');
  static const maxBytes=16*1024*1024;
  static const maxChunk=20*1024;
  static const types={'application/pdf':'.pdf','image/png':'.png','text/csv':'.csv'};
  static Future<String> _nativeCache()async=>
    (await _channel.invokeMethod<String>('cachePath'))??(throw StateError('Private cache unavailable'));
  static Future<bool> _nativeDestination(File file,String name,String mime,String mode)async{
    final channel=mode=='save'?_channel:_output;
    return await channel.invokeMethod<bool>(mode=='save'?'exportDocument':'shareDocument',
      {'path':file.path,'fileName':name,'mimeType':mime})==true;
  }

  _DocumentSession? _session;
  bool _busy=false;
  bool _disposed=false;
  static bool validName(String name,String mime)=>name.isNotEmpty&&name.length<=120&&
    !name.startsWith('.')&&!name.contains('/')&&!name.contains('\\')&&
    !name.contains(RegExp(r'[\x00-\x1f\x7f]'))&&
    types.containsKey(mime)&&name.toLowerCase().endsWith(types[mime]!);
  static void fields(Map<String,dynamic> p,List<String> expected){
    if(p.keys.toSet().length!=expected.length||!p.keys.toSet().containsAll(expected))throw ArgumentError('Invalid export fields');
  }
  Future<void> _clear()async{
    final s=_session;_session=null;
    if(s==null)return;
    try{await s.handle?.close();}catch(_){}
    try{await s.folder.delete(recursive:true);}catch(_){}
  }
  Future<void> dispose()async{_disposed=true;if(!_busy)await _clear();}

  Future<Map<String,dynamic>> handle(String action,Map<String,dynamic> p)async{
    if(_busy||_disposed)throw StateError('Document output busy');
    _busy=true;
    try{
      if(p['workspaceId']!='local-erp-workspace')throw ArgumentError('Invalid workspace');
      if(action=='beginDocumentExport'){
        fields(p,['workspaceId','fileName','mimeType','sizeBytes','mode']);
        final name=p['fileName'],mime=p['mimeType'],size=p['sizeBytes'],mode=p['mode'];
        if(name is! String||mime is! String||!validName(name,mime)||size is! int||size<1||size>maxBytes||
            !['save','share'].contains(mode))throw ArgumentError('Invalid document size or type');
        if(_session!=null){
          if(DateTime.now().difference(_session!.created)<const Duration(minutes:10))throw StateError('Document export already open');
          await _clear();
        }
        final parent=Directory('${await _cachePath()}/nasqo-document-export');
        await parent.create(recursive:true);
        // Only remove expired temporary handoff folders owned by this service.
        await for(final child in parent.list(followLinks:false)){
          if(child is Directory&&child.path.split(Platform.pathSeparator).last.startsWith('doc-')&&
              DateTime.now().difference((await child.stat()).modified)>const Duration(days:1)){
            try{await child.delete(recursive:true);}catch(_){}
          }
        }
        final folder=await parent.createTemp('doc-');
        final file=File('${folder.path}/$name');
        try{
          final handle=await file.open(mode:FileMode.write);
          final random=Random.secure(),id=base64Url.encode(List<int>.generate(18,(_)=>random.nextInt(256)));
          _session=_DocumentSession(id,folder,file,name,mime,mode as String,size,handle);
          return {'exportId':id,'received':0};
        }catch(_){await folder.delete(recursive:true);rethrow;}
      }
      final current=_session;
      if(current==null||p['exportId']!=current.id)throw ArgumentError('Unknown document export');
      if(action=='abortDocumentExport'){
        fields(p,['workspaceId','exportId']);await _clear();return {'cancelled':true};
      }
      if(action=='appendDocumentExport'){
        fields(p,['workspaceId','exportId','offset','base64']);
        final raw=p['base64'];
        if(raw is! String||raw.length>((maxChunk+2)~/3)*4||p['offset']!=current.received)
          throw ArgumentError('Invalid document chunk');
        final bytes=base64Decode(raw);
        if(bytes.isEmpty||bytes.length>maxChunk||current.received+bytes.length>current.size)
          throw ArgumentError('Invalid document chunk size');
        await current.handle!.writeFrom(bytes);current.received+=bytes.length;
        return {'received':current.received};
      }
      if(action=='finishDocumentExport'){
        fields(p,['workspaceId','exportId']);
        if(current.received!=current.size)throw StateError('Document transfer incomplete');
        try{
          await current.handle!.flush();await current.handle!.close();current.handle=null;
          final input=await current.file.open();
          late final List<int> header;
          try{header=await input.read(8);}finally{await input.close();}
          if(current.mime=='application/pdf'&&(header.length<5||ascii.decode(header.take(5).toList(),allowInvalid:true)!='%PDF-'))
            throw const FormatException('Not a PDF');
          if(current.mime=='image/png'&&(header.length<8||base64Encode(header)!='iVBORw0KGgo='))
            throw const FormatException('Not a PNG');
          final ok=await _destination(current.file,current.name,current.mime,current.mode);
          return {'completed':ok,'mode':current.mode};
        }finally{await _clear();}
      }
      throw ArgumentError('Unsupported document output');
    }finally{
      _busy=false;
      if(_disposed)await _clear();
    }
  }
}

class _DocumentSession {
  _DocumentSession(this.id,this.folder,this.file,this.name,this.mime,this.mode,this.size,this.handle);
  final String id,name,mime,mode;
  final Directory folder;
  final File file;
  final int size;
  final DateTime created=DateTime.now();
  RandomAccessFile? handle;
  int received=0;
}
