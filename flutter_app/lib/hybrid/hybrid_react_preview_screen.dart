import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import '../services/local_backup_restore.dart';
import '../services/legacy_operational_restore.dart';
import 'package:flutter/material.dart';
import '../screens/cloud_identity_screen.dart';
import '../screens/legacy_stock_opening_screen.dart';
import '../screens/legacy_history_screen.dart';
import '../screens/local_invoice_roles_screen.dart';
import '../services/local_invoice_roles.dart';
import '../services/stock_invoice_commands.dart';
import '../services/local_stock_catalog.dart';
import 'package:flutter/services.dart';
import 'hybrid_read_only_protocol.dart';
import '../services/local_account_commands.dart';
import '../services/local_document_commands.dart';
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

class _HybridReactPreviewScreenState extends State<HybridReactPreviewScreen> {
  late final HybridReadOnlyProtocol _protocol = HybridReadOnlyProtocol(
    readSnapshot: HybridLocalSnapshotAdapter.readFromDevice,
    saveUiPreferences: LocalDatabase.instance.saveUiPreferences,
    createAccount: (key,payload) => _saveAccount(key,payload),
    updateAccount: (key,id,payload) => _saveAccount(key,payload,accountId:id),
    postDocument: _postDocument,
    createStockRecord: _createStockRecord,
    readInvoiceDetail: _readInvoiceDetail,
    pickBackup: _restoreBackup,
    openInvoiceRoles: _openInvoiceRoles,
    openStockReconciliation: _openStockReconciliation,
    exportBackup: _exportBackup,
  );

  static Future<Map<String,dynamic>> _saveAccount(
      String key, Map<String,dynamic> payload, {String? accountId}) async {
    final id = await LocalAccountCommands(LocalDatabase.instance).save(
      HybridLocalSnapshotAdapter.workspaceId,key,payload,accountId:accountId);
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
    final account = (snapshot['accounts'] as List).cast<Map<String,dynamic>>()
      .firstWhere((a) => a['id'] == id);
    return {'account':account,'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _postDocument(String key,Map<String,dynamic> payload) async {
    final local=LocalDatabase.instance;
    final resolved=await LocalInvoiceRoles(local).resolve(payload);
    final isStock=resolved['invoiceContent']=='items'||resolved['kind']=='return';
    final id=isStock
      ? await StockInvoiceCommands(local).post(HybridLocalSnapshotAdapter.workspaceId,key,resolved)
      : await LocalDocumentCommands(local).post(HybridLocalSnapshotAdapter.workspaceId,key,resolved);
    final snapshot = await HybridLocalSnapshotAdapter.readFromDevice();
    final entry = (snapshot['ledger'] as List).cast<Map<String,dynamic>>()
        .firstWhere((e) => e['id'] == id);
    return {'entry':entry,'snapshot':snapshot};
  }

  static Future<Map<String,dynamic>> _createStockRecord(String action,String key,Map<String,dynamic> payload)async{
    final catalog=LocalStockCatalog(LocalDatabase.instance);
    final warehouse=action=='saveWarehouse';
    final id=warehouse?await catalog.createWarehouse(HybridLocalSnapshotAdapter.workspaceId,key,payload)
      :await catalog.createItem(HybridLocalSnapshotAdapter.workspaceId,key,payload);
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
    final row=(snapshot[warehouse?'warehouses':'inventory'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
    return {(warehouse?'warehouse':'item'):row,'snapshot':snapshot};
  }
  static Future<Map<String,dynamic>> _readInvoiceDetail(String id)async{
    final db=await LocalDatabase.instance.database;
    final archived=await db.transaction((txn)=>LocalBackupRestore.reviewInvoice(txn,id));
    if(archived!=null)return archived;
    final imported=await db.transaction((txn)=>LegacyOperationalRestore.invoice(txn,id));
    if(imported!=null)return imported;
    final snapshot=await HybridLocalSnapshotAdapter.readFromDevice();
    final entry=(snapshot['ledger'] as List).cast<Map<String,dynamic>>().firstWhere((e)=>e['id']==id);
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
    Future.wait<bool>([_backups.isReview(),LocalDatabase.instance.database.then(LocalDatabase.hasLegacyOperational)]).then((value){
      if(mounted)setState((){_review=value[0];_legacyOperational=value[1];_backupStateLoaded=true;});
    }).catchError((Object _){
      if(mounted)setState(()=>_error='تعذر التحقق من حالة قاعدة البيانات المحلية.');
    });
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
      return await Navigator.of(context).push(MaterialPageRoute<bool>(builder:(_)=>LegacyStockOpeningScreen(
        initialWarehouseId:warehouse,initialProductId:product)))==true;
    }finally{_stockReconciliationOpen=false;}
  }

  Future<void> _openInvoiceRoles()async{
    if(!mounted||_backupBusy||_review)throw StateError('Local working database required');
    await Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>const LocalInvoiceRolesScreen()));
  }

  Future<Map<String,dynamic>?> _restoreBackup({bool refreshView=false})async{
    if(_backupBusy)return null;
    setState(()=>_backupBusy=true);
    File? picked;
    try{
      final choice=await _backupChannel.invokeMapMethod<String,dynamic>('pickBackup');
      if(choice==null||!mounted)return null;
      picked=File(choice['path'] as String);
      final name=choice['fileName'] as String;
      final candidate=await _backups.inspect(picked,name);
      if(!mounted)return null;
      const labels={'accounts':'الحسابات','warehouses':'المخازن','inventory':'الأصناف','inventory_items':'الأصناف','ledger':'الحركات','ledger_entries':'الحركات','journal_entries':'القيود','invoice_lines':'بنود الفواتير'};
      final stats=candidate.counts.entries.where((e)=>labels.containsKey(e.key))
        .map((e)=>'${labels[e.key]}: ${e.value}').join('\n');
      final accept=await showDialog<String>(context:context,builder:(context)=>AlertDialog(
        title:Text(candidate.native?'استعادة قاعدة بيانات NASQO Android':candidate.legacy?'استعادة قاعدة بيانات تاريخية':'استيراد نسخة للمراجعة المحلية'),
        content:SingleChildScrollView(child:Text('$name\n\n$stats\n\n'+
          (candidate.native?'تُستعاد السجلات والقيود وطابور العمليات محليًا. إذا كانت هناك بيانات حالية، يجب حفظ نسخة متحقق منها وتأكيد الاستبدال أولًا.':
          candidate.legacy?'تستعيد الحسابات والحركات وبنود الفواتير وتحفظ الملف الأصلي. عند وجود بيانات محلية تُطلب نسخة أمان وتأكيد قبل الاستبدال. المخزون يحتاج اعتمادًا مستقلًا. يمكنك اختيار المراجعة فقط.':
          'ستحفظ النسخة الأصلية داخل SQLite وتعرض سجلاتها في مساحة مراجعة معزولة للقراءة فقط. لن تُعدّل بياناتك الحالية أو تُرحّل الأرصدة التاريخية تلقائيًا.'))),
        actions:[TextButton(onPressed:()=>Navigator.pop(context),child:const Text('إلغاء')),
          if(candidate.legacy)OutlinedButton(onPressed:()=>Navigator.pop(context,'review'),child:const Text('مراجعة فقط')),
          FilledButton(onPressed:()=>Navigator.pop(context,candidate.native?'native':candidate.legacy?'live':'review'),child:Text(candidate.native?'استعادة':candidate.legacy?'استعادة الحسابات للعمل':'استيراد وعرض'))]));
      if(accept==null||!mounted)return null;
      if(accept=='live'||candidate.native){
        if(accept=='live'&&!await _confirmActivation(candidate))return null;
        final protection=await _protectExistingData();
        if(!protection.proceed)return null;
        if(accept=='live'){
          await LegacyOperationalRestore(LocalDatabase.instance).activate(candidate,replacementSha:protection.sha);
        }else{
          await _backups.restoreNative(candidate,replacementSha:protection.sha);
        }
      }else{await _backups.openReview(candidate);}
      final legacy=await LocalDatabase.hasLegacyOperational(await LocalDatabase.instance.database);
      if(!mounted)return null;
      setState((){_review=accept=='review';_legacyOperational=legacy;_backupStateLoaded=true;if(refreshView)_viewGeneration++;});
      await _message(accept=='live'?'تمت استعادة الحسابات والحركات في قاعدة العمل المحلية. إعداد حسابات الترحيل مرة واحدة من الإعدادات؛ المخزون المستورد يحتاج اعتمادًا، والعملات المفقودة خارج الأرصدة.':candidate.native?'تمت استعادة النسخة المحلية بنجاح.':'تم حفظ الملف الأصلي وفتح البيانات التاريخية للمراجعة. يمكنك الرجوع إلى بياناتك الحالية من شريط التطبيق.');
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
        'لا يمكن البيع أو الشراء من الأصناف المستوردة قبل اعتماد الجرد والتكلفة. لن ترفع البيانات للسحابة.')),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('إلغاء')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('تفعيل الحسابات'))]))==true;
  }

  Future<void> _activateReviewed()async{
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
      if(!candidate.legacy)throw StateError('هذه الصيغة تحتاج مسار ترحيل آخر');
      if(!await _confirmActivation(candidate))return;
      final protection=await _protectExistingData();
      if(!protection.proceed)return;
      await LegacyOperationalRestore(LocalDatabase.instance).activate(candidate,replacementSha:protection.sha);
      if(mounted)setState((){_review=false;_legacyOperational=true;_viewGeneration++;});
      await _message('تم تفعيل الحسابات للعمل المحلي؛ المخزون يحتاج مطابقة.');
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
    if(_backupBusy)return false;
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
    }catch(_){await _message('تعذر تصدير النسخة المحلية.');return false;}
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

  Future<void> _leaveReview()async{
    if(_backupBusy)return;
    await _backups.closeReview();
    if(mounted)setState((){_review=false;_viewGeneration++;});
  }

  MethodChannel? _channel;
  String? _error;

  Future<void> _attach(int viewId) async {
    final channel = MethodChannel('nasqo/offline_hybrid/$viewId');
    _channel = channel;
    channel.setMethodCallHandler((call) async {
      if (call.method != 'message' || call.arguments is! String) return null;
      try {
        final response = await _protocol.handle(call.arguments as String);
        await channel.invokeMethod<void>('respond', response);
      } catch (_) {
        if (mounted) {
          setState(() => _error = 'تعذر قراءة SQLite المحلية أو إيصال رد Flutter إلى React.');
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
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('نسقو — واجهة React المحلية'),
        actions: [
          IconButton(
            tooltip: 'الحساب السحابي',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: _backupBusy || _review || !_backupStateLoaded ? null : () {
              Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const CloudIdentityScreen(),
              ));
            },
          ),
          IconButton(tooltip:'استيراد نسخة احتياطية',icon:const Icon(Icons.file_open),
            onPressed:_backupBusy?null:()=>_restoreBackup(refreshView:true)),
          IconButton(tooltip:'تصدير نسخة احتياطية',icon:const Icon(Icons.save_alt),
            onPressed:_backupBusy?null:_exportBackup),
          if(_legacyOperational||_review) IconButton(tooltip:'السجلات التاريخية',icon:const Icon(Icons.history),onPressed:_backupBusy?null:()async{
            await Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>const LegacyHistoryScreen()));
          }),
          if(_legacyOperational&&!_review) IconButton(tooltip:'اعتماد جرد المخازن',icon:const Icon(Icons.inventory_2_outlined),onPressed:_backupBusy?null:()async{
            final changed=await _openStockReconciliation(null,null);
            if(mounted&&changed)setState(()=>_viewGeneration++);
          }),
          if(_review) IconButton(tooltip:'تفعيل الحسابات المستوردة',icon:const Icon(Icons.play_circle_outline),onPressed:_backupBusy?null:_activateReviewed),
          if(_review) IconButton(tooltip:'تقرير جاهزية الاستعادة',icon:const Icon(Icons.fact_check_outlined),
            onPressed:_backupBusy?null:_showRestoreReadiness),
          if(_review) TextButton(onPressed:_backupBusy?null:_leaveReview,child:const Text('العودة للبيانات الحالية')),
          if (widget.onShowNative != null && !_review && !_legacyOperational && _backupStateLoaded && !_backupBusy)
            TextButton(
              onPressed: widget.onShowNative,
              child: const Text('واجهة Flutter'),
            ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            padding: const EdgeInsets.all(10),
            child: Text(
              _review?'نسخة تاريخية مستوردة — للقراءة فقط. اضغط أيقونة تقرير جاهزية الاستعادة لمعرفة ما يحتاج إلى تسوية.':
              _legacyOperational?'حسابات مستوردة للعمل المحلي — سجل تاريخي؛ المخزون والعملات غير المعتمدة بحاجة إلى تسوية.':
              'نسقو المحلي: استيراد وتصدير النسخ الاحتياطية من شريط التطبيق؛ المزامنة قيد التطوير.',
              textAlign: TextAlign.center,
            ),
          ),
          Expanded(
            child: _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Text(_error!, textAlign: TextAlign.center),
                    ),
                  )
                : !_backupStateLoaded ? const Center(child:CircularProgressIndicator()) : AndroidView(
                    key:ValueKey(_viewGeneration),
                    viewType: 'nasqo/offline_hybrid',
                    onPlatformViewCreated: _attach,
                  ),
          ),
        ],
      ),
    );
  }
}
