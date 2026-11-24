import 'stock_invoice_commands.dart';
import 'stock_quantity.dart';

/// The draft is only a calculation aid. No database write occurs here.
class LegacyStockBatch {
  static String normalize(String input){
    const arabic='٠١٢٣٤٥٦٧٨٩',persian='۰۱۲۳۴۵۶۷۸۹';
    var out=input.trim().replaceAll('٫','.').replaceAll('٬','');
    for(var i=0;i<10;i++){
      out=out.replaceAll(arabic[i],i.toString()).replaceAll(persian[i],i.toString());
    }
    return out;
  }

  static List<Map<String,dynamic>> parse(String text,Iterable<Map<String,dynamic>> products,
      String warehouse,Map<String,dynamic> shared){
    final ids=products.map((p)=>p['id']).toSet(),seen=<String>{};
    final rows=<Map<String,dynamic>>[];
    if(text.length>500000)throw const FormatException('ملف الجرد كبير جدًا');
    final lines=text.split(RegExp(r'\r?\n'));
    for(var i=0;i<lines.length;i++){
      final line=lines[i].trim();
      if(line.isEmpty)continue;
      final cells=line.split(RegExp(r'[\t,;]'));
      if(cells.length!=3)throw FormatException('السطر ${i+1}: المطلوب معرف الصنف، الكمية، إجمالي التكلفة');
      final id=normalize(cells[0]);
      if(!ids.contains(id)||!seen.add(id))throw FormatException('السطر ${i+1}: الصنف مفقود أو مكرر');
      final q=num.tryParse(normalize(cells[1])),v=num.tryParse(normalize(cells[2]));
      try{
        final qty=StockQuantity.normalized(q),minor=StockInvoiceCommands.money(v);
        if((qty==0&&minor!=0)||(qty>0&&minor<=0))throw ArgumentError('Invalid value');
        rows.add({...shared,'sourceItemId':id,'warehouseId':warehouse,'quantity':qty,'totalValue':minor/100});
      }catch(_){throw FormatException('السطر ${i+1}: الكمية أو إجمالي التكلفة غير صالح');}
    }
    if(rows.isEmpty||rows.length>2000)throw const FormatException('أدخل من 1 إلى 2000 صنف في الدفعة');
    return rows;
  }

  /// One row per original product and warehouse. Missing evidence never
  /// becomes an assumed zero. The suggestion remains an editable draft.
  static List<Map<String,dynamic>> reviewRows(Iterable<Map<String,dynamic>> products,
      Iterable<Map<String,dynamic>> openings,String warehouse){
    final existing={for(final o in openings)
      if(o['warehouse_id']==warehouse)o['source_item_id']:o};
    final result=<Map<String,dynamic>>[];
    for(final p in products){
      final invoices=p['legacyInvoiceQtyByWarehouse'],transfers=p['legacyTransferNetByWarehouse'];
      final present=(invoices is Map&&invoices.containsKey(warehouse))||(transfers is Map&&transfers.containsKey(warehouse));
      final historical=present?(invoices is Map?(invoices[warehouse] as num? ??0):0)+(transfers is Map?(transfers[warehouse] as num? ??0):0):null;
      final opened=existing[p['id']];
      String reason='';
      num? quantity,value;
      if(opened!=null){
        reason='approved';quantity=opened['quantity'] as num;value=(opened['value_minor'] as num)/100;
      }else if(p['currencyCode']!='ريال'){reason='currency';}
      else if(p['legacyTransferIncomplete']==true){reason='transfer';}
      else if(historical==null){reason='no_history';}
      else if(!historical.isFinite||historical<0){reason='negative';}
      else{
        try{
          quantity=StockQuantity.normalized(historical);
          final cost=p['avgCost'];
          if(quantity>0&&(cost is! num||!cost.isFinite||cost<=0)){reason='cost';quantity=null;}
          else{
            final minor=quantity==0?0:StockInvoiceCommands.money((quantity*(cost as num)*100).round()/100);
            if(quantity>0&&minor<=0){reason='cost';quantity=null;}
            else{value=minor/100;reason='suggested';}
          }
        }catch(_){reason='precision';quantity=null;value=null;}
      }
      result.add({'sourceItemId':p['id'],'warehouseId':warehouse,'name':p['name'],'sku':p['sku'],
        'unit':p['unit'],'historicalQuantity':historical,'quantity':quantity,'totalValue':value,
        'reason':reason,'relevant':present||p['warehouseId']==warehouse||opened!=null});
    }
    return result;
  }

  static ({String draft,int skipped}) suggestions(Iterable<Map<String,dynamic>> products,
      Iterable<Map<String,dynamic>> openings,String warehouse){
    final rows=reviewRows(products,openings,warehouse);
    return (draft:rows.where((r)=>r['reason']=='suggested').map((r)=>
      "${r['sourceItemId']}\t${r['quantity']}\t${(r['totalValue'] as num).toStringAsFixed(2)}").join('\n'),
      skipped:rows.where((r)=>r['reason']!='suggested'&&r['reason']!='approved').length);
  }
}
