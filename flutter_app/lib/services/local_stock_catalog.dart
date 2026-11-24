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
    if(name.isEmpty||unit.isEmpty||min is! num||!min.isFinite||min<0||
        (input['quantity']??0)!=0||(input['avgCost']??0)!=0||
        (input['currencyCode']??'ريال')!='ريال'||(input['defaultUnit']??1)!=1||
        input['unit2']!=null||input['unit3']!=null||input['sellingPrice']!=null||
        input['expiryDate']!=null||input['isActive']==false) {
      throw ArgumentError('Only zero-stock, base-unit catalog items are supported');
    }
    final row=<String,dynamic>{'id':id,'name':name,'sku':sku,'unit':unit,
      'warehouseId':wh,'quantity':0,'avgCost':0,'minThreshold':min.toDouble()};
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.create',payload:row,
      apply:(txn)async{
        await StockInvoiceCommands.workspace(txn,workspace);
        if((await txn.query('warehouses',where:'id = ?',whereArgs:[wh])).isEmpty) throw ArgumentError('Warehouse missing');
        if((await txn.query('inventory_items',where:'warehouseId = ? AND (name = ? OR (sku <> ? AND sku = ?))',whereArgs:[wh,name,'',sku])).isNotEmpty) throw ArgumentError('Duplicate item');
        await txn.insert('inventory_items',row);
        return {'id':id};
      });
    return id;
  }
}
