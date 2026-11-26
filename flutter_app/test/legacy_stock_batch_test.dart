import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_batch.dart';

void main(){
  test('cost review uses the approved baseline rather than history or a newer purchase quantity',(){
    final products=<Map<String,dynamic>>[
      {'id':'p','name':'Synthetic item','currencyCode':'ريال','avgCost':20,'quantity':7,
        'legacyInvoiceQtyByWarehouse':{'wh':99},'legacyTransferIncomplete':true},
      {'id':'missing-cost','currencyCode':'ريال','avgCost':0},
    ];
    final approvals=<Map<String,dynamic>>[
      {'source_item_id':'p','warehouse_id':'wh','quantity':3},
      {'source_item_id':'p','warehouse_id':'other','quantity':8},
      {'source_item_id':'missing-cost','warehouse_id':'wh','quantity':2},
    ];
    final rows=LegacyStockBatch.reviewRows(products,[],'wh',quantityApprovals:approvals);
    expect(rows.first['reason'],'suggested');
    expect(rows.first['quantityApproved'],true);
    expect(rows.first['quantity'],3);expect(rows.first['totalValue'],60);
    expect(rows.first['historicalQuantity'],99);
    expect(rows.last['reason'],'cost');expect(rows.last['approvedQuantity'],2);expect(rows.last['quantity'],2);
    final old=LegacyStockBatch.reviewRows(products,[],'wh');
    expect(old.first['reason'],'transfer');
    expect(products.first['quantity'],7);expect(approvals.first['quantity'],3);
  });
  test('bulk suggestions accept precise fractions and omit incomplete, negative and approved stock',(){
    final products=<Map<String,dynamic>>[
      {'id':'legacy-prod-1','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4},'legacyTransferNetByWarehouse':{'wh':1}},
      {'id':'legacy-prod-2','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':-1}},
      {'id':'legacy-prod-3','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':2.5}},
      {'id':'legacy-prod-4','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4},'legacyTransferIncomplete':true},
      {'id':'legacy-prod-5','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4}},
    ];
    final review=LegacyStockBatch.reviewRows(products,[{'source_item_id':'legacy-prod-5','warehouse_id':'wh','quantity':4,'value_minor':800}],'wh');
    expect(review.map((r)=>r['reason']).toList(),['suggested','negative','suggested','transfer','approved']);
    expect(review[1]['quantity'],isNull);
    expect(review[3]['quantity'],isNull);
    expect(review[0]['historicalQuantity'],5);
    final draft=LegacyStockBatch.suggestions(products,[{'source_item_id':'legacy-prod-5','warehouse_id':'wh','quantity':4,'value_minor':800}],'wh');
    expect(draft.draft,'legacy-prod-1\t5\t10.00\nlegacy-prod-3\t2.5\t5.00');
    expect(draft.skipped,2);
    final rows=LegacyStockBatch.parse(draft.draft,products,'wh',{'confirmed':true});
    expect(rows.first['quantity'],5);expect(rows.first['totalValue'],10);
    expect(rows.last['quantity'],2.5);expect(rows.last['totalValue'],5);
    expect(()=>LegacyStockBatch.parse('legacy-prod-1,1,2\nlegacy-prod-1,1,2',products,'wh',{}),throwsFormatException);
    expect(LegacyStockBatch.parse('legacy-prod-2,1.5,3',products,'wh',{}).single['quantity'],1.5);
    expect(()=>LegacyStockBatch.parse('legacy-prod-2,1.5001,3',products,'wh',{}),throwsFormatException);
    expect(()=>LegacyStockBatch.parse('legacy-prod-2,1,0',products,'wh',{}),throwsFormatException);
  });
}
