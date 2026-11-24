import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';
import 'local_database.dart';

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
  static const keys=['revenue','inventory','cost','expense','outputTax','inputTax'];
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
      final rows=await t.query('accounts',where:'isCashAccount = 0',orderBy:'name');
      return {'accounts':rows,'roles':await read(t)};
    });
  }

  Future<void> save(String currency,Map<String,String> selections)async{
    if(!currencyNames.containsKey(currency)||selections.keys.any((k)=>!keys.contains(k)))
      throw ArgumentError('Invalid invoice role settings');
    final db=await local.database;
    await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      final selected=<String,String>{};
      for(final e in selections.entries){
        if(e.value.isEmpty)continue;
        final rows=await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = 0',whereArgs:[e.value,currency]);
        if(rows.length!=1)throw ArgumentError('Invalid account role');
        selected[e.key]=e.value;
      }
      final data=await read(t);
      data[currency]=selected;
      await t.insert('erp_state',{'stateKey':stateKey,'payloadJson':jsonEncode(data),
        'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
    });
  }

  Future<Map<String,dynamic>> resolve(Map<String,dynamic> input)async{
    if(input['kind']!='invoice')return input;
    String? currency;
    for(final v in CurrencyCode.values){
      if(v!=CurrencyCode.currency2&&v.label==input['currency'])currency=v.name;
    }
    if(currency==null||!currencyNames.containsKey(currency))throw const InvoicePostingSetupRequired('عملة الفاتورة غير مدعومة للترحيل المحلي.');
    final db=await local.database;
    return db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      final data=await read(t),raw=data[currency];
      final settings=raw is Map?raw:<String,dynamic>{};
      final sale=input['direction']=='debit',stock=input['invoiceContent']=='items';
      final primary=input['accountId'];
      String role(String key,String label){
        final value=settings[key];
        if(value is! String||value.isEmpty)
          throw InvoicePostingSetupRequired('حدد $label مرة واحدة من الإعدادات ← حسابات الترحيل التلقائي.');
        return value;
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
          await LocalDatabase.requireVerifiedStock(t,id);
          final opening=await t.query('legacy_stock_openings',columns:['inventory_account_id'],where:'item_id = ?',whereArgs:[id]);
          if(opening.isEmpty){unassigned=true;}else{ids.add(opening.single['inventory_account_id'] as String);}
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
        if((await t.query('accounts',where:'id = ? AND currency = ? AND isCashAccount = 0',whereArgs:[id,currency])).length!=1)
          throw const InvoicePostingSetupRequired('أحد حسابات الترحيل غير موجود أو عملته غير مطابقة. راجع الإعدادات.');
      }
      return {...input,'counterpartAccountId':counter,
        if(stock&&sale)'inventoryAccountId':inventory,if(cost!=null)'costAccountId':cost,
        if(tax!=null)'taxAccountId':tax};
    });
  }
}
