import 'package:flutter/material.dart';
import '../services/local_database.dart';
import '../services/legacy_history_archive.dart';

/// Historical source records remain available without replaying the
/// historical movements as new accounting or stock transactions.
class LegacyHistoryScreen extends StatefulWidget {
  const LegacyHistoryScreen({super.key});
  @override
  State<LegacyHistoryScreen> createState()=>_LegacyHistoryScreenState();
}

class _LegacyHistoryScreenState extends State<LegacyHistoryScreen>{
  static const categories=<String,String>{
    'source_store_trans':'التحويلات المخزنية',
    'source_offers':'عروض الأسعار',
    'source_bin':'المستندات المحذوفة المؤرشفة',
    'source_alerts':'التنبيهات',
  };
  static const detailsByCategory=<String,List<String>>{
    'source_store_trans':['source_trans_details'],
    'source_offers':['source_offer_bill_details','source_offer_sbill_details'],
    'source_bin':['source_bin_bill_details','source_bin_bill_details2'],
  };
  static const labels=<String,String>{
    'id':'المعرف الأصلي','bill_id':'رقم المستند الأصلي','per_id':'معرف الحساب',
    'acc_id':'معرف الحساب','prod_id':'معرف الصنف','store_id1':'معرف المخزن المصدر',
    'store_id2':'معرف المخزن الوجهة','store_id':'معرف المخزن',
    'name':'الاسم','pername':'اسم الحساب','curname':'العملة','boxname':'الصندوق',
    'details':'التفاصيل','det':'التفاصيل','date':'التاريخ','ndate':'التاريخ الأصلي',
    'type':'النوع الأصلي','bill_type':'نوع المستند الأصلي','dain':'الطرف Dain الأصلي',
    'madin':'الطرف Madin الأصلي','amount':'الكمية','price':'السعر','total':'الإجمالي',
    'unit':'الوحدة','unitnum':'رقم الوحدة','discount':'الخصم','bonus':'الكمية المجانية',
    'exdate':'تاريخ الصلاحية',
  };
  final search=TextEditingController();
  Map<String,List<Map<String,dynamic>>>? data;
  Map<String,Map<String,List<Map<String,dynamic>>>> children={};
  String category='source_store_trans';
  String? error;
  bool busy=true;

  @override
  void initState(){super.initState();_load();}
  @override
  void dispose(){search.dispose();super.dispose();}
  String s(Object? v)=>v?.toString()??'';
  Future<void> _load()async{
    setState((){busy=true;error=null;});
    try{
      final loaded=await LegacyHistoryArchive(LocalDatabase.instance).load();
      final indexed=<String,Map<String,List<Map<String,dynamic>>>>{};
      for(final group in detailsByCategory.entries){
        final parent=indexed.putIfAbsent(group.key,()=> <String,List<Map<String,dynamic>>>{});
        for(final table in group.value){
          for(final row in loaded[table]??<Map<String,dynamic>>[]){
            parent.putIfAbsent(s(row['bill_id']),()=> <Map<String,dynamic>>[]).add(row);
          }
        }
      }
      if(mounted)setState((){data=loaded;children=indexed;busy=false;});
    }catch(_){
      if(mounted)setState((){error='تعذر قراءة الجداول التاريخية من النسخة الأصلية المحفوظة.';busy=false;});
    }
  }

  String title(Map<String,dynamic> row){
    if(category=='source_store_trans')return 'تحويل #${row['id']} — مخزن ${row['store_id1']} إلى ${row['store_id2']}';
    final name=s(row['name']).isNotEmpty?s(row['name']):s(row['pername']);
    return name.isNotEmpty?'#${row['id']} — $name':'#${row['id']}';
  }

  Widget fields(Map<String,dynamic> row){
    return Padding(padding:const EdgeInsets.all(12),child:Column(
      crossAxisAlignment:CrossAxisAlignment.start,
      children:[for(final e in row.entries)
        if(e.value!=null&&s(e.value).isNotEmpty)
          Padding(padding:const EdgeInsets.only(bottom:4),
            child:SelectableText('${labels[e.key]??e.key}: ${s(e.value)}')),
      ],
    ));
  }

  Future<void> _show(Map<String,dynamic> row)async{
    final lines=children[category]?[s(row['id'])]??<Map<String,dynamic>>[];
    await Navigator.of(context).push(MaterialPageRoute<void>(builder:(ctx)=>Directionality(
      textDirection:TextDirection.rtl,
      child:Scaffold(appBar:AppBar(title:Text(title(row))),body:ListView(
        children:[fields(row),const Divider(),Padding(padding:const EdgeInsets.all(12),
          child:Text('البنود التاريخية: ${lines.length}')),
          for(final line in lines)ExpansionTile(
            title:Text('بند #${line['id']} — كمية ${line['amount']??'—'}'),
            children:[fields(line)]),
        ],
      )),
    )));
  }

  @override
  Widget build(BuildContext context){
    final all=data?[category]??<Map<String,dynamic>>[];
    final term=search.text.trim().toLowerCase();
    final visible=all.where((r)=>term.isEmpty||r.values.any((v)=>s(v).toLowerCase().contains(term))).toList();
    return Directionality(textDirection:TextDirection.rtl,child:Scaffold(
      appBar:AppBar(title:const Text('السجلات التاريخية'),actions:[
        IconButton(onPressed:busy?null:_load,tooltip:'إعادة القراءة',icon:const Icon(Icons.refresh))]),
      body:Column(children:[
        const Padding(padding:EdgeInsets.all(12),child:Text('السجل الأصلي محفوظ كما هو. العرض للمراجعة ولا يعيد ترحيل العمليات إلى الحسابات أو المخزون.')),
        if(busy)const LinearProgressIndicator(),
        Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:DropdownButtonFormField<String>(
          isExpanded:true,value:category,decoration:const InputDecoration(labelText:'نوع السجل'),
          items:[for(final e in categories.entries)DropdownMenuItem(value:e.key,
            child:Text('${e.value} (${data?[e.key]?.length??0})'))],
          onChanged:busy?null:(v){if(v!=null)setState((){category=v;search.clear();});})),
        Padding(padding:const EdgeInsets.all(12),child:TextField(controller:search,enabled:!busy,
          decoration:const InputDecoration(prefixIcon:Icon(Icons.search),labelText:'البحث في السجلات الأصلية'),
          onChanged:(_)=>setState((){}))),
        if(error!=null)Padding(padding:const EdgeInsets.all(12),child:Text(error!)),
        if(!busy&&error==null&&visible.isEmpty)const Padding(padding:EdgeInsets.all(12),child:Text('لا توجد سجلات مطابقة.')),
        Expanded(child:ListView.builder(itemCount:visible.length,itemBuilder:(ctx,i){
          final row=visible[i],count=children[category]?[s(row['id'])]?.length??0;
          final d=s(row['date']).isNotEmpty?s(row['date']):s(row['ndate']);
          return ListTile(title:Text(title(row)),subtitle:Text('$d • البنود: $count'),
            trailing:const Icon(Icons.chevron_left),onTap:()=>_show(row));
        })),
      ]),
    ));
  }
}
