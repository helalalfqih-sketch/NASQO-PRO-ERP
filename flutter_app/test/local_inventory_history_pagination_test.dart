import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/legacy_record_date.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

void main(){
  test('legacy dates use valid stored calendar fields without overflowing or inventing dates',(){
    expect(LegacyRecordDate.read({'year':2026,'month':11,'day':8,'ndate':'20261108'}),'2026-11-08');
    expect(LegacyRecordDate.read({'ndate':20261109}),'2026-11-09');
    expect(LegacyRecordDate.read({'date':'2026-11-10','year':2026,'month':11,'day':8}),'2026-11-10');
    expect(LegacyRecordDate.read({'date':'invalid','year':'2026','month':'11','day':'08'}),'2026-11-08');
    expect(LegacyRecordDate.read({'year':2024,'month':2,'day':29}),'2024-02-29');
    for(final row in <Map<String,dynamic>>[
      {},{'ndate':'00000000'},{'ndate':'20260230'},{'date':'2026-02-30'},
      {'year':2026,'month':2,'day':29},{'year':2026,'month':13,'day':1},
      {'year':2026,'month':11,'day':1.5},{'date':'11/08/2026'},
    ]){expect(LegacyRecordDate.read(row),'');}
  });

  group('read-only existing archive reports',(){
    late Database db;
    late Map<String,dynamic> snapshot;
    const product=<String,dynamic>{'id':'legacy-prod-1','legacyId':1,'name':'Synthetic item','unit':'piece',
      'warehouseId':'legacy-wh-1','currencyCode':'ريال','quantity':0,'avgCost':0,'legacyCatalogCost':2,
      'quantityUnverified':true,'legacyHistoryIncludesTransfers':true};
    Future<void> archive(String collection,String id,Map<String,dynamic> row)async{
      await db.insert('legacy_operational_rows',{'collection':collection,'record_id':id,'row_json':jsonEncode(row)});
    }
    Future<void> transfer(int id,Map<String,dynamic> date,{int from=1,int to=2})async{
      await archive('source_store_trans','$id',{'id':id,'store_id1':from,'store_id2':to,'type':1,...date});
      await archive('source_trans_details','$id',{'id':id,'bill_id':id,'prod_id':1,'unitnum':1,'amount':3});
    }
    Future<Map<String,dynamic>> report([Map<String,dynamic> options=const {}])=>
      LocalInventoryReports.report(db,snapshot,{'itemId':'legacy-prod-1',...options});

    setUp(()async{
      sqfliteFfiInit();
      db=await databaseFactoryFfi.openDatabase(inMemoryDatabasePath,options:OpenDatabaseOptions(singleInstance:false));
      await db.execute('CREATE TABLE legacy_operational_rows(collection TEXT,record_id TEXT,row_json TEXT,PRIMARY KEY(collection,record_id))');
      await db.execute('CREATE TABLE backup_review_active(sha TEXT)');
      await db.execute('CREATE TABLE erp_state(stateKey TEXT PRIMARY KEY,payloadJson TEXT,updatedAt TEXT)');
      await db.execute('CREATE TABLE legacy_stock_openings(item_id TEXT)');
      await db.execute('CREATE TABLE stock_posting_documents(id TEXT,document_json TEXT)');
      await db.execute('CREATE TABLE stock_posting_lines(id TEXT PRIMARY KEY,document_id TEXT,item_id TEXT,quantity REAL,line_json TEXT)');
      snapshot={'inventory':[product],'warehouses':[
        {'id':'legacy-wh-1','name':'Synthetic main'}, {'id':'legacy-wh-2','name':'Synthetic secondary'}],
        'ledger':<Map<String,dynamic>>[]};
      await archive('inventory','legacy-prod-1',product);
    });
    tearDown(()async=>db.close());

    test('existing transfer headers retain dates inside period filters and unresolved transfers remain excluded',()async{
      await transfer(1,{'year':2026,'month':11,'day':8});
      await transfer(2,{'ndate':'20261109'});
      await transfer(3,{'date':'2026-11-10'});
      await transfer(4,{'year':2026,'month':2,'day':30,'ndate':'20260230'});
      await transfer(5,{'year':2026,'month':11,'day':11},to:99);
      final before=await db.query('legacy_operational_rows',orderBy:'collection,record_id');
      final result=await report({'fromDate':'2026-11-08','toDate':'2026-11-10'});
      final movements=(result['movements'] as List).cast<Map<String,dynamic>>();
      expect(movements.map((m)=>m['date']).toList(),['2026-11-10','2026-11-09','2026-11-08']);
      expect(movements.map((m)=>m['refId']).toSet(),{'tx-1','tx-2','tx-3'});
      expect(movements.every((m)=>m['effectQty']==0),true,reason:'all-warehouse transfer pairs merge once');
      expect(result['movementPage']['totalCount'],3);
      expect(result['anomalies']['unresolvedTransfersCount'],1);
      expect((result['anomalies']['unresolvedTransfers'] as List).single['transferDate'],'2026-11-11');
      final all=await report();
      expect(all['movementPage']['totalCount'],4,reason:'unfiltered invalid-date evidence remains visible');
      expect((all['movements'] as List).last['date'],'');
      final outgoing=await report({'warehouseId':'legacy-wh-1','fromDate':'2026-11-08','toDate':'2026-11-10'});
      expect((outgoing['movements'] as List).every((m)=>m['effectQty']==-3),true);
      expect(await db.query('legacy_operational_rows',orderBy:'collection,record_id'),before,reason:'read-time normalization must not rewrite archived data');
      expect(await db.query('stock_posting_documents'),isEmpty);
      expect(await db.query('stock_posting_lines'),isEmpty);
    });

    test('all 516 same-date movements can be paged exactly once and totals ignore paging',()async{
      final entry=<String,dynamic>{'id':'legacy-ent-1','entryNumber':1,'docType':3,'kind':'invoice',
        'entryDate':'2026-11-08','postingStatus':'posted','currency':'ريال','accountName':'Synthetic supplier',
        'lines':List.generate(515,(i)=><String,dynamic>{'legacyId':i+1,'lineKind':'item','inventoryItemId':'legacy-prod-1',
          'warehouseId':'legacy-wh-1','unitNum':1,'quantity':1,'price':2,'total':2})};
      (snapshot['ledger'] as List).add(entry);
      await archive('ledger','legacy-ent-1',entry);
      await transfer(1,{'year':2026,'month':11,'day':8});
      final original=await db.query('legacy_operational_rows',orderBy:'collection,record_id');
      final first=await report();
      expect(first['movementPage'],{'offset':0,'limit':100,'totalCount':516,'nextOffset':100,'hasMore':true});
      expect(first['itemRows'][0]['buyQty'],515);
      expect(first['totals']['totalPurchases'],1030);
      final seen=<String>{};
      final ordered=<String>[];
      var page=first;
      while(true){
        expect(page['itemRows'],first['itemRows']);
        expect(page['totals'],first['totals']);
        for(final m in page['movements'] as List){
          expect(seen.add(m['movementId'] as String),true,reason:'no overlapping pages');
          ordered.add(m['movementId'] as String);
        }
        if(page['movementPage']['hasMore']!=true)break;
        page=await report({'movementOffset':page['movementPage']['nextOffset']});
      }
      expect(seen,hasLength(516));
      expect(page['movementPage'],{'offset':500,'limit':100,'totalCount':516,'nextOffset':null,'hasMore':false});
      expect((page['movements'] as List).length,16);
      final alternate=<String>[];
      for(final offset in [0,300]){
        final p=await report({'movementOffset':offset,'movementLimit':300});
        alternate.addAll((p['movements'] as List).map((m)=>m['movementId'] as String));
      }
      expect(alternate,ordered,reason:'ordering is stable across page sizes and tied dates/numbers');
      final pastEnd=await report({'movementOffset':1000});
      expect(pastEnd['movements'],isEmpty);expect(pastEnd['movementPage']['nextOffset'],null);
      final filtered=await report({'fromDate':'2026-11-09'});
      expect(filtered['movementPage']['totalCount'],0);expect(filtered['movements'],isEmpty);
      expect((first['dataScopeNote'] as String).contains('300 حركة فقط'),false);
      expect(await db.query('legacy_operational_rows',orderBy:'collection,record_id'),original);
    });

    test('report rejects invalid paging without broadening the requested result',()async{
      for(final options in <Map<String,dynamic>>[
        {'movementOffset':-1},{'movementOffset':1.5},{'movementOffset':'100'},
        {'movementOffset':2147483648},{'movementLimit':0},{'movementLimit':301},{'movementLimit':2.5},
      ]){await expectLater(report(options),throwsArgumentError);}
    });

    test('posted lines for the same item keep separate identities across pages',()async{
      (snapshot['ledger'] as List).add({'id':'local-sale','kind':'invoice','direction':'debit','entryNumber':2,
        'entryDate':'2026-11-08','postingStatus':'posted','warehouseId':'legacy-wh-1','currency':'ريال'});
      await db.insert('stock_posting_documents',{'id':'local-sale','document_json':jsonEncode({'sale':true})});
      for(final id in ['line-a','line-b']){
        await db.insert('stock_posting_lines',{'id':id,'document_id':'local-sale','item_id':'legacy-prod-1','quantity':1,
          'line_json':jsonEncode({'price_minor':200,'net_minor':200,'cost_minor':100,'unit':'piece','unit_num':1})});
      }
      final first=await report({'movementLimit':1});
      final second=await report({'movementLimit':1,'movementOffset':1});
      expect(first['movementPage']['totalCount'],2);
      expect(first['movements'][0]['movementId'],isNot(second['movements'][0]['movementId']));
      expect(first['totals'],second['totals']);
    });
  });

  test('inventory bridge accepts bounded numeric pages and rejects malformed paging before reading',()async{
    var reads=0;
    Map<String,dynamic>? received;
    final protocol=HybridReadOnlyProtocol(readSnapshot:()async=>{},readInventoryReport:(options)async{
      reads++;received=options;return {'movements':[]};
    });
    Future<Map<String,dynamic>> invoke(Map<String,dynamic> options)async=>jsonDecode(await protocol.handle(jsonEncode({
      'protocolVersion':'1.0.0','kind':'request','requestId':'page-test','action':'getInventoryMovementsReport',
      'payload':{'workspaceId':'local-erp-workspace','options':options},
    }))) as Map<String,dynamic>;
    for(final options in <Map<String,dynamic>>[
      {'movementOffset':-1},{'movementOffset':1.5},{'movementOffset':'100'},{'movementOffset':2147483648},
      {'movementLimit':0},{'movementLimit':301},{'movementLimit':'100'},{'warehouseId':7},{'allRows':true},
    ]){expect((await invoke(options))['ok'],false);}
    expect(reads,0);
    final options=<String,dynamic>{'itemId':'legacy-prod-1','fromDate':'2026-11-08','movementOffset':300,'movementLimit':216};
    expect((await invoke(options))['ok'],true);expect(received,options);expect(reads,1);
  });
}
