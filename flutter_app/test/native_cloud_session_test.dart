import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/native_cloud_session.dart';

void main(){
  test('cloud input validation rejects malformed and oversized identifiers',(){
    for(final value in [null, 123, '', '   ', 'a\n b', List.filled(65,'a').join()]){
      expect(()=>NativeCloudSession.boundedText(value,max:64),throwsA(isA<NativeCloudException>()));
    }
    expect(NativeCloudSession.boundedText(' session-123 ',max:64),'session-123');
    expect(()=>NativeCloudSession.validateKeys({'unexpected':true},{'uploadId'}),throwsA(isA<NativeCloudException>()));
    expect(()=>NativeCloudSession.validateKeys({'uploadId':'session-123'},{'uploadId'}),returnsNormally);
  });

  test('native Drive sessions fail closed without user authorization',()async{
    var actions=0;
    final session=NativeCloudSession(
      confirm:(_,__)async{actions++;return false;},
      exportWorkspace:()async=>throw StateError('unexpected export'),
      restoreWorkspace:(_,__)async{actions++;return false;},
      pickFile:()async=>throw StateError('unexpected picker'),
      saveFile:(_,__)async{actions++;return false;},
    );
    final status=await session.handle('googleDriveAction','status',{});
    expect(status['connected'],false);
    expect(status.containsKey('accessToken'),false);
    await expectLater(session.handle('googleDriveAction','backupNative',{'name':'sample.back'}),throwsA(isA<NativeCloudException>()));
    await expectLater(session.handle('googleDriveAction','listFiles',{}),throwsA(isA<NativeCloudException>()));
    await expectLater(session.handle('googleDriveAction','status',{'url':'https://example.invalid'}),throwsA(isA<NativeCloudException>()));
    expect(actions,0);
    final disconnected=await session.handle('googleDriveAction','disconnect',{});
    expect(disconnected['connected'],false);
    expect(NativeCloudSession.fileId('valid_ID-12'),'valid_ID-12');
    expect(()=>NativeCloudSession.fileId('../abc'),throwsA(isA<NativeCloudException>()));
    expect(()=>NativeCloudSession.fileName('../sample.back'),throwsA(isA<NativeCloudException>()));
    expect(()=>NativeCloudSession.fileName('a\\b'),throwsA(isA<NativeCloudException>()));
  });
}
