import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/hybrid/erp_hybrid_adapter.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_bridge_router.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_protocol.dart';
import 'package:nasqo_pro_erp/hybrid/nasqo_hybrid_flags.dart';
import 'package:nasqo_pro_erp/hybrid/posting_receipt_guard.dart';
import 'package:nasqo_pro_erp/models/erp_models.dart';
import 'package:nasqo_pro_erp/state/erp_controller.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Map<String, Object?> _req({
  required String id,
  required String action,
  required Map<String, Object?> payload,
  String? idempotencyKey,
}) =>
    <String, Object?>{
      'protocolVersion': kHybridProtocolVersion,
      'kind': 'request',
      'requestId': id,
      'action': action,
      'payload': payload,
      'timestampMs': DateTime.now().millisecondsSinceEpoch,
      if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
    };

/// Creates the EXACT existing `LocalDatabase` schema (no parallel database).
Future<Database> _openExistingLocalSchemaInMemory() async {
  final db = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
  await db.execute('''
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      phone TEXT NOT NULL,
      creditLimit REAL NOT NULL,
      currency TEXT NOT NULL,
      isCashAccount INTEGER NOT NULL,
      note TEXT NOT NULL,
      openingBalance REAL NOT NULL,
      openingDirection TEXT NOT NULL,
      codeNumber INTEGER NOT NULL
    )
  ''');
  await db.execute('''
    CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      accountName TEXT NOT NULL,
      kind TEXT NOT NULL,
      typeLabel TEXT NOT NULL,
      payment TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchangeRate REAL NOT NULL,
      details TEXT NOT NULL,
      documentNumber TEXT NOT NULL,
      warehouseId TEXT NOT NULL,
      warehouseName TEXT NOT NULL,
      expenseCategory TEXT NOT NULL,
      entryNumber INTEGER NOT NULL,
      deleted INTEGER NOT NULL,
      entryDate TEXT NOT NULL
    )
  ''');
  await db.execute('''
    CREATE TABLE warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      details TEXT NOT NULL,
      isDefault INTEGER NOT NULL
    )
  ''');
  await db.execute('''
    CREATE TABLE inventory_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      avgCost REAL NOT NULL,
      warehouseId TEXT NOT NULL,
      minThreshold REAL NOT NULL,
      sku TEXT NOT NULL
    )
  ''');
  await db.execute('''
    CREATE TABLE erp_state (
      stateKey TEXT PRIMARY KEY,
      payloadJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  ''');
  return db;
}

void main() {
  sqfliteFfiInit();

  late Database db;
  late ErpController controller;
  late PostingReceiptGuard guard;
  late ErpHybridAdapter adapter;
  late bool writesAllowed;
  late List<String> legacyReceived;
  late HybridBridgeRouter router;

  setUp(() async {
    db = await _openExistingLocalSchemaInMemory();
    controller = ErpController(autoInitDb: false);
    guard = PostingReceiptGuard(databaseProvider: () async => db);
    adapter = ErpHybridAdapter(
      controller: controller,
      receiptGuard: guard,
      databaseProvider: () async => db,
    );
    writesAllowed = true;
    legacyReceived = <String>[];
    router = HybridBridgeRouter(
      adapter: adapter,
      allowFinancialWrites: () => writesAllowed,
      legacyHandler: (raw) async {
        legacyReceived.add(raw);
        return '{"legacyHandled":true}';
      },
    );
  });

  tearDown(() async {
    controller.dispose();
    await db.close();
  });

  Future<Map<String, Object?>> send(Map<String, Object?> envelope) async {
    final rawResp = await router.handleRawMessage(jsonEncode(envelope));
    expect(rawResp, isNotNull);
    final decoded = jsonDecode(rawResp!) as Map<String, dynamic>;
    return decoded.map((k, v) => MapEntry(k, v as Object?));
  }

  test('defaults match kDebugMode (Debug APK runs React V2 by default; Release keeps 0d734ca safe)', () {
    expect(NasqoHybridFlags.defaultUseReactHybridV2, equals(kDebugMode));
    expect(NasqoHybridFlags.defaultAllowFinancialWrites, equals(kDebugMode));
    NasqoHybridFlags.setUseReactHybridV2(false);
    expect(NasqoHybridFlags.useReactHybridV2.value, isFalse);
    NasqoHybridFlags.setUseReactHybridV2(true);
    expect(NasqoHybridFlags.useReactHybridV2.value, isTrue);
  });

  test('forwards legacy non-v1.0.0 NasqoHome messages untouched', () async {
    const legacyMsg = '{"type":"openSection","section":"purchases"}';
    final resp = await router.handleRawMessage(legacyMsg);
    expect(resp, '{"legacyHandled":true}');
    expect(legacyReceived, [legacyMsg]);
  });

  test('starts clean and empty on fresh install and persists full offline workflow across restart', () async {
    final initResult = await adapter.loadOrInitializeUpgradeSafe();
    expect(initResult['mode'], 'fresh_clean_empty');
    expect(controller.accounts, isEmpty);
    expect(controller.ledger, isEmpty);
    expect(controller.inventory, isEmpty);
    expect(controller.warehouses.length, 1);

    // 1. Create account
    final accRes = await send(
      _req(
        id: 'req_e2e_acc',
        action: 'saveAccount',
        idempotencyKey: 'idem_e2e_acc_1',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'id': 'acc_offline_1',
            'name': 'عميل اختبار وضع الطيران',
            'category': 'sales',
            'currency': 'ريال',
          },
        },
      ),
    );
    expect(accRes['ok'], isTrue);

    // 2. Create inventory item
    final itemRes = await send(
      _req(
        id: 'req_e2e_item',
        action: 'createInventoryItem',
        idempotencyKey: 'idem_e2e_item_1',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'id': 'inv_offline_1',
            'name': 'بطارية ليثيوم 100Ah',
            'unit': 'حبة',
            'quantity': 10,
            'avgCost': 200,
            'warehouseId': 'wh_main',
          },
        },
      ),
    );
    expect(itemRes['ok'], isTrue);

    // 3. Create purchase invoice (increases stock by 5 -> 15)
    final invRes = await send(
      _req(
        id: 'req_e2e_inv',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_e2e_inv_1',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'accountId': 'acc_offline_1',
            'accountName': 'عميل اختبار وضع الطيران',
            'kind': 'invoice',
            'typeLabel': 'فاتورة مشتريات آجل',
            'payment': 'credit',
            'direction': 'credit',
            'amount': 1100,
            'currency': 'ريال',
            'lines': [
              {
                'lineKind': 'item',
                'inventoryItemId': 'inv_offline_1',
                'itemName': 'بطارية ليثيوم 100Ah',
                'quantity': 5,
                'price': 220,
                'total': 1100,
              },
            ],
          },
        },
      ),
    );
    expect(invRes['ok'], isTrue);

    // 4. Create receipt voucher
    final vchRes = await send(
      _req(
        id: 'req_e2e_vch',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_e2e_vch_1',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'accountId': 'acc_offline_1',
            'accountName': 'عميل اختبار وضع الطيران',
            'kind': 'voucher',
            'typeLabel': 'سند صرف نقدي',
            'payment': 'cash',
            'direction': 'debit',
            'amount': 400,
            'currency': 'ريال',
          },
        },
      ),
    );
    expect(vchRes['ok'], isTrue);

    // 5. Save UI preferences (dark mode + tile customization)
    final prefRes = await send(
      _req(
        id: 'req_e2e_prefs',
        action: 'saveUiPreferences',
        payload: <String, Object?>{
          'preferences': {
            'themeMode': 'dark',
            'homeTileLayout': {
              'order': ['new-invoice', 'new-voucher'],
              'pinned': ['new-invoice'],
              'hidden': [],
              'toneOverrides': {},
            },
          },
        },
      ),
    );
    expect(prefRes['ok'], isTrue);

    // 6. Simulate app close & reopen against the SAME SQLite database
    final reopenedController = ErpController(autoInitDb: false);
    final reopenedAdapter = ErpHybridAdapter(
      controller: reopenedController,
      receiptGuard: PostingReceiptGuard(databaseProvider: () async => db),
      databaseProvider: () async => db,
    );
    final reopenState = await reopenedAdapter.loadOrInitializeUpgradeSafe();
    expect(reopenState['mode'], 'upgraded_preserved');
    expect(reopenedController.accounts.length, 1);
    expect(reopenedController.accounts.first.name, 'عميل اختبار وضع الطيران');
    expect(reopenedController.ledger.length, 2);
    expect(reopenedController.inventory.length, 1);
    expect(reopenedController.inventory.first.quantity, 15.0);

    final reopenedSnap = await reopenedAdapter.getSnapshot(
      allowFinancialWrites: true,
    );
    final savedPrefs =
        reopenedSnap['uiPreferences'] as Map<String, dynamic>;
    expect(savedPrefs['themeMode'], 'dark');
    reopenedController.dispose();
  });

  test('preserves 100% of existing LocalDatabase rows across an APK upgrade', () async {
    // Seed pre-existing rows simulating an older APK version before upgrade
    await db.insert('accounts', <String, Object?>{
      'id': 'legacy_acc_1',
      'name': 'مورد النسخة السابقة',
      'category': 'purchases',
      'phone': '777000111',
      'creditLimit': 100000.0,
      'currency': 'sar',
      'isCashAccount': 0,
      'note': 'بيانات قبل الترقية',
      'openingBalance': 2500.0,
      'openingDirection': 'credit',
      'codeNumber': 101,
    });
    await db.insert('ledger_entries', <String, Object?>{
      'id': 'legacy_led_1',
      'accountId': 'legacy_acc_1',
      'accountName': 'مورد النسخة السابقة',
      'kind': 'invoice',
      'typeLabel': 'فاتورة مشتريات آجل',
      'payment': 'credit',
      'direction': 'credit',
      'amount': 1800.0,
      'currency': 'sar',
      'exchangeRate': 1.0,
      'details': 'فاتورة سابقة قبل الترقية',
      'documentNumber': 'OLD-55',
      'warehouseId': 'wh_legacy',
      'warehouseName': 'المخزن القديم',
      'expenseCategory': '',
      'entryNumber': 55,
      'deleted': 0,
      'entryDate': '2026-10-01',
    });
    await db.insert('warehouses', <String, Object?>{
      'id': 'wh_legacy',
      'name': 'المخزن القديم',
      'details': '',
      'isDefault': 1,
    });

    final upgradeResult = await adapter.loadOrInitializeUpgradeSafe();
    expect(upgradeResult['mode'], 'upgraded_preserved');
    expect(controller.accounts.length, 1);
    expect(controller.accounts.first.id, 'legacy_acc_1');
    expect(controller.accounts.first.openingBalance, 2500.0);
    expect(controller.ledger.length, 1);
    expect(controller.ledger.first.documentNumber, 'OLD-55');
    expect(controller.warehouses.first.id, 'wh_legacy');
  });

  test('supports full backup export and atomic restore round-trip on test data', () async {
    await adapter.loadOrInitializeUpgradeSafe();
    await send(
      _req(
        id: 'req_bkp_acc',
        action: 'saveAccount',
        idempotencyKey: 'idem_bkp_acc_1',
        payload: <String, Object?>{
          'payload': {
            'id': 'acc_bkp_1',
            'name': 'حساب النسخة الاحتياطية',
            'category': 'clients',
            'currency': 'ريال',
          },
        },
      ),
    );
    await send(
      _req(
        id: 'req_bkp_led',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_bkp_led_1',
        payload: <String, Object?>{
          'payload': {
            'accountId': 'acc_bkp_1',
            'accountName': 'حساب النسخة الاحتياطية',
            'kind': 'voucher',
            'typeLabel': 'سند قبض',
            'payment': 'cash',
            'direction': 'credit',
            'amount': 750,
            'currency': 'ريال',
          },
        },
      ),
    );

    final exported = await send(
      _req(
        id: 'req_bkp_export',
        action: 'backupWorkspace',
        payload: const {'backupName': 'test-offline-backup.json'},
      ),
    );
    expect(exported['ok'], isTrue);
    final b64 = (exported['data'] as Map)['base64Content'] as String;
    expect(b64, isNotEmpty);

    // Clear workspace
    await send(
      _req(
        id: 'req_bkp_reset',
        action: 'resetWorkspace',
        idempotencyKey: 'idem_bkp_reset_1',
        payload: const {},
      ),
    );
    expect(controller.accounts, isEmpty);
    expect(controller.ledger, isEmpty);

    // Restore atomically
    final restored = await send(
      _req(
        id: 'req_bkp_restore',
        action: 'restoreWorkspace',
        idempotencyKey: 'idem_bkp_restore_1',
        payload: {'base64Content': b64},
      ),
    );
    expect(restored['ok'], isTrue);
    expect(controller.accounts.length, 1);
    expect(controller.accounts.first.name, 'حساب النسخة الاحتياطية');
    expect(controller.ledger.length, 1);
    expect(controller.ledger.first.amount, 750.0);
  });

  test('blocks financial writes in Dart when allowFinancialWrites is false', () async {
    writesAllowed = false;
    final res = await send(
      _req(
        id: 'req_ro_1',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_ro_001',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'accountId': controller.accounts.first.id,
            'accountName': controller.accounts.first.name,
            'amount': 250,
          },
        },
      ),
    );
    expect(res['ok'], isFalse);
    expect((res['error'] as Map)['code'], 'UNAUTHORIZED_ACTION');
  });

  test('prevents duplicate posting via PostingReceiptGuard inside the SAME LocalDatabase', () async {
    final initialLedgerLen = controller.ledger.length;
    final item = controller.inventory.first;
    final initialQty = item.quantity;

    final purchasePayload = <String, Object?>{
      'workspaceId': 'local-erp-workspace',
      'payload': {
        'accountId': controller.accounts.first.id,
        'accountName': controller.accounts.first.name,
        'kind': 'invoice',
        'typeLabel': 'فاتورة مشتريات آجل',
        'payment': 'credit',
        'direction': 'credit',
        'amount': 600,
        'currency': 'ريال',
        'lines': [
          {
            'lineKind': 'item',
            'inventoryItemId': item.id,
            'itemName': item.name,
            'quantity': 5,
            'price': 120,
            'total': 600,
          },
        ],
      },
    };

    final first = await send(
      _req(
        id: 'req_post_1',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_receipt_1001',
        payload: purchasePayload,
      ),
    );
    expect(first['ok'], isTrue);
    final firstReceipt =
        ((first['data'] as Map)['postingReceipt'] as Map<String, dynamic>);
    expect(firstReceipt['replayed'], isFalse);

    final retry = await send(
      _req(
        id: 'req_post_2',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_receipt_1001',
        payload: purchasePayload,
      ),
    );
    expect(retry['ok'], isTrue);
    final retryReceipt =
        ((retry['data'] as Map)['postingReceipt'] as Map<String, dynamic>);
    expect(retryReceipt['replayed'], isTrue);
    expect(retryReceipt['receiptId'], firstReceipt['receiptId']);

    final tampered = await send(
      _req(
        id: 'req_post_3',
        action: 'createLedgerEntry',
        idempotencyKey: 'idem_receipt_1001',
        payload: <String, Object?>{
          'workspaceId': 'local-erp-workspace',
          'payload': {
            'accountId': controller.accounts.first.id,
            'accountName': controller.accounts.first.name,
            'amount': 9999,
          },
        },
      ),
    );
    expect(tampered['ok'], isFalse);
    expect((tampered['error'] as Map)['code'], 'DUPLICATE_REQUEST');

    expect(controller.ledger.length, initialLedgerLen + 1);
    expect(controller.inventory.first.quantity, initialQty + 5);

    final dbLedgerRows = await db.query('ledger_entries');
    expect(dbLedgerRows.length, initialLedgerLen + 1);
    final receiptRows = await db.query('posting_receipts');
    expect(receiptRows.length, 1);
  });

  test('separates multi-currency totals in cashboxes report without merging', () async {
    controller.ledger.add(
      const LedgerEntryRecord(
        id: 'led_usd_cash_1',
        accountId: 'acc_client_1',
        accountName: 'عميل دولار',
        kind: LedgerKind.voucher,
        typeLabel: 'سند قبض نقدي دولار',
        payment: PaymentMethod.cash,
        direction: EntryDirection.credit,
        amount: 350,
        currency: CurrencyCode.usd,
        entryNumber: 9001,
        entryDate: '2026-11-22',
      ),
    );

    final report = await send(
      _req(id: 'req_cash_rep', action: 'getCashboxesReport', payload: const {}),
    );
    expect(report['ok'], isTrue);
    final recon =
        (report['data'] as Map)['reconciliation'] as Map<String, dynamic>;
    final byCurrency = recon['totalsByCurrency'] as List<dynamic>;
    final usd = byCurrency.firstWhere((e) => (e as Map)['currency'] == 'دولار')
        as Map<String, dynamic>;
    expect(usd['totalCashNet'], 350.0);
  });
}
