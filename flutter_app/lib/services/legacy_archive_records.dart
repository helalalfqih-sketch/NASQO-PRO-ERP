import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'legacy_history_archive.dart';
import 'legacy_record_date.dart';
import 'local_database.dart';

/// Read legacy records in their normal application destinations. Reading or
/// acknowledging an old reminder never posts, undeletes, or schedules it.
class LegacyArchiveRecords {
  LegacyArchiveRecords(this.local);
  final LocalDatabase local;
  static const kinds={'offers','trash','alerts'};
  static String s(Object? value)=>value?.toString()??'';
  static num n(Object? value){
    final result=num.tryParse(s(value).replaceAll(',',''));
    return result!=null&&result.isFinite?result:0;
  }
  static bool validNumber(Object? value){
    if(value==null||s(value).trim().isEmpty)return true;
    final result=num.tryParse(s(value).replaceAll(',',''));
    return result!=null&&result.isFinite&&result>=0;
  }
  static String date(Map<String,dynamic> r){
    for(final value in [r['date'],r['offerDate'],r['mdate']]){
      final text=s(value).trim();
      final iso=RegExp(r'^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])').firstMatch(text);
      if(iso!=null){
        final result=LegacyRecordDate.read({'date':'${iso[1]}-${iso[2]}-${iso[3]}'});
        if(result.isNotEmpty)return result;
      }
    }
    return LegacyRecordDate.read(r);
  }

  Future<Map<String,dynamic>> handle(Map<String,dynamic> p)async{
    if(p['workspaceId']!='local-erp-workspace'||!kinds.contains(p['recordKind'])||
        !['list','detail','alertState'].contains(p['operation']))throw ArgumentError('Invalid archive request');
    final db=await local.database;
    final active=await db.query('backup_review_active',limit:1);
    final sources=active.isEmpty?await db.query('legacy_operational_source',limit:1)
      :await db.query('backup_review_sources',where:'sha = ?',whereArgs:[active.single['sha']]);
    if(sources.isEmpty)return {'available':false,'items':<dynamic>[],'totalCount':0,'nextOffset':null};
    final sha=s(sources.single['sha']),kind=p['recordKind'] as String;
    final archive=await LegacyHistoryArchive(local).load();
    Future<List<Map<String,dynamic>>> sourceRows(String collection)async{
      final rows=active.isEmpty?await db.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[collection])
        :await db.query('backup_review_rows',columns:['row_json'],where:'sha = ? AND collection = ?',whereArgs:[sha,collection]);
      return rows.map((r)=>Map<String,dynamic>.from(jsonDecode(r['row_json'] as String) as Map)).toList();
    }
    final accounts={for(final a in active.isEmpty?await db.query('accounts',columns:['id','name']):await sourceRows('accounts'))s(a['id']):a};
    final inventory={for(final a in active.isEmpty?await db.query('inventory_items',columns:['id','name','warehouseId']):await sourceRows('inventory'))s(a['id']):a};
    final warehouses={for(final a in active.isEmpty?await db.query('warehouses',columns:['id','name']):await sourceRows('warehouses'))s(a['id']):a};
    final currencies={for(final a in await sourceRows('currencies'))s(a['id']):s(a['code'])};
    final nowActive=await db.query('backup_review_active',limit:1);
    final nowSource=nowActive.isEmpty?await db.query('legacy_operational_source',limit:1)
      :await db.query('backup_review_sources',where:'sha = ?',whereArgs:[nowActive.single['sha']]);
    if(nowActive.isEmpty!=active.isEmpty||nowSource.isEmpty||nowSource.single['sha']!=sha)throw StateError('Source changed');
    String ref(Object? raw,String prefix,Map values)=>values.containsKey(s(raw))?s(raw):'$prefix${s(raw)}';
    final table=kind=='offers'?'source_offers':kind=='trash'?'source_bin':'source_alerts';
    final rows=archive[table]??[];
    final states={for(final row in await db.query('erp_state',where:'stateKey LIKE ?',whereArgs:['legacy_alert_state:$sha:%']))
      s(row['stateKey']):jsonDecode(row['payloadJson'] as String) as Map};
    Map<String,dynamic> record(Map<String,dynamic> r,{bool detail=false}){
      final id=s(r['id']),accountId=ref(r['per_id']??r['accountId'],'legacy-acc-',accounts),account=accounts[accountId];
      final rawCurrency=s(r['currencyCode']??r['currency']);
      final c=rawCurrency.isNotEmpty?(const {'sar':'ريال','usd':'دولار','eur':'يورو'}[rawCurrency]??rawCurrency)
        :currencies[s(r['cur']??1)]??'عملة غير معرّفة (${r['cur']??1})';
      final doc=n(r['bill_type']??r['offerType']??r['type']).toInt();
      final debit=n(r['dain']??r['rawDain']),credit=n(r['madin']??r['rawMadin']);
      final validAmount=[r['dain']??r['rawDain'],r['madin']??r['rawMadin'],r['amount']].every(validNumber);
      final state=states['legacy_alert_state:$sha:$id']??{};
      final result=<String,dynamic>{'id':id,'sourceSha':sha,'recordKind':kind,
        'accountId':account==null?'':accountId,'accountName':account?['name']??r['pername']??'حساب غير مرتبط',
        'entryDate':date(r),'details':s(r[kind=='alerts'?'det':'details']),
        'amount':r['amount']!=null?n(r['amount']):debit>=credit?debit:credit,
        'currency':c,'documentNumber':s(r['bill']??r['documentNumber']),'sourceReference':s(r['ref']??r['sourceReference']),
        'headerDiscount':n(r['discount_amount']??r['headerDiscount']),'docType':doc,
        'direction':r['direction']??(debit>=credit?'debit':'credit'),
        'payment':r['payment']??(debit>0&&debit==credit?'cash':'credit'),
        if(n(r['cboxid']??r['cashboxId'])>0)'cashboxId':n(r['cboxid']??r['cashboxId']),
        'exchangeRate':n(r['exchangeRate']??r['curprice']??1),
        'amountValid':validAmount,
        if(!validAmount||![r['discount_amount']??r['headerDiscount'],r['exchangeRate']??r['curprice']].every(validNumber))
          'draftBlockedReason':'قيمة مالية في المصدر غير صالحة؛ راجع الحقول الأصلية قبل إنشاء مسودة.',
        'deleted':kind=='trash','read':state['read']==true,'dismissed':state['dismissed']==true};
      if(detail){
        final itemTable=kind=='offers'?'source_offer_bill_details':'source_bin_bill_details';
        final freeTable=kind=='offers'?'source_offer_sbill_details':'source_bin_bill_details2';
        result['fields']=r;
        Map<String,dynamic> normalizedLine(Map<String,dynamic> line,bool item){
          final itemId=item?ref(line['prod_id']??line['inventoryItemId'],'legacy-prod-',inventory):'';
          final warehouse=item?(line['warehouseId']!=null?s(line['warehouseId']):
            kind=='offers'?s(inventory[itemId]?['warehouseId']):ref(line['store_id'],'legacy-wh-',warehouses)):'';
          return {'id':s(line['id']),'lineKind':item?'item':'free','inventoryItemId':itemId,
            'itemName':item?s(line['itemName']??inventory[itemId]?['name']??line['details']):s(line['details']),
            'warehouseId':warehouse,'warehouseName':s(warehouses[warehouse]?['name']),
            'quantity':n(line['amount']??line['quantity']),'price':n(line['price']),'total':n(line['total']),
            'discount':n(line['discount']),'bonus':n(line['bonus']),'unit':s(line['unit']),
            'unitNum':n(line['unitnum']??line['unitNum']??1),'details':s(line['details']),
            'expiryDate':s(line['exdate']??line['expiryDate']),'sourceFields':line};
        }
        result['lines']=kind=='alerts'?<dynamic>[]:[
          for(final pair in [[itemTable,true],[freeTable,false]])
            for(final line in archive[pair[0]]??<Map<String,dynamic>>[])
              if(s(line['bill_id'])==id)normalizedLine(line,pair[1]==true)
        ];
        if((result['lines'] as List).any((l)=>!['amount','quantity','price','total','discount','bonus'].every((key)=>validNumber(l['sourceFields'][key])))){
          result['draftBlockedReason']='قيمة في أحد البنود الأصلية غير صالحة؛ لا يمكن نسخها كمبلغ صفري.';
        }
      }
      return result;
    }
    if(p['operation']=='detail'||p['operation']=='alertState'){
      if(p['sourceSha']!=sha)throw StateError('تغيرت النسخة المستوردة؛ أعد فتح القائمة.');
      final selected=rows.where((r)=>s(r['id'])==p['recordId']).toList();
      if(selected.length!=1)throw StateError('السجل غير موجود.');
      if(p['operation']=='alertState'){
        if(kind!='alerts'||active.isNotEmpty||p['read'] is! bool||p['dismissed'] is! bool)throw ArgumentError('Invalid reminder state');
        await db.transaction((t)async{
          await LocalDatabase.requireLiveWorkspace(t);
          final current=await t.query('legacy_operational_source',limit:1);
          if(current.isEmpty||current.single['sha']!=sha)throw StateError('Source changed');
          await t.insert('erp_state',{'stateKey':'legacy_alert_state:$sha:${p['recordId']}',
            'payloadJson':jsonEncode({'read':p['read'],'dismissed':p['dismissed']}),
            'updatedAt':DateTime.now().toUtc().toIso8601String()},conflictAlgorithm:ConflictAlgorithm.replace);
        });
        return {'saved':true};
      }
      return {'available':true,'record':record(selected.single,detail:true)};
    }
    final offset=p['offset']??0,limit=p['limit']??50,query=s(p['query']).trim().toLowerCase();
    if(offset is! int||offset<0||limit is! int||limit<1||limit>100||query.length>100)throw ArgumentError('Invalid archive page');
    final items=rows.map((r)=>record(r)).where((r)=>query.isEmpty||
      [r['id'],r['accountName'],r['details'],r['documentNumber']].any((v)=>s(v).toLowerCase().contains(query))).toList()
      ..sort((a,b){final d=s(b['entryDate']).compareTo(s(a['entryDate']));return d!=0?d:s(b['id']).compareTo(s(a['id']));});
    final page=items.skip(offset).take(limit).toList();
    return {'available':true,'sourceSha':sha,'items':page,'totalCount':items.length,
      'nextOffset':offset+page.length<items.length?offset+page.length:null,'readOnlyReview':active.isNotEmpty};
  }
}
