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

  static ({String draft,int skipped}) suggestions(Iterable<Map<String,dynamic>> products,
      Iterable<Map<String,dynamic>> openings,String warehouse){
    final existing=openings.where((o)=>o['warehouse_id']==warehouse).map((o)=>o['source_item_id']).toSet();
    final output=<String>[];
    var skipped=0;
    for(final p in products){
      if(existing.contains(p['id']))continue;
      final invoices=p['legacyInvoiceQtyByWarehouse'],transfers=p['legacyTransferNetByWarehouse'];
      final present=(invoices is Map&&invoices.containsKey(warehouse))||(transfers is Map&&transfers.containsKey(warehouse));
      if(!present||p['legacyTransferIncomplete']==true||p['currencyCode']!='ريال'){
        skipped++;continue;
      }
      final q=(invoices is Map?(invoices[warehouse] as num? ??0):0)+(transfers is Map?(transfers[warehouse] as num? ??0):0);
      final cost=p['avgCost'];
      if(!q.isFinite||q<0||q>10000000||(q>0&&(cost is! num||!cost.isFinite||cost<=0))){
        skipped++;continue;
      }
      try{
        final normalized=StockQuantity.normalized(q);
        final total=q==0?0:StockInvoiceCommands.money((q*(cost as num)*100).round()/100);
        if(q>0&&total<=0){skipped++;continue;}
        output.add("${p['id']}\t$normalized\t${(total/100).toStringAsFixed(2)}");
      }catch(_){skipped++;}
    }
    return (draft:output.join('\n'),skipped:skipped);
  }
}
