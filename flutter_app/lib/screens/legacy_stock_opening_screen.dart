import 'package:flutter/material.dart';
import '../services/legacy_stock_opening.dart';
import '../services/local_database.dart';

class LegacyStockOpeningScreen extends StatefulWidget {
  const LegacyStockOpeningScreen({super.key});
  @override
  State<LegacyStockOpeningScreen> createState()=>_LegacyStockOpeningScreenState();
}

class _LegacyStockOpeningScreenState extends State<LegacyStockOpeningScreen>{
  final service=LegacyStockOpening(LocalDatabase.instance);
  final search=TextEditingController(),quantity=TextEditingController(),value=TextEditingController(),evidence=TextEditingController();
  List<Map<String,dynamic>> products=[],warehouses=[],accounts=[],openings=[];
  String? product,warehouse,asset,offset;
  String date=DateTime.now().toIso8601String().substring(0,10);
  bool busy=true,confirmed=false,changed=false;
  String? error;

  @override
  void initState(){super.initState();_load();}
  @override
  void dispose(){search.dispose();quantity.dispose();value.dispose();evidence.dispose();super.dispose();}
  List<Map<String,dynamic>> rows(Object? data)=>(data as List).map((e)=>Map<String,dynamic>.from(e as Map)).toList();
  Future<void> _load() async {
    try{
      final data=await service.load();
      if(!mounted)return;
      setState((){
        products=rows(data['products']);warehouses=rows(data['warehouses']);accounts=rows(data['accounts']);openings=rows(data['openings']);
        if(!warehouses.any((w)=>w['id']==warehouse))warehouse=null;
        if(!accounts.any((a)=>a['id']==asset))asset=null;
        if(!accounts.any((a)=>a['id']==offset))offset=null;
        busy=false;error=null;
      });
    }catch(_){if(mounted)setState((){busy=false;error='تعذر تحميل بيانات الجرد.';});}
  }
  Map<String,dynamic>? get selected {
    for(final p in products){if(p['id']==product)return p;}
    return null;
  }
  Map<String,dynamic>? get approved {
    for(final o in openings){if(o['source_item_id']==product&&o['warehouse_id']==warehouse)return o;}
    return null;
  }
  String normalize(String input){
    const arabic='٠١٢٣٤٥٦٧٨٩',persian='۰۱۲۳۴۵۶۷۸۹';
    var out=input.trim().replaceAll('٫','.').replaceAll('٬','');
    for(var i=0;i<10;i++){out=out.replaceAll(arabic[i],i.toString()).replaceAll(persian[i],i.toString());}
    return out;
  }
  void clearCount(){quantity.clear();value.clear();evidence.clear();confirmed=false;error=null;}
  Future<void> _chooseDate() async {
    final picked=await showDatePicker(context:context,initialDate:DateTime.parse(date),firstDate:DateTime(2000),lastDate:DateTime.now());
    if(picked!=null&&mounted)setState((){date=picked.toIso8601String().substring(0,10);confirmed=false;});
  }
  Future<void> _approve() async {
    if(busy||!confirmed||product==null||warehouse==null||asset==null||offset==null||approved!=null)return;
    final q=num.tryParse(normalize(quantity.text)),v=num.tryParse(normalize(value.text));
    if(q==null||v==null||!q.isFinite||!v.isFinite||q<0||q!=q.round()||v<0||asset==offset||
        (q==0&&v!=0)||(q>0&&v<=0)||evidence.text.trim().isEmpty){
      setState(()=>error='أدخل كمية صحيحة بالوحدة الأساسية، وقيمة إجمالية صحيحة، ومرجع الجرد وحسابين مختلفين.');return;
    }
    final name=selected?['name']??'';
    final yes=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('اعتماد نهائي للجرد'),
      content:Text('الصنف: $name\nالكمية: $q\nإجمالي التكلفة: $v ريال\n'
        'سيُفتح رصيد هذا المخزن مرة واحدة. لا تستخدم الاعتماد إذا كانت القيمة مثبتة مسبقًا في الدفاتر؛ يجب تسويتها محاسبيًا أولًا.'),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('اعتماد'))]));
    if(yes!=true||!mounted)return;
    setState((){busy=true;error=null;});
    try{
      await service.approve('local-erp-workspace',{'sourceItemId':product,'warehouseId':warehouse,'inventoryAccountId':asset,'offsetAccountId':offset,
        'quantity':q,'totalValue':v,'entryDate':date,'evidence':evidence.text.trim(),'confirmed':true});
      if(!mounted)return;
      changed=true;clearCount();await _load();
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('تم اعتماد الجرد لهذا الصنف والمخزن.')));
    }on ArgumentError{
      if(mounted)setState((){busy=false;error='القيمة أو الكمية أو الحسابات غير صالحة.';});
    }on StateError catch(e){
      if(mounted)setState((){busy=false;error='لم يُعتمد الجرد: ${e.message}';});
    }catch(_){
      if(mounted)setState((){busy=false;error='تعذر تأكيد الاعتماد. حدّث القائمة قبل المحاولة مجددًا.';});
    }
  }
  Widget choice(String label,List<Map<String,dynamic>> options,String? selected,ValueChanged<String?> onChanged){
    return DropdownButtonFormField<String>(isExpanded:true,value:selected,decoration:InputDecoration(labelText:label,border:const OutlineInputBorder()),
      items:[for(final r in options)DropdownMenuItem(value:r['id'] as String,child:Text(r['name'].toString(),overflow:TextOverflow.ellipsis))],
      onChanged:busy?null:onChanged);
  }
  @override
  Widget build(BuildContext context){
    final term=search.text.trim().toLowerCase();
    final filtered=products.where((p)=>'${p['name']} ${p['sku']} ${p['id']}'.toLowerCase().contains(term)).take(60).toList();
    final p=selected,o=approved;
    final q=num.tryParse(normalize(quantity.text)),v=num.tryParse(normalize(value.text));
    final avg=q!=null&&q.isFinite&&q>0&&v!=null&&v.isFinite?(v/q).toStringAsFixed(4):null;
    return Directionality(textDirection:TextDirection.rtl,child:PopScope(canPop:!busy,child:Scaffold(
      appBar:AppBar(title:const Text('اعتماد جرد المخازن'),actions:[IconButton(tooltip:'تم',onPressed:busy?null:()=>Navigator.pop(context,changed),icon:const Icon(Icons.check))]),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        Text('اعتمادات المخازن المسجلة: ${openings.length} • الأصناف الأصلية: ${products.length}'),
        const Text('أدخل الكمية الفعلية والتكلفة الإجمالية بعد الجرد. كل صنف ومخزن يُعتمد مستقلًا. التاريخ السابق محفوظ، وليس جردًا مؤكدًا.'),
        if(busy)const LinearProgressIndicator(),
        const SizedBox(height:12),
        TextField(controller:search,enabled:!busy,onChanged:(_)=>setState((){}),decoration:const InputDecoration(labelText:'بحث باسم الصنف أو الباركود أو الرقم',prefixIcon:Icon(Icons.search),border:OutlineInputBorder())),
        if(p==null||term.isNotEmpty)SizedBox(height:190,child:ListView.builder(itemCount:filtered.length,itemBuilder:(ctx,index){
          final item=filtered[index];
          return ListTile(dense:true,selected:item['id']==product,title:Text(item['name'].toString()),subtitle:Text(item['id'].toString()),
            onTap:busy?null:()=>setState((){product=item['id'] as String;search.clear();clearCount();}));
        })),
        if(p!=null)...[
          ListTile(contentPadding:EdgeInsets.zero,title:Text(p['name'].toString()),subtitle:Text('الوحدة الأساسية: ${p['unit']} • ${p['id']}'),
            trailing:TextButton(onPressed:busy?null:()=>setState((){product=null;clearCount();}),child:const Text('تغيير'))),
          choice('المخزن',warehouses,warehouse,(id)=>setState((){warehouse=id;clearCount();})),
          const SizedBox(height:12),
          if(o!=null)Card(child:Padding(padding:const EdgeInsets.all(12),child:Text('معتمد بتاريخ ${o['entry_date']}\nكمية الافتتاح: ${o['quantity']}\nقيمة الافتتاح: ${(o['value_minor'] as num)/100} ريال\nلا يمكن تكرار الافتتاح. هذه ليست الكمية الحالية.'))),
          if(o==null&&warehouse!=null)...[
            if(p['legacyInvoiceQtyByWarehouse'] is Map&&(p['legacyInvoiceQtyByWarehouse'] as Map).containsKey(warehouse))
              Text('صافي الفواتير التاريخية لهذا المخزن: ${(p['legacyInvoiceQtyByWarehouse'] as Map)[warehouse]} (ليس جردًا معتمدًا؛ لا يشمل التحويلات).'),
            if(p['avgCost'] is num)Text('سعر التكلفة المسجل تاريخيًا: ${p['avgCost']} ريال (مرجع فقط).'),
            TextField(controller:quantity,enabled:!busy,keyboardType:TextInputType.number,onChanged:(_)=>setState(()=>confirmed=false),decoration:const InputDecoration(labelText:'الكمية الفعلية بالوحدة الأساسية',border:OutlineInputBorder())),
            const SizedBox(height:12),
            TextField(controller:value,enabled:!busy,keyboardType:const TextInputType.numberWithOptions(decimal:true),onChanged:(_)=>setState(()=>confirmed=false),decoration:const InputDecoration(labelText:'إجمالي تكلفة الكمية بالريال',border:OutlineInputBorder())),
            if(avg!=null)Text('متوسط التكلفة: $avg ريال'),
            const SizedBox(height:12),
            choice('حساب أصل المخزون',accounts,asset,(id)=>setState((){asset=id;confirmed=false;})),
            const SizedBox(height:12),
            choice('الحساب المقابل للتسوية الافتتاحية',accounts,offset,(id)=>setState((){offset=id;confirmed=false;})),
            if(accounts.length<2)const Text('أنشئ الحسابات المناسبة أولًا في دليل الحسابات.'),
            TextButton.icon(onPressed:busy?null:_chooseDate,icon:const Icon(Icons.calendar_today),label:Text('تاريخ الاعتماد: $date')),
            TextField(controller:evidence,enabled:!busy,maxLength:300,onChanged:(_)=>setState(()=>confirmed=false),decoration:const InputDecoration(labelText:'مرجع محضر الجرد والتقييم',border:OutlineInputBorder())),
            CheckboxListTile(value:confirmed,onChanged:busy?null:(v)=>setState(()=>confirmed=v??false),title:const Text('تحققت من الجرد والتكلفة والحسابات، ولن أكرر قيمة مثبتة سابقًا.')),
            FilledButton.icon(onPressed:busy||!confirmed||asset==null||offset==null?null:_approve,icon:const Icon(Icons.fact_check),label:const Text('اعتماد المخزون')),
          ],
        ],
        if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
        if(products.isEmpty&&!busy)OutlinedButton(onPressed:(){setState(()=>busy=true);_load();},child:const Text('إعادة التحميل')),
      ]),
    )));
  }
}
