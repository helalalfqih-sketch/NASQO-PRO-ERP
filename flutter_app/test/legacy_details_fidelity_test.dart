import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

BackupCandidate oldImport(BackupCandidate source) {
  final meta = Map<String, dynamic>.from(source.meta)..remove('legacyDetailsVersion');
  final data = Map<String, List<Map<String, dynamic>>>.from(source.collections);
  data['ledger'] = source.collections['ledger']!.map((entry) {
    final row = Map<String, dynamic>.from(entry)
      ..remove('sourceReference')..remove('headerDiscount');
    final text = (row['details'] as String).trim();
    row['details'] = text.length > 600 ? text.substring(0, 600) : text;
    return row;
  }).toList();
  return BackupCandidate(source.name, source.format, source.bytes, source.sha,
      data, meta, source.nativeTables);
}

void main() {
  test('full source metadata survives fresh inspection, old review/live imports, edits and native roundtrip without posting', () async {
    sqfliteFfiInit(); databaseFactory = databaseFactoryFfi;
    final dir = await Directory.systemTemp.createTemp('nasqo-details-fixture-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local = LocalDatabase.instance, db = await local.database;
    final restore = LocalBackupRestore(local);
    final note = '  بداية البيان\n${List.filled(120, 'تفصيل اصطناعي ').join()}نهاية البيان — [يجب الاحتفاظ بها]  ';
    try {
      final file = File('${dir.path}/fixture.back');
      final source = await databaseFactoryFfi.openDatabase(file.path);
      await source.execute('CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,type INTEGER)');
      await source.execute('CREATE TABLE stores(id INTEGER PRIMARY KEY,name TEXT)');
      await source.execute('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,price REAL,price2 REAL,cur INTEGER)');
      await source.execute('CREATE TABLE currencies(id INTEGER PRIMARY KEY,name TEXT)');
      await source.execute('CREATE TABLE input_move(id INTEGER PRIMARY KEY,per_id INTEGER,dain REAL,madin REAL,cur INTEGER,bill_type INTEGER,year INTEGER,month INTEGER,day INTEGER,details TEXT,ref TEXT,discount_amount REAL)');
      await source.execute('CREATE TABLE bill_details(id INTEGER PRIMARY KEY,bill_id INTEGER,prod_id INTEGER,store_id INTEGER,price REAL,amount REAL,total REAL,discount REAL,bonus REAL,exdate TEXT,details TEXT)');
      await source.insert('customers', {'id':1,'name':'Synthetic account','type':1});
      await source.insert('stores', {'id':1,'name':'Synthetic warehouse'});
      await source.insert('products', {'id':1,'name':'Synthetic item','unit':'حبة','price':100,'price2':60,'cur':1});
      await source.insert('currencies', {'id':1,'name':'ريال'});
      await source.insert('input_move', {'id':1,'per_id':1,'dain':100,'madin':0,'cur':1,'bill_type':2,'year':2026,'month':11,'day':8,'details':note,'ref':'REF-SYNTHETIC-1','discount_amount':7});
      await source.insert('bill_details', {'id':1,'bill_id':1,'prod_id':1,'store_id':1,'price':100,'amount':1,'total':100,'discount':3,'bonus':2,'exdate':'2027-06-30','details':'Line evidence'});
      await source.close();
      final fresh = await restore.inspect(file, 'fixture.back');
      final freshEntry = fresh.collections['ledger']!.single;
      expect(freshEntry['details'], note);
      expect(freshEntry['sourceReference'], 'REF-SYNTHETIC-1');
      expect(freshEntry['headerDiscount'], 7);
      expect(freshEntry['amount'], 100); // Source discount is descriptive, not replayed.

      final old = oldImport(fresh);
      await restore.openReview(old);
      final review = await HybridLocalSnapshotAdapter.readFromDevice();
      expect((review['ledger'] as List).single['details'], note);
      expect((await LocalBackupRestore.reviewInvoice(db, 'legacy-ent-1'))!['entry']['sourceReference'], 'REF-SYNTHETIC-1');
      await LegacyOperationalRestore(local).activate(old);
      final beforeRead = await restore.exportNative();
      final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
      final entry = (snapshot['ledger'] as List).single;
      expect(entry['details'], note);
      expect(entry['sourceReference'], 'REF-SYNTHETIC-1');
      expect(entry['headerDiscount'], 7);
      final invoice = (await LegacyOperationalRestore.invoice(db, 'legacy-ent-1'))!;
      expect(invoice['entry']['details'], note);
      final line = (invoice['lines'] as List).single;
      expect(line['discount'], 3); expect(line['bonus'], 2);
      expect(line['expiryDate'], '2027-06-30'); expect(line['total'], 100);
      expect(await restore.exportNative(), orderedEquals(beforeRead));
      for (final table in ['journal_entries','journal_lines','stock_movements','sync_outbox']) {
        expect(await db.query(table), isEmpty, reason: 'No financial replay: $table');
      }
      expect(await LegacyOperationalRestore.original(db), orderedEquals(fresh.bytes));

      await db.update('ledger_entries', {'details':'A later local edit'}, where:'id = ?', whereArgs:['legacy-ent-1']);
      expect((await LegacyOperationalRestore.invoice(db,'legacy-ent-1'))!['entry']['details'],'A later local edit');
      final saved = jsonDecode((await db.query('legacy_operational_rows',where:'collection = ? AND record_id = ?',whereArgs:['ledger','legacy-ent-1'])).single['row_json'] as String) as Map<String,dynamic>;
      // Even matching live/archive text is not replaceable unless it is the
      // deterministic old 600-character source preview.
      saved['details'] = 'A later local edit';
      saved['sourceReference'] = 'A later reference'; saved['headerDiscount'] = 9;
      await db.update('legacy_operational_rows', {'row_json':jsonEncode(saved)},where:'collection = ? AND record_id = ?',whereArgs:['ledger','legacy-ent-1']);
      final edited = (await LegacyOperationalRestore.invoice(db, 'legacy-ent-1'))!['entry'];
      expect(edited['details'], 'A later local edit');
      expect(edited['sourceReference'], 'A later reference'); expect(edited['headerDiscount'],9);
      final exported = await restore.exportNative();
      final nativeFile = await File('${dir.path}/native.json').writeAsBytes(exported);
      await restore.restoreNative(await restore.inspect(nativeFile,'native.json'),replacementSha:sha256.convert(exported).toString());
      expect(await restore.exportNative(),orderedEquals(exported));
      expect((await LegacyOperationalRestore.invoice(db,'legacy-ent-1'))!['entry']['details'],'A later local edit');

      // A different verified source must never reuse the cached first source.
      final secondFile = await file.copy('${dir.path}/second.back');
      final second = await databaseFactoryFfi.openDatabase(secondFile.path);
      await second.update('input_move',{'details':'Second source note','ref':'SECOND-REF'});
      await second.close();
      final secondCandidate = oldImport(await restore.inspect(secondFile,'second.back'));
      await LegacyOperationalRestore(local).activate(secondCandidate,replacementSha:sha256.convert(await restore.exportNative()).toString());
      final replaced = (await LegacyOperationalRestore.invoice(db,'legacy-ent-1'))!['entry'];
      expect(replaced['details'],'Second source note'); expect(replaced['sourceReference'],'SECOND-REF');
      await LegacyOperationalRestore(local).activate(fresh,replacementSha:sha256.convert(await restore.exportNative()).toString());
      final freshView=(await HybridLocalSnapshotAdapter.readFromDevice())['ledger'] as List;
      expect(freshView.single['details'],note);expect(freshView.single['sourceReference'],'REF-SYNTHETIC-1');
      expect(freshView.single['headerDiscount'],7);expect(freshView.single['amount'],100);
    } finally {
      await db.close(); await dir.delete(recursive:true);
    }
  });
}
