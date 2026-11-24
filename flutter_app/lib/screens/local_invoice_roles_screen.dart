import 'package:flutter/material.dart';
import '../services/local_database.dart';
import '../services/local_invoice_roles.dart';

class LocalInvoiceRolesScreen extends StatefulWidget {
  const LocalInvoiceRolesScreen({super.key});
  @override
  State<LocalInvoiceRolesScreen> createState()=>_LocalInvoiceRolesScreenState();
}

class _LocalInvoiceRolesScreenState extends State<LocalInvoiceRolesScreen>{
  final service=LocalInvoiceRoles(LocalDatabase.instance);
  static const labels={'revenue':'إيراد المبيعات','inventory':'أصل المخزون','cost':'تكلفة البضاعة المباعة',
    'expense':'مصروف المشتريات الحرة','outputTax':'ضريبة المبيعات المستحقة','inputTax':'ضريبة المشتريات القابلة للاسترداد'};
  List<Map<String,dynamic>> accounts=[];
  Map<String,dynamic> all={};
  Map<String,String> selected={};
  String currency='sar';
  bool busy=true;
  String? message;

  @override
  void initState(){super.initState();_load();}
  Future<void> _load()async{
    try{
      final data=await service.load();
      if(!mounted)return;
      setState((){
        accounts=(data['accounts'] as List).map((r)=>Map<String,dynamic>.from(r as Map)).toList();
        all=Map<String,dynamic>.from(data['roles'] as Map);
        _selectCurrency(currency);busy=false;
      });
    }catch(_){if(mounted)setState((){busy=false;message='تعذر تحميل إعدادات الترحيل. أغلق وضع المراجعة أولًا.';});}
  }
  void _selectCurrency(String value){
    currency=value;message=null;
    final stored=all[currency],ids=accounts.where((a)=>a['currency']==currency).map((a)=>a['id']).toSet();
    selected={};
    if(stored is Map){
      for(final key in LocalInvoiceRoles.keys){final id=stored[key];if(id is String&&ids.contains(id))selected[key]=id;}
    }
  }
  Future<void> _save()async{
    setState(()=>busy=true);
    try{
      await service.save(currency,selected);
      if(!mounted)return;
      setState((){all[currency]=Map<String,String>.from(selected);busy=false;message='تم حفظ حسابات الترحيل لهذه العملة.';});
    }catch(_){if(mounted)setState((){busy=false;message='لم تُحفظ الإعدادات؛ تحقق من الحسابات المختارة.';});}
  }
  @override
  Widget build(BuildContext context){
    final list=accounts.where((a)=>a['currency']==currency).toList();
    final roles=currency=='sar'?LocalInvoiceRoles.keys:['revenue','expense'];
    return Directionality(textDirection:TextDirection.rtl,child:Scaffold(
      appBar:AppBar(title:const Text('حسابات الترحيل التلقائي')),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        const Text('اضبط الحسابات مرة واحدة من دليل الحسابات الموجود. لا ينشئ النظام حسابات أو يغير تصنيفها. تُستخدم إعدادات الجرد المعتمد لحساب أصل المخزون عند توفرها.'),
        if(busy)const LinearProgressIndicator(),
        const SizedBox(height:12),
        DropdownButtonFormField<String>(value:currency,isExpanded:true,
          decoration:const InputDecoration(labelText:'العملة'),
          items:[for(final e in LocalInvoiceRoles.currencyNames.entries)DropdownMenuItem(value:e.key,child:Text(e.value))],
          onChanged:busy?null:(v){if(v!=null)setState(()=>_selectCurrency(v));}),
        const SizedBox(height:12),
        for(final key in roles)...[
          DropdownButtonFormField<String>(value:selected[key]??'',isExpanded:true,
            decoration:InputDecoration(labelText:labels[key],border:const OutlineInputBorder()),
            items:[const DropdownMenuItem(value:'',child:Text('غير محدد')),
              for(final a in list)DropdownMenuItem(value:a['id'] as String,child:Text(a['name'].toString(),overflow:TextOverflow.ellipsis))],
            onChanged:busy?null:(v)=>setState((){selected[key]=v??'';message=null;})),
          const SizedBox(height:12),
        ],
        if(list.isEmpty)const Text('لا توجد حسابات مناسبة لهذه العملة. أضف الحسابات من دليل الحسابات أولًا.'),
        const Text('اترك ما لا تستخدمه غير محدد. الضريبة اختيارية.'),
        FilledButton(onPressed:busy||list.isEmpty?null:_save,child:const Text('حفظ الإعدادات')),
        if(message!=null)Padding(padding:const EdgeInsets.all(8),child:Text(message!)),
      ]),
    ));
  }
}
