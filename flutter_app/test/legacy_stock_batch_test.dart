import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_batch.dart';

void main(){
  test('bulk suggestions omit incomplete, fractional, negative and approved stock',(){
    final products=<Map<String,dynamic>>[
      {'id':'legacy-prod-1','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4},'legacyTransferNetByWarehouse':{'wh':1}},
      {'id':'legacy-prod-2','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':-1}},
      {'id':'legacy-prod-3','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':2.5}},
      {'id':'legacy-prod-4','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4},'legacyTransferIncomplete':true},
      {'id':'legacy-prod-5','currencyCode':'ريال','avgCost':2,'legacyInvoiceQtyByWarehouse':{'wh':4}},
    ];
    final draft=LegacyStockBatch.suggestions(products,[{'source_item_id':'legacy-prod-5','warehouse_id':'wh'}],'wh');
    expect(draft.draft,'legacy-prod-1\t5\t10.00');
    expect(draft.skipped,3);
    final rows=LegacyStockBatch.parse(draft.draft,products,'wh',{'confirmed':true});
    expect(rows.single['quantity'],5);expect(rows.single['totalValue'],10);
    expect(()=>LegacyStockBatch.parse('legacy-prod-1,1,2\nlegacy-prod-1,1,2',products,'wh',{}),throwsFormatException);
    expect(()=>LegacyStockBatch.parse('legacy-prod-2,1.5,3',products,'wh',{}),throwsFormatException);
    expect(()=>LegacyStockBatch.parse('legacy-prod-2,1,0',products,'wh',{}),throwsFormatException);
  });
}
