/// Stock quantities in integer thousandths. SQLite and bridge continue to
/// expose actual units; arithmetic never subtracts binary floating values.
class StockQuantity {
  static const scale=1000;
  static const maxUnits=10000000;
  static const maxTicks=maxUnits*scale;

  static int ticks(Object? value){
    if(value is! num||!value.isFinite||value<0||value>maxUnits)
      throw ArgumentError('Invalid stock quantity');
    final scaled=value*scale;
    final rounded=scaled.round();
    if((scaled-rounded).abs()>0.00001)throw ArgumentError('Stock quantity requires at most three decimal places');
    return rounded;
  }
  static int boundedTicks(int value){
    if(value<0||value>maxTicks)throw ArgumentError('Stock quantity outside supported range');
    return value;
  }
  /// Preserve integer JSON for existing whole-unit idempotency payloads.
  static num units(int value)=>value%scale==0?value~/scale:value/scale;
  static num normalized(Object? value)=>units(ticks(value));

  static int lineGrossMinor(int quantityTicks,int priceMinor){
    if(quantityTicks<0||priceMinor<0)throw ArgumentError('Invalid line quantity or price');
    final amount=(BigInt.from(quantityTicks)*BigInt.from(priceMinor)+BigInt.from(scale~/2))~/BigInt.from(scale);
    if(amount>BigInt.from(1000000000000))throw ArgumentError('Amount outside supported range');
    return amount.toInt();
  }
}
