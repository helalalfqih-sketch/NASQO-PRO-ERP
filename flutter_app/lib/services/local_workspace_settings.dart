import 'local_business_setup.dart';
import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';

/// Mutable workspace settings are independent of immutable import evidence.
class LocalWorkspaceSettings {
  LocalWorkspaceSettings(this.local);
  final LocalDatabase local;
  static const stateKey='workspace_settings_v1';
  static const fields={'businessProfile','userPreferences','companyName','defaultCurrency','whatsappProvider','whatsappInstantEnabled','whatsappPhone','cashierSettings','referenceDefaults'};
  static Future<Map<String,dynamic>> read(DatabaseExecutor db)async{
    final rows=await db.query('erp_state',where:'stateKey = ?',whereArgs:[stateKey]);
    if(rows.isEmpty)return {};
    final value=jsonDecode(rows.single['payloadJson'] as String);
    if(value is! Map<String,dynamic>)throw StateError('Invalid workspace settings');
    return {for(final e in value.entries)if(fields.contains(e.key))e.key:e.value};
  }
  Future<void> save(String workspace,Map<String,dynamic> input)async{
    if(workspace!='local-erp-workspace'||input.keys.any((k)=>!fields.contains(k)&&!['id','ownerId','closedUntilDate'].contains(k)))
      throw ArgumentError('Invalid settings');
    if(input['id']!=null&&input['id']!=workspace||input['ownerId']!=null&&input['ownerId']!=workspace)
      throw ArgumentError('Workspace mismatch');
    // Fiscal locking is not exposed until every posting path honors it.
    if(input['closedUntilDate']!=null)throw ArgumentError('Fiscal lock is not available locally yet');
    final db=await local.database;
    await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      final next=await read(t);
      for(final k in fields){
        if(!input.containsKey(k))continue;
        final value=input[k];
        if(k=='businessProfile'){
          LocalBusinessSetup.profile(value);
          if(next[k]==null || value['completedAt']!=next[k]['completedAt']) throw ArgumentError('Complete setup first');
        }else if(k=='userPreferences'){
          await LocalBusinessSetup.preferences(t,value);
        }else if(k=='referenceDefaults'){
          await validateReferences(t,value,input['defaultCurrency']??next['defaultCurrency']);
        }else if(k=='cashierSettings'){
          await validateCashier(t,value);
        }else if(k=='whatsappInstantEnabled'){
          if(value is! bool)throw ArgumentError('Invalid preference');
        }else{
          if(value is! String||value.length>(k=='companyName'?100:k=='whatsappPhone'?32:64))throw ArgumentError('Invalid preference');
          if(k=='companyName'&&value.trim().isEmpty)throw ArgumentError('Company name required');
          if(k=='whatsappProvider'&&!['nasqo','external'].contains(value))throw ArgumentError('Invalid provider');
          if(k=='defaultCurrency'){
            final allowed=(await LocalMasterCatalog.read(t,'currencies')).map((r)=>r['name']).toSet();
            if(!allowed.contains(value))throw ArgumentError('Currency not in the workspace');
          }
        }
        next[k]=value is String?value.trim():value;
      }
      await t.insert('erp_state',{'stateKey':stateKey,'payloadJson':jsonEncode(next),
        'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
    });
  }
  static Future<Map<String,Map<String,dynamic>>> records(DatabaseExecutor db,String table,String collection)async{
    final rows=<String,Map<String,dynamic>>{};
    for(final r in await db.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[collection])){
      final row=jsonDecode(r['row_json'] as String) as Map<String,dynamic>;rows[row['id'].toString()]=row;
    }
    for(final row in await db.query(table)){rows[row['id'].toString()]=row;}
    return rows;
  }
  static Future<void> validateReferences(DatabaseExecutor db,dynamic value,dynamic defaultCurrency)async{
    const keys={'warehouseId','accountId','systemCashboxes','accountCashboxes','groupCashboxes'};
    if(value is! Map<String,dynamic>||value.length!=keys.length||value.keys.any((k)=>!keys.contains(k)))throw ArgumentError('Invalid document defaults');
    for(final k in ['warehouseId','accountId']){
      if(value[k] is! String||(value[k] as String).length>150)throw ArgumentError('Invalid document reference');
    }
    for(final k in ['systemCashboxes','accountCashboxes','groupCashboxes']){
      final m=value[k];
      if(m is! Map<String,dynamic>||m.length>20000||m.entries.any((e)=>e.key.isEmpty||e.key.length>150||['__proto__','constructor','prototype'].contains(e.key)||e.value is! int||e.value<=0))throw ArgumentError('Invalid cashbox defaults');
    }
    final warehouses=await records(db,'warehouses','warehouses'),accounts=await records(db,'accounts','accounts');
    final boxes=await LocalMasterCatalog.read(db,'cashboxes'),groups=await LocalMasterCatalog.read(db,'accountGroups');
    final currencies=(await LocalMasterCatalog.read(db,'currencies')).map((c)=>c['name']).toSet();
    String? currencyOf(dynamic code){
      if(currencies.contains(code))return code as String;
      for(final e in LocalMasterCatalog.currencyCodes.entries){if(e.value==code)return e.key;}
      return null;
    }
    bool boxMatches(dynamic id,dynamic currency)=>currency!=null&&boxes.any((b)=>b['id']==id&&b['currencyCode']==currency&&b['isActive']!=false&&b['state']!=0);
    if(value['warehouseId']!=''&&!warehouses.containsKey(value['warehouseId']))throw ArgumentError('Missing default warehouse');
    final a=accounts[value['accountId']];
    if(value['accountId']!=''&&(a==null||a['isCashAccount']==true||a['isCashAccount']==1||currencyOf(a['currency'])!=(defaultCurrency??'ريال')))throw ArgumentError('Invalid default account');
    for(final e in (value['systemCashboxes'] as Map).entries){if(!currencies.contains(e.key)||!boxMatches(e.value,e.key))throw ArgumentError('Invalid system cashbox');}
    for(final e in (value['accountCashboxes'] as Map).entries){if(!accounts.containsKey(e.key)||!boxMatches(e.value,currencyOf(accounts[e.key]?['currency'])))throw ArgumentError('Invalid account cashbox');}
    for(final e in (value['groupCashboxes'] as Map).entries){
      final matches=groups.where((g)=>g['id'].toString()==e.key);
      if(matches.isEmpty||!boxMatches(e.value,matches.first['currencyCode']))throw ArgumentError('Invalid group cashbox');
    }
  }

  static Future<void> validateCashier(DatabaseExecutor db,dynamic value)async{
    const keys={'warehouseId','cashboxId','accountId','currency','quickItemIds'};
    if(value is! Map<String,dynamic>||value.length!=keys.length||value.keys.any((k)=>!keys.contains(k)))throw ArgumentError('Invalid cashier settings');
    for(final k in ['warehouseId','accountId','currency']){
      if(value[k] is! String||(value[k] as String).length>150)throw ArgumentError('Invalid cashier reference');
    }
    final ids=value['quickItemIds'],box=value['cashboxId'],currency=value['currency'];
    if(ids is! List||ids.length>20000||ids.any((id)=>id is! String||id.isEmpty||id.length>150)||ids.toSet().length!=ids.length||box!=null&&(box is! int||box<=0))throw ArgumentError('Invalid cashier shortcuts');
    if(!(await LocalMasterCatalog.read(db,'currencies')).any((r)=>r['name']==currency))throw ArgumentError('Invalid cashier currency');
    final warehouses=await records(db,'warehouses','warehouses'),accounts=await records(db,'accounts','accounts'),inventory=await records(db,'inventory_items','inventory');
    if(value['warehouseId']!=''&&!warehouses.containsKey(value['warehouseId']))throw ArgumentError('Missing cashier warehouse');
    if(value['accountId']!=''){
      final a=accounts[value['accountId']];
      if(a==null||a['isCashAccount']==true||a['isCashAccount']==1||![currency,LocalMasterCatalog.currencyCodes[currency]].contains(a['currency']))throw ArgumentError('Invalid cashier customer');
    }
    if(box!=null&&!(await LocalMasterCatalog.read(db,'cashboxes')).any((b)=>b['id']==box&&b['currencyCode']==currency&&b['isActive']!=false&&b['state']!=0))throw ArgumentError('Invalid cashier cashbox');
    if(ids.any((id)=>!inventory.containsKey(id)||inventory[id]?['isActive']==false))throw ArgumentError('Missing cashier item');
  }

  static Future<void> attach(DatabaseExecutor db,Map<String,dynamic> snapshot)async{
    final saved=await read(db);
    final ws=<String,dynamic>{...Map<String,dynamic>.from(snapshot['workspace'] as Map),...saved};
    snapshot['workspace']=ws;
    snapshot['activeCurrency']=ws['defaultCurrency'];
  }
}
