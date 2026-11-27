import 'legacy_stock_projection.dart';

/// Historical projections only. No records, stock counts or journals are
/// changed. Missing transfer endpoints are not substituted with default stores.
class LegacyHistoryReports {
  static String s(Object? value)=>value?.toString()??'';
  static num n(Object? value)=>LegacyStockProjection.number(value);
  static bool knownCurrency(Object? value)=>s(value).isNotEmpty&&!s(value).startsWith('عملة غير معرّفة');
  static bool allCurrencies(String value)=>['','الكل','جميع العملات'].contains(value);

  static Map<String,dynamic> transfers(
    Iterable<Map<String,dynamic>> products,Iterable<Map<String,dynamic>> warehouses,
    Iterable<Map<String,dynamic>> headers,Iterable<Map<String,dynamic>> lines,
  ){
    final items={for(final p in products)s(p['legacyId']??s(p['id']).replaceFirst('legacy-prod-','')):p};
    final stores={for(final w in warehouses)s(w['id']).replaceFirst('legacy-wh-',''):s(w['id'])};
    final normalizedItems={for(final p in products)s(p['id']):p};
    final normalizedStores={for(final w in warehouses)s(w['id']):s(w['id'])};
    final byHeader={for(final h in headers)s(h['id']):h};
    final unresolved=<String>{},affected=<String>{};
    var skippedLines=0;
    final balances=<String,Map<String,num>>{};
    for(final h in headers){
      final map=h['normalizedRefs']==true?normalizedStores:stores;
      if(!map.containsKey(s(h['store_id1']))||!map.containsKey(s(h['store_id2'])))unresolved.add(s(h['id']));
    }
    for(final line in lines){
      final headerId=s(line['bill_id']),h=byHeader[headerId];
      final p=(line['normalizedRefs']==true?normalizedItems:items)[s(line['prod_id'])];
      final map=h?['normalizedRefs']==true?normalizedStores:stores;
      final from=h==null?null:map[s(h['store_id1'])],to=h==null?null:map[s(h['store_id2'])];
      final unit=line['unitnum']==null?1:num.tryParse(s(line['unitnum']));
      final amount=num.tryParse(s(line['amount']).replaceAll(',',''));
      final c2=LegacyStockProjection.number(p?['count2'],1),c3=LegacyStockProjection.number(p?['count3'],1);
      final factor=unit==1?1:unit==2?(c2==0?1:c2):unit==3?(c2==0?1:c2)*(c3==0?1:c3):0;
      if(p==null||from==null||to==null||amount==null||!amount.isFinite||amount<0||factor<=0||!(amount*factor).isFinite){
        unresolved.add(headerId);skippedLines++;
        if(p!=null)affected.add(s(p['id']));
        continue;
      }
      final q=amount*factor;
      final row=balances.putIfAbsent(s(p['id']),()=> <String,num>{});
      row[from]=(row[from]??0)-q;row[to]=(row[to]??0)+q;
    }
    return {'netByItem':balances,'unresolvedIds':unresolved.toList()..sort(),
      'affectedItemIds':affected.toList()..sort(),'skippedLines':skippedLines};
  }

  static num roundMoney(num value)=>(value*100).round()/100;

  /// Mirror the legacy web cash direction rules. A legacy cashbox and a
  /// modern GL cash account are different entities; never count both as one.
  /// Unknown currencies and mismatched box currencies stay explicitly apart.
  static Map<String,dynamic> cashboxes(
      Map<String,dynamic> snapshot,Map<String,dynamic> options){
    final currency=s(options['currency']).trim(),from=s(options['fromDate']),to=s(options['toDate']);
    final review=snapshot['backupReview']==true;
    final boxes=<Map<String,dynamic>>[
      for(final raw in snapshot['cashboxes'] as List)
        <String,dynamic>{...Map<String,dynamic>.from(raw as Map),'totalIn':0,'totalOut':0,'netBalance':0,'entryCount':0},
    ];
    final byId={for(final b in boxes)s(b['id']):b};
    final rec=<String,Map<String,dynamic>>{};
    Map<String,dynamic> bucket(String c)=>rec.putIfAbsent(c,()=> <String,dynamic>{
      'currency':c,'linkedCashboxesNet':0,'unlinkedCashIn':0,'unlinkedCashOut':0,'unlinkedCashNet':0,'unlinkedCashCount':0,'totalCashNet':0,
    });
    var excludedCurrency=0,currencyMismatch=0;
    for(final raw in snapshot['ledger'] as List){
      final e=Map<String,dynamic>.from(raw as Map);
      // Only explicitly linked modern cashbox postings join the historical register.
      if((e['localCashboxPosting']!=true&&e['importedRegister']!=true&&(e['rawDain']==null||e['rawMadin']==null))||e['deleted']==true||
          e['postingStatus']=='draft'||(!review&&e['postingStatus']!='posted'&&e['postingStatus']!='reversed'))continue;
      if(e['settledOnReceipt']!=true&&e['payment']!='cash')continue;
      final kind=s(e['kind']),date=s(e['entryDate']);
      if(!['voucher','invoice','return'].contains(kind)&&e['cashboxId']==null)continue;
      if((from.isNotEmpty&&date.compareTo(from)<0)||(to.isNotEmpty&&date.compareTo(to)>0))continue;
      final c=s(e['currency']);
      if(!knownCurrency(c)){excludedCurrency++;continue;}
      if(!allCurrencies(currency)&&c!=currency)continue;
      final doc=e['docType'],direction=e['direction'];
      final voucher=['voucher','transfer','simple-entry'].contains(kind);
      final inflow=voucher?direction=='credit':[2,7,5].contains(doc)||(doc==null&&direction=='debit');
      final outflow=voucher?direction=='debit':[3,9,4].contains(doc)||(doc==null&&direction=='credit');
      if(!inflow&&!outflow)continue;
      final value=n(e['amount']);
      if(value<=0)continue;
      final b=byId[s(e['cashboxId'])],r=bucket(c);
      if(b!=null&&b['currencyCode']==c){
        final key=inflow?'totalIn':'totalOut';
        b[key]=(b[key] as num)+value;b['entryCount']=(b['entryCount'] as int)+1;
        r['linkedCashboxesNet']=(r['linkedCashboxesNet'] as num)+(inflow?value:-value);
      }else{
        if(b!=null)currencyMismatch++;
        final key=inflow?'unlinkedCashIn':'unlinkedCashOut';
        r[key]=(r[key] as num)+value;r['unlinkedCashCount']=(r['unlinkedCashCount'] as int)+1;
      }
    }
    for(final b in boxes){
      b['totalIn']=roundMoney(b['totalIn'] as num);b['totalOut']=roundMoney(b['totalOut'] as num);
      b['netBalance']=roundMoney((b['totalIn'] as num)-(b['totalOut'] as num));
    }
    final filtered=boxes.where((b)=>allCurrencies(currency)||b['currencyCode']==currency).toList();
    for(final b in filtered){if(knownCurrency(b['currencyCode']))bucket(s(b['currencyCode']));}
    for(final r in rec.values){
      for(final k in ['linkedCashboxesNet','unlinkedCashIn','unlinkedCashOut']){r[k]=roundMoney(r[k] as num);}
      r['unlinkedCashNet']=roundMoney((r['unlinkedCashIn'] as num)-(r['unlinkedCashOut'] as num));
      r['totalCashNet']=roundMoney((r['linkedCashboxesNet'] as num)+(r['unlinkedCashNet'] as num));
    }
    final active=filtered.where((b)=>b['isActive']!=false).length;
    // The scalar totals are meaningful only in one currency; the UI uses the
    // per-currency breakdown when multiple currencies are selected.
    final single=rec.length==1?rec.values.single:<String,dynamic>{};
    return {'cashboxes':filtered,'historicalRegisterOnly':!(snapshot['ledger'] as List).any((e)=>e['localCashboxPosting']==true),
      'reconciliation':{'currencyFilter':currency.isEmpty?'الكل':currency,'fromDate':from.isEmpty?null:from,'toDate':to.isEmpty?null:to,
        for(final k in ['linkedCashboxesNet','unlinkedCashIn','unlinkedCashOut','unlinkedCashNet','totalCashNet','unlinkedCashCount'])k:single[k]??0,
        'activeCount':active,'inactiveCount':filtered.length-active,'totalsByCurrency':rec.values.toList(),
        'excludedCurrencyCount':excludedCurrency,'currencyMismatchCount':currencyMismatch}};
  }
}
