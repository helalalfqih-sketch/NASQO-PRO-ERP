import 'dart:io';
import 'dart:isolate';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/stock_invoice_commands.dart';

const _workspace = 'local-erp-workspace';

// Each invocation runs in a fresh isolate. The LocalDatabase singleton and all
// Dart receipt state are discarded between phases, while the file survives.
Future<Map<String, Object?>> _phase(
  String directory,
  Map<String, dynamic>? existingInvoice,
  bool retry,
) async {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  await databaseFactory.setDatabasesPath(directory);
  final local = LocalDatabase.instance;
  final db = await local.database;
  try {
    Map<String, dynamic> invoice;
    if (existingInvoice == null) {
      final accounts = LocalAccountCommands(local);
      final supplier = await accounts.save(_workspace, 'synthetic-supplier', {
        'name': 'Synthetic supplier', 'category': 'purchases', 'currency': 'ريال',
      });
      final inventory = await accounts.save(_workspace, 'synthetic-inventory', {
        'name': 'Synthetic inventory', 'category': 'shop', 'currency': 'ريال',
      });
      await db.insert('warehouses', {
        'id': 'synthetic-wh', 'name': 'Synthetic warehouse', 'details': '', 'isDefault': 1,
      });
      await db.insert('inventory_items', {
        'id': 'synthetic-item', 'name': 'Synthetic item', 'unit': 'piece',
        'quantity': 0, 'avgCost': 0, 'warehouseId': 'synthetic-wh', 'minThreshold': 0, 'sku': '',
      });
      invoice = {
        'id': 'synthetic-invoice', 'kind': 'invoice', 'payment': 'credit',
        'direction': 'credit', 'invoiceContent': 'items', 'accountId': supplier,
        'counterpartAccountId': inventory, 'inventoryAccountId': inventory,
        'amount': 50, 'currency': 'ريال', 'warehouseId': 'synthetic-wh',
        'entryNumber': 1001, 'entryDate': '2026-11-25',
        'lines': [
          {'inventoryItemId': 'synthetic-item', 'quantity': 10, 'price': 5, 'discount': 0, 'total': 50},
        ],
      };
      // Simulate commit followed by lost UI acknowledgement: the returned ID
      // is deliberately ignored, then the database and isolate are closed.
      await StockInvoiceCommands(local).post(_workspace, 'document_synthetic-invoice', invoice);
    } else {
      invoice = existingInvoice;
      if (retry) {
        await StockInvoiceCommands(local).post(_workspace, 'document_synthetic-invoice', invoice);
      }
    }
    final state = <String, Object?>{};
    for (final table in [
      'accounts', 'ledger_entries', 'invoice_lines', 'journal_entries',
      'journal_lines', 'inventory_items', 'stock_movements',
      'stock_posting_documents', 'stock_posting_lines',
    ]) {
      state[table] = await db.query(table, orderBy: 'id');
    }
    state['pending_operations'] = await local.pendingOperations(_workspace);
    state['foreign_key_errors'] = await db.rawQuery('PRAGMA foreign_key_check');
    return {'invoice': invoice, 'state': state};
  } finally {
    await db.close();
  }
}

void main() {
  test('lost posting acknowledgement survives fresh Dart state without duplicate journal or stock', () async {
    final directory = await Directory.systemTemp.createTemp('nasqo_ack_recovery_');
    try {
      final committed = await Isolate.run(() => _phase(directory.path, null, false));
      final invoice = Map<String, dynamic>.from(committed['invoice'] as Map);
      final reopened = await Isolate.run(() => _phase(directory.path, invoice, false));
      expect(reopened['state'], equals(committed['state']), reason: 'Reopening must not replay any financial operation');
      final explicitRetry = await Isolate.run(() => _phase(directory.path, invoice, true));
      expect(explicitRetry['state'], equals(committed['state']), reason: 'The same durable operation ID must be idempotent after restart');
      final state = Map<String, Object?>.from(explicitRetry['state'] as Map);
      expect(state['ledger_entries'], hasLength(1));
      expect(state['journal_entries'], hasLength(1));
      expect(state['journal_lines'], hasLength(2));
      expect(state['stock_movements'], hasLength(1));
      expect(state['stock_posting_lines'], hasLength(1));
      expect(state['foreign_key_errors'], isEmpty);
      final item = ((state['inventory_items'] as List).single as Map);
      expect(item['quantity'], 10);
      expect(item['avgCost'], 5);
      final legs = (state['journal_lines'] as List).cast<Map>();
      expect(legs.fold<num>(0, (sum, leg) => sum + (leg['debit_minor'] as num)), 5000);
      expect(legs.fold<num>(0, (sum, leg) => sum + (leg['credit_minor'] as num)), 5000);
    } finally {
      await directory.delete(recursive: true);
    }
  });
}
