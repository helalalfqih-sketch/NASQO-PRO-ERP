import 'local_reference_guards.dart';
import 'tabular_import_limits.dart';
import 'stock_quantity_approval_state.dart';
import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'stock_invoice_commands.dart';
import 'local_document_commands.dart';
import 'local_master_catalog.dart';
import 'stock_quantity.dart';
import 'unassigned_catalog.dart';
import 'automatic_stock_baseline.dart';
import 'inventory_locations.dart';

class LocalStockCatalog {
  LocalStockCatalog(this.local);
  final LocalDatabase local;
  Future<String> createWarehouse(String workspace,String key,Map<String,dynamic> input,{String? existingId}) async {
    final id=StockInvoiceCommands.identity(existingId??'wh_$key');
    final name=LocalDocumentCommands.field(input,'name',100).trim();
    final details=LocalDocumentCommands.field(input,'details',300);
    final isDefault=input['isDefault']??false;
    if(name.isEmpty||isDefault is! bool) throw ArgumentError('Invalid warehouse');
    final data=<String,dynamic>{'id':id,'name':name,'details':details,'isDefault':isDefault?1:0};
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:existingId==null?'warehouse.create':'warehouse.update',payload:data,
      apply:(txn)async{
        await StockInvoiceCommands.workspace(txn,workspace);
        if((await txn.query('warehouses',where:'name = ? AND id <> ?',whereArgs:[name,id])).isNotEmpty) throw ArgumentError('Duplicate warehouse');
        if(existingId!=null&&(await txn.query('warehouses',where:'id = ?',whereArgs:[id])).length!=1)throw StateError('Warehouse missing');
        if(isDefault) await txn.update('warehouses',{'isDefault':0});
        if(existingId==null){await txn.insert('warehouses',data);}
        else{await txn.update('warehouses',data,where:'id = ?',whereArgs:[id]);}
        return {'id':id};
      });
    return id;
  }
  Future<void> deleteWarehouse(String workspace,String key,String id)async{
    StockInvoiceCommands.identity(id);
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'warehouse.delete',payload:{'id':id},apply:(t)async{
      await LocalMasterCatalog.requireLocal(t,workspace);
      final rows=await t.query('warehouses',where:'id = ?',whereArgs:[id]);if(rows.isEmpty)throw StateError('المخزن غير موجود');
      await LocalReferenceGuards.check(t,id,{'warehouseId','fromWarehouseId','toWarehouseId'});
      for(final table in ['inventory_items','ledger_entries']){
        if((await t.query(table,where:'warehouseId = ?',whereArgs:[id],limit:1)).isNotEmpty)throw StateError('المخزن مرتبط بأصناف أو مستندات؛ انقل المراجع قبل الحذف');
      }
      final archived=await t.query('legacy_operational_rows');
      if(archived.any((r)=>LocalReferenceGuards.contains(jsonDecode(r['row_json'] as String),id,{'warehouseId','fromWarehouseId','toWarehouseId'})))throw StateError('المخزن مرتبط بتاريخ مستورد محفوظ');
      await t.delete('warehouses',where:'id = ?',whereArgs:[id]);return {'deleted':true};
    });
  }
  static Map<String,dynamic> unitSettings(Map<String,dynamic> input,String unit){
    final units=<String,dynamic>{};
    for(final n in [2,3]){
      final name=LocalDocumentCommands.field(input,'unit$n',32).trim();
      if(name.isEmpty)continue;
      final count=StockInvoiceCommands.qty(input['count$n']);
      if(count<1||name==unit||units['unit2']==name)throw ArgumentError('Invalid unit conversion');
      units['unit$n']=name;units['count$n']=count;
      if(input['sprice$n']!=null)units['sprice$n']=StockInvoiceCommands.money(input['sprice$n'])/100;
    }
    if(units.containsKey('unit3')){
      if(!units.containsKey('unit2'))throw ArgumentError('Third unit requires second unit');
      StockInvoiceCommands.qty((units['count2'] as int)*(units['count3'] as int));
    }
    final defaultUnit=StockInvoiceCommands.qty(input['defaultUnit']??1);
    if(defaultUnit!=1&&!units.containsKey('unit$defaultUnit'))throw ArgumentError('Default unit missing');
    units['defaultUnit']=defaultUnit;
    if(input['catalogReferenceCost']!=null)units['catalogReferenceCost']=StockInvoiceCommands.money(input['catalogReferenceCost'])/100;
    if(input['sellingPrice']!=null)units['sellingPrice']=StockInvoiceCommands.money(input['sellingPrice'])/100;
    if(input['isActive']!=null&&input['isActive'] is! bool)throw ArgumentError('Invalid active flag');
    units['isActive']=input['isActive']??true;
    final expiry=LocalDocumentCommands.field(input,'expiryDate',32);
    if(expiry.isNotEmpty){
      final date=DateTime.tryParse(expiry);
      if(date==null||expiry.length!=10||date.toIso8601String().substring(0,10)!=expiry)throw ArgumentError('Invalid expiry date');
      units['expiryDate']=expiry;
    }else{units['expiryDate']='';}
    units['currencyCode']=input['currencyCode']??'ريال';
    if(units['currencyCode']!='ريال')throw ArgumentError('Stock posting supports only base currency');
    return units;
  }

  static Future<Map<String,dynamic>> settings(Transaction t,String id)async{
    final saved=await t.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[id]);
    final raw=await t.query('legacy_operational_rows',columns:['row_json'],where:'collection = ? AND record_id = ?',whereArgs:['inventory',id]);
    final archived=raw.isEmpty?<String,dynamic>{}:jsonDecode(raw.single['row_json'] as String) as Map<String,dynamic>;
    final old=saved.isEmpty?<String,dynamic>{}:jsonDecode(saved.single['settings_json'] as String) as Map<String,dynamic>;
    return {for(final k in ['isActive','expiryDate','currencyCode'])if(archived[k]!=null)k:archived[k],...old};
  }

  static Future<bool> hasHistory(Transaction t,String id)async{
    return await AutomaticStockBaseline.forItem(t,id)!=null||await InventoryLocations.link(t,id)!=null||(await StockQuantityApprovalState.read(t)).containsKey(id)||
      (await t.query('invoice_lines',where:'item_id = ?',whereArgs:[id],limit:1)).isNotEmpty||
      (await t.query('stock_movements',where:'item_id = ?',whereArgs:[id],limit:1)).isNotEmpty||
      (await t.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['inventory',id],limit:1)).isNotEmpty||
      (await t.query('legacy_stock_openings',where:'item_id = ? OR source_item_id = ?',whereArgs:[id,id],limit:1)).isNotEmpty;
  }

  static Future<void> assertUnique(Transaction t,String id,String wh,String name,String sku)async{
    // Unassigned catalog identities are global. Assigned legacy balances may
    // still share an identity across warehouses, but cannot duplicate a card.
    final scope=wh.isEmpty?'':"(warehouseId = ? OR warehouseId = '') AND ";
    if((await t.query('inventory_items',where:'${scope}id <> ? AND (name = ? OR (sku <> ? AND sku = ?))',
        whereArgs:[if(wh.isNotEmpty)wh,id,name,'',sku],limit:1)).isNotEmpty)throw ArgumentError('Duplicate item or barcode');
  }

  static ({Map<String,dynamic> item,Map<String,dynamic> units}) newItemValues(String id,Map<String,dynamic> input){
    final name=LocalDocumentCommands.field(input,'name',120).trim(),sku=LocalDocumentCommands.field(input,'sku',64);
    final unit=LocalDocumentCommands.field(input,'unit',32,fallback:'حبة').trim();
    final rawWarehouse=input['warehouseId'];
    final wh=rawWarehouse==null||rawWarehouse==''?'':StockInvoiceCommands.identity(rawWarehouse),min=input['minThreshold']??0;
    final units=unitSettings(input,unit);
    if(name.isEmpty||unit.isEmpty||min is! num||!min.isFinite||min<0||
        (input['quantity']??0)!=0||(input['avgCost']??0)!=0||input['quantityUnverified']==true)
      throw ArgumentError('New item requires zero stock and cost; post purchases or an approved opening');
    if(wh.isEmpty)units['catalogOnly']=true;
    return (item:{'id':id,'name':name,'sku':sku,'unit':unit,'warehouseId':wh,
      'quantity':0,'avgCost':0,'minThreshold':min.toDouble()},units:units);
  }

  Future<void> insertItem(Transaction t,String id,Map<String,dynamic> input)async{
    final values=newItemValues(id,input),wh=values.item['warehouseId'] as String;
    if(wh.isNotEmpty&&(await t.query('warehouses',where:'id = ?',whereArgs:[wh])).isEmpty)throw ArgumentError('Warehouse missing');
    await assertUnique(t,id,wh,values.item['name'] as String,values.item['sku'] as String);
    await t.insert('inventory_items',values.item);
    await t.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(values.units)});
  }

  Future<String> createItem(String workspace,String key,Map<String,dynamic> input)async{
    final id=StockInvoiceCommands.identity('item_$key');
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.create',payload:{'id':id,'input':input},
      apply:(t)async{
        await StockInvoiceCommands.workspace(t,workspace);
        await insertItem(t,id,input);
        return {'id':id};
      });
    return id;
  }

  Future<void> editItem(Transaction t,String id,Map<String,dynamic> input)async{
    final rows=await t.query('inventory_items',where:'id = ?',whereArgs:[id]);
    if(rows.length!=1)throw StateError('Stock item missing');
    final old=rows.single,oldUnits=await settings(t,id);
    final q=old['quantity'] as num,cost=old['avgCost'] as num;
    if(input.containsKey('quantity')&&StockQuantity.balanceTicks(input['quantity'])!=StockQuantity.balanceTicks(q)||
       input.containsKey('avgCost')&&(input['avgCost'] is! num||(input['avgCost'] as num).isFinite==false||
         ((input['avgCost'] as num)-cost).abs()>0.0000001)||
       input.containsKey('quantityUnverified')&&input['quantityUnverified']!=
         ((await t.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[id],limit:1)).isNotEmpty&&
          !(await StockQuantityApprovalState.read(t)).containsKey(id)))
      throw StateError('Stock quantities and valuation require balanced posting');
    final merged=<String,dynamic>{...old,...oldUnits,...input};
    final name=LocalDocumentCommands.field(merged,'name',120).trim(),sku=LocalDocumentCommands.field(merged,'sku',64);
    final unit=LocalDocumentCommands.field(merged,'unit',32,fallback:'حبة').trim();
    final wh=merged['warehouseId']==''?'':StockInvoiceCommands.identity(merged['warehouseId']),min=merged['minThreshold']??0;
    if(old['warehouseId']==''){
      await UnassignedCatalog.requireClean(t,id);
      if(wh.isNotEmpty)throw ArgumentError('Catalog warehouse is selected when posting a purchase');
    }
    if(name.isEmpty||unit.isEmpty||min is! num||!min.isFinite||min<0)throw ArgumentError('Invalid stock catalog');
    // Normalization does not require old legacy unit settings to be repaired
    // merely to edit a name. Changes to conversion/warehouse require no history.
    final changesUnits=['unit2','count2','unit3','count3'].any((k)=>input.containsKey(k)&&(input[k]??'')!=(oldUnits[k]??''));
    final physicalChange=unit!=old['unit']||wh!=old['warehouseId']||changesUnits;
    if(physicalChange&&(q!=0||await hasHistory(t,id)))throw StateError('Use a stock transaction; historical unit conversions cannot change');
    final units=unitSettings(merged,unit);
    if(wh.isEmpty){units['catalogOnly']=true;}
    else if((await t.query('warehouses',where:'id = ?',whereArgs:[wh])).isEmpty)throw StateError('Warehouse missing');
    await assertUnique(t,id,wh,name,sku);
    await t.update('inventory_items',{'name':name,'sku':sku,'unit':unit,'warehouseId':wh,'minThreshold':min},
      where:'id = ?',whereArgs:[id]);
    await t.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(units)},conflictAlgorithm:ConflictAlgorithm.replace);
  }

  Future<void> updateItem(String workspace,String key,String id,Map<String,dynamic> input)async{
    StockInvoiceCommands.identity(id);
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.update',payload:{'id':id,'updates':input},
      apply:(t)async{await StockInvoiceCommands.workspace(t,workspace);await editItem(t,id,input);return {'id':id};});
  }

  Future<void> deleteItem(String workspace,String key,String id)async{
    StockInvoiceCommands.identity(id);
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.delete',payload:{'id':id},
      apply:(t)async{
        await LocalMasterCatalog.requireLocal(t,workspace);
        await LocalReferenceGuards.check(t,id,{'inventoryItemId','finishedItemId','quickItemIds'});
        final rows=await t.query('inventory_items',where:'id = ?',whereArgs:[id]);
        if(rows.length!=1)throw StateError('Stock item missing');
        if(rows.single['quantity']!=0||rows.single['avgCost']!=0||await hasHistory(t,id))
          throw StateError('Stock item has balances or history');
        await t.delete('inventory_unit_settings',where:'item_id = ?',whereArgs:[id]);
        await t.delete('inventory_items',where:'id = ?',whereArgs:[id]);
        return {'id':id};
      });
  }

  Future<Map<String,dynamic>> importItems(String workspace,String key,List<dynamic> items,String mode)async{
    if(items.isEmpty||items.length>maxTabularImportRows||!['upsert','insert-only'].contains(mode))throw ArgumentError('Invalid import batch');
    final rows=items.map((r)=>Map<String,dynamic>.from(r as Map)).toList();
    return local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.import',
      payload:{'items':rows,'mode':mode},apply:(t)async{
        await StockInvoiceCommands.workspace(t,workspace);
        // Card imports have no warehouse or stock posting. Validate once in
        // memory and send one SQL batch across Android's platform channel.
        // Keep the same outer transaction/idempotency and existing-card rules.
        if(mode=='insert-only'&&rows.every((r)=>r['warehouseId']==null||r['warehouseId']=='')){
          final existing=await t.query('inventory_items',columns:['name','sku']);
          final names=existing.map((r)=>r['name']).toSet();
          final skus=existing.map((r)=>r['sku']).where((v)=>v!=null&&v!='').toSet();
          final batch=t.batch();var inserted=0,skipped=0;
          for(var i=0;i<rows.length;i++){
            final row=rows[i],name=LocalDocumentCommands.field(row,'name',120).trim(),sku=LocalDocumentCommands.field(row,'sku',64);
            if(names.contains(name)||(sku.isNotEmpty&&skus.contains(sku))){skipped++;continue;}
            final id=StockInvoiceCommands.identity('item_${key}_$i'),values=newItemValues(id,row);
            batch.insert('inventory_items',values.item);
            batch.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(values.units)});
            names.add(name);if(sku.isNotEmpty)skus.add(sku);inserted++;
          }
          await batch.commit(noResult:true);
          return {'inserted':inserted,'updated':0,'skipped':skipped,'total':rows.length};
        }
        var inserted=0,updated=0,skipped=0;
        final seen=<String>{};
        for(var i=0;i<rows.length;i++){
          final input=rows[i],wh=input['warehouseId']==null||input['warehouseId']==''?'':StockInvoiceCommands.identity(input['warehouseId']);
          final name=LocalDocumentCommands.field(input,'name',120).trim(),sku=LocalDocumentCommands.field(input,'sku',64);
          final matches=await t.query('inventory_items',where:'${wh.isEmpty?'':'warehouseId = ? AND '}(name = ? OR (sku <> ? AND sku = ?))',
            whereArgs:[if(wh.isNotEmpty)wh,name,'',sku]);
          if(matches.isNotEmpty&&mode=='insert-only'){skipped++;continue;}
          if(matches.length>1)throw StateError('Ambiguous stock identity');
          final identity=matches.isEmpty?'$wh|$name|$sku':matches.single['id'] as String;
          if(!seen.add(identity))throw StateError('Duplicate import row');
          if(matches.isEmpty){
            final id=StockInvoiceCommands.identity('item_${key}_$i');
            await insertItem(t,id,input);seen.add(id);inserted++;
          }else if(mode=='insert-only'){skipped++;}
          else{await editItem(t,matches.single['id'] as String,input);updated++;}
        }
        return {'inserted':inserted,'updated':updated,'skipped':skipped,'total':rows.length};
      });
  }

  Future<void> batchUpdate(String workspace,String key,List<dynamic> input)async{
    if(input.isEmpty||input.length>2000)throw ArgumentError('Invalid stock update batch');
    final rows=input.map((r)=>Map<String,dynamic>.from(r as Map)).toList();
    await local.commitOperation(workspaceId:workspace,operationId:key,operationType:'inventory.batch-update',
      payload:{'updates':rows},apply:(t)async{
        await StockInvoiceCommands.workspace(t,workspace);
        final seen=<String>{};
        for(final row in rows){
          final id=StockInvoiceCommands.identity(row['id']);
          if(!seen.add(id)||row['data'] is! Map<String,dynamic>)throw ArgumentError('Invalid or duplicate item update');
          final data=row['data'] as Map<String,dynamic>;
          if(data.keys.any((k)=>!['quantity','avgCost','sellingPrice','minThreshold','quantityUnverified'].contains(k)))
            throw ArgumentError('Unsupported batch field');
          await editItem(t,id,data);
        }
        return {'updated':rows.length};
      });
  }
}
