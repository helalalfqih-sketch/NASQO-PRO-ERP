import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'local_invoice_roles.dart';
import 'local_master_catalog.dart';
import 'local_workspace_settings.dart';

/// Real, zero-opening system accounts. Never infer a role from a party name.
class AutomaticPostingSetup {
  static const notePrefix = 'nasqo:system:';
  static const labels = {
    'revenue': 'إيراد المبيعات',
    'inventory': 'المخزون',
    'cost': 'تكلفة البضاعة المباعة',
    'expense': 'المشتريات الحرة',
    'outputTax': 'ضريبة المبيعات',
    'inputTax': 'ضريبة المشتريات',
    'balanceVoucher': 'تسوية الأرصدة',
    'cash': 'النقدية',
    'opening': 'أرصدة بداية التشغيل',
    'adjustment': 'فروق تكلفة المخزون',
  };

  static Future<String> account(
      DatabaseExecutor db, String code, String role, String title,
      {bool cash = false, String category = 'shop', bool system = true}) async {
    final id =
        'nasqo-${system ? 'system' : 'default'}-$code-${role.replaceAll(':', '-')}';
    final rows = await db.query('accounts', where: 'id = ?', whereArgs: [id]);
    final note = system ? '$notePrefix$role' : 'nasqo:default:$role';
    if (rows.isNotEmpty) {
      final row = rows.single;
      if (row['currency'] != code ||
          row['isCashAccount'] != (cash ? 1 : 0) ||
          row['note'] != note)
        throw StateError('تعذر تجهيز الحساب الافتراضي بسبب تعارض معرفه.');
      return id;
    }
    final max = (await db
            .rawQuery('SELECT COALESCE(MAX(codeNumber),0) AS n FROM accounts'))
        .single['n'] as num;
    await db.insert('accounts', {
      'id': id,
      'name': title,
      'category': category,
      'currency': code,
      'isCashAccount': cash ? 1 : 0,
      'phone': '',
      'creditLimit': 0,
      'note': note,
      'openingBalance': 0,
      'openingDirection': 'debit',
      'codeNumber': max.toInt() + 1
    });
    return id;
  }

  static Future<Map<String, String>> ensure(
      DatabaseExecutor db, String code) async {
    final currency = LocalInvoiceRoles.currencyNames[code];
    if (currency == null) throw ArgumentError('Unsupported posting currency');
    final saved = await LocalInvoiceRoles.read(db);
    final raw = saved[code];
    final roles = <String, String>{
      if (raw is Map)
        for (final e in raw.entries)
          if (e.value is String) e.key.toString(): e.value as String
    };
    var changed = false;
    Future<void> prepare(String role, String label, {bool cash = false}) async {
      final existing = roles[role];
      if (existing != null &&
          (await db.query('accounts',
                      where: 'id = ? AND currency = ? AND isCashAccount = ?',
                      whereArgs: [existing, code, cash ? 1 : 0]))
                  .length ==
              1) return;
      roles[role] =
          await account(db, code, role, '$label — $currency', cash: cash);
      changed = true;
    }

    for (final e in labels.entries) {
      await prepare(e.key, e.value, cash: e.key == 'cash');
    }
    for (final box in await LocalMasterCatalog.read(db, 'cashboxes')) {
      if (box['currencyCode'] == currency &&
          box['isActive'] != false &&
          box['state'] != 0)
        await prepare('cashbox:${box['id']}', 'حساب ${box['name']}',
            cash: true);
    }
    if (changed) {
      saved[code] = roles;
      await db.insert(
          'erp_state',
          {
            'stateKey': LocalInvoiceRoles.stateKey,
            'payloadJson': jsonEncode(saved),
            'updatedAt': DateTime.now().toUtc().toIso8601String()
          },
          conflictAlgorithm: ConflictAlgorithm.replace);
    }
    return roles;
  }

  static Future<void> defaults(DatabaseExecutor db) async {
    final preferences = await LocalWorkspaceSettings.read(db);
    final currencies = await LocalMasterCatalog.read(db, 'currencies');
    final names = currencies.map((c) => c['name']).toSet();
    final currency = names.contains(preferences['defaultCurrency'])
        ? preferences['defaultCurrency'] as String
        : 'ريال';
    var warehouses = await db.query('warehouses');
    if (warehouses.isEmpty) {
      await db.insert('warehouses', {
        'id': 'nasqo-default-warehouse',
        'name': 'المخزن الرئيسي',
        'details': '',
        'isDefault': 1
      });
      warehouses = await db.query('warehouses');
    }
    final boxes = await LocalMasterCatalog.read(db, 'cashboxes');
    var boxesChanged = false;
    for (final c in currencies) {
      final name = c['name'], code = LocalMasterCatalog.currencyCodes[name];
      if (code == null) continue;
      if (!boxes.any((b) =>
          b['currencyCode'] == name &&
          b['isActive'] != false &&
          b['state'] != 0)) {
        boxes.add({
          'id': LocalMasterCatalog.nextId(boxes),
          'name': 'الصندوق الرئيسي — $name',
          'currencyCode': name,
          'isActive': true,
          'state': 1
        });
        boxesChanged = true;
      }
    }
    if (boxesChanged) await LocalMasterCatalog.write(db, 'cashboxes', boxes);
    final source =
        await db.query('legacy_operational_source', columns: ['sha'], limit: 1);
    final marker = await db.query('erp_state',
        where: 'stateKey = ?', whereArgs: ['automatic_reference_defaults_v1']);
    final sourceKey = source.isEmpty ? 'new' : source.single['sha'];
    if (marker.isEmpty ||
        jsonDecode(marker.single['payloadJson'] as String) != sourceKey) {
      final code = LocalMasterCatalog.currencyCodes[currency] ?? 'sar';
      final customer = await account(db, code, 'cash-customer', 'عميل نقد',
          category: 'clients', system: false);
      await account(db, code, 'cash-supplier', 'مورد نقد',
          category: 'purchases', system: false);
      final defaults = preferences['referenceDefaults'];
      final next = defaults is Map
          ? Map<String, dynamic>.from(defaults)
          : <String, dynamic>{};
      next['warehouseId'] ??= warehouses.firstWhere((w) => w['isDefault'] == 1,
          orElse: () => warehouses.first)['id'];
      next['accountId'] ??= customer;
      final system =
          Map<String, dynamic>.from(next['systemCashboxes'] as Map? ?? {});
      for (final box in boxes) {
        if (box['isActive'] != false && box['state'] != 0)
          system.putIfAbsent(box['currencyCode'] as String, () => box['id']);
      }
      next['systemCashboxes'] = system;
      next['accountCashboxes'] ??= <String, dynamic>{};
      next['groupCashboxes'] ??= <String, dynamic>{};
      preferences['defaultCurrency'] = currency;
      preferences['referenceDefaults'] = next;
      await db.insert(
          'erp_state',
          {
            'stateKey': LocalWorkspaceSettings.stateKey,
            'payloadJson': jsonEncode(preferences),
            'updatedAt': DateTime.now().toUtc().toIso8601String()
          },
          conflictAlgorithm: ConflictAlgorithm.replace);
      await db.insert(
          'erp_state',
          {
            'stateKey': 'automatic_reference_defaults_v1',
            'payloadJson': jsonEncode(sourceKey),
            'updatedAt': DateTime.now().toUtc().toIso8601String()
          },
          conflictAlgorithm: ConflictAlgorithm.replace);
    }
    for (final c in currencies) {
      final code = LocalMasterCatalog.currencyCodes[c['name']];
      if (code != null) await ensure(db, code);
    }
  }
}
