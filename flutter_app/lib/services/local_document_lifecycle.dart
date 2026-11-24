import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';
import 'local_database.dart';
import 'local_document_commands.dart';
import 'stock_invoice_commands.dart';
import 'stock_quantity.dart';

/// Draft quotes/orders never post accounting or inventory. Posted documents
/// may change descriptive metadata only; financial changes require reversal.
class LocalDocumentLifecycle {
  LocalDocumentLifecycle(this.local);
  final LocalDatabase local;
  static const prefix='document_draft:';
  static bool isDraftKind(Object? k)=>k=='quote'||k=='order';
  static String identity(Object? v)=>StockInvoiceCommands.identity(v);
  static String field(Map<String,dynamic> p,String k,int max,{String fallback=''})=>
    LocalDocumentCommands.field(p,k,max,fallback:fallback);
  static int money(Object? v)=>StockInvoiceCommands.money(v??0);

  static Future<Map<String,dynamic>?> draft(DatabaseExecutor db,String id)async{
    final rows=await db.query('erp_state',where:'stateKey = ?',whereArgs:['$prefix$id']);
    if(rows.isEmpty)return null;
    return Map<String,dynamic>.from(jsonDecode(rows.single['payloadJson'] as String) as Map);
  }

  static Future<Map<String,Object?>> _row(Transaction t,String id)async{
    final rows=await t.query('ledger_entries',where:'id = ?',whereArgs:[id]);
    if(rows.length!=1)throw StateError('المستند غير موجود.');
    return rows.single;
  }

  static Future<void> _unpostedDraft(Transaction t,String id,Map<String,Object?> row)async{
    if(!isDraftKind(row['kind'])||row['postingStatus']!='draft'||await draft(t,id)==null||
       (await t.query('journal_entries',where:'id = ?',whereArgs:[id])).isNotEmpty||
       (await t.query('stock_posting_documents',where:'id = ?',whereArgs:[id])).isNotEmpty||
       (await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['ledger',id])).isNotEmpty){
      throw StateError('التعديل والحذف المالي للمستندات المرحّلة أو المستوردة يتطلب مسار عكس معتمد.');
    }
  }

  Future<String> saveDraft(String w,String key,Map<String,dynamic> p,{String? editingId})async{
    identity(w);identity(key);
    final id=identity(editingId??p['id']??key);
    final kind=p['kind'],payment=p['payment'],direction=p['direction'],content=p['invoiceContent'];
    final account=identity(p['accountId']);
    final wh=content=='items'?identity(p['warehouseId']):'';
    if(!isDraftKind(kind)||!['credit','cash'].contains(payment)||!['debit','credit'].contains(direction)||
        !['free','items'].contains(content)||p['deleted']==true||
        !CurrencyCode.values.any((v)=>v!=CurrencyCode.currency2&&v.label==p['currency'])||
        (p['exchangeRate']??1)!=1||money(p['paidAmount'])!=0||money(p['discount'])!=0)
      throw ArgumentError('Invalid draft');
    final currency=CurrencyCode.values.firstWhere((v)=>v.label==p['currency']).name;
    final number=StockInvoiceCommands.number(p['entryNumber']),date=StockInvoiceCommands.date(p);
    final amount=LocalDocumentCommands.minor(p['amount']),tax=money(p['taxAmount']);
    final box=p['cashboxId'];
    if(box!=null&&(box is! int||box<=0||payment!='cash'))throw ArgumentError('Invalid draft cashbox');
    final raw=p['lines']??[];
    if(raw is! List||raw.length>150||(content=='items'&&raw.isEmpty)||(content=='free'&&raw.isNotEmpty))
      throw ArgumentError('Invalid draft lines');
    final lines=<Map<String,dynamic>>[];
    var net=0;
    for(final value in raw){
      if(value is! Map<String,dynamic>)throw ArgumentError('Invalid draft line');
      final item=identity(value['inventoryItemId']);
      if(value['warehouseId']!=null&&value['warehouseId']!=wh)throw ArgumentError('Warehouse mismatch');
      final qty=StockQuantity.ticks(value['quantity']),price=money(value['price']),discount=money(value['discount']);
      final unit=value['unitNum']??1;
      final gross=StockQuantity.lineGrossMinor(qty,price);
      final total=gross-discount;
      if(qty<=0||total<0||money(value['total'])!=total||![1,2,3].contains(unit)||money(value['bonus'])!=0)
        throw ArgumentError('Invalid line calculation');
      final name=field(value,'itemName',200).trim();
      if(name.isEmpty)throw ArgumentError('Missing item name');
      net=StockInvoiceCommands.bounded(net+total);
      lines.add({'id':lines.length+1,'lineKind':'item','inventoryItemId':item,'warehouseId':wh,
        'itemName':name,'sku':'','warehouseName':'','quantity':StockQuantity.units(qty),
        'price':price/100,'discount':discount/100,'total':total/100,'bonus':0,
        'unit':field(value,'unit',40,fallback:'حبة'),'unitNum':unit,
        'details':field(value,'details',600),'expiryDate':''});
    }
    if(content=='items'&&net+tax!=amount||content=='free'&&tax!=0)
      throw ArgumentError('Draft total mismatch');
    final rate=p['taxRateBps'];
    if(rate!=null&&(rate is! int||rate<0||rate>10000||
        tax!=StockInvoiceCommands.proportional(net,rate,10000)))throw ArgumentError('Tax mismatch');
    final request=<String,dynamic>{'id':id,'kind':kind,'accountId':account,'payment':payment,
      'direction':direction,'currency':currency,'warehouseId':wh,'invoiceContent':content,
      'entryNumber':number,'entryDate':date,'amountMinor':amount,'taxMinor':tax,
      'details':field(p,'details',600),'documentNumber':field(p,'documentNumber',64),
      'expenseCategory':field(p,'expenseCategory',60),'lines':lines,if(box!=null)'cashboxId':box,
      if(rate!=null)'taxRateBps':rate};
    await local.commitOperation(workspaceId:w,operationId:key,operationType:editingId==null?'draft.create':'draft.update',
      payload:request,apply:(t)async{
        await StockInvoiceCommands.workspace(t,w);
        if(editingId!=null){
          final row=await _row(t,id);
          await _unpostedDraft(t,id,row);
          if(row['deleted']==1||row['kind']!=kind)throw StateError('استعد المسودة أولًا ولا تغير نوعها.');
        }
        final a=await StockInvoiceCommands.account(t,account,currency);
        final warehouses=wh.isEmpty?<Map<String,Object?>>[]:await t.query('warehouses',where:'id = ?',whereArgs:[wh]);
        if(wh.isNotEmpty&&warehouses.length!=1)throw StateError('المخزن غير موجود.');
        if((await t.query('ledger_entries',where:'entryNumber = ? AND id != ?',whereArgs:[number,id])).isNotEmpty)
          throw StateError('رقم المستند مستخدم.');
        for(final line in lines){
          final items=await t.query('inventory_items',where:'id = ?',whereArgs:[line['inventoryItemId']]);
          if(items.length!=1||items.single['warehouseId']!=wh)throw StateError('الصنف غير موجود في المخزن المحدد.');
        }
        final row=<String,Object?>{'id':id,'accountId':account,'accountName':a['name'],
          'counterpartAccountId':'','counterpartAccountName':'','kind':kind,
          'typeLabel':kind=='quote'?'عرض سعر':'طلبية جديدة','payment':payment,'direction':direction,
          'amount':amount/100,'currency':currency,'exchangeRate':1,'details':request['details'],
          'documentNumber':request['documentNumber'],'warehouseId':wh,
          'warehouseName':warehouses.isEmpty?'':warehouses.single['name'],'expenseCategory':request['expenseCategory'],
          'entryNumber':number,'entryDate':date,'deleted':0,'invoiceContent':content,'postingStatus':'draft'};
        if(editingId==null){await t.insert('ledger_entries',row);}
        else{
          await t.update('ledger_entries',row,where:'id = ?',whereArgs:[id]);
          await t.delete('invoice_lines',where:'ledger_id = ?',whereArgs:[id]);
        }
        for(var i=0;i<lines.length;i++){
          final line=lines[i];
          await t.insert('invoice_lines',{'id':'$id:$i','ledger_id':id,'item_id':line['inventoryItemId'],
            'quantity':line['quantity'],'unit_price_minor':money(line['price'])});
        }
        await t.insert('erp_state',{'stateKey':'$prefix$id','payloadJson':jsonEncode({
          'lines':lines,'taxAmount':tax/100,if(box!=null)'cashboxId':box,
          'settledOnReceipt':false,if(rate!=null)'taxRateBps':rate}),
          'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
        return {'id':id};
      });
    return id;
  }

  Future<void> amendMetadata(String w,String key,String id,Map<String,dynamic> p)async{
    identity(w);identity(key);identity(id);
    if(p.keys.any((k)=>!['accountId','accountName','details','documentNumber'].contains(k))||
        !p.containsKey('details'))throw StateError('المستند المرحّل: يمكن تغيير البيان والمرجع فقط.');
    final account=identity(p['accountId']),details=field(p,'details',600);
    final reference=p.containsKey('documentNumber')?field(p,'documentNumber',64):null;
    await local.commitOperation(workspaceId:w,operationId:key,operationType:'document.metadata',
      payload:{'id':id,'accountId':account,'details':details,if(reference!=null)'documentNumber':reference},apply:(t)async{
        await StockInvoiceCommands.workspace(t,w);
        final row=await _row(t,id);
        if(row['accountId']!=account||row['deleted']==1||row['postingStatus']!='posted'||
            !['invoice','voucher'].contains(row['kind'])||
            (await t.query('journal_entries',where:'id = ?',whereArgs:[id])).isEmpty||
            (await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['ledger',id])).isNotEmpty)
          throw StateError('التعديل الوصفي متاح فقط للمستندات المحلية المرحّلة وغير المحذوفة.');
        await t.update('ledger_entries',{'details':details,if(reference!=null)'documentNumber':reference},where:'id = ?',whereArgs:[id]);
        return {'id':id};
      });
  }

  Future<void> trash(String w,String key,String id,{bool? deleted,bool permanent=false})async{
    identity(w);identity(key);identity(id);
    if(!permanent&&deleted==null)throw ArgumentError('Missing trash state');
    await local.commitOperation(workspaceId:w,operationId:key,operationType:permanent?'draft.delete':'draft.trash',
      payload:{'id':id,if(!permanent)'deleted':deleted},apply:(t)async{
        await StockInvoiceCommands.workspace(t,w);
        final row=await _row(t,id);
        await _unpostedDraft(t,id,row);
        if(permanent){
          if(row['deleted']!=1)throw StateError('انقل المسودة إلى السلة أولًا.');
          await t.delete('invoice_lines',where:'ledger_id = ?',whereArgs:[id]);
          await t.delete('erp_state',where:'stateKey = ?',whereArgs:['$prefix$id']);
          await t.delete('ledger_entries',where:'id = ?',whereArgs:[id]);
        }else{
          await t.update('ledger_entries',{'deleted':deleted==true?1:0},where:'id = ?',whereArgs:[id]);
        }
        return {'id':id};
      });
  }

  static Future<void> attach(DatabaseExecutor t,Map<String,dynamic> data)async{
    final ledger=(data['ledger'] as List).cast<Map<String,dynamic>>();
    final entries={for(final e in ledger)e['id']:e};
    for(final row in await t.query('erp_state',where:'stateKey LIKE ?',whereArgs:['$prefix%'])){
      final id=(row['stateKey'] as String).substring(prefix.length),e=entries[id];
      if(e==null||!isDraftKind(e['kind'])||e['postingStatus']!='draft')continue;
      final d=Map<String,dynamic>.from(jsonDecode(row['payloadJson'] as String) as Map);
      for(final k in ['taxAmount','taxRateBps','cashboxId','settledOnReceipt']){
        if(d.containsKey(k))e[k]=d[k];
      }
      e['lineCount']=(d['lines'] as List).length;
      e['localDraft']=true;
    }
  }
}
