import '../models/erp_models.dart';
import '../services/local_database.dart';

/// Adapts the existing on-device SQLite schema to the React Hybrid snapshot.
/// No network calls, no automatic import, no fabricated customer/invoice rows.
class HybridLocalSnapshotAdapter {
  static const String workspaceId = 'local-erp-workspace';

  static Future<Map<String, dynamic>> readFromDevice() async {
    final snapshot = await LocalDatabase.instance.loadSnapshot();
    return fromSnapshot(snapshot);
  }

  static Map<String, dynamic> fromSnapshot(
    LocalDbSnapshot snapshot, {
    CurrencyCode defaultCurrency = CurrencyCode.sar,
  }) {
    final currencyLabel = defaultCurrency.label;
    final companyName = snapshot.companyName?.trim().isNotEmpty == true
        ? snapshot.companyName!.trim()
        : 'نسقو برو ERP';

    return {
      'workspaceId': workspaceId,
      'userEmail': 'offline@nasqo.local',
      'workspace': {
        'id': workspaceId,
        'ownerId': workspaceId,
        'companyName': companyName,
        'defaultCurrency': currencyLabel,
        'whatsappProvider': 'nasqo',
        'whatsappInstantEnabled': false,
        'whatsappPhone': '',
      },
      'currencies': [
        {
          'id': 1,
          'code': defaultCurrency.name.toUpperCase(),
          'name': currencyLabel,
          'symbol': currencyLabel,
          'ratePrimary': 1,
          'rateSecondary': 1,
          'nameSecondary': '',
        },
      ],
      // This older local SQLite schema has no group/cashbox tables; do not
      // invent financial master records while building a compatibility view.
      'accountGroups': <Map<String, dynamic>>[],
      'cashboxes': <Map<String, dynamic>>[],
      'accounts': [
        for (var index = 0; index < snapshot.accounts.length; index++)
          _account(snapshot.accounts[index], index),
      ],
      'ledger': [
        for (final entry in snapshot.ledger) _ledger(entry),
      ],
      'warehouses': [
        for (var index = 0; index < snapshot.warehouses.length; index++)
          _warehouse(snapshot.warehouses[index], index),
      ],
      'inventory': [
        for (final item in snapshot.inventory) _item(item),
      ],
      'uiPreferences': {
        'themeMode': snapshot.isDarkMode == true ? 'dark' : 'light',
        ...snapshot.uiPreferences,
      },
      'capabilities': {
        'offlineReady': true,
        'printingSupported': false,
        'pdfExportSupported': false,
        'filePickerSupported': false,
        'googleDriveConfigured': false,
        'whatsappShareSupported': false,
        'readOnlyFinancial': true,
        'localAccountCreation': true,
        'localDocumentPosting': true,
      },
      'activeRoute': 'dashboard',
      'activeCurrency': currencyLabel,
      'snapshotVersion': 1,
    };
  }

  static Map<String, dynamic> _account(AccountRecord a, int index) => {
        'id': a.id,
        'ownerId': workspaceId,
        'name': a.name,
        'category': a.category.name,
        'phone': a.phone,
        'creditLimit': a.creditLimit,
        'currency': a.currency.label,
        'isCashAccount': a.isCashAccount,
        'accountImage': '1',
        'sortOrder': index,
        'settlement': false,
        'documentNumberRequired': false,
        'messageMethod': 'sms',
        'sendMode': 'never',
        'note': a.note,
        'openingBalance': a.openingBalance,
        'openingDirection': a.openingDirection.name,
        'codeNumber': a.codeNumber,
      };

  static Map<String, dynamic> _ledger(LedgerEntryRecord entry) => {
        'id': entry.id,
        'ownerId': workspaceId,
        'accountId': entry.accountId,
        'accountName': entry.accountName,
        'counterpartAccountId': entry.counterpartAccountId,
        'counterpartAccountName': entry.counterpartAccountName,
        'kind': _webKind(entry.kind),
        'typeLabel': entry.typeLabel,
        'payment': entry.payment.name,
        'direction': entry.direction.name,
        'amount': entry.amount,
        'currency': entry.currency.label,
        'exchangeRate': entry.exchangeRate,
        'details': entry.details,
        'documentNumber': entry.documentNumber,
        'warehouseId': entry.warehouseId,
        'warehouseName': entry.warehouseName,
        'invoiceContent': entry.invoiceContent,
        if (entry.postingStatus != null) 'postingStatus': entry.postingStatus,
        'entryNumber': entry.entryNumber,
        'deleted': entry.deleted,
        'entryDate': entry.entryDate,
        'expenseCategory': entry.expenseCategory,
        'createdAtMs': DateTime.tryParse(entry.entryDate)
                ?.millisecondsSinceEpoch ??
            0,
      };

  static String _webKind(LedgerKind kind) => switch (kind) {
        LedgerKind.returnEntry => 'return',
        LedgerKind.simpleEntry => 'simple-entry',
        _ => kind.name,
      };

  static Map<String, dynamic> _warehouse(WarehouseRecord w, int index) => {
        'id': w.id,
        'ownerId': workspaceId,
        'name': w.name,
        'details': w.details,
        'isDefault': w.isDefault,
        'codeNumber': index + 1,
      };

  static Map<String, dynamic> _item(InventoryItemRecord item) => {
        'id': item.id,
        'ownerId': workspaceId,
        'name': item.name,
        'unit': item.unit,
        'quantity': item.quantity,
        'avgCost': item.avgCost,
        'warehouseId': item.warehouseId,
        'minThreshold': item.minThreshold,
        'sku': item.sku,
      };
}
