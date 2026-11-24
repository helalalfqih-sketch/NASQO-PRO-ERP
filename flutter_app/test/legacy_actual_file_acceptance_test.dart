import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_opening.dart';
import 'package:nasqo_pro_erp/services/legacy_stock_batch.dart';

/// Optional acceptance test for a privately supplied SQLite backup. Never
/// commit the source or print its customer, account, price or balance data.
void main(){
  final path=Platform.environment['NASQO_PRIVATE_LEGACY_BACKUP'];
  test('real private legacy backup restores record identities and exact source without replay',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-private-acceptance-');
    await databaseFactory.setDatabasesPath(dir.path);
    final local=LocalDatabase.instance,db=await local.database;
    try{
      final file=await File(path!).copy('${dir.path}/private-source.back');
      final source=await databaseFactoryFfi.openDatabase(file.path,options:OpenDatabaseOptions(readOnly:true,singleInstance:false));
      final originalCounts=<String,int>{};
      final rawLedger=<String,Map<String,Object?>>{};
      try{
        for(final table in ['customers','products','stores','input_move','bill_details','bill_details2']){
          final rows=await source.rawQuery('SELECT COUNT(*) AS n FROM "$table"');
          originalCounts[table]=rows.single['n'] as int;
        }
        for(final row in await source.query('input_move',columns:['id','dain','madin'])){
          rawLedger['legacy-ent-${row['id']}']=row;
        }
      }finally{await source.close();}
      final candidate=await LocalBackupRestore(local).inspect(file,'private-source.back');
      expect(candidate.legacy,true);
      await LegacyOperationalRestore(local).activate(candidate);
      for(final e in {'accounts':'customers','inventory_items':'products','warehouses':'stores','ledger_entries':'input_move'}.entries){
        final n=(await db.rawQuery('SELECT COUNT(*) AS n FROM "${e.key}"')).single['n'];
        expect(n,originalCounts[e.value]);
      }
      var mismatches=0,lineCount=0;
      final rows=await db.query('legacy_operational_rows',where:'collection = ?',whereArgs:['ledger']);
      for(final row in rows){
        final data=jsonDecode(row['row_json'] as String) as Map<String,dynamic>;
        final raw=rawLedger[data['id']];
        if(raw==null||LocalBackupRestore.numValue(raw['dain'])!=data['rawDain']||
          LocalBackupRestore.numValue(raw['madin'])!=data['rawMadin'])mismatches++;
        lineCount+=(data['lines'] as List).length;
      }
      expect(mismatches,0);
      expect(lineCount,originalCounts['bill_details']!+originalCounts['bill_details2']!);
      expect(await db.query('journal_entries'),isEmpty);
      expect(await db.query('sync_outbox'),isEmpty);
      final exact=await LegacyOperationalRestore.original(db);
      expect(exact!=null&&sha256.convert(exact).toString()==candidate.sha,true);
      final loaded=await LegacyStockOpening(local).load();
      final products=(loaded['products'] as List).cast<Map<String,dynamic>>();
      final warehouses=(loaded['warehouses'] as List).cast<Map<String,dynamic>>();
      var invalidSuggestions=0;
      for(final w in warehouses){
        final warehouse=w['id'] as String;
        final draft=LegacyStockBatch.reviewRows(products,[],warehouse);
        expect(draft.length,products.length);
        for(final row in draft.where((r)=>r['reason']=='suggested')){
          final q=row['quantity'],v=row['totalValue'];
          if(row['warehouseId']!=warehouse||q is! num||v is! num||
              q<0||v<0||(q==0&&v!=0)||(q>0&&v<=0))invalidSuggestions++;
        }
      }
      expect(products.length,originalCounts['products']);
      expect(invalidSuggestions,0);
      expect(await db.query('legacy_stock_openings'),isEmpty);
    }finally{await db.close();await dir.delete(recursive:true);}
  },skip:path==null?'Set NASQO_PRIVATE_LEGACY_BACKUP to a local SQLite backup; no private file is committed.':false);
}
