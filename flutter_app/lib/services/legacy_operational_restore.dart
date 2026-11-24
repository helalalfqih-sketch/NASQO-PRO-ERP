import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_backup_restore.dart';
import 'local_database.dart';
import 'legacy_stock_projection.dart';

/// Explicit migration of the legacy single-sided account register. Never
/// manufactures counterpart accounts, opening stock quantities or cost legs.
/// Full original bytes and invoice details accompany every native export.
class LegacyOperationalRestore {
  LegacyOperationalRestore(this.local);
  final LocalDatabase local;
  static String s(Object? x,[String fallback=''])=>LocalBackupRestore.str(x,fallback);
  static num n(Object? x,[num fallback=0])=>LocalBackupRestore.numValue(x,fallback);
  static int i(Object? x,[int fallback=0])=>LocalBackupRestore.integer(x,fallback);
  static String? currency(Object? x)=>const {'ريال':'sar','دولار':'usd','يورو':'eur'}[x];

  Future<void> activate(BackupCandidate candidate,{String? replacementSha}) async {
    if(!candidate.legacy||candidate.native||
      sha256.convert(candidate.bytes).toString()!=candidate.sha)throw const FormatException('Not an intact legacy SQLite backup');
    if((candidate.meta['missingReferences']??0)!=0||(candidate.meta['orphanDetailBills']??0)!=0)
      throw const FormatException('Unresolved account or invoice references');
    final d=candidate.collections;
    final accounts=d['accounts']!,warehouses=d['warehouses']!,items=d['inventory']!,ledger=d['ledger']!;
    if(accounts.isEmpty||warehouses.isEmpty)throw const FormatException('Missing accounts or warehouses');
    Set<String> ids(List<Map<String,dynamic>> rows){
      final result=rows.map((r)=>LocalBackupRestore.ident(r['id'])).toSet();
      if(result.length!=rows.length)throw const FormatException('Duplicate identity');
      return result;
    }
    final accountIds=ids(accounts),warehouseIds=ids(warehouses);
    ids(items);ids(ledger);
    final db=await local.database;
    await db.transaction((t) async {
      final review=await t.query('backup_review_active',limit:1);
      if(review.isNotEmpty&&review.single['sha']!=candidate.sha&&replacementSha==null)
        throw StateError('Different review is active');
      await LocalBackupRestore.prepareRestoreDestination(t,replacementSha:replacementSha);
      final batch=t.batch();
      batch.insert('legacy_operational_source',{'singleton':1,'sha':candidate.sha,'file_name':candidate.name,'meta_json':jsonEncode(candidate.meta)});
      for(var offset=0;offset<candidate.bytes.length;offset+=49152){
        final end=offset+49152<candidate.bytes.length?offset+49152:candidate.bytes.length;
        batch.insert('legacy_operational_chunks',{'ordinal':offset~/49152,'data_base64':base64Encode(candidate.bytes.sublist(offset,end))});
      }
      for(final a in accounts){
        final c=currency(a['currency']);
        if(c==null||s(a['name']).trim().isEmpty||n(a['creditLimit'])<0)throw const FormatException('Invalid account or unsupported account currency');
        batch.insert('accounts',{'id':s(a['id']),'name':s(a['name']),'category':s(a['category']),
          'phone':s(a['phone']),'creditLimit':n(a['creditLimit']),'currency':c,
          'isCashAccount':a['isCashAccount']==true?1:0,'note':s(a['note']),
          'openingBalance':n(a['openingBalance']),'openingDirection':s(a['openingDirection'],'debit'),'codeNumber':i(a['codeNumber'],1)});
      }
      for(final w in warehouses){
        batch.insert('warehouses',{'id':s(w['id']),'name':s(w['name']),'details':s(w['details']),'isDefault':w['isDefault']==true?1:0});
      }
      for(final item in items){
        final id=s(item['id']),wh=s(item['warehouseId']);
        if(!warehouseIds.contains(wh))throw const FormatException('Unresolved catalog warehouse');
        batch.insert('inventory_items',{'id':id,'name':s(item['name']),'unit':s(item['unit'],'حبة'),
          'quantity':0,'avgCost':0,'warehouseId':wh,'minThreshold':0,'sku':s(item['sku'])});
        batch.insert('legacy_unverified_stock',{'item_id':id});
        final units=<String,dynamic>{};
        for(final k in ['unit2','count2','sprice2','unit3','count3','sprice3','defaultUnit','sellingPrice']){
          if(item[k]!=null)units[k]=item[k];
        }
        batch.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(units)});
      }
      for(final e in ledger){
        final aid=s(e['accountId']),c=currency(e['currency']),d=n(e['rawDain']),m=n(e['rawMadin']);
        if(!accountIds.contains(aid)||d<0||m<0)throw const FormatException('Invalid historical account or sides');
        // The original register has explicit debit and credit values. Both
        // sides are retained even when unequal; no counterpart is invented.
        // Unknown currency amounts remain outside the operational register.
        final supported=c!=null&&[1,2,3,4,5,7,9].contains(e['docType'])&&n(e['exchangeRate'],1)>0;
        final kind=s(e['kind']);
        batch.insert('ledger_entries',{'id':s(e['id']),'accountId':aid,'accountName':s(e['accountName']),
          'counterpartAccountId':'','counterpartAccountName':'','kind':kind=='return'?'returnEntry':kind,
          'typeLabel':s(e['typeLabel']),'payment':s(e['payment']),'direction':s(e['direction']),
          'amount':n(e['amount']),'currency':c??'currency2','exchangeRate':n(e['exchangeRate'],1),
          'details':s(e['details']),'documentNumber':s(e['documentNumber']),
          'warehouseId':s(e['warehouseId']),'warehouseName':s(e['warehouseName']),'expenseCategory':'',
          'entryNumber':i(e['entryNumber']),'deleted':0,'entryDate':s(e['entryDate']),
          'invoiceContent':s(e['invoiceContent'],'none'),'postingStatus':supported?'posted':'historical_unposted'});
      }
      for(final collection in d.entries){
        for(final row in collection.value){
          final json=jsonEncode(row);
          if(utf8.encode(json).length>512*1024)throw const FormatException('Historical row exceeds supported size');
          batch.insert('legacy_operational_rows',{'collection':collection.key,'record_id':LocalBackupRestore.ident(row['id']),'row_json':json});
        }
      }
      await batch.commit(noResult:true);
      if((await t.rawQuery('PRAGMA foreign_key_check')).isNotEmpty)throw StateError('Foreign key verification failed');
      if(Sqflite.firstIntValue(await t.rawQuery('SELECT COUNT(*) FROM ledger_entries'))!=ledger.length)throw StateError('Historical record count mismatch');
      await t.delete('backup_review_active');
    });
  }

  static Future<Uint8List?> original(DatabaseExecutor db) async {
    final meta=await db.query('legacy_operational_source',limit:1);
    if(meta.isEmpty)return null;
    final chunks=await db.query('legacy_operational_chunks',orderBy:'ordinal');
    final bytes=BytesBuilder(copy:false);
    for(var j=0;j<chunks.length;j++){
      if(chunks[j]['ordinal']!=j)throw StateError('Missing source chunk');
      bytes.add(base64Decode(chunks[j]['data_base64'] as String));
    }
    final result=bytes.takeBytes();
    if(sha256.convert(result).toString()!=meta.single['sha'])throw StateError('Original source checksum mismatch');
    return result;
  }

  static Future<Map<String,dynamic>?> invoice(DatabaseExecutor db,String id) async {
    final rows=await db.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['ledger',id]);
    if(rows.isEmpty)return null;
    final entry=LocalBackupRestore.object(jsonDecode(rows.single['row_json'] as String));
    final lines=LocalBackupRestore.rows(entry.remove('lines')??[]);
    final live=await db.query('ledger_entries',columns:['postingStatus'],where:'id = ?',whereArgs:[id]);
    if(live.length!=1)throw StateError('Imported ledger missing');
    entry['postingStatus']=live.single['postingStatus'];
    entry['ownerId']='local-erp-workspace';
    return {'entry':entry,'lines':[for(var j=0;j<lines.length;j++){'id':j+1,'sku':'','warehouseName':'','expiryDate':'',...lines[j]}]};
  }

  static Future<void> merge(DatabaseExecutor db,Map<String,dynamic> data) async {
    if(!await LocalDatabase.hasLegacyOperational(db))return;
    final byCollection=<String,Map<String,Map<String,dynamic>>>{};
    for(final r in await db.query('legacy_operational_rows')){
      final key=r['collection'] as String,row=LocalBackupRestore.object(jsonDecode(r['row_json'] as String));
      byCollection.putIfAbsent(key,()=> <String,Map<String,dynamic>>{})[r['record_id'] as String]=row;
    }
    final sourceItems=(byCollection['inventory']??{}).values;
    final sourceLedger=(byCollection['ledger']??{}).values;
    final projected=LegacyStockProjection.invoiceQuantities(sourceItems,sourceLedger);
    final unverified=(await db.query('legacy_unverified_stock',columns:['item_id'])).map((r)=>r['item_id']).toSet();
    final openings={for(final o in await db.query('legacy_stock_openings'))o['item_id']:o};
    final approvedWarehouses=<String,Set<String>>{};
    for(final o in openings.values){approvedWarehouses.putIfAbsent(o['source_item_id'] as String,()=> <String>{}).add(o['warehouse_id'] as String);}
    for(final c in ['currencies','accountGroups','cashboxes']){
      data[c]=(byCollection[c]??{}).values.toList();
    }
    for(final c in ['accounts','warehouses','inventory','ledger']){
      for(final row in (data[c] as List).cast<Map<String,dynamic>>()){
        final opening=c=='inventory'?openings[row['id']]:null;
        final old=byCollection[c]?[opening?['source_item_id']??row['id']];
        if(old==null)continue;
        if(opening!=null){row['legacySourceItemId']=opening['source_item_id'];row['openingDate']=opening['entry_date'];row['openingInventoryAccountId']=opening['inventory_account_id'];row['quantityUnverified']=false;}
        final keys=c=='accounts'?['groupId','sortOrder']:c=='warehouses'?['codeNumber']:c=='inventory'?['currencyCode','legacyWarehouseCount','legacyId','isActive','expiryDate']:['rawDain','rawMadin','settledOnReceipt','cashboxId','docType','sourceOrigin','lineCount','createdAtMs','currency','discount','bonus','legacyCurrencyId'];
        for(final key in keys){if(old[key]!=null)row[key]=old[key];}
        if(c=='inventory'&&unverified.contains(row['id'])){
          row['quantityUnverified']=true;
          row['legacyCatalogCost']=old['avgCost'];
          final quantities=projected[row['id']]??<String,num>{};
          final approved=approvedWarehouses[row['id']]??<String>{};
          final remaining={for(final e in quantities.entries)if(!approved.contains(e.key))e.key:e.value};
          row['legacyInvoiceQtyByWarehouse']=remaining;
          if(remaining.isNotEmpty)row['computedQuantity']=remaining.values.fold<num>(0,(s,v)=>s+v);
        }
      }
    }
    data['legacyOperational']=true;
  }
}
