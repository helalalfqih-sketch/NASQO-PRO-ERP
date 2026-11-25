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
      if(e.value is! String&&e.value is! num&&e.key!='lines'&&e.key!='linkedCategories')throw ArgumentError('نوع الحقل غير صالح');
    }
    void text(String key){if(r[key] is! String||(r[key] as String).trim().isEmpty)throw ArgumentError('الحقل $key مطلوب');}
    void number(String key){if(r[key] is! num)throw ArgumentError('الحقل $key يجب أن يكون رقمًا');}
    void choice(String key,List<String> values){if(!values.contains(r[key]))throw ArgumentError('قيمة $key غير مدعومة');}
    if(c=='employees'){
      for(final k in ['name','roleTitle','department','hireDate'])text(k);
      for(final k in ['basicSalary','allowances','deductions','leaveBalanceDays'])number(k);
      choice('status',['active','on-leave','inactive']);choice('attendanceToday',['present','leave','absent']);
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
      number('quantityToProduce');choice('status',['planned','in-progress']);
    }else if(c=='costCenters'){
      text('name');text('code');number('budget');
      if(r['extraPostedSpend']!=0)throw ArgumentError('الترحيل غير متاح من سجل مركز التكلفة');
      choice('status',['active','closed']);final cats=r['linkedCategories'];
      if(cats is! List||cats.length>30||cats.any((v)=>v is! String||v.length>100))throw ArgumentError('تصنيفات المركز غير صالحة');
    }else if(c=='vatConfig'){
      if(r['id']!='config')throw ArgumentError('معرف الإعداد غير صالح');
      choice('jurisdiction',['none','sa_15','ae_5','custom']);choice('basis',['recorded_only','estimated_gross']);number('ratePercent');
      if(r['ratePercent']>100)throw ArgumentError('النسبة غير صالحة');
    }
  }
  Future<Map<String,dynamic>> save(String workspace,String operation,List<dynamic> changes)async{
    if(changes.isEmpty||changes.length>10)throw ArgumentError('عدد التعديلات غير صالح');
    final seen=<String>{};
    for(final change in changes){
      if(change is! Map||change.keys.any((k)=>!['collection','record','expectedRevision'].contains(k))||change['collection'] is! String||change['record'] is! Map<String,dynamic>||change['expectedRevision'] is! int||change['expectedRevision']<0)throw ArgumentError('طلب تعديل غير صالح');
      validate(change['collection'],change['record']);
      if(!seen.add('${change['collection']}:${change['record']['id']}'))throw ArgumentError('سجل مكرر في الطلب');
    }
    await local.commitOperation(workspaceId:workspace,operationId:operation,operationType:'erp.records.save',payload:{'changes':changes},apply:(t)async{
      await LocalMasterCatalog.requireLocal(t,workspace);
      for(final change in changes){
        final c=change['collection'] as String,r=Map<String,dynamic>.from(change['record']);final key='erp-record:$c:${r['id']}';
        final rows=await t.query('erp_state',where:'stateKey = ?',whereArgs:[key]);
        final old=rows.isEmpty?null:jsonDecode(rows.single['payloadJson'] as String) as Map;
        if((old?['_revision']??0)!=change['expectedRevision'])throw StateError('تغيّر السجل؛ أعد فتحه قبل التعديل');
        // References must exist in the same local snapshot, including imported masters.
        Future<void> reference(String field,String table)async{
          final id=r[field];if(id==null||id=='')return;
          if((await t.query(table,columns:['id'],where:'id = ?',whereArgs:[id],limit:1)).isEmpty&&
            (await t.query('legacy_operational_rows',columns:['record_id'],where:'collection = ? AND record_id = ?',whereArgs:[table=='inventory_items'?'inventory':table,id],limit:1)).isEmpty)throw StateError('المرجع $field غير موجود');
        }
        if(c=='employees')await reference('accountId','accounts');
        if(c=='deals')await reference('clientAccountId','accounts');
        if(c=='purchaseOrders'){
          await reference('supplierAccountId','accounts');await reference('warehouseId','warehouses');
          for(final line in r['lines'] as List){
            final id=line['inventoryItemId'];
            if((await t.query('inventory_items',columns:['id'],where:'id = ?',whereArgs:[id],limit:1)).isEmpty&&
              (await t.query('legacy_operational_rows',columns:['record_id'],where:'collection = ? AND record_id = ?',whereArgs:['inventory',id],limit:1)).isEmpty)throw StateError('الصنف غير موجود');
          }
        }
        if(c=='productionOrders')throw StateError('حفظ أمر إنتاج يحتاج قائمة مواد محلية معتمدة؛ الميزة غير متاحة في هذه النسخة');
        r['_revision']=(change['expectedRevision'] as int)+1;
        await t.insert('erp_state',{'stateKey':key,'payloadJson':jsonEncode(r),'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
      }
      return {'saved':true};
    });
    final db=await local.database;return read(db);
  }
}
