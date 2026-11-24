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
  test('native print and share commands reject HTML, arbitrary URLs and foreign workspace',()async{
    var prints=0,shares=0;
    final endpoint=HybridReadOnlyProtocol(readSnapshot:()async=>emptySnapshot(),
      printCurrentPage:(title)async{prints++;return true;},
      shareText:(p)async{shares++;return {'opened':true,'targeted':false};});
    Future<Map<String,dynamic>> invoke(String action,Map<String,dynamic> payload)async=>
      jsonDecode(await endpoint.handle(jsonEncode(request(action,payload:payload)))) as Map<String,dynamic>;
    expect((await invoke('printDocument',{'title':'Report','kind':'report','htmlSnapshot':'<script>'}))['ok'],false);
    expect((await invoke('shareText',{'workspaceId':'other','title':'Report','text':'x'}))['ok'],false);
    expect((await invoke('shareText',{'workspaceId':'local-erp-workspace','title':'Report','text':'x','phone':'https://example.test'}))['ok'],false);
    expect(prints,0);expect(shares,0);
    expect((await invoke('printDocument',{'title':'Report','kind':'report'}))['data']['opened'],true);
    expect((await invoke('shareText',{'workspaceId':'local-erp-workspace','title':'Report','text':'Synthetic'}))['data']['opened'],true);
    expect(prints,1);expect(shares,1);
  });

  test('stock reconciliation opens only scoped local product and warehouse references',()async{
    String? warehouse,product;
    var calls=0;
    final endpoint=HybridReadOnlyProtocol(readSnapshot:()async=>emptySnapshot(),
      openStockReconciliation:(w,p)async{warehouse=w;product=p;calls++;return true;});
    Future<Map<String,dynamic>> invoke(Map<String,dynamic> payload)async=>
      jsonDecode(await endpoint.handle(jsonEncode(request('openStockReconciliation',payload:payload)))) as Map<String,dynamic>;
    expect((await invoke({'workspaceId':'other'}))['ok'],false);
    expect((await invoke({'workspaceId':'local-erp-workspace','productId':7}))['ok'],false);
    expect(calls,0);
    final result=await invoke({'workspaceId':'local-erp-workspace','warehouseId':'legacy-wh-1','productId':'legacy-prod-2'});
    expect(result['data']['changed'],true);
    expect(warehouse,'legacy-wh-1');expect(product,'legacy-prod-2');
  });

  test('native restore action accepts only workspace, no SQL or base64',()async{
    var picked=0,settings=0;
    final endpoint=HybridReadOnlyProtocol(readSnapshot:()async=>emptySnapshot(),
      pickBackup:()async{picked++;return {'nativeRestored':true,'restoreMode':'operational'};},
      openInvoiceRoles:()async{settings++;});
    Future<Map<String,dynamic>> invoke(String action,Map<String,dynamic> payload)async=>
      jsonDecode(await endpoint.handle(jsonEncode(request(action,payload:payload)))) as Map<String,dynamic>;
    expect((await invoke('restoreLocalBackup',{'workspaceId':'other'}))['ok'],false);
    expect((await invoke('restoreLocalBackup',{'workspaceId':'local-erp-workspace','base64Content':'x'}))['ok'],false);
    expect(picked,0);
    final response=await invoke('restoreLocalBackup',{'workspaceId':'local-erp-workspace'});
    expect(response['ok'],true);
    expect(response['data']['restoreMode'],'operational');
    expect(picked,1);
    expect((await invoke('openInvoiceRoles',{'workspaceId':'local-erp-workspace'}))['ok'],true);
    expect(settings,1);
  });

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
