import 'dart:convert';
import 'local_database.dart';
import 'stock_invoice_commands.dart';
import 'local_document_commands.dart';

class LocalStockCatalog {
  LocalStockCatalog(this.local);
  final LocalDatabase local;
  Future<String> createWarehouse(String workspace,String key,Map<String,dynamic> input) async {
    final id=StockInvoiceCommands.identity('wh_$key');
    final name=LocalDocumentCommands.field(input,'name',100).trim();
    final details=LocalDocumentCommands.field(input,'details',300);
    final isDefault=input['isDefault']??false;
    if(name.isEmpty||isDefault is! bool) throw ArgumentError('Invalid warehouse');
    final data=<String,dynamic>{'id':id,'name':name,'details':details,'isDefault':isDefault?1:0};
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'warehouse.create',payload:data,
      apply:(txn)async{
        await StockInvoiceCommands.workspace(txn,workspace);
        if((await txn.query('warehouses',where:'name = ?',whereArgs:[name])).isNotEmpty) throw ArgumentError('Duplicate warehouse');
        if(isDefault) await txn.update('warehouses',{'isDefault':0});
        await txn.insert('warehouses',data);
        return {'id':id};
      });
    return id;
  }
  Future<String> createItem(String workspace,String key,Map<String,dynamic> input) async {
    final id=StockInvoiceCommands.identity('item_$key');
    final name=LocalDocumentCommands.field(input,'name',120).trim();
    final sku=LocalDocumentCommands.field(input,'sku',64);
    final unit=LocalDocumentCommands.field(input,'unit',32,fallback:'حبة').trim();
    final wh=StockInvoiceCommands.identity(input['warehouseId']);
    final min=input['minThreshold']??0;
    final units=<String,dynamic>{};
    for(final n in [2,3]){
      final name=LocalDocumentCommands.field(input,'unit$n',32).trim();
      final factor=input['count$n'];
      if(name.isEmpty){if(factor!=null||input['sprice$n']!=null) throw ArgumentError('Unit name missing');continue;}
      final count=StockInvoiceCommands.qty(factor);
      if(count<2||name==unit||units['unit2']==name) throw ArgumentError('Invalid unit conversion');
      units['unit$n']=name;units['count$n']=count;
      if(input['sprice$n']!=null) units['sprice$n']=StockInvoiceCommands.money(input['sprice$n'])/100;
    }
    if(units.containsKey('unit3')){
      if(!units.containsKey('unit2')) throw ArgumentError('Third unit requires second unit');
      StockInvoiceCommands.qty((units['count2'] as int)*(units['count3'] as int));
    }
    final defaultUnit=StockInvoiceCommands.qty(input['defaultUnit']??1);
    if(defaultUnit!=1&&!units.containsKey('unit$defaultUnit')) throw ArgumentError('Default unit missing');
    units['defaultUnit']=defaultUnit;
    if(input['sellingPrice']!=null) units['sellingPrice']=StockInvoiceCommands.money(input['sellingPrice'])/100;
    if(name.isEmpty||unit.isEmpty||min is! num||!min.isFinite||min<0||
        (input['quantity']??0)!=0||(input['avgCost']??0)!=0||
        (input['currencyCode']??'ريال')!='ريال'||
        input['expiryDate']!=null||input['isActive']==false) {
      throw ArgumentError('Only zero-stock, single-currency catalog items are supported');
    }
    final row=<String,dynamic>{'id':id,'name':name,'sku':sku,'unit':unit,
      'warehouseId':wh,'quantity':0,'avgCost':0,'minThreshold':min.toDouble()};
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.create',payload:{...row,'units':units},
      apply:(txn)async{
        await StockInvoiceCommands.workspace(txn,workspace);
        if((await txn.query('warehouses',where:'id = ?',whereArgs:[wh])).isEmpty) throw ArgumentError('Warehouse missing');
        if((await txn.query('inventory_items',where:'warehouseId = ? AND (name = ? OR (sku <> ? AND sku = ?))',whereArgs:[wh,name,'',sku])).isNotEmpty) throw ArgumentError('Duplicate item');
        await txn.insert('inventory_items',row);
        await txn.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(units)});
        return {'id':id};
      });
    return id;
  }
}
