import 'dart:io';
import 'dart:isolate';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/models/erp_models.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/remote_account_applier.dart';
import 'package:nasqo_pro_erp/services/sqlite_remote_change_store.dart';
import 'package:nasqo_pro_erp/services/sync_engine.dart';

// Two independent SQLite files/isolates; simulated protocol, NOT live identity/server authorization.
class ProtocolServer implements SyncTransport {
  ProtocolServer(this.rows,{this.loseAck=false});
  final List<Map<String,dynamic>> rows;bool loseAck;bool forgeWorkspace=false;
  Future<String> push(String w,String id,String type,Map<String,dynamic> payload)async{
    var seen=rows.where((r)=>r['workspace_id']==w&&r['operation_id']==id);
    if(seen.isEmpty){rows.add({'workspace_id':w,'operation_id':id,'operation_type':type,'payload':payload,'server_revision':'${rows.where((r)=>r['workspace_id']==w).length+1}'});seen=rows.where((r)=>r['workspace_id']==w&&r['operation_id']==id);}
    if(loseAck){loseAck=false;throw const SocketException('accepted, acknowledgment lost');}
    return seen.single['server_revision'] as String;
  }
  Future<SyncPage> pull(String w,String? cursor)async{
    final filtered=rows.where((r)=>(forgeWorkspace||r['workspace_id']==w)&&int.parse(r['server_revision'] as String)>int.parse(cursor??'0')).toList();
    return SyncPage(filtered.isEmpty?(cursor??'0'):filtered.last['server_revision'] as String,filtered);
  }
}
Future<Map<String,dynamic>> instance(String folder,List<Map<String,dynamic>> operations,bool author)async{
 sqfliteFfiInit();databaseFactory=databaseFactoryFfi;await databaseFactory.setDatabasesPath(folder);
 final local=LocalDatabase.instance,db=await local.database,server=ProtocolServer(operations,loseAck:author),remote=SqliteRemoteChangeStore(LocalDatabase.instance,applyRemoteAccount);
 final engine=SyncEngine(local,server,remote,allowedOperationTypes:const {'account.create','account.update'});
 try{
 if(author){
  await local.createAccountAtomic('business-a','shared-operation',const AccountRecord(id:'shared-account',name:'حساب اصطناعي',category:AccountCategory.clients));
  var lost=false;try{await engine.synchronize('business-a');}on SocketException{lost=true;}
  if(!lost||(await local.pendingOperations('business-a')).length!=1)throw StateError('lost acknowledgment not retained');
 }
 await engine.synchronize('business-a');await engine.synchronize('business-a');
 if((await db.query('accounts')).length!=1||(await local.pendingOperations('business-a')).isNotEmpty)throw StateError('account replay duplicated or absent');
 await engine.synchronize('business-b');
 if((await remote.cursor('business-b'))!='0')throw StateError('workspace data leaked');
 server.forgeWorkspace=true;var rejected=false;
 try{await engine.synchronize('business-b');}on StateError{rejected=true;}
 if(!rejected||(await remote.cursor('business-b'))!='0'||(await db.query('accounts')).length!=1)throw StateError('forged page did not roll back');
 return {'operations':server.rows,'accounts':await db.query('accounts'),'journalCount':(await db.query('journal_lines')).length,'inbox':(await db.query('sync_inbox')).length};
 }finally{await db.close();}
}
void main(){test('two isolated SQLite instances converge once after lost acknowledgment; foreign workspace page rolls back',()async{
 final root=await Directory.systemTemp.createTemp('two-sync-instances');
 try{
 final a=await Directory('${root.path}/a').create(),b=await Directory('${root.path}/b').create();
 final first=await Isolate.run(()=>instance(a.path,[],true));
 final ops=List<Map<String,dynamic>>.from(first['operations'] as List);
 final second=await Isolate.run(()=>instance(b.path,ops,false));
 expect(ops,hasLength(1));expect(first['accounts'],second['accounts']);expect(first['inbox'],1);expect(second['inbox'],1);expect(first['journalCount'],0);expect(second['journalCount'],0);
 }finally{await root.delete(recursive:true);}
});}
