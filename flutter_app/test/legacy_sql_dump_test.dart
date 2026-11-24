import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/services/legacy_sql_dump.dart';

void main(){
  test('SmartPro SQL preserves quoted delimiters, Arabic and fractional lines',(){
    final dump=r"""
-- export
CREATE TABLE `accounts` (`id` int, `name` varchar(80), `box_id` int, PRIMARY KEY (`id`));
INSERT INTO `accounts` VALUES (1,'اسم; (متجر)',2),(2,'it''s, fine',2);
CREATE TABLE stores(id INTEGER,name TEXT);
INSERT INTO stores VALUES(1,'مخزن');
CREATE TABLE products(id INTEGER,name TEXT);
INSERT INTO products VALUES(1,'قطعة');
INSERT INTO bounds (id,acc_id,dain,madin,doc_type,cur_id) VALUES (1,1,7,0,2,1);
INSERT INTO bill_details (id,bill_id,prod_id,amount,price,total,details) VALUES
 (1,1,1,2.5,3,7.5,'line\nnext');
""";
    final tables=LegacySqlDump.parse(dump);
    expect(tables['customers']!.first['name'],'اسم; (متجر)');
    expect(tables['customers']!.last['name'],"it's, fine");
    expect(tables['input_move']!.single['acc_id'],1);
    expect(tables['bill_details']!.single['amount'],2.5);
    expect(tables['bill_details']!.single['details'],'line\nnext');
  });
  test('SQL parser fails closed for nonliteral data and incomplete records',(){
    for(final source in [
      'INSERT INTO customers(id,name) VALUES(1,random());',
      "INSERT INTO customers(id,name) VALUES(1,'a',3);",
      "INSERT INTO customers(id,name) VALUES(1,'unterminated);",
      'INSERT INTO customers SELECT 1,2;',
      "ATTACH DATABASE 'external.db' AS other;",
      'UPDATE customers SET name=1;',
    ]){
      expect(()=>LegacySqlDump.parse(source),throwsFormatException);
    }
  });
}
