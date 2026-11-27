import 'dart:convert';
import 'automatic_stock_baseline.dart';
import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';
import 'local_database.dart';
import 'local_master_catalog.dart';
import 'stock_quantity_approval_state.dart';
import 'automatic_posting_setup.dart';

/// A business chooses posting accounts once. Imported customer/supplier
/// categories are not sufficient evidence of a GL role.
class InvoicePostingSetupRequired implements Exception {
  const InvoicePostingSetupRequired(this.message);
  final String message;
}

class LocalInvoiceRoles {
  LocalInvoiceRoles(this.local);
  final LocalDatabase local;
  static const stateKey='invoice_posting_roles_v1';
  static const keys=['revenue','inventory','cost','expense','outputTax','inputTax','balanceVoucher','cash','opening','adjustment'];
  static bool isCashRole(String key)=>key=='cash'||key.startsWith('cashbox:');
  static bool isKnownRole(String key)=>keys.contains(key)||RegExp(r'^cashbox:[1-9][0-9]{0,15}$').hasMatch(key);
  static const currencyNames={'sar':'ريال','usd':'دولار','eur':'يورو'};

  static Future<Map<String,dynamic>> read(DatabaseExecutor t)async{
    final rows=await t.query('erp_state',where:'stateKey = ?',whereArgs:[stateKey]);
    if(rows.isEmpty)return <String,dynamic>{};
    final decoded=jsonDecode(rows.single['payloadJson'] as String);
    if(decoded is! Map<String,dynamic>)throw StateError('Invalid invoice settings');
    return decoded;
  }

  Future<Map<String,dynamic>> load()async{
    final db=await local.database;
    return db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      for(final code in currencyNames.keys){
        if((await LocalMasterCatalog.read(t,'currencies')).any((c)=>c['name']==currencyNames[code]))await AutomaticPostingSetup.ensure(t,code);
      }
      final rows=await t.query('accounts',orderBy:'name');
      return {'accounts':rows,'roles':await read(t),'cashboxes':await cashboxes(t)};
    });
  }

  Future<void> save(String currency,Map<String,String> selections)async{
    if(!currencyNames.containsKey(currency)||selections.keys.any((k)=>!isKnownRole(k)))
      throw ArgumentError('Invalid invoice role settings');
    final db=await local.database;
    await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      final selected=<String,String>{};
      final boxes=await cashboxes(t);
      for(final e in selections.entries){
        if(e.value.isEmpty)continue;
        if(e.key.startsWith('cashbox:')&&!boxes.any((b)=>'cashbox:${b['id']}'==e.key&&b['currencyCode']==currencyNames[currency]))
          throw ArgumentError('Invalid cashbox role');
        final rows=await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = ?',whereArgs:[e.value,currency,isCashRole(e.key)?1:0]);
        if(rows.length!=1)throw ArgumentError('Invalid account role');
        selected[e.key]=e.value;
      }
      final explicit=selected.entries.where((e)=>e.key.startsWith('cashbox:')).map((e)=>e.value).toList();
      if(explicit.toSet().length!=explicit.length)throw ArgumentError('Each cashbox needs a distinct cash account');
      final data=await read(t);
      data[currency]=selected;
      await t.insert('erp_state',{'stateKey':stateKey,'payloadJson':jsonEncode(data),
        'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
      await AutomaticPostingSetup.ensure(t,currency);
    });
  }

  static Future<List<Map<String,dynamic>>> cashboxes(DatabaseExecutor t)async{
    return LocalMasterCatalog.read(t,'cashboxes');
  }

  static Future<String> cashAccount(DatabaseExecutor t,String currency,Object? cashboxId)async{
    await AutomaticPostingSetup.ensure(t,currency);
    final roles=(await read(t))[currency];
    final key=cashboxId==null?'cash':'cashbox:$cashboxId';
    if(cashboxId!=null){
      if(cashboxId is! int||cashboxId<=0||
          !(await cashboxes(t)).any((b)=>b['id']==cashboxId&&b['currencyCode']==currencyNames[currency]&&b['isActive']!=false&&b['state']!=0))
        throw const InvoicePostingSetupRequired('اختر صندوقًا نشطًا من نفس العملة.');
    }
    final id=roles is Map?roles[key]:null;
    if(id is! String||id.isEmpty||
        (await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = 1',whereArgs:[id,currency])).length!=1)
      throw const InvoicePostingSetupRequired('حدد حساب الصندوق مرة واحدة من الإعدادات ← حسابات الترحيل التلقائي.');
    return id;
  }

  /// Link the exact selected cashbox to a posted document without changing
  /// the legacy ledger schema. The record is included in native backups.
  static Future<void> recordCashbox(Transaction t,String id,Object? cashboxId)async{
    if(cashboxId==null)return;
    await t.insert('erp_state',{'stateKey':'posted_cashbox:$id','payloadJson':jsonEncode(cashboxId),
      'updatedAt':DateTime.now().toUtc().toIso8601String()});
  }
  static Future<void> attachCashboxes(DatabaseExecutor t,Map<String,dynamic> snapshot)async{
    final ledger={for(final e in (snapshot['ledger'] as List).cast<Map<String,dynamic>>())e['id']:e};
    for(final r in await t.query('erp_state',where:"stateKey LIKE 'posted_cashbox:%'")){
      final id=(r['stateKey'] as String).substring('posted_cashbox:'.length);
      final entry=ledger[id];
      if(entry==null)continue;
      final box=jsonDecode(r['payloadJson'] as String);
      if(box is int){entry['cashboxId']=box;entry['localCashboxPosting']=true;}
    }
  }

  Future<Map<String,dynamic>> resolve(Map<String,dynamic> input)async{
    if(!['invoice','voucher'].contains(input['kind']))return input;
    String? currency;
    for(final v in CurrencyCode.values){
      if(v!=CurrencyCode.currency2&&v.label==input['currency'])currency=v.name;
    }
    if(currency==null||!currencyNames.containsKey(currency))throw const InvoicePostingSetupRequired('عملة الفاتورة غير مدعومة للترحيل المحلي.');
    final code=currency;
    final db=await local.database;
    return db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      await AutomaticPostingSetup.ensure(t,code);
      final data=await read(t),raw=data[code];
      final settings=raw is Map?raw:<String,dynamic>{};
      final sale=input['direction']=='debit',stock=input['invoiceContent']=='items';
      final primary=input['accountId'];
      String role(String key,String label){
        final value=settings[key];
        if(value is! String||value.isEmpty)
          throw InvoicePostingSetupRequired('حدد $label مرة واحدة من الإعدادات ← حسابات الترحيل التلقائي.');
        return value;
      }
      final cash=input['payment']=='cash';
      if(input['kind']=='voucher'){
        final counter=cash?await cashAccount(t,code,input['cashboxId']):role('balanceVoucher','حساب تسوية السندات');
        if(counter==primary)throw const InvoicePostingSetupRequired('اختر حسابًا مختلفًا عن حساب الصندوق أو التسوية.');
        return {...input,'counterpartAccountId':counter,if(!cash)'cashboxId':null};
      }
      String? inventory;
      if(stock){
        // The inventory account chosen at a verified warehouse opening is
        // authoritative. A mixed-account invoice must be split, not guessed.
        final ids=<String>{};
        final lines=input['lines'];
        if(lines is! List)throw ArgumentError('Invalid invoice lines');
        var unassigned=false;
        for(final line in lines){
          if(line is! Map||line['inventoryItemId'] is! String)throw ArgumentError('Invalid invoice line');
          final id=line['inventoryItemId'] as String;
          PendingPurchaseBalance? pending;
          try{
            if(!sale)pending=await StockQuantityApprovalState.pending(t,id);
            if(pending==null)await LocalDatabase.requireVerifiedStock(t,id);
          }
          on StateError catch(e){throw InvoicePostingSetupRequired(e.message.toString());}
          if(pending?.inventoryAccountId!=null){ids.add(pending!.inventoryAccountId!);continue;}
          final opening=await t.query('legacy_stock_openings',columns:['inventory_account_id'],where:'item_id = ?',whereArgs:[id]);
          final baseline=opening.isEmpty?await AutomaticStockBaseline.forItem(t,id):opening.single;
          if(baseline==null){unassigned=true;}else{ids.add(baseline['inventory_account_id'] as String);}
        }
        if(unassigned||ids.isEmpty)ids.add(role('inventory','حساب أصل المخزون'));
        if(ids.length!=1)throw const InvoicePostingSetupRequired('تتبع الأصناف حسابات مخزون مختلفة. افصلها في فواتير مستقلة.');
        inventory=ids.single;
      }
      final counter=sale?role('revenue','حساب إيراد المبيعات'):stock?inventory!:role('expense','حساب مصروف المشتريات الحرة');
      final cost=stock&&sale?role('cost','حساب تكلفة البضاعة المباعة'):null;
      final taxValue=input['taxAmount']??0;
      final tax=stock&&taxValue is num&&taxValue>0?role(sale?'outputTax':'inputTax',sale?'حساب ضريبة المبيعات':'حساب ضريبة المشتريات'):null;
      final roles=[counter,if(stock&&sale)inventory!,if(cost!=null)cost,if(tax!=null)tax];
      if(roles.contains(primary)||roles.toSet().length!=roles.length)
        throw const InvoicePostingSetupRequired('حسابات الترحيل لهذه الفاتورة متداخلة. راجع إعدادات الحسابات التلقائية.');
      for(final id in roles){
        if((await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = 0',whereArgs:[id,code])).length!=1)
          throw const InvoicePostingSetupRequired('أحد حسابات الترحيل غير موجود أو عملته غير مطابقة. راجع الإعدادات.');
      }
      final settlement=cash?await cashAccount(t,code,input['cashboxId']):null;
      if(settlement!=null&&(settlement==primary||roles.contains(settlement)))
        throw const InvoicePostingSetupRequired('اختر حساب العميل أو المورد، وليس حساب الصندوق.');
      return {...input,'counterpartAccountId':counter,
        if(settlement!=null)'cashSettlementAccountId':settlement,
        if(stock&&sale)'inventoryAccountId':inventory,if(cost!=null)'costAccountId':cost,
        if(tax!=null)'taxAccountId':tax,
        if(stock&&!sale)'inventoryAdjustmentAccountId':role('adjustment','حساب فروق المخزون')};
    });
  }
}
