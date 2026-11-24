import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/models/erp_models.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/remote_account_applier.dart';
import 'package:nasqo_pro_erp/services/sqlite_remote_change_store.dart';
import 'package:nasqo_pro_erp/services/sync_engine.dart';

// In-memory protocol simulator, NOT a Firebase or Cloud Run integration.
class _Server implements SyncTransport {
  final operations = <Map<String, dynamic>>[];
  bool loseNextAck = true;

  @override
  Future<String> push(String workspaceId, String operationId,
      String operationType, Map<String, dynamic> payload) async {
    var found = operations.where((o) => o['workspace_id'] == workspaceId &&
        o['operation_id'] == operationId);
    if (found.isEmpty) {
      operations.add({
        'workspace_id': workspaceId, 'operation_id': operationId,
        'operation_type': operationType, 'payload': payload,
        'server_revision': '${operations.length + 1}',
      });
      found = operations.where((o) => o['workspace_id'] == workspaceId &&
          o['operation_id'] == operationId);
    }
    if (loseNextAck) {
      loseNextAck = false;
      throw const SocketException('Simulated lost response after commit');
    }
    return found.single['server_revision'] as String;
  }

  @override
  Future<SyncPage> pull(String workspaceId, String? cursor) async {
    final after = int.parse(cursor ?? '0');
    final page = operations.where((o) => o['workspace_id'] == workspaceId &&
        int.parse(o['server_revision'] as String) > after).take(100).toList();
    return SyncPage(page.isEmpty ? '$after' : page.last['server_revision'] as String, page);
  }
}

void main() {
  late Directory dir;
  late LocalDatabase local;
  late Database db;
  setUpAll(() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    dir = await Directory.systemTemp.createTemp('nasqo_sync_test_');
    await databaseFactory.setDatabasesPath(dir.path);
    local = LocalDatabase.instance;
    db = await local.database;
  });
  tearDownAll(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  test('lost acknowledgement is retried, remote echo deduplicated, failed page rolled back', () async {
    const workspace = 'test-recovery';
    await local.createAccountAtomic(workspace, 'op-local', const AccountRecord(
      id:'local-account', name:'Local account', category:AccountCategory.clients));
    final server = _Server();
    final remote = SqliteRemoteChangeStore(local, applyRemoteAccount);
    final engine = SyncEngine(local, server, remote);

    await expectLater(engine.synchronize(workspace), throwsA(isA<SocketException>()));
    expect(server.operations, hasLength(1));
    expect(await local.pendingOperations(workspace), hasLength(1));
    expect(await remote.cursor(workspace), isNull);

    final payload = Map<String,dynamic>.from(server.operations.first['payload'] as Map);
    await server.push(workspace, 'op-remote', 'account.create',
        {...payload, 'id':'remote-account','name':'Remote account','codeNumber':2});

    await engine.synchronize(workspace);
    expect(server.operations, hasLength(2));
    expect(await local.pendingOperations(workspace), isEmpty);
    expect(await remote.cursor(workspace), '2');
    expect(await db.query('accounts', where:'id IN (?,?)',
        whereArgs:['local-account','remote-account']), hasLength(2));

    await engine.synchronize(workspace);
    expect(await remote.cursor(workspace), '2');
    expect(await db.query('sync_inbox', where:'workspace_id = ?',
        whereArgs:[workspace]), hasLength(2));

    await server.push(workspace, 'op-page-valid', 'account.create',
        {...payload, 'id':'must-rollback','name':'Rollback','codeNumber':3});
    await server.push(workspace, 'op-page-invalid', 'unsupported', {});
    await expectLater(engine.synchronize(workspace), throwsStateError);
    expect(await remote.cursor(workspace), '2');
    expect(await db.query('accounts', where:'id = ?',whereArgs:['must-rollback']), isEmpty);
    expect(await db.query('sync_inbox', where:'workspace_id = ?',
        whereArgs:[workspace]), hasLength(2));
  });

  test('a synchronization cycle drains more than one server page',()async{
    const workspace='test-pages';
    final server=_Server()..loseNextAck=false;
    final remote=SqliteRemoteChangeStore(local,applyRemoteAccount);
    for(var i=1;i<=105;i++){
      await server.push(workspace,'paged-op-$i','account.create',{
        'id':'paged-account-$i','name':'Paged account $i','category':'clients','phone':'',
        'currency':'sar','note':'','openingDirection':'credit','creditLimit':0,
        'openingBalance':0,'isCashAccount':0,'codeNumber':1000+i,
      });
    }
    await SyncEngine(local,server,remote).synchronize(workspace);
    expect(await remote.cursor(workspace),'105');
    expect(await db.query('accounts',where:"id LIKE 'paged-account-%'"),hasLength(105));
  });

  test('local sale replay does not reduce stock twice; insufficient second line rolls back all effects', () async {
    const workspace = 'test-sale';
    await local.createAccountAtomic(workspace, 'sale-account-op', const AccountRecord(
      id:'sale-customer',name:'Customer',category:AccountCategory.clients));
    await db.insert('warehouses', {'id':'test-warehouse','name':'Warehouse',
      'details':'','isDefault':0});
    await db.insert('inventory_items', {'id':'stock-a','name':'Item A','unit':'piece',
      'quantity':10,'avgCost':2,'warehouseId':'test-warehouse','minThreshold':0,'sku':''});
    LedgerEntryRecord invoice(String id, int number) => LedgerEntryRecord(
      id:id,accountId:'sale-customer',accountName:'Customer',kind:LedgerKind.invoice,
      typeLabel:'Sale',payment:PaymentMethod.credit,direction:EntryDirection.debit,
      amount:6,warehouseId:'test-warehouse',entryNumber:number,entryDate:'2026-01-01');
    final lines = <Map<String,dynamic>>[
      {'item_id':'stock-a','quantity':2,'unit_price_minor':300}
    ];
    Future<num> quantity() async => (await db.query('inventory_items',
        where:'id = ?',whereArgs:['stock-a'])).single['quantity'] as num;
    await local.createSaleAtomic(workspaceId:workspace,operationId:'sale-op',
        entry:invoice('sale-1',1),lines:lines);
    expect(await quantity(),8);
    await local.createSaleAtomic(workspaceId:workspace,operationId:'sale-op',
        entry:invoice('sale-1',1),lines:lines);
    expect(await quantity(),8);
    final pendingBefore = await local.pendingOperations(workspace);

    await expectLater(local.createSaleAtomic(workspaceId:workspace,
      operationId:'sale-fail',entry:invoice('sale-2',2),lines:[
        ...lines, {'item_id':'stock-a','quantity':100,'unit_price_minor':300}
      ]),throwsStateError);
    expect(await quantity(),8);
    expect(await db.query('ledger_entries',where:'id = ?',whereArgs:['sale-2']),isEmpty);
    expect(await db.query('invoice_lines',where:'ledger_id = ?',whereArgs:['sale-2']),isEmpty);
    expect(await db.query('stock_movements',where:'operation_id = ?',whereArgs:['sale-fail']),isEmpty);
    expect(await local.pendingOperations(workspace),pendingBefore);
    // The existing sale command does not yet post double-entry journal lines.
    // Passing this test is not financial certification.
  });
}
