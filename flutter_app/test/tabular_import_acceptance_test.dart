import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_stock_catalog.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/unassigned_catalog.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_read_only_protocol.dart';

void main() {
  test('native picker separates import bytes from restoration, including cancel and invalid purpose', () async {
    var restores = 0;
    final imports = <String>[];
    final protocol = HybridReadOnlyProtocol(readSnapshot: () async => {},
      pickBackup: () async { restores++; return {'nativeRestored': true}; },
      pickImportFile: (purpose) async { imports.add(purpose); return purpose == 'import-items' ? {'fileName': 'items.csv', 'base64Content': base64Encode(utf8.encode('اسم الصنف\nصنف'))} : null; });
    Future<Map<String,dynamic>> pick(String purpose) async => jsonDecode(await protocol.handle(jsonEncode({
      'protocolVersion':'1.0.0','kind':'request','requestId':'pick-$purpose','action':'pickFile','payload':{'purpose':purpose,'accept':['.csv']},
    }))) as Map<String,dynamic>;
    final item = await pick('import-items');
    expect(item['ok'], true); expect(item['data']['fileName'], 'items.csv');
    final cancel = await pick('import-accounts-csv');
    expect(cancel['ok'], true); expect(cancel['data']['cancelled'], true);
    expect((await pick('company-logo'))['ok'], false);
    expect(imports, ['import-items','import-accounts-csv']); expect(restores, 0);
    expect((await pick('restore-backup'))['ok'], true); expect(restores, 1);
  });

  test('real native SQLite catalog/account batches are atomic, preserve existing stock, and survive native restoration', () async {
    sqfliteFfiInit(); databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo-tabular-acceptance-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance, db = await local.database;
    final stock = LocalStockCatalog(local), accounts = LocalAccountCommands(local), backup = LocalBackupRestore(local);
    const w = 'local-erp-workspace';
    final item = <String,dynamic>{'name':'صنف اصطناعي','unit':'حبة','sku':'000123','catalogReferenceCost':17.5,'sellingPrice':25,'currencyCode':'ريال','isActive':false,'unit2':'علبة','count2':10,'defaultUnit':1,'expiryDate':'2027-01-20'};
    final account = <String,dynamic>{'name':'شركة، فرع\nالمدينة','phone':'001234','category':'clients','currency':'ريال','openingBalance':0,'openingDirection':'credit'};
    try {
      final imported = await stock.importItems(w,'items-csv',[item],'insert-only');
      expect(imported['inserted'],1);
      expect(await stock.importItems(w,'items-csv',[item],'insert-only'),imported);
      final live = (await db.query('inventory_items')).single;
      expect(live['quantity'],0); expect(live['avgCost'],0); expect(live['sku'],'000123');
      final settings = jsonDecode((await db.query('inventory_unit_settings')).single['settings_json'] as String);
      expect(settings['catalogReferenceCost'],17.5);expect(settings['count2'],10);expect(settings['isActive'],false);
      final snap = await HybridLocalSnapshotAdapter.readFromDevice();
      expect((snap['inventory'] as List).single['catalogReferenceCost'],17.5);
      expect((await accounts.importCards(w,'accounts-csv',[account]))['inserted'],1);
      expect((await db.query('accounts')).single['phone'],'001234');
      expect((await db.query('accounts')).single['openingBalance'],0);
      // Existing approved stock must not be touched by importing its card again.
      final wh = await stock.createWarehouse(w,'stock-warehouse',{'name':'Synthetic warehouse'});
      await db.transaction((t) async {
        await UnassignedCatalog.bindFirstPurchase(t,live['id'] as String,wh);
        await t.update('inventory_items',{'quantity':5,'avgCost':11},where:'id = ?',whereArgs:[live['id']]);
      });
      final preserved = await db.query('inventory_items');
      expect((await stock.importItems(w,'items-repeat',[{...item,'catalogReferenceCost':99}],'insert-only'))['skipped'],1);
      expect(await db.query('inventory_items'),preserved);
      expect((await accounts.importCards(w,'accounts-repeat',[account]))['skipped'],1);
      final before = await backup.exportNative();
      await expectLater(stock.importItems(w,'items-invalid',[{...item,'name':'Valid new','sku':'001'},{...item,'name':'Invalid','sku':'002','unit2':'box','count2':0}],'insert-only'),throwsArgumentError);
      expect(await backup.exportNative(),orderedEquals(before));
      await expectLater(accounts.importCards(w,'accounts-invalid',[{...account,'name':'Valid new'},{...account,'name':'Invalid','openingBalance':20}]),throwsArgumentError);
      expect(await backup.exportNative(),orderedEquals(before));
      expect(await db.query('stock_movements'),isEmpty);expect(await db.query('ledger_entries'),isEmpty);
      final file = await File('${dir.path}/synthetic.back').writeAsBytes(before);
      final candidate = await backup.inspect(file,'synthetic.back');
      for(var n=0;n<2;n++) {
        final safety = (await backup.replacementBackup())!;
        await backup.restoreNative(candidate,replacementSha:sha256.convert(safety).toString());
        expect(await backup.exportNative(),orderedEquals(before));
      }
      expect((await db.rawQuery('PRAGMA integrity_check')).single.values.single,'ok');
      expect(await db.rawQuery('PRAGMA foreign_key_check'),isEmpty);
      // The app's own inventory report can contain more than 2000 locations.
      // A large import is still one transaction and never changes live stock.
      final large=List.generate(3000,(i)=><String,dynamic>{...item,'name':'Large card $i','sku':'000large$i'});
      expect((await stock.importItems(w,'large-cards',large,'insert-only'))['inserted'],3000);
      Map<String,dynamic> dataTables(List<int> bytes) {
        final root=jsonDecode(utf8.decode(bytes));
        final tables=jsonDecode(root['payload'] as String)['tables'] as Map<String,dynamic>;
        // New import attempts have their own audit/idempotency records.
        tables.remove('sync_outbox');tables.remove('bridge_idempotency_keys');
        return tables;
      }
      final beforeRepeat=dataTables(await backup.exportNative());
      expect((await stock.importItems(w,'large-cards-repeat',large,'insert-only'))['skipped'],3000);
      expect(dataTables(await backup.exportNative()),beforeRepeat);
      final beforeInvalid=await backup.exportNative();
      expect((await db.query('inventory_items',where:'id = ?',whereArgs:[live['id']])).single,preserved.single);
      final invalidLarge=List.generate(3000,(i)=><String,dynamic>{...item,'name':'Rollback card $i','sku':'rollback$i',if(i==2999)'count2':0});
      await expectLater(stock.importItems(w,'large-final-invalid',invalidLarge,'insert-only'),throwsArgumentError);
      expect(await backup.exportNative(),orderedEquals(beforeInvalid));
      final largeAccounts=List.generate(2501,(i)=><String,dynamic>{...account,'name':'Large account $i','phone':'000$i'});
      expect((await accounts.importCards(w,'large-accounts',largeAccounts))['inserted'],2501);
      final accountSnapshot=dataTables(await backup.exportNative());
      expect((await accounts.importCards(w,'large-accounts-repeat',largeAccounts))['skipped'],2501);
      expect(dataTables(await backup.exportNative()),accountSnapshot);
      expect(await db.query('stock_movements'),isEmpty);expect(await db.query('ledger_entries'),isEmpty);
    } finally { await db.close(); await dir.delete(recursive:true); }
  });
}
