import 'dart:convert';
import 'package:sqflite/sqflite.dart';

/// References in editable ERP records/settings are not SQL foreign keys.
/// Check them before deleting a master; receipts and immutable source bytes
/// are deliberately not treated as editable configuration.
class LocalReferenceGuards {
  static bool contains(dynamic value,dynamic id,Set<String> keys){
    if(value is List)return value.any((v)=>contains(v,id,keys));
    if(value is Map){
      for(final e in value.entries){
        if(keys.contains(e.key)&&(e.value==id||e.value is List&&(e.value as List).contains(id)))return true;
        if(contains(e.value,id,keys))return true;
      }
    }
    return false;
  }
  static Future<void> check(DatabaseExecutor t,dynamic id,Set<String> keys)async{
    for(final row in await t.query('erp_state',where:"stateKey LIKE 'erp-record:%' OR stateKey = 'workspace_settings_v1' OR stateKey LIKE 'account_meta:%'")){
      final value=jsonDecode(row['payloadJson'] as String);
      if(value is Map&&value['_deleted']==true)continue;
      if(contains(value,id,{...keys,for(final k in keys) 'default${k[0].toUpperCase()}${k.substring(1)}'}))throw StateError('السجل مستخدم في بيانات إدارية أو إعدادات؛ عدّل المرجع أولًا');
      if(value is Map){
        final defaults=value['referenceDefaults'];
        if(defaults is Map){
          if(keys.contains('currency')&&(defaults['systemCashboxes'] as Map? ??{}).containsKey(id))throw StateError('العملة مستخدمة في الصندوق الافتراضي');
          if(keys.contains('groupId')&&(defaults['groupCashboxes'] as Map? ??{}).containsKey(id.toString()))throw StateError('المجموعة مستخدمة في الصندوق الافتراضي');
          if(keys.contains('accountId')&&(defaults['accountCashboxes'] as Map? ??{}).containsKey(id.toString()))throw StateError('الحساب مستخدم في الصندوق الافتراضي');
          if(keys.contains('cashboxId')&&['systemCashboxes','groupCashboxes','accountCashboxes'].any((k)=>(defaults[k] as Map? ??{}).values.contains(id)))throw StateError('الصندوق مستخدم في الإعدادات الافتراضية');
        }
      }
    }
  }
}
