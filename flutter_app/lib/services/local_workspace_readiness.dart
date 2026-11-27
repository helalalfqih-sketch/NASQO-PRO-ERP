import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:sqflite/sqflite.dart';
import '../hybrid/local_snapshot_adapter.dart';
import 'automatic_posting_setup.dart';
import 'automatic_stock_baseline.dart';
import 'local_database.dart';
import 'local_inventory_reports.dart';
import 'local_master_catalog.dart';
import 'stock_invoice_commands.dart';
import 'stock_quantity.dart';
import 'stock_quantity_approval_state.dart';

/// One atomic, repeatable upgrade for local businesses, on startup and restore.
class LocalWorkspaceReadiness {
  static const marker = 'automatic_stock_readiness_v1';
  static Future<void> prepare(Transaction t, LocalDatabase local) async {
    if ((await t.query('backup_review_active', limit: 1)).isNotEmpty ||
        (await t.query('erp_state',
                where: 'stateKey = ?', whereArgs: ['sync_workspace_binding']))
            .isNotEmpty) return;
    await AutomaticPostingSetup.defaults(t);
    final sources =
        await t.query('legacy_operational_source', columns: ['sha'], limit: 1);
    if (sources.isEmpty) return;
    final sha = sources.single['sha'] as String;
    final done =
        await t.query('erp_state', where: 'stateKey = ?', whereArgs: [marker]);
    if (done.isNotEmpty &&
        jsonDecode(done.single['payloadJson'] as String) == sha) return;
    final snapshot =
        await HybridLocalSnapshotAdapter.readInTransaction(t, local);
    final evidence = await LocalInventoryReports.evidence(t, snapshot);
    final events = (evidence['events'] as List)
        .cast<Map<String, dynamic>>()
        .where((e) => e['historical'] == true)
        .toList();
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final e in events) {
      grouped
          .putIfAbsent('${e['sourceItemId']}|${e['warehouseId']}', () => [])
          .add(e);
    }
    final items = {
      for (final i in await t.query('inventory_items')) i['id'] as String: i
    };
    final warehouses = {
      for (final w in await t.query('warehouses')) w['id']: w
    };
    final archived =
        await LocalInventoryReports.sourceRows(t, 'inventory', null);
    final approved = await StockQuantityApprovalState.read(t);
    final valued = {
      for (final o in await t.query('legacy_stock_openings'))
        '${o['source_item_id']}|${o['warehouse_id']}': o
    };
    final unverified = (await t.query('legacy_unverified_stock'))
        .map((r) => r['item_id'])
        .toSet();
    final byQuantity = {
      for (final q in approved.values)
        '${q['source_item_id']}|${q['warehouse_id']}': q
    };
    final baselines = await AutomaticStockBaseline.read(t);
    final now = DateTime.now().toUtc().toIso8601String();
    final latest =
        (await t.rawQuery('SELECT MAX(entryDate) AS d FROM ledger_entries'))
                .single['d'] as String? ??
            '';
    final today = now.substring(0, 10),
        date = latest.compareTo(today) > 0 ? latest : today;
    var number = (await t.rawQuery(
            'SELECT COALESCE(MAX(entryNumber),0) AS n FROM ledger_entries'))
        .single['n'] as int;
    final roleCache = <String, Map<String, String>>{};
    for (final source in archived) {
      final sid = source['id'] as String, master = items[sid];
      if (master == null || source['quantityUnverified'] == false) continue;
      final locations = <String>{
        if (warehouses.containsKey(master['warehouseId']))
          master['warehouseId'] as String,
        for (final e in events.where((e) => e['sourceItemId'] == sid))
          e['warehouseId'] as String,
        for (final q
            in approved.values.where((q) => q['source_item_id'] == sid))
          q['warehouse_id'] as String,
      };
      for (final wh in locations) {
        final pair = '$sid|$wh';
        if (valued.containsKey(pair)) continue;
        final digest = sha256.convert(utf8.encode(pair)).toString();
        final id =
            master['warehouseId'] == wh ? sid : 'legacy-location-$digest';
        if (baselines.containsKey(id)) continue;
        final qa = byQuantity[pair], existing = items[id];
        if (existing != null && !unverified.contains(id)) continue;
        final history = grouped[pair] ?? [];
        final quantity = qa == null
            ? history.fold<num>(0, (s, e) => s + (e['effectQty'] as num))
            : qa['quantity'] as num;
        final ticks = StockQuantity.balanceTicks(quantity);
        final currency =
            LocalMasterCatalog.currencyCodes[source['currencyCode']] ?? 'sar';
        final roles = roleCache[currency] ??=
            await AutomaticPostingSetup.ensure(t, currency);
        final pending =
            qa == null ? null : await StockQuantityApprovalState.pending(t, id);
        final asset = pending?.inventoryAccountId ?? roles['inventory']!,
            offset = roles['opening']!;
        if (asset == offset)
          throw StateError('Opening and inventory accounts must differ');
        num buyQty = 0, buyValue = 0;
        for (final e in history.where((e) =>
            e['financial'] == true &&
            e['currency'] == source['currencyCode'])) {
          final sign = e['role'] == 'buy'
              ? 1
              : e['role'] == 'purchaseReturn'
                  ? -1
                  : 0;
          buyQty += sign * (e['baseQuantity'] as num);
          buyValue += sign * (e['total'] as num);
        }
        final reference = LocalInventoryReports.n(
            source['catalogReferenceCost'],
            LocalInventoryReports.n(source['avgCost']));
        final cost = buyQty > 0 && buyValue >= 0
            ? buyValue / buyQty
            : reference > 0
                ? reference
                : 0;
        final value = (StockQuantity.units(ticks) * cost * 100).round();
        if (value.abs() > 1000000000000)
          throw StateError('Stock opening outside supported range');
        final current = StockQuantity.balanceTicks(quantity) +
            (pending?.purchasedTicks ?? 0);
        final currentValue = value + (pending?.valueMinor ?? 0);
        if (qa == null &&
            existing != null &&
            (existing['quantity'] != 0 ||
                existing['avgCost'] != 0 ||
                (await t.query('stock_movements',
                        where: 'item_id = ?', whereArgs: [id], limit: 1))
                    .isNotEmpty))
          throw StateError(
              'Stock cutover conflicts with existing operational movements');
        final row = {
          ...master,
          'id': id,
          'warehouseId': wh,
          'quantity': StockQuantity.units(current),
          'avgCost': current == 0
              ? 0
              : currentValue / StockQuantity.units(current) / 100
        };
        if (existing == null) {
          await t.insert('inventory_items', row);
          final units = await t.query('inventory_unit_settings',
              where: 'item_id = ?', whereArgs: [sid]);
          if (units.isNotEmpty)
            await t.insert('inventory_unit_settings', {
              'item_id': id,
              'settings_json': units.single['settings_json']
            });
        } else {
          await t
              .update('inventory_items', row, where: 'id = ?', whereArgs: [id]);
        }
        await t.delete('legacy_unverified_stock',
            where: 'item_id = ?', whereArgs: [id]);
        String? ledger;
        if (value != 0) {
          ledger = 'automatic-opening-$digest';
          final a =
              (await t.query('accounts', where: 'id = ?', whereArgs: [asset]))
                  .single;
          final b =
              (await t.query('accounts', where: 'id = ?', whereArgs: [offset]))
                  .single;
          await t.insert('ledger_entries', {
            'id': ledger,
            'accountId': asset,
            'accountName': a['name'],
            'counterpartAccountId': offset,
            'counterpartAccountName': b['name'],
            'kind': 'opening',
            'typeLabel': 'رصيد المخزون المستورد',
            'payment': 'balance',
            'direction': value > 0 ? 'debit' : 'credit',
            'amount': value.abs() / 100,
            'currency': currency,
            'exchangeRate': 1,
            'details': 'رصيد بداية من النسخة المستوردة',
            'documentNumber': '',
            'warehouseId': wh,
            'warehouseName': warehouses[wh]!['name'],
            'expenseCategory': '',
            'entryNumber': ++number,
            'deleted': 0,
            'entryDate': date,
            'invoiceContent': 'none',
            'postingStatus': 'posted'
          });
          await StockInvoiceCommands.journal(t, ledger, currency, [
            StockInvoiceCommands.leg(asset, value.abs(), value > 0),
            StockInvoiceCommands.leg(offset, value.abs(), value < 0)
          ]);
        }
        final baseline = {
          'source_sha': sha,
          'source_item_id': sid,
          'warehouse_id': wh,
          'item_id': id,
          'quantity': StockQuantity.units(ticks),
          'value_minor': value,
          'inventory_account_id': asset,
          'offset_account_id': offset,
          'currency': currency,
          'ledger_id': ledger,
          'entry_date': qa?['entry_date'] ?? date,
          'valuation_date': date,
          'basis': buyQty > 0 && buyValue >= 0
              ? 'net-purchase-average'
              : 'catalog-purchase-price'
        };
        await t.insert('erp_state', {
          'stateKey': '${AutomaticStockBaseline.prefix}$id',
          'payloadJson': jsonEncode(baseline),
          'updatedAt': now
        });
      }
    }
    await t.insert('erp_state',
        {'stateKey': marker, 'payloadJson': jsonEncode(sha), 'updatedAt': now},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }
}
