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
  static const int dbVersion = 10;

  Database? _db;

  Future<Database> get database async {
    if (_db != null) return _db!;
    final dbPath = await getDatabasesPath();
    final fullPath = p.join(dbPath, dbName);
    _db = await openDatabase(
      fullPath,
      version: dbVersion,
      onConfigure: (db) async {
        await db.execute('PRAGMA foreign_keys = ON');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) await createSyncSchema(db);
        if (oldVersion < 3) await createAccountingSchema(db);
        if (oldVersion < 4) await createDocumentSchema(db);
        if (oldVersion < 5) await createStockPostingSchema(db);
        if (oldVersion < 6) await createStockUnitsAndReturnsSchema(db);
        if (oldVersion < 7) await createBackupReviewSchema(db);
        if (oldVersion < 8) await createLegacyOperationalSchema(db);
        if (oldVersion < 9) await createLegacyStockOpeningSchema(db);
        if (oldVersion < 10) await migrateFractionalStockSchema(db);
      },
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
        await createSyncSchema(db);
        await createAccountingSchema(db);
        await createDocumentSchema(db);
        await createStockPostingSchema(db);
        await createStockUnitsAndReturnsSchema(db);
        await createBackupReviewSchema(db);
        await createLegacyOperationalSchema(db);
        await createLegacyStockOpeningSchema(db);
      },
    );
    return _db!;
  }

  // Additive migration: existing business rows are never rewritten.
  static Future<void> createSyncSchema(DatabaseExecutor db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS sync_outbox (
        operation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged_at TEXT,
        server_revision TEXT
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS sync_outbox_pending ON sync_outbox(workspace_id, acknowledged_at, created_at)');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS bridge_idempotency_keys (
        workspace_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, operation_id)
      )
    ''');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS sync_state (
        workspace_id TEXT PRIMARY KEY,
        pull_cursor TEXT,
        last_success_at TEXT
      )
    ''');
  }

  static Future<void> createAccountingSchema(DatabaseExecutor db) async {
    await db.execute('CREATE TABLE IF NOT EXISTS journal_entries (id TEXT PRIMARY KEY, currency TEXT NOT NULL, created_at TEXT NOT NULL)');
    await db.execute('CREATE TABLE IF NOT EXISTS journal_lines (id TEXT PRIMARY KEY, journal_id TEXT NOT NULL REFERENCES journal_entries(id), account_id TEXT NOT NULL REFERENCES accounts(id), debit_minor INTEGER NOT NULL CHECK(debit_minor >= 0), credit_minor INTEGER NOT NULL CHECK(credit_minor >= 0), CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)))');
    await db.execute('CREATE TABLE IF NOT EXISTS invoice_lines (id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledger_entries(id), item_id TEXT, quantity REAL NOT NULL CHECK(quantity > 0), unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0))');
    await db.execute('CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory_items(id), quantity_delta REAL NOT NULL, operation_id TEXT NOT NULL)');
    await db.execute('CREATE TABLE IF NOT EXISTS sync_inbox (workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, PRIMARY KEY(workspace_id, operation_id))');
    await db.execute('CREATE TABLE IF NOT EXISTS sync_conflicts (workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(workspace_id, operation_id))');
  }

  static Future<void> createDocumentSchema(DatabaseExecutor db) async {
    await db.execute("ALTER TABLE ledger_entries ADD COLUMN counterpartAccountId TEXT NOT NULL DEFAULT ''");
    await db.execute("ALTER TABLE ledger_entries ADD COLUMN counterpartAccountName TEXT NOT NULL DEFAULT ''");
    await db.execute("ALTER TABLE ledger_entries ADD COLUMN invoiceContent TEXT NOT NULL DEFAULT 'none'");
    await db.execute("ALTER TABLE ledger_entries ADD COLUMN postingStatus TEXT");
  }

  static Future<void> createStockPostingSchema(DatabaseExecutor db) async {
    await db.execute('CREATE TABLE stock_posting_documents (id TEXT PRIMARY KEY REFERENCES ledger_entries(id), original_id TEXT UNIQUE REFERENCES stock_posting_documents(id), document_json TEXT NOT NULL)');
    await createStockPostingLinesSchema(db);
  }

  static Future<void> createStockPostingLinesSchema(DatabaseExecutor db) async {
    await db.execute('CREATE TABLE stock_posting_lines (id TEXT PRIMARY KEY REFERENCES invoice_lines(id), document_id TEXT NOT NULL REFERENCES stock_posting_documents(id), item_id TEXT NOT NULL REFERENCES inventory_items(id), quantity REAL NOT NULL CHECK(quantity > 0), before_quantity REAL NOT NULL, after_quantity REAL NOT NULL, before_value INTEGER NOT NULL, after_value INTEGER NOT NULL, line_json TEXT NOT NULL)');
    await db.execute('CREATE INDEX stock_posting_item ON stock_posting_lines(item_id)');
  }

  static Future<void> createStockUnitsAndReturnsSchema(DatabaseExecutor db) async {
    await db.execute('ALTER TABLE stock_posting_documents ADD COLUMN return_original_id TEXT REFERENCES stock_posting_documents(id)');
    await db.execute('CREATE INDEX stock_return_original ON stock_posting_documents(return_original_id)');
    await db.execute('CREATE TABLE inventory_unit_settings (item_id TEXT PRIMARY KEY REFERENCES inventory_items(id), settings_json TEXT NOT NULL)');
  }

  static Future<void> createBackupReviewSchema(DatabaseExecutor db) async {
    await db.execute('CREATE TABLE backup_review_sources (sha TEXT PRIMARY KEY, file_name TEXT NOT NULL, source_format TEXT NOT NULL, meta_json TEXT NOT NULL)');
    await db.execute('CREATE TABLE backup_review_rows (sha TEXT NOT NULL REFERENCES backup_review_sources(sha), collection TEXT NOT NULL, ordinal INTEGER NOT NULL, row_json TEXT NOT NULL, PRIMARY KEY(sha,collection,ordinal))');
    await db.execute('CREATE TABLE backup_review_chunks (sha TEXT NOT NULL REFERENCES backup_review_sources(sha), ordinal INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(sha,ordinal))');
    await db.execute('CREATE TABLE backup_review_active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), sha TEXT NOT NULL REFERENCES backup_review_sources(sha))');
  }

  static Future<void> createLegacyOperationalSchema(DatabaseExecutor db) async {
    await db.execute('CREATE TABLE legacy_operational_source (singleton INTEGER PRIMARY KEY CHECK(singleton=1), sha TEXT NOT NULL, file_name TEXT NOT NULL, meta_json TEXT NOT NULL)');
    await db.execute('CREATE TABLE legacy_operational_chunks (ordinal INTEGER PRIMARY KEY, data_base64 TEXT NOT NULL)');
    await db.execute('CREATE TABLE legacy_operational_rows (collection TEXT NOT NULL, record_id TEXT NOT NULL, row_json TEXT NOT NULL, PRIMARY KEY(collection,record_id))');
    await db.execute('CREATE TABLE legacy_unverified_stock (item_id TEXT PRIMARY KEY REFERENCES inventory_items(id))');
  }

  static Future<void> createLegacyStockOpeningSchema(DatabaseExecutor db) async {
    await db.execute('''CREATE TABLE legacy_stock_openings (
      source_item_id TEXT NOT NULL REFERENCES inventory_items(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      item_id TEXT NOT NULL UNIQUE REFERENCES inventory_items(id),
      quantity REAL NOT NULL CHECK(quantity>=0),
      value_minor INTEGER NOT NULL CHECK(value_minor>=0),
      inventory_account_id TEXT NOT NULL REFERENCES accounts(id),
      offset_account_id TEXT NOT NULL REFERENCES accounts(id),
      ledger_id TEXT UNIQUE REFERENCES ledger_entries(id),
      operation_id TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL,
      evidence TEXT NOT NULL,
      CHECK(inventory_account_id<>offset_account_id),
      CHECK((quantity=0 AND value_minor=0 AND ledger_id IS NULL) OR (quantity>0 AND value_minor>0 AND ledger_id IS NOT NULL)),
      PRIMARY KEY(source_item_id,warehouse_id)
    )''');
  }

  // Neither detail table has incoming foreign keys. Rebuild only the old
  // INTEGER-affinity layout; keep every stored value and constraint.
  static Future<void> migrateFractionalStockSchema(DatabaseExecutor db) async {
    for(final name in ['stock_posting_lines','legacy_stock_openings']){
      final columns=await db.rawQuery('PRAGMA table_info("$name")');
      if(columns.firstWhere((c)=>c['name']=='quantity')['type']=='REAL')continue;
      await db.execute('ALTER TABLE "$name" RENAME TO "${name}_v9"');
      if(name=='stock_posting_lines'){
        await db.execute('DROP INDEX stock_posting_item');
        await createStockPostingLinesSchema(db);
      }else{await createLegacyStockOpeningSchema(db);}
      final keys=columns.map((c)=>'"'+(c['name'] as String)+'"').join(',');
      await db.execute('INSERT INTO "$name" ($keys) SELECT $keys FROM "${name}_v9"');
      await db.execute('DROP TABLE "${name}_v9"');
    }
    if((await db.rawQuery('PRAGMA foreign_key_check')).isNotEmpty)throw StateError('Fractional stock migration relation check failed');
  }

  static Future<void> requireOpeningStockAccount(DatabaseExecutor db,String id,String accountId,String entryDate) async {
    final rows=await db.query('legacy_stock_openings',where:'item_id = ?',whereArgs:[id]);
    if(rows.isEmpty)return;
    final row=rows.single;
    if(row['inventory_account_id']!=accountId)throw StateError('Select the inventory account used at stock opening');
    if(entryDate.compareTo(row['entry_date'] as String)<0)throw StateError('Stock posting predates the approved opening count');
  }

  static Future<bool> hasLegacyOperational(DatabaseExecutor db) async =>
    (await db.query('legacy_operational_source',limit:1)).isNotEmpty;

  static Future<void> requireVerifiedStock(DatabaseExecutor db,String id) async {
    if ((await db.query('legacy_unverified_stock',where:'item_id = ?',whereArgs:[id],limit:1)).isNotEmpty) {
      throw StateError('Imported stock requires physical quantity and cost reconciliation');
    }
  }

  static Future<void> requireLiveWorkspace(DatabaseExecutor db) async {
    if ((await db.query('backup_review_active',limit:1)).isNotEmpty) {
      throw StateError('Historical backup review is read only');
    }
  }

  Future<Map<String, dynamic>> createAccountAtomic(
      String workspaceId, String operationId, AccountRecord account) {
    if (account.name.trim().isEmpty || account.id.isEmpty ||
        account.openingBalance != 0) {
      throw ArgumentError('New account requires a name, ID and zero opening balance');
    }
    final row = _accountToMap(account);
    return commitOperation(workspaceId: workspaceId, operationId: operationId,
        operationType: 'account.create', payload: Map<String, dynamic>.from(row), apply: (txn) async {
      await txn.insert('accounts', row);
      return {'id': account.id};
    });
  }

  /// Sale repository foundation; callers must supply a stable operation ID.
  /// This is not a general ledger posting engine and is not enabled in the UI.
  Future<Map<String, dynamic>> createSaleAtomic({
    required String workspaceId,
    required String operationId,
    required LedgerEntryRecord entry,
    required List<Map<String, dynamic>> lines,
  }) {
    if (entry.kind != LedgerKind.invoice || entry.direction != EntryDirection.debit ||
        entry.deleted || !entry.amount.isFinite || entry.amount <= 0 ||
        lines.isEmpty || entry.id.isEmpty) {
      throw ArgumentError('Invalid sales invoice');
    }
    final row = _ledgerToMap(entry);
    final normalized = lines.map((line) {
      final itemId = line['item_id'];
      final quantity = line['quantity'];
      final price = line['unit_price_minor'];
      if (itemId is! String || itemId.isEmpty || quantity is! num ||
          !quantity.isFinite || quantity <= 0 || price is! int || price < 0) {
        throw ArgumentError('Invalid invoice line');
      }
      return <String, dynamic>{'item_id': itemId, 'quantity': quantity,
        'unit_price_minor': price};
    }).toList();
    return commitOperation(workspaceId: workspaceId, operationId: operationId,
        operationType: 'sale.create', payload: {'entry': row, 'lines': normalized},
        apply: (txn) async {
      final accounts = await txn.query('accounts', where: 'id = ?',
          whereArgs: [entry.accountId], limit: 1);
      if (accounts.isEmpty) throw StateError('Account does not exist');
      await txn.insert('ledger_entries', row);
      for (var i = 0; i < normalized.length; i++) {
        final line = normalized[i];
        final itemId = line['item_id'] as String;
        await requireVerifiedStock(txn,itemId);
        if((await txn.query('legacy_stock_openings',where:'item_id = ?',whereArgs:[itemId],limit:1)).isNotEmpty)throw StateError('Use balanced stock posting for migrated stock');
        final quantity = line['quantity'] as num;
        final changed = await txn.rawUpdate(
            'UPDATE inventory_items SET quantity = quantity - ? WHERE id = ? AND warehouseId = ? AND quantity >= ?',
            [quantity, itemId, entry.warehouseId, quantity]);
        if (changed != 1) throw StateError('Insufficient stock or invalid warehouse');
        final lineId = '${entry.id}:$i';
        await txn.insert('invoice_lines', {'id': lineId, 'ledger_id': entry.id,
          'item_id': itemId, 'quantity': quantity,
          'unit_price_minor': line['unit_price_minor']});
        await txn.insert('stock_movements', {'id': lineId, 'item_id': itemId,
          'quantity_delta': -quantity, 'operation_id': operationId});
      }
      return {'id': entry.id};
    });
  }

  /// Foundation for future domain commands. The callback must use only txn.
  /// No network calls or external side effects inside the transaction.
  Future<Map<String, dynamic>> commitOperation({
    required String workspaceId,
    required String operationId,
    required String operationType,
    required Map<String, dynamic> payload,
    required Future<Map<String, dynamic>> Function(Transaction txn) apply,
    Map<String, dynamic> Function(Map<String, dynamic>)? syncPayload,
  }) async {
    final db = await database;
    return db.transaction((txn) => commitOperationInTransaction(txn,
      workspaceId:workspaceId,operationId:operationId,operationType:operationType,
      payload:payload,apply:apply,syncPayload:syncPayload));
  }

  /// Reuse the exact operation identity and outbox semantics for an atomic
  /// multi-operation batch. The caller owns the outer SQLite transaction.
  Future<Map<String,dynamic>> commitOperationInTransaction(Transaction txn,{
    required String workspaceId,
    required String operationId,
    required String operationType,
    required Map<String,dynamic> payload,
    required Future<Map<String,dynamic>> Function(Transaction txn) apply,
    Map<String,dynamic> Function(Map<String,dynamic>)? syncPayload,
  }) async {
    if(workspaceId.isEmpty||operationId.isEmpty||operationType.isEmpty)
      throw ArgumentError('Missing operation identity');
    final encoded=jsonEncode(payload);
    await requireLiveWorkspace(txn);
      final prior = await txn.query('bridge_idempotency_keys',
          where: 'workspace_id = ? AND operation_id = ?',
          whereArgs: [workspaceId, operationId]);
      if (prior.isNotEmpty) {
        if (prior.first['operation_type'] != operationType ||
            prior.first['payload_json'] != encoded) {
          throw StateError('Operation identity reused with different content');
        }
        return jsonDecode(prior.first['result_json'] as String)
            as Map<String, dynamic>;
      }
      final result = await apply(txn);
      await txn.insert('sync_outbox', {
        'operation_id': operationId,
        'workspace_id': workspaceId,
        'operation_type': operationType,
        'payload_json': syncPayload == null ? encoded : jsonEncode(syncPayload(result)),
        'created_at': DateTime.now().toUtc().toIso8601String(),
      });
      await txn.insert('bridge_idempotency_keys', {
        'workspace_id': workspaceId,
        'operation_id': operationId,
        'operation_type': operationType,
        'payload_json': encoded,
        'result_json': jsonEncode(result),
      });
      return result;
  }

  Future<List<Map<String, Object?>>> pendingOperations(String workspaceId,
      {int limit = 100, Set<String>? operationTypes}) async {
    if (limit < 1 || limit > 500) throw ArgumentError('Invalid batch size');
    final db = await database;
    if (operationTypes != null && operationTypes.isEmpty) return [];
    final types = operationTypes?.toList() ?? <String>[];
    final filter = types.isEmpty ? '' : ' AND operation_type IN (${types.map((_) => '?').join(',')})';
    return db.query('sync_outbox',
        where: 'workspace_id = ? AND acknowledged_at IS NULL$filter',
        whereArgs: [workspaceId,...types], orderBy: 'rowid ASC',
        limit: limit);
  }

  /// Call only after validating an authenticated server acknowledgement.
  Future<void> acknowledgeOperation(String workspaceId, String operationId,
      String serverRevision) async {
    if (serverRevision.isEmpty) throw ArgumentError('Missing server revision');
    final db = await database;
    await db.transaction((txn) async {
      final rows = await txn.query('sync_outbox',
          where: 'workspace_id = ? AND operation_id = ?',
          whereArgs: [workspaceId, operationId]);
      if (rows.length != 1) throw StateError('Unknown operation');
      final previous = rows.single['server_revision'];
      if (previous != null && previous != serverRevision) {
        throw StateError('Conflicting acknowledgement');
      }
      if (previous == null) {
        await txn.update('sync_outbox', {
          'acknowledged_at': DateTime.now().toUtc().toIso8601String(),
          'server_revision': serverRevision,
        }, where: 'workspace_id = ? AND operation_id = ?',
            whereArgs: [workspaceId, operationId]);
      }
    });
  }

  Future<bool> hasSeededData() async {
    final db = await database;
    final res = await db.rawQuery('SELECT COUNT(*) AS cnt FROM accounts');
    final count = Sqflite.firstIntValue(res) ?? 0;
    return count > 0;
  }

  Future<LocalDbSnapshot> loadSnapshot({DatabaseExecutor? executor}) async {
    final db = executor ?? await database;
    final accRows = await db.query('accounts', orderBy: 'codeNumber ASC');
    final ledRows = await db.query('ledger_entries', orderBy: 'entryNumber DESC');
    final whRows = await db.query('warehouses');
    final invRows = await db.query('inventory_items');
    final metaRows = await db.query('erp_state', where: 'stateKey = ?', whereArgs: ['settings']);
    final prefsRows = await db.query('erp_state',
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
      await requireLiveWorkspace(txn);
      if(await hasLegacyOperational(txn))throw StateError('Imported workspace cannot be replaced by snapshot');
      final history = await txn.query('bridge_idempotency_keys', limit: 1);
      if (history.isNotEmpty) {
        throw StateError('Legacy snapshot writes disabled after transactional operations');
      }
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

      await txn.delete('inventory_unit_settings');
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
      await requireLiveWorkspace(txn);
      if(await hasLegacyOperational(txn))throw StateError('Imported workspace cannot be cleared through legacy reset');
      final pending = await txn.query('sync_outbox',
          where: 'acknowledged_at IS NULL', limit: 1);
      if (pending.isNotEmpty) throw StateError('Unsynced operations exist');
      // Do not erase synchronized financial history through the legacy reset.
      final history = await txn.query('bridge_idempotency_keys', limit: 1);
      if (history.isNotEmpty) throw StateError('Transactional history exists');
      await txn.delete('journal_lines');
      await txn.delete('journal_entries');
      await txn.delete('stock_posting_lines');
      await txn.delete('stock_posting_documents');
      await txn.delete('invoice_lines');
      await txn.delete('stock_movements');
      await txn.delete('ledger_entries');
      await txn.delete('accounts');
      await txn.delete('warehouses');
      await txn.delete('inventory_unit_settings');
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
        'counterpartAccountId': l.counterpartAccountId,
        'counterpartAccountName': l.counterpartAccountName,
        'invoiceContent': l.invoiceContent,
        'postingStatus': l.postingStatus,
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
        counterpartAccountId: (m['counterpartAccountId'] as String?) ?? '',
        counterpartAccountName: (m['counterpartAccountName'] as String?) ?? '',
        invoiceContent: (m['invoiceContent'] as String?) ?? 'none',
        postingStatus: m['postingStatus'] as String?,
        kind: LedgerKind.values.firstWhere(
          (e) => e.name == (m['kind']=='return'?'returnEntry':m['kind']=='simple-entry'?'simpleEntry':m['kind']),
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
