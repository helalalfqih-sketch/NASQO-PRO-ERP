import 'stock_quantity_approval_state.dart';
import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_backup_restore.dart';
import 'local_database.dart';
import 'legacy_stock_projection.dart';
import 'legacy_history_reports.dart';
import 'local_invoice_roles.dart';
import 'stock_quantity.dart';
import 'legacy_source_details.dart';

/// Explicit restoration of legacy registers and unified web workspaces.
/// Never invents counterpart accounts, quantities or accounting legs.
/// Full original bytes and invoice details accompany every native export.
class LegacyOperationalRestore {
  LegacyOperationalRestore(this.local);
  final LocalDatabase local;
  static String s(Object? x,[String fallback=''])=>LocalBackupRestore.str(x,fallback);
  static num n(Object? x,[num fallback=0])=>LocalBackupRestore.numValue(x,fallback);
  static int i(Object? x,[int fallback=0])=>LocalBackupRestore.integer(x,fallback);
  static String? currency(Object? x)=>const {'ريال':'sar','دولار':'usd','يورو':'eur'}[x];

  Future<void> activate(BackupCandidate candidate,{String? replacementSha}) async {
    if(!candidate.operational||candidate.native||
      sha256.convert(candidate.bytes).toString()!=candidate.sha)throw const FormatException('Not an intact supported workspace backup');
    final unified=candidate.unified;
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
    final accountIds=ids(accounts),warehouseIds=ids(warehouses),itemIds=ids(items);
    ids(ledger);
    final accountCurrencies={for(final a in accounts)s(a['id']):currency(a['currency'])};
    final warehouseNames={for(final w in warehouses)s(w['id']):s(w['name'])};
    final db=await local.database;
    await db.transaction((t) async {
      final review=await t.query('backup_review_active',limit:1);
      if(review.isNotEmpty&&review.single['sha']!=candidate.sha&&replacementSha==null)
        throw StateError('Different review is active');
      await LocalBackupRestore.prepareRestoreDestination(t,replacementSha:replacementSha);
      // A legacy file has no reliable GL role configuration. Never carry
      // settings for previous account IDs into the imported business.
      await t.delete('erp_state',where:'stateKey = ?',whereArgs:[LocalInvoiceRoles.stateKey]);
      final batch=t.batch();
      if(unified){
        final ws=LocalBackupRestore.object(candidate.meta['workspace']);
        batch.insert('erp_state',{'stateKey':'settings','payloadJson':jsonEncode({'companyName':s(ws['companyName'])}),
          'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
      }
      batch.insert('legacy_operational_source',{'singleton':1,'sha':candidate.sha,'file_name':candidate.name,'meta_json':jsonEncode(candidate.meta)});
      for(var offset=0;offset<candidate.bytes.length;offset+=49152){
        final end=offset+49152<candidate.bytes.length?offset+49152:candidate.bytes.length;
        batch.insert('legacy_operational_chunks',{'ordinal':offset~/49152,'data_base64':base64Encode(candidate.bytes.sublist(offset,end))});
      }
      for(final a in accounts){
        final c=currency(a['currency']);
        if(c==null||s(a['name']).trim().isEmpty||n(a['creditLimit'])<0||
            n(a['openingBalance'])<0||!['debit','credit'].contains(s(a['openingDirection'],'debit')))
          throw const FormatException('Invalid account or unsupported account currency');
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
        final verified=unified&&item['quantityUnverified']==false;
        final q=verified?StockQuantity.normalized(n(item['quantity'])):0;
        final cost=verified?n(item['avgCost']):0;
        if(verified&&(item['currencyCode']!='ريال'||cost<0||(q==0&&cost!=0)||q*cost*100>1000000000000))
          throw const FormatException('Invalid verified stock');
        batch.insert('inventory_items',{'id':id,'name':s(item['name']),'unit':s(item['unit'],'حبة'),
          'quantity':q,'avgCost':cost,'warehouseId':wh,'minThreshold':unified?n(item['minThreshold']):0,'sku':s(item['sku'])});
        if(!verified)batch.insert('legacy_unverified_stock',{'item_id':id});
        final units=<String,dynamic>{};
        for(final k in ['unit2','count2','sprice2','unit3','count3','sprice3','defaultUnit','sellingPrice']){
          if(item[k]!=null)units[k]=item[k];
        }
        batch.insert('inventory_unit_settings',{'item_id':id,'settings_json':jsonEncode(units)});
      }
      for(final e in ledger){
        final id=s(e['id']),aid=s(e['accountId']),c=currency(e['currency']),d=n(e['rawDain']),m=n(e['rawMadin']);
        final counter=unified?s(e['counterpartAccountId']):'';
        final kind=s(e['kind']),rate=n(e['exchangeRate'],1),amount=n(e['amount']);
        final sourceStatus=s(e['postingStatus'],'posted');
        final payment=s(e['payment'],'credit'),direction=s(e['direction'],'debit');
        final content=s(e['invoiceContent'],'none');
        if(!accountIds.contains(aid)||d<0||m<0||amount<0||
            (counter.isNotEmpty&&!accountIds.contains(counter)))throw const FormatException('Invalid historical account or sides');
        if(!['voucher','invoice','return','quote','order','transfer','currency','simple-entry','opening'].contains(kind)||
            !['cash','credit','balance'].contains(payment)||!['debit','credit'].contains(direction)||
            !['none','items','free'].contains(content)||
            (unified&&!['posted','draft','reversed','historical_unposted'].contains(sourceStatus)))
          throw const FormatException('Unsupported document classification');
        // Legacy raw sides and explicit web journal legs remain evidence,
        // not newly posted operations. Keep draft/deleted/reversed status.
        final supported=c!=null&&rate>0&&(unified||[1,2,3,4,5,7,9].contains(e['docType']));
        final status=supported?(unified?sourceStatus:'posted'):'historical_unposted';
        final wh=s(e['warehouseId']);
        batch.insert('ledger_entries',{'id':id,'accountId':aid,'accountName':s(e['accountName']),
          'counterpartAccountId':counter,'counterpartAccountName':unified?s(e['counterpartAccountName']):'',
          'kind':kind=='return'?'returnEntry':kind=='simple-entry'?'simpleEntry':kind,
          'typeLabel':s(e['typeLabel']),'payment':payment,'direction':direction,
          'amount':amount,'currency':c??'currency2','exchangeRate':rate,
          'details':s(e['details']),'documentNumber':s(e['documentNumber']),
          'warehouseId':wh,'warehouseName':s(e['warehouseName'],warehouseNames[wh]??''),
          'expenseCategory':unified?s(e['expenseCategory']):'',
          'entryNumber':i(e['entryNumber']),'deleted':unified&&LocalBackupRestore.flag(e['deleted'])?1:0,'entryDate':s(e['entryDate']),
          'invoiceContent':content,'postingStatus':status});
        if(unified){
          for(final line in LocalBackupRestore.rows(e['lines']??[])){
            final item=s(line['inventoryItemId']),lineWh=s(line['warehouseId']);
            if(item.isNotEmpty&&!itemIds.contains(item)||lineWh.isNotEmpty&&!warehouseIds.contains(lineWh))
              throw const FormatException('Unresolved invoice item or warehouse');
          }
          final legs=LocalBackupRestore.rows(e['journalLines']??[]);
          if(legs.isNotEmpty){
            if(!supported||legs.length<2||!['posted','reversed'].contains(status))throw const FormatException('Unsupported source journal');
            var debit=0,credit=0;
            batch.insert('journal_entries',{'id':id,'currency':c,'created_at':s(e['entryDate'])});
            for(var j=0;j<legs.length;j++){
              final leg=legs[j],account=s(leg['accountId']),dm=i(leg['debitMinor']),cm=i(leg['creditMinor']);
              if(!accountIds.contains(account)||accountCurrencies[account]!=c||
                  !((dm>0&&cm==0)||(cm>0&&dm==0))||dm>1000000000000||cm>1000000000000)
                throw const FormatException('Invalid source journal leg');
              debit+=dm;credit+=cm;
              batch.insert('journal_lines',{'id':'$id:source:$j','journal_id':id,'account_id':account,
                'debit_minor':dm,'credit_minor':cm});
            }
            if(debit<=0||debit!=credit)throw const FormatException('Unbalanced source journal');
          }
        }
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
    final live=await db.query('ledger_entries',columns:['postingStatus','details'],where:'id = ?',whereArgs:[id]);
    if(live.length!=1)throw StateError('Imported ledger missing');
    entry['postingStatus']=live.single['postingStatus'];
    final archived=Map<String,dynamic>.from(entry);
    entry['details']=live.single['details'];
    final recovered=await _sourceDetails(db);
    LegacySourceDetails.overlay(entry,archived,recovered[id]);
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
    final metaRow=(await db.query('legacy_operational_source',columns:['meta_json','sha'],limit:1)).single;
    (data['workspace'] as Map<String,dynamic>)['legacySourceSha']=metaRow['sha'];
    final meta=LocalBackupRestore.object(jsonDecode(metaRow['meta_json'] as String));
    final recovered=await _sourceDetails(db,meta:meta);
    final counts=meta['sourceExtraCounts'],unified=meta['unifiedSource']==true;
    if(unified){
      final ws=LocalBackupRestore.object(meta['workspace']);
      final workspace=data['workspace'] as Map<String,dynamic>;
      workspace['companyName']=s(ws['companyName']);
      workspace['defaultCurrency']=s(ws['defaultCurrency'],'ريال');
      data['activeCurrency']=workspace['defaultCurrency'];
    }
    final headers=(byCollection['source_store_trans']??{}).values;
    final transferLines=(byCollection['source_trans_details']??{}).values;
    final transferComplete=counts is Map&&counts['store_trans']==headers.length&&counts['trans_details']==transferLines.length&&
      (!unified||meta['unifiedTransferEvidence']==true);
    final transferReport=LegacyHistoryReports.transfers(sourceItems,(byCollection['warehouses']??{}).values,headers,transferLines);
    final transferNets=transferReport['netByItem'] as Map;
    final incomplete=(transferReport['affectedItemIds'] as List).toSet();
    final unverified=(await db.query('legacy_unverified_stock',columns:['item_id'])).map((r)=>r['item_id']).toSet();
    final openings={for(final o in await db.query('legacy_stock_openings'))o['item_id']:o};
    final quantityApprovals=await StockQuantityApprovalState.read(db);
    final approvedWarehouses=<String,Set<String>>{};
    for(final o in openings.values){approvedWarehouses.putIfAbsent(o['source_item_id'] as String,()=> <String>{}).add(o['warehouse_id'] as String);}
    for(final o in quantityApprovals.values){approvedWarehouses.putIfAbsent(o['source_item_id'] as String,()=> <String>{}).add(o['warehouse_id'] as String);}
    for(final c in ['currencies','accountGroups','cashboxes']){
      data[c]=(byCollection[c]??{}).values.toList();
    }
    for(final c in ['accounts','warehouses','inventory','ledger']){
      for(final row in (data[c] as List).cast<Map<String,dynamic>>()){
        final opening=c=='inventory'?openings[row['id']]:null;
        final qa=c=='inventory'?quantityApprovals[row['id']]:null;
        final old=byCollection[c]?[opening?['source_item_id']??qa?['source_item_id']??row['id']];
        if(old==null)continue;
        if(opening!=null){row['legacySourceItemId']=opening['source_item_id'];row['openingDate']=opening['entry_date'];row['openingInventoryAccountId']=opening['inventory_account_id'];row['quantityUnverified']=false;}
        final keys=c=='accounts'?['groupId','sortOrder','accountImage','settlement','documentNumberRequired','messageMethod','sendMode','legacyRef']:
          c=='warehouses'?['codeNumber','legacyRef']:c=='inventory'?['currencyCode','legacyWarehouseCount','legacyId','isActive','expiryDate','legacyRef']:
          ['rawDain','rawMadin','settledOnReceipt','cashboxId','docType','sourceOrigin','lineCount','createdAtMs','currency','discount','bonus','legacyCurrencyId','taxAmount','dueDate','paidAmount','deliveryDays','legacyRef','sourceReference','headerDiscount'];
        for(final key in keys){if(old[key]!=null)row[key]=old[key];}
        if(c=='ledger'){
          row['importedRegister']=true;
          LegacySourceDetails.overlay(row,old,recovered[row['id']]);
        }
        if(c=='inventory'&&unified&&old['quantityUnverified']==false)row['quantityUnverified']=false;
        if(c=='inventory'&&old['quantityUnverified']!=false&&(opening==null||opening['source_item_id']==row['id'])&&(qa==null||qa['source_item_id']==row['id'])){
          final sourceId=row['id'];
          final invoices=projected[sourceId]??<String,num>{};
          final transfers=transferComplete?(transferNets[sourceId] as Map<String,num>? ??<String,num>{}):<String,num>{};
          final approved=approvedWarehouses[sourceId]??<String>{};
          final known={...invoices.keys,...transfers.keys};
          final pending=<String,num>{for(final wh in known)
            if(!approved.contains(wh))wh:(invoices[wh]??0)+(transfers[wh]??0)};
          row['legacyHistoricalQtyByWarehouse']=pending;
          row['legacyStockPending']=pending.isNotEmpty||(unverified.contains(sourceId)&&qa==null);
          row['legacyTransferIncomplete']=!transferComplete||incomplete.contains(sourceId);
          row['legacyHistoryIncludesTransfers']=transferComplete;
        }
        if(c=='inventory'&&unverified.contains(row['id'])){
          row['quantityUnverified']=true;
          row['legacyCatalogCost']=old['avgCost'];
          if(unified)row['legacyStoredQuantity']=old['quantity'];
          final quantities=projected[row['id']]??<String,num>{};
          final approved=approvedWarehouses[row['id']]??<String>{};
          final remaining={for(final e in quantities.entries)if(!approved.contains(e.key))e.key:e.value};
          row['legacyInvoiceQtyByWarehouse']=remaining;
          if(remaining.isNotEmpty)row['computedQuantity']=remaining.values.fold<num>(0,(s,v)=>s+v);
        }
        if(qa!=null){
          row['legacySourceItemId']=qa['source_item_id'];
          row['quantityApprovalDate']=qa['entry_date'];
          row['quantityUnverified']=false;
          row['costUnverified']=unverified.contains(row['id']);
          row['legacyCatalogCost']=old['avgCost'];
          row.remove('computedQuantity');
        }
      }
    }
    data['legacyOperational']=true;
  }

  static Future<Map<String,Map<String,dynamic>>> _sourceDetails(DatabaseExecutor db,{Map<String,dynamic>? meta})async{
    final source=await db.query('legacy_operational_source',limit:1);
    if(source.isEmpty)return {};
    meta??=LocalBackupRestore.object(jsonDecode(source.single['meta_json'] as String));
    if(meta['unifiedSource']==true||meta['legacyDetailsVersion']==LegacySourceDetails.version)return {};
    return LegacySourceDetails.load(source.single['sha'] as String,()async{
      final bytes=await original(db);
      if(bytes==null)throw StateError('Original source missing');
      return bytes;
    });
  }
}
