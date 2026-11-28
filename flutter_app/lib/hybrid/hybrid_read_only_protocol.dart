import 'dart:convert';
import '../services/legacy_history_reports.dart';
import '../services/local_invoice_roles.dart';
import '../services/native_cloud_session.dart';

/// Minimal, fail-closed protocol endpoint for the offline React -> Flutter
/// bridge. It never accepts raw SQL, filesystem, or financial write commands.
///
/// The Android WebView host can pass received JSON to [handle], then deliver
/// its JSON response to window.__nasqoHybridReceive(...). Only explicitly
/// whitelisted appearance preferences may be written; financial data is read-only.
class HybridReadOnlyProtocol {
  // Whitelisted validation reasons only: never expose raw records or SQL errors.
  static String catalogValidationMessage(ArgumentError error) => switch(error.message) {
    'New item requires zero stock and cost; post purchases or an approved opening' => 'الصنف الجديد يبدأ برصيد وتكلفة صفر. سجّل تكلفة المخزون من فاتورة الشراء أو إجراء اعتماد المخزون.',
    'Duplicate item or barcode' => 'يوجد صنف بالاسم أو الباركود نفسه في المخزن. افتح الصنف الموجود للتعديل أو استخدم اسمًا وباركودًا مختلفين.',
    'Warehouse missing' => 'تعذر العثور على المخزن المحدد؛ اختر مخزنًا موجودًا قبل حفظ الصنف.',
    'Invalid identity' => 'معرّف الصنف أو العملية غير صالح؛ لم تُحفظ البيانات. أعد فتح بطاقة الصنف ثم حاول مجددًا.',
    'Catalog warehouse is selected when posting a purchase' => 'بطاقة الصنف لا تنشئ رصيدًا مخزنيًا؛ يُحدَّد المخزن عند تسجيل أول فاتورة شراء.',
    'Invalid unit conversion' || 'Only whole base units are supported' => 'معامل التحويل يجب أن يكون عددًا صحيحًا موجبًا، وأسماء الوحدات مختلفة.',
    'Third unit requires second unit' => 'أدخل الوحدة الثانية ومعاملها قبل الوحدة الثالثة.',
    'Default unit missing' => 'الوحدة الافتراضية غير معرّفة؛ اختر وحدة مكتملة البيانات.',
    'Stock posting supports only base currency' => 'عملة الصنف المحلي المدعومة حاليًا هي الريال؛ لم تُحفظ البيانات.',
    'Invalid expiry date' => 'تاريخ انتهاء الصنف غير صالح.',
    'Invalid amount' || 'Amount requires at most two decimal places' => 'السعر يجب أن يكون مبلغًا غير سالب بمنزلتين عشريتين كحد أقصى.',
    'Invalid name' => 'اسم الصنف لا يتجاوز 120 حرفًا.',
    'Invalid sku' => 'الباركود لا يتجاوز 64 حرفًا.',
    'Invalid unit' || 'Invalid unit2' || 'Invalid unit3' => 'اسم الوحدة لا يتجاوز 32 حرفًا.',
    _ => 'تعذر حفظ بيانات الصنف أو المخزن؛ راجع الاسم والباركود والوحدات والأسعار. لم تُحفظ البيانات.',
  };

  HybridReadOnlyProtocol({
    required this.readSnapshot,
    this.saveUiPreferences,
    this.saveWorkspaceSettings,
    this.completeBusinessSetup,
    this.recordRecentAction,
    this.createAccount,
    this.updateAccount,
    this.postDocument,
    this.manageDocument,
    this.createStockRecord,
    this.manageCatalog,
    this.saveErpRecords,
    this.readInventoryReport,
    this.readProductPriceStats,
    this.readInvoiceDetail,
    this.documentOutput,
    this.printCurrentPage,
    this.shareText,
    this.pickBackup,
    this.pickImportFile,
    this.openInvoiceRoles,
    this.openStockReconciliation,
    this.exportBackup,
    this.cloudAction,
    this.localToolsAction,
    this.legacyArchiveAction,
  });

  final Future<Map<String, dynamic>> Function() readSnapshot;
  final Future<void> Function(Map<String, dynamic>)? saveUiPreferences;
  final Future<Map<String,dynamic>> Function(Map<String,dynamic>)? saveWorkspaceSettings;
  final Future<Map<String,dynamic>> Function(Map<String,dynamic>)? completeBusinessSetup;
  final Future<Map<String,dynamic>> Function(String)? recordRecentAction;
  final Future<Map<String, dynamic>> Function(String, Map<String, dynamic>)? createAccount;
  final Future<Map<String, dynamic>> Function(String, String, Map<String, dynamic>)? updateAccount;
  final Future<Map<String,dynamic>> Function(String,Map<String,dynamic>)? postDocument;
  final Future<Map<String,dynamic>> Function(String,String,Map<String,dynamic>)? manageDocument;
  final Future<Map<String,dynamic>> Function(String,String,Map<String,dynamic>)? createStockRecord;
  final Future<Map<String,dynamic>> Function(String,String,Map<String,dynamic>)? manageCatalog;
  final Future<Map<String,dynamic>> Function(String,String,List<dynamic>)? saveErpRecords;
  final Future<Map<String,dynamic>> Function(Map<String,dynamic>)? readInventoryReport;
  final Future<Map<String,dynamic>> Function(String)? readProductPriceStats;
  final Future<Map<String,dynamic>> Function(String)? readInvoiceDetail;
  final Future<Map<String,dynamic>> Function(String,Map<String,dynamic>)? documentOutput;
  final Future<bool> Function(String)? printCurrentPage;
  final Future<Map<String,dynamic>> Function(Map<String,dynamic>)? shareText;
  final Future<Map<String,dynamic>?> Function()? pickBackup;
  final Future<Map<String,dynamic>?> Function(String)? pickImportFile;
  final Future<void> Function()? openInvoiceRoles;
  final Future<bool> Function(String?,String?)? openStockReconciliation;
  final Future<bool> Function()? exportBackup;
  final Future<dynamic> Function(String,String,Map<String,dynamic>)? cloudAction;
  final Future<Map<String,dynamic>> Function(String)? localToolsAction;
  final Future<Map<String,dynamic>> Function(Map<String,dynamic>)? legacyArchiveAction;
  static const String version = '1.0.0';
  static const int maxRequestLength = 32768;
  // Match src/hybrid/messageLimits.ts. The small control-message limit must
  // not silently discard valid 10,000-card imports or multi-line CRUD requests.
  static const int maxBulkRequestLength = 16 * 1024 * 1024;
  static int requestLengthLimit(String? action) {
    if (action == 'importInventoryItems' || action == 'importAccountCards') return maxBulkRequestLength;
    if (const {'saveErpRecords','batchUpdateInventoryItems','createLedgerEntry','updateLedgerEntry'}.contains(action)) return 2 * 1024 * 1024;
    return maxRequestLength;
  }

  Future<String> handle(String rawMessage) async {
    if (rawMessage.length > maxBulkRequestLength) {
      return _error('', null, 'VALIDATION_ERROR', 'حجم الرسالة غير مسموح به.');
    }

    Map<String, dynamic> request;
    try {
      final parsed = jsonDecode(rawMessage);
      if (parsed is! Map<String, dynamic>) {
        return _error('', null, 'VALIDATION_ERROR', 'تنسيق الرسالة غير صالح.');
      }
      request = parsed;
    } on FormatException {
      return _error('', null, 'VALIDATION_ERROR', 'JSON غير صالح.');
    }

    final requestId = request['requestId'];
    final action = request['action'];
    final id = requestId is String ? requestId : '';
    final actionName = action is String ? action : null;

    if (id.isEmpty || id.length > 150 ||
        request['protocolVersion'] != version ||
        request['kind'] != 'request') {
      return _error(id, actionName, 'VALIDATION_ERROR', 'إصدار البروتوكول أو معرف الطلب غير صالح.');
    }
    if (rawMessage.length > requestLengthLimit(actionName)) {
      // Preserve correlation so a bounded rejection reaches its caller at once.
      return _error(id, actionName, 'VALIDATION_ERROR', 'حجم بيانات العملية يتجاوز الحد المسموح. قلّل عدد السجلات أو طول النصوص.');
    }
    if(actionName=='saveErpRecords' && saveErpRecords!=null){
      final p=request['payload'],key=request['idempotencyKey'];
      if(p is! Map<String,dynamic>||p.keys.any((k)=>!['workspaceId','changes'].contains(k))||
          p['workspaceId']!='local-erp-workspace'||p['changes'] is! List||key is! String||key.isEmpty||key.length>150)
        return _error(id,actionName,'VALIDATION_ERROR','طلب حفظ إداري غير صالح.');
      try{
        final result=await saveErpRecords!(p['workspaceId'],key,p['changes']);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':{'erpData':result}});
      }catch(e){return _error(id,actionName,'VALIDATION_ERROR',e is StateError?e.message.toString():e is ArgumentError?e.message.toString():'تعذر حفظ السجل المحلي؛ بقيت المدخلات لإعادة المحاولة.');}
    }
    if(actionName=='cloudIdentityAction'||actionName=='googleDriveAction'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.keys.any((k)=>!['operation','args'].contains(k))||
        p['operation'] is! String||(p['operation'] as String).length>50||
        (p['args']!=null&&p['args'] is! Map<String,dynamic>))
        return _error(id,actionName,'VALIDATION_ERROR','طلب Google غير صالح.');
      const identityOps={'status','signIn','signOut'};
      const driveOps={'status','connect','disconnect','getAbout','listFiles','createFolder','findOrCreateFolder',
        'backupNative','overwriteNative','uploadLocal','restoreNative','saveFile','trashFile',
        'beginUpload','appendUpload','finishUpload','abortUpload'};
      if(!(actionName=='cloudIdentityAction'?identityOps:driveOps).contains(p['operation']))
        return _error(id,actionName,'VALIDATION_ERROR','إجراء Google غير مسموح.');
      final args=p['args'] as Map<String,dynamic>? ??{};
      if(args.keys.any((k)=>['accessToken','idToken','refreshToken','url','path','headers','password','clientSecret'].contains(k)))
        return _error(id,actionName,'VALIDATION_ERROR','لا يسمح بإرسال بيانات اعتماد أو مسارات عبر الجسر.');
      if(cloudAction==null)return _error(id,actionName,'UNAUTHORIZED_ACTION','خدمة Google غير متاحة.');
      try{
        final result=await cloudAction!(actionName!,p['operation'] as String,args);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }on NativeCloudException catch(e){return _error(id,actionName,e.code,e.message);}
      catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر إكمال طلب Google.');}
    }
    if(actionName=='legacyArchiveAction'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p['workspaceId']!='local-erp-workspace'||
        p.keys.any((k)=>!['workspaceId','operation','recordKind','recordId','sourceSha','offset','limit','query','read','dismissed'].contains(k))||
        !['offers','trash','alerts'].contains(p['recordKind'])||!['list','detail','alertState'].contains(p['operation'])||
        (p['recordId']!=null&&(p['recordId'] is! String||(p['recordId'] as String).length>100))||
        (p['sourceSha']!=null&&(p['sourceSha'] is! String||!RegExp(r'^[a-f0-9]{64}$').hasMatch(p['sourceSha'] as String)))||
        (p['query']!=null&&(p['query'] is! String||(p['query'] as String).length>100))||legacyArchiveAction==null)
        return _error(id,actionName,'VALIDATION_ERROR','طلب السجلات المستوردة غير صالح.');
      try{
        final result=await legacyArchiveAction!(p);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر قراءة السجل المستورد أو حفظ حالة التنبيه. أعد فتح القائمة.');}
    }
    if(actionName=='localToolsAction'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.length!=2||p['workspaceId']!='local-erp-workspace'||
        !['status','history','readiness','activate','leaveReview'].contains(p['operation'])||localToolsAction==null)
        return _error(id,actionName,'VALIDATION_ERROR','طلب أدوات البيانات غير صالح.');
      try{
        final result=await localToolsAction!(p['operation'] as String);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر فتح أدوات البيانات.');}
    }
    const outputActions=['beginDocumentExport','appendDocumentExport','finishDocumentExport','abortDocumentExport'];
    if(actionName!=null&&outputActions.contains(actionName)&&documentOutput!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic>)return _error(id,actionName,'VALIDATION_ERROR','بيانات المستند غير صالحة.');
      try{
        final result=await documentOutput!(actionName,p);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'VALIDATION_ERROR','تعذر تجهيز المستند المحلي أو حفظه. تحقق من المساحة والصيغة.');}
    }
    if((actionName=='printDocument'||actionName=='exportPdf')&&printCurrentPage!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.keys.any((k)=>!['title','kind','filename','accountId','entryId','allCurrencies'].contains(k))||
          p['title'] is! String||(p['title'] as String).isEmpty||(p['title'] as String).length>160||
          !['statement','invoice','inventory','purchases','trial-balance','report'].contains(p['kind'])||
          (p['allCurrencies']!=null&&p['allCurrencies'] is! bool))
        return _error(id,actionName,'VALIDATION_ERROR','طلب الطباعة غير صالح.');
      try{
        final opened=await printCurrentPage!(p['title'] as String);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,
          'ok':true,'data':{'opened':opened,'visiblePageOnly':true}});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر فتح معاينة طباعة Android.');}
    }
    if(actionName=='shareText'&&shareText!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.keys.any((k)=>!['workspaceId','title','text','phone'].contains(k))||
          p['workspaceId']!='local-erp-workspace'||p['title'] is! String||(p['title'] as String).length>200||
          p['text'] is! String||(p['text'] as String).isEmpty||(p['text'] as String).length>12000||
          (p['phone']!=null&&(p['phone'] is! String||!RegExp(r'^[0-9]{7,15}$').hasMatch(p['phone'] as String))))
        return _error(id,actionName,'VALIDATION_ERROR','بيانات المشاركة غير صالحة.');
      try{
        final result=await shareText!(p);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر فتح المشاركة على الهاتف.');}
    }
    if(actionName=='openStockReconciliation'&&openStockReconciliation!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p['workspaceId']!='local-erp-workspace'||
          p.keys.any((k)=>!['workspaceId','warehouseId','productId'].contains(k))||
          ['warehouseId','productId'].any((k)=>p[k]!=null&&(p[k] is! String||(p[k] as String).length>150)))
        return _error(id,actionName,'VALIDATION_ERROR','طلب مطابقة المخزون غير صالح.');
      try{
        final changed=await openStockReconciliation!(p['warehouseId'] as String?,p['productId'] as String?);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,
          'ok':true,'data':{'changed':changed}});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر فتح مطابقة المخزون المستورد.');}
    }
    if(actionName=='restoreLocalBackup'||actionName=='openInvoiceRoles'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.length!=1||p['workspaceId']!='local-erp-workspace')
        return _error(id,actionName,'VALIDATION_ERROR','معرف قاعدة العمل غير صالح.');
      try{
        if(actionName=='restoreLocalBackup'&&pickBackup!=null){
          final result=await pickBackup!();
          return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,
            'ok':true,'data':result??{'cancelled':true}});
        }
        if(actionName=='openInvoiceRoles'&&openInvoiceRoles!=null){
          await openInvoiceRoles!();
          return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':{}});
        }
        return _error(id,actionName,'UNAUTHORIZED_ACTION','الخدمة المحلية غير متاحة.');
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر إكمال العملية المحلية.');}
    }
    if(actionName=='getInventoryMovementsReport'||actionName=='getProductPriceStats'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p['workspaceId']!='local-erp-workspace')
        return _error(id,actionName,'VALIDATION_ERROR','معرف قاعدة العمل غير صالح.');
      try{
        Map<String,dynamic> result;
        if(actionName=='getInventoryMovementsReport'&&readInventoryReport!=null){
          if(p.keys.any((k)=>!['workspaceId','options'].contains(k)))throw ArgumentError('Invalid report parameters');
          final options=p['options']==null?<String,dynamic>{}:Map<String,dynamic>.from(p['options'] as Map);
          const filterKeys=['warehouseId','itemId','currency','fromDate','toDate','profitBasis','search'];
          if(options.keys.any((k)=>![...filterKeys,'movementOffset','movementLimit'].contains(k))||
              options.entries.any((e)=>filterKeys.contains(e.key)&&e.value!=null&&(e.value is! String||(e.value as String).length>150)))
            throw ArgumentError('Invalid report filters');
          final offset=options['movementOffset'],limit=options['movementLimit'];
          if(offset!=null&&(offset is! int||offset<0||offset>2147483647)||
              limit!=null&&(limit is! int||limit<1||limit>300))throw ArgumentError('Invalid report page');
          result=await readInventoryReport!(options);
        }else if(actionName=='getProductPriceStats'&&readProductPriceStats!=null){
          if(p.length!=2||p['itemId'] is! String||(p['itemId'] as String).length>150)throw ArgumentError('Invalid item');
          result=await readProductPriceStats!(p['itemId'] as String);
        }else{return _error(id,actionName,'UNAUTHORIZED_ACTION','خدمة التقرير غير متاحة.');}
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر قراءة التقرير المحلي.');}
    }
    if(actionName=='getHomeDashboardInput'){
      final p=request['payload'];
      if(p is! Map<String,dynamic> || p['workspaceId']!='local-erp-workspace' || p.keys.any((k)=>!['workspaceId','options'].contains(k)) || p['options'] is! Map<String,dynamic>)
        return _error(id,actionName,'VALIDATION_ERROR','نطاق الرئيسية غير صالح.');
      final options=p['options'] as Map<String,dynamic>;
      if(options.keys.any((k)=>!['currency','warehouseId','branchId','fromDate','toDate'].contains(k)) || options.values.any((v)=>v is! String||v.length>150) || options['branchId']!='main' || options['currency']=='الكل')
        return _error(id,actionName,'VALIDATION_ERROR','نطاق الرئيسية غير صالح.');
      try {
        final snapshot=await readSnapshot();
        if(snapshot['backupReview']==true) return _error(id,actionName,'UNAUTHORIZED_ACTION','هذه نسخة للمراجعة وليست مساحة عمل نشطة.');
        final currencies=snapshot['currencies'] as List? ?? const [];
        final warehouses=snapshot['warehouses'] as List? ?? const [];
        bool validDate(dynamic value) {
          if(value is! String||!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
          final parsed=DateTime.tryParse(value);
          return parsed!=null&&parsed.toIso8601String().substring(0,10)==value;
        }
        if(!currencies.any((c)=>c is Map&&c['name']==options['currency'])||
           !validDate(options['fromDate'])||!validDate(options['toDate'])||
           (options['fromDate'] as String).compareTo(options['toDate'] as String)>0||
           options['warehouseId'] is! String||
           options['warehouseId']!=''&&!warehouses.any((w)=>w is Map&&w['id'].toString()==options['warehouseId'])) {
          return _error(id,actionName,'VALIDATION_ERROR','راجع العملة والتاريخ والمخزن في نطاق الرئيسية.');
        }
        final cash=LegacyHistoryReports.cashboxes(snapshot,{'currency':options['currency'],'toDate':options['toDate']});
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':{'snapshot':snapshot,'cash':cash}});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر تحديث الرئيسية من البيانات المحلية.');}
    }
    if(actionName=='getCashboxesReport'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p['workspaceId']!='local-erp-workspace'||
          p.keys.any((k)=>!['workspaceId','options'].contains(k))||
          (p['options']!=null&&p['options'] is! Map<String,dynamic>)){
        return _error(id,actionName,'VALIDATION_ERROR','معطيات تقرير الصناديق غير صالحة.');
      }
      final options=p['options'] as Map<String,dynamic>? ?? <String,dynamic>{};
      if(options.keys.any((k)=>!['currency','fromDate','toDate'].contains(k))||
          options.values.any((v)=>v!=null&&(v is! String||v.length>100))){
        return _error(id,actionName,'VALIDATION_ERROR','معطيات التقرير غير صالحة.');
      }
      try{
        final report=LegacyHistoryReports.cashboxes(await readSnapshot(),options);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':report});
      }catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر حساب تقرير الصناديق المحلية.');}
    }
    if(actionName=='backupWorkspace'&&exportBackup!=null){
      final params=request['payload'];
      if(params is! Map<String,dynamic>||params['workspaceId']!='local-erp-workspace'||params['target']!='local'){
        return _error(id,actionName,'VALIDATION_ERROR','يجب اختيار النسخ الاحتياطي المحلي.');
      }
      try{
        final ok=await exportBackup!();
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,
          'ok':true,'data':{'saved':ok}});
      }catch(e){return _error(id,actionName,'SERVICE_UNAVAILABLE',e is StateError?e.message.toString():'تعذر تصدير النسخة المحلية؛ تحقق من مساحة التخزين.');}
    }
    if(actionName=='pickFile'){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.keys.any((k)=>!['purpose','accept'].contains(k))||
          !['restore-backup','import-items','import-accounts-csv'].contains(p['purpose'])){
        return _error(id,actionName,'UNAUTHORIZED_ACTION','نوع منتقي الملف غير مدعوم.');
      }
      try{
        final purpose=p['purpose'] as String;
        if(purpose=='restore-backup'&&pickBackup==null||purpose!='restore-backup'&&pickImportFile==null)
          return _error(id,actionName,'SERVICE_UNAVAILABLE','منتقي الملفات غير متاح.');
        final result=purpose=='restore-backup'?await pickBackup!():await pickImportFile!(purpose);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,
          'ok':true,'data':result??{'cancelled':true,'fileName':'','mimeType':'','sizeBytes':0,'base64Content':''}});
      }on FormatException catch(e){return _error(id,actionName,'VALIDATION_ERROR',e.message);}
      catch(_){return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر اختيار الملف؛ لم تُستورد بيانات.');}
    }
    if(actionName=='recordRecentAction' && recordRecentAction!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic> || p.length!=2 || p['workspaceId']!='local-erp-workspace' || p['action'] is! String)
        return _error(id,actionName,'VALIDATION_ERROR','إجراء غير صالح.');
      try {final result=await recordRecentAction!(p['action']);return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});}
      catch(_){return _error(id,actionName,'VALIDATION_ERROR','تعذر حفظ الإجراء الأخير.');}
    }
    if(actionName=='completeBusinessSetup' && completeBusinessSetup!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic> || p.length!=2 || p['workspaceId']!='local-erp-workspace' || p['input'] is! Map<String,dynamic> || request['idempotencyKey']!='business-setup-v1')
        return _error(id,actionName,'VALIDATION_ERROR','طلب التهيئة غير صالح.');
      try { final result=await completeBusinessSetup!(p['input']);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'VALIDATION_ERROR','تعذر إكمال التهيئة. راجع الحقول؛ لم تُحفظ تغييرات جزئية.');}
    }
    if(actionName=='saveWorkspaceSettings'&&saveWorkspaceSettings!=null){
      final p=request['payload'];
      if(p is! Map<String,dynamic>||p.length!=2||p['workspaceId']!='local-erp-workspace'||p['updates'] is! Map<String,dynamic>)
        return _error(id,actionName,'VALIDATION_ERROR','إعدادات المنشأة غير صالحة.');
      try{
        final result=await saveWorkspaceSettings!(p['updates'] as Map<String,dynamic>);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'VALIDATION_ERROR','لم تحفظ إعدادات المنشأة. تحقق من الاسم والعملة والإعدادات المدعومة.');}
    }
    if (actionName == 'saveUiPreferences') {
      final params = request['payload'];
      if (params is! Map<String, dynamic> ||
          params.length != 1 ||
          params['preferences'] is! Map<String, dynamic>) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'بيانات المظهر غير صالحة.');
      }
      final prefs = params['preferences'] as Map<String, dynamic>;
      const allowed = {
        'themeMode', 'brandColor', 'extendedSettings', 'homeTileLayout',
        'homeMetricOrder', 'widgetOrder', 'favorites', 'hapticsEnabled',
        'readNotifIds', 'dismissedNotifIds', 'lastBackupIso',
      };
      if (prefs.keys.any((key) => !allowed.contains(key)) ||
          (prefs['themeMode'] != null &&
              !const ['dark', 'light', 'system'].contains(prefs['themeMode'])) ||
          (prefs['brandColor'] != null && prefs['brandColor'] is! String) ||
          (prefs['hapticsEnabled'] != null && prefs['hapticsEnabled'] is! bool) ||
          (prefs['homeMetricOrder'] != null && prefs['homeMetricOrder'] is! List) ||
          (prefs['widgetOrder'] != null && prefs['widgetOrder'] is! List) ||
          (prefs['favorites'] != null && prefs['favorites'] is! List) ||
          (prefs['extendedSettings'] != null && prefs['extendedSettings'] is! Map) ||
          (prefs['homeTileLayout'] != null && prefs['homeTileLayout'] is! Map)) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'إعدادات المظهر غير صالحة.');
      }
      if (saveUiPreferences == null) {
        return _error(id, actionName, 'UNAUTHORIZED_ACTION',
            'حفظ إعدادات المظهر غير متاح.');
      }
      try {
        await saveUiPreferences!(prefs);
        return jsonEncode({
          'protocolVersion': version,
          'kind': 'response',
          'requestId': id,
          'action': actionName,
          'ok': true,
          'data': <String, dynamic>{},
        });
      } catch (_) {
        return _error(id, actionName, 'SERVICE_UNAVAILABLE',
            'تعذر حفظ إعدادات المظهر في SQLite.');
      }
    }

    if (actionName == 'saveAccount' && (createAccount != null || updateAccount != null)) {
      final params = request['payload'];
      final key = request['idempotencyKey'];
      if (key is! String || key.isEmpty || key.length > 150 ||
          params is! Map<String, dynamic> ||
          params['workspaceId'] != 'local-erp-workspace' ||
          (params['accountId'] != null && (params['accountId'] is! String || updateAccount == null)) ||
          (params['accountId'] == null && createAccount == null) ||
          params.keys.any((k) => !const ['workspaceId', 'payload', 'accountId'].contains(k)) ||
          params['payload'] is! Map<String, dynamic>) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'طلب إنشاء الحساب غير صالح.');
      }
      try {
        final data = params['payload'] as Map<String, dynamic>;
        final accountId = params['accountId'];
        final result = accountId == null
            ? await createAccount!(key,data)
            : await updateAccount!(key,accountId as String,data);
        return jsonEncode({
          'protocolVersion': version, 'kind': 'response',
          'requestId': id, 'action': actionName, 'ok': true, 'data': result,
        });
      } on ArgumentError {
        return _error(id, actionName, 'VALIDATION_ERROR', 'حقول الحساب غير مدعومة أو غير صالحة.');
      } catch (_) {
        return _error(id, actionName, 'SERVICE_UNAVAILABLE', 'تعذر تأكيد حفظ الحساب المحلي.');
      }
    }

    const catalogActions={'deleteAccountGroup','deleteCashbox','deleteWarehouse','saveCashbox','saveAccountGroup','saveCurrency','deleteCurrency','deleteAccount',
      'updateInventoryItem','deleteInventoryItem','importAccountCards','importInventoryItems','batchUpdateInventoryItems','saveWarehouse'};
    final rawCatalog=request['payload'];
    final warehouseEdit=actionName=='saveWarehouse'&&rawCatalog is Map&&rawCatalog['warehouseId']!=null;
    if(manageCatalog!=null&&catalogActions.contains(actionName)&&(actionName!='saveWarehouse'||warehouseEdit)){
      final key=request['idempotencyKey'],p=rawCatalog;
      if(key is! String||key.isEmpty||key.length>120||p is! Map<String,dynamic>||p['workspaceId']!='local-erp-workspace')
        return _error(id,actionName,'VALIDATION_ERROR','طلب إدارة البيانات غير صالح.');
      final fields=switch(actionName){
        'saveCashbox'||'saveAccountGroup'||'saveCurrency'=>{'workspaceId','payload'},
        'deleteAccountGroup'=>{'workspaceId','groupId'},
        'deleteCashbox'=>{'workspaceId','cashboxId'},
        'deleteWarehouse'=>{'workspaceId','warehouseId'},
        'deleteCurrency'=>{'workspaceId','currencyId'},
        'deleteAccount'=>{'workspaceId','accountId'},
        'updateInventoryItem'=>{'workspaceId','itemId','updates'},
        'deleteInventoryItem'=>{'workspaceId','itemId'},
        'importAccountCards'=>{'workspaceId','accounts'},
        'importInventoryItems'=>{'workspaceId','items','mode'},
        'batchUpdateInventoryItems'=>{'workspaceId','updates'},
        'saveWarehouse'=>{'workspaceId','payload','warehouseId'},
        _=><String>{},
      };
      if(p.keys.any((k)=>!fields.contains(k))||!p.keys.toSet().containsAll(fields))
        return _error(id,actionName,'VALIDATION_ERROR','حقول الطلب غير صالحة.');
      try{
        final result=await manageCatalog!(actionName!,key,p);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }on ArgumentError catch(e){
        return _error(id,actionName,'VALIDATION_ERROR',['updateInventoryItem','importInventoryItems'].contains(actionName)?catalogValidationMessage(e):'تحقق من بيانات الحساب أو العملة أو الصنف.');
      }on StateError catch(e){
        return _error(id,actionName,'VALIDATION_ERROR',e.message.toString());
      }catch(_){
        return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر تأكيد حفظ البيانات المحلية.');
      }
    }
    if ((actionName=='saveWarehouse'||actionName=='createInventoryItem') && createStockRecord!=null) {
      final params=request['payload'],key=request['idempotencyKey'];
      if(key is! String||key.isEmpty||key.length>120||params is! Map<String,dynamic>||
          params['workspaceId']!='local-erp-workspace'||params['warehouseId']!=null||
          params['payload'] is! Map<String,dynamic>||
          params.keys.any((k)=>!['workspaceId','payload','warehouseId'].contains(k))){
        return _error(id,actionName,'VALIDATION_ERROR','طلب إنشاء المخزن أو الصنف غير صالح.');
      }
      try{
        final result=await createStockRecord!(actionName!,key,params['payload'] as Map<String,dynamic>);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      } on ArgumentError catch(e) {
        return _error(id,actionName,'VALIDATION_ERROR',actionName=='saveWarehouse'
          ? (e.message=='Duplicate warehouse'?'يوجد مخزن بالاسم نفسه؛ اختر اسمًا مختلفًا.':'راجع اسم المخزن (حتى 100 حرف) ووصفه (حتى 300 حرف). لم يُحفظ المخزن.')
          : catalogValidationMessage(e));
      } catch(_){
        return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر حفظ بيانات المخزون محليًا.');
      }
    }
    if(actionName=='getInvoiceDetail'&&readInvoiceDetail!=null){
      final params=request['payload'];
      if(params is! Map<String,dynamic>||params['workspaceId']!='local-erp-workspace'||params['entryId'] is! String||params.length!=2){
        return _error(id,actionName,'VALIDATION_ERROR','طلب الفاتورة غير صالح.');
      }
      try{
        final result=await readInvoiceDetail!(params['entryId'] as String);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }catch(_){return _error(id,actionName,'NOT_FOUND','تعذر العثور على تفاصيل الفاتورة المحلية.');}
    }
    if(actionName!=null&&['updateLedgerEntry','setLedgerDeleted','permanentlyDeleteLedger'].contains(actionName)&&manageDocument!=null){
      final p=request['payload'],key=request['idempotencyKey'];
      final fields=switch(actionName){
        'updateLedgerEntry'=>{'workspaceId','entryId','payload'},
        'setLedgerDeleted'=>{'workspaceId','entryId','deleted'},
        _=>{'workspaceId','entryId'},
      };
      if(key is! String||key.isEmpty||key.length>150||p is! Map<String,dynamic>||
        p['workspaceId']!='local-erp-workspace'||p['entryId'] is! String||(p['entryId'] as String).length>150||
        p.keys.toSet().length!=fields.length||!p.keys.toSet().containsAll(fields)||
        (actionName=='updateLedgerEntry'&&p['payload'] is! Map<String,dynamic>)||
        (actionName=='setLedgerDeleted'&&p['deleted'] is! bool))
        return _error(id,actionName,'VALIDATION_ERROR','طلب تعديل المستند غير صالح.');
      try{
        final result=await manageDocument!(actionName,key,p);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,'action':actionName,'ok':true,'data':result});
      }on StateError catch(e){return _error(id,actionName,'VALIDATION_ERROR',e.message.toString());}
      catch(_){return _error(id,actionName,'VALIDATION_ERROR','تعذر تعديل المستند دون تغيير القيود أو المخزون.');}
    }
    if (actionName == 'createLedgerEntry' && postDocument != null) {
      final params = request['payload'];
      final key = request['idempotencyKey'];
      if (key is! String || key.isEmpty || key.length > 150 ||
          params is! Map<String,dynamic> || params['workspaceId'] != 'local-erp-workspace' ||
          params.length != 2 || params['payload'] is! Map<String,dynamic>) {
        return _error(id,actionName,'VALIDATION_ERROR','طلب الترحيل غير صالح.');
      }
      try {
        final result = await postDocument!(key,params['payload'] as Map<String,dynamic>);
        return jsonEncode({'protocolVersion':version,'kind':'response','requestId':id,
          'action':actionName,'ok':true,'data':result});
      } on InvoicePostingSetupRequired catch(e){
        return _error(id,actionName,'VALIDATION_ERROR',e.message);
      } on ArgumentError {
        return _error(id,actionName,'VALIDATION_ERROR','تحقق من الحسابات والعملة والكمية وإجمالي الفاتورة والضرائب والخصومات والمرتجع المرتبط.');
      } catch (_) {
        return _error(id,actionName,'SERVICE_UNAVAILABLE','تعذر تأكيد الترحيل المحلي؛ تحقق من السجل قبل المحاولة.');
      }
    }

    if (actionName != 'getSnapshot') {
      return _error(id, actionName, 'UNAUTHORIZED_ACTION',
          'الترحيل المالي عبر React معطّل إلى حين استكمال ضمانات SQLite.');
    }

    final payload = request['payload'];
    if (payload is! Map<String, dynamic> ||
        payload.keys.any((key) => key != 'workspaceId' && key != 'forceRefresh') ||
        (payload['workspaceId'] != null && payload['workspaceId'] is! String) ||
        (payload['forceRefresh'] != null && payload['forceRefresh'] is! bool)) {
      return _error(id, actionName, 'VALIDATION_ERROR', 'معطيات قراءة البيانات غير صالحة.');
    }

    try {
      final snapshot = await readSnapshot();
      if (snapshot['workspaceId'] is! String ||
          (snapshot['workspaceId'] as String).isEmpty ||
          const ['currencies', 'accountGroups', 'accounts', 'cashboxes',
            'ledger', 'warehouses', 'inventory']
              .any((key) => snapshot[key] is! List)) {
        return _error(id, actionName, 'VALIDATION_ERROR', 'لقطة بيانات Flutter غير مكتملة.');
      }

      return jsonEncode({
        'protocolVersion': version,
        'kind': 'response',
        'requestId': id,
        'action': actionName,
        'ok': true,
        'data': snapshot,
      });
    } catch (_) {
      // Do not expose database contents or internal errors to JavaScript.
      return _error(id, actionName, 'SERVICE_UNAVAILABLE',
          'تعذرت قراءة بيانات SQLite المحلية.');
    }
  }

  String _error(String id, String? action, String code, String message) {
    return jsonEncode({
      'protocolVersion': version,
      'kind': 'response',
      'requestId': id,
      if (action != null) 'action': action,
      'ok': false,
      'error': {'code': code, 'message': message, 'retryable': false},
    });
  }
}
