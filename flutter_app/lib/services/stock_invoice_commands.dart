import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_document_commands.dart';

/// Cash/credit stock invoice engine. Money is integer minor units; stock uses
/// whole base units. Linked returns use the original invoice's prices and costs.
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

  static Future<Map<String,Object?>> account(Transaction t,String id,String currency,{bool cash=false}) async {
    final rows = await t.query('accounts',where:'id = ?',whereArgs:[id]);
    if(rows.length != 1 || rows.single['currency'] != currency ||
        (rows.single['isCashAccount'] == 1) != cash) throw StateError('Account missing, cash role or currency mismatch');
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
      return reverse(w,key,id,identity(original),entryNumber,entryDate,input['returnLines']);
    }
    final primary=identity(input['accountId']);
    final counterpart=identity(input['counterpartAccountId']);
    final warehouse=identity(input['warehouseId']);
    final sale=input['direction']=='debit';
    final cash=input['payment']=='cash';
    if(input['kind']!='invoice' || !['credit','debit'].contains(input['direction']) ||
        !['cash','credit'].contains(input['payment']) || input['invoiceContent']!='items' ||
        input['currency']!='ريال' || (input['exchangeRate']??1)!=1 ||
        input['cashboxId']!=null || (!cash && input['settledOnReceipt']==true) ||
        input['deleted']==true || (input['paidAmount']??0)!=0 ||
        (input['discount']??0)!=0 || original!=null ||
        input['reversedEntryId']!=null || input['reversalEntryId']!=null) {
      throw ArgumentError('Only local cash/credit stock invoices in base currency are supported');
    }
    const currency='sar';
    final inventoryAccount=sale?identity(input['inventoryAccountId']):counterpart;
    final costAccount=sale?identity(input['costAccountId']):null;
    final tax=money(input['taxAmount']??0);
    final taxAccount=tax>0?identity(input['taxAccountId']):null;
    final rate=input['taxRateBps'];
    if(rate!=null&&(rate is! int||rate<0||rate>10000)) throw ArgumentError('Invalid tax rate');
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
      final unitNum=qty(row['unitNum']??1);
      final gross=bounded(q*price);
      if(!seen.add(item)||q==0||price==0||discount>gross||
          unitNum<1||unitNum>3||(row['bonus']??0)!=0||
          (row['warehouseId']??warehouse)!=warehouse||
          (row['lineKind']??'item')!='item') throw ArgumentError('Unsupported stock line');
      final total=gross-discount;
      if(money(row['total'])!=total) throw ArgumentError('Line total mismatch');
      net=bounded(net+total);
      lines.add({'item_id':item,'sold_quantity':q,'unit_num':unitNum,'price_minor':price,'discount_minor':discount,'net_minor':total});
    }
    if(rate is int && proportional(net,rate,10000)!=tax) throw ArgumentError('Calculated tax mismatch');
    final total=bounded(net+tax);
    if(net<=0||money(input['amount'])!=total) throw ArgumentError('Invoice total mismatch');
    final request=<String,dynamic>{'id':id,'accountId':primary,'counterpartAccountId':counterpart,
      'warehouseId':warehouse,'sale':sale,'currency':currency,'payment':cash?'cash':'credit','inventoryAccountId':inventoryAccount,
      'costAccountId':costAccount,'taxAccountId':taxAccount,'taxMinor':tax,'taxRateBps':rate,'netMinor':net,
      'totalMinor':total,'entryNumber':entryNumber,'entryDate':entryDate,
      'typeLabel':LocalDocumentCommands.field(input,'typeLabel',60),
      'documentNumber':LocalDocumentCommands.field(input,'documentNumber',64),
      'details':LocalDocumentCommands.field(input,'details',600),'lines':lines};
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.post',
      payload:request,apply:(t)async{
        await workspace(t,w);await numberAvailable(t,entryNumber);
        final accounts=<String,Map<String,Object?>>{};
        for(final a in ids){accounts[a]=await account(t,a,currency,cash:cash&&a==primary);}
        final wh=await t.query('warehouses',where:'id = ?',whereArgs:[warehouse]);
        if(wh.length!=1) throw StateError('Warehouse missing');
        await t.insert('ledger_entries',{'id':id,'accountId':primary,'accountName':accounts[primary]!['name'],
          'counterpartAccountId':counterpart,'counterpartAccountName':accounts[counterpart]!['name'],
          'kind':'invoice','typeLabel':request['typeLabel'],'payment':cash?'cash':'credit','direction':sale?'debit':'credit',
          'amount':total/100,'currency':currency,'exchangeRate':1,'details':request['details'],
          'documentNumber':request['documentNumber'],'warehouseId':warehouse,'warehouseName':wh.single['name'],
          'expenseCategory':'','entryNumber':entryNumber,'deleted':0,'entryDate':entryDate,
          'invoiceContent':'items','postingStatus':'posted'});
        await t.insert('stock_posting_documents',{'id':id,'document_json':jsonEncode(request)});
        var costTotal=0;
        for(var i=0;i<lines.length;i++){
          final l=lines[i],item=l['item_id'] as String,sold=l['sold_quantity'] as int;
          final unitNum=l['unit_num'] as int;
          final rows=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,warehouse]);
          if(rows.length!=1) throw StateError('Stock item not in selected warehouse');
          final row=rows.single;
          final savedUnits=await t.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[item]);
          final units=savedUnits.isEmpty?<String,dynamic>{}:jsonDecode(savedUnits.single['settings_json'] as String) as Map<String,dynamic>;
          final factor=unitNum==1?1:qty(units['count$unitNum']);
          final unit=unitNum==1?row['unit']:units['unit$unitNum'];
          if(factor<1||unit is! String||unit.isEmpty) throw ArgumentError('Undefined item unit');
          final q=qty(sold*factor);
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
          final detail={...l,'quantity':q,'unit_factor':factor,'itemName':row['name'],'unit':unit,'cost_minor':cost};
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

  /// Partial returns in original invoice units. Sales restore original COGS;
  /// purchase returns remove original net acquisition cost from current WAC.
  /// If that would create negative inventory value or stranded value at zero
  /// quantity, fail closed until a variance-account workflow exists.
  Future<String> reverse(String w,String key,String id,String original,int entryNumber,String entryDate,Object? requested) async {
    if(id==original) throw ArgumentError('Return must be a new document');
    final selection=<String,int>{};
    if(requested!=null){
      if(requested is! List||requested.isEmpty||requested.length>100) throw ArgumentError('Invalid return lines');
      for(final l in requested){
        if(l is! Map) throw ArgumentError('Invalid return line');
        final item=identity(l['itemId']),q=qty(l['quantity']);
        if(q==0||selection.containsKey(item)) throw ArgumentError('Invalid return quantity');
        selection[item]=q;
      }
    }
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.reverse',
      payload:{'id':id,'originalInvoiceId':original,'entryNumber':entryNumber,'entryDate':entryDate,
        if(requested!=null)'returnLines':selection},
      apply:(t)async{
        await workspace(t,w);await numberAvailable(t,entryNumber);
        final headers=await t.query('stock_posting_documents',where:'id = ? AND original_id IS NULL AND return_original_id IS NULL',whereArgs:[original]);
        final entries=await t.query('ledger_entries',where:'id = ? AND kind = ? AND deleted = 0',whereArgs:[original,'invoice']);
        if(headers.length!=1||entries.length!=1||entryDate.compareTo(entries.single['entryDate'] as String)<0) throw StateError('Original invoice not found or invalid date');
        if((await t.query('stock_posting_documents',where:'original_id = ?',whereArgs:[original])).isNotEmpty) throw StateError('Legacy invoice already returned in full');
        final entry=entries.single;
        final details=jsonDecode(headers.single['document_json'] as String) as Map<String,dynamic>;
        final sale=details['sale']==true;
        final source=await t.query('stock_posting_lines',where:'document_id = ?',whereArgs:[original],orderBy:'rowid');
        if(source.isEmpty) throw StateError('Original lines missing');
        final already=await t.rawQuery('SELECT l.item_id, SUM(l.quantity) AS quantity FROM stock_posting_lines l JOIN stock_posting_documents d ON d.id=l.document_id WHERE d.return_original_id = ? GROUP BY l.item_id',[original]);
        final used={for(final row in already)row['item_id'] as String:qty(row['quantity'])};
        final remainingSelection=Map<String,int>.from(selection);
        final changes=<Map<String,dynamic>>[];
        var net=0,tax=0,cost=0,netPrefix=0;
        final originalNet=details['netMinor'] as int,originalTax=details['taxMinor'] as int;
        for(final line in source){
          final item=line['item_id'] as String;
          final data=jsonDecode(line['line_json'] as String) as Map<String,dynamic>;
          final factor=(data['unit_factor'] as int?)??1;
          final originalBase=qty(line['quantity']);
          final sold=(data['sold_quantity'] as int?)??originalBase;
          final usedBase=used[item]??0;
          if(factor<1||sold*factor!=originalBase||usedBase%factor!=0||usedBase>originalBase) throw StateError('Invalid return history');
          final prev=usedBase~/factor;
          final q=requested==null?sold-prev:remainingSelection.remove(item)??0;
          final lineNet=data['net_minor'] as int;
          final lineTax=proportional(originalTax,netPrefix+lineNet,originalNet)-proportional(originalTax,netPrefix,originalNet);
          netPrefix+=lineNet;
          if(q==0) continue;
          if(q<0||q>sold-prev) throw StateError('Return exceeds original quantity');
          int portion(int value)=>proportional(value,prev+q,sold)-proportional(value,prev,sold);
          final netPart=portion(lineNet),taxPart=portion(lineTax),costPart=portion(data['cost_minor'] as int);
          final discountPart=portion(data['discount_minor'] as int);
          final base=q*factor;
          final stock=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,entry['warehouseId']]);
          if(stock.length!=1) throw StateError('Stock item missing');
          final before=qty(stock.single['quantity']),beforeValue=valuation(stock.single);
          final after=sale?before+base:before-base;
          final afterValue=sale?beforeValue+costPart:beforeValue-costPart;
          if(after<0||afterValue<0||(after==0&&afterValue!=0)) throw StateError('Purchase return needs stock or cost variance reconciliation');
          qty(after);bounded(afterValue);
          net=bounded(net+netPart);tax=bounded(tax+taxPart);cost=bounded(cost+costPart);
          final lineData=<String,dynamic>{...data,'quantity':base,'sold_quantity':q,'unit_factor':factor,
            'net_minor':netPart,'tax_minor':taxPart,'cost_minor':costPart,'discount_minor':discountPart};
          changes.add({'item':item,'before':before,'after':after,'beforeValue':beforeValue,'afterValue':afterValue,'data':lineData});
        }
        if(remainingSelection.isNotEmpty||changes.isEmpty||net+tax<=0) throw ArgumentError('No eligible return lines');
        final total=bounded(net+tax);
        final primary=identity(details['accountId']),counter=identity(details['counterpartAccountId']);
        final cash=entry['payment']=='cash';
        await account(t,primary,entry['currency'] as String,cash:cash);
        await account(t,counter,entry['currency'] as String);
        final legs=<Map<String,dynamic>>[leg(primary,total,!sale),if(net>0)leg(counter,net,sale)];
        if(tax>0){final a=identity(details['taxAccountId']);await account(t,a,entry['currency'] as String);legs.add(leg(a,tax,sale));}
        if(sale&&cost>0){
          final a=identity(details['costAccountId']),b=identity(details['inventoryAccountId']);
          await account(t,a,entry['currency'] as String);await account(t,b,entry['currency'] as String);
          legs.addAll([leg(a,cost,false),leg(b,cost,true)]);
        }
        final header={...details,'id':id,'originalInvoiceId':original,'entryNumber':entryNumber,'entryDate':entryDate,
          'netMinor':net,'taxMinor':tax,'totalMinor':total,'lines':changes.map((x)=>x['data']).toList()};
        await t.insert('ledger_entries',{...entry,'id':id,'kind':'return','direction':sale?'credit':'debit','amount':total/100,
          'typeLabel':sale?'مردود مبيعات':'مردود مشتريات','details':'مرتجع مرتبط للفاتورة $original',
          'documentNumber':entryNumber.toString(),'entryNumber':entryNumber,'entryDate':entryDate});
        await t.insert('stock_posting_documents',{'id':id,'return_original_id':original,'document_json':jsonEncode(header)});
        for(var i=0;i<changes.length;i++){
          final c=changes[i],item=c['item'] as String,d=c['data'] as Map<String,dynamic>;
          final before=c['before'] as int,after=c['after'] as int,afterValue=c['afterValue'] as int;
          final lineId='$id:$i';
          await t.update('inventory_items',{'quantity':after,'avgCost':after==0?0:afterValue/after/100},where:'id = ?',whereArgs:[item]);
          await t.insert('invoice_lines',{'id':lineId,'ledger_id':id,'item_id':item,'quantity':d['quantity'],'unit_price_minor':d['price_minor']});
          await t.insert('stock_posting_lines',{'id':lineId,'document_id':id,'item_id':item,'quantity':d['quantity'],
            'before_quantity':before,'after_quantity':after,'before_value':c['beforeValue'],'after_value':afterValue,'line_json':jsonEncode(d)});
          await t.insert('stock_movements',{'id':lineId,'item_id':item,'quantity_delta':after-before,'operation_id':key});
        }
        await journal(t,id,entry['currency'] as String,legs);
        return {'id':id};
      });
    return id;
  }
}
