import '../services/local_business_setup.dart';
import 'dart:async';
import 'dart:convert';
import '../services/local_workspace_readiness.dart';
import '../services/free_invoice_lines.dart';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import '../services/backup_encryption.dart';
import '../services/local_backup_restore.dart';
import '../services/legacy_operational_restore.dart';
import '../services/legacy_archive_records.dart';
import 'package:flutter/material.dart';
import '../services/native_cloud_session.dart';
import '../services/firebase_sync_auth.dart';
import '../screens/legacy_stock_opening_screen.dart';
import '../screens/legacy_history_screen.dart';
import '../screens/local_invoice_roles_screen.dart';
import '../services/local_invoice_roles.dart';
import '../services/local_workspace_settings.dart';
import '../services/local_master_catalog.dart';
import '../services/local_erp_records.dart';
import '../services/local_inventory_reports.dart';
import '../services/local_document_output.dart';
import '../services/stock_invoice_commands.dart';
import '../services/local_stock_catalog.dart';
import 'package:flutter/services.dart';
import 'hybrid_read_only_protocol.dart';
import 'hybrid_back_coordinator.dart';
import '../services/local_account_commands.dart';
import '../services/local_document_commands.dart';
import '../services/local_document_lifecycle.dart';
import 'local_snapshot_adapter.dart';
import '../services/local_database.dart';

/// Android-only debug preview of the original React/Vite UI.
///
/// Kotlin WebViewAssetLoader serves the bundled React files from an isolated
/// local HTTPS origin; no network or external navigation is permitted.
/// Explicit local account commands are enabled; other financial commands fail closed.
class HybridReactPreviewScreen extends StatefulWidget {
  const HybridReactPreviewScreen({super.key, this.onShowNative});

  final VoidCallback? onShowNative;

  @override
  State<HybridReactPreviewScreen> createState() => _HybridReactPreviewScreenState();
}

class _HybridReactPreviewScreenState extends State<HybridReactPreviewScreen>
    with WidgetsBindingObserver {
  late HybridBackCoordinator _back = _newBackCoordinator();
  bool _exitDialogOpen = false;

  HybridBackCoordinator _newBackCoordinator() => HybridBackCoordinator(
    dispatch: (event) async => _channel?.invokeMethod<String>('dispatchBack', event),
  );

  Future<void> _handleSystemBack() async {
    // A Flutter dialog or native screen above us owns this press. Android's
    // external picker/share Activity similarly owns its own back dispatch.
    if (!mounted || _exitDialogOpen || ModalRoute.of(context)?.isCurrent != true ||
        WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      return;
    }
    final channel = _channel;
    final outcome = await _back.requestBack();
    if (!mounted || channel != _channel ||
        WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed ||
        ModalRoute.of(context)?.isCurrent != true ||
        outcome != HybridBackOutcome.home) {
      return;
    }
    _exitDialogOpen = true;
    try {
      final exit = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
        title: const Text('الخروج من نسقو برو؟'),
        content: const Text('أنت في الشاشة الرئيسية. يمكنك العودة ومتابعة العمل.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('متابعة')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('خروج')),
        ],
      ));
      if (exit == true && mounted && channel == _channel) await SystemNavigator.pop();
    } finally {
      _exitDialogOpen = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Visibility changes never rebuild/reload the platform view or replay
    // commands. Native diagnostics correlate process and WebView instances.
    final channel = _channel;
    if (state != AppLifecycleState.resumed) _back.cancelPending();
    if (channel != null) {
      unawaited(channel.invokeMethod<void>('lifecycle', state.name).catchError((Object _) {}));
    }
  }

  final _documentOutput=LocalDocumentOutput();
  late final NativeCloudSession _cloud=NativeCloudSession(
    confirm:_confirmCloud,exportWorkspace:_exportCloudWorkspace,restoreWorkspace:_restoreCloudFile,
    pickFile:_pickCloudFile,saveFile:_saveCloudFile,
    requestRecoveryKey:_requestCloudRecoveryKey);

  // The key is requested in native Flutter, never from the React bridge.
  // Do not log, persist, or automatically copy it to the clipboard.
  Future<SecretKey?> _requestCloudRecoveryKey(bool allowGenerate)async{
    if(!mounted||_backupBusy)return null;
    String input='';
    String? error;
    SecretKey? entered;
    final choice=await showDialog<String>(context:context,builder:(ctx)=>
      StatefulBuilder(builder:(ctx,setDialogState)=>AlertDialog(
        title:const Text('مفتاح استرداد النسخة'),
        content:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,
          crossAxisAlignment:CrossAxisAlignment.stretch,children:[
            Text(allowGenerate?'أدخل مفتاحك المحفوظ، أو أنشئ مفتاحًا جديدًا واحفظه خارج Drive. فقدان المفتاح يعني عدم إمكانية استعادة النسخة.':
              'أدخل مفتاح الاسترداد الأصلي للنسخة. لا يمكن استبدالها أو فك تشفيرها دون المفتاح الصحيح.'),
            const SizedBox(height:12),
            TextField(
              textDirection:TextDirection.ltr,obscureText:true,
              autocorrect:false,enableSuggestions:false,enableIMEPersonalizedLearning:false,
              decoration:InputDecoration(labelText:'مفتاح الاسترداد',errorText:error),
              onChanged:(value){input=value;if(error!=null)setDialogState(()=>error=null);}),
          ])),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('إلغاء')),
          if(allowGenerate)TextButton(onPressed:()=>Navigator.pop(ctx,'generate'),child:const Text('إنشاء مفتاح')),
          FilledButton(onPressed:(){
            try{entered=BackupEncryption.importRecoveryKey(input);}
            on FormatException{setDialogState(()=>error='المفتاح غير صالح');return;}
            Navigator.pop(ctx,'use');
          },child:const Text('متابعة')),
        ])));
    input='';
    if(!mounted||choice==null)return null;
    if(choice=='use')return entered;
    if(choice!='generate'||!allowGenerate)return null;
    final key=await BackupEncryption.newRecoveryKey();
    final encoded=await BackupEncryption.exportRecoveryKey(key);
    if(!mounted)return null;
    var saved=false;
    final approved=await showDialog<bool>(context:context,barrierDismissible:false,builder:(ctx)=>
      StatefulBuilder(builder:(ctx,setDialogState)=>AlertDialog(
        title:const Text('احفظ مفتاح الاسترداد'),
        content:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,
          crossAxisAlignment:CrossAxisAlignment.stretch,children:[
            const Text('احفظ المفتاح في مكان آمن منفصل عن النسخة. لا يُرسل إلى Google Drive ولا يمكن للنظام استعادته إذا فقدته.'),
            const SizedBox(height:12),
            SelectableText(encoded,textDirection:TextDirection.ltr),
            CheckboxListTile(contentPadding:EdgeInsets.zero,value:saved,
              onChanged:(value)=>setDialogState(()=>saved=value==true),
              title:const Text('حفظت المفتاح في مكان آمن')),
          ])),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
          FilledButton(onPressed:saved?()=>Navigator.pop(ctx,true):null,child:const Text('تشفير ومتابعة')),
        ])));
    return approved==true&&mounted?key:null;
  }
  Future<bool> _confirmCloud(String title,String message)async{
    if(!mounted||_backupBusy)return false;
    return await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:Text(title),content:Text(message),actions:[
        TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('تأكيد'))]))==true;
  }
  Future<Uint8List> _exportCloudWorkspace()async{
    if(_review||_backupBusy)throw StateError('Local working database required');
    return _backups.exportNative();
  }
  Future<({Uint8List bytes,String name})?> _pickCloudFile()async{
    if(_backupBusy)return null;
    final choice=await _backupChannel.invokeMapMethod<String,dynamic>('pickBackup');
    if(choice==null)return null;
    final file=File(choice['path'] as String);
    try{return (bytes:await file.readAsBytes(),name:choice['fileName'] as String);}
    finally{try{await file.delete();}catch(_){}}
  }
  Future<Map<String,dynamic>?> _pickImportFile(String purpose)async{
    if(_backupBusy)throw StateError('Database busy');
    _backupBusy=true;
    File? file;
    try{
      final choice=await _backupChannel.invokeMapMethod<String,dynamic>('pickBackup');
      if(choice==null)return null;
      file=File(choice['path'] as String);
      final name=choice['fileName'] as String;
      final suffix=name.split('.').last.toLowerCase();
      if(!(purpose=='import-items'?['xlsx','xls','csv','tsv','txt']:['csv','txt']).contains(suffix))
        throw const FormatException('اختر Excel أو CSV للأصناف، وCSV للحسابات.');
      final size=await file.length();
      if(size<1||size>8*1024*1024)throw const FormatException('اختر ملفًا غير فارغ لا يتجاوز 8 ميجابايت.');
      final bytes=await file.readAsBytes();
      return {'fileName':name,'mimeType':suffix=='csv'?'text/csv':'application/octet-stream',
        'sizeBytes':bytes.length,'base64Content':base64Encode(bytes)};
    }finally{if(file!=null){try{await file.delete();}catch(_){}}_backupBusy=false;}
  }
  Future<File> _stageCloudFile(Uint8List bytes)async{
    final cache=await _backupChannel.invokeMethod<String>('cachePath');
    if(cache==null)throw StateError('Cache unavailable');
    final file=File('$cache/nasqo-drive-${DateTime.now().microsecondsSinceEpoch}.back');
    return file.writeAsBytes(bytes,flush:true);
  }
  Future<bool> _saveCloudFile(Uint8List bytes,String name)async{
    final file=await _stageCloudFile(bytes);
    try{return await _backupChannel.invokeMethod<bool>('exportBackup',{'path':file.path,'fileName':name})==true;}
    finally{try{await file.delete();}catch(_){}}
  }
  Future<bool> _restoreCloudFile(Uint8List bytes,String name)async{
    if(_backupBusy)return false;
    final file=await _stageCloudFile(bytes);
    try{return (await _restoreBackup(sourceFile:file,sourceName:name))?['nativeRestored']==true;}
    finally{if(await file.exists()){try{await file.delete();}catch(_){}}}
  }
  Future<Map<String,dynamic>> _readWorkspaceSnapshot()async{
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final capabilities=Map<String,dynamic>.from(snapshot['capabilities'] as Map? ??{});
    capabilities['googleDriveConfigured']=FirebaseSyncAuth.configured;
    return {...snapshot,'capabilities':capabilities};
  }
  Future<Map<String,dynamic>> _localTools(String operation)async{
    if(!_backupStateLoaded||_backupBusy)throw StateError('Database busy');
    switch(operation){
      case 'status':break;
      case 'history':
        if(!_legacyOperational&&!_review)throw StateError('No historical records');
        await Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>const LegacyHistoryScreen()));
        break;
      case 'readiness':if(!_review)throw StateError('No review');await _showRestoreReadiness();break;
      case 'activate':if(!_review)throw StateError('No review');await _activateReviewed(refreshView:false);break;
      case 'leaveReview':if(!_review)throw StateError('No review');await _leaveReview(refreshView:false);break;
      default:throw ArgumentError('Invalid tool');
    }
    return {'review':_review,'imported':_legacyOperational};
  }
  late final HybridReadOnlyProtocol _protocol = HybridReadOnlyProtocol(
    readSnapshot: _readWorkspaceSnapshot,
    cloudAction: _cloud.handle,
    localToolsAction: _localTools,
    legacyArchiveAction: LegacyArchiveRecords(LocalDatabase.instance).handle,
    saveUiPreferences: LocalDatabase.instance.saveUiPreferences,
    saveWorkspaceSettings: _saveWorkspaceSettings,
    recordRecentAction: (action) async {
      await LocalBusinessSetup.recent(LocalDatabase.instance, action);
      return {'snapshot':await HybridLocalSnapshotAdapter.readFromDevice()};
    },
    completeBusinessSetup: (input) async {
      await LocalBusinessSetup.complete(LocalDatabase.instance, HybridLocalSnapshotAdapter.workspaceId, input);
      return {'snapshot': await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true)};
    },
    createAccount: (key,payload) => _saveAccount(key,payload),
    updateAccount: (key,id,payload) => _saveAccount(key,payload,accountId:id),
    postDocument: _postDocument,
    manageDocument: _manageDocument,
    createStockRecord: _createStockRecord,
    manageCatalog: _manageCatalog,
    saveErpRecords: (workspace,key,changes)=>LocalErpRecords(LocalDatabase.instance).save(workspace,key,changes),
    readInventoryReport: _readInventoryReport,
    readProductPriceStats: _readProductPriceStats,
    readInvoiceDetail: _readInvoiceDetail,
    documentOutput: _documentOutput.handle,
    printCurrentPage: _printCurrentPage,
    shareText: _shareText,
    pickBackup: _restoreBackup,
    pickImportFile: _pickImportFile,
    openInvoiceRoles: _openInvoiceRoles,
    openStockReconciliation: _openStockReconciliation,
    exportBackup: _exportBackup,
  );

  static Future<Map<String,dynamic>> _saveAccount(
      String key, Map<String,dynamic> payload, {String? accountId}) async {
    final id = await LocalAccountCommands(LocalDatabase.instance).save(
      HybridLocalSnapshotAdapter.workspaceId,key,payload,accountId:accountId);
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final account = (snapshot['accounts'] as List).cast<Map<String,dynamic>>()
      .firstWhere((a) => a['id'] == id);
    return {'account':account,'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _saveWorkspaceSettings(Map<String,dynamic> input)async{
    await LocalWorkspaceSettings(LocalDatabase.instance).save(HybridLocalSnapshotAdapter.workspaceId,input);
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    return {'workspace':snapshot['workspace'],'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _postDocument(String key,Map<String,dynamic> payload) async {
    final local=LocalDatabase.instance;
    final String id;
    if(LocalDocumentLifecycle.isDraftKind(payload['kind'])){
      id=await LocalDocumentLifecycle(local).saveDraft(HybridLocalSnapshotAdapter.workspaceId,key,payload);
    }else{
      final resolved=await LocalInvoiceRoles(local).resolve(payload);
      final isStock=resolved['invoiceContent']=='items'||resolved['kind']=='return';
      id=isStock
        ? await StockInvoiceCommands(local).post(HybridLocalSnapshotAdapter.workspaceId,key,resolved)
        : await LocalDocumentCommands(local).post(HybridLocalSnapshotAdapter.workspaceId,key,resolved);
    }
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final entry = (snapshot['ledger'] as List).cast<Map<String,dynamic>>()
        .firstWhere((e) => e['id'] == id);
    return {'entry':entry,'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _manageDocument(String action,String key,Map<String,dynamic> params)async{
    final lifecycle=LocalDocumentLifecycle(LocalDatabase.instance),w=HybridLocalSnapshotAdapter.workspaceId;
    final id=params['entryId'] as String;
    if(action=='updateLedgerEntry'){
      final p=params['payload'] as Map<String,dynamic>;
      if(LocalDocumentLifecycle.isDraftKind(p['kind'])){await lifecycle.saveDraft(w,key,p,editingId:id);}
      else{await lifecycle.amendMetadata(w,key,id,p);}
    }else{
      await lifecycle.trash(w,key,id,deleted:params['deleted'] as bool?,permanent:action=='permanentlyDeleteLedger');
    }
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    return {'snapshot':snapshot,if(action=='updateLedgerEntry')
      'entry':(snapshot['ledger'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id)};
  }

  static Future<Map<String,dynamic>> _readInventoryReport(Map<String,dynamic> options)async{
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    return db.transaction((t)async=>LocalInventoryReports.report(t,await HybridLocalSnapshotAdapter.readInTransaction(t,local),options));
  }
  static Future<Map<String,dynamic>> _readProductPriceStats(String id)async{
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    return db.transaction((t)async=>LocalInventoryReports.priceStats(t,await HybridLocalSnapshotAdapter.readInTransaction(t,local),id));
  }

  static Future<Map<String,dynamic>> _manageCatalog(String action,String key,Map<String,dynamic> p)async{
    const workspace=HybridLocalSnapshotAdapter.workspaceId;
    final master=LocalMasterCatalog(LocalDatabase.instance),stock=LocalStockCatalog(LocalDatabase.instance);
    final result=<String,dynamic>{};
    String? itemId,warehouseId;
    switch(action){
      case 'deleteAccountGroup':
        await master.deleteMaster(workspace,key,'accountGroups',p['groupId'] as int);break;
      case 'deleteCashbox':
        await master.deleteMaster(workspace,key,'cashboxes',p['cashboxId'] as int);break;
      case 'deleteWarehouse':
        await stock.deleteWarehouse(workspace,key,StockInvoiceCommands.identity(p['warehouseId']));break;
      case 'saveCashbox':
        result['cashbox']=await master.saveCashbox(workspace,key,p['payload'] as Map<String,dynamic>);
        break;
      case 'saveAccountGroup':
        result['group']=await master.saveGroup(workspace,key,p['payload'] as Map<String,dynamic>);
        break;
      case 'saveCurrency':
        await master.saveCurrency(workspace,key,p['payload'] as Map<String,dynamic>);
        break;
      case 'deleteCurrency':
        await master.deleteCurrency(workspace,key,p['currencyId'] as int);
        break;
      case 'deleteAccount':
        await master.deleteAccount(workspace,key,StockInvoiceCommands.identity(p['accountId']));
        break;
      case 'saveWarehouse':
        warehouseId=await stock.createWarehouse(workspace,key,p['payload'] as Map<String,dynamic>,existingId:p['warehouseId'] as String);
        break;
      case 'updateInventoryItem':
        itemId=StockInvoiceCommands.identity(p['itemId']);
        await stock.updateItem(workspace,key,itemId,p['updates'] as Map<String,dynamic>);
        break;
      case 'deleteInventoryItem':
        await stock.deleteItem(workspace,key,StockInvoiceCommands.identity(p['itemId']));
        break;
      case 'importAccountCards':
        result.addAll(await LocalAccountCommands(LocalDatabase.instance).importCards(workspace,key,p['accounts'] as List<dynamic>));
        break;
      case 'importInventoryItems':
        result.addAll(await stock.importItems(workspace,key,p['items'] as List<dynamic>,p['mode'] as String));
        break;
      case 'batchUpdateInventoryItems':
        await stock.batchUpdate(workspace,key,p['updates'] as List<dynamic>);
        break;
      default:throw ArgumentError('Unsupported catalog command');
    }
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    result['snapshot']=snapshot;
    if(action=='saveCurrency'||action=='deleteCurrency')result['currencies']=snapshot['currencies'];
    if(warehouseId!=null)result['warehouse']=(snapshot['warehouses'] as List).firstWhere((r)=>r['id']==warehouseId);
    if(itemId!=null)result['item']=(snapshot['inventory'] as List).firstWhere((r)=>r['id']==itemId);
    return result;
  }

  static Future<Map<String,dynamic>> _createStockRecord(String action,String key,Map<String,dynamic> payload)async{
    final catalog=LocalStockCatalog(LocalDatabase.instance);
    final warehouse=action=='saveWarehouse';
    final id=warehouse?await catalog.createWarehouse(HybridLocalSnapshotAdapter.workspaceId,key,payload)
      :await catalog.createItem(HybridLocalSnapshotAdapter.workspaceId,key,payload);
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final row=(snapshot[warehouse?'warehouses':'inventory'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
    return {(warehouse?'warehouse':'item'):row,'snapshot':snapshot};
  }
  static Future<Map<String,dynamic>> _readInvoiceDetail(String id)async{
    final db=await LocalDatabase.instance.database;
    final archived=await db.transaction((txn)=>LocalBackupRestore.reviewInvoice(txn,id));
    if(archived!=null)return archived;
    final draft=await LocalDocumentLifecycle.draft(db,id);
    if(draft!=null){
      final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
      final entry=(snapshot['ledger'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
      return {'entry':entry,'lines':draft['lines']};
    }
    final imported=await db.transaction((txn)=>LegacyOperationalRestore.invoice(txn,id));
    if(imported!=null)return imported;
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice(prepareForUse:true);
    final entry=(snapshot['ledger'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
    if(entry['invoiceContent']=='free') return {'entry':entry,'lines':await FreeInvoiceLines.read(db,id)};
    final stored=await db.query('stock_posting_lines',where:'document_id = ?',whereArgs:[id],orderBy:'rowid');
    final lines=<Map<String,dynamic>>[];
    for(var i=0;i<stored.length;i++){
      final d=jsonDecode(stored[i]['line_json'] as String) as Map<String,dynamic>;
      lines.add({'id':i+1,'lineKind':'item','inventoryItemId':d['item_id'],
        'itemName':d['itemName'],'sku':'','warehouseName':entry['warehouseName'],
        'price':(d['price_minor'] as int)/100,'quantity':d['sold_quantity']??d['quantity'],
        'total':(d['net_minor'] as int)/100,'discount':(d['discount_minor'] as int)/100,
        'bonus':0,'unit':d['unit'],'unitNum':d['unit_num']??1,'details':'','expiryDate':''});
    }
    if(entry['stockPosting']!=true&&entry['invoiceContent']=='items') throw StateError('Historical stock lines unavailable');
    return {'entry':entry,'lines':lines};
  }

  static const _backupChannel=MethodChannel('nasqo/local_backup');
  final _backups=LocalBackupRestore(LocalDatabase.instance);
  bool _backupBusy=false;
  bool _review=false;
  bool _legacyOperational=false;
  bool _backupStateLoaded=false;
  int _viewGeneration=0;

  @override
  void initState(){
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initializeWorkspace().then((value){
      if(mounted)setState((){_review=value[0];_legacyOperational=value[1];_backupStateLoaded=true;});
    }).catchError((Object _){
      if(mounted)setState(()=>_error='تعذر التحقق من حالة قاعدة البيانات المحلية.');
    });
  }
  Future<List<bool>> _initializeWorkspace()async{
    final local=LocalDatabase.instance,db=await LocalDatabase.instance.database;
    await db.transaction((t)=>LocalWorkspaceReadiness.prepare(t,local));
    return [await _backups.isReview(),await LocalDatabase.hasLegacyOperational(db)];
  }
  Future<void> _message(String message)async{
    if(!mounted)return;
    await showDialog<void>(context:context,builder:(context)=>AlertDialog(
      title:const Text('النسخ الاحتياطية المحلية'),content:Text(message),
      actions:[TextButton(onPressed:()=>Navigator.pop(context),child:const Text('موافق'))]));
  }
  bool _stockReconciliationOpen=false;
  Future<bool> _openStockReconciliation(String? warehouse,String? product)async{
    if(!mounted||_backupBusy||_review||!_legacyOperational||_stockReconciliationOpen)
      throw StateError('Local imported workspace required');
    _stockReconciliationOpen=true;
    try{
      await Navigator.of(context).push(MaterialPageRoute<bool>(builder:(_)=>LegacyStockOpeningScreen(
        initialWarehouseId:warehouse,initialProductId:product)));
      // A system back gesture can return null even after a saved count.
      // Always refresh the snapshot; no changes are inferred from navigation.
      return true;
    }finally{_stockReconciliationOpen=false;}
  }

  Future<void> _openInvoiceRoles()async{
    if(!mounted||_backupBusy||_review)throw StateError('Local working database required');
    await Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>const LocalInvoiceRolesScreen()));
  }

  Future<Map<String,dynamic>?> _restoreBackup({bool refreshView=false,File? sourceFile,String? sourceName})async{
    if(_backupBusy)return null;
    setState(()=>_backupBusy=true);
    File? picked;
    try{
      String name;
      if(sourceFile!=null){picked=sourceFile;name=sourceName??'drive.back';}
      else{
        final choice=await _backupChannel.invokeMapMethod<String,dynamic>('pickBackup');
        if(choice==null||!mounted)return null;
        picked=File(choice['path'] as String);
        name=choice['fileName'] as String;
      }
      final candidate=await _backups.inspect(picked,name);
      if(!mounted)return null;
      const labels={'accounts':'الحسابات','warehouses':'المخازن','inventory':'الأصناف','inventory_items':'الأصناف','ledger':'الحركات','ledger_entries':'الحركات','journal_entries':'القيود','invoice_lines':'بنود الفواتير'};
      final stats=candidate.counts.entries.where((e)=>labels.containsKey(e.key))
        .map((e)=>'${labels[e.key]}: ${e.value}').join('\n');
      final accept=await showDialog<String>(context:context,builder:(context)=>AlertDialog(
        title:Text(candidate.native?'استعادة قاعدة بيانات NASQO Android':candidate.operational?'استعادة بيانات العمل':'استيراد نسخة للمراجعة المحلية'),
        content:SingleChildScrollView(child:Text('$name\n\n$stats\n\n'+
          (candidate.native?'تُستعاد السجلات والقيود وطابور العمليات محليًا. إذا كانت هناك بيانات حالية، يجب حفظ نسخة متحقق منها وتأكيد الاستبدال أولًا.':
          candidate.operational?'تستعيد الحسابات والحركات وبنود الفواتير وتحفظ الملف الأصلي. عند وجود بيانات محلية تُطلب نسخة أمان وتأكيد قبل الاستبدال. يجهّز النظام رصيد المخزون وحسابات التشغيل تلقائيًا. يمكنك اختيار المراجعة فقط.':
          'ستحفظ النسخة الأصلية داخل SQLite وتعرض سجلاتها في مساحة مراجعة معزولة للقراءة فقط. لن تُعدّل بياناتك الحالية أو تُرحّل الأرصدة التاريخية تلقائيًا.'))),
        actions:[TextButton(onPressed:()=>Navigator.pop(context),child:const Text('إلغاء')),
          if(candidate.operational&&!candidate.native)OutlinedButton(onPressed:()=>Navigator.pop(context,'review'),child:const Text('مراجعة فقط')),
          FilledButton(onPressed:()=>Navigator.pop(context,candidate.native?'native':candidate.operational?'live':'review'),child:Text(candidate.native?'استعادة':candidate.operational?'استعادة وبدء العمل':'استيراد وعرض'))]));
      if(accept==null||!mounted)return null;
      if(accept=='live'||candidate.native){
        final protection=await _protectExistingData();
        if(!protection.proceed)return null;
        if(accept=='live'){
          await LegacyOperationalRestore(LocalDatabase.instance).activate(candidate,replacementSha:protection.sha,prepareForUse:true);
        }else{
          await _backups.restoreNative(candidate,replacementSha:protection.sha,prepareForUse:true);
        }
      }else{await _backups.openReview(candidate);}
      final legacy=await LocalDatabase.hasLegacyOperational(await LocalDatabase.instance.database);
      if(!mounted)return null;
      setState((){_review=accept=='review';_legacyOperational=legacy;_backupStateLoaded=true;if(refreshView)_viewGeneration++;});
      await _message(accept=='live'?'تمت استعادة البيانات وتجهيز المخزون والحسابات. يمكنك بدء العمل الآن.':candidate.native?'تمت استعادة النسخة المحلية بنجاح.':'تم حفظ الملف الأصلي وفتح البيانات التاريخية للمراجعة. يمكنك الرجوع إلى بياناتك الحالية من إعدادات قاعدة البيانات.');
      return {'fileName':name,'mimeType':'application/octet-stream','sizeBytes':candidate.bytes.length,
        'base64Content':'','nativeRestored':true,'restoreMode':accept=='review'?'review':'operational','counts':candidate.counts};
    }on FormatException catch(e){
      await _message('رُفضت النسخة دون تعديل البيانات: ${e.message}');return null;
    }on StateError catch(e){
      await _message('تعذرت الاستعادة دون تعديل البيانات: ${e.message}');return null;
    }catch(_){
      await _message('تعذر قراءة النسخة أو استعادتها. لم يتم تأكيد أي استبدال للبيانات.');return null;
    }finally{
      if(picked!=null){try{await picked.delete();}catch(_){}}
      if(mounted)setState(()=>_backupBusy=false);
    }
  }
  Future<bool> _confirmActivation(BackupCandidate candidate)async{
    if(!mounted)return false;
    return await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('استعادة تشغيلية للحسابات'),
      content:SingleChildScrollView(child:Text('ستُنقل الحسابات والحركات الأصلية وبنود الفواتير دون إعادة ترحيل القيود القديمة. إن وُجدت بيانات عمل حالية فستحتاج إلى نسخة أمان وتأكيد منفصل.\n'
        'عملات غير معرّفة: ${candidate.meta['unknownCurrencies']??0}. تبقى خارج الأرصدة.\n'
        'ستُسجّل السندات الجديدة بقيود مزدوجة. أرصدة الصناديق والتكاليف التاريخية ليست قيودًا مزدوجة مؤكدة.\n'
        'الأصناف التي تحمل كمية وتكلفة معتمدتين في النسخة الموحدة تُستعاد كما هي. يجهّز النظام رصيد المخزون وحسابات التشغيل تلقائيًا.\n'
        'وحدات ERP غير المدعومة تبقى في الملف الأصلي المحفوظ، ولا تُرحّل إلى دفتر العمل. لن ترفع البيانات للسحابة.')),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('تفعيل الحسابات'))]))==true;
  }

  Future<void> _activateReviewed({bool refreshView=true})async{
    if(_backupBusy)return;
    setState(()=>_backupBusy=true);
    File? temp;
    try{
      final bytes=await _backups.exportReviewSource();
      if(bytes==null)throw StateError('No active backup');
      final cache=await _backupChannel.invokeMethod<String>('cachePath');
      if(cache==null)throw StateError('Cache unavailable');
      temp=File('$cache/nasqo-activate-${DateTime.now().microsecondsSinceEpoch}.back');
      await temp.writeAsBytes(bytes,flush:true);
      final candidate=await _backups.inspect(temp,'legacy-original.back');
      if(!candidate.operational||candidate.native)throw StateError('هذه الصيغة تحتاج مسار ترحيل آخر');
      if(!await _confirmActivation(candidate))return;
      final protection=await _protectExistingData();
      if(!protection.proceed)return;
      await LegacyOperationalRestore(LocalDatabase.instance).activate(candidate,replacementSha:protection.sha,prepareForUse:true);
      if(mounted)setState((){_review=false;_legacyOperational=true;if(refreshView)_viewGeneration++;});
      await _message('تمت استعادة البيانات وتجهيزها للعمل.');
    }on StateError catch(e){await _message('لم يتم تغيير قاعدة العمل: ${e.message}');}
    catch(_){await _message('تعذر تفعيل النسخة؛ لم يتم تأكيد أي تغيير للبيانات.');}
    finally{if(temp!=null){try{await temp.delete();}catch(_){}}if(mounted)setState(()=>_backupBusy=false);}
  }

  /// Protect the underlying working database, not the selected review.
  /// The save picker returns success only after reading back and verifying
  /// the file. A second explicit confirmation authorizes the replacement.
  Future<({bool proceed,String? sha})> _protectExistingData()async{
    final bytes=await _backups.replacementBackup();
    if(bytes==null)return (proceed:true,sha:null);
    if(!mounted)return (proceed:false,sha:null);
    final save=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('توجد بيانات عمل محلية'),
      content:const Text('لاستبدال البيانات الحالية، احفظ أولًا نسخة احتياطية كاملة منها، بما فيها العمليات المحلية غير المزامنة. لن تُحذف أي بيانات إذا ألغيت الحفظ أو فشل التحقق من النسخة.'),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('حفظ نسخة الأمان'))]));
    if(save!=true||!mounted)return (proceed:false,sha:null);
    File? temp;
    try{
      final cache=await _backupChannel.invokeMethod<String>('cachePath');
      if(cache==null)throw StateError('Cache unavailable');
      temp=File('$cache/nasqo-before-restore-${DateTime.now().microsecondsSinceEpoch}.back');
      await temp.writeAsBytes(bytes,flush:true);
      final saved=await _backupChannel.invokeMethod<bool>('exportBackup',{'path':temp.path,
        'fileName':'nasqo-before-restore-${DateTime.now().microsecondsSinceEpoch}.back'});
      if(saved!=true||!mounted)return (proceed:false,sha:null);
      final approved=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('تأكيد استبدال قاعدة العمل'),
        content:const Text('تم حفظ نسخة الأمان والتحقق من تطابقها. سيستبدل التطبيق الآن الحسابات والحركات والأصناف والعمليات المحلية بالنسخة المحددة. عند الفشل ستُسترجع البيانات الحالية تلقائيًا من المعاملة. احتفظ بنسخة الأمان.'),
        actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('استبدال واستعادة'))]));
      return (proceed:approved==true&&mounted,sha:sha256.convert(bytes).toString());
    }finally{if(temp!=null){try{await temp.delete();}catch(_){}}}
  }

  Future<bool> _exportBackup()async{
    if(_backupBusy)throw StateError('يوجد حفظ نسخة قيد التنفيذ');
    setState(()=>_backupBusy=true);
    File? temp;
    try{
      final bytes=_review?await _backups.exportReviewSource():await _backups.exportNative();
      if(bytes==null)throw StateError('No archive');
      final cache=await _backupChannel.invokeMethod<String>('cachePath');
      if(cache==null)throw StateError('Cache unavailable');
      temp=File('$cache/nasqo-export-${DateTime.now().microsecondsSinceEpoch}.back');
      await temp.writeAsBytes(bytes,flush:true);
      final ok=await _backupChannel.invokeMethod<bool>('exportBackup',{'path':temp.path,'fileName':
        _review?'nasqo-original-source.back':'nasqo-android-${DateTime.now().toIso8601String().substring(0,10)}.back'});
      if(ok==true)await _message('تم تصدير الملف. احتفظ به في مكان آمن؛ النسخة غير مشفرة.');
      return ok==true;
    }on PlatformException catch(e){throw StateError('تعذر كتابة النسخة (${e.code})؛ تحقق من المساحة وصلاحية وجهة الحفظ.');}
    finally{if(temp!=null){try{await temp.delete();}catch(_){}}if(mounted)setState(()=>_backupBusy=false);}
  }
  Future<void> _showRestoreReadiness() async {
    if(_backupBusy)return;
    setState(()=>_backupBusy=true);
    try{
      final report=await _backups.reviewReadiness();
      if(!mounted)return;
      final counts=Map<String,dynamic>.from(report['counts'] as Map);
      final issues=Map<String,dynamic>.from(report['issues'] as Map);
      final live=Map<String,dynamic>.from(report['liveCounts'] as Map);
      const labels={
        'invalidIdentifiers':'معرّفات مفقودة أو مكررة',
        'missingGroup':'مراجع مجموعات غير موجودة',
        'unknownCurrency':'مراجع عملات غير معرّفة',
        'invalidOpening':'بيانات أرصدة افتتاحية غير صالحة',
        'missingWarehouse':'مراجع مخازن غير موجودة',
        'unverifiedInventory':'أصناف بكميات غير معتمدة',
        'invalidInventory':'قيم مخزون تحتاج مراجعة',
        'missingAccount':'حركات بمراجع حسابات مفقودة',
        'missingCashbox':'مراجع صناديق غير موجودة',
        'invalidFinancialValue':'قيم مالية أو أسعار صرف غير صالحة',
        'ambiguousSides':'حركات مدين ودائن تحتاج تفسيرًا',
        'missingInvoiceLines':'فواتير تحتاج تفاصيلها',
        'missingItem':'مراجع أصناف غير موجودة',
        'invalidLine':'بنود فواتير تحتاج مراجعة',
      };
      final hasLive=live.values.any((v)=>v is num&&v>0);
      final text=[
        'نوع النسخة: ${report['format']}',
        'الحسابات: ${counts['accounts']}',
        'الحركات: ${counts['ledger']}',
        'بنود الفواتير: ${report['invoiceLines']}',
        'الأصناف: ${counts['inventory']}',
        'المخازن: ${counts['warehouses']}',
        '',
        if(issues.isEmpty)'لم تُكتشف مشكلات في الفحوص البنيوية الحالية.'
        else for(final e in issues.entries)'${labels[e.key]??e.key}: ${e.value}',
        '',
        if(hasLive)'قاعدة العمل تحتوي بيانات؛ لا يُسمح باستبدالها تلقائيًا.',
        'القيود والأرصدة التاريخية لم تُطابق بعد مع مصدر محاسبي معتمد.',
        'النتيجة: المراجعة فقط حتى اعتماد الترحيل. لا تُعاد ترحيل الحركات القديمة.',
      ].join('\n');
      await showDialog<void>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('تقرير جاهزية الاستعادة'),
        content:SingleChildScrollView(child:SelectableText(text)),
        actions:[
          TextButton(onPressed:() async {
            // Report contains only format and aggregate counts, no names or
            // record identifiers, to make sharing diagnostics safer.
            await Clipboard.setData(ClipboardData(text:text));
            if(ctx.mounted)Navigator.pop(ctx);
          },child:const Text('نسخ التقرير')),
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('إغلاق')),
        ]));
    }catch(_){await _message('تعذر فحص النسخة الحالية. ملف المصدر والبيانات لم يتغيرا.');}
    finally{if(mounted)setState(()=>_backupBusy=false);}
  }

  Future<void> _leaveReview({bool refreshView=true})async{
    if(_backupBusy)return;
    await _backups.closeReview();
    if(mounted)setState((){_review=false;if(refreshView)_viewGeneration++;});
  }

  Future<bool> _printCurrentPage(String title)async{
    final channel=_channel;
    if(!mounted||channel==null||_backupBusy)throw StateError('Print unavailable');
    return await channel.invokeMethod<bool>('printCurrentPage',title)==true;
  }

  static Future<Map<String,dynamic>> _shareText(Map<String,dynamic> p)async{
    final result=await const MethodChannel('nasqo/document_output').invokeMapMethod<String,dynamic>('shareText',{
      'title':p['title'],'text':p['text'],if(p['phone']!=null)'phone':p['phone']});
    if(result==null||result['opened']!=true)throw StateError('Share unavailable');
    return result;
  }

  MethodChannel? _channel;
  String? _error;

  Future<void> _attach(int viewId) async {
    _channel?.setMethodCallHandler(null);
    _back.dispose();
    _back = _newBackCoordinator();
    final channel = MethodChannel('nasqo/offline_hybrid/$viewId');
    _channel = channel;
    channel.setMethodCallHandler((call) async {
      if (call.method != 'message' || call.arguments is! String) return null;
      try {
        final raw = call.arguments as String;
        final response = _back.handleMessage(raw) ?? await _protocol.handle(raw);
        if (!mounted || channel != _channel) return null;
        await channel.invokeMethod<void>('respond', response);
      } catch (_) {
        if (mounted && channel == _channel) {
          // A lost acknowledgement may follow a successful SQLite commit.
          // Keep the WebView/draft in place and never retry the command here.
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('تعذر إيصال تأكيد العملية. تحقّق من السجل قبل إعادة المحاولة.'),
          ));
        }
      }
      return null;
    });

    try {
      // Prevent a bootstrap race: native WebView starts after this handler exists.
      await channel.invokeMethod<void>('start');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تشغيل WebView المحلي على جهاز Android.');
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _back.dispose();
    _channel?.setMethodCallHandler(null);
    unawaited(_documentOutput.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Android 16 draws transparent system bars over this scaffold. Match icon
    // contrast to the safe-area background even though the React UI has no AppBar.
    final barStyle = Theme.of(context).scaffoldBackgroundColor.computeLuminance() > 0.5
        ? SystemUiOverlayStyle.dark
        : SystemUiOverlayStyle.light;
    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_handleSystemBack());
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
      value: barStyle.copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.transparent,
      ),
      child: Scaffold(
      body: SafeArea(
        child: _error!=null
          ? Center(child:Padding(padding:const EdgeInsets.all(18),child:Text(_error!,textAlign:TextAlign.center)))
          : !_backupStateLoaded ? Center(child:Column(mainAxisSize:MainAxisSize.min,children:[Image.asset('assets/branding/nasqo_logo.png',width:180,height:180,fit:BoxFit.contain),const SizedBox(height:24),const CircularProgressIndicator(),const SizedBox(height:16),const Text('جاري تجهيز بيانات العمل…')])) : AndroidView(
              key:ValueKey(_viewGeneration),viewType:'nasqo/offline_hybrid',onPlatformViewCreated:_attach),
      ),
      ),
      ),
    );
  }
}
