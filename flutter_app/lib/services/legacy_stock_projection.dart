/// Pure projection of the legacy invoice register. This matches the web
/// bundle's computedQuantity rule. It is NOT a physical count or GL opening.
class LegacyStockProjection {
  static num number(Object? v,[num fallback=0]){
    final n=v is num?v:num.tryParse(v?.toString()??'');
    return n==null||!n.isFinite?fallback:n;
  }

  static Map<String,Map<String,num>> invoiceQuantities(
    Iterable<Map<String,dynamic>> items,Iterable<Map<String,dynamic>> ledger,
  ){
    final catalog={for(final item in items)item['id']:item};
    final quantities=<String,Map<String,num>>{};
    for(final entry in ledger){
      if(entry['deleted']==true||entry['postingStatus']=='draft')continue;
      final type=entry['docType'];
      final direction=[3,9,4].contains(type)?1:[2,7,5].contains(type)?-1:
        type==null&&['invoice','return'].contains(entry['kind'])?
          (entry['direction']=='credit'?1:entry['direction']=='debit'?-1:0):0;
      if(direction==0)continue;
      final lines=entry['lines'];
      if(lines is! List)continue;
      for(final raw in lines){
        if(raw is! Map||raw['lineKind']!='item')continue;
        final id=raw['inventoryItemId'],item=catalog[id];
        final lineWh=raw['warehouseId'],entryWh=entry['warehouseId'];
        final wh=lineWh is String&&lineWh.isNotEmpty?lineWh:
          entryWh is String&&entryWh.isNotEmpty?entryWh:item?['warehouseId'];
        if(id is! String||item==null||wh is! String||wh.isEmpty)continue;
        final c2=number(item['count2'],1),c3=number(item['count3'],1);
        final f2=c2==0?1:c2,f3=c3==0?1:c3;
        final unit=number(raw['unitNum'],1);
        final factor=unit==2?f2:unit==3?f2*f3:1;
        final amount=(number(raw['quantity'])*factor+number(raw['bonus']))*direction;
        final byWarehouse=quantities.putIfAbsent(id,()=> <String,num>{});
        byWarehouse[wh]=(byWarehouse[wh]??0)+amount;
      }
    }
    return quantities;
  }

  static void attach(
    Iterable<Map<String,dynamic>> items,Iterable<Map<String,dynamic>> ledger,
  ){
    final quantities=invoiceQuantities(items,ledger);
    for(final item in items){
      final q=quantities[item['id']];
      if(q==null)continue;
      item['legacyInvoiceQtyByWarehouse']=q;
      if(item['quantityUnverified']==true)item['computedQuantity']=q.values.fold<num>(0,(s,v)=>s+v);
    }
  }
}
