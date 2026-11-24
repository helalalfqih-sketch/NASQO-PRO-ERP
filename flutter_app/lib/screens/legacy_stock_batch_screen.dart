import 'package:flutter/material.dart';
import '../services/legacy_stock_opening.dart';
import '../services/legacy_stock_batch.dart';
import '../services/local_database.dart';

/// An editable, named reconciliation list. Calculations are proposals only.
class LegacyStockBatchScreen extends StatefulWidget {
  const LegacyStockBatchScreen({super.key,required this.products,required this.warehouses,
    required this.accounts,required this.openings,required this.sourceSha,this.initialWarehouseId});
  final List<Map<String,dynamic>> products,warehouses,accounts,openings;
  final String sourceSha;
  final String? initialWarehouseId;
  @override
  State<LegacyStockBatchScreen> createState()=>_LegacyStockBatchScreenState();
}

class _LegacyStockBatchScreenState extends State<LegacyStockBatchScreen>{
  static const allWarehouses='__all__';
  final evidence=TextEditingController(),search=TextEditingController();
  final selected=<String,Map<String,dynamic>>{};
  List<Map<String,dynamic>> rows=[];
  String warehouse=allWarehouses,filter='all';
  String? asset,offset,error;
  String date=DateTime.now().toIso8601String().substring(0,10);
  bool busy=false,confirmed=false;
  static const reasons={'approved':'معتمد سابقًا','suggested':'اقتراح قابل للمراجعة',
    'transfer':'تحويل غير مكتمل','negative':'رصيد تاريخي سالب','no_history':'لا توجد حركة معروفة',
    'cost':'تكلفة غير صالحة','currency':'عملة غير مدعومة','precision':'كمية أو قيمة خارج الدقة المدعومة'};

  @override
  void initState(){
    super.initState();
    if(widget.warehouses.any((w)=>w['id']==widget.initialWarehouseId))warehouse=widget.initialWarehouseId!;
    _prepare();
  }
  @override
  void dispose(){evidence.dispose();search.dispose();super.dispose();}
  String key(Map<String,dynamic> row)=>"${row['sourceItemId']}|${row['warehouseId']}";
  String warehouseName(Object? id)=>widget.warehouses.firstWhere((w)=>w['id']==id,orElse:()=>{'name':id})['name'].toString();
  void _prepare(){
    selected.clear();confirmed=false;error=null;
    rows=[
      for(final w in widget.warehouses)
        if(warehouse==allWarehouses||warehouse==w['id'])
          ...LegacyStockBatch.reviewRows(widget.products,widget.openings,w['id'] as String)
            .where((r)=>warehouse!=allWarehouses||r['relevant']==true)
    ];
  }
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
  Future<void> _changeWarehouse(String? value)async{
    if(value==null||value==warehouse)return;
    if(selected.isNotEmpty){
      final yes=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('تغيير نطاق الجرد؟'),content:const Text('ستُترك مسودة الاختيارات الحالية دون اعتماد.'),
        actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('تغيير'))]));
      if(yes!=true||!mounted)return;
    }
    setState((){warehouse=value;_prepare();});
  }
  void _selectSuggestions(){
    setState((){
      for(final row in rows){
        if(row['reason']=='suggested')selected.putIfAbsent(key(row),()=>Map<String,dynamic>.from(row));
      }
      confirmed=false;error=null;
    });
  }
  Future<void> _edit(Map<String,dynamic> row)async{
    if(busy||row['reason']=='approved'||row['reason']=='currency')return;
    final current=selected[key(row)]??row;
    final q=TextEditingController(text:current['quantity']?.toString()??'');
    final v=TextEditingController(text:current['totalValue']?.toString()??'');
    String? validation;
    try{
      final result=await showDialog<Map<String,dynamic>>(context:context,builder:(ctx)=>StatefulBuilder(
        builder:(context,setDialog)=>AlertDialog(title:Text(row['name'].toString()),
          content:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
            Text(warehouseName(row['warehouseId'])),
            if(row['historicalQuantity']!=null)Text('صافي الحركة التاريخية (مرجع): ${row['historicalQuantity']}'),
            Text(reasons[row['reason']]??''),
            TextField(controller:q,keyboardType:const TextInputType.numberWithOptions(decimal:true),
              decoration:const InputDecoration(labelText:'الكمية الفعلية بالوحدة الأساسية')),
            TextField(controller:v,keyboardType:const TextInputType.numberWithOptions(decimal:true),
              decoration:const InputDecoration(labelText:'إجمالي التكلفة المعتمدة')),
            if(validation!=null)Text(validation!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
          ])),
          actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('إلغاء')),
            FilledButton(onPressed:(){
              try{
                final parsed=LegacyStockBatch.parse("${row['sourceItemId']}\t${q.text}\t${v.text}",widget.products,
                  row['warehouseId'] as String,<String,dynamic>{}).single;
                Navigator.pop(ctx,{...row,'quantity':parsed['quantity'],'totalValue':parsed['totalValue']});
              }on FormatException catch(e){setDialog(()=>validation=e.message);}
            },child:const Text('حفظ في المسودة'))])));
      if(result!=null&&mounted)setState((){selected[key(row)]=result;confirmed=false;});
    }finally{q.dispose();v.dispose();}
  }
  Future<void> _paste()async{
    if(warehouse==allWarehouses||busy)return;
    final input=TextEditingController();
    String? validation;
    try{
      final result=await showDialog<List<Map<String,dynamic>>>(context:context,builder:(ctx)=>StatefulBuilder(
        builder:(context,setDialog)=>AlertDialog(title:const Text('لصق جرد فعلي'),
          content:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
            const Text('كل سطر: معرف الصنف، الكمية، إجمالي التكلفة. استخدم Tab أو فاصلة.'),
            TextField(controller:input,minLines:5,maxLines:10,textDirection:TextDirection.ltr,
              decoration:const InputDecoration(hintText:'legacy-prod-1,10,3500')),
            if(validation!=null)Text(validation!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
          ])),actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('إلغاء')),
            FilledButton(onPressed:(){
              try{
                final parsed=LegacyStockBatch.parse(input.text,widget.products,warehouse,{});
                final available={for(final r in rows)key(r):r};
                final merged=<Map<String,dynamic>>[];
                for(final r in parsed){
                  final original=available[key(r)];
                  if(original==null||['approved','currency'].contains(original['reason']))throw const FormatException('صنف غير متاح للاعتماد');
                  merged.add({...original,...r});
                }
                Navigator.pop(ctx,merged);
              }on FormatException catch(e){setDialog(()=>validation=e.message);}
            },child:const Text('إضافة إلى المسودة'))])));
      if(result!=null&&mounted)setState((){
        for(final row in result){selected[key(row)]=row;}
        confirmed=false;
      });
    }finally{input.dispose();}
  }
  num get total=>selected.values.fold<num>(0,(sum,r)=>sum+(r['totalValue'] as num));
  Future<void> _submit()async{
    if(busy||!confirmed||selected.isEmpty||asset==null||offset==null||asset==offset||evidence.text.trim().isEmpty)return;
    final payload=[for(final r in selected.values)<String,dynamic>{
      'sourceItemId':r['sourceItemId'],'warehouseId':r['warehouseId'],'quantity':r['quantity'],'totalValue':r['totalValue'],
      'inventoryAccountId':asset,'offsetAccountId':offset,'entryDate':date,'evidence':evidence.text.trim(),'confirmed':true,
    }];
    final approved=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('اعتماد الجرد المحدد'),
      content:Text('عدد الأرصدة: ${payload.length}\nالقيمة: ${total.toStringAsFixed(2)} ريال\n'
        'تأكد من مطابقة الكميات والتكاليف وأن قيمتها غير مثبتة مسبقًا. تُعتمد الدفعة كاملة أو تُرفض كاملة.'),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('اعتماد'))]));
    if(approved!=true||!mounted)return;
    setState((){busy=true;error=null;});
    try{
      await LegacyStockOpening(LocalDatabase.instance).approveBatch('local-erp-workspace',payload,expectedSourceSha:widget.sourceSha);
      if(mounted){setState(()=>busy=false);Navigator.pop(context,true);}
    }on StateError catch(e){if(mounted)setState((){busy=false;error='رُفضت الدفعة: ${e.message}';});}
    catch(_){if(mounted)setState((){busy=false;error='لم يتم اعتماد الدفعة. راجع القيم والحسابات.';});}
  }

  @override
  Widget build(BuildContext context){
    final term=search.text.trim().toLowerCase();
    final visible=rows.where((r){
      final reason=r['reason'];
      if(filter=='suggested'&&reason!='suggested')return false;
      if(filter=='exceptions'&&['suggested','approved'].contains(reason))return false;
      if(filter=='selected'&&!selected.containsKey(key(r)))return false;
      if(filter=='approved'&&reason!='approved')return false;
      return '${r['name']} ${r['sku']} ${r['sourceItemId']} ${warehouseName(r['warehouseId'])}'.toLowerCase().contains(term);
    }).toList();
    final suggestions=rows.where((r)=>r['reason']=='suggested').length;
    final exceptions=rows.where((r)=>!['suggested','approved'].contains(r['reason'])).length;
    final saved=rows.where((r)=>r['reason']=='approved').length;
    return Directionality(textDirection:TextDirection.rtl,child:PopScope(canPop:!busy,child:Scaffold(
      appBar:AppBar(title:const Text('مطابقة الجرد الجماعي')),
      body:Column(children:[
        if(busy)const LinearProgressIndicator(),
        Padding(padding:const EdgeInsets.fromLTRB(12,8,12,4),child:Column(children:[
          choice('نطاق الجرد',[{'id':allWarehouses,'name':'جميع المخازن'},...widget.warehouses],warehouse,_changeWarehouse),
          Text('مقترحات: $suggestions • تحتاج مراجعة: $exceptions • معتمدة: $saved'),
          Wrap(spacing:8,children:[
            FilledButton.tonal(onPressed:busy||suggestions==0?null:_selectSuggestions,child:const Text('تحديد جميع المقترحات')),
            TextButton(onPressed:busy||selected.isEmpty?null:()=>setState((){selected.clear();confirmed=false;}),child:const Text('إلغاء التحديد')),
            if(warehouse!=allWarehouses)TextButton(onPressed:busy?null:_paste,child:const Text('لصق جرد فعلي')),
          ]),
          TextField(controller:search,enabled:!busy,onChanged:(_)=>setState((){}),
            decoration:const InputDecoration(prefixIcon:Icon(Icons.search),hintText:'اسم الصنف أو رقمه أو المخزن')),
          DropdownButton<String>(isExpanded:true,value:filter,
            items:const [
              DropdownMenuItem(value:'all',child:Text('كل الأرصدة')),
              DropdownMenuItem(value:'suggested',child:Text('المقترحات القابلة للاعتماد')),
              DropdownMenuItem(value:'exceptions',child:Text('الحالات التي تحتاج مراجعة')),
              DropdownMenuItem(value:'selected',child:Text('المحدد للاعتماد')),
              DropdownMenuItem(value:'approved',child:Text('المعتمد سابقًا')),
            ],onChanged:busy?null:(v){if(v!=null)setState(()=>filter=v);}),
        ])),
        Expanded(child:ListView.builder(itemCount:visible.length,itemBuilder:(ctx,index){
          final row=visible[index],draft=selected[key(row)],value=draft??row;
          final reason=row['reason'];
          final canEdit=reason!='approved'&&reason!='currency';
          return ListTile(dense:true,
            title:Text(row['name'].toString(),maxLines:2,overflow:TextOverflow.ellipsis),
            subtitle:Text("${warehouseName(row['warehouseId'])} • ${reasons[reason]??''}\n"
              "الكمية: ${value['quantity']??'غير معتمدة'} ${row['unit']??''} • التكلفة: ${value['totalValue']??'—'}"),
            leading:Checkbox(value:draft!=null||reason=='approved',onChanged:busy||!canEdit?null:(checked){
              if(checked==true){if(reason=='suggested'){setState((){selected[key(row)]=Map<String,dynamic>.from(row);confirmed=false;});}else{_edit(row);}}
              else{setState((){selected.remove(key(row));confirmed=false;});}
            }),
            trailing:IconButton(icon:const Icon(Icons.edit_outlined),tooltip:'تعديل الكمية والتكلفة',onPressed:busy||!canEdit?null:()=>_edit(row)));
        })),
        SafeArea(top:false,child:Padding(padding:const EdgeInsets.all(10),child:Column(children:[
          Text('المحدد: ${selected.length} • القيمة: ${total.toStringAsFixed(2)} ريال'),
          if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
          FilledButton(onPressed:busy||selected.isEmpty?null:()async{
            setState(()=>confirmed=false);
            final proceed=await showModalBottomSheet<bool>(context:context,isScrollControlled:true,builder:(ctx)=>StatefulBuilder(
              builder:(context,setSheet)=>Directionality(textDirection:TextDirection.rtl,child:SafeArea(child:Padding(
                padding:EdgeInsets.fromLTRB(16,16,16,16+MediaQuery.of(context).viewInsets.bottom),
                child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
                  const Text('حسابات التسوية وتأكيد المطابقة'),
                  choice('حساب أصل المخزون',widget.accounts,asset,(v){setState((){asset=v;confirmed=false;});setSheet((){});}),
                  const SizedBox(height:8),
                  choice('الحساب المقابل',widget.accounts,offset,(v){setState((){offset=v;confirmed=false;});setSheet((){});}),
                  TextButton(onPressed:()async{await _date();setSheet((){});},child:Text('تاريخ الاعتماد: $date')),
                  TextField(controller:evidence,maxLength:300,onChanged:(_){setState(()=>confirmed=false);setSheet((){});},
                    decoration:const InputDecoration(labelText:'مرجع محضر الجرد والتقييم')),
                  CheckboxListTile(value:confirmed,onChanged:(v){setState(()=>confirmed=v??false);setSheet((){});},
                    title:const Text('طابقت الكميات والتكاليف فعليًا ولن أكرر قيمة مثبتة سابقًا.')),
                  FilledButton(onPressed:!confirmed||asset==null||offset==null||asset==offset||evidence.text.trim().isEmpty?null:()=>Navigator.pop(ctx,true),
                    child:const Text('متابعة التأكيد النهائي')),
                ])))))));
            if(mounted&&proceed==true&&confirmed)await _submit();
          },child:const Text('مراجعة واعتماد الأرصدة المحددة')),
        ]))),
      ]),
    )));
  }
}
