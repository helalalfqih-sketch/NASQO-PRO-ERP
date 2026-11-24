import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import 'local_database.dart';

/// Native backups restore all operational tables. Older web/SmartPro backups
/// are imported into isolated, persistent, read-only SQLite review tables.
class BackupCandidate {
  const BackupCandidate(this.name,this.format,this.bytes,this.sha,this.collections,
    this.meta,this.nativeTables);
  final String name,format,sha;
  final Uint8List bytes;
  final Map<String,List<Map<String,dynamic>>> collections;
  final Map<String,dynamic> meta;
  final Map<String,List<Map<String,dynamic>>>? nativeTables;
  bool get native => nativeTables!=null;
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
  ];
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
  static bool flag(Object? v)=>v==true||v==1;
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

  Future<Uint8List> exportNative()async{
    final db=await local.database;
    final data=await db.transaction((t)async{
      await LocalDatabase.requireLiveWorkspace(t);
      return <String,dynamic>{for(final name in tables)name:await t.query(name)};
    });
    final payload=jsonEncode({'schemaVersion':LocalDatabase.dbVersion,'tables':data});
    final bytes=Uint8List.fromList(utf8.encode(jsonEncode({
      'format':nativeFormat,'sha256':sha256.convert(utf8.encode(payload)).toString(),'payload':payload,
    })));
    if(bytes.length>maxBytes)throw StateError('Backup exceeds supported size');
    return bytes;
  }

  Future<BackupCandidate> inspect(File file,String name)async{
    final length=await file.length();
    if(length<1||length>maxBytes)throw const FormatException('Unsupported file size');
    final bytes=await file.readAsBytes();
    final hash=sha256.convert(bytes).toString();
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
        if(names.containsAll(tables)&&!names.contains('workspaces')){
          if(names.contains('backup_review_sources')&&(await get('backup_review_sources')).isNotEmpty)throw const FormatException('Use the native export option for operational data or export the archived original separately');
          final core={for(final table in tables)table:await get(table)};
          return BackupCandidate(name,'native-sqlite',bytes,hash,{}, {},core);
        }
        if(names.containsAll(['customers','stores','products'])&&(names.contains('input_move')||names.contains('bounds'))){
          final sourceTables=<String,List<Map<String,dynamic>>>{};
          for(final n in ['customers','stores','products','currencies','boxes','cboxes','input_move','bounds','bill_details','bill_details2']){
            sourceTables[n]=await get(n);
          }
          return _legacy(name,bytes,hash,sourceTables);
        }
        if(names.containsAll(['workspaces','accounts','warehouses','inventory_items','ledger_entries'])){
          final workspace=await get('workspaces');
          if(workspace.length!=1)throw const FormatException('Select a single-workspace backup');
          final ws=ident(workspace.single['id']);
          final core=<String,List<Map<String,dynamic>>>{};
          for(final n in ['accounts','warehouses','inventory_items','ledger_entries','currencies','account_groups','cashboxes','invoice_lines']){
            final data=await get(n);
            if(data.any((r)=>r['workspace_id']!=ws))throw const FormatException('Mixed workspaces');
            core[n]=data;
          }
          return _serverSqlite(name,bytes,hash,workspace.single,core);
        }
        throw const FormatException('Unknown SQLite backup schema');
      }finally{await source.close();}
    }
    final decoded=utf8.decode(bytes).replaceFirst('\uFEFF','');
    final root=object(jsonDecode(decoded));
    if(root['format']==nativeFormat){
      final payload=root['payload'];
      if(payload is! String||sha256.convert(utf8.encode(payload)).toString()!=root['sha256'])throw const FormatException('Backup checksum mismatch');
      final body=object(jsonDecode(payload));
      if(body['schemaVersion']!=LocalDatabase.dbVersion)throw const FormatException('Native backup schema version mismatch');
      final data=object(body['tables']);
      if(data.keys.toSet().difference(tables.toSet()).isNotEmpty||!data.keys.toSet().containsAll(tables))throw const FormatException('Incomplete native backup');
      return BackupCandidate(name,nativeFormat,bytes,hash,{}, {},{for(final n in tables)n:rows(data[n])});
    }
    if(!knownFormats.contains(root['format'])||![1,2].contains(root['version']))throw const FormatException('Unsupported JSON backup format');
    return _web(name,bytes,hash,root);
  }

  BackupCandidate _web(String name,Uint8List bytes,String hash,Map<String,dynamic> root){
    final ws=object(root['workspace']);
    if(str(ws['companyName']).trim().isEmpty)throw const FormatException('Company name missing');
    final data={for(final k in collections)k:rows(root[k]??[])};
    if(!['accounts','warehouses','inventory','ledger'].every(root.containsKey))throw const FormatException('Incomplete core backup');
    final accountIds=<String>{};
    final warehouseIds=<String>{};
    final inventoryIds=<String>{};
    final ledgerIds=<String>{};
    for(final row in data['accounts']!){
      final id=ident(row['id']);
      if(!accountIds.add(id)||str(row['name']).trim().isEmpty)throw const FormatException('Invalid account');
      numValue(row['openingBalance']);numValue(row['creditLimit']);
      if(!['purchases','sales','clients','employees','transfers','shop'].contains(row['category']))throw const FormatException('Unknown account category');
    }
    for(final row in data['warehouses']!){if(!warehouseIds.add(ident(row['id']))||str(row['name']).trim().isEmpty)throw const FormatException('Invalid warehouse');}
    for(final row in data['inventory']!){
      if(!inventoryIds.add(ident(row['id']))||str(row['name']).trim().isEmpty)throw const FormatException('Invalid inventory row');
      numValue(row['quantity']);numValue(row['avgCost']);
    }
    var missingRefs=0;
    var lineCount=0;
    for(final row in data['ledger']!){
      if(!ledgerIds.add(ident(row['id'])))throw const FormatException('Duplicate ledger identity');
      numValue(row['amount']);numValue(row['rawDain']);numValue(row['rawMadin']);
      if(!accountIds.contains(row['accountId']))missingRefs++;
      if(str(row['counterpartAccountId']).isNotEmpty&&!accountIds.contains(row['counterpartAccountId']))missingRefs++;
      final ls=rows(row['lines']??[]);
      if(row['lineCount'] is num&&row['lineCount']!=ls.length)throw const FormatException('Missing invoice detail rows');
      lineCount+=ls.length;
      // Preserve historical raw amount semantics, never manufacture journal legs.
    }
    final other={for(final k in ['stockTransfers','priceOffers'])k:rows(root[k]??[]).length};
    return BackupCandidate(name,str(root['format']),bytes,hash,data,{
      'workspace':ws,'invoiceLines':lineCount,'missingReferences':missingRefs,
      'extraCollections':other,'historicalReview':true,
    },null);
  }

  BackupCandidate _serverSqlite(String name,Uint8List bytes,String hash,Map<String,dynamic> ws,Map<String,List<Map<String,dynamic>>> t){
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
    return _web(name,bytes,hash,{
      'format':'nasqo-unified-sqlite-export-v2','version':2,
      'workspace':{'companyName':str(ws['company_name'],'نسقو برو'),'defaultCurrency':currency(ws['default_currency'])},
      'currencies':t['currencies']!.map((r)=>{'id':r['id'],'name':r['name'],'code':r['code'],'symbol':r['symbol'],'ratePrimary':r['rate_primary'],'rateSecondary':r['rate_secondary'],'nameSecondary':r['name_secondary']}).toList(),
      'accountGroups':t['account_groups']!.map((r)=>{'id':r['id'],'name':r['name'],'category':r['category'],'currencyCode':r['currency_code'],'sortOrder':r['sort_order'],'hasBill':flag(r['has_bill']),'isEmployee':flag(r['is_employee']),'legacyId':r['legacy_id']}).toList(),
      'cashboxes':t['cashboxes']!.map((r)=>{'id':r['id'],'name':r['name'],'details':r['details'],'currencyCode':r['currency_code'],'isActive':flag(r['state']),'state':r['state'],'boxType':r['box_type'],'sortOrder':r['sort_order'],'legacyId':r['legacy_id']}).toList(),
      'accounts':t['accounts']!.map((r)=>{'id':r['id'],'name':r['name'],'groupId':r['group_id'],'category':r['category'],'phone':r['phone'],'creditLimit':r['credit_limit'],'currency':currency(r['currency']),'isCashAccount':flag(r['is_cash_account']),'openingBalance':r['opening_balance'],'openingDirection':r['opening_direction'],'note':r['note'],'codeNumber':r['code_number'],'sortOrder':r['sort_order'],'accountImage':r['account_image'],'settlement':flag(r['settlement']),'documentNumberRequired':flag(r['document_number_required']),'messageMethod':r['message_method'],'sendMode':r['send_mode'],'legacyRef':r['legacy_ref']}).toList(),
      'warehouses':t['warehouses']!.map((r)=>{'id':r['id'],'name':r['name'],'details':r['details'],'isDefault':flag(r['is_default']),'codeNumber':r['code_number'],'legacyRef':r['legacy_ref']}).toList(),
      'inventory':t['inventory_items']!.map((r)=>{'id':r['id'],'name':r['name'],'unit':r['unit'],'quantity':r['quantity'],'avgCost':r['avg_cost'],'sellingPrice':r['selling_price'],'sku':r['sku'],'minThreshold':r['min_threshold'],'warehouseId':r['warehouse_id'],'currencyCode':r['currency_code'],'quantityUnverified':flag(r['quantity_unverified']),'unit2':r['unit2'],'count2':r['count2'],'sprice2':r['sprice2'],'unit3':r['unit3'],'count3':r['count3'],'sprice3':r['sprice3'],'defaultUnit':r['default_unit'],'isActive':r['bstate']!=0,'expiryDate':r['expiry_date'],'legacyId':r['legacy_id'],'legacyRef':r['legacy_ref'],if(flag(r['quantity_unverified'])&&computed.containsKey(str(r['id'])))'computedQuantity':computed[str(r['id'])]}).toList(),
      'ledger':t['ledger_entries']!.map((r)=>{'id':r['id'],'accountId':r['account_id'],'accountName':r['account_name'],'counterpartAccountId':r['counterpart_account_id'],'counterpartAccountName':r['counterpart_account_name'],'cashboxId':r['cashbox_id'],'kind':r['kind'],'typeLabel':r['type_label'],'payment':r['payment'],'direction':r['direction'],'amount':r['amount'],'rawDain':r['raw_dain'],'rawMadin':r['raw_madin'],'settledOnReceipt':flag(r['settled_on_receipt']),'currency':currency(r['currency']),'exchangeRate':r['exchange_rate'],'details':r['details'],'documentNumber':r['document_number'],'warehouseId':r['warehouse_id'],'warehouseName':r['warehouse_name'],'invoiceContent':r['invoice_content'],'entryNumber':r['entry_number'],'deleted':flag(r['deleted']),'entryDate':r['entry_date'],'createdAtMs':r['created_at_ms'],'postingStatus':r['posting_status'],'taxAmount':r['tax_amount'],'discount':r['discount'],'docType':r['doc_type'],'sourceOrigin':r['source_origin'],'dueDate':r['due_date'],'expenseCategory':r['expense_category'],'paidAmount':r['paid_amount'],'legacyRef':r['legacy_ref'],'lineCount':(ls[str(r['id'])]??[]).length,'lines':ls[str(r['id'])]??[]}).toList(),
    });
  }

  BackupCandidate _legacy(String name,Uint8List bytes,String hash,Map<String,List<Map<String,dynamic>>> t){
    final cur={for(final r in t['currencies']!)integer(r['id']):str(r['name'],'ريال')};
    String getCurrency(Object? id)=>cur[integer(id,1)]??'عملة غير معرّفة (${str(id)})';
    String category(String group,int type){
      if(group.contains('مورد')||group.contains('مشتريات'))return 'purchases';
      if(group.contains('موظف'))return 'employees';
      if(group.contains('مبيعات'))return 'sales';
      if(group.contains('صندوق')||group.contains('حوال'))return 'transfers';
      if(group.contains('مصروف')||group.contains('محل'))return 'shop';
      if(group.contains('عميل')||group.contains('عملاء'))return 'clients';
      return const {3:'purchases',4:'employees',5:'shop',6:'transfers'}[type]??'clients';
    }
    final groups={for(final r in t['boxes']!)integer(r['id']):r};
    final accounts=<Map<String,dynamic>>[];
    for(final r in t['customers']!){
      final id=integer(r['id']),type=integer(r['type'],1),group=groups[type];
      accounts.add({'id':'legacy-acc-$id','name':str(r['name'],'حساب $id'),'category':category(str(group?['name']),type),
        'phone':str(r['phone']??r['phon']),'creditLimit':numValue(r['lim']),'currency':getCurrency(group?['cur']??1),
        'isCashAccount':id==1||str(r['name']).contains('نقد'),'openingBalance':0,'openingDirection':'debit',
        'note':str(r['details']),'codeNumber':id,'sortOrder':id,if(group!=null)'groupId':type});
    }
    final warehouses=t['stores']!.map((r)=> <String,dynamic>{'id':'legacy-wh-${integer(r['id'])}','name':str(r['name']),'details':str(r['details']),'isDefault':integer(r['id'])==1,'codeNumber':integer(r['id'])}).toList();
    final inventory=t['products']!.map((r)=> <String,dynamic>{
      'id':'legacy-prod-${integer(r['id'])}','name':str(r['name']),'unit':str(r['unit'],'حبة'),
      'quantity':0,'quantityUnverified':true,'avgCost':numValue(r['price2']),'sellingPrice':numValue(r['price']),
      'sku':str(r['barcode']),'warehouseId':warehouses.isEmpty?'':warehouses.first['id'],
      'unit2':str(r['unit2']),'count2':numValue(r['count2']),'sprice2':numValue(r['sprice2']),
      'unit3':str(r['unit3']),'count3':numValue(r['count3']),'sprice3':numValue(r['sprice3']),
      'defaultUnit':integer(r['defunit'],1),'currencyCode':getCurrency(r['cur']),
    }).toList();
    final names={for(final a in accounts)a['id']:a['name']};
    final prodNames={for(final a in inventory)a['id']:a['name']};
    final detail=<int,List<Map<String,dynamic>>>{};
    for(final n in ['bill_details','bill_details2']){
      for(final r in t[n]!){
        final bill=integer(r['bill_id']),pid='legacy-prod-${integer(r['prod_id'])}';
        detail.putIfAbsent(bill,()=>[]).add({'lineKind':n=='bill_details'?'item':'free',
          if(n=='bill_details')'inventoryItemId':pid,'itemName':prodNames[pid]??str(r['details']),
          'warehouseId':'legacy-wh-${integer(r['store_id'])}','price':numValue(r['price']),
          'quantity':numValue(r['amount']),'total':numValue(r['total']),'discount':numValue(r['discount']),
          'bonus':numValue(r['bonus']),'unit':str(r['unit']),'unitNum':integer(r['unitnum'],1),'details':str(r['details'])});
      }
    }
    final ledger=<Map<String,dynamic>>[];
    var ambiguous=0,missing=0;
    final moves=t['input_move']!.isNotEmpty?t['input_move']!:t['bounds']!;
    for(final r in moves){
      final id=integer(r['id']),aid='legacy-acc-${integer(r['per_id']??r['acc_id'])}';
      final d=numValue(r['dain']),c=numValue(r['madin']);
      if(d>0&&c>0)ambiguous++;
      if(!names.containsKey(aid))missing++;
      final doc=integer(r['bill_type']??r['doc_type'],1);
      final kind=[2,3,7,9].contains(doc)?'invoice':[4,5].contains(doc)?'return':'voucher';
      final typeLabel=const {2:'فاتورة بيع',3:'فاتورة شراء',4:'مردود مبيعات',5:'مردود مشتريات',7:'فاتورة بيع حرة',9:'فاتورة شراء حرة'}[doc]??'سند تاريخي';
      final settled=d>0&&c>0&&(d-c).abs()<0.01;
      final year=integer(r['year']),month=integer(r['month']),day=integer(r['day']);
      String date=str(r['date']);
      if(date.isEmpty&&year>1900&&month>=1&&month<=12&&day>=1&&day<=31){
        date='$year-${month.toString().padLeft(2,'0')}-${day.toString().padLeft(2,'0')}';
      }
      final nd=str(r['ndate']);
      if(date.isEmpty&&RegExp(r'^[0-9]{8}$').hasMatch(nd)&&nd!='00000000')date='${nd.substring(0,4)}-${nd.substring(4,6)}-${nd.substring(6,8)}';
      ledger.add({'id':'legacy-ent-$id','accountId':aid,'accountName':names[aid]??'حساب غير مرتبط',
        'counterpartAccountId':'','counterpartAccountName':'','kind':kind,'typeLabel':typeLabel,'payment':settled?'cash':'credit',
        'direction':settled?([2,5,7].contains(doc)?'debit':'credit'):(d>=c?'debit':'credit'),
        'amount':d>=c?d:c,'rawDain':d,'rawMadin':c,'settledOnReceipt':settled,'currency':getCurrency(r['cur']),
        'exchangeRate':numValue(r['curprice'],1),'details':str(r['details']),'documentNumber':str(r['bill']),
        'warehouseId':'','warehouseName':'','invoiceContent':[7,9].contains(doc)?'free':kind=='voucher'?'none':'items',
        'entryNumber':id,'entryDate':date,'createdAtMs':DateTime.tryParse(date)?.millisecondsSinceEpoch??0,
        'deleted':false,'docType':doc,'sourceOrigin':'legacy_sqlite','postingStatus':'historical_unposted','lines':detail[id]??[]});
    }
    final data=<String,List<Map<String,dynamic>>>{
      'accounts':accounts,'warehouses':warehouses,'inventory':inventory,'ledger':ledger,
      'currencies':t['currencies']!.map((r)=><String,dynamic>{'id':r['id'],'code':r['name'],'name':r['name'],'symbol':r['sympol'],'ratePrimary':numValue(r['amount'],1),'rateSecondary':numValue(r['amount2'],1),'nameSecondary':str(r['name2'])}).toList(),
      'accountGroups':groups.entries.map((e)=><String,dynamic>{'id':e.key,'name':str(e.value['name']),'category':category(str(e.value['name']),e.key),'currencyCode':getCurrency(e.value['cur']),'sortOrder':e.key}).toList(),
      'cashboxes':t['cboxes']!.map((r)=><String,dynamic>{'id':r['id'],'name':str(r['name']),'details':str(r['details']),'currencyCode':getCurrency(r['cur']),'isActive':flag(r['state'])}).toList(),
    };
    return BackupCandidate(name,'legacy-sqlite',bytes,hash,data,{
      'workspace':{'companyName':'مراجعة النسخة القديمة','defaultCurrency':cur.values.isEmpty?'ريال':cur.values.first},
      'invoiceLines':detail.values.fold<int>(0,(s,l)=>s+l.length),'ambiguousMoves':ambiguous,'missingReferences':missing,
      'historicalReview':true,'stockUnverified':true,
    },null);
  }

  Future<void> restoreNative(BackupCandidate candidate)async{
    final data=candidate.nativeTables;
    if(data==null)throw ArgumentError('Not a native backup');
    final db=await local.database;
    await db.transaction((txn)async{
      await LocalDatabase.requireLiveWorkspace(txn);
      // No implicit replacement of business data, pending sync or enrollment.
      for(final n in tables.where((n)=>n!='erp_state')){
        if((await txn.query(n,limit:1)).isNotEmpty)throw StateError('Destination contains live data; export it first and restore to an empty installation');
      }
      if((await txn.query('erp_state',where:'stateKey = ?',whereArgs:['sync_workspace_binding'])).isNotEmpty)throw StateError('Destination is enrolled');
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
      final fk=await txn.rawQuery('PRAGMA foreign_key_check');
      if(fk.isNotEmpty)throw StateError('Foreign key verification failed');
      final unbalanced=await txn.rawQuery('SELECT j.id FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_id=j.id GROUP BY j.id HAVING COUNT(l.id)<2 OR COALESCE(SUM(l.debit_minor),0)!=COALESCE(SUM(l.credit_minor),0) OR COALESCE(SUM(l.debit_minor),0)<=0');
      if(unbalanced.isNotEmpty)throw StateError('Unbalanced native journals');
      final orphan=await txn.rawQuery('SELECT l.id FROM ledger_entries l LEFT JOIN accounts a ON a.id=l.accountId WHERE a.id IS NULL LIMIT 1');
      if(orphan.isNotEmpty)throw StateError('Ledger account missing');
      final orphanStock=await txn.rawQuery('SELECT i.id FROM inventory_items i LEFT JOIN warehouses w ON w.id=i.warehouseId WHERE w.id IS NULL LIMIT 1');
      if(orphanStock.isNotEmpty)throw StateError('Warehouse missing');
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
    final ws=object(meta['workspace']);
    return {...data,'workspaceId':'local-erp-workspace','userEmail':'offline@nasqo.local',
      'workspace':{'id':'local-erp-workspace','ownerId':'local-erp-workspace','companyName':str(ws['companyName']),
        'defaultCurrency':str(ws['defaultCurrency'],'ريال'),'whatsappProvider':'nasqo','whatsappInstantEnabled':false,'whatsappPhone':''},
      'capabilities':{'offlineReady':true,'readOnlyFinancial':true,'filePickerSupported':true,
        'printingSupported':false,'pdfExportSupported':false,'googleDriveConfigured':false,'whatsappShareSupported':false},
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
