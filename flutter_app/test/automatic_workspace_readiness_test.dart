import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_master_catalog.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';
import 'package:nasqo_pro_erp/services/automatic_stock_baseline.dart';
import 'package:nasqo_pro_erp/services/stock_quantity_approval_state.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/legacy_source_details.dart';

void main() {
  test(
      'fresh, imported and counted stock work without setup and survive repeat initialization and backup',
      () async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_ready_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance, db = await local.database;
    final backups = LocalBackupRestore(local),
        roles = LocalInvoiceRoles(local),
        commands = StockInvoiceCommands(local);
    const w = 'local-erp-workspace';
    Map<String, dynamic> invoice(String id, int number, String item, String wh,
            bool sale, num q, num price) =>
        {
          'id': id,
          'kind': 'invoice',
          'invoiceContent': 'items',
          'payment': 'cash',
          'direction': sale ? 'debit' : 'credit',
          'accountId': sale
              ? 'nasqo-default-sar-cash-customer'
              : 'nasqo-default-sar-cash-supplier',
          'warehouseId': wh,
          'currency': 'ريال',
          'amount': q * price,
          'entryNumber': number,
          'entryDate': '2090-01-01',
          'lines': [
            {
              'inventoryItemId': item,
              'quantity': q,
              'price': price,
              'total': q * price
            }
          ],
        };
    try {
      var snap =
          await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse: true);
      expect(snap['ledger'], isEmpty);
      expect(snap['inventory'], isEmpty);
      expect(snap['warehouses'], hasLength(1));
      expect(await backups.replacementBackup(), isNull,
          reason:
              'Untouched automatic setup does not require a safety-copy dialog');
      final emptyBackup = await File('${dir.path}/setup.back')
          .writeAsBytes(await backups.exportNative());
      await backups.restoreNative(
          await backups.inspect(emptyBackup, 'setup.back'),
          prepareForUse: true);
      expect(await backups.replacementBackup(), isNull);
      final wh = (snap['warehouses'] as List).single['id'] as String;
      await db.insert('inventory_items', {
        'id': 'fresh',
        'name': 'New item',
        'unit': 'piece',
        'quantity': 0,
        'avgCost': 0,
        'warehouseId': wh,
        'minThreshold': 0,
        'sku': ''
      });
      await commands.post(
          w,
          'fresh-buy',
          await roles
              .resolve(invoice('fresh-buy', 1, 'fresh', wh, false, 10, 5)));
      await commands.post(
          w,
          'fresh-sale',
          await roles
              .resolve(invoice('fresh-sale', 2, 'fresh', wh, true, 2, 9)));
      expect((await db.query('inventory_items')).single['quantity'], 8);
      expect(await backups.replacementBackup(), isNotNull,
          reason: 'Real business data always requires a verified safety copy');
      final box = await LocalMasterCatalog(local).saveCashbox(
          w, 'auto-box', {'name': 'New cashbox', 'currencyCode': 'ريال'});
      expect(box['accountId'], isNotEmpty);
      await db.insert('warehouses',
          {'id': 'second', 'name': 'Second', 'details': '', 'isDefault': 0});
      final other = await roles
          .resolve(invoice('other-buy', 3, 'fresh', 'second', false, 2, 6));
      await commands.post(w, 'other-buy', other);
      await commands.post(w, 'other-buy', other);
      final locations = await db.query('inventory_items', orderBy: 'rowid');
      expect(locations, hasLength(2));
      expect(locations[0]['quantity'], 8);
      expect(locations[1]['quantity'], 2);
      expect(locations[1]['avgCost'], 6);
      snap =
          await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse: true);
      expect((snap['inventory'] as List).last['catalogSourceItemId'], 'fresh');
      await db.insert('inventory_items',{'id':'large','name':'Large balance','unit':'piece','quantity':9000000,'avgCost':900,'warehouseId':wh,'minThreshold':0,'sku':''});
      await commands.post(w,'large-sale',await roles.resolve(invoice('large-sale',4,'large',wh,true,1,1000)));
      expect((await db.query('inventory_items',where:'id = ?',whereArgs:['large'])).single['quantity'],8999999);
      final first = await backups.exportNative();
      await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse: true);
      expect(await backups.exportNative(), orderedEquals(first));
      final source =
          Uint8List.fromList(utf8.encode('synthetic source evidence'));
      final sourceSha = sha256.convert(source).toString();
      Map<String, dynamic> item(String id, num reference) => {
            'id': id,
            'name': id,
            'unit': 'piece',
            'warehouseId': 'wh',
            'currencyCode': 'ريال',
            'avgCost': reference,
            'quantity': 0,
            'quantityUnverified': true
          };
      Map<String, dynamic> entry(String id, int number, String item, int doc,
              num qty, num price) =>
          {
            'id': id,
            'accountId': 'party',
            'accountName': 'Original party',
            'currency': 'ريال',
            'entryNumber': number,
            'entryDate': '2020-01-01',
            'kind': 'invoice',
            'docType': doc,
            'amount': qty * price,
            'rawDain': doc == 2 ? qty * price : 0,
            'rawMadin': doc == 3 ? qty * price : 0,
            'direction': doc == 2 ? 'debit' : 'credit',
            'payment': 'credit',
            'invoiceContent': 'items',
            'warehouseId': 'wh',
            'lines': [
              {
                'inventoryItemId': item,
                'warehouseId': 'wh',
                'quantity': qty,
                'price': price,
                'total': qty * price,
                'unitNum': 1
              }
            ],
          };
      final candidate = BackupCandidate(
          'synthetic.back',
          'legacy-sqlite',
          source,
          sourceSha,
          {
            'currencies': [
              {'id': 1, 'code': 'SAR', 'name': 'ريال'}
            ],
            'cashboxes': [],
            'accountGroups': [],
            'accounts': [
              {
                'id': 'party',
                'name': 'Original party',
                'currency': 'ريال',
                'category': 'clients',
                'openingBalance': 23,
                'openingDirection': 'debit'
              }
            ],
            'warehouses': [
              {'id': 'wh', 'name': 'Original warehouse', 'isDefault': true}
            ],
            'inventory': [
              item('positive', 3),
              item('negative', 10),
              item('free', 0),
              item('counted', 6)
            ],
            'ledger': [
              entry('old-buy', 1, 'positive', 3, 10, 5),
              entry('old-sale-a', 2, 'positive', 2, 2, 9),
              entry('old-sale-b', 3, 'positive', 2, 2, 9),
              entry('old-negative', 4, 'negative', 2, 3, 15),
              entry('old-free', 5, 'free', 3, 4, 0)
            ],
          },
          {
            'legacyDetailsVersion': LegacySourceDetails.version,
            'sourceExtraCounts': {'store_trans': 0, 'trans_details': 0}
          },
          null);
      await LegacyOperationalRestore(local).activate(candidate,
          replacementSha: sha256.convert(first).toString());
      // A previously counted opening, plus a later purchase, must both survive.
      await db.update('inventory_items', {'quantity': 5},
          where: 'id = ?', whereArgs: ['counted']);
      await db.insert('erp_state', {
        'stateKey': '${StockQuantityApprovalState.prefix}counted',
        'payloadJson': jsonEncode({
          'source_sha': sourceSha,
          'source_item_id': 'counted',
          'warehouse_id': 'wh',
          'item_id': 'counted',
          'quantity': 5,
          'entry_date': '2020-02-01'
        }),
        'updatedAt': '2020-02-01'
      });
      await roles.load();
      await db.insert('accounts', {
        'id': 'nasqo-default-sar-cash-supplier',
        'name': 'Supplier',
        'category': 'purchases',
        'currency': 'sar',
        'isCashAccount': 0,
        'phone': '',
        'creditLimit': 0,
        'note': 'nasqo:default:cash-supplier',
        'openingBalance': 0,
        'openingDirection': 'debit',
        'codeNumber': 99
      });
      await commands.post(
          w,
          'pending-buy',
          await roles.resolve(
              invoice('pending-buy', 6, 'counted', 'wh', false, 2, 15)));
      final originalParty =
          (await db.query('accounts', where: 'id = ?', whereArgs: ['party']))
              .single;
      final rawRows = await db.query('legacy_operational_rows');
      snap =
          await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse: true);
      expect(await db.query('legacy_unverified_stock'), isEmpty);
      final stock = {
        for (final i in await db.query('inventory_items')) i['id']: i
      };
      expect(stock['positive']!['quantity'], 6);
      expect(stock['positive']!['avgCost'], 5);
      expect(stock['negative']!['quantity'], -3);
      expect(stock['negative']!['avgCost'], 10);
      expect(stock['free']!['quantity'], 4);
      expect(stock['free']!['avgCost'], 0);
      expect(stock['counted']!['quantity'], 7);
      expect((stock['counted']!['avgCost'] as num) * 7, closeTo(60, 0.000001));
      expect(await db.query('legacy_operational_rows'), rawRows);
      expect(
          (await db.query('accounts', where: 'id = ?', whereArgs: ['party']))
              .single,
          originalParty);
      expect(await db.query('stock_movements'), hasLength(1));
      await StockQuantityApprovalState.validate(db);
      await AutomaticStockBaseline.validate(db);
      final after = await backups.exportNative();
      await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse: true);
      expect(await backups.exportNative(), orderedEquals(after));
      final max = (await db
              .rawQuery('SELECT MAX(entryNumber) AS n FROM ledger_entries'))
          .single['n'] as int;
      await commands.post(
          w,
          'negative-buy',
          await roles.resolve(invoice(
              'negative-buy', max + 1, 'negative', 'wh', false, 5, 12)));
      var negative = (await db.query('inventory_items',
              where: 'id = ?', whereArgs: ['negative']))
          .single;
      expect(negative['quantity'], 2);
      expect(negative['avgCost'], 12);
      await commands.post(w, 'negative-return', {
        'id': 'negative-return',
        'kind': 'return',
        'originalInvoiceId': 'negative-buy',
        'entryNumber': max + 2,
        'entryDate': '2090-01-01'
      });
      negative = (await db.query('inventory_items',
              where: 'id = ?', whereArgs: ['negative']))
          .single;
      expect(negative['quantity'], -3);
      expect(negative['avgCost'], 10);
      await commands.post(
          w,
          'restored-sale',
          await roles.resolve(invoice(
              'restored-sale', max + 3, 'positive', 'wh', true, 1, 10)));
      for (final row in await db.rawQuery(
          'SELECT journal_id,SUM(debit_minor) AS d,SUM(credit_minor) AS c FROM journal_lines GROUP BY journal_id')) {
        expect(row['d'], row['c']);
      }
      final exported = await backups.exportNative();
      final path =
          await File('${dir.path}/roundtrip.back').writeAsBytes(exported);
      await backups.restoreNative(await backups.inspect(path, 'roundtrip.back'),
          replacementSha: sha256.convert(exported).toString(),
          prepareForUse: true);
      Map<String, dynamic> tables(Uint8List bytes) {
        final data =
            jsonDecode(jsonDecode(utf8.decode(bytes))['payload'])['tables']
                as Map<String, dynamic>;
        return data.map((k, v) =>
            MapEntry(k, (v as List).map(jsonEncode).toList()..sort()));
      }

      expect(tables(await backups.exportNative()), tables(exported));
      expect(
          await LegacyOperationalRestore.original(db), orderedEquals(source));
      final report = await db.transaction((t) async =>
          LocalInventoryReports.report(
              t,
              await HybridLocalSnapshotAdapter.readInTransaction(t, local),
              {'warehouseId': 'wh'}));
      for (final row in report['itemRows'] as List) {
        expect(row['quantityUnverified'], false);
        expect(row['costUnverified'], false);
      }
    } finally {
      await db.close();
      await dir.delete(recursive: true);
    }
  });
}
