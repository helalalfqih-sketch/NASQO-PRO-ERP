import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';

class LocalDbSnapshot {
  const LocalDbSnapshot({
    required this.accounts,
    required this.ledger,
    required this.warehouses,
    required this.inventory,
    this.companyName,
    this.isDarkMode,
    this.nextEntryNumber,
    this.uiPreferences = const <String, dynamic>{},
  });

  final List<AccountRecord> accounts;
  final List<LedgerEntryRecord> ledger;
  final List<WarehouseRecord> warehouses;
  final List<InventoryItemRecord> inventory;
  final String? companyName;
  final bool? isDarkMode;
  final int? nextEntryNumber;
  final Map<String, dynamic> uiPreferences;
}

class LocalDatabase {
  LocalDatabase._();
  static final LocalDatabase instance = LocalDatabase._();

  static const String dbName = 'nasqo_pro_erp.db';
  static const int dbVersion = 1;

  Database? _db;

  Future<Database> get database async {
    if (_db != null) return _db!;
    final dbPath = await getDatabasesPath();
    final fullPath = p.join(dbPath, dbName);
    _db = await openDatabase(
      fullPath,
      version: dbVersion,
      onCreate: (db, version) async {
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
      },
    );
    return _db!;
  }

  Future<bool> hasSeededData() async {
    final db = await database;
    final res = await db.rawQuery('SELECT COUNT(*) AS cnt FROM accounts');
    final count = Sqflite.firstIntValue(res) ?? 0;
    return count > 0;
  }

  Future<LocalDbSnapshot> loadSnapshot() async {
    final db = await database;
    return db.transaction((txn) async {
    final accRows = await txn.query('accounts', orderBy: 'codeNumber ASC');
    final ledRows = await txn.query('ledger_entries', orderBy: 'entryNumber DESC');
    final whRows = await txn.query('warehouses');
    final invRows = await txn.query('inventory_items');
    final metaRows = await txn.query('erp_state', where: 'stateKey = ?', whereArgs: ['settings']);
    final prefsRows = await txn.query('erp_state',
        where: 'stateKey = ?', whereArgs: ['hybridUiPreferences']);

    final preferences = <String, dynamic>{};
    if (prefsRows.isNotEmpty) {
      try {
        final decoded = jsonDecode(prefsRows.first['payloadJson'] as String);
        if (decoded is Map<String, dynamic>) preferences.addAll(decoded);
      } on FormatException {
        // A malformed appearance row must not hide or erase financial data.
      }
    }

    String? companyName;
    bool? isDarkMode;
    int? nextEntryNumber;
    if (metaRows.isNotEmpty) {
      final decoded = jsonDecode(metaRows.first['payloadJson'] as String) as Map<String, dynamic>;
      companyName = decoded['companyName'] as String?;
      isDarkMode = decoded['isDarkMode'] as bool?;
      nextEntryNumber = decoded['nextEntryNumber'] as int?;
    }

    return LocalDbSnapshot(
      accounts: accRows.map(_accountFromMap).toList(),
      ledger: ledRows.map(_ledgerFromMap).toList(),
      warehouses: whRows.map(_warehouseFromMap).toList(),
      inventory: invRows.map(_inventoryFromMap).toList(),
      companyName: companyName,
      isDarkMode: isDarkMode,
      nextEntryNumber: nextEntryNumber,
      uiPreferences: preferences,
    );
    });
  }

  /// Non-financial UI preferences are stored independently of the accounting
  /// snapshot, so saving a theme cannot replace any invoice, stock or ledger.
  Future<void> saveUiPreferences(Map<String, dynamic> updates) async {
    final db = await database;
    await db.transaction((txn) async {
      final rows = await txn.query('erp_state',
          where: 'stateKey = ?', whereArgs: ['hybridUiPreferences']);
      final previous = <String, dynamic>{};
      if (rows.isNotEmpty) {
        try {
          final decoded = jsonDecode(rows.first['payloadJson'] as String);
          if (decoded is Map<String, dynamic>) previous.addAll(decoded);
        } on FormatException {
          // Recover only the independent UI row; financial data is untouched.
        }
      }
      final next = <String, dynamic>{...previous, ...updates};
      await txn.insert('erp_state', {
        'stateKey': 'hybridUiPreferences',
        'payloadJson': jsonEncode(next),
        'updatedAt': DateTime.now().toIso8601String(),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    });
  }

  Future<void> saveSnapshot({
    required List<AccountRecord> accounts,
    required List<LedgerEntryRecord> ledger,
    required List<WarehouseRecord> warehouses,
    required List<InventoryItemRecord> inventory,
    required String companyName,
    required bool isDarkMode,
    required int nextEntryNumber,
  }) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('accounts');
      for (final a in accounts) {
        await txn.insert('accounts', _accountToMap(a), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      await txn.delete('ledger_entries');
      for (final l in ledger) {
        await txn.insert('ledger_entries', _ledgerToMap(l), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      await txn.delete('warehouses');
      for (final w in warehouses) {
        await txn.insert('warehouses', _warehouseToMap(w), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      await txn.delete('inventory_items');
      for (final i in inventory) {
        await txn.insert('inventory_items', _inventoryToMap(i), conflictAlgorithm: ConflictAlgorithm.replace);
      }

      await txn.insert(
        'erp_state',
        {
          'stateKey': 'settings',
          'payloadJson': jsonEncode({
            'companyName': companyName,
            'isDarkMode': isDarkMode,
            'nextEntryNumber': nextEntryNumber,
          }),
          'updatedAt': DateTime.now().toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    });
  }

  Future<Map<String, int>> getTableCounts() async {
    final db = await database;
    final acc = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM accounts')) ?? 0;
    final led = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM ledger_entries')) ?? 0;
    final wh = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM warehouses')) ?? 0;
    final inv = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM inventory_items')) ?? 0;
    return {
      'accounts': acc,
      'ledger': led,
      'warehouses': wh,
      'inventory': inv,
    };
  }

  Future<void> clearAll() async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('accounts');
      await txn.delete('ledger_entries');
      await txn.delete('warehouses');
      await txn.delete('inventory_items');
      await txn.delete('erp_state');
    });
  }

  Map<String, Object?> _accountToMap(AccountRecord a) => {
        'id': a.id,
        'name': a.name,
        'category': a.category.name,
        'phone': a.phone,
        'creditLimit': a.creditLimit,
        'currency': a.currency.name,
        'isCashAccount': a.isCashAccount ? 1 : 0,
        'note': a.note,
        'openingBalance': a.openingBalance,
        'openingDirection': a.openingDirection.name,
        'codeNumber': a.codeNumber,
      };

  AccountRecord _accountFromMap(Map<String, Object?> m) => AccountRecord(
        id: m['id'] as String,
        name: m['name'] as String,
        category: AccountCategory.values.firstWhere(
          (e) => e.name == m['category'],
          orElse: () => AccountCategory.clients,
        ),
        phone: (m['phone'] as String?) ?? '',
        creditLimit: (m['creditLimit'] as num?)?.toDouble() ?? 50000,
        currency: CurrencyCode.values.firstWhere(
          (e) => e.name == m['currency'],
          orElse: () => CurrencyCode.sar,
        ),
        isCashAccount: (m['isCashAccount'] as int? ?? 0) == 1,
        note: (m['note'] as String?) ?? '',
        openingBalance: (m['openingBalance'] as num?)?.toDouble() ?? 0,
        openingDirection: EntryDirection.values.firstWhere(
          (e) => e.name == m['openingDirection'],
          orElse: () => EntryDirection.credit,
        ),
        codeNumber: (m['codeNumber'] as int?) ?? 1,
      );

  Map<String, Object?> _ledgerToMap(LedgerEntryRecord l) => {
        'id': l.id,
        'accountId': l.accountId,
        'accountName': l.accountName,
        'kind': l.kind.name,
        'typeLabel': l.typeLabel,
        'payment': l.payment.name,
        'direction': l.direction.name,
        'amount': l.amount,
        'currency': l.currency.name,
        'exchangeRate': l.exchangeRate,
        'details': l.details,
        'documentNumber': l.documentNumber,
        'warehouseId': l.warehouseId,
        'warehouseName': l.warehouseName,
        'expenseCategory': l.expenseCategory,
        'entryNumber': l.entryNumber,
        'deleted': l.deleted ? 1 : 0,
        'entryDate': l.entryDate,
      };

  LedgerEntryRecord _ledgerFromMap(Map<String, Object?> m) => LedgerEntryRecord(
        id: m['id'] as String,
        accountId: m['accountId'] as String,
        accountName: m['accountName'] as String,
        kind: LedgerKind.values.firstWhere(
          (e) => e.name == m['kind'],
          orElse: () => LedgerKind.invoice,
        ),
        typeLabel: m['typeLabel'] as String,
        payment: PaymentMethod.values.firstWhere(
          (e) => e.name == m['payment'],
          orElse: () => PaymentMethod.cash,
        ),
        direction: EntryDirection.values.firstWhere(
          (e) => e.name == m['direction'],
          orElse: () => EntryDirection.debit,
        ),
        amount: (m['amount'] as num).toDouble(),
        currency: CurrencyCode.values.firstWhere(
          (e) => e.name == m['currency'],
          orElse: () => CurrencyCode.sar,
        ),
        exchangeRate: (m['exchangeRate'] as num?)?.toDouble() ?? 1.0,
        details: (m['details'] as String?) ?? '',
        documentNumber: (m['documentNumber'] as String?) ?? '',
        warehouseId: (m['warehouseId'] as String?) ?? 'wh_1',
        warehouseName: (m['warehouseName'] as String?) ?? 'المخزن الرئيسي',
        expenseCategory: (m['expenseCategory'] as String?) ?? '',
        entryNumber: (m['entryNumber'] as int?) ?? 1,
        deleted: (m['deleted'] as int? ?? 0) == 1,
        entryDate: (m['entryDate'] as String?) ?? '',
      );

  Map<String, Object?> _warehouseToMap(WarehouseRecord w) => {
        'id': w.id,
        'name': w.name,
        'details': w.details,
        'isDefault': w.isDefault ? 1 : 0,
      };

  WarehouseRecord _warehouseFromMap(Map<String, Object?> m) => WarehouseRecord(
        id: m['id'] as String,
        name: m['name'] as String,
        details: (m['details'] as String?) ?? '',
        isDefault: (m['isDefault'] as int? ?? 0) == 1,
      );

  Map<String, Object?> _inventoryToMap(InventoryItemRecord i) => {
        'id': i.id,
        'name': i.name,
        'unit': i.unit,
        'quantity': i.quantity,
        'avgCost': i.avgCost,
        'warehouseId': i.warehouseId,
        'minThreshold': i.minThreshold,
        'sku': i.sku,
      };

  InventoryItemRecord _inventoryFromMap(Map<String, Object?> m) => InventoryItemRecord(
        id: m['id'] as String,
        name: m['name'] as String,
        unit: m['unit'] as String,
        quantity: (m['quantity'] as num).toDouble(),
        avgCost: (m['avgCost'] as num).toDouble(),
        warehouseId: (m['warehouseId'] as String?) ?? 'wh_1',
        minThreshold: (m['minThreshold'] as num?)?.toDouble() ?? 25,
        sku: (m['sku'] as String?) ?? '',
      );
}
