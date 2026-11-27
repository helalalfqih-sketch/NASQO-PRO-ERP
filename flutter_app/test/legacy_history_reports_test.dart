import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/legacy_history_reports.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

void main(){
  test('resolved transfers conserve stock and unresolved transfers are explicit',(){
    final report=LegacyHistoryReports.transfers(
      [{'id':'legacy-prod-1','legacyId':1,'count2':12,'count3':2}],
      [{'id':'legacy-wh-1'},{'id':'legacy-wh-2'}],
      [{'id':10,'store_id1':1,'store_id2':2},{'id':11,'store_id1':2,'store_id2':99}],
      [{'bill_id':10,'prod_id':1,'amount':1.5,'unitnum':2},
       {'bill_id':11,'prod_id':1,'amount':4,'unitnum':1}]);
    expect(report['netByItem'],{'legacy-prod-1':{'legacy-wh-1':-18,'legacy-wh-2':18}});
    expect(report['unresolvedIds'],['11']);
    expect(report['affectedItemIds'],['legacy-prod-1']);
    expect(report['skippedLines'],1);
  });

  test('cash report preserves cashbox direction, scope, currencies and date filters',()async{
    Map<String,dynamic> entry(int doc,String kind,String direction,num amount,
      {int? box,String currency='ريال',String date='2026-01-01',String status='posted',String payment='cash'})=>
      {'docType':doc,'kind':kind,'direction':direction,'amount':amount,'rawDain':amount,'rawMadin':0,
        'currency':currency,'entryDate':date,'postingStatus':status,'payment':payment,'cashboxId':box};
    final snapshot=<String,dynamic>{
      'cashboxes':[{'id':1,'name':'Box','currencyCode':'ريال','isActive':true}],
      'ledger':[
        entry(2,'invoice','debit',10,box:1),
        entry(3,'invoice','credit',4,box:1),
        entry(1,'voucher','credit',3,box:1),
        entry(1,'voucher','debit',2,box:1),
        entry(4,'return','credit',2),
        entry(5,'return','debit',1),
        entry(2,'invoice','debit',99,box:1,status:'historical_unposted'),
        entry(2,'invoice','debit',80,box:1,currency:'عملة غير معرّفة (99)'),
        entry(2,'invoice','debit',5,box:1,currency:'دولار'),
        entry(2,'invoice','debit',50,box:1,payment:'credit'),
        entry(2,'invoice','debit',7,box:1,date:'2025-01-01'),
        {'kind':'voucher','direction':'credit','amount':200,'payment':'cash','currency':'ريال','postingStatus':'posted'},
      ],
    };
    final options={'currency':'ريال','fromDate':'2026-01-01'};
    final result=LegacyHistoryReports.cashboxes(snapshot,options);
    final box=(result['cashboxes'] as List).single;
    expect(box['totalIn'],13);expect(box['totalOut'],6);expect(box['netBalance'],7);
    final rec=result['reconciliation'];
    expect(rec['unlinkedCashIn'],1);expect(rec['unlinkedCashOut'],2);expect(rec['totalCashNet'],6);
    expect(rec['excludedCurrencyCount'],1);
    final all=LegacyHistoryReports.cashboxes(snapshot,{'fromDate':'2026-01-01'});
    expect(all['reconciliation']['currencyMismatchCount'],1);
    expect(all['reconciliation']['totalsByCurrency'],hasLength(2));
    final protocol=HybridReadOnlyProtocol(readSnapshot:()async=>snapshot);
    final response=jsonDecode(await protocol.handle(jsonEncode({
      'protocolVersion':HybridReadOnlyProtocol.version,'kind':'request','requestId':'cash-report','action':'getCashboxesReport',
      'payload':{'workspaceId':'local-erp-workspace','options':options}
    }))) as Map;
    expect(response['ok'],true);
    expect(response['data']['reconciliation']['totalCashNet'],6);
  });
}
