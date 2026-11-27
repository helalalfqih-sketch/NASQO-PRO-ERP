import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'local_document_commands.dart';
import 'stock_quantity.dart';
import 'local_invoice_roles.dart';
import 'inventory_locations.dart';
import 'stock_quantity_approval_state.dart';

/// Cash/credit stock invoice engine. Money is integer minor units; stock uses
/// integer thousandths internally. Linked returns use original prices and costs.
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
    final q = StockQuantity.units(StockQuantity.balanceTicks(row['quantity']));
    final cost = row['avgCost'];
    if (cost is! num || !cost.isFinite || cost < 0 ||
        (cost * q * 100).abs() > _max || (q == 0 && cost != 0)) {
      throw StateError('Invalid inventory valuation');
    }
    return (cost * q * 100).round();
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
    final box=input['cashboxId'];
    final settlement=input['cashSettlementAccountId']==null?null:identity(input['cashSettlementAccountId']);
    if(input['kind']!='invoice' || !['credit','debit'].contains(input['direction']) ||
        !['cash','credit'].contains(input['payment']) || input['invoiceContent']!='items' ||
        input['currency']!='ريال' || (input['exchangeRate']??1)!=1 ||
        (box!=null&&settlement==null) || (!cash && (input['settledOnReceipt']==true||settlement!=null)) ||
        input['deleted']==true || (input['paidAmount']??0)!=0 ||
        (input['discount']??0)!=0 || original!=null ||
        input['reversedEntryId']!=null || input['reversalEntryId']!=null) {
      throw ArgumentError('Only local cash/credit stock invoices in base currency are supported');
    }
    const currency='sar';
    final inventoryAccount=sale?identity(input['inventoryAccountId']):counterpart;
    final costAccount=sale?identity(input['costAccountId']):null;
    final adjustment=input['inventoryAdjustmentAccountId']==null?null:identity(input['inventoryAdjustmentAccountId']);
    final tax=money(input['taxAmount']??0);
    final taxAccount=tax>0?identity(input['taxAccountId']):null;
    final rate=input['taxRateBps'];
    if(rate!=null&&(rate is! int||rate<0||rate>10000)) throw ArgumentError('Invalid tax rate');
    final ids=[primary,counterpart,if(sale)inventoryAccount,if(costAccount!=null)costAccount,if(taxAccount!=null)taxAccount,if(settlement!=null)settlement,if(adjustment!=null)adjustment];
    if(ids.toSet().length!=ids.length) throw ArgumentError('Accounting roles must use distinct accounts');
    final raw=input['lines'];
    if(raw is! List || raw.isEmpty || raw.length>100) throw ArgumentError('Invalid stock lines');
    final lines=<Map<String,dynamic>>[];
    final seen=<String>{};
    var net=0;
    for(final row in raw){
      if(row is! Map<String,dynamic>) throw ArgumentError('Invalid line');
      final item=identity(row['inventoryItemId']);
      final q=StockQuantity.ticks(row['quantity']);
      final price=money(row['price']);
      final discount=money(row['discount']??0);
      final unitNum=qty(row['unitNum']??1);
      final gross=StockQuantity.lineGrossMinor(q,price);
      if(!seen.add(item)||q==0||price==0||discount>gross||
          unitNum<1||unitNum>3||(row['bonus']??0)!=0||
          (row['warehouseId']??warehouse)!=warehouse||
          (row['lineKind']??'item')!='item') throw ArgumentError('Unsupported stock line');
      final total=gross-discount;
      if(money(row['total'])!=total) throw ArgumentError('Line total mismatch');
      net=bounded(net+total);
      lines.add({'item_id':item,'sold_quantity':StockQuantity.units(q),'unit_num':unitNum,'price_minor':price,'discount_minor':discount,'net_minor':total});
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
      'details':LocalDocumentCommands.field(input,'details',600),'lines':lines,
      if(adjustment!=null)'inventoryAdjustmentAccountId':adjustment,
      if(settlement!=null)'cashSettlementAccountId':settlement,if(box!=null)'cashboxId':box};
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.post',
      payload:request,apply:(t)async{
        await workspace(t,w);await numberAvailable(t,entryNumber);
        final accounts=<String,Map<String,Object?>>{};
        for(final a in ids){accounts[a]=await account(t,a,currency,cash:a==settlement||(cash&&settlement==null&&a==primary));}
        if(settlement!=null&&await LocalInvoiceRoles.cashAccount(t,currency,box)!=settlement)throw StateError('Cashbox configuration changed');
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
        var costTotal=0,varianceTotal=0;
        for(var i=0;i<lines.length;i++){
          final l=lines[i],sold=StockQuantity.ticks(l['sold_quantity']);
          var item=l['item_id'] as String;
          final unitNum=l['unit_num'] as int;
          if(!sale)item=await InventoryLocations.purchase(t,item,warehouse);
          final rows=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,warehouse]);
          if(rows.length!=1) throw StateError('Stock item not in selected warehouse');
          final pending=sale?null:await StockQuantityApprovalState.pending(t,item,inventoryAccountId:inventoryAccount,entryDate:entryDate);
          if(pending==null)await LocalDatabase.requireVerifiedStock(t,item);
          await LocalDatabase.requireOpeningStockAccount(t,item,inventoryAccount,entryDate);
          final row=rows.single;
          final savedUnits=await t.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[item]);
          final units=savedUnits.isEmpty?<String,dynamic>{}:jsonDecode(savedUnits.single['settings_json'] as String) as Map<String,dynamic>;
          final factor=unitNum==1?1:unitNum==2?qty(units['count2']):qty(qty(units['count2'])*qty(units['count3']));
          if(units['isActive']==false)throw StateError('Stock item is inactive');
          final unit=unitNum==1?row['unit']:units['unit$unitNum'];
          if(factor<1||unit is! String||unit.isEmpty) throw ArgumentError('Undefined item unit');
          final q=StockQuantity.boundedTicks(sold*factor);
          final before=StockQuantity.balanceTicks(row['quantity']),value=pending?.valueMinor??valuation(row);
          if(sale && before<q) throw StateError('Insufficient stock');
          final after=sale?before-q:before+q;
          StockQuantity.boundedBalanceTicks(after);
          final cost=sale?proportional(value,q,before):l['net_minor'] as int;
          var next=sale?value-cost:value+cost;
          var variance=0;
          if(!sale&&before<0){
            if(adjustment==null)throw StateError('Inventory adjustment account missing');
            // Keep a deficit at its previous unit cost; value newly available
            // stock at this receipt's cost. The difference is an explicit GL leg.
            final target=after==0?0:after<0?(value*after/before).round():proportional(cost,after,q);
            variance=target-next;next=target;
          }
          if(next.abs()>_max||(after==0&&next!=0)||after*next<0)throw StateError('Invalid stock balance');
          varianceTotal+=variance;
          costTotal=bounded(costTotal+cost);
          final lineId='$id:$i';
          final actual=StockQuantity.units(q),afterUnits=StockQuantity.units(after);
          await t.update('inventory_items',{'quantity':afterUnits,'avgCost':pending!=null||after==0?0:next/afterUnits/100},where:'id = ?',whereArgs:[item]);
          await t.insert('invoice_lines',{'id':lineId,'ledger_id':id,'item_id':item,'quantity':actual,'unit_price_minor':l['price_minor']});
          final detail={...l,'item_id':item,'quantity':actual,'unit_factor':factor,'itemName':row['name'],'unit':unit,'cost_minor':cost,
            if(variance!=0)'inventory_variance_minor':variance};
          await t.insert('stock_posting_lines',{'id':lineId,'document_id':id,'item_id':item,'quantity':actual,
            'before_quantity':StockQuantity.units(before),'after_quantity':afterUnits,'before_value':value,'after_value':next,'line_json':jsonEncode(detail)});
          await t.insert('stock_movements',{'id':lineId,'item_id':item,'quantity_delta':StockQuantity.units(sale?-q:q),'operation_id':key});
        }
        final legs=<Map<String,dynamic>>[leg(primary,total,sale),leg(counterpart,net,!sale),
          if(taxAccount!=null)leg(taxAccount,tax,!sale),
          if(sale&&costTotal>0)leg(costAccount!,costTotal,true),
          if(sale&&costTotal>0)leg(inventoryAccount,costTotal,false),
          if(settlement!=null)leg(primary,total,!sale),if(settlement!=null)leg(settlement,total,sale)];
        if(varianceTotal!=0)legs.addAll([leg(inventoryAccount,varianceTotal.abs(),varianceTotal>0),leg(adjustment!,varianceTotal.abs(),varianceTotal<0)]);
        await journal(t,id,currency,legs);
        await LocalInvoiceRoles.recordCashbox(t,id,box);
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
        final item=identity(l['itemId']),q=StockQuantity.ticks(l['quantity']);
        if(q==0||selection.containsKey(item)) throw ArgumentError('Invalid return quantity');
        selection[item]=q;
      }
    }
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'stock.invoice.reverse',
      payload:{'id':id,'originalInvoiceId':original,'entryNumber':entryNumber,'entryDate':entryDate,
        if(requested!=null)'returnLines':{for(final e in selection.entries)e.key:StockQuantity.units(e.value)}},
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
        final already=await t.rawQuery('SELECT l.item_id,l.quantity FROM stock_posting_lines l JOIN stock_posting_documents d ON d.id=l.document_id WHERE d.return_original_id = ?',[original]);
        final used=<String,int>{};
        for(final row in already){
          final item=row['item_id'] as String;
          used[item]=(used[item]??0)+StockQuantity.ticks(row['quantity']);
        }
        final remainingSelection=Map<String,int>.from(selection);
        final changes=<Map<String,dynamic>>[];
        var net=0,tax=0,cost=0,netPrefix=0,varianceTotal=0;
        final adjustment=details['inventoryAdjustmentAccountId'] as String?;
        final originalNet=details['netMinor'] as int,originalTax=details['taxMinor'] as int;
        for(final line in source){
          final item=line['item_id'] as String;
          final data=jsonDecode(line['line_json'] as String) as Map<String,dynamic>;
          final factor=(data['unit_factor'] as int?)??1;
          final originalBase=StockQuantity.ticks(line['quantity']);
          final sold=data['sold_quantity']==null?originalBase:StockQuantity.ticks(data['sold_quantity']);
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
          final discountPart=portion((data['discount_minor'] as int?)??0);
          final base=q*factor;
          final stock=await t.query('inventory_items',where:'id = ? AND warehouseId = ?',whereArgs:[item,entry['warehouseId']]);
          if(stock.length!=1) throw StateError('Stock item missing');
          final pending=sale?null:await StockQuantityApprovalState.pending(t,item,
            inventoryAccountId:identity(details['inventoryAccountId']),entryDate:entryDate);
          if(pending==null)await LocalDatabase.requireVerifiedStock(t,item);
          await LocalDatabase.requireOpeningStockAccount(t,item,identity(details['inventoryAccountId']),entryDate);
          final before=StockQuantity.balanceTicks(stock.single['quantity']),beforeValue=pending?.valueMinor??valuation(stock.single);
          if(pending!=null&&base>pending.purchasedTicks)throw StateError('Return exceeds valued purchases');
          final after=sale?before+base:before-base;
          var variance=0;
          if(!sale&&data['inventory_variance_minor'] is int){
            final originalVariance=data['inventory_variance_minor'] as int;
            variance=-originalVariance.sign*portion(originalVariance.abs());
          }
          var afterValue=(sale?beforeValue+costPart:beforeValue-costPart)+variance;
          if(!sale&&adjustment!=null&&pending==null){
            final originalBefore=StockQuantity.balanceTicks(line['before_quantity']);
            if(after<0&&originalBefore>=0)throw StateError('Insufficient stock for purchase return');
            final target=after==0?0:after<0?((line['before_value'] as int)*after/originalBefore).round():afterValue<0?(beforeValue*after/before).round():afterValue;
            variance+=target-afterValue;afterValue=target;
          }
          if((after<0&&adjustment==null)||after*afterValue<0||(after==0&&afterValue!=0)||afterValue.abs()>_max) throw StateError('Purchase return needs stock or cost variance reconciliation');
          StockQuantity.boundedBalanceTicks(after);
          varianceTotal+=variance;
          net=bounded(net+netPart);tax=bounded(tax+taxPart);cost=bounded(cost+costPart);
          final lineData=<String,dynamic>{...data,'quantity':StockQuantity.units(base),'sold_quantity':StockQuantity.units(q),'unit_factor':factor,
            'net_minor':netPart,'tax_minor':taxPart,'cost_minor':costPart,'discount_minor':discountPart,
            'inventory_variance_minor':variance};
          changes.add({'item':item,'before':before,'after':after,'beforeValue':beforeValue,'afterValue':afterValue,'data':lineData,'costPending':pending!=null});
        }
        if(remainingSelection.isNotEmpty||changes.isEmpty||net+tax<=0) throw ArgumentError('No eligible return lines');
        final total=bounded(net+tax);
        final primary=identity(details['accountId']),counter=identity(details['counterpartAccountId']);
        final cash=entry['payment']=='cash';
        final settlement=details['cashSettlementAccountId'] as String?;
        await account(t,primary,entry['currency'] as String,cash:cash&&settlement==null);
        if(settlement!=null)await account(t,settlement,entry['currency'] as String,cash:true);
        await account(t,counter,entry['currency'] as String);
        final legs=<Map<String,dynamic>>[leg(primary,total,!sale),if(net>0)leg(counter,net,sale),
          if(settlement!=null)leg(primary,total,sale),if(settlement!=null)leg(settlement,total,!sale)];
        if(tax>0){final a=identity(details['taxAccountId']);await account(t,a,entry['currency'] as String);legs.add(leg(a,tax,sale));}
        if(sale&&cost>0){
          final a=identity(details['costAccountId']),b=identity(details['inventoryAccountId']);
          await account(t,a,entry['currency'] as String);await account(t,b,entry['currency'] as String);
          legs.addAll([leg(a,cost,false),leg(b,cost,true)]);
        }
        if(varianceTotal!=0){
          if(adjustment==null)throw StateError('Inventory adjustment account missing');
          await account(t,adjustment,entry['currency'] as String);
          legs.addAll([leg(identity(details['inventoryAccountId']),varianceTotal.abs(),varianceTotal>0),leg(adjustment,varianceTotal.abs(),varianceTotal<0)]);
        }
        final header={...details,'id':id,'originalInvoiceId':original,'entryNumber':entryNumber,'entryDate':entryDate,
          'documentNumber':entryNumber.toString(),
          'netMinor':net,'taxMinor':tax,'totalMinor':total,'lines':changes.map((x)=>x['data']).toList()};
        await t.insert('ledger_entries',{...entry,'id':id,'kind':'returnEntry','direction':sale?'credit':'debit','amount':total/100,
          'typeLabel':sale?'مردود مبيعات':'مردود مشتريات','details':'مرتجع مرتبط للفاتورة $original',
          'documentNumber':entryNumber.toString(),'entryNumber':entryNumber,'entryDate':entryDate});
        await t.insert('stock_posting_documents',{'id':id,'return_original_id':original,'document_json':jsonEncode(header)});
        for(var i=0;i<changes.length;i++){
          final c=changes[i],item=c['item'] as String,d=c['data'] as Map<String,dynamic>;
          final before=c['before'] as int,after=c['after'] as int,afterValue=c['afterValue'] as int;
          final lineId='$id:$i';
          final afterUnits=StockQuantity.units(after);
          await t.update('inventory_items',{'quantity':afterUnits,'avgCost':c['costPending']==true||after==0?0:afterValue/afterUnits/100},where:'id = ?',whereArgs:[item]);
          await t.insert('invoice_lines',{'id':lineId,'ledger_id':id,'item_id':item,'quantity':d['quantity'],'unit_price_minor':d['price_minor']});
          await t.insert('stock_posting_lines',{'id':lineId,'document_id':id,'item_id':item,'quantity':d['quantity'],
            'before_quantity':StockQuantity.units(before),'after_quantity':afterUnits,'before_value':c['beforeValue'],'after_value':afterValue,'line_json':jsonEncode(d)});
          await t.insert('stock_movements',{'id':lineId,'item_id':item,'quantity_delta':StockQuantity.units(after-before),'operation_id':key});
        }
        await journal(t,id,entry['currency'] as String,legs);
        await LocalInvoiceRoles.recordCashbox(t,id,details['cashboxId']);
        return {'id':id};
      });
    return id;
  }
}
