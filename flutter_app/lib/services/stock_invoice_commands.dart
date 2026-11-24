import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_document_commands.dart';

/// Restricted credit stock invoice engine. Money uses integer minor units;
/// only whole base units and one warehouse/currency per invoice are supported.
/// Returns reverse a complete original posting, never a free-form movement.
class StockInvoiceCommands {
  StockInvoiceCommands(this.local);
  final LocalDatabase local;
  static final _id = RegExp(r'^[A-Za-z0-9:_-]{1,150}$');
  static const int _max = 1000000000000;

  static String identity(Object? value) {
    if (value is! String || !_id.hasMatch(value)) throw ArgumentError('Invalid identity');
    return value;
  }
  static int money(Object? value) {
    if (value == 0) return 0;
    return LocalDocumentCommands.minor(value);
  }
  static int qty(Object? v) {
    if (v is! num || !v.isFinite || v < 0 || v > 10000000 || v != v.round()) {
      throw ArgumentError('Only whole base units are supported');
    }
    return v.toInt();
  }
  static int bounded(int v) {
    if (v < 0 || v > _max) throw ArgumentError('Amount outside supported range');
    return v;
  }
  static int valuation(Map<String,Object?> row) {
    final q = qty(row['quantity']);
    final cost = row['avgCost'];
    if (cost is! num || !cost.isFinite || cost < 0 ||
        cost * q * 100 > _max || (q == 0 && cost != 0)) {
      throw StateError('Invalid inventory valuation');
    }
    return bounded((cost * q * 100).round());
  }
  static int proportional(int value,int count,int total) =>
      ((BigInt.from(value)*BigInt.from(count)+BigInt.from(total ~/ 2)) ~/ BigInt.from(total)).toInt();

  static Future<Map<String,Object?>> account(Transaction t,String id,String currency) async {
    final rows = await t.query('accounts',where:'id = ?',whereArgs:[id]);
    if(rows.length != 1 || rows.single['currency'] != currency ||
        rows.single['isCashAccount'] == 1) throw StateError('Account missing, cash role or currency mismatch');
    return rows.single;
  }
  static Future<void> workspace(Transaction t,String w) async {
    final rows=await t.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding']);
    if(rows.isNotEmpty && rows.single['payloadJson'] != w) throw StateError('Workspace mismatch');
  }
  static Future<void> journal(Transaction t,String id,String currency,List<Map<String,dynamic>> legs) async {
    final debit=legs.fold<int>(0,(sum,l)=>sum+(l['debit_minor'] as int));
    final credit=legs.fold<int>(0,(sum,l)=>sum+(l['credit_minor'] as int));
    if(debit<=0 || debit!=credit || debit>_max*2) throw StateError('Unbalanced stock journal');
    await t.insert('journal_entries',{'id':id,'currency':currency,'created_at':DateTime.now().toUtc().toIso8601String()});
    for(var i=0;i<legs.length;i++){
      await t.insert('journal_lines',{'id':'$id:$i','journal_id':id,...legs[i]});
    }
  }
  static Map<String,dynamic> leg(String id,int amount,bool debit) => {
    'account_id':id,'debit_minor':debit?amount:0,'credit_minor':debit?0:amount,
  };
  static Future<void> numberAvailable(Transaction t,int n) async {
    if((await t.query('ledger_entries',where:'entryNumber = ?',whereArgs:[n],limit:1)).isNotEmpty) {
      throw StateError('Document number already exists');
    }
  }
  static int number(Object? n) {
    if(n is! int || n<1 || n>2147483647) throw ArgumentError('Invalid document number');
    return n;
  }
  static String date(Map<String,dynamic> input) {
    final d=LocalDocumentCommands.field(input,'entryDate',10);
    final parsed=DateTime.tryParse(d);
    if(parsed==null || d.length!=10 || parsed.toIso8601String().substring(0,10)!=d) throw ArgumentError('Invalid date');
    return d;
  }

  Future<String> post(String w,String key,Map<String,dynamic> input) async {
    identity(w);identity(key);
    final id=identity(input['id']??key);
    final original= input['originalInvoiceId'];
    final entryNumber=number(input['entryNumber']);
    final entryDate=date(input);
    if(input['kind']=='return') {
      return reverse(w,key,id,identity(original),entryNumber,entryDate);
    }
    final primary=identity(input['accountId']);
    final counterpart=identity(input['counterpartAccountId']);
    final warehouse=identity(input['warehouseId']);
    final sale=input['direction']=='debit';
    if(input['kind']!='invoice' || !['credit','debit'].contains(input['direction']) ||
        input['payment']!='credit' || input['invoiceContent']!='items' ||
        input['currency']!='ريال' || (input['exchangeRate']??1)!=1 ||
        input['cashboxId']!=null || input['settledOnReceipt']==true ||
        input['deleted']==true || (input['paidAmount']??0)!=0 ||
        (input['discount']??0)!=0 || original!=null ||
        input['reversedEntryId']!=null || input['reversalEntryId']!=null) {
      throw ArgumentError('Only local credit stock invoices in base currency are supported');
    }
    const currency='sar';
    final inventoryAccount=sale?identity(input['inventoryAccountId']):counterpart;
    final costAccount=sale?identity(input['costAccountId']):null;
    final tax=money(input['taxAmount']??0);
    final taxAccount=tax>0?identity(input['taxAccountId']):null;
    final ids=[primary,counterpart,if(sale)inventoryAccount,if(costAccount!=null)costAccount,if(taxAccount!=null)taxAccount];
    if(ids.toSet().length!=ids.length) throw ArgumentError('Accounting roles must use distinct accounts');
    final raw=input['lines'];
    if(raw is! List || raw.isEmpty || raw.length>100) throw ArgumentError('Invalid stock lines');
    final lines=<Map<String,dynamic>>[];
    final seen=<String>{};
    var net=0;
    for(final row in raw){
      if(row is! Map<String,dynamic>) throw ArgumentError('Invalid line');
      final item=identity(row['inventoryItemId']);
      final q=qty(row['quantity']);
      final price=money(row['price']);
      final discount=money(row['discount']??0);
      final gross=bounded(q*price);
      if(!seen.add(item)||q==0||price==0||discount>gross||
          (row['unitNum']??1)!=1||(row['bonus']??0)!=0||
          (row['warehouseId']??warehouse)!=warehouse||
          (row['lineKind']??'item')!='item') throw ArgumentError('Unsupported stock line');
      final total=gross-discount;
      if(money(row['total'])!=total) throw ArgumentError('Line total mismatch');
      net=bounded(net+total);
      lines.add({'item_id':item,'quantity':q,'price_minor':price,'discount_minor':discount,'net_minor':total});
    }
    final total=bounded(net+tax);
    if(net<=0||money(input['amount'])!=total) throw ArgumentError('Invoice total mismatch');
    final request=<String,dynamic>{'id':id,'accountId':primary,'counterpartAccountId':counterpart,
      'warehouseId':warehouse,'sale':sale,'currency':currency,'inventoryAccountId':inventoryAccount,
      'costAccountId':costAccount,'taxAccountId':taxAccount,'taxMinor':tax,'netMinor':net,
      'totalMinor':total,'entryNumber':entryNumber,'entryDate':entryDate,
      'typeLabel':LocalDocumentCommands.field(input,'typeLabel',60),
      'documentNumber':LocalDocumentCommands.field(input,'documentNumber',64),
      'details':LocalDocumentCommands.field(input,'details',600),'lines':lines};
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.post',
      payload:request,apply:(t)async{
        await workspace(t,w);await numberAvailable(t,entryNumber);
        final accounts=<String,Map<String,Object?>>{};
        for(final a in ids){accounts[a]=await account(t,a,currency);}
        final wh=await t.query('warehouses',where:'id = ?',whereArgs:[warehouse]);
        if(wh.length!=1) throw StateError('Warehouse missing');
        await t.insert('ledger_entries',{'id':id,'accountId':primary,'accountName':accounts[primary]!['name'],
          'counterpartAccountId':counterpart,'counterpartAccountName':accounts[counterpart]!['name'],
          'kind':'invoice','typeLabel':request['typeLabel'],'payment':'credit','direction':sale?'debit':'credit',
          'amount':total/100,'currency':currency,'exchangeRate':1,'details':request['details'],
          'documentNumber':request['documentNumber'],'warehouseId':warehouse,'warehouseName':wh.single['name'],
          'expenseCategory':'','entryNumber':entryNumber,'deleted':0,'entryDate':entryDate,
          'invoiceContent':'items','postingStatus':'posted'});
        await t.insert('stock_posting_documents',{'id':id,'document_json':jsonEncode(request)});
        var costTotal=0;
        for(var i=0;i<lines.length;i++){
          final l=lines[i],item=l['item_id'] as String,q=l['quantity'] as int;
          final rows=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,warehouse]);
          if(rows.length!=1) throw StateError('Stock item not in selected warehouse');
          final row=rows.single;
          final before=qty(row['quantity']),value=valuation(row);
          if(sale && before<q) throw StateError('Insufficient stock');
          final after=sale?before-q:before+q;
          qty(after);
          final cost=sale?proportional(value,q,before):l['net_minor'] as int;
          final next=bounded(sale?value-cost:value+cost);
          costTotal=bounded(costTotal+cost);
          final lineId='$id:$i';
          await t.update('inventory_items',{'quantity':after,'avgCost':after==0?0:next/after/100},where:'id = ?',whereArgs:[item]);
          await t.insert('invoice_lines',{'id':lineId,'ledger_id':id,'item_id':item,'quantity':q,'unit_price_minor':l['price_minor']});
          final detail={...l,'itemName':row['name'],'unit':row['unit'],'cost_minor':cost};
          await t.insert('stock_posting_lines',{'id':lineId,'document_id':id,'item_id':item,'quantity':q,
            'before_quantity':before,'after_quantity':after,'before_value':value,'after_value':next,'line_json':jsonEncode(detail)});
          await t.insert('stock_movements',{'id':lineId,'item_id':item,'quantity_delta':sale?-q:q,'operation_id':key});
        }
        final legs=<Map<String,dynamic>>[leg(primary,total,sale),leg(counterpart,net,!sale),
          if(taxAccount!=null)leg(taxAccount,tax,!sale),
          if(sale&&costTotal>0)leg(costAccount!,costTotal,true),
          if(sale&&costTotal>0)leg(inventoryAccount,costTotal,false)];
        await journal(t,id,currency,legs);
        return {'id':id};
      });
    return id;
  }

  Future<String> reverse(String w,String key,String id,String original,int entryNumber,String entryDate) async {
    if(id==original) throw ArgumentError('Return must be a new document');
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.reverse',
      payload:{'id':id,'originalInvoiceId':original,'entryNumber':entryNumber,'entryDate':entryDate},
      apply:(t)async{
        await workspace(t,w);await numberAvailable(t,entryNumber);
        final headers=await t.query('stock_posting_documents',where:'id = ? AND original_id IS NULL',whereArgs:[original]);
        final entries=await t.query('ledger_entries',where:'id = ? AND kind = ? AND deleted = 0',whereArgs:[original,'invoice']);
        if(headers.length!=1||entries.length!=1||entryDate.compareTo(entries.single['entryDate'] as String)<0) throw StateError('Original invoice not found or invalid date');
        if((await t.query('stock_posting_documents',where:'original_id = ?',whereArgs:[original])).isNotEmpty) throw StateError('Invoice already returned');
        final entry=entries.single;
        final details=jsonDecode(headers.single['document_json'] as String) as Map<String,dynamic>;
        final sale=details['sale']==true;
        final source=await t.query('stock_posting_lines',where:'document_id = ?',whereArgs:[original],orderBy:'rowid');
        if(source.isEmpty) throw StateError('Original lines missing');
        final sourceLegs=await t.query('journal_lines',where:'journal_id = ?',whereArgs:[original]);
        if(sourceLegs.length<2) throw StateError('Original journal missing');
        await t.insert('ledger_entries',{...entry,'id':id,'kind':'return','direction':sale?'credit':'debit',
          'typeLabel':sale?'مردود مبيعات':'مردود مشتريات','details':'مرتجع كامل للفاتورة $original',
          'documentNumber':entryNumber.toString(),'entryNumber':entryNumber,'entryDate':entryDate});
        await t.insert('stock_posting_documents',{'id':id,'original_id':original,'document_json':jsonEncode(details)});
        for(var i=0;i<source.length;i++){
          final l=source[i],item=l['item_id'] as String;
          final latest=await t.query('stock_posting_lines',where:'item_id = ?',whereArgs:[item],orderBy:'rowid DESC',limit:1);
          final stock=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,entry['warehouseId']]);
          if(latest.single['document_id']!=original||stock.length!=1||
              qty(stock.single['quantity'])!=l['after_quantity']||valuation(stock.single)!=l['after_value']) {
            throw StateError('Later stock movement exists; return requires reconciliation');
          }
          final q=l['before_quantity'] as int,value=l['before_value'] as int;
          final delta=q-(l['after_quantity'] as int);
          final lineId='$id:$i';
          final data=jsonDecode(l['line_json'] as String) as Map<String,dynamic>;
          await t.update('inventory_items',{'quantity':q,'avgCost':q==0?0:value/q/100},where:'id = ?',whereArgs:[item]);
          await t.insert('invoice_lines',{'id':lineId,'ledger_id':id,'item_id':item,'quantity':l['quantity'],'unit_price_minor':data['price_minor']});
          await t.insert('stock_posting_lines',{'id':lineId,'document_id':id,'item_id':item,'quantity':l['quantity'],
            'before_quantity':l['after_quantity'],'after_quantity':q,'before_value':l['after_value'],'after_value':value,'line_json':l['line_json']});
          await t.insert('stock_movements',{'id':lineId,'item_id':item,'quantity_delta':delta,'operation_id':key});
        }
        await journal(t,id,entry['currency'] as String,sourceLegs.map((l)=><String,dynamic>{
          'account_id':l['account_id'],'debit_minor':l['credit_minor'],'credit_minor':l['debit_minor'],
        }).toList());
        return {'id':id};
      });
    return id;
  }
}
