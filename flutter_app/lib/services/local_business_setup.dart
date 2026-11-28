import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';
import 'local_workspace_settings.dart';
import 'automatic_posting_setup.dart';

class LocalBusinessSetup {
  static const actions = {'sale','purchase','inventory','accounts','backup'};
  static const zones = {'UTC','Asia/Aden','Asia/Riyadh','Asia/Dubai','Asia/Baghdad','Asia/Amman','Asia/Beirut','Africa/Cairo','Africa/Khartoum','Africa/Casablanca','Europe/London','Europe/Paris','America/New_York'};
  static void keys(dynamic value, Set<String> expected) {
    if(value is! Map<String,dynamic> || value.length != expected.length || value.keys.any((k)=>!expected.contains(k))) throw ArgumentError('Invalid setup fields');
  }
  static void text(dynamic v, int max, {bool empty=false}) {
    if(v is! String || v.length>max || !empty && v.trim().isEmpty) throw ArgumentError('Invalid setup text');
  }
  static void profile(dynamic p) {
    keys(p, {'version','completedAt','businessType','language','timezone','fiscalYearStartMonth','branch','adminName','valuationMethod','defaultUnit','salesPayment','purchasePayment','taxRateBps','backupReminderOnExit','notificationsEnabled'});
    if(p['version']!=1 || !{'retail','wholesale','services','mixed'}.contains(p['businessType']) || p['language']!='ar' ||
      !zones.contains(p['timezone']) || p['fiscalYearStartMonth'] is! int || p['fiscalYearStartMonth']<1 || p['fiscalYearStartMonth']>12 ||
      p['valuationMethod']!='weighted-average' || !{'cash','credit'}.contains(p['salesPayment']) || !{'cash','credit'}.contains(p['purchasePayment']) ||
      p['taxRateBps'] is! int || p['taxRateBps']<0 || p['taxRateBps']>10000 || p['backupReminderOnExit'] is! bool || p['notificationsEnabled'] is! bool) throw ArgumentError('Invalid setup values');
    text(p['completedAt'],40,empty:true);
    if(p['completedAt']!='' && DateTime.tryParse(p['completedAt'])==null) throw ArgumentError('Invalid setup date');
    text(p['adminName'],100); text(p['defaultUnit'],32); keys(p['branch'],{'id','name'});
    if(p['branch']['id']!='main') throw ArgumentError('Invalid branch'); text(p['branch']['name'],100);
  }
  static Future<void> preferences(DatabaseExecutor t, dynamic p, {bool references=true}) async {
    keys(p, {'version','theme','homeColumns','defaultBranchId','defaultWarehouseId','defaultCashboxId','defaultCurrency','favoriteActions','recentActions'});
    if(p['version']!=1 || !{'light','dark','system'}.contains(p['theme']) || !{'auto',1,2,3}.contains(p['homeColumns']) || !{'','main'}.contains(p['defaultBranchId']) ||
      p['defaultCashboxId']!=null && (p['defaultCashboxId'] is! int || p['defaultCashboxId']<=0)) throw ArgumentError('Invalid preferences');
    text(p['defaultWarehouseId'],150,empty:true); text(p['defaultCurrency'],64);
    for(final k in ['favoriteActions','recentActions']) { final a=p[k]; if(a is! List || a.length>5 || a.toSet().length!=a.length || a.any((x)=>!actions.contains(x))) throw ArgumentError('Invalid shortcuts'); }
    if(!references) return;
    if(!(await LocalMasterCatalog.read(t,'currencies')).any((c)=>c['name']==p['defaultCurrency'])) throw ArgumentError('Invalid preferred currency');
    if(p['defaultWarehouseId']!='' && !(await LocalWorkspaceSettings.records(t,'warehouses','warehouses')).containsKey(p['defaultWarehouseId'])) throw ArgumentError('Invalid preferred warehouse');
    if(p['defaultCashboxId']!=null && !(await LocalMasterCatalog.read(t,'cashboxes')).any((b)=>b['id']==p['defaultCashboxId'] && b['currencyCode']==p['defaultCurrency'] && b['state']!=0 && b['isActive']!=false)) throw ArgumentError('Invalid preferred cashbox');
  }
  static Future<void> recent(LocalDatabase local, dynamic action) async {
    if(!actions.contains(action)) throw ArgumentError('Invalid shortcut');
    final db=await local.database;
    await db.transaction((t) async {
      await LocalDatabase.requireLiveWorkspace(t);
      final settings=await LocalWorkspaceSettings.read(t);
      final p=settings['userPreferences']; if(p is! Map) return;
      p['recentActions']=[action,...(p['recentActions'] as List).where((a)=>a!=action)].take(5).toList();
      await t.insert('erp_state',{'stateKey':LocalWorkspaceSettings.stateKey,'payloadJson':jsonEncode(settings),'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
    });
  }
  static Future<void> complete(LocalDatabase local, String workspace, Map<String,dynamic> input) async {
    if(workspace!='local-erp-workspace') throw ArgumentError('Invalid workspace');
    keys(input,{'companyName','currency','warehouseName','cashboxName','bankName','profile','preferences'});
    for(final k in ['companyName','warehouseName','cashboxName']) { text(input[k],100); }
    text(input['bankName'],100,empty:true); profile(input['profile']);
    if(input['profile']['completedAt']!='' || input['currency']!=input['preferences']?['defaultCurrency']) throw ArgumentError('Invalid setup');
    await local.commitOperation(workspaceId:workspace,operationId:'business-setup-v1',operationType:'workspace.setup',payload:input,apply:(t) async {
      await LocalMasterCatalog.requireLocal(t,workspace);
      await preferences(t,input['preferences'],references:false);
      if(!(await LocalMasterCatalog.read(t,'currencies')).any((c)=>c['name']==input['currency'])) throw ArgumentError('Invalid currency');
      final old=await LocalWorkspaceSettings.read(t);
      if(old['businessProfile']!=null) throw StateError('اكتملت التهيئة؛ عدّل التفضيلات من الإعدادات.');
      // Use the same provisioning as ordinary startup, with zero opening balances.
      await AutomaticPostingSetup.defaults(t);
      final settings=await LocalWorkspaceSettings.read(t);
      final boxes=await LocalMasterCatalog.read(t,'cashboxes');
      final warehouses=await t.query('warehouses');
      final currency=input['currency'] as String, code=LocalMasterCatalog.currencyCodes[currency];
      if(code==null) throw ArgumentError('Unsupported posting currency');
      final bankName=(input['bankName'] as String).trim();
      if(bankName.isNotEmpty) {
        final found=boxes.where((b)=>b['name']==bankName);
        if(found.isNotEmpty && (found.first['currencyCode']!=currency || found.first['boxType']!=2)) throw ArgumentError('Bank name already used');
        if(found.isEmpty) {
          final id=await LocalMasterCatalog.allocateId(t,'cashboxes',boxes);
          final account=await AutomaticPostingSetup.account(t,code,'cashbox:$id','حساب $bankName',cash:true);
          boxes.add({'id':id,'name':bankName,'currencyCode':currency,'isActive':true,'state':1,'boxType':2,'accountId':account});
          await LocalMasterCatalog.write(t,'cashboxes',boxes);
        }
      }
      // Names entered at first use may replace only pristine automatically created masters.
      final empty=(await t.query('ledger_entries',limit:1)).isEmpty && (await t.query('inventory_items',limit:1)).isEmpty && (await t.query('legacy_operational_source',limit:1)).isEmpty;
      if(empty) {
        await t.update('warehouses',{'name':input['warehouseName'].trim()},where:'id = ?',whereArgs:['nasqo-default-warehouse']);
        final ordinary=boxes.where((b)=>b['currencyCode']==currency && b['boxType']!=2 && b['state']!=0);
        if(ordinary.isNotEmpty && (ordinary.first['name'] as String).startsWith('الصندوق الرئيسي')) {
          ordinary.first['name']=input['cashboxName'].trim(); await LocalMasterCatalog.write(t,'cashboxes',boxes);
        }
      }
      final prefs=Map<String,dynamic>.from(input['preferences'] as Map), refs=settings['referenceDefaults'] as Map;
      if(prefs['defaultWarehouseId']=='') prefs['defaultWarehouseId']=refs['warehouseId']??warehouses.first['id'];
      prefs['defaultCashboxId']??=refs['systemCashboxes']?[currency]??boxes.firstWhere((b)=>b['currencyCode']==currency && b['state']!=0)['id'];
      await preferences(t,prefs);
      settings.addAll({'companyName':input['companyName'].trim(),'defaultCurrency':currency,'userPreferences':prefs,
        'businessProfile':{...input['profile'] as Map,'completedAt':DateTime.now().toUtc().toIso8601String()}});
      await t.insert('erp_state',{'stateKey':LocalWorkspaceSettings.stateKey,'payloadJson':jsonEncode(settings),'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
      await AutomaticPostingSetup.ensure(t,code);
      return {'completed':true};
    });
  }
}
