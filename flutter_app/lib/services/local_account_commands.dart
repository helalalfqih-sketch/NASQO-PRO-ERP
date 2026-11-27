import 'tabular_import_limits.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';
import '../models/erp_models.dart';

class LocalAccountCommands {
  LocalAccountCommands(this.local);
  final LocalDatabase local;
  static final _identity = RegExp(r'^[A-Za-z0-9:_-]{1,150}$');

  /// Catalog cards only. Opening balances require their own balanced document.
  Future<Map<String,dynamic>> importCards(String workspace,String key,List<dynamic> items)async{
    if(!_identity.hasMatch(workspace)||!_identity.hasMatch(key)||key.length>100||items.isEmpty||items.length>maxTabularImportRows)
      throw ArgumentError('Invalid account import');
    final rows=<Map<String,dynamic>>[];
    final seen=<String>{};
    for(final raw in items){
      if(raw is! Map<String,dynamic>||raw.keys.any((k)=>!['name','phone','category','currency','openingBalance','openingDirection'].contains(k)))throw ArgumentError('Invalid account row');
      final name=raw['name'],phone=raw['phone']??'',category=raw['category'],currency=raw['currency'];
      final direction=raw['openingDirection']??'credit';
      if(name is! String||name.trim().isEmpty||name.length>100||phone is! String||phone.length>32||
          !AccountCategory.values.any((v)=>v.name==category)||
          !CurrencyCode.values.any((v)=>v!=CurrencyCode.currency2&&v.label==currency)||
          (raw['openingBalance']??0)!=0||!['credit','debit'].contains(direction))
        throw ArgumentError('Unsupported account fields');
      if(!seen.add('$category|${name.trim()}'))throw ArgumentError('Duplicate account row');
      rows.add({'name':name.trim(),'phone':phone,'category':category,
        'currency':CurrencyCode.values.firstWhere((v)=>v.label==currency).name,
        'openingBalance':0.0,'openingDirection':direction,'creditLimit':0.0,'note':'','isCashAccount':0});
    }
    return local.commitOperation(workspaceId:workspace,operationId:key,operationType:'accounts.import',payload:{'accounts':rows},apply:(txn)async{
      final binding=await txn.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding']);
      if(binding.isNotEmpty&&binding.single['payloadJson']!=workspace)throw StateError('Workspace mismatch');
      var inserted=0,skipped=0;
      var code=(await txn.rawQuery('SELECT COALESCE(MAX(codeNumber),0) AS n FROM accounts')).single['n'] as int;
      for(var i=0;i<rows.length;i++){
        final row=rows[i];
        final existing=await txn.query('accounts',where:'name = ? AND category = ?',whereArgs:[row['name'],row['category']]);
        if(existing.isNotEmpty){
          if(existing.any((r)=>r['currency']!=row['currency']))throw StateError('حساب موجود بالاسم نفسه وعملة مختلفة؛ راجع الملف. لم تُحفظ الدفعة.');
          skipped++;continue;
        }
        final id='account_${key}_$i';
        await txn.insert('accounts',{'id':id,...row,'codeNumber':++code});inserted++;
      }
      return {'inserted':inserted,'skipped':skipped,'total':rows.length};
    });
  }

  /// Edits are intentionally limited to metadata. Account classification,
  /// currency, opening balance and cash role must not rewrite financial history.
  Future<String> save(String workspace, String key,
      Map<String,dynamic> input, {String? accountId}) async {
    if (!_identity.hasMatch(workspace) || !_identity.hasMatch(key) ||
        (accountId != null && !_identity.hasMatch(accountId))) {
      throw ArgumentError('Invalid identity');
    }
    final name = input['name'];
    final phone = input['phone'] ?? '';
    final note = input['note'] ?? '';
    final limit = input['creditLimit'] ?? 0;
    final category = input['category'];
    final currency = input['currency'];
    final cash = input['isCashAccount'] ?? false;
    final opening = input['openingBalance'] ?? 0;
    final openingDirection = input['openingDirection'] ?? 'credit';
    if (name is! String || name.trim().isEmpty || name.length > 100 ||
        phone is! String || phone.length > 32 ||
        note is! String || note.length > 300 ||
        limit is! num || !limit.isFinite || limit < 0 || limit > 1000000000000 ||
        cash is! bool || !AccountCategory.values.any((v) => v.name == category) ||
        !CurrencyCode.values.any((v) => v != CurrencyCode.currency2 && v.label == currency) ||
        opening is! num || !opening.isFinite ||
        !['credit','debit'].contains(openingDirection)) {
      throw ArgumentError('Unsupported account fields');
    }
    final currencyCode = CurrencyCode.values.firstWhere((v) => v.label == currency).name;
    final id = accountId ?? 'account_$key';
    if (id.length > 150) throw ArgumentError('Account ID too long');
    final request = <String,dynamic>{
      'id': id, 'name': name.trim(), 'phone': phone, 'note': note,
      'creditLimit': limit.toDouble(), 'category': category,
      'currency': currencyCode, 'isCashAccount': cash ? 1 : 0,
      'openingBalance': opening.toDouble(), 'openingDirection': openingDirection,
    };
    final isNew = accountId == null;
    final result = await local.commitOperation(
      workspaceId: workspace, operationId: key,
      operationType: isNew ? 'account.create' : 'account.update',
      payload: {...request,for(final k in ['groupId','sortOrder','accountImage','settlement','documentNumberRequired','messageMethod','sendMode'])
        if(input.containsKey(k))k:input[k]},
      syncPayload: (result) => Map<String,dynamic>.from(result['sync'] as Map),
      apply: (txn) async {
        final binding = await txn.query('erp_state', where:'stateKey = ?',
          whereArgs:['sync_workspace_binding']);
        if (binding.isNotEmpty && binding.single['payloadJson'] != workspace) {
          throw StateError('Workspace mismatch');
        }
        final duplicates = await txn.query('accounts',
          where:'name = ? AND category = ? AND id <> ?',
          whereArgs:[name.trim(),category,id]);
        if (duplicates.isNotEmpty) throw ArgumentError('Duplicate account');
        if (isNew) {
          if (opening != 0) throw ArgumentError('Opening balance must be posted separately');
          final max = (await txn.rawQuery('SELECT COALESCE(MAX(codeNumber),0) AS n FROM accounts')).single['n'] as int;
          final row = <String,dynamic>{...request,'codeNumber':max+1};
          await txn.insert('accounts',row);
          await LocalMasterCatalog.saveAccountMeta(txn,id,input,category as String,currency as String);
          return {'id':id,'sync':row};
        }
        final rows = await txn.query('accounts',where:'id = ?',whereArgs:[id]);
        if (rows.length != 1) throw ArgumentError('Account does not exist');
        final before = Map<String,dynamic>.from(rows.single);
        for (final field in ['category','currency','isCashAccount','openingBalance','openingDirection']) {
          if (before[field] != request[field]) throw ArgumentError('Financial attributes are immutable');
        }
        final after = <String,dynamic>{...before,
          for(final field in ['name','phone','note','creditLimit']) field:request[field]};
        await txn.update('accounts',after,where:'id = ?',whereArgs:[id]);
        await LocalMasterCatalog.saveAccountMeta(txn,id,input,category as String,currency as String);
        return {'id':id,'sync':{'id':id,'before':before,'after':after}};
      },
    );
    return result['id'] as String;
  }
}
