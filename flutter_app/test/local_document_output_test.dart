import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/local_document_output.dart';

void main(){
  test('document output transfers exact bytes, rejects invalid chunks and removes temporary files',()async{
    final dir=await Directory.systemTemp.createTemp('nasqo-output-');
    final bytes=utf8.encode('%PDF-1.4\nsynthetic fixture');
    var calls=0;
    bool accept=true;
    final service=LocalDocumentOutput(cachePath:()async=>dir.path,destination:(file,name,mime,mode)async{
      calls++;
      expect(name,'invoice.pdf');expect(mime,'application/pdf');
      expect(await file.readAsBytes(),orderedEquals(bytes));
      return accept;
    });
    Future<Map<String,dynamic>> invoke(String action,Map<String,dynamic> payload)=>
      service.handle(action,{'workspaceId':'local-erp-workspace',...payload});
    Future<String> begin({String name='invoice.pdf',int? size,String mode='save'})async=>
      (await invoke('beginDocumentExport',{'fileName':name,'mimeType':'application/pdf','mode':mode,'sizeBytes':size??bytes.length}))['exportId'] as String;
    try{
      await expectLater(begin(name:'../invoice.pdf'),throwsArgumentError);
      await expectLater(begin(size:LocalDocumentOutput.maxBytes+1),throwsArgumentError);
      final id=await begin();
      await expectLater(begin(),throwsStateError);
      await expectLater(invoke('appendDocumentExport',{'exportId':id,'offset':1,'base64':base64Encode(bytes)}),throwsArgumentError);
      await expectLater(invoke('finishDocumentExport',{'exportId':id}),throwsStateError);
      final first=await invoke('appendDocumentExport',{'exportId':id,'offset':0,'base64':base64Encode(bytes.take(7).toList())});
      expect(first['received'],7);
      await expectLater(invoke('appendDocumentExport',{'exportId':id,'offset':0,'base64':base64Encode(bytes)}),throwsArgumentError);
      await invoke('appendDocumentExport',{'exportId':id,'offset':7,'base64':base64Encode(bytes.skip(7).toList())});
      expect((await invoke('finishDocumentExport',{'exportId':id}))['completed'],true);
      expect(calls,1);
      final second=await begin(mode:'share');
      accept=false;
      await invoke('appendDocumentExport',{'exportId':second,'offset':0,'base64':base64Encode(bytes)});
      expect((await invoke('finishDocumentExport',{'exportId':second}))['completed'],false);
      expect(calls,2);
      final bad=await begin(size:3);
      await invoke('appendDocumentExport',{'exportId':bad,'offset':0,'base64':base64Encode([1,2,3])});
      await expectLater(invoke('finishDocumentExport',{'exportId':bad}),throwsFormatException);
      expect(calls,2);
      final aborted=await begin();
      await invoke('abortDocumentExport',{'exportId':aborted});
      expect(await Directory('${dir.path}/nasqo-document-export').list().toList(),isEmpty);
    }finally{await service.dispose();await dir.delete(recursive:true);}
  });
}
