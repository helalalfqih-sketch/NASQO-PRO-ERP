import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/services/legacy_operational_restore.dart';
import 'package:nasqo_pro_erp/services/local_inventory_reports.dart';
import 'package:nasqo_pro_erp/services/legacy_archive_records.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

/// Optional private regression: an already activated older native database.
/// Never commit the database or print private text/financial amounts on failure.
void main() {
  final oldPath=Platform.environment['NASQO_PRIVATE_EXISTING_DB'];
  test('existing private archive recovers display fidelity without reimport or posting',()async{
    sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
    final dir=await Directory.systemTemp.createTemp('nasqo-existing-fidelity-');
    await databaseFactory.setDatabasesPath(dir.path);
    final inputHash=sha256.convert(await File(oldPath!).readAsBytes()).toString();
    await File(oldPath).copy('${dir.path}/${LocalDatabase.dbName}');
    final local=LocalDatabase.instance,db=await local.database;
    try{
      final backup=LocalBackupRestore(local);
      final before=sha256.convert(await backup.exportNative()).toString();
      final bytes=(await LegacyOperationalRestore.original(db))!;
      final sourceFile=await File('${dir.path}/source.back').writeAsBytes(bytes);
      final source=await databaseFactoryFfi.openDatabase(sourceFile.path,options:OpenDatabaseOptions(readOnly:true,singleInstance:false));
      final raw=await source.query('input_move');
      final snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
      final ledger={for(final r in (snapshot['ledger'] as List).cast<Map<String,dynamic>>())r['id']:r};
      var missing=0,sideErrors=0,noteErrors=0,referenceErrors=0,discountErrors=0,longNotes=0,refs=0,discounts=0;
      for(final r in raw){
        final row=ledger['legacy-ent-${r['id']}'];
        if(row==null){missing++;continue;}
        if(row['rawDain']!=LocalBackupRestore.numValue(r['dain'])||row['rawMadin']!=LocalBackupRestore.numValue(r['madin']))sideErrors++;
        final note=(r['details']??'').toString();
        if(note.trim().length>600){
          longNotes++;
          if(row['details']!=note)noteErrors++;
          final detail=await LegacyOperationalRestore.invoice(db,row['id'] as String);
          if(detail?['entry']['details']!=note)noteErrors++;
        }
        final ref=(r['ref']??'').toString();
        if(ref.isNotEmpty){refs++;if(row['sourceReference']!=ref)referenceErrors++;}
        final discount=LocalBackupRestore.numValue(r['discount_amount']);
        if(discount!=0){discounts++;if(row['headerDiscount']!=discount)discountErrors++;}
      }
      expect(missing+sideErrors+noteErrors+referenceErrors+discountErrors,0,reason:'Count-only private field mismatches');
      final evidence=await LocalInventoryReports.evidence(db,snapshot);
      final events=(evidence['events'] as List).cast<Map<String,dynamic>>();
      final sourceTransfers={for(final r in await source.query('store_trans'))'tx-${r['id']}':r};
      var dateErrors=0,transferEvents=0;
      final movementCounts=<String,Set<String>>{};
      for(var i=0;i<events.length;i++){
        final row=events[i];
        movementCounts.putIfAbsent(row['itemId'] as String,()=> <String>{}).add(row['transferLineKey']?.toString()??'row:$i');
        if(row['source']!='transfer')continue;
        transferEvents++;
        final r=sourceTransfers[row['refId']]!;
        final expected='${r['year']}-${r['month'].toString().padLeft(2,'0')}-${r['day'].toString().padLeft(2,'0')}';
        if(row['date']!=expected)dateErrors++;
      }
      expect(dateErrors,0,reason:'Transfer calendar-date mismatches');
      final most=movementCounts.entries.toList()..sort((a,b)=>b.value.length.compareTo(a.value.length));
      final seen=<String>{};var offset=0,pages=0,duplicates=0;
      if(most.isNotEmpty){
        while(true){
          final report=await LocalInventoryReports.report(db,snapshot,{'itemId':most.first.key,'movementOffset':offset,'movementLimit':100});
          pages++;
          for(final row in report['movements'] as List){if(!seen.add(row['movementId'] as String))duplicates++;}
          final page=report['movementPage'] as Map;
          expect(page['totalCount'],most.first.value.length);
          if(page['hasMore']!=true)break;
          final next=page['nextOffset'] as int;
          expect(next,greaterThan(offset));offset=next;
        }
        expect(seen.length,most.first.value.length);
        expect(duplicates,0);
      }
      final archiveCounts=<String,int>{};
      final archive=LegacyArchiveRecords(local);
      for(final pair in {'offers':'offers','trash':'bin','alerts':'alerts'}.entries){
        final expected=(await source.rawQuery('SELECT COUNT(*) AS n FROM "${pair.value}"')).single['n'];
        final ids=<String>{};var archiveOffset=0;
        while(true){
          final page=await archive.handle({'workspaceId':'local-erp-workspace','operation':'list','recordKind':pair.key,'offset':archiveOffset,'limit':100});
          expect(page['totalCount'],expected);
          for(final row in page['items'] as List){expect(ids.add(row['id'] as String),true);}
          if(page['nextOffset']==null)break;
          final next=page['nextOffset'] as int;expect(next,greaterThan(archiveOffset));archiveOffset=next;
        }
        expect(ids.length,expected);archiveCounts[pair.key]=ids.length;
        if(ids.isNotEmpty){
          final detail=await archive.handle({'workspaceId':'local-erp-workspace','operation':'detail','recordKind':pair.key,
            'recordId':ids.first,'sourceSha':sha256.convert(bytes).toString()});
          final record=detail['record'] as Map;
          final original=(await source.query(pair.value,where:'id = ?',whereArgs:[ids.first])).single;
          var fieldsMismatch=0;
          for(final key in original.keys){if((record['fields'] as Map)[key]!=original[key])fieldsMismatch++;}
          expect(fieldsMismatch,0,reason:'Original archive fields retained');
          if(pair.key=='trash')expect(record['deleted'],true);
        }
      }
      expect(sha256.convert(await backup.exportNative()).toString(),before,reason:'Read-only recovery must not change native tables');
      expect(sha256.convert(await LegacyOperationalRestore.original(db)??[]).toString(),sha256.convert(bytes).toString());
      expect(sha256.convert(await File(oldPath).readAsBytes()).toString(),inputHash);
      final output=Platform.environment['NASQO_PRIVATE_FIDELITY_REPORT'];
      if(output!=null)await File(output).writeAsString(const JsonEncoder.withIndent('  ').convert({
        'ledgerRows':raw.length,'recoveredLongNotes':longNotes,'nonemptySourceReferences':refs,'nonzeroHeaderDiscounts':discounts,
        'fieldMismatches':missing+sideErrors+noteErrors+referenceErrors+discountErrors,
        'transferEvents':transferEvents,'transferDateMismatches':dateErrors,
        'largestItemMovementsLoaded':seen.length,'pages':pages,'duplicateMovements':duplicates,
        'normalDestinationArchiveCounts':archiveCounts,
        'nativeTablesUnchanged':true,'originalUnchanged':true,
      }));
      await source.close();
    }finally{await db.close();await dir.delete(recursive:true);}
  },skip:oldPath==null?'Set NASQO_PRIVATE_EXISTING_DB to a private old native SQLite copy.':false,
    timeout:const Timeout(Duration(minutes:3)));
}
