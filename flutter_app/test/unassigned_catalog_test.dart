import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main() {
  test('warehouse-free card round-trips, then first purchase binds atomically exactly once', () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo-catalog-no-warehouse-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance;
    final db = await local.database;
    final catalog = LocalStockCatalog(local), backup = LocalBackupRestore(local);
    const workspace = 'local-erp-workspace';
    try {
      final protocol = HybridReadOnlyProtocol(readSnapshot: () async => {},
        createStockRecord: (action, key, input) async => {'id': await catalog.createItem(workspace, key, input)});
      final request = jsonEncode({'protocolVersion':'1.0.0','kind':'request','requestId':'card',
        'idempotencyKey':'catalog-card','action':'createInventoryItem',
        'payload':{'workspaceId':workspace,'payload':{'name':'صنف اصطناعي مستقل','sku':'SYNTH-CARD','unit':'حبة','quantity':0,'avgCost':0}}});
      final result = jsonDecode(await protocol.handle(request));
      expect(result['ok'], true, reason: result.toString());
      expect(jsonDecode(await protocol.handle(request))['data'], result['data']);
      final id = result['data']['id'] as String;
      Future<Map<String,Object?>> item() async => (await db.query('inventory_items',where:'id = ?',whereArgs:[id])).single;
      Future<Map<String,dynamic>> units() async => jsonDecode((await db.query('inventory_unit_settings',where:'item_id = ?',whereArgs:[id])).single['settings_json'] as String);
      expect((await item())['warehouseId'], '');
      expect((await units())['catalogOnly'], true);
      expect(await db.query('inventory_items'), hasLength(1));
      for (final table in ['warehouses','stock_movements','ledger_entries','journal_entries']) {
        expect(await db.query(table), isEmpty, reason: table);
      }
      await catalog.updateItem(workspace,'card-edit',id,{'name':'بطاقة مصححة','sellingPrice':8});
      expect((await units())['catalogOnly'], true);
      final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
      expect((snapshot['inventory'] as List).single['catalogOnly'], true);
      expect((snapshot['inventory'] as List).single['name'], 'بطاقة مصححة');
      final beforeReject = await backup.exportNative();
      await expectLater(catalog.createItem(workspace,'duplicate',{'name':'آخر','sku':'SYNTH-CARD'}),throwsArgumentError);
      await expectLater(catalog.createItem(workspace,'missing',{'name':'مفقود','warehouseId':'no-such-warehouse'}),throwsArgumentError);
      await expectLater(catalog.createItem(workspace,'positive',{'name':'رصيد','quantity':1}),throwsArgumentError);
      expect(await backup.exportNative(), orderedEquals(beforeReject));
      expect(HybridReadOnlyProtocol.catalogValidationMessage(ArgumentError('Invalid identity')), isNot(contains('المخزن المحدد')));
      Future<void> roundTrip() async {
        final savedBytes = await backup.exportNative();
        final proof = (bytes: savedBytes, sha: sha256.convert(savedBytes).toString());
        final file = await File('${dir.path}/roundtrip.back').writeAsBytes(proof.bytes);
        await backup.restoreNative(await backup.inspect(file,'roundtrip.back'),replacementSha:proof.sha);
        expect(await backup.exportNative(), orderedEquals(proof.bytes));
      }
      await roundTrip();
      // A forged unassigned row with a balance must fail and leave live data intact.
      final savedBytes = await backup.exportNative();
        final proof = (bytes: savedBytes, sha: sha256.convert(savedBytes).toString());
      final envelope = jsonDecode(utf8.decode(proof.bytes)) as Map<String,dynamic>;
      final payload = jsonDecode(envelope['payload'] as String) as Map<String,dynamic>;
      payload['tables']['inventory_items'][0]['quantity'] = 9;
      envelope['payload'] = jsonEncode(payload);
      envelope['sha256'] = sha256.convert(utf8.encode(envelope['payload'] as String)).toString();
      final corrupt = await File('${dir.path}/invalid.back').writeAsString(jsonEncode(envelope));
      await expectLater(backup.restoreNative(await backup.inspect(corrupt,'invalid.back'),replacementSha:proof.sha),throwsStateError);
      expect(await backup.exportNative(), orderedEquals(proof.bytes));
      final warehouse = await catalog.createWarehouse(workspace,'warehouse',{'name':'مخزن اصطناعي'});
      final otherWarehouse = await catalog.createWarehouse(workspace,'other-warehouse',{'name':'مخزن آخر'});
      final beforeDuplicate = await backup.exportNative();
      await expectLater(catalog.createItem(workspace,'duplicate-assigned',{'name':'آخر','sku':'SYNTH-CARD','warehouseId':warehouse}),throwsArgumentError);
      expect(await backup.exportNative(), orderedEquals(beforeDuplicate));
      final accounts = LocalAccountCommands(local);
      Future<String> account(String name,String category) => accounts.save(workspace,name,{'name':name,'category':category,'currency':'ريال'});
      final supplier = await account('Supplier','purchases'), inventory = await account('Inventory','shop');
      final customer = await account('Customer','clients'), sales = await account('Sales','sales'), cost = await account('Cost','shop');
      final posting = StockInvoiceCommands(local);
      Map<String,dynamic> invoice(String doc,int number,bool sale) => {
        'id':doc,'kind':'invoice','payment':'credit','direction':sale?'debit':'credit','invoiceContent':'items',
        'accountId':sale?customer:supplier,'counterpartAccountId':sale?sales:inventory,
        'inventoryAccountId':inventory,'costAccountId':cost,
        'amount':sale?8:25,'currency':'ريال','warehouseId':warehouse,'entryNumber':number,'entryDate':'2026-11-26',
        'lines':[{'inventoryItemId':id,'quantity':sale?1:5,'price':sale?8:5,'total':sale?8:25}],
      };
      final beforePosting = await backup.exportNative();
      await expectLater(posting.post(workspace,'no-stock-sale',invoice('no-stock-sale',1,true)),throwsStateError);
      final invalid = invoice('bad-unit',1,false);
      invalid['lines'][0]['unitNum'] = 2;
      await expectLater(posting.post(workspace,'bad-unit',invalid),throwsArgumentError);
      expect(await backup.exportNative(), orderedEquals(beforePosting), reason:'failed purchase must undo warehouse binding');
      final purchase = invoice('purchase',1,false);
      await Future.wait([posting.post(workspace,'purchase',purchase),posting.post(workspace,'purchase',purchase)]);
      expect((await item())['warehouseId'], warehouse);
      expect((await item())['quantity'], 5);
      expect((await item())['avgCost'], 5);
      expect((await units())['catalogOnly'], isNull);
      expect(await db.query('ledger_entries'), hasLength(1));
      expect(await db.query('stock_movements'), hasLength(1));
      expect(await db.query('journal_entries'), hasLength(1));
      await expectLater(catalog.createItem(workspace,'duplicate-global',{'name':'بطاقة مكررة','sku':'SYNTH-CARD'}),throwsArgumentError);
      final beforeRebind = await backup.exportNative();
      await expectLater(posting.post(workspace,'other-purchase',{...invoice('other-purchase',2,false),'warehouseId':otherWarehouse}),throwsStateError);
      expect(await backup.exportNative(), orderedEquals(beforeRebind), reason:'existing warehouse stock cannot be reassigned');
      await posting.post(workspace,'sale',invoice('sale',2,true));
      expect((await item())['quantity'], 4);
      expect(await db.query('stock_movements'), hasLength(2));
      for (final journal in await db.rawQuery('SELECT journal_id,SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id')) {
        expect(journal['d'], journal['c']);
      }
      await roundTrip();
    } finally {
      await db.close();
      await dir.delete(recursive: true);
    }
  });
}
