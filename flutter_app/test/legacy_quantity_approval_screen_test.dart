import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/screens/legacy_quantity_approval_screen.dart';
import 'package:nasqo_pro_erp/services/legacy_quantity_approval.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';

class SyntheticApproval extends LegacyQuantityApproval {
  SyntheticApproval():super(LocalDatabase.instance);
  int calls=0,reads=0;
  bool stale=false,done=false;
  @override
  Future<Map<String,dynamic>> preview(String warehouse)async{
    reads++;
    return {'sourceSha':'synthetic-source','reviewHash':'review-$reads','warehouseId':warehouse,'warehouseName':'مخزن اصطناعي','entryDate':'2026-11-25',
      'rows':done?[]:[{'sourceItemId':'p','name':'صنف اصطناعي','unit':'حبة','quantity':35.125,'reason':null,'transferIncomplete':true},
        {'sourceItemId':'bad','name':'سالب','unit':'حبة','quantity':-1,'reason':'كمية سالبة'}]};
  }
  @override
  Future<int> approve(String warehouse,List<String> selected,{required String sourceSha,required String reviewHash,required bool confirmed})async{
    expect(warehouse,'wh');expect(selected,['p']);expect(sourceSha,'synthetic-source');expect(confirmed,true);
    calls++;
    if(stale)throw StateError('تغيرت الكميات؛ أعد المراجعة.');
    done=true;return 1;
  }
}

void main(){
  testWidgets('quantity review requires selection, acknowledgement and final confirmation; cancel never writes',(tester)async{
    await tester.binding.setSurfaceSize(const Size(360,800));
    addTearDown(()=>tester.binding.setSurfaceSize(null));
    final service=SyntheticApproval();
    await tester.pumpWidget(MaterialApp(home:LegacyQuantityApprovalScreen(service:service,initialWarehouseId:'wh',warehouses:const [{'id':'wh','name':'مخزن اصطناعي'}])));
    await tester.pumpAndSettle();
    expect(service.calls,0);
    expect(find.textContaining('35.125'),findsOneWidget);
    final save=find.widgetWithText(FilledButton,'اعتماد الكميات فقط');
    expect(tester.widget<FilledButton>(save).onPressed,isNull);
    await tester.tap(find.text('تحديد النتائج القابلة للاعتماد'));await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(save).onPressed,isNull);
    await tester.tap(find.text('راجعت الكميات المحددة وهي الرصيد الحالي الصحيح، وليس اعتمادًا للتكلفة.'));await tester.pumpAndSettle();
    await tester.tap(save);await tester.pump(const Duration(milliseconds:300));
    expect(find.text('تأكيد الكميات الحالية فقط'),findsOneWidget);expect(service.calls,0);
    await tester.tap(find.text('إلغاء'));await tester.pumpAndSettle();expect(service.calls,0);
    await tester.tap(save);await tester.pump(const Duration(milliseconds:300));
    await tester.tap(find.text('تأكيد اعتماد الكميات'));await tester.pumpAndSettle();
    expect(service.calls,1);expect(service.reads,2);
    expect(tester.widget<FilledButton>(save).onPressed,isNull);
    expect(find.textContaining('التكلفة ما زالت غير معتمدة'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
  testWidgets('stale review keeps error visible and requires a fresh acknowledgement',(tester)async{
    await tester.binding.setSurfaceSize(const Size(360,800));
    addTearDown(()=>tester.binding.setSurfaceSize(null));
    final service=SyntheticApproval()..stale=true;
    await tester.pumpWidget(MaterialApp(home:LegacyQuantityApprovalScreen(service:service,initialWarehouseId:'wh',warehouses:const [{'id':'wh','name':'مخزن اصطناعي'}])));
    await tester.pumpAndSettle();
    await tester.tap(find.text('تحديد النتائج القابلة للاعتماد'));await tester.pumpAndSettle();
    await tester.tap(find.text('راجعت الكميات المحددة وهي الرصيد الحالي الصحيح، وليس اعتمادًا للتكلفة.'));await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'اعتماد الكميات فقط'));await tester.pump(const Duration(milliseconds:300));
    await tester.tap(find.text('تأكيد اعتماد الكميات'));await tester.pumpAndSettle();
    expect(find.text('تغيرت الكميات؛ أعد المراجعة.'),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'اعتماد الكميات فقط')).onPressed,isNull);
    await tester.tap(find.byTooltip('إعادة تحميل الكميات'));await tester.pumpAndSettle();
    expect(service.reads,2);expect(service.calls,1);expect(tester.takeException(),isNull);
  });
}
