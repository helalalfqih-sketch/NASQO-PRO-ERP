import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/http_sync_transport.dart';

void main(){
  Map<String,dynamic> row(String rev,{String id='op',String workspace='w'})=>{
    'workspace_id':workspace,'operation_id':id,'server_revision':rev,
    'operation_type':'account.create','payload':<String,dynamic>{},
  };
  Map<String,dynamic> page(String next,List<Map<String,dynamic>> rows)=>{
    'workspace_id':'w','next_cursor':next,'operations':rows,
  };
  test('sync revisions must be contiguous, scoped and match next cursor',(){
    expect(HttpSyncTransport.validatePage('w',null,page('2',[row('1'),row('2',id:'op2')])).nextCursor,'2');
    expect(HttpSyncTransport.validatePage('w','2',page('2',[])).operations,isEmpty);
    for(final p in [
      page('3',[row('3')]),
      page('2',[row('1')]),
      page('1',[row('1',workspace:'other')]),
      page('2',[row('1'),row('2')]),
      page('2',[row('1'),row('1',id:'other')]),
      page('01',[row('1')]),
    ]){
      expect(()=>HttpSyncTransport.validatePage('w',null,p),throwsFormatException);
    }
  });
}
