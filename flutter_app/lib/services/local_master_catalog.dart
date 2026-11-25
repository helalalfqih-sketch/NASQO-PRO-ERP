import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_document_commands.dart';
import 'local_invoice_roles.dart';

/// Mutable master records are overlaid on the immutable original archive.
/// All edits use one local transaction and keep a native-backup-compatible audit.
class LocalMasterCatalog {
  LocalMasterCatalog(this.local);
  final LocalDatabase local;
  static const categories=['purchases','sales','clients','employees','transfers','shop'];
  static const currencyCodes={'ريال':'sar','دولار':'usd','يورو':'eur'};
  static const collections=['currencies','accountGroups','cashboxes'];

  static Future<List<Map<String,dynamic>>> read(DatabaseExecutor db,String collection)async{
    if(!collections.contains(collection))throw ArgumentError('Invalid catalog');
    final stored=await db.query('erp_state',where:'stateKey = ?',whereArgs:['master:$collection']);
    if(stored.isNotEmpty){
      return (jsonDecode(stored.single['payloadJson'] as String) as List).map((r)=>Map<String,dynamic>.from(r as Map)).toList();
    }
    final archive=await db.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[collection]);
    if(archive.isNotEmpty)return archive.map((r)=>jsonDecode(r['row_json'] as String) as Map<String,dynamic>).toList();
    if(collection=='currencies')return [{'id':1,'code':'SAR','name':'ريال','symbol':'ريال','ratePrimary':1,'rateSecondary':1,'nameSecondary':''}];
    return [];
  }

  static Future<void> write(DatabaseExecutor t,String collection,List<Map<String,dynamic>> rows)async{
    await t.insert('erp_state',{'stateKey':'master:$collection','payloadJson':jsonEncode(rows),
      'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
  }

  static Future<void> attach(DatabaseExecutor t,Map<String,dynamic> data)async{
    for(final collection in collections){data[collection]=await read(t,collection);}
  }

  static int nextId(List<Map<String,dynamic>> rows){
    var id=0;
    for(final row in rows){final n=row['id'];if(n is int&&n>id)id=n;}
    if(id>=2147483646)throw StateError('Catalog identity limit');
    return id+1;
  }

  static String name(Map<String,dynamic> input,String field,int max){
    final value=LocalDocumentCommands.field(input,field,max).trim();
    if(value.isEmpty)throw ArgumentError('Name is required');
    return value;
  }

  static Future<void> requireLocal(Transaction t,String workspace)async{
    if(workspace!='local-erp-workspace')throw ArgumentError('Workspace mismatch');
    await LocalDatabase.requireLiveWorkspace(t);
    if((await t.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding'])).isNotEmpty||
       (await t.query('sync_outbox',where:'acknowledged_at IS NOT NULL OR server_revision IS NOT NULL',limit:1)).isNotEmpty||
       (await t.query('sync_state',limit:1)).isNotEmpty)
      throw StateError('Catalog changes require a local-only workspace');
  }

  /// Cashbox metadata + explicit posting-account binding, no parent posting.
  Future<Map<String,dynamic>> saveCashbox(String workspace,String key,Map<String,dynamic> input)async{
    if(input.keys.any((k)=>!['id','name','currencyCode','accountId','isActive'].contains(k)))throw ArgumentError('Invalid cashbox fields');
    final title=name(input,'name',100),currency=input['currencyCode'],account=input['accountId'],id=input['id'],active=input['isActive']??true;
    if(!currencyCodes.containsKey(currency)||account is! String||account.isEmpty||active is! bool||(id!=null&&(id is! int||id<=0)))throw ArgumentError('Invalid cashbox');
    return local.commitOperation(workspaceId:workspace,operationId:key,operationType:'cashbox.save',payload:input,apply:(t)async{
      await requireLocal(t,workspace);
      final code=currencyCodes[currency]!;
      if((await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = 1',whereArgs:[account,code])).length!=1)throw StateError('اختر حساب صندوق محلي من نفس العملة');
      final rows=await read(t,'cashboxes');final index=rows.indexWhere((r)=>r['id']==id);
      if(id!=null&&index<0)throw StateError('الصندوق غير موجود');
      if(index>=0&&rows[index]['currencyCode']!=currency)throw StateError('عملة الصندوق محفوظة ولا تتغير');
      if(rows.any((r)=>r['id']!=id&&r['name']==title))throw StateError('اسم الصندوق موجود');
      final actualId=id??nextId(rows),roleKey='cashbox:${id??nextId(rows)}';
      final roles=await LocalInvoiceRoles.read(t);final selected=Map<String,dynamic>.from(roles[code] as Map? ?? {});
      if(selected[roleKey]!=null&&selected[roleKey]!=account)throw StateError('ربط حساب الصندوق محفوظ؛ لا يمكن تغيير تاريخ الترحيل');
      if(selected.entries.any((e)=>e.key.startsWith('cashbox:')&&e.key!=roleKey&&e.value==account))throw StateError('الحساب مرتبط بصندوق آخر');
      selected[roleKey]=account;roles[code]=selected;
      final row=<String,dynamic>{if(index>=0)...rows[index],'id':actualId,'name':title,'currencyCode':currency,'accountId':account,'isActive':active,'state':active?1:0};
      if(index<0){rows.add(row);}else{rows[index]=row;}
      await write(t,'cashboxes',rows);
      await t.insert('erp_state',{'stateKey':LocalInvoiceRoles.stateKey,'payloadJson':jsonEncode(roles),'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
      return row;
    });
  }

  Future<Map<String,dynamic>> saveGroup(String workspace,String key,Map<String,dynamic> input)async{
    final title=name(input,'name',100);
    final id=input['id'],category=input['category']??'shop',currency=input['currencyCode']??'ريال',sort=input['sortOrder'];
    if((id!=null&&(id is! int||id<=0))||!categories.contains(category)||
        currency is! String||(sort!=null&&(sort is! int||sort<0)))throw ArgumentError('Invalid group');
    final result=await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'group.save',
      payload:{'id':id,'name':title,'category':category,'currencyCode':currency,'sortOrder':sort},apply:(t)async{
        await requireLocal(t,workspace);
        if(!(await read(t,'currencies')).any((c)=>c['name']==currency))throw ArgumentError('Unknown group currency');
        final groups=await read(t,'accountGroups');
        final index=id==null?-1:groups.indexWhere((g)=>g['id']==id);
        if(id!=null&&index<0)throw StateError('Group missing');
        if(groups.any((g)=>g['id']!=id&&g['name']==title))throw ArgumentError('Duplicate group');
        if(index>=0&&(groups[index]['category']!=category||groups[index]['currencyCode']!=currency))
          throw StateError('Group classification and currency cannot be changed after creation');
        final row=<String,dynamic>{if(index>=0)...groups[index],
          'id':id??nextId(groups),'name':title,'category':category,'currencyCode':currency,
          'sortOrder':sort??(index>=0?groups[index]['sortOrder']??index+1:nextId(groups)),
          'hasBill':index>=0?groups[index]['hasBill']??false:false,
          'isEmployee':category=='employees'};
        if(index<0){groups.add(row);}else{groups[index]=row;}
        await write(t,'accountGroups',groups);
        return {'group':row};
      });
    return result['group'] as Map<String,dynamic>;
  }

  Future<void> saveCurrency(String workspace,String key,Map<String,dynamic> input)async{
    final title=name(input,'name',32),id=input['id'];
    final symbol=LocalDocumentCommands.field(input,'symbol',16);
    final secondary=LocalDocumentCommands.field(input,'nameSecondary',32);
    final rate1=input['ratePrimary']??1,rate2=input['rateSecondary']??1;
    if((id!=null&&(id is! int||id<=0))||rate1 is! num||rate2 is! num||
        !rate1.isFinite||!rate2.isFinite||rate1<=0||rate2<=0||rate1>1000000000||rate2>1000000000)
      throw ArgumentError('Invalid currency');
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'currency.save',
      payload:{'id':id,'name':title,'symbol':symbol,'nameSecondary':secondary,'ratePrimary':rate1,'rateSecondary':rate2},apply:(t)async{
        await requireLocal(t,workspace);
        final currencies=await read(t,'currencies');
        final index=id==null?-1:currencies.indexWhere((c)=>c['id']==id);
        if(id!=null&&index<0)throw StateError('Currency missing');
        if(index<0&&!currencyCodes.containsKey(title))throw ArgumentError('This currency is not supported by the local engine');
        if(index>=0&&currencies[index]['name']!=title)throw StateError('Currency name is a financial identity');
        if(currencies.any((c)=>c['id']!=id&&c['name']==title))throw ArgumentError('Duplicate currency');
        final row=<String,dynamic>{if(index>=0)...currencies[index],
          'id':id??nextId(currencies),'name':title,'code':index>=0?currencies[index]['code']??title:title,
          'symbol':symbol,'nameSecondary':secondary,'ratePrimary':rate1,'rateSecondary':rate2};
        if(index<0){currencies.add(row);}else{currencies[index]=row;}
        await write(t,'currencies',currencies);
        return {'id':row['id']};
      });
  }

  Future<void> deleteCurrency(String workspace,String key,int id)async{
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'currency.delete',
      payload:{'id':id},apply:(t)async{
        await requireLocal(t,workspace);
        final currencies=await read(t,'currencies');
        final index=currencies.indexWhere((c)=>c['id']==id);
        if(index<0)throw StateError('Currency missing');
        final title=currencies[index]['name'];
        if(currencies.length<=1||title=='ريال')throw StateError('Cannot delete the base currency');
        final code=currencyCodes[title];
        if(code==null)throw StateError('Imported currency must remain in the historical register');
        if((await t.query('accounts',where:'currency = ?',whereArgs:[code],limit:1)).isNotEmpty||
            (await t.query('ledger_entries',where:'currency = ?',whereArgs:[code],limit:1)).isNotEmpty||
            (await read(t,'accountGroups')).any((g)=>g['currencyCode']==title)||
            (await read(t,'cashboxes')).any((b)=>b['currencyCode']==title))
          throw StateError('Currency is in use');
        final settings=await t.query('erp_state',where:'stateKey = ?',whereArgs:['workspace_settings_v1']);
        if(settings.isNotEmpty&&(jsonDecode(settings.single['payloadJson'] as String) as Map)['defaultCurrency']==title)
          throw StateError('Currency is the workspace default');
        final source=await t.query('legacy_operational_source',columns:['meta_json']);
        if(source.isNotEmpty){
          final meta=jsonDecode(source.single['meta_json'] as String) as Map;
          if((meta['workspace'] as Map?)?['defaultCurrency']==title)throw StateError('Currency is the imported workspace default');
        }
        // Preserve any currency referenced by archived stock or documents.
        for(final r in await t.query('legacy_operational_rows',columns:['row_json'],where:"collection IN ('inventory','ledger')")){
          final row=jsonDecode(r['row_json'] as String) as Map;
          if(row['currencyCode']==title||row['currency']==title)throw StateError('Currency is used in historical data');
        }
        currencies.removeAt(index);
        await write(t,'currencies',currencies);
        return {'id':id};
      });
  }

  static Future<Map<String,dynamic>> accountMeta(DatabaseExecutor t,String id)async{
    final rows=await t.query('erp_state',where:'stateKey = ?',whereArgs:['account_meta:$id']);
    if(rows.isNotEmpty)return jsonDecode(rows.single['payloadJson'] as String) as Map<String,dynamic>;
    final raw=await t.query('legacy_operational_rows',columns:['row_json'],where:'collection = ? AND record_id = ?',whereArgs:['accounts',id]);
    final original=raw.isEmpty?<String,dynamic>{}:jsonDecode(raw.single['row_json'] as String) as Map<String,dynamic>;
    return {for(final k in ['groupId','sortOrder','accountImage','settlement','documentNumberRequired','messageMethod','sendMode'])
      if(original.containsKey(k))k:original[k]};
  }

  static Future<void> saveAccountMeta(Transaction t,String id,Map<String,dynamic> input,String category,String currency)async{
    final meta=await accountMeta(t,id);
    for(final k in ['groupId','sortOrder','accountImage','settlement','documentNumberRequired','messageMethod','sendMode']){
      if(!input.containsKey(k))continue;
      final v=input[k];
      if(k=='groupId'){
        if(v!=null&&(v is! int||!(await read(t,'accountGroups')).any((g)=>g['id']==v&&g['category']==category&&g['currencyCode']==currency)))
          throw ArgumentError('Invalid account group');
      }else if(k=='sortOrder'){
        if(v is! int||v<0||v>2147483647)throw ArgumentError('Invalid sort order');
      }else if(k=='accountImage'){
        if(!['1','2','3'].contains(v))throw ArgumentError('Invalid account image');
      }else if(k=='messageMethod'){
        if(!['sms','whatsapp'].contains(v))throw ArgumentError('Invalid message method');
      }else if(k=='sendMode'){
        if(!['auto','confirm','never'].contains(v))throw ArgumentError('Invalid send mode');
      }else{
        if(v is! bool||(v==true&&meta[k]!=true))throw ArgumentError('This operational account policy is not implemented locally');
      }
      meta[k]=v;
    }
    if(meta.isEmpty)return;
    await t.insert('erp_state',{'stateKey':'account_meta:$id','payloadJson':jsonEncode(meta),
      'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
  }

  static Future<void> attachAccountMeta(DatabaseExecutor t,Map<String,dynamic> data)async{
    final byId={for(final a in (data['accounts'] as List).cast<Map<String,dynamic>>())a['id']:a};
    for(final r in await t.query('erp_state',where:"stateKey LIKE 'account_meta:%'")){
      final id=(r['stateKey'] as String).substring('account_meta:'.length);
      final row=byId[id];if(row==null)continue;
      row.addAll(jsonDecode(r['payloadJson'] as String) as Map<String,dynamic>);
    }
  }

  Future<void> deleteAccount(String workspace,String key,String id)async{
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'account.delete',
      payload:{'id':id},apply:(t)async{
        await requireLocal(t,workspace);
        final rows=await t.query('accounts',where:'id = ?',whereArgs:[id]);
        if(rows.length!=1)throw StateError('Account missing');
        if(rows.single['openingBalance']!=0||
            (await t.query('ledger_entries',where:'accountId = ? OR counterpartAccountId = ?',whereArgs:[id,id],limit:1)).isNotEmpty||
            (await t.query('journal_lines',where:'account_id = ?',whereArgs:[id],limit:1)).isNotEmpty||
            (await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['accounts',id],limit:1)).isNotEmpty)
          throw StateError('Account has financial or imported history');
        final roles=await t.query('erp_state',where:'stateKey = ?',whereArgs:['invoice_posting_roles_v1']);
        if(roles.isNotEmpty&&(jsonDecode(roles.single['payloadJson'] as String) as Map).values.any((v)=>v is Map&&v.values.contains(id)))
          throw StateError('Account is assigned to posting settings');
        await t.delete('erp_state',where:'stateKey = ?',whereArgs:['account_meta:$id']);
        await t.delete('accounts',where:'id = ?',whereArgs:[id]);
        return {'id':id};
      });
  }
}
