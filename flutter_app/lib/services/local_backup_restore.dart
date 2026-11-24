import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';
import 'legacy_stock_projection.dart';
import 'legacy_sql_dump.dart';
import 'stock_quantity.dart';

/// Native backups restore operational tables. Recognized SmartPro and unified
/// web backups support explicit operational activation or isolated review.
class BackupCandidate {
  const BackupCandidate(this.name,this.format,this.bytes,this.sha,this.collections,
    this.meta,this.nativeTables);
  final String name,format,sha;
  final Uint8List bytes;
  final Map<String,List<Map<String,dynamic>>> collections;
  final Map<String,dynamic> meta;
  final Map<String,List<Map<String,dynamic>>>? nativeTables;
  bool get native => nativeTables!=null;
  bool get legacy => format=='legacy-sqlite'||format=='legacy-sql';
  bool get unified => LocalBackupRestore.knownFormats.contains(format);
  bool get operational => native||legacy||unified;
  Map<String,int> get counts => (nativeTables??collections).map((k,v)=>MapEntry(k,v.length));
}

class LocalBackupRestore {
  LocalBackupRestore(this.local);
  final LocalDatabase local;
  static const maxBytes=32*1024*1024;
  static const nativeFormat='nasqo-android-backup-v1';
  static const tables=[
    'accounts','warehouses','inventory_items','ledger_entries','erp_state',
    'journal_entries','journal_lines','invoice_lines','stock_movements',
    'stock_posting_documents','stock_posting_lines','inventory_unit_settings',
    'sync_outbox','bridge_idempotency_keys','sync_state','sync_inbox','sync_conflicts',
    ...legacyOperationalTables,
    'legacy_stock_openings',
  ];
  static const legacyOperationalTables=['legacy_operational_source','legacy_operational_chunks','legacy_operational_rows','legacy_unverified_stock'];
  static const collections=['currencies','accountGroups','cashboxes','accounts','warehouses','inventory','ledger'];
  static const knownFormats=['nasqo-unified-sqlite-export-v1','nasqo-unified-sqlite-export-v2','nasqo-pro-erp-backup'];
  static Map<String,dynamic> object(Object? v){
    if(v is! Map<String,dynamic>) throw const FormatException('Expected JSON object');
    return v;
  }
  static List<Map<String,dynamic>> rows(Object? v){
    if(v is! List||v.length>100000) throw const FormatException('Invalid collection size');
    return v.map(object).toList();
  }
  static String str(Object? v,[String fallback=''])=>v==null?fallback:v.toString();
  static num numValue(Object? v,[num fallback=0]){
    if(v==null||v=='')return fallback;
    final n=v is num?v:num.tryParse(v.toString().replaceAll(',',''));
    if(n==null||!n.isFinite)throw const FormatException('Invalid numeric field');
    return n;
  }
  static int integer(Object? v,[int fallback=0]){
    final n=numValue(v,fallback);
    if(n!=n.round()||n.abs()>9007199254740991)throw const FormatException('Invalid integer');
    return n.toInt();
  }
  static bool flag(Object? v)=>v==true||v==1||v=='1';
  static String ident(Object? v){
    final id=str(v);
    if(id.isEmpty||id.length>256)throw const FormatException('Missing or long record identity');
    return id;
  }
  static String currency(Object? v){
    final s=str(v,'ريال');
    return const {'sar':'ريال','usd':'دولار','eur':'يورو','currency2':'عملة 2'}[s]??s;
  }
  static bool sqlite(Uint8List b)=>b.length>=16&&ascii.decode(b.sublist(0,15),allowInvalid:true)=='SQLite format 3'&&b[15]==0;

  static Future<Map<String,dynamic>> _readNative(DatabaseExecutor db)async =>
    <String,dynamic>{for(final name in tables)name:await db.query(name,orderBy:'rowid')};

  Future<Uint8List> exportNative()async{
    final db=await local.database;
    final data=await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      return _readNative(t);
    });
    return _encodeNative(data);
  }

  static Uint8List _encodeNative(Map<String,dynamic> data){
    final payload=jsonEncode({'schemaVersion':LocalDatabase.dbVersion,'tables':data});
    final bytes=Uint8List.fromList(utf8.encode(jsonEncode({
      'format':nativeFormat,'sha256':sha256.convert(utf8.encode(payload)).toString(),'payload':payload,
    })));
    if(bytes.length>maxBytes)throw StateError('Backup exceeds supported size');
    return bytes;
  }

  static Future<void> _requireLocalReplacement(DatabaseExecutor db)async{
    if((await db.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding'],limit:1)).isNotEmpty)
      throw StateError('قاعدة العمل مرتبطة بالمزامنة؛ لا يمكن استبدالها محليًا');
    if((await db.query('sync_outbox',where:'acknowledged_at IS NOT NULL OR server_revision IS NOT NULL',limit:1)).isNotEmpty||
       (await db.query('sync_state',limit:1)).isNotEmpty||
       (await db.query('sync_inbox',limit:1)).isNotEmpty||
       (await db.query('sync_conflicts',limit:1)).isNotEmpty){
      throw StateError('توجد آثار مزامنة سابقة؛ لا يمكن استبدال قاعدة العمل بهذه الطريقة');
    }
  }

  /// Return the exact working database export even if an isolated archive is
  /// being reviewed. The caller must save and verify it before replacement.
  /// No mutations occur while preparing the export.
  Future<Uint8List?> replacementBackup()async{
    final db=await local.database;
    return db.transaction((t)async{
      await _requireLocalReplacement(t);
      final data=await _readNative(t);
      if(data.values.every((rows)=>(rows as List).isEmpty))return null;
      return _encodeNative(data);
    });
  }

  /// Call inside the same transaction as restoration. An explicitly exported
  /// snapshot is a compare-and-swap lease: changed data invalidates the lease.
  /// Foreign keys stay enabled; the child tables are deleted before parents.
  static Future<void> prepareRestoreDestination(Transaction txn,{String? replacementSha})async{
    await _requireLocalReplacement(txn);
    if(replacementSha==null){
      for(final name in tables.where((n)=>n!='erp_state')){
        if((await txn.query(name,limit:1)).isNotEmpty)
          throw StateError('قاعدة العمل ليست فارغة؛ يجب تصدير نسخة منها أولًا وتأكيد الاستبدال');
      }
      return;
    }
    final current=_encodeNative(await _readNative(txn));
    if(sha256.convert(current).toString()!=replacementSha)
      throw StateError('تغيرت البيانات بعد التصدير؛ أعد حفظ نسخة منها قبل الاستبدال');
    for(final name in tables.reversed){await txn.delete(name);}
  }

  Future<BackupCandidate> inspect(File file,String name)async{
    final length=await file.length();
    if(length<1||length>maxBytes)throw const FormatException('Unsupported file size');
    final head=await file.openRead(0,length>=2?2:1).first;
    if(head.length==2&&head[0]==0x1f&&head[1]==0x8b){
      final dir=await Directory.systemTemp.createTemp('nasqo-gzip-');
      try{
        final decoded=File('${dir.path}/decoded.back');
        final sink=decoded.openWrite();
        var size=0;
        try{
          await for(final chunk in file.openRead().transform(gzip.decoder)){
            size+=chunk.length;
            if(size>maxBytes)throw const FormatException('Decompressed backup exceeds 32 MB');
            sink.add(chunk);
          }
          await sink.flush();
        }finally{await sink.close();}
        // Only one compression layer is accepted. Archive the decoded
        // original SQLite/JSON payload, matching the web restore path.
        return await _inspectUncompressed(decoded,name);
      }finally{await dir.delete(recursive:true);}
    }
    return _inspectUncompressed(file,name);
  }

  Future<BackupCandidate> _inspectUncompressed(File file,String name)async{
    final length=await file.length();
    if(length<1||length>maxBytes)throw const FormatException('Unsupported file size');
    final bytes=await file.readAsBytes();
    final hash=sha256.convert(bytes).toString();
    if(bytes.length>=2&&bytes[0]==0x50&&bytes[1]==0x4b)
      throw const FormatException('فك ضغط ZIP أولًا ثم اختر ملف النسخة الداخلية');
    if(sqlite(bytes)){
      final source=await openDatabase(file.path,readOnly:true,singleInstance:false);
      try{
        final check=await source.rawQuery('PRAGMA integrity_check(1)');
        if(check.length!=1||check.single.values.single!='ok')throw const FormatException('SQLite integrity check failed');
        final schema=await source.rawQuery("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        final names=schema.map((r)=>r['name'] as String).toSet();
        if(schema.any((r)=>str(r['sql']).toUpperCase().contains('CREATE VIRTUAL TABLE')))throw const FormatException('Virtual tables unsupported');
        Future<List<Map<String,dynamic>>> get(String table)async{
          if(!names.contains(table))return [];
          final count=await source.rawQuery('SELECT COUNT(*) AS n FROM "$table"');
          if((count.single['n'] as int)>100000)throw const FormatException('Too many records');
          return (await source.query(table)).map((r)=>Map<String,dynamic>.from(r)).toList();
        }
        if(names.containsAll(tables.where((n)=>!legacyOperationalTables.contains(n)&&n!='legacy_stock_openings'))&&!names.contains('workspaces')){
          if((legacyOperationalTables.any(names.contains)||names.contains('legacy_stock_openings'))&&!names.containsAll(legacyOperationalTables))throw const FormatException('Incomplete operational archive');
          if(names.contains('backup_review_sources')&&(await get('backup_review_sources')).isNotEmpty)throw const FormatException('Use the native export option for operational data or export the archived original separately');
          final core={for(final table in tables)table:await get(table)};
          return BackupCandidate(name,'native-sqlite',bytes,hash,{}, {},core);
        }
        if(names.containsAll(['customers','stores','products'])&&(names.contains('input_move')||names.contains('bounds'))){
          final sourceTables=<String,List<Map<String,dynamic>>>{};
          for(final n in ['customers','stores','products','currencies','boxes','cboxes','input_move','bounds','bill_details','bill_details2','store_trans','trans_details','offers','offer_bill_details','offer_sbill_details','bin','bin_bill_details','bin_bill_details2','alerts']){
            sourceTables[n]=await get(n);
          }
          return _legacy(name,bytes,hash,sourceTables);
        }
        if(names.containsAll(['workspaces','accounts','warehouses','inventory_items','ledger_entries'])){
          final workspace=await get('workspaces');
          if(workspace.length!=1)throw const FormatException('Select a single-workspace backup');
          final ws=ident(workspace.single['id']);
          final core=<String,List<Map<String,dynamic>>>{};
          for(final n in ['accounts','warehouses','inventory_items','ledger_entries','currencies','account_groups','cashboxes','invoice_lines','stock_transfers','stock_transfer_lines','price_offers','price_offer_lines']){
            final data=await get(n);
            if(data.any((r)=>r['workspace_id']!=ws))throw const FormatException('Mixed workspaces');
            core[n]=data;
          }
          return _serverSqlite(name,bytes,hash,workspace.single,core,hasTransfers:names.containsAll(['stock_transfers','stock_transfer_lines']));
        }
        throw const FormatException('Unknown SQLite backup schema');
      }finally{await source.close();}
    }
    final decoded=utf8.decode(bytes).replaceFirst('\uFEFF','');
    if(LegacySqlDump.looksLike(decoded,name)){
      return _legacy(name,bytes,hash,LegacySqlDump.parse(decoded),format:'legacy-sql');
    }
    final root=object(jsonDecode(decoded));
    if(root['format']==nativeFormat){
      final payload=root['payload'];
      if(payload is! String||sha256.convert(utf8.encode(payload)).toString()!=root['sha256'])throw const FormatException('Backup checksum mismatch');
      final body=object(jsonDecode(payload));
      if(![7,8,9,LocalDatabase.dbVersion].contains(body['schemaVersion']))throw const FormatException('Native backup schema version mismatch');
      final data=object(body['tables']);
      final version=body['schemaVersion'];
      final required=tables.where((n)=>(version!=7||!legacyOperationalTables.contains(n))&&(version==9||version==LocalDatabase.dbVersion||n!='legacy_stock_openings'));
      if(data.keys.toSet().difference(tables.toSet()).isNotEmpty||!data.keys.toSet().containsAll(required))throw const FormatException('Incomplete native backup');
      return BackupCandidate(name,nativeFormat,bytes,hash,{}, {},{for(final n in tables)n:rows(data[n]??[])});
    }
    if(!knownFormats.contains(root['format'])||![1,2].contains(root['version']))throw const FormatException('Unsupported JSON backup format');
    return _web(name,bytes,hash,root);
  }

  BackupCandidate _web(String name,Uint8List bytes,String hash,Map<String,dynamic> root){
    final ws=object(root['workspace']);
    if(str(ws['companyName']).trim().isEmpty)throw const FormatException('Company name missing');
    final data={for(final k in collections)k:rows(root[k]??[]).map((r)=>Map<String,dynamic>.from(r)).toList()};
    final defaultCurrency=currency(ws['defaultCurrency']??ws['baseCurrency']);
    if(root['erpData']!=null&&root['erpData'] is! Map)throw const FormatException('Invalid ERP data');
    // These are not part of the recognized web bundle layout. Do not
    // silently drop independent accounting journal tables.
    for(final key in ['journalEntries','journalLines']){
      if(root[key]!=null&&rows(root[key]).isNotEmpty)throw const FormatException('Separate journal tables require a native backup');
    }
    if(!['accounts','warehouses','inventory','ledger'].every(root.containsKey))throw const FormatException('Incomplete core backup');
    final accountIds=<String>{};
    final warehouseIds=<String>{};
    final inventoryIds=<String>{};
    final ledgerIds=<String>{};
    for(final row in data['accounts']!){
      final id=ident(row['id']);
      if(!accountIds.add(id)||str(row['name']).trim().isEmpty)throw const FormatException('Invalid account');
      row['id']=id;
      row['currency']=currency(row['currency']??defaultCurrency);
      numValue(row['openingBalance']);numValue(row['creditLimit']);
      if(!['purchases','sales','clients','employees','transfers','shop'].contains(row['category']))throw const FormatException('Unknown account category');
    }
    for(final row in data['warehouses']!){
      final id=ident(row['id']);
      if(!warehouseIds.add(id)||str(row['name']).trim().isEmpty)throw const FormatException('Invalid warehouse');
      row['id']=id;
    }
    for(final row in data['inventory']!){
      if(!inventoryIds.add(ident(row['id']))||str(row['name']).trim().isEmpty)throw const FormatException('Invalid inventory row');
      row['id']=ident(row['id']);
      row['warehouseId']=str(row['warehouseId']);
      row['currencyCode']=currency(row['currencyCode']??defaultCurrency);
      final q=numValue(row['quantity']),cost=numValue(row['avgCost']);
      // Only an explicitly verified, representable base-currency quantity
      // from the unified source may be used as live stock without replay.
      var verified=row['quantityUnverified']==false&&row['quantity']!=null&&row['avgCost']!=null&&
        row['currencyCode']=='ريال'&&cost>=0&&(q!=0||cost==0);
      if(verified){
        try{StockQuantity.ticks(q);}catch(_){verified=false;}
        if(q*cost*100>1000000000000)verified=false;
      }
      row['quantityUnverified']=!verified;
    }
    var missingRefs=0;
    var lineCount=0;
    for(final row in data['ledger']!){
      final id=ident(row['id']);
      if(!ledgerIds.add(id))throw const FormatException('Duplicate ledger identity');
      row['id']=id;
      row['accountId']=str(row['accountId']);
      row['counterpartAccountId']=str(row['counterpartAccountId']);
      row['currency']=currency(row['currency']??defaultCurrency);
      numValue(row['amount']);numValue(row['rawDain']);numValue(row['rawMadin']);
      if(!accountIds.contains(row['accountId']))missingRefs++;
      if(str(row['counterpartAccountId']).isNotEmpty&&!accountIds.contains(row['counterpartAccountId']))missingRefs++;
      final ls=rows(row['lines']??[]);
      if(row['lineCount'] is num&&row['lineCount']!=ls.length)throw const FormatException('Missing invoice detail rows');
      row['lineCount']=ls.length;
      row['lines']=[for(final raw in ls)<String,dynamic>{
        ...raw,
        'inventoryItemId':raw['inventoryItemId']==null?null:str(raw['inventoryItemId']),
        'warehouseId':raw['warehouseId']==null?null:str(raw['warehouseId']),
        'lineKind':raw['lineKind']=='free'?'free':str(raw['inventoryItemId']).isNotEmpty?'item':'free',
      }];
      lineCount+=ls.length;
      // Preserve historical raw amount semantics, never manufacture journal legs.
    }
    final extra=<String,List<Map<String,dynamic>>>{for(final k in [
      'store_trans','trans_details','offers','offer_bill_details','offer_sbill_details',
      'bin','bin_bill_details','bin_bill_details2','alerts'
    ])k:<Map<String,dynamic>>[]};
    // Normalized web IDs are not raw SmartPro numeric IDs. Keep the exact
    // references and flatten only for the existing historical record viewer.
    final transfers=rows(root['stockTransfers']??[]),offers=rows(root['priceOffers']??[]);
    for(var j=0;j<transfers.length;j++){
      final tx=transfers[j],id='unified-transfer-$j';
      extra['store_trans']!.add({...tx,'id':id,'originalId':tx['id'],'normalizedRefs':true,
        'store_id1':tx['fromWarehouseId'],'store_id2':tx['toWarehouseId'],'date':tx['transferDate'],'type':tx['transferType']}..remove('lines'));
      final lines=rows(tx['lines']??[]);
      for(var k=0;k<lines.length;k++){
        final l=lines[k];
        extra['trans_details']!.add({...l,'id':'$id:$k','originalId':l['id'],'bill_id':id,'normalizedRefs':true,
          'prod_id':l['inventoryItemId'],'amount':l['quantity'],'unitnum':l['unitNum'],'exdate':l['expiryDate']});
      }
    }
    for(var j=0;j<offers.length;j++){
      final offer=offers[j],id='unified-offer-$j';
      extra['offers']!.add({...offer,'id':id,'originalId':offer['id'],'per_id':offer['accountId'],
        'date':offer['offerDate'],'type':offer['offerType']}..remove('lines'));
      final lines=rows(offer['lines']??[]);
      for(var k=0;k<lines.length;k++){
        final l=lines[k];
        extra[l['lineKind']=='free'?'offer_sbill_details':'offer_bill_details']!.add({
          ...l,'id':'$id:$k','originalId':l['id'],'bill_id':id,'prod_id':l['inventoryItemId'],
          'amount':l['quantity'],'unitnum':l['unitNum']});
      }
    }
    for(final e in extra.entries){data['source_${e.key}']=e.value;}
    return BackupCandidate(name,str(root['format']),bytes,hash,data,{
      'workspace':{'companyName':str(ws['companyName']),'defaultCurrency':defaultCurrency},
      'invoiceLines':lineCount,'missingReferences':missingRefs,
      'extraCollections':{'stockTransfers':transfers.length,'priceOffers':offers.length},
      'sourceExtraCounts':extra.map((k,v)=>MapEntry(k,v.length)),
      'unifiedTransferEvidence':root['stockTransfers'] is List,
      'unifiedSource':true,'historicalReview':true,
      'erpDataArchivedOnly':root['erpData'] is Map&&(root['erpData'] as Map).isNotEmpty,
    },null);
  }

  BackupCandidate _serverSqlite(String name,Uint8List bytes,String hash,Map<String,dynamic> ws,Map<String,List<Map<String,dynamic>>> t,{required bool hasTransfers}){
    final ls=<String,List<Map<String,dynamic>>>{};
    final entries={for(final e in t['ledger_entries']!)str(e['id']):e};
    final items={for(final i in t['inventory_items']!)str(i['id']):i};
    final computed=<String,num>{};
    // Match the web's getFullWorkspaceBundle movement projection. Do not
    // replace static quantity or certify historically unverified stock.
    for(final l in t['invoice_lines']!){
      final itemId=str(l['inventory_item_id']),e=entries[str(l['entry_id'])];
      if(itemId.isEmpty||e==null||flag(e['deleted'])||str(e['posting_status'])=='draft'||
          str(l['line_kind'])!='item')continue;
      final item=items[itemId];
      final doc=e['doc_type'];
      final kind=str(e['kind']),direction=str(e['direction']);
      final inbound=[3,9,4].contains(doc)||(doc==null&&((kind=='invoice'&&direction=='credit')||(kind=='return'&&direction=='credit')));
      final outbound=[2,7,5].contains(doc)||(doc==null&&((kind=='invoice'&&direction=='debit')||(kind=='return'&&direction=='debit')));
      final c2=numValue(item?['count2'],1),c3=numValue(item?['count3'],1);
      final f2=c2==0?1:c2,f3=c3==0?1:c3;
      final unit=integer(l['unit_num'],1),factor=unit==2?f2:unit==3?f2*f3:1;
      final quantity=numValue(l['quantity'])*factor+numValue(l['bonus']);
      computed[itemId]=(computed[itemId]??0)+(inbound?quantity:outbound?-quantity:0);
    }
    for(final row in t['invoice_lines']!){
      ls.putIfAbsent(str(row['entry_id']),()=>[]).add({
        'lineKind':row['line_kind'],'inventoryItemId':row['inventory_item_id'],'warehouseId':row['warehouse_id'],
        'itemName':row['item_name'],'price':row['price'],'quantity':row['quantity'],'total':row['total'],
        'discount':row['discount'],'bonus':row['bonus'],'unit':row['unit'],'unitNum':row['unit_num'],
        'details':row['details'],'expiryDate':row['expiry_date'],'unitCostAtSale':row['unit_cost_at_sale'],'legacyId':row['legacy_id'],
      });
    }
    final txLines=<String,List<Map<String,dynamic>>>{},offerLines=<String,List<Map<String,dynamic>>>{};
    for(final l in t['stock_transfer_lines']!){
      txLines.putIfAbsent(str(l['transfer_id']),()=>[]).add({'id':l['id'],'inventoryItemId':l['inventory_item_id'],
        'rawProdId':l['raw_prod_id'],'quantity':l['quantity'],'unit':l['unit'],'unitNum':l['unit_num'],
        'details':l['details'],'expiryDate':l['expiry_date'],'legacyId':l['legacy_id']});
    }
    for(final l in t['price_offer_lines']!){
      offerLines.putIfAbsent(str(l['offer_id']),()=>[]).add({'id':l['id'],'lineKind':l['line_kind'],'inventoryItemId':l['inventory_item_id'],
        'rawProdId':l['raw_prod_id'],'price':l['price'],'quantity':l['quantity'],'total':l['total'],'unit':l['unit'],
        'unitNum':l['unit_num'],'details':l['details'],'legacyId':l['legacy_id']});
    }
    if(txLines.keys.any((id)=>!t['stock_transfers']!.any((r)=>str(r['id'])==id))||
       offerLines.keys.any((id)=>!t['price_offers']!.any((r)=>str(r['id'])==id))||
       ls.keys.any((id)=>!entries.containsKey(id)))throw const FormatException('Orphaned document details');
    return _web(name,bytes,hash,{
      'format':'nasqo-unified-sqlite-export-v2','version':2,
      if(hasTransfers)'stockTransfers':t['stock_transfers']!.map((r)=>{'id':r['id'],'fromWarehouseId':r['from_warehouse_id'],
        'toWarehouseId':r['to_warehouse_id'],'rawFromStoreId':r['raw_from_store_id'],'rawToStoreId':r['raw_to_store_id'],
        'details':r['details'],'transferDate':r['transfer_date'],'transferType':r['transfer_type'],
        'legacyId':r['legacy_id'],'lines':txLines[str(r['id'])]??[]}).toList(),
      'priceOffers':t['price_offers']!.map((r)=>{'id':r['id'],'accountId':r['account_id'],'rawAccId':r['raw_acc_id'],
        'name':r['name'],'offerType':r['offer_type'],'dain':r['dain'],'madin':r['madin'],'currency':r['currency'],
        'offerDate':r['offer_date'],'details':r['details'],'bonus':r['bonus'],'discount':r['discount'],
        'legacyId':r['legacy_id'],'lines':offerLines[str(r['id'])]??[]}).toList(),
      'workspace':{'companyName':str(ws['company_name'],'نسقو برو'),'defaultCurrency':currency(ws['default_currency'])},
      'currencies':t['currencies']!.map((r)=>{'id':r['id'],'name':r['name'],'code':r['code'],'symbol':r['symbol'],'ratePrimary':r['rate_primary'],'rateSecondary':r['rate_secondary'],'nameSecondary':r['name_secondary']}).toList(),
      'accountGroups':t['account_groups']!.map((r)=>{'id':r['id'],'name':r['name'],'category':r['category'],'currencyCode':r['currency_code'],'sortOrder':r['sort_order'],'hasBill':flag(r['has_bill']),'isEmployee':flag(r['is_employee']),'legacyId':r['legacy_id']}).toList(),
      'cashboxes':t['cashboxes']!.map((r)=>{'id':r['id'],'name':r['name'],'details':r['details'],'currencyCode':r['currency_code'],'isActive':flag(r['state']),'state':r['state'],'boxType':r['box_type'],'sortOrder':r['sort_order'],'legacyId':r['legacy_id']}).toList(),
      'accounts':t['accounts']!.map((r)=>{'id':r['id'],'name':r['name'],'groupId':r['group_id'],'category':r['category'],'phone':r['phone'],'creditLimit':r['credit_limit'],'currency':currency(r['currency']),'isCashAccount':flag(r['is_cash_account']),'openingBalance':r['opening_balance'],'openingDirection':r['opening_direction'],'note':r['note'],'codeNumber':r['code_number'],'sortOrder':r['sort_order'],'accountImage':r['account_image'],'settlement':flag(r['settlement']),'documentNumberRequired':flag(r['document_number_required']),'messageMethod':r['message_method'],'sendMode':r['send_mode'],'legacyRef':r['legacy_ref']}).toList(),
      'warehouses':t['warehouses']!.map((r)=>{'id':r['id'],'name':r['name'],'details':r['details'],'isDefault':flag(r['is_default']),'codeNumber':r['code_number'],'legacyRef':r['legacy_ref']}).toList(),
      'inventory':t['inventory_items']!.map((r)=>{'id':r['id'],'name':r['name'],'unit':r['unit'],'quantity':r['quantity'],'avgCost':r['avg_cost'],'sellingPrice':r['selling_price'],'sku':r['sku'],'minThreshold':r['min_threshold'],'warehouseId':r['warehouse_id'],'currencyCode':r['currency_code'],'quantityUnverified':r['quantity_unverified']==null?true:flag(r['quantity_unverified']),'unit2':r['unit2'],'count2':r['count2'],'sprice2':r['sprice2'],'unit3':r['unit3'],'count3':r['count3'],'sprice3':r['sprice3'],'defaultUnit':r['default_unit'],'isActive':r['bstate']!=0,'expiryDate':r['expiry_date'],'legacyId':r['legacy_id'],'legacyRef':r['legacy_ref'],if(flag(r['quantity_unverified'])&&computed.containsKey(str(r['id'])))'computedQuantity':computed[str(r['id'])]}).toList(),
      'ledger':t['ledger_entries']!.map((r)=>{'id':r['id'],'accountId':r['account_id'],'accountName':r['account_name'],'counterpartAccountId':r['counterpart_account_id'],'counterpartAccountName':r['counterpart_account_name'],'cashboxId':r['cashbox_id'],'kind':r['kind'],'typeLabel':r['type_label'],'payment':r['payment'],'direction':r['direction'],'amount':r['amount'],'rawDain':r['raw_dain'],'rawMadin':r['raw_madin'],'settledOnReceipt':flag(r['settled_on_receipt']),'currency':currency(r['currency']),'exchangeRate':r['exchange_rate'],'details':r['details'],'documentNumber':r['document_number'],'warehouseId':r['warehouse_id'],'warehouseName':r['warehouse_name'],'invoiceContent':r['invoice_content'],'entryNumber':r['entry_number'],'deleted':flag(r['deleted']),'entryDate':r['entry_date'],'createdAtMs':r['created_at_ms'],'postingStatus':r['posting_status'],'taxAmount':r['tax_amount'],'discount':r['discount'],'docType':r['doc_type'],'sourceOrigin':r['source_origin'],'dueDate':r['due_date'],'expenseCategory':r['expense_category'],'paidAmount':r['paid_amount'],'legacyRef':r['legacy_ref'],'lineCount':(ls[str(r['id'])]??[]).length,'lines':ls[str(r['id'])]??[]}).toList(),
    });
  }

  BackupCandidate _legacy(String name,Uint8List bytes,String hash,Map<String,List<Map<String,dynamic>>> t,{String format='legacy-sqlite'}){
    final cur={for(final r in t['currencies']!)integer(r['id']):str(r['name'],'ريال')};
    final cashIds=t['cboxes']!.map((r)=>integer(r['id'])).toSet();
    String getCurrency(Object? id)=>cur[integer(id,1)]??'عملة غير معرّفة (${str(id)})';
    String category(String group,int type){
      if(group.contains('رأس المال')||group.contains('راس المال')||group.contains('أصول')||group.contains('اصول')||group.contains('سحبيات'))return 'shop';
      if(group.contains('مورد')||group.contains('مشتريات'))return 'purchases';
      if(group.contains('موظف'))return 'employees';
      if(group.contains('مبيعات'))return 'sales';
      if(group.contains('صندوق')||group.contains('حوال'))return 'transfers';
      if(group.contains('مصروف')||group.contains('محل'))return 'shop';
      if(group.contains('عميل')||group.contains('عملاء'))return 'clients';
      return group.isNotEmpty?'shop':const {3:'purchases',4:'employees',5:'shop',6:'transfers'}[type]??'clients';
    }
    final groups={for(final r in t['boxes']!)integer(r['id']):r};
    final accounts=<Map<String,dynamic>>[];
    for(final r in t['customers']!){
      final id=integer(r['id']),type=integer(r['box_id']??r['type'],1),group=groups[type];
      accounts.add({'id':'legacy-acc-$id','name':str(r['name'],'حساب $id'),'category':category(str(group?['name']),type),
        'phone':str(r['phone']).isEmpty?str(r['phon']):str(r['phone']),'creditLimit':numValue(r['lim']),'currency':getCurrency(group?['cur']??group?['cur_id']??1),
        'isCashAccount':str(r['name']).contains('نقد')||str(r['name']).contains('صندوق'),'openingBalance':0,'openingDirection':'debit',
        'note':str(r['details']),'codeNumber':id,'sortOrder':id,if(group!=null)'groupId':type});
    }
    final warehouses=t['stores']!.map((r)=> <String,dynamic>{'id':'legacy-wh-${integer(r['id'])}','name':str(r['name']),'details':str(r['details']),'isDefault':integer(r['id'])==1,'codeNumber':integer(r['id'])}).toList();
    final inventory=t['products']!.map((r)=> <String,dynamic>{
      'id':'legacy-prod-${integer(r['id'])}','name':str(r['name']),'unit':str(r['unit'],'حبة'),
      'quantity':0,'quantityUnverified':true,'avgCost':numValue(r['price2']),'sellingPrice':numValue(r['price']),
      'sku':str(r['barcode']),'warehouseId':warehouses.isEmpty?'':warehouses.first['id'],
      'unit2':str(r['unit2']),'count2':numValue(r['count2']),'sprice2':numValue(r['sprice2']),
      'unit3':str(r['unit3']),'count3':numValue(r['count3']),'sprice3':numValue(r['sprice3']),
      'defaultUnit':integer(r['defunit'],1),'currencyCode':getCurrency(r['cur']),'legacyId':integer(r['id']),
      'isActive':integer(r['bstate'],1)!=0,'expiryDate':str(r['exdate']),
    }).toList();
    final names={for(final a in accounts)a['id']:a['name']};
    final prodNames={for(final a in inventory)a['id']:a['name']};
    final prodSkus={for(final a in inventory)a['id']:a['sku']};
    final whNames={for(final w in warehouses)w['id']:w['name']};
    final detail=<int,List<Map<String,dynamic>>>{};
    final billSummaries=<int,List<String>>{};
    for(final n in ['bill_details','bill_details2']){
      for(final r in t[n]!){
        final bill=integer(r['bill_id']),pid='legacy-prod-${integer(r['prod_id'])}';
        final isItem=n=='bill_details';
        final wh='legacy-wh-${integer(r['store_id'])}';
        final rawDescription=str(r['details']).trim();
        final name=isItem?(prodNames[pid]??rawDescription):rawDescription.isEmpty?'بند حر':rawDescription;
        if(isItem&&prodNames.containsKey(pid)){
          final summary=billSummaries.putIfAbsent(bill,()=> <String>[]);
          final qty=str(r['amount']).trim(),unit=str(r['unit']).trim();
          if(summary.length<8)summary.add("${prodNames[pid]} (${qty.isEmpty?'1':qty}${unit.isEmpty?'':' $unit'})");
        }
        detail.putIfAbsent(bill,()=>[]).add({'lineKind':isItem?'item':'free',
          if(isItem)'inventoryItemId':pid,'itemName':name,
          if(isItem)'warehouseId':wh,if(isItem)'warehouseName':whNames[wh]??'',
          if(isItem)'sku':prodSkus[pid]??'','price':numValue(r['price']),
          'quantity':numValue(r['amount']),'total':numValue(r['total']),'discount':numValue(r['discount']),
          'bonus':numValue(r['bonus']),'unit':str(r['unit']),'unitNum':isItem?integer(r['unitnum'],1):1,'details':str(r['details']),'expiryDate':isItem?str(r['exdate']):'','legacyId':r['id']});
      }
    }
    final ledger=<Map<String,dynamic>>[];
    var ambiguous=0,missing=0,unknownCurrencies=0;
    final seenMoves=<int>{};
    final votes=<String,Map<String,int>>{};
    final moves=t['input_move']!.isNotEmpty?t['input_move']!:t['bounds']!;
    for(final r in moves){
      final id=integer(r['id']),aid='legacy-acc-${integer(r['per_id']??r['acc_id'])}';
      if(!seenMoves.add(id))throw const FormatException('Duplicate movement');
      final d=numValue(r['dain']),c=numValue(r['madin']);
      if(!cur.containsKey(integer(r['cur']??r['cur_id'],1)))unknownCurrencies++;
      if(d>0&&c>0&&(d-c).abs()>=0.01)ambiguous++;
      if(!names.containsKey(aid))missing++;
      final doc=integer(r['bill_type']??r['doc_type'],1);
      final kind=[2,3,7,9].contains(doc)?'invoice':[4,5].contains(doc)?'return':'voucher';
      final settled=d>0&&c>0&&(d-c).abs()<0.01;
      final typeLabel=<int,String>{
        2:settled?'فاتورة بيع نقدي':'فاتورة بيع آجل',
        3:settled?'ف.ش.نقدي':'فاتورة شراء آجلة',
        4:'مردود مبيعات',5:'مردود مشتريات',
        7:settled?'فاتورة بيع حر نقدي':'فاتورة بيع حرة',
        9:settled?'فاتورة شراء حر نقدي':'فاتورة شراء حرة',
      }[doc]??(doc==1?(d>0?'عليه (سند)':'له (سند)'):'سند تاريخي');
      final cb=integer(r['cboxid']);
      final billLines=detail[id]??<Map<String,dynamic>>[];
      String wh='';
      for(final line in billLines){
        final store=str(line['warehouseId']),item=str(line['inventoryItemId']);
        if(!whNames.containsKey(store)||!prodNames.containsKey(item))continue;
        if(wh.isEmpty)wh=store;
        final v=votes.putIfAbsent(item,()=> <String,int>{});v[store]=(v[store]??0)+1;
      }
      final year=integer(r['year']),month=integer(r['month']),day=integer(r['day']);
      String date=str(r['date']);
      if(date.isEmpty&&year>1900&&month>=1&&month<=12&&day>=1&&day<=31){
        date='$year-${month.toString().padLeft(2,'0')}-${day.toString().padLeft(2,'0')}';
      }
      final nd=str(r['ndate']);
      if(date.isEmpty&&RegExp(r'^[0-9]{8}$').hasMatch(nd)&&nd!='00000000')date='${nd.substring(0,4)}-${nd.substring(4,6)}-${nd.substring(6,8)}';
      final rawDetails=str(r['details']).trim();
      final preview=rawDetails.isNotEmpty?rawDetails:(billSummaries[id]??<String>[]).join('\n');
      final displayDetails=preview.length>600?preview.substring(0,600):preview;
      final stamp=DateTime.tryParse('${date}T00:00:00Z');
      ledger.add({'id':'legacy-ent-$id','accountId':aid,'accountName':names[aid]??'حساب غير مرتبط',
        'counterpartAccountId':'','counterpartAccountName':'','kind':kind,'typeLabel':typeLabel,'payment':d==0&&c==0?'balance':settled||(doc==1&&cb>0&&(d==0||c==0))?'cash':'credit',if(cashIds.contains(cb))'cashboxId':cb,
        'direction':settled?([1,2,5,7].contains(doc)?'debit':'credit'):(d>=c?'debit':'credit'),
        'amount':settled?d:d>=c?d:c,'rawDain':d,'rawMadin':c,'settledOnReceipt':settled,'currency':getCurrency(r['cur']??r['cur_id']),
        'legacyCurrencyId':integer(r['cur']??r['cur_id'],1),'discount':numValue(r['discount']),'bonus':numValue(r['bonus']),
        'sender':str(r['sender']),'receiver':str(r['recever']),'companyName':str(r['comp']),'legacyId':id,
        'exchangeRate':numValue(r['curprice'],1)==0?1:numValue(r['curprice'],1),'details':displayDetails,'documentNumber':str(r['bill']),
        'warehouseId':wh,'warehouseName':whNames[wh]??'','invoiceContent':[7,9].contains(doc)?'free':kind=='voucher'?'none':'items',
        'entryNumber':id,'entryDate':date,'createdAtMs':stamp==null?0:stamp.millisecondsSinceEpoch+id,
        'deleted':false,'docType':doc,'sourceOrigin':'legacy_sqlite','postingStatus':'historical_unposted','lineCount':billLines.length,'lines':billLines});
    }
    for(final item in inventory){
      final v=votes[item['id']];
      if(v!=null&&v.isNotEmpty){
        final sorted=v.entries.toList()..sort((a,b){final d=b.value.compareTo(a.value);return d==0?a.key.compareTo(b.key):d;});
        item['warehouseId']=sorted.first.key;
        item['legacyWarehouseCount']=v.length;
      }
    }
    LegacyStockProjection.attach(inventory,ledger);
    final data=<String,List<Map<String,dynamic>>>{
      'accounts':accounts,'warehouses':warehouses,'inventory':inventory,'ledger':ledger,
      'currencies':t['currencies']!.map((r)=><String,dynamic>{'id':integer(r['id']),'code':r['name'],'name':r['name'],'symbol':r['sympol'],'ratePrimary':numValue(r['amount'],1),'rateSecondary':numValue(r['amount2'],1),'nameSecondary':str(r['name2'])}).toList(),
      'accountGroups':groups.entries.map((e)=><String,dynamic>{'id':e.key,'name':str(e.value['name']),'category':category(str(e.value['name']),e.key),'currencyCode':getCurrency(e.value['cur']??e.value['cur_id']),'sortOrder':integer(e.value['ord'],e.key),'hasBill':flag(e.value['hasbill']??e.value['has_bill']),'isEmployee':flag(e.value['isemp']??e.value['is_emp']),'legacyId':e.key}).toList(),
      'cashboxes':t['cboxes']!.map((r)=><String,dynamic>{'id':integer(r['id']),'name':str(r['name']),'details':str(r['details']),'currencyCode':getCurrency(r['cur']),'isActive':integer(r['state'],1)==1,'state':integer(r['state'],1),'boxType':integer(r['type'],1),'sortOrder':integer(r['ord']),'legacyId':r['id']}).toList(),
    };
    // Preserve the source tables as structured historical records too. No raw
    // SQL is executed, and binary/unknown fields remain in the exact source file.
    for(final table in ['store_trans','trans_details','offers','offer_bill_details','offer_sbill_details','bin','bin_bill_details','bin_bill_details2','alerts']){
      data['source_$table']=[for(final row in t[table]??<Map<String,dynamic>>[])<String,dynamic>{
        for(final e in row.entries)if(e.value==null||e.value is String||e.value is num)e.key:e.value,
      }];
    }
    return BackupCandidate(name,format,bytes,hash,data,{
      'workspace':{'companyName':'مراجعة النسخة القديمة','defaultCurrency':cur.values.isEmpty?'ريال':cur.values.first},
      'invoiceLines':detail.values.fold<int>(0,(s,l)=>s+l.length),'ambiguousMoves':ambiguous,'missingReferences':missing,
      'unknownCurrencies':unknownCurrencies,'orphanDetailBills':detail.keys.where((id)=>!seenMoves.contains(id)).length,
      'sourceExtraCounts':{for(final n in ['store_trans','trans_details','offers','offer_bill_details','offer_sbill_details','bin','bin_bill_details','bin_bill_details2','alerts'])n:t[n]?.length??0},
      'historicalReview':true,'stockUnverified':true,
    },null);
  }

  Future<void> restoreNative(BackupCandidate candidate,{String? replacementSha})async{
    if(candidate.nativeTables==null||sha256.convert(candidate.bytes).toString()!=candidate.sha)throw ArgumentError('Not an intact native backup');
    // Reinspect a private copy of the exact verified bytes, including native
    // SQLite backups. Never trust mutable preview rows or reopen the source path.
    final dir=await Directory.systemTemp.createTemp('nasqo-native-restore-');
    late final Map<String,List<Map<String,dynamic>>> data;
    try{
      final file=await File('${dir.path}/verified.back').writeAsBytes(candidate.bytes,flush:true);
      final verified=await _inspectUncompressed(file,candidate.name);
      if(!verified.native||verified.sha!=candidate.sha)throw const FormatException('Native backup verification failed');
      data=verified.nativeTables!;
    }finally{await dir.delete(recursive:true);}
    // Never use the local replacement workflow to enroll a different
    // synchronized database or restore acknowledged remote history.
    if(replacementSha!=null&&(data['erp_state']!.any((r)=>r['stateKey']=='sync_workspace_binding')||
        data['sync_outbox']!.any((r)=>r['acknowledged_at']!=null||r['server_revision']!=null)||
        ['sync_state','sync_inbox','sync_conflicts'].any((n)=>data[n]!.isNotEmpty))){
      throw StateError('لا يمكن استبدال قاعدة العمل المحلية بنسخة مرتبطة بمزامنة سابقة');
    }
    final db=await local.database;
    await db.transaction((txn)async{
      await prepareRestoreDestination(txn,replacementSha:replacementSha);
      await txn.delete('erp_state');
      for(final n in tables){
        final expected=(await txn.rawQuery('PRAGMA table_info("$n")')).map((r)=>r['name'] as String).toSet();
        final dataRows=data[n]!;
        // Original stock documents precede all returns, including after export sorting.
        final ordered=n=='stock_posting_documents'?[...dataRows.where((r)=>r['original_id']==null&&r['return_original_id']==null),...dataRows.where((r)=>r['original_id']!=null||r['return_original_id']!=null)]:dataRows;
        for(final row in ordered){
          if(row.keys.toSet().difference(expected).isNotEmpty||!row.keys.toSet().containsAll(expected))throw const FormatException('Native column mismatch');
          if(row.values.any((v)=>v!=null&&v is! String&&v is! num))throw const FormatException('Invalid native field type');
          await txn.insert(n,row,conflictAlgorithm:ConflictAlgorithm.abort);
        }
      }
      final integrity=await txn.rawQuery('PRAGMA integrity_check');
      if(integrity.length!=1||integrity.single.values.single!='ok')throw StateError('SQLite integrity verification failed');
      final fk=await txn.rawQuery('PRAGMA foreign_key_check');
      if(fk.isNotEmpty)throw StateError('Foreign key verification failed');
      final unbalanced=await txn.rawQuery('SELECT j.id FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_id=j.id GROUP BY j.id HAVING COUNT(l.id)<2 OR COALESCE(SUM(l.debit_minor),0)!=COALESCE(SUM(l.credit_minor),0) OR COALESCE(SUM(l.debit_minor),0)<=0');
      if(unbalanced.isNotEmpty)throw StateError('Unbalanced native journals');
      final orphan=await txn.rawQuery('SELECT l.id FROM ledger_entries l LEFT JOIN accounts a ON a.id=l.accountId WHERE a.id IS NULL LIMIT 1');
      if(orphan.isNotEmpty)throw StateError('Ledger account missing');
      final orphanStock=await txn.rawQuery('SELECT i.id FROM inventory_items i LEFT JOIN warehouses w ON w.id=i.warehouseId WHERE w.id IS NULL LIMIT 1');
      if(orphanStock.isNotEmpty)throw StateError('Warehouse missing');
      final sources=await txn.query('legacy_operational_source');
      final chunks=await txn.query('legacy_operational_chunks',orderBy:'ordinal');
      if(sources.isNotEmpty){
        final out=BytesBuilder(copy:false);
        for(var i=0;i<chunks.length;i++){
          if(chunks[i]['ordinal']!=i)throw StateError('Missing original source chunk');
          out.add(base64Decode(chunks[i]['data_base64'] as String));
        }
        if(sha256.convert(out.takeBytes()).toString()!=sources.single['sha'])throw StateError('Original source checksum mismatch');
      }else if(chunks.isNotEmpty||(await txn.query('legacy_operational_rows',limit:1)).isNotEmpty||(await txn.query('legacy_unverified_stock',limit:1)).isNotEmpty||(await txn.query('legacy_stock_openings',limit:1)).isNotEmpty){throw StateError('Missing imported source metadata');}
      final invalidOpenings=await txn.rawQuery('''SELECT o.item_id FROM legacy_stock_openings o LEFT JOIN inventory_items i ON i.id=o.item_id LEFT JOIN legacy_operational_rows r ON r.collection='inventory' AND r.record_id=o.source_item_id LEFT JOIN legacy_unverified_stock u ON u.item_id=o.item_id WHERE i.warehouseId<>o.warehouse_id OR r.record_id IS NULL OR u.item_id IS NOT NULL OR (o.ledger_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM journal_lines j WHERE j.journal_id=o.ledger_id AND j.account_id=o.inventory_account_id AND j.debit_minor=o.value_minor AND j.credit_minor=0) OR NOT EXISTS(SELECT 1 FROM journal_lines j WHERE j.journal_id=o.ledger_id AND j.account_id=o.offset_account_id AND j.credit_minor=o.value_minor AND j.debit_minor=0))) LIMIT 1''');
      if(invalidOpenings.isNotEmpty)throw StateError('Invalid stock opening audit');
      await txn.delete('backup_review_active');
    });
  }

  Future<void> openReview(BackupCandidate candidate)async{
    if(candidate.native)throw ArgumentError('Use native restore');
    final db=await local.database;
    await db.transaction((txn)async{
      final old=await txn.query('backup_review_sources',where:'sha = ?',whereArgs:[candidate.sha]);
      if(old.isEmpty){
        await txn.insert('backup_review_sources',{'sha':candidate.sha,'file_name':candidate.name,'source_format':candidate.format,'meta_json':jsonEncode(candidate.meta)});
        final batch=txn.batch();
        for(final c in candidate.collections.entries){
          for(var i=0;i<c.value.length;i++){
            final value=jsonEncode(c.value[i]);
            if(utf8.encode(value).length>512*1024)throw const FormatException('Individual archived record too large');
            batch.insert('backup_review_rows',{'sha':candidate.sha,'collection':c.key,'ordinal':i,'row_json':value});
          }
        }
        for(var i=0;i<candidate.bytes.length;i+=65536){
          final end=i+65536<candidate.bytes.length?i+65536:candidate.bytes.length;
          batch.insert('backup_review_chunks',{'sha':candidate.sha,'ordinal':i~/65536,'data':candidate.bytes.sublist(i,end)});
        }
        await batch.commit(noResult:true);
      }
      await txn.insert('backup_review_active',{'singleton':1,'sha':candidate.sha},conflictAlgorithm:ConflictAlgorithm.replace);
    });
  }
  /// On-device diagnostics for the selected source, not an accounting
  /// certification. Never modify records or infer opening balances here.
  Future<Map<String,dynamic>> reviewReadiness() async {
    final db=await local.database;
    return db.transaction((txn) async {
      final active=await txn.query('backup_review_active',limit:1);
      if(active.length!=1)throw StateError('No selected backup');
      final hash=active.single['sha'] as String;
      final source=(await txn.query('backup_review_sources',where:'sha = ?',whereArgs:[hash])).single;
      final meta=object(jsonDecode(source['meta_json'] as String));
      final data=<String,List<Map<String,dynamic>>>{};
      for(final key in collections){
        final stored=await txn.query('backup_review_rows',columns:['row_json'],
          where:'sha = ? AND collection = ?',whereArgs:[hash,key],orderBy:'ordinal');
        data[key]=stored.map((r)=>object(jsonDecode(r['row_json'] as String))).toList();
      }
      final counts=data.map((k,v)=>MapEntry(k,v.length));
      final issues=<String,int>{};
      void add(String key,[int count=1]){if(count>0)issues[key]=(issues[key]??0)+count;}
      Set<String> identifiers(String collection){
        final ids=<String>{};
        for(final row in data[collection]!){
          final value=str(row['id']);
          if(value.isEmpty||!ids.add(value))add('invalidIdentifiers');
        }
        return ids;
      }
      final accounts=identifiers('accounts');
      final warehouses=identifiers('warehouses');
      final inventory=identifiers('inventory');
      final groups=identifiers('accountGroups');
      final cashboxes=identifiers('cashboxes');
      identifiers('ledger');
      identifiers('currencies');
      final currencies=<String>{
        for(final row in data['currencies']!) if(str(row['name']).isNotEmpty)str(row['name']),
        for(final row in data['currencies']!) if(str(row['code']).isNotEmpty)str(row['code']),
      };
      bool knownCurrency(Object? value)=>currencies.contains(str(value));
      bool finite(Object? value){
        if(value is num)return value.isFinite&&value.abs()<=9007199254740991;
        return false;
      }
      bool missing(Object? value,Set<String> ids)=>str(value).isNotEmpty&&!ids.contains(str(value));
      for(final row in data['accounts']!){
        if(missing(row['groupId'],groups))add('missingGroup');
        if(!knownCurrency(row['currency']))add('unknownCurrency');
        if(!finite(row['openingBalance'])||!finite(row['creditLimit'])||
          !['debit','credit'].contains(row['openingDirection']))add('invalidOpening');
      }
      for(final row in data['inventory']!){
        if(str(row['warehouseId']).isEmpty||missing(row['warehouseId'],warehouses))add('missingWarehouse');
        if(flag(row['quantityUnverified']))add('unverifiedInventory');
        if(!finite(row['quantity'])||!finite(row['avgCost'])||
            (row['quantity'] is num&&(row['quantity'] as num)<0)||
            (row['avgCost'] is num&&(row['avgCost'] as num)<0))add('invalidInventory');
        if(row['currencyCode']!=null&&!knownCurrency(row['currencyCode']))add('unknownCurrency');
      }
      var invoiceLines=0,financialMoves=0;
      for(final row in data['ledger']!){
        if(!accounts.contains(str(row['accountId']))||missing(row['counterpartAccountId'],accounts))add('missingAccount');
        if(missing(row['cashboxId'],cashboxes))add('missingCashbox');
        if(missing(row['warehouseId'],warehouses))add('missingWarehouse');
        if(!knownCurrency(row['currency']))add('unknownCurrency');
        if(!finite(row['amount'])||!finite(row['exchangeRate'])||
            (row['exchangeRate'] is num&&(row['exchangeRate'] as num)<=0))add('invalidFinancialValue');
        final d=row['rawDain'],m=row['rawMadin'];
        if(d is num&&m is num&&d>0&&m>0&&!flag(row['settledOnReceipt']))add('ambiguousSides');
        final lines=rows(row['lines']??[]);
        invoiceLines+=lines.length;
        if((row['lineCount'] is num&&row['lineCount']!=lines.length)||
            (str(row['invoiceContent'])=='items'&&lines.isEmpty))add('missingInvoiceLines');
        for(final line in lines){
          if(missing(line['inventoryItemId'],inventory))add('missingItem');
          if(missing(line['warehouseId'],warehouses))add('missingWarehouse');
          if(!finite(line['quantity'])||!finite(line['price'])||!finite(line['total']))add('invalidLine');
        }
        if(!flag(row['deleted'])&&str(row['postingStatus'])!='draft'&&
          !['quote','order'].contains(row['kind'])){
          financialMoves++;
        }
      }
      // Even a clean projection is not evidence that a historical double-entry
      // journal, stock valuation, and the web balances have been reconciled.
      final liveCounts=<String,int>{};
      for(final table in ['accounts','warehouses','inventory_items','ledger_entries','journal_entries','sync_outbox']){
        liveCounts[table]=Sqflite.firstIntValue(await txn.rawQuery('SELECT COUNT(*) FROM "$table"'))??0;
      }
      final rawMeta=meta['extraCollections'];
      final extra=rawMeta is Map?Map<String,dynamic>.from(rawMeta):<String,dynamic>{};
      return {'format':source['source_format'],'counts':counts,'invoiceLines':invoiceLines,
        'financialMoves':financialMoves,'issues':issues,'liveCounts':liveCounts,
        'extraCollections':extra,'sourceMissingReferences':integer(meta['missingReferences']),
        'sourceAmbiguousMoves':integer(meta['ambiguousMoves']),
        'journalReconciled':false,'readyForActivation':false};
    });
  }

  Future<bool> isReview()async{
    final db=await local.database;
    return (await db.query('backup_review_active',limit:1)).isNotEmpty;
  }
  Future<void> closeReview()async{
    final db=await local.database;
    await db.delete('backup_review_active');
  }
  Future<Uint8List?> exportReviewSource()async{
    final db=await local.database;
    return db.transaction((txn)async{
      final active=await txn.query('backup_review_active',limit:1);
      if(active.isEmpty)return null;
      final hash=active.single['sha'] as String;
      final chunks=await txn.query('backup_review_chunks',where:'sha = ?',whereArgs:[hash],orderBy:'ordinal');
      final out=BytesBuilder(copy:false);
      for(final row in chunks){out.add(row['data'] as Uint8List);}
      final bytes=out.takeBytes();
      if(sha256.convert(bytes).toString()!=hash)throw StateError('Stored archive checksum mismatch');
      return bytes;
    });
  }

  static Future<Map<String,dynamic>?> reviewSnapshot(DatabaseExecutor txn)async{
    final active=await txn.query('backup_review_active',limit:1);
    if(active.isEmpty)return null;
    final hash=active.single['sha'] as String;
    final source=(await txn.query('backup_review_sources',where:'sha = ?',whereArgs:[hash])).single;
    final meta=object(jsonDecode(source['meta_json'] as String));
    final data=<String,dynamic>{};
    for(final key in collections){
      final rr=await txn.query('backup_review_rows',where:'sha = ? AND collection = ?',whereArgs:[hash,key],orderBy:'ordinal');
      data[key]=rr.map((r){
        final row=object(jsonDecode(r['row_json'] as String));
        // Owner IDs are local review identifiers only.
        if(['accounts','warehouses','inventory','ledger'].contains(key))row['ownerId']='local-erp-workspace';
        if(key=='accounts'){
          row.addAll({'accountImage':row['accountImage']??'1','sortOrder':row['sortOrder']??row['codeNumber']??0,
            'settlement':row['settlement']??false,'documentNumberRequired':row['documentNumberRequired']??false,
            'messageMethod':row['messageMethod']??'sms','sendMode':row['sendMode']??'never'});
        }
        if(key=='ledger'){
          row.remove('lines');
          row['counterpartAccountId']??='';
          row['counterpartAccountName']??='';
          row['details']??='';
          row['documentNumber']??='';
          row['warehouseId']??='';
          row['warehouseName']??='';
        }
        // Imported source bytes remain exact. Only known presentation fields
        // are exposed to JavaScript; arbitrary object keys never cross the bridge.
        const allowed=<String,Set<String>>{
          'accounts':{'id','ownerId','groupId','name','category','phone','creditLimit','currency','isCashAccount',
            'accountImage','sortOrder','settlement','documentNumberRequired','messageMethod','sendMode','note','openingBalance','openingDirection','codeNumber','legacyRef'},
          'warehouses':{'id','ownerId','name','details','isDefault','codeNumber','legacyRef'},
          'inventory':{'id','ownerId','name','unit','quantity','avgCost','sellingPrice','minThreshold','sku','unit2','count2','sprice2','unit3','count3','sprice3','defaultUnit','currencyCode','isActive','expiryDate','legacyId','warehouseId','computedQuantity','quantityUnverified','legacyRef'},
          'ledger':{'id','ownerId','accountId','accountName','counterpartAccountId','counterpartAccountName','cashboxId','kind','typeLabel','payment','direction','amount','rawDain','rawMadin','settledOnReceipt','currency','exchangeRate','taxAmount','discount','details','documentNumber','warehouseId','warehouseName','invoiceContent','entryNumber','deleted','entryDate','dueDate','expenseCategory','sourceOrigin','postingStatus','paidAmount','docType','lineCount','createdAtMs','legacyRef'},
          'currencies':{'id','name','code','symbol','ratePrimary','rateSecondary','nameSecondary','legacyId'},
          'accountGroups':{'id','name','category','currencyCode','hasBill','isEmployee','sortOrder','legacyId'},
          'cashboxes':{'id','name','details','currencyCode','state','boxType','sortOrder','isActive','legacyId'},
        };
        row.removeWhere((k,v)=>!allowed[key]!.contains(k)||v is Map||v is List);
        row.removeWhere((k,v)=>v==null);
        return row;
      }).toList();
    }
    if(['legacy-sqlite','legacy-sql'].contains(source['source_format'])){
      // Also repair review archives created before stock projection was added.
      final raw=await txn.query('backup_review_rows',where:'sha = ? AND collection = ?',whereArgs:[hash,'ledger']);
      LegacyStockProjection.attach((data['inventory'] as List).cast<Map<String,dynamic>>(),raw.map((r)=>object(jsonDecode(r['row_json'] as String))));
    }
    final ws=object(meta['workspace']);
    return {...data,'workspaceId':'local-erp-workspace','userEmail':'offline@nasqo.local',
      'workspace':{'id':'local-erp-workspace','ownerId':'local-erp-workspace','companyName':str(ws['companyName']),
        'defaultCurrency':str(ws['defaultCurrency'],'ريال'),'whatsappProvider':'nasqo','whatsappInstantEnabled':false,'whatsappPhone':''},
      'capabilities':{'offlineReady':true,'readOnlyFinancial':true,'filePickerSupported':true,
        'printingSupported':true,'pdfExportSupported':true,'googleDriveConfigured':false,'whatsappShareSupported':true},
      'snapshotVersion':1,'activeCurrency':str(ws['defaultCurrency'],'ريال'),'backupReview':true};
  }
  static Future<Map<String,dynamic>?> reviewInvoice(DatabaseExecutor txn,String id)async{
    final active=await txn.query('backup_review_active',limit:1);
    if(active.isEmpty)return null;
    final hash=active.single['sha'] as String;
    final rr=await txn.query('backup_review_rows',where:'sha = ? AND collection = ?',whereArgs:[hash,'ledger'],orderBy:'ordinal');
    for(final row in rr){
      final entry=object(jsonDecode(row['row_json'] as String));
      if(entry['id']!=id)continue;
      final raw=rows(entry.remove('lines')??[]);
      return {'entry':entry,'lines':[for(var i=0;i<raw.length;i++){'id':i+1,'sku':'','warehouseName':'','expiryDate':'',...raw[i]}]};
    }
    throw StateError('Archived invoice not found');
  }
}
