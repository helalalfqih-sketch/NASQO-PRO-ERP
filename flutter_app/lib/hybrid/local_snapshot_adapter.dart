import 'dart:convert';
import '../models/erp_models.dart';
import '../services/local_database.dart';
import '../services/local_backup_restore.dart';

/// Adapts the existing on-device SQLite schema to the React Hybrid snapshot.
/// No network calls, no automatic import, no fabricated customer/invoice rows.
class HybridLocalSnapshotAdapter {
  static const String workspaceId = 'local-erp-workspace';

  static Future<Map<String, dynamic>> readFromDevice() async {
    final local=LocalDatabase.instance;
    final db=await local.database;
    return db.transaction((txn) async {
      final review=await LocalBackupRestore.reviewSnapshot(txn);
      if(review!=null)return review;
      final data=fromSnapshot(await local.loadSnapshot(executor:txn));
      final ledger=(data['ledger'] as List).cast<Map<String,dynamic>>();
      final byId={for(final entry in ledger) entry['id']:entry};
      for(final row in await txn.query('journal_lines',orderBy:'rowid')){
        final entry=byId[row['journal_id']];
        if(entry==null) continue;
        final lines=entry.putIfAbsent('journalLines',()=> <Map<String,dynamic>>[]) as List;
        lines.add({'accountId':row['account_id'],'debitMinor':row['debit_minor'],'creditMinor':row['credit_minor']});
      }
      final originals=<String,String>{};
      final returned=<String,Map<String,int>>{};
      final originalLines=<String,List<Map<String,dynamic>>>{};
      for(final row in await txn.query('stock_posting_documents')){
        final entry=byId[row['id']];
        if(entry==null) continue;
        final info=jsonDecode(row['document_json'] as String) as Map<String,dynamic>;
        entry['stockPosting']=true;
        entry['taxAmount']=(info['taxMinor'] as int)/100;
        entry['netBeforeTax']=(info['netMinor'] as int)/100;
        entry['stockSale']=info['sale']==true;
        final original=row['original_id']??row['return_original_id'];
        if(original is String){
          entry['originalInvoiceId']=original;
          if(row['original_id']!=null) originals[original]=row['id'] as String;
        }
      }
      for(final item in originals.entries){
        final original=byId[item.key];
        if(original!=null) original['returnedById']=item.value;
      }
      for(final row in await txn.query('stock_posting_lines')){
        final entry=byId[row['document_id']];
        if(entry==null) continue;
        final line=jsonDecode(row['line_json'] as String) as Map<String,dynamic>;
        entry['stockCostMinor']=((entry['stockCostMinor'] as int?)??0)+(line['cost_minor'] as int);
        final original=entry['originalInvoiceId'];
        final item=row['item_id'] as String;
        final q=(row['quantity'] as num).toInt();
        if(original is String){
          final perItem=returned.putIfAbsent(original,()=> <String,int>{});
          perItem[item]=(perItem[item]??0)+q;
        }else{
          originalLines.putIfAbsent(entry['id'] as String,()=> <Map<String,dynamic>>[]).add(line);
        }
      }
      for(final item in originalLines.entries){
        final entry=byId[item.key]!;
        final lines=<Map<String,dynamic>>[];
        for(final line in item.value){
          final id=line['item_id'] as String;
          final factor=(line['unit_factor'] as int?)??1;
          final original=line['quantity'] as int;
          final used=originals.containsKey(item.key)?original:(returned[item.key]?[id]??0);
          final remaining=(original-used)~/factor;
          if(remaining>0) lines.add({'itemId':id,'itemName':line['itemName'],'unit':line['unit'],'quantity':remaining});
        }
        entry['returnableLines']=lines;
        if(lines.isEmpty) entry['returnedById']=originals[item.key]??'complete';
      }
      final inventory=(data['inventory'] as List).cast<Map<String,dynamic>>();
      final items={for(final row in inventory)row['id']:row};
      for(final row in await txn.query('inventory_unit_settings')){
        final item=items[row['item_id']];
        if(item!=null) item.addAll(jsonDecode(row['settings_json'] as String) as Map<String,dynamic>);
      }
      return data;
    });
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
        'filePickerSupported': true,
        'googleDriveConfigured': false,
        'whatsappShareSupported': false,
        'readOnlyFinancial': true,
        'localAccountCreation': true,
        'localDocumentPosting': true,
        'localStockPosting': true,
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
