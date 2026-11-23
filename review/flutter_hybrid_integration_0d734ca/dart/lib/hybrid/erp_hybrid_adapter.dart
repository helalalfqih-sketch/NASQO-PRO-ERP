import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import '../models/erp_models.dart';
import '../services/accounting_engine.dart';
import '../services/local_database.dart';
import '../state/erp_controller.dart';
import 'hybrid_protocol.dart';
import 'posting_receipt_guard.dart';

/// Compatibility adapter bridging NASQO React Hybrid v1.0.0 commands directly
/// onto the EXISTING Flutter `ErpController`, `LocalDatabase`, `AccountingEngine`,
/// and `PostingReceiptGuard`.
///
/// Architectural guarantees:
/// - ZERO parallel SQLite database (uses the existing `LocalDatabase` connection).
/// - ZERO parallel accounting ledger (reads & writes `ErpController.accounts`,
///   `ErpController.ledger`, `ErpController.warehouses`, `ErpController.inventory`
///   and persists into the existing `accounts`, `ledger_entries`, `warehouses`,
///   `inventory_items`, and `erp_state` tables).
/// - Every financial mutation is guarded atomically by `PostingReceiptGuard`.
class ErpHybridAdapter {
  ErpHybridAdapter({
    required this.controller,
    required this.receiptGuard,
    Future<Database> Function()? databaseProvider,
    this.workspaceId = 'local-erp-workspace',
  }) : _databaseProvider =
            databaseProvider ?? (() => LocalDatabase.instance.database);

  final ErpController controller;
  final PostingReceiptGuard receiptGuard;
  final Future<Database> Function() _databaseProvider;
  final String workspaceId;

  int _snapshotVersion = 1;
  String _activeCurrency = 'ريال';

  static const String _uiPrefsStateKey = 'hybrid_ui_preferences';
  static const String _extraMetaStateKey = 'hybrid_extra_meta';
  static const String _initializedStateKey = 'hybrid_workspace_initialized';

  /// Upgrade-safe startup loader for the existing `LocalDatabase`:
  ///
  /// - **APK Upgrade (existing tables contain rows or prior state)**:
  ///   loads 100% of existing `accounts`, `ledger_entries`, `warehouses`,
  ///   `inventory_items`, and `erp_state` rows into [controller] WITHOUT
  ///   wiping or overwriting user data.
  /// - **Clean Fresh Install (brand-new empty SQLite database)**:
  ///   when [allowEmptyFreshStart] is `true`, starts with an empty clean
  ///   workspace (0 starter accounts, 0 invoices, 0 balances) and ensures a
  ///   single default warehouse exists.
  Future<Map<String, Object?>> loadOrInitializeUpgradeSafe({
    bool allowEmptyFreshStart = true,
  }) async {
    final db = await _databaseProvider();
    await receiptGuard.ensureTable(db);

    final accountRows = await db.query('accounts');
    final ledgerRows = await db.query('ledger_entries');
    final warehouseRows = await db.query('warehouses');
    final inventoryRows = await db.query('inventory_items');
    final settingsState = await _readStateMap(db, 'settings');
    final initState = await _readStateMap(db, _initializedStateKey);

    final hasExistingData = accountRows.isNotEmpty ||
        ledgerRows.isNotEmpty ||
        warehouseRows.isNotEmpty ||
        inventoryRows.isNotEmpty ||
        settingsState.isNotEmpty ||
        initState['initialized'] == true;

    if (hasExistingData) {
      controller.accounts
        ..clear()
        ..addAll(accountRows.map(_accountFromDbRow));
      controller.ledger
        ..clear()
        ..addAll(ledgerRows.map(_ledgerFromDbRow));
      controller.warehouses
        ..clear()
        ..addAll(warehouseRows.map(_warehouseFromDbRow));
      controller.inventory
        ..clear()
        ..addAll(inventoryRows.map(_inventoryFromDbRow));

      if (settingsState['companyName'] is String &&
          (settingsState['companyName'] as String).trim().isNotEmpty) {
        controller.companyName = (settingsState['companyName'] as String).trim();
      }
      if (settingsState['isDarkMode'] is bool &&
          settingsState['isDarkMode'] != controller.isDarkMode) {
        controller.toggleTheme();
      }
      if (initState['initialized'] != true) {
        await _writeStateMap(db, _initializedStateKey, <String, Object?>{
          'initialized': true,
          'upgradedFromExistingDb': true,
          'updatedAt': DateTime.now().toIso8601String(),
        });
      }
      controller.notifyListeners();
      return <String, Object?>{
        'mode': 'upgraded_preserved',
        'accounts': controller.accounts.length,
        'ledger': controller.ledger.length,
        'warehouses': controller.warehouses.length,
        'inventory': controller.inventory.length,
      };
    }

    if (allowEmptyFreshStart) {
      controller.accounts.clear();
      controller.ledger.clear();
      controller.inventory.clear();
      controller.warehouses
        ..clear()
        ..add(
          const WarehouseRecord(
            id: 'wh_main',
            name: 'المخزن الرئيسي',
            details: '',
            isDefault: true,
          ),
        );
      await db.transaction((txn) async {
        await _persistControllerTablesInTxn(txn);
        await _writeStateMap(txn, _initializedStateKey, <String, Object?>{
          'initialized': true,
          'upgradedFromExistingDb': false,
          'cleanEmptyStart': true,
          'createdAt': DateTime.now().toIso8601String(),
        });
      });
      controller.notifyListeners();
      return <String, Object?>{
        'mode': 'fresh_clean_empty',
        'accounts': 0,
        'ledger': 0,
        'warehouses': 1,
        'inventory': 0,
      };
    }

    return <String, Object?>{
      'mode': 'controller_in_memory',
      'accounts': controller.accounts.length,
      'ledger': controller.ledger.length,
      'warehouses': controller.warehouses.length,
      'inventory': controller.inventory.length,
    };
  }

  Future<Map<String, Object?>> getSnapshot({
    required bool allowFinancialWrites,
    DatabaseExecutor? executor,
  }) async {
    final db = executor ?? await _databaseProvider();
    final uiPrefs = await _readStateMap(db, _uiPrefsStateKey);
    final meta = await _readStateMap(db, _extraMetaStateKey);

    final activeCurr = (meta['activeCurrency'] as String?)?.trim();
    if (activeCurr != null && activeCurr.isNotEmpty) {
      _activeCurrency = activeCurr;
    } else {
      _activeCurrency = controller.defaultCurrency.label;
    }

    final currencies = _buildCurrencyList(meta);
    final accountGroups = _buildAccountGroups(meta);
    final cashboxes = _buildCashboxes();

    final groupIdByCategory = <String, int>{};
    for (final g in accountGroups) {
      final cat = (g['category'] as String?) ?? '';
      final gid = (g['id'] as num?)?.toInt();
      if (cat.isNotEmpty && gid != null && !groupIdByCategory.containsKey(cat)) {
        groupIdByCategory[cat] = gid;
      }
    }

    return <String, Object?>{
      'workspaceId': workspaceId,
      'userEmail': 'offline@nasqo.local',
      'workspace': <String, Object?>{
        'id': workspaceId,
        'ownerId': workspaceId,
        'companyName': controller.companyName,
        'defaultCurrency': controller.defaultCurrency.label,
        'whatsappProvider': (meta['whatsappProvider'] as String?) ?? 'nasqo',
        'whatsappInstantEnabled': meta['whatsappInstantEnabled'] == true,
        'whatsappPhone': (meta['whatsappPhone'] as String?) ?? '',
      },
      'currencies': currencies,
      'accountGroups': accountGroups,
      'accounts': controller.accounts
          .map(
            (a) => _accountToHybridJson(
              a,
              groupId: groupIdByCategory[a.category.name],
            ),
          )
          .toList(),
      'cashboxes': cashboxes,
      'ledger': controller.ledger.map(_ledgerToHybridJson).toList(),
      'warehouses': controller.warehouses
          .asMap()
          .entries
          .map((e) => _warehouseToHybridJson(e.value, e.key + 1))
          .toList(),
      'inventory': controller.inventory.map(_inventoryToHybridJson).toList(),
      'uiPreferences': uiPrefs,
      'capabilities': <String, Object?>{
        'offlineReady': true,
        'printingSupported': true,
        'pdfExportSupported': true,
        'filePickerSupported': true,
        'googleDriveConfigured': false,
        'whatsappShareSupported': false,
        'readOnlyFinancial': !allowFinancialWrites,
      },
      'activeCurrency': _activeCurrency,
      'snapshotVersion': _snapshotVersion,
    };
  }

  Future<Map<String, Object?>> saveUiPreferences(
    Map<String, Object?> preferences,
  ) async {
    final db = await _databaseProvider();
    final merged = await _readStateMap(db, _uiPrefsStateKey);
    merged.addAll(preferences);
    await _writeStateMap(db, _uiPrefsStateKey, merged);

    final themeMode = preferences['themeMode'];
    if (themeMode == 'dark' && !controller.isDarkMode) {
      controller.toggleTheme();
    } else if (themeMode == 'light' && controller.isDarkMode) {
      controller.toggleTheme();
    }

    return <String, Object?>{'saved': true, 'preferences': merged};
  }

  Future<Map<String, Object?>> changeCurrency(String currency) async {
    final clean = currency.trim();
    if (clean.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'اسم العملة مطلوب.');
    }
    final db = await _databaseProvider();
    final meta = await _readStateMap(db, _extraMetaStateKey);
    meta['activeCurrency'] = clean;
    await _writeStateMap(db, _extraMetaStateKey, meta);
    _activeCurrency = clean;
    return <String, Object?>{'activeCurrency': clean};
  }

  Future<Map<String, Object?>> saveWorkspaceSettings(
    Map<String, Object?> updates, {
    required bool allowFinancialWrites,
  }) async {
    final db = await _databaseProvider();
    final meta = await _readStateMap(db, _extraMetaStateKey);

    if (updates['companyName'] is String) {
      final nextName = (updates['companyName'] as String).trim();
      if (nextName.isNotEmpty) {
        controller.companyName = nextName;
      }
    }
    if (updates['defaultCurrency'] is String) {
      controller.defaultCurrency =
          _parseCurrencyCode(updates['defaultCurrency'] as String);
    }
    if (updates['whatsappProvider'] is String) {
      meta['whatsappProvider'] =
          updates['whatsappProvider'] == 'external' ? 'external' : 'nasqo';
    }
    if (updates['whatsappInstantEnabled'] is bool) {
      meta['whatsappInstantEnabled'] = updates['whatsappInstantEnabled'];
    }
    if (updates['whatsappPhone'] is String) {
      meta['whatsappPhone'] = (updates['whatsappPhone'] as String).trim();
    }

    await db.transaction((txn) async {
      await _writeStateMap(txn, _extraMetaStateKey, meta);
      await _persistControllerTablesInTxn(txn);
    });
    _snapshotVersion += 1;
    controller.notifyListeners();

    final snap = await getSnapshot(
      allowFinancialWrites: allowFinancialWrites,
      executor: db,
    );
    return <String, Object?>{
      'workspace': snap['workspace'],
      'snapshot': snap,
    };
  }

  Future<Map<String, Object?>> saveAccountGroup({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final name = (data['name'] as String? ?? '').trim();
    if (name.isEmpty) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'اسم مجموعة الحسابات مطلوب.',
      );
    }

    return receiptGuard.executeProtected(
      action: 'saveAccountGroup',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final meta = await _readStateMap(txn, _extraMetaStateKey);
        final groups = _buildAccountGroups(meta);
        final reqId = (data['id'] as num?)?.toInt();
        final nextId = reqId ??
            (groups.fold<int>(
                  0,
                  (maxId, g) => ((g['id'] as num?)?.toInt() ?? 0) > maxId
                      ? (g['id'] as num).toInt()
                      : maxId,
                ) +
                1);
        final saved = <String, Object?>{
          'id': nextId,
          'name': name,
          'category': (data['category'] as String?) ?? 'purchases',
          'currencyCode': (data['currencyCode'] as String?) ??
              controller.defaultCurrency.label,
          'hasBill': data['hasBill'] != false,
          'isEmployee': data['isEmployee'] == true,
          'sortOrder': (data['sortOrder'] as num?)?.toInt() ?? nextId,
        };
        final idx = groups.indexWhere((g) => g['id'] == nextId);
        if (idx >= 0) {
          groups[idx] = saved;
        } else {
          groups.add(saved);
        }
        meta['accountGroups'] = groups;
        await _writeStateMap(txn, _extraMetaStateKey, meta);
        _snapshotVersion += 1;
        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'group': saved, 'snapshot': snap};
      },
    );
  }

  Future<Map<String, Object?>> saveCurrency({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final name = (data['name'] as String? ?? '').trim();
    if (name.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'اسم العملة مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'saveCurrency',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final meta = await _readStateMap(txn, _extraMetaStateKey);
        final list = _buildCurrencyList(meta);
        final reqId = (data['id'] as num?)?.toInt();
        final nextId = reqId ?? (list.length + 1);
        final record = <String, Object?>{
          'id': nextId,
          'code': ((data['code'] as String?) ?? name).trim(),
          'name': name,
          'symbol': ((data['symbol'] as String?) ?? name).trim(),
          'ratePrimary': _toDouble(data['ratePrimary'], fallback: 1.0),
          'rateSecondary': _toDouble(data['rateSecondary'], fallback: 1.0),
          'nameSecondary': (data['nameSecondary'] as String? ?? '').trim(),
        };
        final idx = list.indexWhere((c) => c['id'] == nextId || c['name'] == name);
        if (idx >= 0) {
          list[idx] = record;
        } else {
          list.add(record);
        }
        meta['currencies'] = list;
        await _writeStateMap(txn, _extraMetaStateKey, meta);
        _snapshotVersion += 1;
        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'currencies': list, 'snapshot': snap};
      },
    );
  }

  Future<Map<String, Object?>> deleteCurrency({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final currencyId = (payload['currencyId'] as num?)?.toInt();
    if (currencyId == null || currencyId <= 0) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف العملة غير صالح.');
    }

    return receiptGuard.executeProtected(
      action: 'deleteCurrency',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final meta = await _readStateMap(txn, _extraMetaStateKey);
        final list = _buildCurrencyList(meta);
        if (list.length <= 1) {
          throw const HybridBridgeException(
            'VALIDATION_ERROR',
            'لا يمكن حذف آخر عملة في النظام.',
          );
        }
        list.removeWhere((c) => c['id'] == currencyId);
        meta['currencies'] = list;
        await _writeStateMap(txn, _extraMetaStateKey, meta);
        _snapshotVersion += 1;
        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'currencies': list, 'snapshot': snap};
      },
    );
  }

  Future<Map<String, Object?>> saveAccount({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final name = (data['name'] as String? ?? '').trim();
    if (name.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'اسم الحساب مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'saveAccount',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final existingId = (payload['accountId'] as String?)?.trim() ??
            (data['id'] as String?)?.trim();
        final id = (existingId != null && existingId.isNotEmpty)
            ? existingId
            : _genId('acc');

        final maxCode = controller.accounts.fold<int>(
          1000,
          (m, a) => a.codeNumber > m ? a.codeNumber : m,
        );
        final acc = AccountRecord(
          id: id,
          name: name,
          category: _parseCategory(data['category'] as String?),
          phone: (data['phone'] as String? ?? '').trim(),
          creditLimit: _toDouble(data['creditLimit'], fallback: 50000),
          currency: _parseCurrencyCode(data['currency'] as String?),
          isCashAccount: data['isCashAccount'] == true,
          note: (data['note'] as String? ?? '').trim(),
          openingBalance: _toDouble(data['openingBalance'], fallback: 0),
          openingDirection: data['openingDirection'] == 'debit'
              ? EntryDirection.debit
              : EntryDirection.credit,
          codeNumber: (data['codeNumber'] as num?)?.toInt() ?? (maxCode + 1),
        );

        final idx = controller.accounts.indexWhere((a) => a.id == id);
        if (idx >= 0) {
          controller.accounts[idx] = acc;
        } else {
          controller.accounts.insert(0, acc);
        }

        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'account': _accountToHybridJson(acc),
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> deleteAccount({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final accountId = (payload['accountId'] as String? ?? '').trim();
    if (accountId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف الحساب مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'deleteAccount',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final hasActiveEntries = controller.ledger
            .any((e) => !e.deleted && e.accountId == accountId);
        if (hasActiveEntries) {
          throw const HybridBridgeException(
            'VALIDATION_ERROR',
            'لا يمكن حذف حساب مرتبط بقيود مالية نشطة.',
          );
        }
        controller.accounts.removeWhere((a) => a.id == accountId);
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'ok': true, 'snapshot': snap};
      },
    );
  }

  /// Posts directly into the EXISTING `ErpController.ledger` and updates
  /// `ErpController.inventory` via `AccountingEngine.computeWeightedAverageCost`,
  /// persisted atomically in `LocalDatabase` alongside a `PostingReceipt`.
  Future<Map<String, Object?>> createLedgerEntry({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final accountId = (data['accountId'] as String? ?? '').trim();
    final accountName = (data['accountName'] as String? ?? '').trim();
    final amount = _toDouble(data['amount'], fallback: 0.0);

    if (accountId.isEmpty || accountName.isEmpty) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'يجب تحديد الحساب قبل ترحيل القيد.',
      );
    }
    if (amount < 0) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'المبلغ المالي لا يمكن أن يكون سالبًا.',
      );
    }

    return receiptGuard.executeProtected(
      action: 'createLedgerEntry',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final maxEntryNum = controller.ledger.fold<int>(
          1000,
          (m, e) => e.entryNumber > m ? e.entryNumber : m,
        );
        final entryNum =
            (data['entryNumber'] as num?)?.toInt() ?? (maxEntryNum + 1);
        final id = ((data['id'] as String?)?.trim().isNotEmpty ?? false)
            ? (data['id'] as String).trim()
            : _genId('led');

        final kind = _parseLedgerKind(data['kind'] as String?);
        final direction = data['direction'] == 'credit'
            ? EntryDirection.credit
            : EntryDirection.debit;
        final typeLabel = (data['typeLabel'] as String? ?? 'قيد مالي').trim();
        final whId = (data['warehouseId'] as String? ??
                (controller.warehouses.isNotEmpty
                    ? controller.warehouses.first.id
                    : 'wh_1'))
            .trim();
        final whName = (data['warehouseName'] as String? ??
                (controller.warehouses.isNotEmpty
                    ? controller.warehouses.first.name
                    : 'المخزن الرئيسي'))
            .trim();

        final rawLines = data['lines'];
        final lines = rawLines is List
            ? rawLines
                .whereType<Map>()
                .map((m) => m.map((k, v) => MapEntry(k.toString(), v)))
                .toList()
            : <Map<String, Object?>>[];

        final stockSign = _stockEffectSign(
          kind: kind,
          direction: direction,
          typeLabel: typeLabel,
        );
        if (stockSign != 0 && lines.isNotEmpty) {
          for (final line in lines) {
            final itemId = (line['inventoryItemId'] as String?)?.trim();
            final qty = _toDouble(line['quantity'], fallback: 0);
            final price = _toDouble(line['price'], fallback: 0);
            if (itemId == null || itemId.isEmpty || qty <= 0) continue;
            final invIdx =
                controller.inventory.indexWhere((i) => i.id == itemId);
            if (invIdx < 0) continue;
            final current = controller.inventory[invIdx];
            final nextQty = current.quantity + (stockSign * qty);
            final nextAvg = (stockSign > 0 && price > 0)
                ? AccountingEngine.computeWeightedAverageCost(
                    current.quantity,
                    current.avgCost,
                    qty,
                    price,
                  )
                : current.avgCost;
            controller.inventory[invIdx] = current.copyWith(
              quantity: nextQty,
              avgCost: nextAvg,
            );
          }
        }

        final entry = LedgerEntryRecord(
          id: id,
          accountId: accountId,
          accountName: accountName,
          kind: kind,
          typeLabel: typeLabel,
          payment: _parsePayment(data['payment'] as String?),
          direction: direction,
          amount: amount,
          currency: _parseCurrencyCode(data['currency'] as String?),
          exchangeRate: _toDouble(data['exchangeRate'], fallback: 1.0),
          details: (data['details'] as String? ?? '').trim(),
          documentNumber: (data['documentNumber'] as String? ?? '').trim(),
          warehouseId: whId,
          warehouseName: whName,
          expenseCategory: (data['expenseCategory'] as String? ?? '').trim(),
          entryNumber: entryNum,
          deleted: false,
          entryDate: (data['entryDate'] as String? ??
                  DateTime.now().toIso8601String().substring(0, 10))
              .trim(),
        );

        controller.ledger.insert(0, entry);

        if (lines.isNotEmpty) {
          final meta = await _readStateMap(txn, _extraMetaStateKey);
          final linesByEntry = _nestedMap(meta['invoiceLinesByEntry']) ??
              <String, Object?>{};
          linesByEntry[id] = lines;
          meta['invoiceLinesByEntry'] = linesByEntry;
          await _writeStateMap(txn, _extraMetaStateKey, meta);
        }

        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'entry': _ledgerToHybridJson(entry, lines: lines),
          'inventory': snap['inventory'],
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> updateLedgerEntry({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final entryId = (payload['entryId'] as String? ?? '').trim();
    final data = _nestedMap(payload['payload']) ?? payload;
    if (entryId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف القيد مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'updateLedgerEntry',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final idx = controller.ledger.indexWhere((e) => e.id == entryId);
        if (idx < 0) {
          throw const HybridBridgeException('NOT_FOUND', 'القيد غير موجود.');
        }
        final prev = controller.ledger[idx];
        final updated = LedgerEntryRecord(
          id: prev.id,
          accountId: (data['accountId'] as String?) ?? prev.accountId,
          accountName: (data['accountName'] as String?) ?? prev.accountName,
          kind: data['kind'] is String
              ? _parseLedgerKind(data['kind'] as String)
              : prev.kind,
          typeLabel: (data['typeLabel'] as String?) ?? prev.typeLabel,
          payment: data['payment'] is String
              ? _parsePayment(data['payment'] as String)
              : prev.payment,
          direction: data['direction'] is String
              ? (data['direction'] == 'credit'
                  ? EntryDirection.credit
                  : EntryDirection.debit)
              : prev.direction,
          amount: data['amount'] is num
              ? (data['amount'] as num).toDouble()
              : prev.amount,
          currency: data['currency'] is String
              ? _parseCurrencyCode(data['currency'] as String)
              : prev.currency,
          exchangeRate: prev.exchangeRate,
          details: (data['details'] as String?) ?? prev.details,
          documentNumber:
              (data['documentNumber'] as String?) ?? prev.documentNumber,
          warehouseId: prev.warehouseId,
          warehouseName: prev.warehouseName,
          expenseCategory: prev.expenseCategory,
          entryNumber: prev.entryNumber,
          deleted: prev.deleted,
          entryDate: (data['entryDate'] as String?) ?? prev.entryDate,
        );
        controller.ledger[idx] = updated;
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'entry': _ledgerToHybridJson(updated),
          'inventory': snap['inventory'],
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> setLedgerDeleted({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final entryId = (payload['entryId'] as String? ?? '').trim();
    final deleted = payload['deleted'] == true;
    if (entryId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف القيد مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'setLedgerDeleted',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final idx = controller.ledger.indexWhere((e) => e.id == entryId);
        if (idx < 0) {
          throw const HybridBridgeException('NOT_FOUND', 'القيد غير موجود.');
        }
        final prev = controller.ledger[idx];
        controller.ledger[idx] = LedgerEntryRecord(
          id: prev.id,
          accountId: prev.accountId,
          accountName: prev.accountName,
          kind: prev.kind,
          typeLabel: prev.typeLabel,
          payment: prev.payment,
          direction: prev.direction,
          amount: prev.amount,
          currency: prev.currency,
          exchangeRate: prev.exchangeRate,
          details: prev.details,
          documentNumber: prev.documentNumber,
          warehouseId: prev.warehouseId,
          warehouseName: prev.warehouseName,
          expenseCategory: prev.expenseCategory,
          entryNumber: prev.entryNumber,
          deleted: deleted,
          entryDate: prev.entryDate,
        );
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'inventory': snap['inventory'],
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> permanentlyDeleteLedger({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final entryId = (payload['entryId'] as String? ?? '').trim();
    if (entryId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف القيد مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'permanentlyDeleteLedger',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        controller.ledger.removeWhere((e) => e.id == entryId);
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'inventory': snap['inventory'],
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> saveWarehouse({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final name = (data['name'] as String? ?? '').trim();
    if (name.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'اسم المخزن مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'saveWarehouse',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final existingId = (payload['warehouseId'] as String?)?.trim() ??
            (data['id'] as String?)?.trim();
        final id = (existingId != null && existingId.isNotEmpty)
            ? existingId
            : _genId('wh');
        final isDefault = data['isDefault'] == true;
        if (isDefault) {
          for (var i = 0; i < controller.warehouses.length; i += 1) {
            final w = controller.warehouses[i];
            controller.warehouses[i] = WarehouseRecord(
              id: w.id,
              name: w.name,
              details: w.details,
              isDefault: false,
            );
          }
        }
        final wh = WarehouseRecord(
          id: id,
          name: name,
          details: (data['details'] as String? ?? '').trim(),
          isDefault: isDefault,
        );
        final idx = controller.warehouses.indexWhere((w) => w.id == id);
        if (idx >= 0) {
          controller.warehouses[idx] = wh;
        } else {
          controller.warehouses.add(wh);
        }

        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'warehouse': _warehouseToHybridJson(wh, controller.warehouses.length),
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> createInventoryItem({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final data = _nestedMap(payload['payload']) ?? payload;
    final name = (data['name'] as String? ?? '').trim();
    if (name.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'اسم الصنف مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'createInventoryItem',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final item = InventoryItemRecord(
          id: ((data['id'] as String?)?.trim().isNotEmpty ?? false)
              ? (data['id'] as String).trim()
              : _genId('inv'),
          name: name,
          unit: (data['unit'] as String? ?? 'حبة').trim(),
          quantity: _toDouble(data['quantity'], fallback: 0),
          avgCost: _toDouble(data['avgCost'], fallback: 0),
          warehouseId: (data['warehouseId'] as String? ??
                  (controller.warehouses.isNotEmpty
                      ? controller.warehouses.first.id
                      : 'wh_1'))
              .trim(),
          minThreshold: _toDouble(data['minThreshold'], fallback: 25),
          sku: (data['sku'] as String? ?? '').trim(),
        );
        controller.inventory.add(item);
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'item': _inventoryToHybridJson(item),
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> updateInventoryItem({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final itemId = (payload['itemId'] as String? ?? '').trim();
    final updates = _nestedMap(payload['updates']) ?? payload;
    if (itemId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف الصنف مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'updateInventoryItem',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final idx = controller.inventory.indexWhere((i) => i.id == itemId);
        if (idx < 0) {
          throw const HybridBridgeException('NOT_FOUND', 'الصنف غير موجود.');
        }
        final prev = controller.inventory[idx];
        final next = InventoryItemRecord(
          id: prev.id,
          name: (updates['name'] as String?)?.trim() ?? prev.name,
          unit: (updates['unit'] as String?)?.trim() ?? prev.unit,
          quantity: updates['quantity'] is num
              ? (updates['quantity'] as num).toDouble()
              : prev.quantity,
          avgCost: updates['avgCost'] is num
              ? (updates['avgCost'] as num).toDouble()
              : prev.avgCost,
          warehouseId:
              (updates['warehouseId'] as String?)?.trim() ?? prev.warehouseId,
          minThreshold: updates['minThreshold'] is num
              ? (updates['minThreshold'] as num).toDouble()
              : prev.minThreshold,
          sku: (updates['sku'] as String?)?.trim() ?? prev.sku,
        );
        controller.inventory[idx] = next;
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'item': _inventoryToHybridJson(next),
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> deleteInventoryItem({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final itemId = (payload['itemId'] as String? ?? '').trim();
    if (itemId.isEmpty) {
      throw const HybridBridgeException('VALIDATION_ERROR', 'معرف الصنف مطلوب.');
    }

    return receiptGuard.executeProtected(
      action: 'deleteInventoryItem',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        controller.inventory.removeWhere((i) => i.id == itemId);
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'ok': true, 'snapshot': snap};
      },
    );
  }

  Future<Map<String, Object?>> importInventoryItems({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final rawItems = payload['items'];
    if (rawItems is! List) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'قائمة الأصناف للاستيراد غير صالحة.',
      );
    }
    final mode = payload['mode'] == 'insert-only' ? 'insert-only' : 'upsert';

    return receiptGuard.executeProtected(
      action: 'importInventoryItems',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        int inserted = 0;
        int updated = 0;
        int skipped = 0;

        for (final raw in rawItems) {
          if (raw is! Map) {
            skipped += 1;
            continue;
          }
          final item = raw.map((k, v) => MapEntry(k.toString(), v));
          final name = (item['name'] as String? ?? '').trim();
          if (name.isEmpty) {
            skipped += 1;
            continue;
          }
          final existingIdx =
              controller.inventory.indexWhere((i) => i.name == name);
          if (existingIdx >= 0) {
            if (mode == 'insert-only') {
              skipped += 1;
              continue;
            }
            final prev = controller.inventory[existingIdx];
            controller.inventory[existingIdx] = InventoryItemRecord(
              id: prev.id,
              name: name,
              unit: (item['unit'] as String?)?.trim() ?? prev.unit,
              quantity: _toDouble(item['quantity'], fallback: prev.quantity),
              avgCost: _toDouble(item['avgCost'], fallback: prev.avgCost),
              warehouseId:
                  (item['warehouseId'] as String?)?.trim() ?? prev.warehouseId,
              minThreshold:
                  _toDouble(item['minThreshold'], fallback: prev.minThreshold),
              sku: (item['sku'] as String?)?.trim() ?? prev.sku,
            );
            updated += 1;
          } else {
            controller.inventory.add(
              InventoryItemRecord(
                id: _genId('inv'),
                name: name,
                unit: (item['unit'] as String? ?? 'حبة').trim(),
                quantity: _toDouble(item['quantity'], fallback: 0),
                avgCost: _toDouble(item['avgCost'], fallback: 0),
                warehouseId: (item['warehouseId'] as String? ?? 'wh_1').trim(),
                minThreshold: _toDouble(item['minThreshold'], fallback: 25),
                sku: (item['sku'] as String? ?? '').trim(),
              ),
            );
            inserted += 1;
          }
        }

        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{
          'inserted': inserted,
          'updated': updated,
          'skipped': skipped,
          'total': rawItems.length,
          'inventory': snap['inventory'],
          'snapshot': snap,
        };
      },
    );
  }

  Future<Map<String, Object?>> batchUpdateInventoryItems({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final rawUpdates = payload['updates'];
    if (rawUpdates is! List) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'قائمة التحديثات غير صالحة.',
      );
    }

    return receiptGuard.executeProtected(
      action: 'batchUpdateInventoryItems',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        for (final raw in rawUpdates) {
          if (raw is! Map) continue;
          final id = (raw['id'] as String? ?? '').trim();
          final data = _nestedMap(raw['data']);
          if (id.isEmpty || data == null) continue;
          final idx = controller.inventory.indexWhere((i) => i.id == id);
          if (idx < 0) continue;
          final prev = controller.inventory[idx];
          controller.inventory[idx] = prev.copyWith(
            quantity: data['quantity'] is num
                ? (data['quantity'] as num).toDouble()
                : prev.quantity,
            avgCost: data['avgCost'] is num
                ? (data['avgCost'] as num).toDouble()
                : prev.avgCost,
          );
        }
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final snap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'snapshot': snap};
      },
    );
  }

  Future<Map<String, Object?>> getInventoryMovementsReport(
    Map<String, Object?> options,
  ) async {
    final warehouseFilter = (options['warehouseId'] as String? ?? '').trim();
    final profitBasis = (options['profitBasis'] as String?) ?? 'avg';
    final whNameById = <String, String>{
      for (final w in controller.warehouses) w.id: w.name,
    };

    final itemRows = <Map<String, Object?>>[];
    final warehouseStocks = <Map<String, Object?>>[];
    double totalRemainingValue = 0;
    int activeItemsCount = 0;

    for (final item in controller.inventory) {
      if (warehouseFilter.isNotEmpty &&
          warehouseFilter != 'all' &&
          item.warehouseId != warehouseFilter) {
        continue;
      }
      final remainingValue = item.quantity * item.avgCost;
      totalRemainingValue += remainingValue;
      if (item.quantity > 0) activeItemsCount += 1;

      warehouseStocks.add(<String, Object?>{
        'inventoryItemId': item.id,
        'warehouseId': item.warehouseId,
        'warehouseName': whNameById[item.warehouseId] ?? 'المخزن الرئيسي',
        'purchasesQty': 0.0,
        'salesQty': 0.0,
        'salesReturnQty': 0.0,
        'purchaseReturnQty': 0.0,
        'transferInQty': 0.0,
        'transferOutQty': 0.0,
        'netComputedQty': item.quantity,
      });

      itemRows.add(<String, Object?>{
        'id': item.id,
        'code': null,
        'name': item.name,
        'sku': item.sku,
        'unit': item.unit,
        'unit2': '',
        'count2': null,
        'warehouseId': item.warehouseId,
        'currencyCode': controller.defaultCurrency.label,
        'buyQty': 0.0,
        'sellQty': 0.0,
        'transferInQty': 0.0,
        'transferOutQty': 0.0,
        'buyTotal': 0.0,
        'sellTotal': 0.0,
        'availableQty': item.quantity,
        'unitCost': item.avgCost,
        'remainingValue': remainingValue,
        'profit': 0.0,
        'avgCost': item.avgCost,
        'catalogQuantity': item.quantity,
        'quantityUnverified': false,
        'hasMovement': false,
      });
    }

    return <String, Object?>{
      'warehouses': controller.warehouses
          .map((w) => <String, Object?>{'id': w.id, 'name': w.name})
          .toList(),
      'warehouseStocks': warehouseStocks,
      'itemRows': itemRows,
      'totals': <String, Object?>{
        'totalSales': 0.0,
        'totalPurchases': 0.0,
        'totalProfit': 0.0,
        'totalRemainingValue': totalRemainingValue,
        'activeItemsCount': activeItemsCount,
        'profitBasis': profitBasis,
      },
      'totalsByCurrency': <Map<String, Object?>>[
        <String, Object?>{
          'currency': controller.defaultCurrency.label,
          'totalSales': 0.0,
          'totalPurchases': 0.0,
          'totalProfit': 0.0,
          'totalRemainingValue': totalRemainingValue,
          'totalRemainingQty': controller.inventory
              .fold<double>(0.0, (sum, i) => sum + i.quantity),
          'activeItemsCount': activeItemsCount,
        },
      ],
      'movements': const <Map<String, Object?>>[],
      'anomalies': const <String, Object?>{
        'unverifiedItemsCount': 0,
        'unresolvedTransfersCount': 0,
        'unresolvedTransfers': <Map<String, Object?>>[],
        'negativeComputedItems': <Map<String, Object?>>[],
      },
    };
  }

  /// Cashboxes report computed strictly from `ErpController.ledger` with
  /// separated per-currency totals (never merging different currencies).
  Future<Map<String, Object?>> getCashboxesReport(
    Map<String, Object?> options,
  ) async {
    final currencyFilter = (options['currency'] as String? ?? '').trim();
    final fromDate = (options['fromDate'] as String? ?? '').trim();
    final toDate = (options['toDate'] as String? ?? '').trim();

    final perCurrency = <String, Map<String, double>>{};

    for (final entry in controller.ledger) {
      if (entry.deleted || entry.payment != PaymentMethod.cash) continue;
      if (fromDate.isNotEmpty && entry.entryDate.compareTo(fromDate) < 0) {
        continue;
      }
      if (toDate.isNotEmpty && entry.entryDate.compareTo(toDate) > 0) continue;

      final curr = entry.currency.label;
      if (currencyFilter.isNotEmpty &&
          currencyFilter != 'all' &&
          curr != currencyFilter) {
        continue;
      }

      final bucket = perCurrency.putIfAbsent(
        curr,
        () => <String, double>{
          'in': 0.0,
          'out': 0.0,
          'count': 0.0,
        },
      );
      if (entry.direction == EntryDirection.credit) {
        bucket['in'] = bucket['in']! + entry.amount;
      } else {
        bucket['out'] = bucket['out']! + entry.amount;
      }
      bucket['count'] = bucket['count']! + 1;
    }

    final totalsByCurrency = perCurrency.entries.map((e) {
      final unIn = e.value['in']!;
      final unOut = e.value['out']!;
      final net = unIn - unOut;
      return <String, Object?>{
        'currency': e.key,
        'linkedCashboxesNet': 0.0,
        'unlinkedCashIn': unIn,
        'unlinkedCashOut': unOut,
        'unlinkedCashNet': net,
        'unlinkedCashCount': e.value['count']!.toInt(),
        'totalCashNet': net,
      };
    }).toList();

    final primary = totalsByCurrency.length == 1
        ? totalsByCurrency.first
        : const <String, Object?>{
            'linkedCashboxesNet': 0.0,
            'unlinkedCashIn': 0.0,
            'unlinkedCashOut': 0.0,
            'unlinkedCashNet': 0.0,
            'unlinkedCashCount': 0,
            'totalCashNet': 0.0,
          };

    return <String, Object?>{
      'cashboxes': _buildCashboxes(),
      'reconciliation': <String, Object?>{
        'currencyFilter': currencyFilter.isEmpty ? 'all' : currencyFilter,
        'fromDate': fromDate.isEmpty ? null : fromDate,
        'toDate': toDate.isEmpty ? null : toDate,
        'linkedCashboxesNet': primary['linkedCashboxesNet'],
        'unlinkedCashIn': primary['unlinkedCashIn'],
        'unlinkedCashOut': primary['unlinkedCashOut'],
        'unlinkedCashNet': primary['unlinkedCashNet'],
        'unlinkedCashCount': primary['unlinkedCashCount'],
        'totalCashNet': primary['totalCashNet'],
        'activeCount': _buildCashboxes().length,
        'inactiveCount': 0,
        'totalsByCurrency': totalsByCurrency,
      },
    };
  }

  Future<Map<String, Object?>> getInvoiceDetail(String entryId) async {
    final idx = controller.ledger.indexWhere((e) => e.id == entryId);
    if (idx < 0) {
      throw const HybridBridgeException('NOT_FOUND', 'الفاتورة غير موجودة.');
    }
    final db = await _databaseProvider();
    final meta = await _readStateMap(db, _extraMetaStateKey);
    final linesByEntry = _nestedMap(meta['invoiceLinesByEntry']);
    final rawLines = linesByEntry?[entryId];
    final lines = rawLines is List
        ? rawLines
            .whereType<Map>()
            .map((m) => m.map((k, v) => MapEntry(k.toString(), v)))
            .toList()
        : <Map<String, Object?>>[];
    return <String, Object?>{
      'entry': _ledgerToHybridJson(controller.ledger[idx], lines: lines),
      'lines': lines,
    };
  }

  Future<Map<String, Object?>> getProductPriceStats(String itemId) async {
    final idx = controller.inventory.indexWhere((i) => i.id == itemId);
    if (idx < 0) {
      return const <String, Object?>{
        'minPrice': 0.0,
        'maxPrice': 0.0,
        'lastPrice': 0.0,
        'txCount': 0,
      };
    }
    final cost = controller.inventory[idx].avgCost;
    return <String, Object?>{
      'minPrice': cost,
      'maxPrice': cost,
      'lastPrice': cost,
      'txCount': 1,
    };
  }

  Future<Map<String, Object?>> saveErpData(Map<String, Object?> data) async {
    final db = await _databaseProvider();
    await _writeStateMap(db, 'hybrid_erp_data', data);
    return <String, Object?>{'saved': true};
  }

  Future<Map<String, Object?>> backupWorkspace({
    required String backupName,
    required bool allowFinancialWrites,
  }) async {
    final snap = await getSnapshot(allowFinancialWrites: allowFinancialWrites);
    final nowIso = DateTime.now().toIso8601String();
    final jsonContent = jsonEncode(<String, Object?>{
      'format': 'nasqo-localdb-backup-v1',
      'exportedAtIso': nowIso,
      'snapshot': snap,
    });
    return <String, Object?>{
      'id': _genId('bkp'),
      'name': backupName.isNotEmpty ? backupName : 'nasqo-backup-$nowIso.json',
      'exportedAtIso': nowIso,
      'base64Content': base64Encode(utf8.encode(jsonContent)),
      'sizeBytes': utf8.encode(jsonContent).length,
    };
  }

  Future<Map<String, Object?>> restoreWorkspace({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    final base64Content = (payload['base64Content'] as String? ?? '').trim();
    if (base64Content.isEmpty) {
      throw const HybridBridgeException(
        'VALIDATION_ERROR',
        'محتوى النسخة الاحتياطية فارغ.',
      );
    }

    return receiptGuard.executeProtected(
      action: 'restoreWorkspace',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        final decoded = jsonDecode(utf8.decode(base64Decode(base64Content)));
        if (decoded is! Map) {
          throw const HybridBridgeException(
            'VALIDATION_ERROR',
            'تنسيق النسخة الاحتياطية غير صالح.',
          );
        }
        final root = decoded.map((k, v) => MapEntry(k.toString(), v));
        final snap = _nestedMap(root['snapshot']) ?? root;
        final rawAccounts = snap['accounts'];
        if (rawAccounts is List) {
          controller.accounts
            ..clear()
            ..addAll(
              rawAccounts.whereType<Map>().map((m) {
                final a = m.map((k, v) => MapEntry(k.toString(), v));
                return AccountRecord(
                  id: (a['id'] as String?) ?? _genId('acc'),
                  name: (a['name'] as String?) ?? 'حساب',
                  category: _parseCategory(a['category'] as String?),
                  phone: (a['phone'] as String?) ?? '',
                  creditLimit: _toDouble(a['creditLimit'], fallback: 50000),
                  currency: _parseCurrencyCode(a['currency'] as String?),
                  isCashAccount: a['isCashAccount'] == true,
                  note: (a['note'] as String?) ?? '',
                  openingBalance: _toDouble(a['openingBalance'], fallback: 0),
                  openingDirection: a['openingDirection'] == 'debit'
                      ? EntryDirection.debit
                      : EntryDirection.credit,
                  codeNumber: (a['codeNumber'] as num?)?.toInt() ?? 1,
                );
              }),
            );
        }

        final rawLedger = snap['ledger'];
        if (rawLedger is List) {
          controller.ledger
            ..clear()
            ..addAll(
              rawLedger.whereType<Map>().map((m) {
                final l = m.map((k, v) => MapEntry(k.toString(), v));
                return LedgerEntryRecord(
                  id: (l['id'] as String?) ?? _genId('led'),
                  accountId: (l['accountId'] as String?) ?? '',
                  accountName: (l['accountName'] as String?) ?? '',
                  kind: _parseLedgerKind(l['kind'] as String?),
                  typeLabel: (l['typeLabel'] as String?) ?? 'قيد مالي',
                  payment: _parsePayment(l['payment'] as String?),
                  direction: l['direction'] == 'credit'
                      ? EntryDirection.credit
                      : EntryDirection.debit,
                  amount: _toDouble(l['amount'], fallback: 0),
                  currency: _parseCurrencyCode(l['currency'] as String?),
                  exchangeRate: _toDouble(l['exchangeRate'], fallback: 1.0),
                  details: (l['details'] as String?) ?? '',
                  documentNumber: (l['documentNumber'] as String?) ?? '',
                  warehouseId: (l['warehouseId'] as String?) ?? 'wh_main',
                  warehouseName:
                      (l['warehouseName'] as String?) ?? 'المخزن الرئيسي',
                  expenseCategory: (l['expenseCategory'] as String?) ?? '',
                  entryNumber: (l['entryNumber'] as num?)?.toInt() ?? 1001,
                  deleted: l['deleted'] == true,
                  entryDate: (l['entryDate'] as String?) ??
                      DateTime.now().toIso8601String().substring(0, 10),
                );
              }),
            );
        }

        final rawWarehouses = snap['warehouses'];
        if (rawWarehouses is List) {
          controller.warehouses
            ..clear()
            ..addAll(
              rawWarehouses.whereType<Map>().map((m) {
                final w = m.map((k, v) => MapEntry(k.toString(), v));
                return WarehouseRecord(
                  id: (w['id'] as String?) ?? _genId('wh'),
                  name: (w['name'] as String?) ?? 'المخزن الرئيسي',
                  details: (w['details'] as String?) ?? '',
                  isDefault: w['isDefault'] == true,
                );
              }),
            );
        }

        final rawInventory = snap['inventory'];
        if (rawInventory is List) {
          controller.inventory
            ..clear()
            ..addAll(
              rawInventory.whereType<Map>().map((m) {
                final i = m.map((k, v) => MapEntry(k.toString(), v));
                return InventoryItemRecord(
                  id: (i['id'] as String?) ?? _genId('inv'),
                  name: (i['name'] as String?) ?? 'صنف',
                  unit: (i['unit'] as String?) ?? 'حبة',
                  quantity: _toDouble(i['quantity'], fallback: 0),
                  avgCost: _toDouble(i['avgCost'], fallback: 0),
                  warehouseId: (i['warehouseId'] as String?) ?? 'wh_main',
                  minThreshold: _toDouble(i['minThreshold'], fallback: 25),
                  sku: (i['sku'] as String?) ?? '',
                );
              }),
            );
        }

        final rawUiPrefs = _nestedMap(snap['uiPreferences']);
        if (rawUiPrefs != null) {
          await _writeStateMap(txn, _uiPrefsStateKey, rawUiPrefs);
        }

        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final nextSnap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'restored': true, 'snapshot': nextSnap};
      },
    );
  }

  Future<Map<String, Object?>> resetWorkspace({
    required String idempotencyKey,
    required Map<String, Object?> payload,
    required bool allowFinancialWrites,
  }) async {
    return receiptGuard.executeProtected(
      action: 'resetWorkspace',
      idempotencyKey: idempotencyKey,
      payload: payload,
      postWork: (txn, _) async {
        controller.accounts.clear();
        controller.ledger.clear();
        controller.inventory.clear();
        await _persistControllerTablesInTxn(txn);
        _snapshotVersion += 1;
        controller.notifyListeners();

        final nextSnap = await getSnapshot(
          allowFinancialWrites: allowFinancialWrites,
          executor: txn,
        );
        return <String, Object?>{'reset': true, 'snapshot': nextSnap};
      },
    );
  }

  /// Persists the EXISTING `ErpController` state into the EXISTING `LocalDatabase`
  /// tables (`accounts`, `ledger_entries`, `warehouses`, `inventory_items`, `erp_state`)
  /// inside the active `PostingReceiptGuard` transaction.
  Future<void> _persistControllerTablesInTxn(Transaction txn) async {
    await txn.delete('accounts');
    for (final a in controller.accounts) {
      await txn.insert(
        'accounts',
        <String, Object?>{
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
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await txn.delete('ledger_entries');
    for (final l in controller.ledger) {
      await txn.insert(
        'ledger_entries',
        <String, Object?>{
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
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await txn.delete('warehouses');
    for (final w in controller.warehouses) {
      await txn.insert(
        'warehouses',
        <String, Object?>{
          'id': w.id,
          'name': w.name,
          'details': w.details,
          'isDefault': w.isDefault ? 1 : 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await txn.delete('inventory_items');
    for (final i in controller.inventory) {
      await txn.insert(
        'inventory_items',
        <String, Object?>{
          'id': i.id,
          'name': i.name,
          'unit': i.unit,
          'quantity': i.quantity,
          'avgCost': i.avgCost,
          'warehouseId': i.warehouseId,
          'minThreshold': i.minThreshold,
          'sku': i.sku,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    final maxNum = controller.ledger.fold<int>(
      1200,
      (m, e) => e.entryNumber > m ? e.entryNumber : m,
    );
    await _writeStateMap(txn, 'settings', <String, Object?>{
      'companyName': controller.companyName,
      'isDarkMode': controller.isDarkMode,
      'nextEntryNumber': maxNum,
    });
  }

  Future<Map<String, Object?>> _readStateMap(
    DatabaseExecutor db,
    String stateKey,
  ) async {
    final rows = await db.query(
      'erp_state',
      where: 'stateKey = ?',
      whereArgs: [stateKey],
      limit: 1,
    );
    if (rows.isEmpty) return <String, Object?>{};
    try {
      final decoded = jsonDecode(rows.first['payloadJson'] as String);
      if (decoded is Map) {
        return decoded.map((k, v) => MapEntry(k.toString(), v));
      }
    } catch (_) {}
    return <String, Object?>{};
  }

  Future<void> _writeStateMap(
    DatabaseExecutor db,
    String stateKey,
    Map<String, Object?> map,
  ) async {
    await db.insert(
      'erp_state',
      <String, Object?>{
        'stateKey': stateKey,
        'payloadJson': jsonEncode(map),
        'updatedAt': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  List<Map<String, Object?>> _buildCurrencyList(Map<String, Object?> meta) {
    final stored = meta['currencies'];
    if (stored is List && stored.isNotEmpty) {
      return stored
          .whereType<Map>()
          .map((m) => m.map((k, v) => MapEntry(k.toString(), v)))
          .toList();
    }
    return CurrencyCode.values
        .asMap()
        .entries
        .map(
          (e) => <String, Object?>{
            'id': e.key + 1,
            'code': e.value.label,
            'name': e.value.label,
            'symbol': e.value.label,
            'ratePrimary': 1.0,
            'rateSecondary': 1.0,
            'nameSecondary': e.value.name.toUpperCase(),
          },
        )
        .toList();
  }

  List<Map<String, Object?>> _buildAccountGroups(Map<String, Object?> meta) {
    final stored = meta['accountGroups'];
    if (stored is List && stored.isNotEmpty) {
      return stored
          .whereType<Map>()
          .map((m) => m.map((k, v) => MapEntry(k.toString(), v)))
          .toList();
    }
    return AccountCategory.values
        .asMap()
        .entries
        .map(
          (e) => <String, Object?>{
            'id': e.key + 1,
            'name': e.value.label,
            'category': e.value.name,
            'currencyCode': controller.defaultCurrency.label,
            'hasBill': true,
            'isEmployee': e.value == AccountCategory.employees,
            'sortOrder': e.key + 1,
          },
        )
        .toList();
  }

  List<Map<String, Object?>> _buildCashboxes() {
    final cashAccounts = controller.accounts.where((a) => a.isCashAccount);
    return cashAccounts
        .toList()
        .asMap()
        .entries
        .map(
          (e) => <String, Object?>{
            'id': e.key + 1,
            'name': e.value.name,
            'details': e.value.note,
            'currencyCode': e.value.currency.label,
            'state': 1,
            'boxType': 0,
            'sortOrder': e.key + 1,
            'isActive': true,
          },
        )
        .toList();
  }

  Map<String, Object?> _accountToHybridJson(
    AccountRecord a, {
    int? groupId,
  }) =>
      <String, Object?>{
        'id': a.id,
        'ownerId': workspaceId,
        'groupId': groupId ?? (AccountCategory.values.indexOf(a.category) + 1),
        'name': a.name,
        'category': a.category.name,
        'phone': a.phone,
        'creditLimit': a.creditLimit,
        'currency': a.currency.label,
        'isCashAccount': a.isCashAccount,
        'accountImage': '1',
        'sortOrder': a.codeNumber,
        'settlement': false,
        'documentNumberRequired': false,
        'messageMethod': 'sms',
        'sendMode': 'never',
        'note': a.note,
        'openingBalance': a.openingBalance,
        'openingDirection': a.openingDirection.name,
        'codeNumber': a.codeNumber,
      };

  Map<String, Object?> _ledgerToHybridJson(
    LedgerEntryRecord l, {
    List<Map<String, Object?>> lines = const [],
  }) =>
      <String, Object?>{
        'id': l.id,
        'ownerId': workspaceId,
        'accountId': l.accountId,
        'accountName': l.accountName,
        'counterpartAccountId': '',
        'counterpartAccountName': '',
        'kind': _ledgerKindToHybrid(l.kind),
        'typeLabel': l.typeLabel,
        'payment': l.payment.name,
        'direction': l.direction.name,
        'amount': l.amount,
        'currency': l.currency.label,
        'exchangeRate': l.exchangeRate,
        'details': l.details,
        'documentNumber': l.documentNumber,
        'warehouseId': l.warehouseId,
        'warehouseName': l.warehouseName,
        'invoiceContent': lines.isNotEmpty ? 'items' : 'none',
        'entryNumber': l.entryNumber,
        'deleted': l.deleted,
        'entryDate': l.entryDate,
        if (l.expenseCategory.isNotEmpty) 'expenseCategory': l.expenseCategory,
        'sourceOrigin': 'native',
        'lineCount': lines.length,
        if (lines.isNotEmpty) 'lines': lines,
        'createdAtMs': DateTime.now().millisecondsSinceEpoch,
      };

  Map<String, Object?> _warehouseToHybridJson(WarehouseRecord w, int code) =>
      <String, Object?>{
        'id': w.id,
        'ownerId': workspaceId,
        'name': w.name,
        'details': w.details,
        'isDefault': w.isDefault,
        'codeNumber': code,
      };

  Map<String, Object?> _inventoryToHybridJson(InventoryItemRecord i) =>
      <String, Object?>{
        'id': i.id,
        'ownerId': workspaceId,
        'name': i.name,
        'unit': i.unit,
        'quantity': i.quantity,
        'avgCost': i.avgCost,
        'minThreshold': i.minThreshold,
        'sku': i.sku,
        'currencyCode': controller.defaultCurrency.label,
        'isActive': true,
        'warehouseId': i.warehouseId,
        'quantityUnverified': false,
      };

  static int _stockEffectSign({
    required LedgerKind kind,
    required EntryDirection direction,
    required String typeLabel,
  }) {
    if (kind == LedgerKind.invoice) {
      if (typeLabel.contains('مشتريات') || direction == EntryDirection.credit) {
        return 1;
      }
      return -1;
    }
    if (kind == LedgerKind.returnEntry) {
      if (typeLabel.contains('مشتريات')) return -1;
      return 1;
    }
    return 0;
  }

  static CurrencyCode _parseCurrencyCode(String? raw) {
    final clean = (raw ?? '').trim();
    for (final code in CurrencyCode.values) {
      if (code.label == clean || code.name == clean.toLowerCase()) return code;
    }
    return CurrencyCode.sar;
  }

  static AccountCategory _parseCategory(String? raw) {
    final clean = (raw ?? '').trim();
    for (final c in AccountCategory.values) {
      if (c.name == clean || c.label == clean) return c;
    }
    return AccountCategory.purchases;
  }

  static LedgerKind _parseLedgerKind(String? raw) {
    return switch (raw) {
      'invoice' => LedgerKind.invoice,
      'return' => LedgerKind.returnEntry,
      'quote' => LedgerKind.quote,
      'order' => LedgerKind.order,
      'transfer' => LedgerKind.transfer,
      'currency' => LedgerKind.currency,
      'simple-entry' => LedgerKind.simpleEntry,
      'opening' => LedgerKind.opening,
      _ => LedgerKind.voucher,
    };
  }

  static String _ledgerKindToHybrid(LedgerKind kind) {
    return switch (kind) {
      LedgerKind.returnEntry => 'return',
      LedgerKind.simpleEntry => 'simple-entry',
      _ => kind.name,
    };
  }

  static PaymentMethod _parsePayment(String? raw) {
    for (final p in PaymentMethod.values) {
      if (p.name == raw || p.label == raw) return p;
    }
    return PaymentMethod.credit;
  }

  static Map<String, Object?>? _nestedMap(Object? raw) {
    if (raw is! Map) return null;
    return raw.map((k, v) => MapEntry(k.toString(), v));
  }

  static double _toDouble(Object? raw, {required double fallback}) {
    if (raw is num) return raw.toDouble();
    if (raw is String) return double.tryParse(raw.trim()) ?? fallback;
    return fallback;
  }

  static AccountRecord _accountFromDbRow(Map<String, Object?> row) =>
      AccountRecord(
        id: (row['id'] as String?) ?? _genId('acc'),
        name: (row['name'] as String?) ?? 'حساب',
        category: _parseCategory(row['category'] as String?),
        phone: (row['phone'] as String?) ?? '',
        creditLimit: _toDouble(row['creditLimit'], fallback: 50000),
        currency: _parseCurrencyCode(row['currency'] as String?),
        isCashAccount: (row['isCashAccount'] as num?) == 1,
        note: (row['note'] as String?) ?? '',
        openingBalance: _toDouble(row['openingBalance'], fallback: 0),
        openingDirection: row['openingDirection'] == 'debit'
            ? EntryDirection.debit
            : EntryDirection.credit,
        codeNumber: (row['codeNumber'] as num?)?.toInt() ?? 1,
      );

  static LedgerEntryRecord _ledgerFromDbRow(Map<String, Object?> row) =>
      LedgerEntryRecord(
        id: (row['id'] as String?) ?? _genId('led'),
        accountId: (row['accountId'] as String?) ?? '',
        accountName: (row['accountName'] as String?) ?? '',
        kind: _parseLedgerKind(row['kind'] as String?),
        typeLabel: (row['typeLabel'] as String?) ?? 'قيد مالي',
        payment: _parsePayment(row['payment'] as String?),
        direction: row['direction'] == 'credit'
            ? EntryDirection.credit
            : EntryDirection.debit,
        amount: _toDouble(row['amount'], fallback: 0),
        currency: _parseCurrencyCode(row['currency'] as String?),
        exchangeRate: _toDouble(row['exchangeRate'], fallback: 1.0),
        details: (row['details'] as String?) ?? '',
        documentNumber: (row['documentNumber'] as String?) ?? '',
        warehouseId: (row['warehouseId'] as String?) ?? 'wh_main',
        warehouseName: (row['warehouseName'] as String?) ?? 'المخزن الرئيسي',
        expenseCategory: (row['expenseCategory'] as String?) ?? '',
        entryNumber: (row['entryNumber'] as num?)?.toInt() ?? 1001,
        deleted: (row['deleted'] as num?) == 1,
        entryDate: (row['entryDate'] as String?) ??
            DateTime.now().toIso8601String().substring(0, 10),
      );

  static WarehouseRecord _warehouseFromDbRow(Map<String, Object?> row) =>
      WarehouseRecord(
        id: (row['id'] as String?) ?? _genId('wh'),
        name: (row['name'] as String?) ?? 'المخزن الرئيسي',
        details: (row['details'] as String?) ?? '',
        isDefault: (row['isDefault'] as num?) == 1,
      );

  static InventoryItemRecord _inventoryFromDbRow(Map<String, Object?> row) =>
      InventoryItemRecord(
        id: (row['id'] as String?) ?? _genId('inv'),
        name: (row['name'] as String?) ?? 'صنف',
        unit: (row['unit'] as String?) ?? 'حبة',
        quantity: _toDouble(row['quantity'], fallback: 0),
        avgCost: _toDouble(row['avgCost'], fallback: 0),
        warehouseId: (row['warehouseId'] as String?) ?? 'wh_main',
        minThreshold: _toDouble(row['minThreshold'], fallback: 25),
        sku: (row['sku'] as String?) ?? '',
      );

  static int _seq = 0;
  static String _genId(String prefix) {
    _seq += 1;
    return '${prefix}_${DateTime.now().millisecondsSinceEpoch}_$_seq';
  }
}
