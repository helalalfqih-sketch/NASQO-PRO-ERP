import 'stock_quantity_approval_state.dart';
import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_backup_restore.dart';
import 'legacy_stock_projection.dart';
import 'legacy_record_date.dart';

/// Read model over immutable source lines and actual posted stock documents.
/// Archived movements never get replayed into the current approved balance.
class LocalInventoryReports {
  static String s(Object? value)=>value?.toString()??'';
  static num n(Object? value,[num fallback=0])=>LegacyStockProjection.number(value,fallback);
  static num round(num value,[int scale=100])=>(value*scale).round()/scale;
  static bool known(String c)=>c.isNotEmpty&&!c.startsWith('عملة غير معرّفة')&&c!='عملة 2';
  static bool selectedCurrency(String c)=>c.isNotEmpty&&!['الكل','جميع العملات'].contains(c);
  static num factor(Map<String,dynamic> product,Object? unit){
    final a=n(product['count2'],1),b=n(product['count3'],1);
    return unit==2?(a>0?a:1):unit==3?(a>0?a:1)*(b>0?b:1):1;
  }
  static String role(Map<String,dynamic> entry){
    final doc=entry['docType'],kind=entry['kind'],dir=entry['direction'];
    if([3,9].contains(doc))return 'buy';
    if([2,7].contains(doc))return 'sell';
    if(doc==4)return 'saleReturn';
    if(doc==5)return 'purchaseReturn';
    if(doc==null&&kind=='invoice')return dir=='credit'?'buy':'sell';
    if(doc==null&&kind=='return')return dir=='credit'?'saleReturn':'purchaseReturn';
    return '';
  }
  static bool positive(String role)=>['buy','saleReturn','transferIn','opening'].contains(role);

  static Future<List<Map<String,dynamic>>> sourceRows(DatabaseExecutor db,String collection,String? reviewSha)async{
    final rows=reviewSha==null
      ?await db.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[collection],orderBy:'rowid')
      :await db.query('backup_review_rows',columns:['row_json'],where:'sha = ? AND collection = ?',whereArgs:[reviewSha,collection],orderBy:'ordinal');
    return rows.map((r)=>LocalBackupRestore.object(jsonDecode(r['row_json'] as String))).toList();
  }

  static Future<Map<String,dynamic>> evidence(DatabaseExecutor db,Map<String,dynamic> snapshot)async{
    final review=await db.query('backup_review_active',limit:1);
    final sha=review.isEmpty?null:review.single['sha'] as String;
    final inventory=(snapshot['inventory'] as List).cast<Map<String,dynamic>>();
    final live={for(final p in inventory)s(p['id']):p};
    final warehouses={for(final w in (snapshot['warehouses'] as List).cast<Map<String,dynamic>>())s(w['id']):s(w['name'])};
    final entries={for(final e in (snapshot['ledger'] as List).cast<Map<String,dynamic>>())s(e['id']):e};
    final sourceProducts=await sourceRows(db,'inventory',sha);
    final source={for(final p in sourceProducts)s(p['id']):p};
    final archivedEntries=await sourceRows(db,'ledger',sha);
    final valued=sha==null?await db.query('legacy_stock_openings'): <Map<String,Object?>>[];
    final quantities=sha==null?await StockQuantityApprovalState.read(db):<String,Map<String,dynamic>>{};
    // A later valuation must not create a second quantity cutover.
    final openings=<Map<String,Object?>>[...valued.where((o)=>!quantities.containsKey(o['item_id'])),...quantities.values];
    final byOpening={for(final o in openings) "${o['source_item_id']}|${o['warehouse_id']}":s(o['item_id'])};
    String locationItem(String id,String wh)=>byOpening['$id|$wh']??id;
    final result=<Map<String,dynamic>>[];
    var missingLines=0;
    String lastSourceDate='';
    for(final e in archivedEntries){
      final id=s(e['id']),actual=entries[id]??e;
      final date=s(e['entryDate']);
      if(date.compareTo(lastSourceDate)>0)lastSourceDate=date;
      if(e['deleted']==true||e['postingStatus']=='draft')continue;
      final kind=role(e);if(kind.isEmpty)continue;
      final sourceLines=LocalBackupRestore.rows(e['lines']??[]);
      for(var lineIndex=0;lineIndex<sourceLines.length;lineIndex++){
        final l=sourceLines[lineIndex];
        if(l['lineKind']=='free')continue;
        final item=s(l['inventoryItemId']),p=source[item]??live[item];
        if(p==null){missingLines++;continue;}
        final wh=s(l['warehouseId']).isNotEmpty?s(l['warehouseId']):
          s(e['warehouseId']).isNotEmpty?s(e['warehouseId']):s(p['warehouseId']);
        if(!warehouses.containsKey(wh)){missingLines++;continue;}
        final location=locationItem(item,wh);
        if(!live.containsKey(location)){missingLines++;continue;}
        final unit=n(l['unitNum'],1),quantity=n(l['quantity']),bonus=n(l['bonus']);
        final base=quantity*factor(p,unit)+bonus;
        if(base<0||!base.isFinite){missingLines++;continue;}
        final c=s(e['currency']);
        final cost=l['unitCostAtSale'];
        result.add({'movementId':jsonEncode(['legacy-invoice',id,l['legacyId'],lineIndex]),
          'itemId':location,'sourceItemId':item,'source':'invoice','historical':true,
          'role':kind,'refId':id,'entryNumber':n(e['entryNumber']),'date':date,
          'label':s(e['typeLabel']),'accountName':s(e['accountName']),'warehouseId':wh,
          'warehouseName':warehouses[wh],'quantity':quantity,'unit':s(l['unit']).isEmpty?s(p['unit']):s(l['unit']),
          'unitNum':unit,'baseQuantity':base,'effectQty':positive(kind)?base:-base,
          'price':n(l['price']),'total':n(l['total']),'bonus':bonus,'currency':c,
          'documentNumber':s(e['documentNumber']),'details':s(l['details']).isEmpty?s(e['details']):s(l['details']),
          'docType':e['docType'],'kind':e['kind'],
          'financial':known(c)&&(sha!=null||['posted','reversed'].contains(actual['postingStatus'])),
          if(cost is num&&cost.isFinite&&cost>=0)'recordedCost':cost*base});
      }
    }
    if(sha==null){
      final docs={for(final row in await db.query('stock_posting_documents'))
        s(row['id']):LocalBackupRestore.object(jsonDecode(row['document_json'] as String))};
      for(final row in await db.query('stock_posting_lines',orderBy:'rowid')){
        final id=s(row['document_id']),e=entries[id],d=docs[id];
        if(e==null||d==null||e['deleted']==true||!['posted','reversed'].contains(e['postingStatus']))continue;
        final item=s(row['item_id']),p=live[item];if(p==null){missingLines++;continue;}
        final l=LocalBackupRestore.object(jsonDecode(row['line_json'] as String));
        final sale=d['sale']==true,returned=e['kind']=='return';
        final k=returned?(sale?'saleReturn':'purchaseReturn'):(sale?'sell':'buy');
        final wh=s(e['warehouseId']),base=n(row['quantity']),c=s(e['currency']);
        result.add({'movementId':jsonEncode(['posted-invoice',id,row['id']]),
          'itemId':item,'sourceItemId':s(p['legacySourceItemId']).isEmpty?item:s(p['legacySourceItemId']),
          'source':'invoice','historical':false,'role':k,'refId':id,'entryNumber':n(e['entryNumber']),
          'date':s(e['entryDate']),'label':s(e['typeLabel']),'accountName':s(e['accountName']),
          'warehouseId':wh,'warehouseName':warehouses[wh]??wh,'quantity':n(l['sold_quantity'],base),
          'unit':s(l['unit']),'unitNum':n(l['unit_num'],1),'baseQuantity':base,'effectQty':positive(k)?base:-base,
          'price':n(l['price_minor'])/100,'total':n(l['net_minor'])/100,'currency':c,
          'documentNumber':s(e['documentNumber']),'details':s(e['details']),'kind':e['kind'],
          'financial':known(c),'recordedCost':n(l['cost_minor'])/100});
      }
    }
    final headers=await sourceRows(db,'source_store_trans',sha),lines=await sourceRows(db,'source_trans_details',sha);
    final byHeader={for(final h in headers)s(h['id']):h};
    final incompleteTransferHistory=inventory.any((p)=>p['legacyHistoryIncludesTransfers']==false);
    final rawProducts={for(final p in sourceProducts)s(p['legacyId']??s(p['id']).replaceFirst('legacy-prod-','')):p};
    final rawWarehouses={for(final w in warehouses.keys)w.replaceFirst('legacy-wh-',''):w};
    final unresolved=<String,Map<String,dynamic>>{};
    for(final h in headers){
      final id=s(h['id']),normalized=h['normalizedRefs']==true;
      final from=normalized?s(h['store_id1']):rawWarehouses[s(h['store_id1'])]??'';
      final to=normalized?s(h['store_id2']):rawWarehouses[s(h['store_id2'])]??'';
      if(!warehouses.containsKey(from)||!warehouses.containsKey(to)){
        unresolved[id]={'id':int.tryParse(id)??0,'transferDate':LegacyRecordDate.read(h),'transferType':n(h['type'],1),
          'rawFromStoreId':int.tryParse(s(h['store_id1'])),'rawToStoreId':int.tryParse(s(h['store_id2'])),
          'details':s(h['details']),'linesCount':0};
      }
    }
    for(var lineIndex=0;lineIndex<lines.length;lineIndex++){
      final l=lines[lineIndex];
      final hid=s(l['bill_id']),h=byHeader[hid],normalized=l['normalizedRefs']==true;
      final p=(normalized?source:rawProducts)[s(l['prod_id'])];
      if(h==null||p==null){missingLines++;continue;}
      final from=normalized?s(h['store_id1']):rawWarehouses[s(h['store_id1'])]??'';
      final to=normalized?s(h['store_id2']):rawWarehouses[s(h['store_id2'])]??'';
      if(!warehouses.containsKey(from)||!warehouses.containsKey(to)){
        if(unresolved[hid]!=null)unresolved[hid]!['linesCount']=n(unresolved[hid]!['linesCount'])+1;
        continue;
      }
      final qty=n(l['amount']),unit=n(l['unitnum'],1),base=qty*factor(p,unit);
      if(!base.isFinite||base<0){missingLines++;continue;}
      final date=LegacyRecordDate.read(h);
      final transferKey=jsonEncode([hid,l['id']??lineIndex]);
      if(date.compareTo(lastSourceDate)>0)lastSourceDate=date;
      for(final wh in [from,to]){
        final item=locationItem(s(p['id']),wh);
        if(!live.containsKey(item))continue;
        final k=wh==from?'transferOut':'transferIn';
        // A same-warehouse source record has no net effect.
        if(from==to)continue;
        result.add({'movementId':jsonEncode(['transfer',transferKey,wh]),
          'itemId':item,'sourceItemId':s(p['id']),'source':'transfer','historical':true,
          'role':k,'refId':'tx-$hid','transferLineKey':transferKey,'date':date,'label':wh==from?'تحويل صادر':'تحويل وارد',
          'accountName':"${warehouses[from]} ← ${warehouses[to]}",'warehouseId':wh,'warehouseName':warehouses[wh],
          'fromWarehouseId':from,'toWarehouseId':to,'quantity':qty,'unit':s(l['unit']),
          'unitNum':unit,'baseQuantity':base,'effectQty':positive(k)?base:-base,
          'price':0,'total':0,'currency':s(p['currencyCode']),'details':s(h['details']),'financial':false});
      }
    }
    // Opening movements are a balance cutover, not purchases or revenue.
    for(final o in openings){
      final item=s(o['item_id']),p=live[item];if(p==null)continue;
      final q=n(o['quantity']);
      result.add({'movementId':jsonEncode(['opening',item,o['warehouse_id']]),
        'itemId':item,'sourceItemId':s(o['source_item_id']),'source':'opening','historical':false,
        'role':'opening','refId':s(o['ledger_id']),'date':s(o['entry_date']),'warehouseId':s(o['warehouse_id']),
        'baseQuantity':q,'effectQty':q,'currency':s(p['currencyCode']),'financial':false});
    }
    return {'events':result,'openings':openings,'unresolved':unresolved.values.toList(),
      'missingLines':missingLines,'lastSourceDate':lastSourceDate,'incompleteTransferHistory':incompleteTransferHistory};
  }

  static Future<Map<String,dynamic>> priceStats(DatabaseExecutor db,Map<String,dynamic> snapshot,String itemId)async{
    final inventory=(snapshot['inventory'] as List).cast<Map<String,dynamic>>();
    final item=inventory.firstWhere((p)=>p['id']==itemId);
    final sourceId=s(item['legacySourceItemId']).isEmpty?itemId:s(item['legacySourceItemId']);
    final c=s(item['currencyCode']).isEmpty?'ريال':s(item['currencyCode']);
    final data=await evidence(db,snapshot);
    final lines=(data['events'] as List).cast<Map<String,dynamic>>().where((e)=>
      e['source']=='invoice'&&(e['itemId']==itemId||e['sourceItemId']==sourceId)&&e['currency']==c).toList()
      ..sort((a,b){final d=s(b['date']).compareTo(s(a['date']));return d!=0?d:n(b['entryNumber']).compareTo(n(a['entryNumber']));});
    final values=lines.map((l)=>n(l['price'])).where((v)=>v>0).toList();
    final purchases=lines.where((l)=>l['role']=='buy'&&n(l['price'])>0&&n(l['quantity'])>0&&n(l['baseQuantity'])>0).toList();
    final lastPurchase=purchases.isEmpty?null:purchases.first;
    final purchasePrice=lastPurchase==null?0:round(n(lastPurchase['price'])*n(lastPurchase['quantity'])/n(lastPurchase['baseQuantity']));
    if(values.isEmpty)return {'minPrice':0,'maxPrice':0,'lastPrice':0,'txCount':lines.length,'lastPurchasePrice':0};
    return {'minPrice':values.reduce((a,b)=>a<b?a:b),'maxPrice':values.reduce((a,b)=>a>b?a:b),
      'lastPrice':values.first,'txCount':lines.length,'lastPurchasePrice':purchasePrice};
  }

  static Future<Map<String,dynamic>> report(DatabaseExecutor db,Map<String,dynamic> snapshot,Map<String,dynamic> options)async{
    int pageInteger(String key,int fallback,int min,int max){
      final value=options[key];
      if(value==null)return fallback;
      if(value is! int||value<min||value>max)throw ArgumentError('Invalid movement pagination');
      return value;
    }
    final movementOffset=pageInteger('movementOffset',0,0,2147483647);
    final movementLimit=pageInteger('movementLimit',100,1,300);
    final data=await evidence(db,snapshot);
    final all=(data['events'] as List).cast<Map<String,dynamic>>();
    final items=(snapshot['inventory'] as List).cast<Map<String,dynamic>>();
    final warehouses=(snapshot['warehouses'] as List).cast<Map<String,dynamic>>();
    final from=s(options['fromDate']),to=s(options['toDate']),scope=s(options['warehouseId']),itemId=s(options['itemId']),currency=s(options['currency']);
    final basis=['avg','cost','last'].contains(options['profitBasis'])?s(options['profitBasis']):'avg';
    final filteredCurrency=selectedCurrency(currency);
    bool period(Map<String,dynamic> e)=> (from.isEmpty||s(e['date']).compareTo(from)>=0)&&
      (to.isEmpty||s(e['date']).isNotEmpty&&s(e['date']).compareTo(to)<=0);
    bool scoped(Map<String,dynamic> e)=>scope.isEmpty||e['warehouseId']==scope;
    final byItem=<String,List<Map<String,dynamic>>>{};
    for(final e in all){byItem.putIfAbsent(s(e['itemId']),()=>[]).add(e);}
    final openingDates={for(final o in (data['openings'] as List).cast<Map<String,Object?>>())s(o['item_id']):s(o['entry_date'])};
    final rows=<Map<String,dynamic>>[],warehouseStocks=<Map<String,dynamic>>[],movements=<Map<String,dynamic>>[];
    final totals=<String,Map<String,dynamic>>{};
    Map<String,dynamic> bucket(String c)=>totals.putIfAbsent(c,()=>{'currency':c,
      'totalSales':0,'totalPurchases':0,'totalProfit':0,'totalRemainingValue':0,'totalRemainingQty':0,'activeItemsCount':0});
    var mixed=0,estimates=0,unknownValue=0;
    num sum(Iterable<Map<String,dynamic>> rows,String key)=>rows.fold<num>(0,(a,b)=>a+n(b[key]));
    for(final item in items){
      final id=s(item['id']),wh=s(item['warehouseId']),c=s(item['currencyCode']).isEmpty?'ريال':s(item['currencyCode']);
      if(itemId.isNotEmpty&&id!=itemId)continue;
      final events=byItem[id]??<Map<String,dynamic>>[];
      final scopeEvents=events.where(scoped).toList();
      if(scope.isNotEmpty&&scope!=wh&&scopeEvents.isEmpty)continue;
      final relevant=scopeEvents.where((e)=>e['role']!='opening'&&period(e)&&(!filteredCurrency||e['currency']==currency)).toList();
      final rowCurrency=filteredCurrency?currency:c;
      final money=relevant.where((e)=>e['financial']==true&&e['currency']==rowCurrency);
      num netRole(Iterable<Map<String,dynamic>> list,String role,String field)=>sum(list.where((e)=>e['role']==role),field);
      final buys=netRole(relevant,'buy','baseQuantity')-netRole(relevant,'purchaseReturn','baseQuantity');
      final sells=netRole(relevant,'sell','baseQuantity')-netRole(relevant,'saleReturn','baseQuantity');
      final buyValue=netRole(money,'buy','total')-netRole(money,'purchaseReturn','total');
      final sellValue=netRole(money,'sell','total')-netRole(money,'saleReturn','total');
      final txIn=netRole(relevant,'transferIn','baseQuantity'),txOut=netRole(relevant,'transferOut','baseQuantity');
      final catalogCost=n(item['avgCost']),referenceCost=rowCurrency==c?n(item['legacyCatalogCost'],catalogCost):0;
      final historicBuys=events.where((e)=>e['role']=='buy'&&e['financial']==true&&e['currency']==rowCurrency).toList()
        ..sort((a,b){final d=s(b['date']).compareTo(s(a['date']));return d!=0?d:n(b['entryNumber']).compareTo(n(a['entryNumber']));});
      final purchased=sum(historicBuys,'baseQuantity'),paid=sum(historicBuys,'total');
      final fallback=referenceCost>0?referenceCost:purchased>0?paid/purchased:0;
      final avg=rowCurrency==c&&catalogCost>0&&item['quantityUnverified']!=true?catalogCost:
        buys>0&&buyValue>0?buyValue/buys:purchased>0?paid/purchased:fallback;
      final last=historicBuys.isEmpty?avg:n(historicBuys.first['baseQuantity'])>0?
        n(historicBuys.first['total'])/n(historicBuys.first['baseQuantity']):avg;
      final unitCost=basis=='cost'?fallback:basis=='last'?last:avg;
      final openingDate=openingDates[id]??'';
      final sourceBaseline=openingDate.isEmpty&&events.any((e)=>e['historical']==true)&&item['quantityUnverified']!=true;
      final historicalOnly=item['quantityUnverified']==true||(scope.isNotEmpty&&scope!=wh)||
        (to.isNotEmpty&&openingDate.isNotEmpty&&to.compareTo(openingDate)<0)||
        (sourceBaseline&&to.isNotEmpty&&to.compareTo(s(data['lastSourceDate']))<0);
      final balanceEvents=scopeEvents.where((e)=>historicalOnly?e['historical']==true:e['historical']!=true).toList();
      final current=n(item['quantity']);
      final endEvents=balanceEvents.where((e)=>to.isEmpty||s(e['date']).compareTo(to)<=0);
      final available=historicalOnly?sum(endEvents,'effectQty'):
        (scope.isEmpty||scope==wh?current:0)-sum(balanceEvents.where((e)=>to.isNotEmpty&&s(e['date']).compareTo(to)>0),'effectQty');
      final periodNet=sum(endEvents.where((e)=>from.isEmpty||s(e['date']).compareTo(from)>=0),'effectQty');
      final openingQty=available-periodNet;
      final costPending=item['costUnverified']==true;
      final valuedPurchases=endEvents.where((e)=>e['historical']!=true&&e['financial']==true&&e['currency']==rowCurrency);
      final purchaseValue=round(netRole(valuedPurchases,'buy','total')-netRole(valuedPurchases,'purchaseReturn','total'));
      final value=historicalOnly||rowCurrency!=c?0:costPending?purchaseValue:round(available*catalogCost);
      // A comparison estimate is not an approved balance. Keep remainingValue
      // unchanged for financial consumers and never write an opening here.
      final purchases=events.where((e)=>e['financial']==true&&e['currency']==rowCurrency);
      num netPurchases(Iterable<Map<String,dynamic>> es,String field)=>
        netRole(es,'buy',field)-netRole(es,'purchaseReturn',field);
      final periodPurchases=purchases.where(period);
      final globalQty=netPurchases(periodPurchases,'baseQuantity');
      final allQty=netPurchases(purchases,'baseQuantity');
      final referenceFallback=referenceCost>0?referenceCost:globalQty>0?
        netPurchases(periodPurchases,'total')/globalQty:allQty>0?netPurchases(purchases,'total')/allQty:0;
      final estimateAverage=buys!=0&&buyValue/buys>0?buyValue/buys:referenceFallback;
      final pricedBuys=historicBuys.where((e)=>n(e['price'])>0).toList();
      final estimateLast=pricedBuys.isEmpty?estimateAverage:
        n(pricedBuys.first['price'])/factor(item,n(pricedBuys.first['unitNum'],1));
      final estimateCost=basis=='cost'?referenceFallback:basis=='last'?estimateLast:estimateAverage;
      final estimatedValue=(historicalOnly||costPending)&&known(rowCurrency)&&rowCurrency==c&&
        (available==0||estimateCost>0)?round(available*estimateCost):null;
      if(historicalOnly)estimates++;
      final otherCurrencies=relevant.where((e)=>e['financial']==true&&e['currency']!=rowCurrency);
      if(otherCurrencies.isNotEmpty)mixed++;
      unknownValue+=relevant.where((e)=>e['source']=='invoice'&&e['financial']!=true).length;
      num costFor(Map<String,dynamic> e){
        if(e['recordedCost']!=null&&basis=='avg')return n(e['recordedCost']);
        return n(e['baseQuantity'])*unitCost;
      }
      final profit=money.where((e)=>['sell','saleReturn'].contains(e['role'])&&(rowCurrency==c||unitCost>0||e['recordedCost']!=null)).fold<num>(0,(acc,e)=>
        acc+(e['role']=='sell'?1:-1)*(n(e['total'])-costFor(e)));
      rows.add({'id':id,'code':item['legacyId'],'name':item['name'],'sku':s(item['sku']),'unit':s(item['unit']),
        'unit2':s(item['unit2']),'count2':item['count2'],'warehouseId':wh,'currencyCode':rowCurrency,
        'expiryDate':item['expiryDate'],'openingQty':round(openingQty,1000),'periodNetQty':round(periodNet,1000),
        'buyQty':round(buys,1000),'sellQty':round(sells,1000),'transferInQty':round(txIn,1000),'transferOutQty':round(txOut,1000),
        'buyTotal':round(buyValue),'sellTotal':round(sellValue),'availableQty':round(available,1000),
        'unitCost':round(unitCost),'remainingValue':value,'profit':round(profit),'avgCost':catalogCost,
        if(estimatedValue!=null)'estimatedRemainingValue':estimatedValue,
        'sellingPrice':item['sellingPrice'],'catalogQuantity':current,'quantityUnverified':historicalOnly,'costUnverified':costPending,
        if(costPending)'unvaluedOpeningQuantity':item['unvaluedOpeningQuantity'],
        'hasMovement':relevant.isNotEmpty,'balanceBasis':historicalOnly?'historical':'operational'});
      // Keep money in its own currency. The row shows one currency, while
      // report totals include each movement currency separately.
      final financial=relevant.where((e)=>e['financial']==true&&known(s(e['currency'])));
      for(final cur in financial.map((e)=>s(e['currency'])).toSet()){
        final b=bucket(cur),inCurrency=financial.where((e)=>e['currency']==cur);
        b['totalSales']=n(b['totalSales'])+netRole(inCurrency,'sell','total')-netRole(inCurrency,'saleReturn','total');
        b['totalPurchases']=n(b['totalPurchases'])+netRole(inCurrency,'buy','total')-netRole(inCurrency,'purchaseReturn','total');
        // A foreign-currency movement without a matching cost valuation is
        // not assigned a fictitious exchange rate or profit.
        if(cur==rowCurrency)b['totalProfit']=n(b['totalProfit'])+profit;
        b['activeItemsCount']=n(b['activeItemsCount'])+1;
      }
      if(!historicalOnly&&known(c)&&(!filteredCurrency||currency==c)){
        final b=bucket(c);b['totalRemainingValue']=n(b['totalRemainingValue'])+value;
        b['totalRemainingQty']=n(b['totalRemainingQty'])+available;
      }
      for(final w in scopeEvents.map((e)=>s(e['warehouseId'])).toSet()){
        final movement=relevant.where((e)=>e['warehouseId']==w);
        warehouseStocks.add({'inventoryItemId':id,'warehouseId':w,
          'warehouseName':warehouses.firstWhere((r)=>r['id']==w,orElse:()=>{'name':w})['name'],
          'purchasesQty':netRole(movement,'buy','baseQuantity'),'salesQty':netRole(movement,'sell','baseQuantity'),
          'salesReturnQty':netRole(movement,'saleReturn','baseQuantity'),'purchaseReturnQty':netRole(movement,'purchaseReturn','baseQuantity'),
          'transferInQty':netRole(movement,'transferIn','baseQuantity'),'transferOutQty':netRole(movement,'transferOut','baseQuantity'),
          'netComputedQty':sum(movement,'effectQty')});
      }
      if(itemId.isNotEmpty){
        final transfers=<String,Map<String,dynamic>>{};
        for(final e in relevant){
          final row=<String,dynamic>{...e}..remove('financial')..remove('recordedCost');
          if(scope.isEmpty&&row['transferLineKey']!=null){
            final key=s(row['transferLineKey']);
            row['movementId']=jsonEncode(['transfer',key]);
            final prior=transfers[key];
            if(prior!=null){prior['effectQty']=n(prior['effectQty'])+n(row['effectQty']);prior['label']='تحويل بين المخازن';prior['warehouseName']=row['accountName'];continue;}
            transfers[key]=row;
          }
          movements.add(row);
        }
      }
    }
    movements.sort((a,b){
      final date=s(b['date']).compareTo(s(a['date']));
      if(date!=0)return date;
      final entry=n(b['entryNumber']).compareTo(n(a['entryNumber']));
      return entry!=0?entry:s(a['movementId']).compareTo(s(b['movementId']));
    });
    final movementPage=movements.skip(movementOffset).take(movementLimit).toList();
    final nextOffset=movementOffset+movementPage.length;
    final hasMore=nextOffset<movements.length;
    final buckets=totals.values.map((b)=><String,dynamic>{...b,
      for(final k in ['totalSales','totalPurchases','totalProfit','totalRemainingValue'])k:round(n(b[k])),
      'totalRemainingQty':round(n(b['totalRemainingQty']),1000)}).toList();
    final one=buckets.length==1?buckets.single:<String,dynamic>{};
    final unresolved=data['unresolved'] as List;
    final note='الرصيد المعتمد من SQLite ولا تُعاد إضافة الحركات القديمة إليه. قيمة المتبقي التقديرية حسب أساس السعر المختار للعرض والمراجعة فقط، ولا تدخل القيمة المعتمدة أو تعتمد المخزون. الكميات التاريخية غير المعتمدة تقديرية ولا تدخل في قيمة المخزون. '
      'اعتماد الكمية مستقل عن التكلفة؛ الكمية المعتمدة بتكلفة غير معتمدة لا تدخل في قيمة المخزون. '
      'الأرباح التاريخية تقديرية حسب أساس السعر المختار؛ الربح المسجل متاح للفواتير المحلية. قيمة المتبقي بسعر التكلفة الحالي وليست تقييمًا تاريخيًا. '
      'استثناءات: ${unresolved.length} تحويل غير مكتمل، ${data['missingLines']} بند غير مرتبط، $unknownValue بند دون قيمة مالية معتمدة، $mixed صنف متعدد العملات.'
      + (data['incompleteTransferHistory']==true?' بعض التحويلات القديمة غير متوفرة في المصدر.':'');
    return {'warehouses':warehouses,'warehouseStocks':warehouseStocks,'itemRows':rows,
      'totals':{'totalSales':one['totalSales']??0,'totalPurchases':one['totalPurchases']??0,
        'totalProfit':one['totalProfit']??0,'totalRemainingValue':one['totalRemainingValue']??0,
        'activeItemsCount':rows.where((r)=>r['hasMovement']==true).length,'profitBasis':basis},
      'totalsByCurrency':buckets,'movements':movementPage,'dataScopeNote':note,
      'movementPage':{'offset':movementOffset,'limit':movementLimit,'totalCount':movements.length,
        'hasMore':hasMore,'nextOffset':hasMore?nextOffset:null},
      'anomalies':{'unverifiedItemsCount':estimates,'unresolvedTransfersCount':unresolved.length,'unresolvedTransfers':unresolved,
        'negativeComputedItems':rows.where((r)=>n(r['availableQty'])<0).take(50).map((r)=>
          {'id':r['id'],'name':r['name'],'netComputedQty':r['availableQty']}).toList()}};
  }
}
