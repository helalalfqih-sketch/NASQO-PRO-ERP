import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';
import 'package:nasqo_pro_erp/models/erp_models.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';

void main() {
  test('fresh SQLite database maps to empty financial arrays', () {
    final result = HybridLocalSnapshotAdapter.fromSnapshot(const LocalDbSnapshot(
      accounts: [],
      ledger: [],
      warehouses: [],
      inventory: [],
    ));
    expect(result['workspaceId'], 'local-erp-workspace');
    for (final key in ['accounts', 'ledger', 'warehouses', 'inventory',
        'accountGroups', 'cashboxes']) {
      expect(result[key], isEmpty, reason: 'Expected empty $key');
    }
    expect((result['capabilities'] as Map)['offlineReady'], isTrue);
    expect((result['capabilities'] as Map)['readOnlyFinancial'], isTrue);
  });

  test('converts existing local accounts without changing financial values', () {
    final result = HybridLocalSnapshotAdapter.fromSnapshot(const LocalDbSnapshot(
      accounts: [
        AccountRecord(id: 'a1', name: 'عميل موجود',
            category: AccountCategory.clients,
            openingBalance: 200, codeNumber: 13),
      ],
      ledger: [],
      warehouses: [],
      inventory: [],
      companyName: 'منشأة محلية',
    ));
    final accounts = result['accounts'] as List<dynamic>;
    expect(accounts.length, 1);
    final account = accounts.first as Map<String, dynamic>;
    expect(account['name'], 'عميل موجود');
    expect(account['openingBalance'], 200);
    expect(account['codeNumber'], 13);
    expect((result['workspace'] as Map)['companyName'], 'منشأة محلية');
    expect(result['ledger'], isEmpty);
  });
}
