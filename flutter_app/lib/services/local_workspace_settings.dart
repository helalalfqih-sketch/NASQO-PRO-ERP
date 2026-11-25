import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';

/// Mutable workspace settings are independent of immutable import evidence.
class LocalWorkspaceSettings {
  LocalWorkspaceSettings(this.local);
  final LocalDatabase local;
  static const stateKey='workspace_settings_v1';
  static const fields={'companyName','defaultCurrency','whatsappProvider','whatsappInstantEnabled','whatsappPhone','cashierSettings'};
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
        if(k=='cashierSettings'){
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
  static Future<void> validateCashier(DatabaseExecutor db,dynamic value)async{
    const keys={'warehouseId','cashboxId','accountId','currency','quickItemIds'};
    if(value is! Map<String,dynamic>||value.length!=keys.length||value.keys.any((k)=>!keys.contains(k)))throw ArgumentError('Invalid cashier settings');
    for(final k in ['warehouseId','accountId','currency']){
      if(value[k] is! String||(value[k] as String).length>150)throw ArgumentError('Invalid cashier reference');
    }
    final ids=value['quickItemIds'],box=value['cashboxId'],currency=value['currency'];
    if(ids is! List||ids.length>20000||ids.any((id)=>id is! String||id.isEmpty||id.length>150)||ids.toSet().length!=ids.length||box!=null&&(box is! int||box<=0))throw ArgumentError('Invalid cashier shortcuts');
    if(!(await LocalMasterCatalog.read(db,'currencies')).any((r)=>r['name']==currency))throw ArgumentError('Invalid cashier currency');
    Future<Map<String,Map<String,dynamic>>> records(String table,String collection)async{
      final rows=<String,Map<String,dynamic>>{};
      for(final r in await db.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[collection])){
        final row=jsonDecode(r['row_json'] as String) as Map<String,dynamic>;rows[row['id'].toString()]=row;
      }
      for(final row in await db.query(table)){rows[row['id'].toString()]=row;}
      return rows;
    }
    final warehouses=await records('warehouses','warehouses'),accounts=await records('accounts','accounts'),inventory=await records('inventory_items','inventory');
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
