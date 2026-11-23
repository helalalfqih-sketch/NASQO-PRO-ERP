import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

Map<String, dynamic> request(String action, {Map<String, dynamic>? payload}) => {
  'protocolVersion': '1.0.0',
  'kind': 'request',
  'requestId': 'test-1',
  'action': action,
  'payload': payload ?? <String, dynamic>{},
};

Map<String, dynamic> emptySnapshot() => {
  'workspaceId': 'local-erp-workspace',
  'workspace': null,
  'currencies': <dynamic>[],
  'accountGroups': <dynamic>[],
  'accounts': <dynamic>[],
  'cashboxes': <dynamic>[],
  'ledger': <dynamic>[],
  'warehouses': <dynamic>[],
  'inventory': <dynamic>[],
  'capabilities': {'offlineReady': true, 'readOnlyFinancial': true},
};

void main() {
  test('returns valid local snapshot without calling any network service', () async {
    var reads = 0;
    final endpoint = HybridReadOnlyProtocol(readSnapshot: () async {
      reads++;
      return emptySnapshot();
    });
    final response = jsonDecode(await endpoint.handle(jsonEncode(request('getSnapshot'))))
        as Map<String, dynamic>;
    expect(response['ok'], isTrue);
    expect(response['requestId'], 'test-1');
    expect((response['data'] as Map<String, dynamic>)['ledger'], isEmpty);
    expect(reads, 1);
  });

  test('rejects financial writes and never invokes the database callback', () async {
    var reads = 0;
    final endpoint = HybridReadOnlyProtocol(readSnapshot: () async {
      reads++;
      return emptySnapshot();
    });
    final response = jsonDecode(await endpoint.handle(
      jsonEncode(request('createLedgerEntry', payload: {'sql': 'DROP TABLE accounts'})),
    )) as Map<String, dynamic>;
    expect(response['ok'], isFalse);
    expect((response['error'] as Map<String, dynamic>)['code'], 'UNAUTHORIZED_ACTION');
    expect(reads, 0);
  });

  test('persists only whitelisted non-financial UI preferences', () async {
    var saved = <String, dynamic>{};
    final endpoint = HybridReadOnlyProtocol(
      readSnapshot: () async => emptySnapshot(),
      saveUiPreferences: (prefs) async {
        saved = prefs;
      },
    );
    final response = jsonDecode(await endpoint.handle(jsonEncode(request(
      'saveUiPreferences',
      payload: {
        'preferences': {'themeMode': 'dark', 'hapticsEnabled': false},
      },
    )))) as Map<String, dynamic>;
    expect(response['ok'], isTrue);
    expect(saved, {'themeMode': 'dark', 'hapticsEnabled': false});
  });

  test('rejects unknown preference fields and never calls persistence', () async {
    var called = false;
    final endpoint = HybridReadOnlyProtocol(
      readSnapshot: () async => emptySnapshot(),
      saveUiPreferences: (_) async { called = true; },
    );
    final response = jsonDecode(await endpoint.handle(jsonEncode(request(
      'saveUiPreferences',
      payload: {
        'preferences': {'sql': 'DROP TABLE ledger_entries'},
      },
    )))) as Map<String, dynamic>;
    expect(response['ok'], isFalse);
    expect((response['error'] as Map<String, dynamic>)['code'], 'VALIDATION_ERROR');
    expect(called, isFalse);
  });

  test('rejects malformed JSON and oversized requests', () async {
    final endpoint = HybridReadOnlyProtocol(readSnapshot: () async => emptySnapshot());
    final malformed = jsonDecode(await endpoint.handle('{bad')) as Map<String, dynamic>;
    expect(malformed['ok'], isFalse);
    final oversized = jsonDecode(
      await endpoint.handle('x' * (HybridReadOnlyProtocol.maxRequestLength + 1)),
    ) as Map<String, dynamic>;
    expect(oversized['ok'], isFalse);
  });

  test('rejects missing arrays instead of claiming success', () async {
    final endpoint = HybridReadOnlyProtocol(readSnapshot: () async => {
      'workspaceId': 'local-erp-workspace',
      'accounts': <dynamic>[],
    });
    final response = jsonDecode(await endpoint.handle(jsonEncode(request('getSnapshot'))))
        as Map<String, dynamic>;
    expect(response['ok'], isFalse);
  });
}
