import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/stock_quantity.dart';

void main(){
  test('exact thousandths and half-up cents',(){
    expect(StockQuantity.ticks(1.125),1125);
    expect(StockQuantity.units(1125),1.125);
    expect(StockQuantity.units(12000),12);
    expect(StockQuantity.units(-125),-0.125);
    expect(StockQuantity.lineGrossMinor(375,300),113);
    expect(StockQuantity.lineGrossMinor(125,300),38);
    expect(()=>StockQuantity.ticks(0.0001),throwsArgumentError);
    expect(()=>StockQuantity.ticks(-1),throwsArgumentError);
    expect(()=>StockQuantity.ticks(double.nan),throwsArgumentError);
    expect(()=>StockQuantity.lineGrossMinor(10000000000,1000000000000),throwsArgumentError);
  });
}
