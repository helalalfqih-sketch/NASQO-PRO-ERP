import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_account_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_commands.dart';
import 'package:nasqo_pro_erp/services/local_document_lifecycle.dart';
import 'package:nasqo_pro_erp/services/local_invoice_roles.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/free_invoice_lines.dart';

void main() {
  test('free lines: cash/credit sale/purchase, retry, disk read and backup preserve lines without stock', () async {
    sqfliteFfiInit(); databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo_free_synthetic_');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance, db = await LocalDatabase.instance.database;
    const w = 'local-erp-workspace';
    final accounts = LocalAccountCommands(local), docs = LocalDocumentCommands(local);
    final lifecycle = LocalDocumentLifecycle(local), roles = LocalInvoiceRoles(local);
    final backup = LocalBackupRestore(local);
    final lines = [
      {'itemName':'بند اصطناعي أ', 'unit':'حبة', 'quantity':1.5, 'price':10, 'total':15},
      {'itemName':'بند اصطناعي ب', 'unit':'حبة', 'quantity':2, 'price':2.25, 'total':4.5},
    ];
    Map<String,dynamic> invoice(String id, int number, String payment, String direction) => {
      'id':id, 'accountId':'account_party', 'kind':'invoice', 'invoiceContent':'free',
      'payment':payment, 'direction':direction, 'currency':'ريال', 'amount':19.5,
      'entryNumber':number, 'entryDate':'2026-11-25', 'lines':lines,
    };
    try {
      for (final id in ['party', 'revenue', 'expense', 'cash']) {
        await accounts.save(w,id,{'id':id,'name':id,'category':'clients','currency':'ريال','isCashAccount':id=='cash'});
      }
      await roles.save('sar', {'revenue':'account_revenue','expense':'account_expense','cash':'account_cash'});
      await db.insert('warehouses', {'id':'wh','name':'Synthetic','details':'','isDefault':1});
      await db.insert('inventory_items', {'id':'stock','name':'Synthetic stock','unit':'حبة','quantity':35,'avgCost':10,'warehouseId':'wh','minThreshold':0,'sku':''});
      final stockBefore = await db.query('inventory_items');
      var number = 0;
      for (final payment in ['credit','cash']) {
        for (final direction in ['debit','credit']) {
          final id = '$payment-$direction'; number++;
          final input = await roles.resolve(invoice(id,number,payment,direction));
          expect(await docs.post(w,'op-$id',input),id);
          // Lost acknowledgement: exact retry must not duplicate posting.
          expect(await docs.post(w,'op-$id',input),id);
          final saved = await FreeInvoiceLines.read(db,id);
          expect(saved.map((l)=>l['itemName']),lines.map((l)=>l['itemName']));
          expect(saved.map((l)=>l['total']),[15,4.5]);
          expect(saved.every((l)=>l['lineKind']=='free'&&!l.containsKey('inventoryItemId')),isTrue);
          final legs = await db.query('journal_lines',where:'journal_id = ?',whereArgs:[id]);
          expect(legs,hasLength(payment=='cash'?4:2));
          expect(legs.fold<int>(0,(sum,l)=>sum+(l['debit_minor'] as int)-(l['credit_minor'] as int)),0);
          await expectLater(docs.post(w,'op-$id',{...input,'lines':[{...lines.first,'itemName':'changed'},lines.last]}),throwsStateError);
        }
      }
      expect(await db.query('ledger_entries'),hasLength(4));
      expect(await db.query('invoice_lines'),hasLength(8));
      expect((await db.query('invoice_lines')).every((l)=>l['item_id']==null),isTrue);
      final valid = await roles.resolve(invoice('bad',5,'credit','debit'));
      final stateBefore = await backup.exportNative();
      for (final changed in [
        {'amount':20},
        {'lines':[{...lines.first,'inventoryItemId':'stock'},lines.last]},
        {'lines':[{...lines.first,'warehouseId':'wh'},lines.last]},
        {'lines':[{...lines.first,'quantity':1.0001},lines.last]},
        {'lines':[{...lines.first,'quantity':0},lines.last]},
        {'lines':[{...lines.first,'price':-1},lines.last]},
        {'lines':[{...lines.first,'itemName':''},lines.last]},
        {'lines':[{...lines.first,'total':14},lines.last]},
        {'lines':[{...lines.first,'discount':1},lines.last]},
        {'lines':List.filled(151,lines.first)},
      ]) {
        await expectLater(docs.post(w,'bad-op',{...valid,...changed}),throwsArgumentError);
      }
      expect(await backup.exportNative(),orderedEquals(stateBefore));
      await docs.post(w,'old-free',{...valid,'id':'old-free','lines':[]});
      expect(await FreeInvoiceLines.read(db,'old-free'),isEmpty);
      final draft = {...invoice('quote',6,'credit','debit'),'kind':'quote'};
      await lifecycle.saveDraft(w,'quote-create',draft);
      expect((await LocalDocumentLifecycle.draft(db,'quote'))!['lines'],hasLength(2));
      await lifecycle.saveDraft(w,'quote-edit',{...draft,'amount':15,'lines':[lines.first]},editingId:'quote');
      expect((await LocalDocumentLifecycle.draft(db,'quote'))!['lines'],hasLength(1));
      await lifecycle.trash(w,'quote-trash','quote',deleted:true);
      await lifecycle.trash(w,'quote-delete','quote',permanent:true);
      expect(await LocalDocumentLifecycle.draft(db,'quote'),isNull);
      expect(await db.query('inventory_items'),stockBefore);
      for (final table in ['stock_movements','stock_posting_lines','stock_posting_documents']) {
        expect(await db.query(table),isEmpty);
      }
      final reopened = await databaseFactoryFfi.openDatabase(db.path,options:OpenDatabaseOptions(singleInstance:false,readOnly:true));
      expect(await FreeInvoiceLines.read(reopened,'cash-debit'),await FreeInvoiceLines.read(db,'cash-debit'));
      await reopened.close();
      final exported = await backup.exportNative();
      final file = await File('${dir.path}/synthetic.back').writeAsBytes(exported);
      final candidate = await backup.inspect(file,'synthetic.back');
      final lease = await backup.replacementBackup();
      await backup.restoreNative(candidate,replacementSha:sha256.convert(lease!).toString());
      expect(await backup.exportNative(),orderedEquals(exported));
      expect(await FreeInvoiceLines.read(db,'cash-debit'),hasLength(2));
      expect(await db.rawQuery('PRAGMA foreign_key_check'),isEmpty);
    } finally {
      await db.close(); await dir.delete(recursive:true);
    }
  });
}
