import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/screens/legacy_stock_batch_screen.dart';

Widget screen()=>const MaterialApp(home:LegacyStockBatchScreen(
  sourceSha:'synthetic-source',initialWarehouseId:'wh',
  warehouses:[{'id':'wh','name':'مخزن اصطناعي'}],accounts:[],openings:[],
  products:[{'id':'p','name':'صنف اصطناعي','unit':'حبة','currencyCode':'ريال',
    'avgCost':20,'legacyInvoiceQtyByWarehouse':{'wh':99},'legacyTransferIncomplete':true}],
  quantityApprovals:[{'source_item_id':'p','warehouse_id':'wh','quantity':3}],
));

void main(){
  testWidgets('cost review locks approved quantities and rejects pasted quantity changes',(tester)async{
    await tester.binding.setSurfaceSize(const Size(360,800));
    addTearDown(()=>tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(screen());await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
    await tester.tap(find.byTooltip('تعديل التكلفة فقط'));await tester.pumpAndSettle();
    final quantity=find.widgetWithText(TextField,'3');
    expect(tester.widget<TextField>(quantity).readOnly,true);
    expect(tester.widget<TextField>(find.widgetWithText(TextField,'60.0')).readOnly,false);
    await tester.tap(find.text('إلغاء'));await tester.pumpAndSettle();
    await tester.tap(find.text('لصق جرد فعلي'));await tester.pumpAndSettle();
    final input=find.descendant(of:find.byType(AlertDialog),matching:find.byType(TextField));
    await tester.enterText(input,'p,99,1980');
    await tester.tap(find.text('إضافة إلى المسودة'));await tester.pumpAndSettle();
    expect(find.text('الكمية مثبتة سابقًا؛ عدّل التكلفة فقط دون تغيير الكمية.'),findsOneWidget);
    await tester.enterText(input,'p,3,75');
    await tester.tap(find.text('إضافة إلى المسودة'));await tester.pumpAndSettle();
    expect(find.textContaining('القيمة: 75.00'),findsOneWidget);
    expect(find.textContaining('الكمية المثبتة: 3'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
  testWidgets('batch review remains reachable in landscape',(tester)async{
    await tester.binding.setSurfaceSize(const Size(800,360));
    addTearDown(()=>tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(screen());await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
    expect(find.text('مراجعة واعتماد الأرصدة المحددة'),findsOneWidget);
  });
}
