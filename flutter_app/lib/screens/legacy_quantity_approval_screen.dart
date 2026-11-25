import 'package:flutter/material.dart';
import '../services/legacy_quantity_approval.dart';
import '../services/local_database.dart';

class LegacyQuantityApprovalScreen extends StatefulWidget {
  const LegacyQuantityApprovalScreen({super.key,required this.warehouses,this.initialWarehouseId,this.service});
  final List<Map<String,dynamic>> warehouses;
  final String? initialWarehouseId;
  final LegacyQuantityApproval? service;
  @override
  State<LegacyQuantityApprovalScreen> createState()=>_LegacyQuantityApprovalScreenState();
}

class _LegacyQuantityApprovalScreenState extends State<LegacyQuantityApprovalScreen>{
  late final service=widget.service??LegacyQuantityApproval(LocalDatabase.instance);
  String? warehouse,error;
  String search='';
  Map<String,dynamic>? review;
  final selected=<String>{};
  bool busy=false,changed=false,confirmed=false;
  @override
  void initState(){
    super.initState();
    warehouse=widget.warehouses.any((w)=>w['id']==widget.initialWarehouseId)?widget.initialWarehouseId:null;
    if(warehouse!=null)_load();
  }
  Future<void> _load()async{
    setState((){busy=true;review=null;selected.clear();confirmed=false;error=null;});
    try{
      final data=await service.preview(warehouse!);
      if(mounted)setState(()=>review=data);
    }catch(_){if(mounted)setState(()=>error='تعذر تحميل الكميات الحالية. أعد المحاولة.');}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> _approve()async{
    if(busy||!confirmed||selected.isEmpty||review==null)return;
    setState(()=>busy=true);
    final yes=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('تأكيد الكميات الحالية فقط'),
      content:Text('المخزن: ${review!['warehouseName']}\nعدد الأصناف: ${selected.length}\n'
        'سأعتمد الكميات المعروضة كما هي رصيدًا حاليًا. لن تُضاف الحركات القديمة ولن يُنشأ قيد مالي. تبقى التكلفة غير معتمدة حتى مراجعتها منفصلًا.'),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('تأكيد اعتماد الكميات'))]));
    if(!mounted)return;
    if(yes!=true){setState(()=>busy=false);return;}
    setState((){busy=true;error=null;});
    try{
      final count=await service.approve(warehouse!,selected.toList(),sourceSha:review!['sourceSha'] as String,
        reviewHash:review!['reviewHash'] as String,confirmed:true);
      if(!mounted)return;
      changed=true;await _load();
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تم اعتماد كمية $count صنف. التكلفة ما زالت غير معتمدة.')));
    }on StateError catch(e){if(mounted)setState(()=>error=e.message.toString());}
    catch(_){if(mounted)setState(()=>error='تعذر تأكيد الاعتماد؛ أعد تحميل القائمة للتحقق قبل إعادة المحاولة.');}
    finally{if(mounted)setState((){busy=false;confirmed=false;});}
  }
  @override
  Widget build(BuildContext context){
    final rows=review==null?<Map<String,dynamic>>[]:(review!['rows'] as List).cast<Map<String,dynamic>>();
    final filtered=rows.where((r)=>'${r['name']} ${r['sourceItemId']}'.toLowerCase().contains(search.trim().toLowerCase())).toList();
    return Directionality(textDirection:TextDirection.rtl,child:PopScope(canPop:!busy,child:Scaffold(
      appBar:AppBar(title:const Text('اعتماد الكميات الحالية'),leading:IconButton(tooltip:'رجوع',icon:const Icon(Icons.arrow_back),onPressed:busy?null:()=>Navigator.pop(context,changed))),
      body:Column(children:[
        Padding(padding:const EdgeInsets.all(12),child:Column(children:[
          const Text('راجع رصيد كل صنف في المخزن دون تصفية تاريخ. الاعتماد يثبت الكمية فقط؛ لا يعتمد التكلفة ولا يرحّل الحركات القديمة.'),
          DropdownButtonFormField<String>(value:warehouse,isExpanded:true,decoration:const InputDecoration(labelText:'المخزن'),
            items:[for(final w in widget.warehouses)DropdownMenuItem(value:w['id'] as String,child:Text(w['name'].toString()))],
            onChanged:busy?null:(id){setState(()=>warehouse=id);_load();}),
          TextField(decoration:const InputDecoration(labelText:'بحث الأصناف'),enabled:!busy,onChanged:(v)=>setState(()=>search=v)),
          if(review!=null)Text('تاريخ تثبيت الكمية: ${review!['entryDate']} • المحدد: ${selected.length}'),
          Wrap(spacing:8,children:[TextButton(onPressed:busy||review==null?null:()=>setState((){
            selected.addAll(filtered.where((r)=>r['reason']==null).map((r)=>r['sourceItemId'] as String));confirmed=false;
          }),child:const Text('تحديد النتائج القابلة للاعتماد')),
            TextButton(onPressed:busy?null:()=>setState((){selected.clear();confirmed=false;}),child:const Text('مسح التحديد'))]),
          if(busy)const LinearProgressIndicator(),
          if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
        ])),
        if(review!=null&&rows.isEmpty&&!busy)const Text('لا توجد كميات غير معتمدة قابلة للمراجعة في هذا المخزن.'),
        Expanded(child:ListView.builder(itemCount:filtered.length,itemBuilder:(context,i){
          final r=filtered[i],id=r['sourceItemId'] as String;
          return CheckboxListTile(value:selected.contains(id),title:Text('${r['name']} — ${r['quantity']} ${r['unit']}'),
            subtitle:Text(r['reason']?.toString()??(r['transferIncomplete']==true?'تحويل غير مكتمل: أكد الرصيد الحالي بعد مراجعته؛ التكلفة غير معتمدة.':'اعتماد كمية فقط — التكلفة غير معتمدة')),
            onChanged:busy||r['reason']!=null?null:(v)=>setState((){v==true?selected.add(id):selected.remove(id);confirmed=false;}));
        })),
        SafeArea(top:false,child:Padding(padding:const EdgeInsets.all(12),child:Column(children:[
          CheckboxListTile(value:confirmed,title:const Text('راجعت الكميات المحددة وهي الرصيد الحالي الصحيح، وليس اعتمادًا للتكلفة.'),
            onChanged:busy||selected.isEmpty?null:(v)=>setState(()=>confirmed=v??false)),
          Row(children:[Expanded(child:FilledButton(onPressed:busy||!confirmed?null:_approve,child:const Text('اعتماد الكميات فقط'))),
            IconButton(tooltip:'إعادة تحميل الكميات',onPressed:busy||warehouse==null?null:_load,icon:const Icon(Icons.refresh))]),
        ]))),
      ]),
    )));
  }
}
