import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:nasqo_pro_erp/services/local_database.dart';
import 'package:nasqo_pro_erp/services/local_business_setup.dart';
import 'package:nasqo_pro_erp/services/local_workspace_settings.dart';
import 'package:nasqo_pro_erp/services/local_reference_guards.dart';
import 'package:nasqo_pro_erp/services/local_backup_restore.dart';
import 'package:nasqo_pro_erp/hybrid/local_snapshot_adapter.dart';

void main(){test('first setup is atomic, repeatable, operational and preserved by backup',()async{
  sqfliteFfiInit();databaseFactory=databaseFactoryFfi;
  final dir=await Directory.systemTemp.createTemp('nasqo-business-');await databaseFactory.setDatabasesPath(dir.path);
  final local=LocalDatabase.instance,db=await local.database,backup=LocalBackupRestore(local);
  final input=jsonDecode(await File('../tests/fixtures/business-setup.json').readAsString()) as Map<String,dynamic>;
  const w='local-erp-workspace';
  try{
    await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final original=await backup.exportNative();
    final bad={...input,'preferences':{...input['preferences'] as Map,'defaultWarehouseId':'missing'}};
    await expectLater(LocalBusinessSetup.complete(local,w,bad),throwsArgumentError);
    expect(await backup.exportNative(),orderedEquals(original),reason:'rollback includes all provisioned records');
    await LocalBusinessSetup.complete(local,w,input);
    var snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    expect(snapshot['ledger'],isEmpty);expect(snapshot['inventory'],isEmpty);
    final prefs=(snapshot['workspace'] as Map)['userPreferences'] as Map;
    expect(prefs['defaultWarehouseId'],isNotEmpty);expect(prefs['defaultCashboxId'],isA<int>());
    expect((snapshot['cashboxes'] as List).where((b)=>b['boxType']==2),hasLength(1));
    expect((snapshot['accounts'] as List).every((a)=>a['openingBalance']==0),isTrue);
    final saved=await backup.exportNative();
    await LocalBusinessSetup.complete(local,w,input);expect(await backup.exportNative(),orderedEquals(saved));
    await expectLater(LocalBusinessSetup.complete(local,w,{...input,'companyName':'different'}),throwsStateError);
    await expectLater(LocalWorkspaceSettings(local).save(w,{'userPreferences':{...prefs,'defaultCashboxId':99999}}),throwsArgumentError);
    await expectLater(LocalReferenceGuards.check(db,prefs['defaultWarehouseId'],{'warehouseId'}),throwsStateError);
    await LocalBusinessSetup.recent(local,'sale');await LocalBusinessSetup.recent(local,'inventory');await LocalBusinessSetup.recent(local,'sale');
    expect((await LocalWorkspaceSettings.read(db))['userPreferences']['recentActions'],['sale','inventory']);
    final prepared=await backup.exportNative(),file=File('${dir.path}/synthetic.back');await file.writeAsBytes(prepared);
    await LocalWorkspaceSettings(local).save(w,{'companyName':'Changed'});
    await backup.restoreNative(await backup.inspect(file,'synthetic.back'),replacementSha:sha256.convert(await backup.exportNative()).toString(),prepareForUse:true);
    snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    expect(snapshot['workspace']['companyName'],input['companyName']);
    expect(snapshot['workspace']['userPreferences']['recentActions'],['sale','inventory']);
    expect(await db.query('stock_movements'),isEmpty);expect(await db.query('journal_lines'),isEmpty);
  }finally{await db.close();await dir.delete(recursive:true);}
});}
