import 'package:flutter/material.dart';
import '../services/legacy_stock_opening.dart';
import '../services/legacy_stock_batch.dart';
import '../services/local_database.dart';

class LegacyStockBatchScreen extends StatefulWidget {
  const LegacyStockBatchScreen({super.key,required this.products,required this.warehouses,
    required this.accounts,required this.openings});
  final List<Map<String,dynamic>> products,warehouses,accounts,openings;
  @override
  State<LegacyStockBatchScreen> createState()=>_LegacyStockBatchScreenState();
}

class _LegacyStockBatchScreenState extends State<LegacyStockBatchScreen>{
  final input=TextEditingController(),evidence=TextEditingController();
  String? warehouse,asset,offset,error;
  String date=DateTime.now().toIso8601String().substring(0,10);
  int? skipped;
  bool busy=false,confirmed=false;

  @override
  void dispose(){input.dispose();evidence.dispose();super.dispose();}

  Widget choice(String label,List<Map<String,dynamic>> list,String? value,ValueChanged<String?> change){
    return DropdownButtonFormField<String>(isExpanded:true,value:value,
      decoration:InputDecoration(labelText:label,border:const OutlineInputBorder()),
      items:[for(final item in list)DropdownMenuItem(value:item['id'] as String,
        child:Text(item['name'].toString(),overflow:TextOverflow.ellipsis))],
      onChanged:busy?null:change);
  }

  Future<void> _date()async{
    final picked=await showDatePicker(context:context,initialDate:DateTime.parse(date),
      firstDate:DateTime(2000),lastDate:DateTime.now());
    if(picked!=null&&mounted)setState((){date=picked.toIso8601String().substring(0,10);confirmed=false;});
  }

  Future<void> _suggest()async{
    if(warehouse==null||busy)return;
    if(input.text.trim().isNotEmpty){
      final yes=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('استبدال مسودة الجرد؟'),
        content:const Text('ستستبدل البيانات المكتوبة باقتراحات تاريخية غير معتمدة.'),
        actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('استبدال المسودة'))]));
      if(yes!=true||!mounted)return;
    }
    final draft=LegacyStockBatch.suggestions(widget.products,widget.openings,warehouse!);
    setState((){input.text=draft.draft;skipped=draft.skipped;confirmed=false;error=null;});
  }

  Future<void> _submit()async{
    if(busy||!confirmed||warehouse==null||asset==null||offset==null||asset==offset||evidence.text.trim().isEmpty)return;
    try{
      final rows=LegacyStockBatch.parse(input.text,widget.products,warehouse!,{
        'inventoryAccountId':asset,'offsetAccountId':offset,'entryDate':date,'evidence':evidence.text.trim(),'confirmed':true});
      final ids=widget.openings.where((o)=>o['warehouse_id']==warehouse).map((o)=>o['source_item_id']).toSet();
      if(rows.any((r)=>ids.contains(r['sourceItemId'])))throw const FormatException('توجد أصناف سبق اعتمادها في هذا المخزن');
      final total=rows.fold<num>(0,(sum,r)=>sum+(r['totalValue'] as num));
      final name=widget.warehouses.firstWhere((w)=>w['id']==warehouse)['name'];
      final accepted=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('تأكيد اعتماد الجرد الجماعي'),
        content:Text('المخزن: $name\nعدد الأصناف: ${rows.length}\nإجمالي قيمة الافتتاح: ${total.toStringAsFixed(2)} ريال\n'
          'أكد أنك طابقت الكميات والتكاليف فعليًا وأن قيمة المخزون غير مثبتة مسبقًا. ستُحفظ الدفعة كاملة أو تُرفض كاملة دون تعديل.'),
        actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('اعتماد الدفعة'))]));
      if(accepted!=true||!mounted)return;
      setState((){busy=true;error=null;});
      await LegacyStockOpening(LocalDatabase.instance).approveBatch('local-erp-workspace',rows);
      if(mounted)Navigator.pop(context,true);
    }on FormatException catch(e){
      if(mounted)setState((){busy=false;error=e.message;});
    }on StateError catch(e){
      if(mounted)setState((){busy=false;error='رُفضت الدفعة دون اعتماد جزئي: ${e.message}';});
    }catch(_){
      if(mounted)setState((){busy=false;error='لم يتم اعتماد الدفعة. تحقق من القيم والحسابات ثم أعد المحاولة.';});
    }
  }

  @override
  Widget build(BuildContext context){
    return Directionality(textDirection:TextDirection.rtl,child:PopScope(canPop:!busy,child:Scaffold(
      appBar:AppBar(title:const Text('جرد جماعي للمخزن')),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        const Text('يمكن إنشاء مسودة من الفواتير والتحويلات المعروفة، أو لصق جدول جرد فعلي. الاقتراحات ليست جردًا مؤكدًا.'),
        const SizedBox(height:12),
        if(busy)const LinearProgressIndicator(),
        choice('المخزن',widget.warehouses,warehouse,(v)=>setState((){warehouse=v;confirmed=false;input.clear();skipped=null;})),
        const SizedBox(height:8),
        OutlinedButton(onPressed:busy||warehouse==null?null:_suggest,child:const Text('تجهيز اقتراحات تاريخية لهذا المخزن')),
        if(skipped!=null)Text('عدد الأصناف غير المدرجة في الاقتراحات: $skipped (مرجع ناقص أو كمية أو تكلفة غير مناسبة).'),
        const Text('كل سطر: معرف الصنف، الكمية بالوحدة الأساسية، إجمالي التكلفة. افصل الحقول بفاصلة أو Tab.'),
        TextField(controller:input,enabled:!busy,keyboardType:TextInputType.multiline,minLines:6,maxLines:15,
          textDirection:TextDirection.ltr,decoration:const InputDecoration(hintText:'legacy-prod-1,10,3500',border:OutlineInputBorder()),
          onChanged:(_)=>setState(()=>confirmed=false)),
        const SizedBox(height:12),
        choice('حساب أصل المخزون',widget.accounts,asset,(v)=>setState((){asset=v;confirmed=false;})),
        const SizedBox(height:12),
        choice('حساب التسوية الافتتاحية',widget.accounts,offset,(v)=>setState((){offset=v;confirmed=false;})),
        TextButton.icon(onPressed:busy?null:_date,icon:const Icon(Icons.calendar_today),label:Text('تاريخ الاعتماد: $date')),
        TextField(controller:evidence,enabled:!busy,maxLength:300,onChanged:(_)=>setState(()=>confirmed=false),
          decoration:const InputDecoration(labelText:'مرجع محضر الجرد والتقييم',border:OutlineInputBorder())),
        CheckboxListTile(value:confirmed,onChanged:busy?null:(v)=>setState(()=>confirmed=v??false),
          title:const Text('تحققت من جميع الكميات والتكاليف والحسابات، ولن أكرر قيمة مثبتة سابقًا.')),
        if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
        FilledButton(onPressed:busy||!confirmed||warehouse==null||asset==null||offset==null||asset==offset?null:_submit,
          child:const Text('مراجعة واعتماد الدفعة')),
      ]),
    )));
  }
}
