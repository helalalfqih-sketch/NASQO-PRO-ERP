import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'local_database.dart';
import 'local_backup_restore.dart';
import 'legacy_operational_restore.dart';

/// Read only the supported extra collections. For old imports, reconstruct
/// the view from their verified original source in a private temporary file.
class LegacyHistoryArchive {
  LegacyHistoryArchive(this.local);
  final LocalDatabase local;
  static const collections=['source_store_trans','source_trans_details','source_offers',
    'source_offer_bill_details','source_offer_sbill_details','source_bin',
    'source_bin_bill_details','source_bin_bill_details2','source_alerts'];

  Future<Map<String,List<Map<String,dynamic>>>> load()async{
    final db=await local.database;
    final state=await db.transaction((t)async{
      final review=await t.query('backup_review_active',limit:1);
      final isReview=review.isNotEmpty;
      final source=isReview
        ?await t.query('backup_review_sources',where:'sha = ?',whereArgs:[review.single['sha']])
        :await t.query('legacy_operational_source',limit:1);
      if(source.isEmpty)throw StateError('No legacy source');
      if(isReview&&!['legacy-sqlite','legacy-sql'].contains(source.single['source_format']))throw StateError('This backup is not a legacy SQLite archive');
      final meta=LocalBackupRestore.object(jsonDecode(source.single['meta_json'] as String));
      final counts=meta['sourceExtraCounts'];
      final result=<String,List<Map<String,dynamic>>>{};
      for(final key in collections){
        final stored=isReview
          ?await t.query('backup_review_rows',columns:['row_json'],where:'sha = ? AND collection = ?',whereArgs:[source.single['sha'],key],orderBy:'ordinal')
          :await t.query('legacy_operational_rows',columns:['row_json'],where:'collection = ?',whereArgs:[key],orderBy:'rowid');
        result[key]=stored.map((r)=>LocalBackupRestore.object(jsonDecode(r['row_json'] as String))).toList();
      }
      final complete=counts is Map&&collections.every((k)=>counts[k.substring(7)]==result[k]!.length);
      if(complete)return (records:result,bytes:null as Uint8List?,sha:source.single['sha'] as String);
      if(!isReview)return (records:result,bytes:await LegacyOperationalRestore.original(t),sha:source.single['sha'] as String);
      // Read the exact selected source while holding the same transaction.
      final chunks=await t.query('backup_review_chunks',where:'sha = ?',whereArgs:[source.single['sha']],orderBy:'ordinal');
      final bytes=<int>[];
      for(var i=0;i<chunks.length;i++){
        if(chunks[i]['ordinal']!=i)throw StateError('Source chunk missing');
        bytes.addAll((chunks[i]['data'] as List).cast<int>());
      }
      // The fallback inspector verifies the source below before use.
      return (records:result,bytes:Uint8List.fromList(bytes),sha:source.single['sha'] as String);
    });
    final bytes=state.bytes;
    if(bytes==null)return state.records;
    if(sha256.convert(bytes).toString()!=state.sha)throw StateError('Original archive checksum mismatch');
    final dir=await Directory.systemTemp.createTemp('nasqo-history-');
    try{
      final file=await File('${dir.path}/source.back').writeAsBytes(bytes,flush:true);
      final candidate=await LocalBackupRestore(local).inspect(file,'source.back');
      if(!candidate.legacy||candidate.sha!=state.sha)throw StateError('Source archive mismatch');
      return {for(final key in collections)key:candidate.collections[key]??[]};
    }finally{await dir.delete(recursive:true);}

  }
}
