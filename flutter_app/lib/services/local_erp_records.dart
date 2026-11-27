import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';

/// Non-posting administrative records only. Never accepts SQL, a workspace
/// replacement, stock quantities, ledger legs, or a posted-document marker.
class LocalErpRecords {
  LocalErpRecords(this.local);
  final LocalDatabase local;
  static const fields = <String,List<String>>{
    'employees':['id','name','roleTitle','department','basicSalary','allowances','deductions','status','hireDate','leaveBalanceDays','attendanceToday','accountId'],
    'leaveRequests':['id','employeeId','employeeName','leaveType','startDate','days','status','note'],
    'boms':['id','name','finishedItemId','finishedItemName','finishedUnit','components'],
    'deals':['id','title','clientAccountId','clientName','value','currency','stage','probability','expectedCloseDate','assignedTo'],
    'purchaseOrders':['id','poNumber','supplierAccountId','supplierName','warehouseId','warehouseName','currency','orderDate','expectedDate','status','lines','notes'],
    'productionOrders':['id','orderNumber','bomId','bomName','finishedItemId','finishedItemName','quantityToProduce','warehouseId','status','createdDate','costCenterId'],
    'costCenters':['id','code','name','managerName','budget','extraPostedSpend','linkedCategories','status'],
    'vatConfig':['id','jurisdiction','ratePercent','basis'],
  };
  static Future<Map<String,dynamic>> read(DatabaseExecutor t)async{
    final data=<String,dynamic>{for(final c in ['employees','leaveRequests','deals','purchaseOrders','boms','productionOrders','costCenters'])c:<dynamic>[]};
    for(final row in await t.query('erp_state',where:'stateKey LIKE ?',whereArgs:['erp-record:%'],orderBy:'stateKey')){
      final parts=(row['stateKey'] as String).split(':');
      if(parts.length!=3||!fields.containsKey(parts[1]))continue;
      final record=jsonDecode(row['payloadJson'] as String) as Map<String,dynamic>;
      if(record['_deleted']==true)continue;
      if(parts[1]=='vatConfig'){data['vatConfig']=record;}else{(data[parts[1]] as List).add(record);}
    }
    return data;
  }
  static void validate(String c,Map<String,dynamic> r){
    final allowed=fields[c];
    if(allowed==null||r.keys.any((k)=>!allowed.contains(k))||r['id'] is! String||!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(r['id']))throw ArgumentError('حقول السجل الإداري غير صالحة');
    for(final e in r.entries){
      if(e.value is String&&(e.value as String).length>2000)throw ArgumentError('النص أطول من المسموح');
      if(e.value is num&&(!(e.value as num).isFinite||(e.value as num)<0||(e.value as num)>1000000000))throw ArgumentError('قيمة رقمية غير صالحة');
      if(e.value is! String&&e.value is! num&&e.key!='lines'&&e.key!='components'&&e.key!='linkedCategories')throw ArgumentError('نوع الحقل غير صالح');
    }
    void text(String key){if(r[key] is! String||(r[key] as String).trim().isEmpty)throw ArgumentError('الحقل $key مطلوب');}
    void number(String key){if(r[key] is! num)throw ArgumentError('الحقل $key يجب أن يكون رقمًا');}
    void choice(String key,List<String> values){if(!values.contains(r[key]))throw ArgumentError('قيمة $key غير مدعومة');}
    const dates={'employees':['hireDate'],'leaveRequests':['startDate'],'deals':['expectedCloseDate'],'purchaseOrders':['orderDate','expectedDate'],'productionOrders':['createdDate']};
    for(final k in dates[c]??<String>[]){final v=r[k];final parsed=v is String?DateTime.tryParse(v):null;if(v is! String||!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v)||parsed==null||parsed.toIso8601String().substring(0,10)!=v)throw ArgumentError('أدخل تاريخًا صالحًا');}
    if(c=='employees'){
      for(final k in ['name','roleTitle','department','hireDate'])text(k);
      for(final k in ['basicSalary','allowances','deductions','leaveBalanceDays'])number(k);
      choice('status',['active','on-leave','inactive']);choice('attendanceToday',['present','leave','absent']);
    }else if(c=='leaveRequests'){
      for(final k in ['employeeId','employeeName','startDate'])text(k);
      number('days');if(r['days']<0.5||r['days']>366)throw ArgumentError('أيام الإجازة غير صالحة');
      choice('leaveType',['سنوية','مرضية','اضطرارية']);choice('status',['pending','approved','rejected']);
    }else if(c=='boms'){
      for(final k in ['name','finishedItemId','finishedItemName','finishedUnit'])text(k);
      final lines=r['components'];if(lines is! List||lines.isEmpty||lines.length>100)throw ArgumentError('أضف من مكوّن واحد إلى 100 مكوّن');
      final seen=<String>{};
      for(final line in lines){
        if(line is! Map||line.keys.any((k)=>!['inventoryItemId','itemName','unit','quantityPerUnit'].contains(k)))throw ArgumentError('حقول المكوّن غير صالحة');
        for(final k in ['inventoryItemId','itemName','unit']){if(line[k] is! String||(line[k] as String).trim().isEmpty||(line[k] as String).length>200)throw ArgumentError('اختر الصنف والوحدة');}
        final qty=line['quantityPerUnit'];if(qty is! num||!qty.isFinite||qty<=0||qty>1000000000)throw ArgumentError('كمية المكوّن غير صالحة');
        if(line['inventoryItemId']==r['finishedItemId']||!seen.add(line['inventoryItemId']))throw ArgumentError('قائمة المواد لا تقبل المنتج نفسه أو مكوّنًا مكررًا');
      }
    }else if(c=='deals'){
      for(final k in ['title','clientAccountId','clientName','currency'])text(k);
      number('value');number('probability');if(r['probability']>100)throw ArgumentError('الاحتمال غير صالح');
      choice('stage',['lead','proposal','negotiation','won','lost']);
    }else if(c=='purchaseOrders'){
      for(final k in ['supplierAccountId','warehouseId','poNumber','currency'])text(k);
      choice('status',['draft','approved']);
      final lines=r['lines'];if(lines is! List||lines.isEmpty||lines.length>100)throw ArgumentError('بنود أمر الشراء غير صالحة');
      for(final line in lines){
        if(line is! Map||line.keys.any((k)=>!['inventoryItemId','itemName','unit','quantity','unitCost'].contains(k)))throw ArgumentError('حقل بند غير صالح');
        for(final k in ['itemName','unit','inventoryItemId']){if(line[k] is! String||(line[k] as String).isEmpty||(line[k] as String).length>200)throw ArgumentError('مرجع بند غير صالح');}
        for(final k in ['quantity','unitCost']){final v=line[k];if(v is! num||!v.isFinite||v<=0||v>1000000000)throw ArgumentError('كمية أو سعر غير صالح');}
      }
    }else if(c=='productionOrders'){
      for(final k in ['bomId','finishedItemId','warehouseId','orderNumber'])text(k);
      number('quantityToProduce');if(r['quantityToProduce']<=0)throw ArgumentError('كمية الإنتاج يجب أن تكون أكبر من صفر');choice('status',['planned','in-progress']);
    }else if(c=='costCenters'){
      text('name');text('code');number('budget');
      number('extraPostedSpend');
      choice('status',['active','closed']);final cats=r['linkedCategories'];
      if(cats is! List||cats.length>30||cats.any((v)=>v is! String||v.length>100))throw ArgumentError('تصنيفات المركز غير صالحة');
    }else if(c=='vatConfig'){
      if(r['id']!='config')throw ArgumentError('معرف الإعداد غير صالح');
      choice('jurisdiction',['none','sa_15','ae_5','custom']);choice('basis',['recorded_only','estimated_gross']);number('ratePercent');
      if(r['ratePercent']>100)throw ArgumentError('النسبة غير صالحة');
      const rates={'none':0,'sa_15':15,'ae_5':5};if(rates.containsKey(r['jurisdiction'])&&r['ratePercent']!=rates[r['jurisdiction']])throw ArgumentError('نسبة الضريبة لا تطابق النظام المختار');
    }
  }
  static bool locked(String c,Map r)=>r['postedLedgerEntryId']!=null||r['convertedInvoiceEntryId']!=null||r['completedDate']!=null||(c=='purchaseOrders'&&r['status']=='received')||(c=='productionOrders'&&r['status']=='completed');
  static List<Map<String,dynamic>> rows(Map<String,dynamic> data,String c)=>c=='vatConfig'?(data[c]==null?[]:[Map<String,dynamic>.from(data[c])]):(data[c] as List).map((r)=>Map<String,dynamic>.from(r)).toList();
  Future<Map<String,dynamic>> save(String workspace,String operation,List<dynamic> changes)async{
    if(changes.isEmpty||changes.length>10)throw ArgumentError('احفظ من سجل واحد إلى عشرة سجلات');
    final seen=<String>{};
    for(final change in changes){
      if(change is! Map||change.keys.any((k)=>!['collection','record','expectedRevision','operation'].contains(k))||!fields.containsKey(change['collection'])||change['record'] is! Map<String,dynamic>||change['expectedRevision'] is! int||change['expectedRevision']<0)throw ArgumentError('طلب تعديل غير صالح');
      final r=change['record'] as Map<String,dynamic>,op=change['operation']??(change['expectedRevision']==0?'create':'update');
      if(!['create','update','delete'].contains(op)||r['id'] is! String||!RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(r['id']))throw ArgumentError('معرف السجل أو العملية غير صالح');
      if(op=='delete'){
        if(change['collection']=='vatConfig'||r.keys.any((k)=>k!='id'))throw ArgumentError('طلب حذف غير صالح');
      }else{validate(change['collection'],r);}
      if(!seen.add('${change['collection']}:${r['id']}'))throw ArgumentError('سجل مكرر في الطلب');
    }
    await local.commitOperation(workspaceId:workspace,operationId:operation,operationType:'erp.records.save',payload:{'changes':changes},apply:(t)async{
      await LocalMasterCatalog.requireLocal(t,workspace);
      final current=await read(t),next=jsonDecode(jsonEncode(current)) as Map<String,dynamic>;
      final updates=<String,Map<String,dynamic>>{},leaveDeltas=<String,num>{};
      for(final change in changes){
        final c=change['collection'] as String,r=Map<String,dynamic>.from(change['record']),key='erp-record:$c:${change['record']['id']}';
        final stored=await t.query('erp_state',where:'stateKey = ?',whereArgs:[key]);
        final old=stored.isEmpty?null:jsonDecode(stored.single['payloadJson'] as String) as Map<String,dynamic>;
        final op=change['operation']??(change['expectedRevision']==0?'create':'update');
        if(op=='create' ? old!=null||change['expectedRevision']!=0 : old==null||old['_deleted']==true||old['_revision']!=change['expectedRevision'])throw StateError('تغيّر السجل أو حُذف؛ حدّث القائمة قبل التعديل');
        if(old!=null&&locked(c,old))throw StateError('المستند مرحّل؛ استخدم الإلغاء أو العكس من شاشة المستند');
        if(c=='costCenters'&&(op=='delete'?(old?['extraPostedSpend']??0)!=0:r['extraPostedSpend']!=(old?['extraPostedSpend']??0)))throw StateError('لا يمكن تغيير المصروف المرحّل أو حذف المركز المرتبط به');
        if(c=='leaveRequests'){
          if(old?['status']=='approved')leaveDeltas[old!['employeeId']]=(leaveDeltas[old['employeeId']]??0)+old['days'];
          if(op!='delete'&&r['status']=='approved')leaveDeltas[r['employeeId']]=(leaveDeltas[r['employeeId']]??0)-r['days'];
        }
        final list=rows(next,c)..removeWhere((v)=>v['id']==r['id']);
        r['_revision']=(change['expectedRevision'] as int)+1;
        if(op=='delete'){r['_deleted']=true;}else{list.add(r);}
        next[c]=c=='vatConfig'?list.single:list;updates[key]=r;
      }
      Future<void> reference(String table,dynamic id,String label)async{
        if(id is! String||id.isEmpty)throw StateError('$label غير موجود');
        if((await t.query(table,columns:['id'],where:'id = ?',whereArgs:[id],limit:1)).isEmpty&&
          (await t.query('legacy_operational_rows',columns:['record_id'],where:'collection = ? AND record_id = ?',whereArgs:[table=='inventory_items'?'inventory':table,id],limit:1)).isEmpty)throw StateError('$label غير موجود في مساحة العمل');
      }
      Future<void> itemUnit(dynamic id,dynamic unit)async{
        final item=await t.query('inventory_items',columns:['unit'],where:'id = ?',whereArgs:[id]);
        dynamic expected=item.isEmpty?null:item.single['unit'];
        if(expected==null){final archived=await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['inventory',id]);if(archived.isNotEmpty)expected=jsonDecode(archived.single['row_json'] as String)['unit'];}
        if(expected!=unit)throw StateError('وحدة البند لا تطابق بطاقة الصنف؛ أعد اختيار الصنف');
      }
      Map<String,dynamic> erpRef(String c,dynamic id,String label){
        final found=rows(next,c).where((v)=>v['id']==id).toList();if(found.isEmpty)throw StateError('$label مرتبط بسجل آخر أو غير موجود');return found.single;
      }
      for(final c in fields.keys)for(final r in rows(next,c)){
        final changed=seen.contains('$c:${r['id']}');
        if(c=='leaveRequests'&&(changed||seen.contains('employees:${r['employeeId']}'))){
          final emp=erpRef('employees',r['employeeId'],'الموظف');if(changed)r['employeeName']=emp['name'];
        }
        if(c=='productionOrders'&&(changed||seen.contains('boms:${r['bomId']}')||seen.contains('costCenters:${r['costCenterId']}'))){
          final bom=erpRef('boms',r['bomId'],'قائمة المواد');if(changed&&bom['finishedItemId']!=r['finishedItemId'])throw StateError('المنتج لا يطابق قائمة المواد');
          if(r['costCenterId']!=null&&r['costCenterId']!='')erpRef('costCenters',r['costCenterId'],'مركز التكلفة');
        }
        if(!changed)continue;
        if(c=='employees'&&r['accountId']!=null&&r['accountId']!='')await reference('accounts',r['accountId'],'الحساب');
        if(c=='deals'||c=='purchaseOrders'){
          final id=c=='deals'?r['clientAccountId']:r['supplierAccountId'];await reference('accounts',id,'الحساب');
          final accounts=await t.query('accounts',where:'id = ?',whereArgs:[id]);
          final code=LocalMasterCatalog.currencyCodes[r['currency']];
          if(code==null||accounts.isNotEmpty&&accounts.single['currency']!=code)throw StateError('عملة الحساب لا تطابق عملة السجل');
          if(accounts.isEmpty){
            final archived=await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['accounts',id]);
            if(archived.isEmpty||jsonDecode(archived.single['row_json'] as String)['currency']!=r['currency'])throw StateError('عملة الحساب لا تطابق عملة السجل');
          }
        }
        if(c=='purchaseOrders'||c=='productionOrders')await reference('warehouses',r['warehouseId'],'المخزن');
        if(c=='boms'||c=='productionOrders')await reference('inventory_items',r['finishedItemId'],'المنتج');
        if(c=='boms')await itemUnit(r['finishedItemId'],r['finishedUnit']);
        if(c=='purchaseOrders'||c=='boms')for(final line in r[c=='boms'?'components':'lines'] as List){await reference('inventory_items',line['inventoryItemId'],'الصنف');await itemUnit(line['inventoryItemId'],line['unit']);}
        if(c=='boms'&&rows(current,'productionOrders').any((v)=>v['bomId']==r['id']))throw StateError('قائمة المواد مستخدمة في أمر إنتاج؛ أنشئ قائمة أخرى لتغيير التركيبة');
        const uniqueFields={'employees':'name','purchaseOrders':'poNumber','boms':'name','productionOrders':'orderNumber','costCenters':'code'};final unique=uniqueFields[c];
        if(unique!=null&&rows(next,c).any((v)=>v['id']!=r['id']&&v[unique].toString().trim().toLowerCase()==r[unique].toString().trim().toLowerCase()))throw StateError('الاسم أو الرقم مستخدم في سجل آخر');
        updates['erp-record:$c:${r['id']}']=r;
      }
      for(final delta in leaveDeltas.entries){
        if(seen.contains('employees:${delta.key}'))throw StateError('احفظ تعديل الموظف وطلب الإجازة في عمليتين منفصلتين');
        final emp=erpRef('employees',delta.key,'الموظف');
        if(emp['leaveBalanceDays']+delta.value<0)throw StateError('رصيد إجازات الموظف غير كافٍ');
        emp['leaveBalanceDays']+=delta.value;emp['_revision']=(emp['_revision'] as int)+1;
        updates['erp-record:employees:${delta.key}']=emp;
      }
      final batch=t.batch(),now=DateTime.now().toUtc().toIso8601String();
      for(final entry in updates.entries){batch.insert('erp_state',{'stateKey':entry.key,'payloadJson':jsonEncode(entry.value),'updatedAt':now},conflictAlgorithm:ConflictAlgorithm.replace);}
      await batch.commit(noResult:true);
      return {'saved':true};
    });
    final db=await local.database;return read(db);
  }
}
