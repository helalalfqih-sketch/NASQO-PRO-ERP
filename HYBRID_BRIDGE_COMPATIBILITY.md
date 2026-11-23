# NASQO PRO ERP — وثيقة التوافق والمواءمة بين الجسرين (`HYBRID_BRIDGE_COMPATIBILITY.md`)

> **ملاحظة شفافية وحدود الاطلاع**:
> هذه البيئة لا تملك وصولًا مباشرًا إلى المستودع البعيد `helalalfqih-sketch/nasqo-pro-mobile` أو الفرع `integration/hybrid-seven-20261121` أو ملفات Commit `0d734ca` (`HybridHomeView.kt`, `flutter_app/lib/hybrid/hybrid_home_view.dart`, `qa/hybrid_home/host.tsx`, `qa/hybrid_home/build.mjs`).
> لذلك بُنيت هذه المقارنة على المعلومات الموثّقة في طلب التكامل ومعيار `AndroidX WebViewCompat.addWebMessageListener`، مع تحديد صريح لكل نقطة تتطلب تحقق فريق Flutter مقابل الشفرة الفعلية في `0d734ca` قبل الدمج.

---

## 1. مقارنة معمارية: `NasqoHome` (الموجود في `0d734ca`) مقابل `NasqoFlutterBridge`

| البُعد التقني | التنفيذ القائم على Android (`0d734ca`) | التنفيذ المحدّث في حزمة React Hybrid (الدفعة 2) | قرار التوافق وإعادة الاستخدام |
|---|---|---|---|
| **مكوّن العرض (WebView)** | PlatformView واحد عبر Kotlin `HybridHomeView.kt` مع `WebViewCompat` | نفس حزمة `dist/hybrid/` تعمل داخل **نفس `WebView` الواحد** دون أي WebView ثانٍ | ✅ **إعادة استخدام WebView واحد فقط** — يُمنع إنشاء WebView ثانٍ لتفادي استهلاك الذاكرة وتضارب حالة SQLite وزر الرجوع |
| **كائن الجسر داخل JS** | `window.NasqoHome` (عبر `WebViewCompat.addWebMessageListener`) | `src/hybrid/bridge.ts` يكتشف ويُعطي **الأولوية الأولى** لـ `window.NasqoHome`، مع احتفاظ اختياري بـ `window.NasqoFlutterBridge` ثم `flutter_inappwebview` | ✅ **توافق مباشر بدون تغيير اسم الكائن في Kotlin** |
| **إرسال الرسائل من JS إلى Android** | `window.NasqoHome.postMessage(jsonString)` | `NasqoHybridBridge.resolveTransport()` يستدعي `window.NasqoHome.postMessage(JSON.stringify(envelope))` | ✅ متطابق 100% مع `WebMessageListener` |
| **استقبال الردود والأحداث من Android إلى JS** | عبر `JavaScriptReplyProxy.postMessage(json)` → `window.NasqoHome.addEventListener("message", e => ...)` أو `evaluateJavascript` | `NasqoHybridBridge.bindGlobalReceiver()` يربط **القناتين معًا**:<br>1) `window.NasqoHome.addEventListener("message", e => handleInbound(e.data))`<br>2) `window.__nasqoHybridReceive(rawMessage)` | ✅ يعمل فورًا سواء أرسل `HybridHomeView.kt` الرد عبر `JavaScriptReplyProxy.postMessage` أو عبر `evaluateJavascript("window.__nasqoHybridReceive(...)")` |
| **قناة التواصل بين Kotlin وDart** | Flutter `MethodChannel("nasqo/home/$id")` في `hybrid_home_view.dart` | React لا يتخاطب مع `MethodChannel` مباشرة؛ كل رسالة تمر عبر `window.NasqoHome` ← `HybridHomeView.kt` ← `MethodChannel("nasqo/home/$id")` ← `hybrid_home_view.dart` ← SQLite | ✅ يحافظ على نفس المسار الهندسي المجتاز لاختبارات Android في `0d734ca` |
| **أدوات البناء والاختبار المحلية** | `qa/hybrid_home/host.tsx` و `qa/hybrid_home/build.mjs` (تُترك كما هي في الفرع للمقارنة/الرجوع) | `vite.hybrid.config.ts` و `scripts/build-hybrid.mjs` تنتج `dist/hybrid/` المستقلة + `scripts/verify-hybrid-home.mjs` تختبر عبر `window.NasqoHome` | ⚠️ لا تستبدل `qa/hybrid_home/host.tsx` فجأة؛ اختبر الحزمة الجديدة خلف feature flag أو في فرع فرعي من `integration/hybrid-seven-20261121` ثم بدّل بعد اجتياز اختبارات Android |

---

## 2. آلية إعادة استخدام `HybridHomeView.kt` الواحد دون إضافة WebView ثانٍ

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Flutter UI (flutter_app/lib/hybrid/hybrid_home_view.dart)               │
│  └─ AndroidView / PlatformView ("nasqo/home/$id")                       │
│      └─ MethodChannel("nasqo/home/$id")  <─── مصدر البيانات: SQLite    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ (JSON String Envelope — protocolVersion: "1.0.0")
┌───────────────────────────────▼─────────────────────────────────────────┐
│ Kotlin (HybridHomeView.kt — نفس WebView الواحد الموجود في 0d734ca)     │
│  ├─ WebViewAssetLoader: يحمّل dist/hybrid/ محليًا (بدون إنترنت)         │
│  ├─ WebViewCompat.addWebMessageListener(webView, "NasqoHome", ...)      │
│  │    ├─ onPostMessage → يمرّر النص إلى MethodChannel("nasqo/home/$id") │
│  │    └─ replyProxy.postMessage(respJson) → يصل لـ NasqoHome listener   │
│  └─ أحداث النظام (backPressed / themeChanged / snapshotUpdated):        │
│       يُرسلها عبر replyProxy.postMessage(eventJson)                     │
│       أو evaluateJavascript("window.__nasqoHybridReceive(...)")         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ window.NasqoHome
┌───────────────────────────────▼─────────────────────────────────────────┐
│ React Hybrid (dist/hybrid/index.html — src/hybrid/bridge.ts)            │
│  ├─ أولوية النقل: NasqoHome (1) → NasqoFlutterBridge (2) → inapp (3)    │
│  ├─ لا يحتوي mockFlutter ولا بيانات اختبارية نهائيًا (mockHostStripped) │
│  └─ CSP: connect-src 'none' (صفر اتصالات شبكية خارجية)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### خطوة مهمة للمواءمة في `hybrid_home_view.dart` (في حال اختلف شكل JSON في `0d734ca`)
بما أننا لم نطلع على نص `hybrid_home_view.dart` في `0d734ca`، يوجد احتمالان لشكل الرسائل الحالي داخل `MethodChannel("nasqo/home/$id")`:
1. **الاحتمال أ (مغلف `protocolVersion: "1.0.0"` موحّد)**: يُمرَّر المغلف مباشرة إلى موجه الأوامر في Dart (`action`, `requestId`, `payload`, `idempotencyKey`) ويُعاد الرد بنفس `requestId`.
2. **الاحتمال ب (مغلف قديم في `0d734ca` يستخدم أسماء حقول مختلفة مثل `type`/`cmd` بدل `action`)**: أضف **محول بروتوكول صغير (`NasqoProtocolAdapter`) داخل `hybrid_home_view.dart`** يفحص وجود `protocolVersion == "1.0.0"` ويوجهه للمعالج الجديد، مع إبقاء المسار القديم عاملًا حتى اكتمال التحقق على Android. بهذه الطريقة **لا ينكسر أي اختبار قائم من اختبارات `0d734ca`** وتبقى نقطة الدخول WebView واحدة.

---

## 3. تصنيف جميع أوامر الجسر وأحداثه (تغطية 100% من `HYBRID_ALLOWED_COMMANDS` و `HYBRID_HOST_EVENTS`)

### أ) أوامر الدفعة 1 (الشاشة الرئيسية — أولوية التكامل الفوري)

| الأمر (`action`) | متطلب في الدفعة 1 | التصنيف في Flutter (`integration/hybrid-seven-20261121`) | ملاحظات التنفيذ في Dart / SQLite |
|---|---|---|---|
| `getSnapshot` | ✅ إلزامي | **متوقع وجود نظير له في `0d734ca` (يتطلب تحققًا من تطابق الحقول)** | يجب إرجاع `workspaceId` ومصفوفات `currencies`, `accountGroups`, `accounts`, `cashboxes`, `ledger`, `warehouses`, `inventory`, و`uiPreferences` و`capabilities` |
| `navigate` | ✅ إلزامي | **متوقع وجوده في `0d734ca` (يتطلب تحققًا من أسماء المسارات)** | يستقبل المسارات القانونية في `src/hybrid/routes.ts` (`purchases`, `sales`, `clients`, `transfers`, `shop`, `settings`, `inventory-report`, إلخ) مرة واحدة لكل نقرة |
| `goBack` | ✅ إلزامي | **متوقع وجوده في `0d734ca` (يتطلب تحققًا)** | يُرسل عند وصول `FlowStack` للجذر (`stackDepth: 1`) ليقرر Flutter إغلاق الشاشة/التطبيق |
| `changeCurrency` | ✅ إلزامي | **يتطلب تحققًا أو إضافة معالج جديد في Dart** | يستقبل `{ scope, targetId, currency }` ويحفظ/يحدّث العملة النشطة دون دمج عملات |
| `saveUiPreferences` | ✅ إلزامي | **يتطلب تطويرًا جديدًا في Dart (SQLite أو `SharedPreferences`)** | يحفظ `themeMode`, `brandColor`, و`homeTileLayout` (`order`, `pinned`, `hidden`, `toneOverrides`) ويعيد `{ saved: true }` |
| `openInvoice` | ✅ اختياري/مسار سريع | **يتطلب تحققًا أو ربطًا بشاشة الفواتير الأصلية في Dart** | يستقبل `{ intent, accountId?, entryId?, kindOverride? }` |
| `openVoucher` | ✅ اختياري/مسار سريع | **يتطلب تحققًا أو ربطًا بشاشة السندات في Dart** | يستقبل `{ accountId?, entryId? }` |
| `openAccountStatement` | ✅ اختياري/مسار سريع | **يتطلب تحققًا أو ربطًا بكشف الحساب في Dart** | يستقبل `{ accountId, currency? }` |
| `showMessage` | ✅ إلزامي | **يتطلب تحققًا أو ربطًا بـ `ScaffoldMessenger` / Toast** | يستقبل `{ message, level: "info"|"success"|"warning"|"error" }` |

### ب) أوامر الخدمات الأصلية للجهاز (تُفعّل في الدفعات 2–5)

| الأمر (`action`) | الحالة في الدفعة 1 | التصنيف في Flutter | ملاحظات |
|---|---|---|---|
| `printDocument` | مؤجّل (`capabilities.printingSupported: false` إن لم يجهز) | **يتطلب تطويرًا جديدًا في Dart** | ربط بحزمة الطباعة الأصلية في Android (`printing` / `PrintManager`) |
| `exportPdf` | مؤجّل (`capabilities.pdfExportSupported: false` إن لم يجهز) | **يتطلب تطويرًا جديدًا في Dart** | توليد وحفظ/مشاركة PDF عبر Storage Access Framework |
| `pickFile` | مؤجّل (`capabilities.filePickerSupported: false` إن لم يجهز) | **يتطلب تطويرًا جديدًا في Dart** | اختيار ملف النسخة الاحتياطية/الاستيراد/الشعار عبر Android SAF |
| `googleDriveAction` | مؤجّل (`capabilities.googleDriveConfigured: false`) | **يتطلب تطويرًا جديدًا في Dart** | المصادقة والنسخ السحابي عبر Google Sign-In/Drive الأصلي في Flutter |

### ج) أوامر القراءة والتقارير المحاسبية (لا تعدّل قاعدة البيانات — للدفعات 2–4)

| الأمر (`action`) | يتطلب `idempotencyKey` | التصنيف في Flutter | ملاحظات SQLite |
|---|---|---|---|
| `getInventoryMovementsReport` | لا | **يتطلب تطويرًا جديدًا في Dart/SQLite** | حركة المخازن والكمية المتبقية الفعلية لكل مخزن ولكل عملة |
| `getCashboxesReport` | لا | **يتطلب تطويرًا جديدًا في Dart/SQLite** | أرصدة الصناديق مفصولة حسب العملة دون دمج |
| `getInvoiceDetail` | لا | **يتطلب تطويرًا جديدًا في Dart/SQLite** | قراءة رأس الفاتورة وبنودها المخزنية والحرة |
| `getProductPriceStats` | لا | **يتطلب تطويرًا جديدًا في Dart/SQLite** | أقل/أعلى/آخر سعر للصنف |

### د) أوامر الكتابة والترحيل المالي والمخزني (محظورة في الدفعة 1 في كل من JS وDart!)

| الأمر (`action`) | يتطلب `idempotencyKey` + `db.transaction` | الحالة في الدفعة 1 | التصنيف في Flutter |
|---|---|---|---|
| `saveWorkspaceSettings` | لا (تحديث إعدادات المنشأة) | مرفوض في الدفعة 1 أو للدفعة 5 | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `saveAccountGroup` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `saveCurrency` / `deleteCurrency` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `saveAccount` / `deleteAccount` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `createLedgerEntry` / `updateLedgerEntry` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `setLedgerDeleted` / `permanentlyDeleteLedger` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `saveWarehouse` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `createInventoryItem` / `updateInventoryItem` / `deleteInventoryItem` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `importInventoryItems` / `batchUpdateInventoryItems` | **نعم (إلزامي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `saveErpData` | لا (بيانات وحدات ERP) | للدفعة 5 | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `backupWorkspace` | لا (قراءة/تصدير نسخة) | للدفعة 5 (يدوي فقط) | **يتطلب تطويرًا جديدًا في Dart/SQLite** |
| `restoreWorkspace` / `resetWorkspace` | **نعم (إلزامي + تأكيد أصلي)** | **محظور في الدفعة 1 (Dart + JS)** | **يتطلب تطويرًا جديدًا في Dart/SQLite** |

### هـ) أحداث المضيف المدفوعة من Flutter إلى React (`HYBRID_HOST_EVENTS`)

| الحدث (`event`) | مطلوب في الدفعة 1 | التصنيف في Flutter | الغرض |
|---|---|---|---|
| `snapshotUpdated` | ✅ إلزامي | **متوقع وجوده أو يتطلب مواءمة في `0d734ca`** | تحديث الشاشة الرئيسية فور تغير أي جدول في SQLite |
| `backPressed` | ✅ إلزامي | **متوقع وجوده في `0d734ca` (`PopScope`)** | تمرير زر الرجوع الفيزيائي في Android إلى `FlowStack` |
| `themeChanged` | ✅ إلزامي | **يتطلب تحققًا أو إضافة في `hybrid_home_view.dart`** | تبديل فوري بين الوضعين الفاتح والداكن (`light`/`dark`/`system`) |
| `currencyChanged` | ✅ مستحسن | **يتطلب تطويرًا جديدًا في Dart** | مزامنة تغيير العملة إذا حدث من شاشة Flutter أصلية |
| `uiPreferencesUpdated` | ✅ مستحسن | **يتطلب تطويرًا جديدًا في Dart** | دفع تفضيلات الواجهة المحدّثة إلى WebView |
| `routeChanged` | اختياري للدفعة 1 | **يتطلب تحققًا في `0d734ca`** | توجيه WebView برمجيًا إلى مسار محدد |
| `serviceError` | ✅ مستحسن | **يتطلب تطويرًا جديدًا في Dart** | إظهار تنبيه خطأ صادق في الواجهة عند فشل خدمة خلفية |

---

## 4. الدفاع المتعمّق للأمان المالي (Defense-in-Depth) — عدم الاعتماد على `readOnlyFinancial` وحده

> **قاعدة أمنية قاطعة**:
> الحقل `capabilities.readOnlyFinancial: true` داخل `src/hybrid/bridge.ts` هو **طبقة حماية واجهة فقط (Client-side UX Guard)** لمنع إرسال طلبات كتابة مالية غير مقصودة من الشاشة الرئيسية في الدفعة 1.
> **لا يجوز إطلاقًا اعتباره الحماية الوحيدة**؛ لأن شيفرة JavaScript داخل WebView تُعد بيئة غير موثوقة (Untrusted Client) بالنسبة لمحرك الحسابات.

### الطبقات الثلاث الإلزامية في Dart وSQLite

#### الطبقة 1 — رفض الصلاحيات مستقلًا في Dart (Independent Server-Side/Host Allowlist)
في `hybrid_home_view.dart` (أو `NasqoBridgeRouter`):
- يحتفظ Dart بقائمة بيضاء صريحة (`const Set<String> batch1AllowedActions = {'getSnapshot', 'navigate', 'goBack', 'changeCurrency', 'saveUiPreferences', 'openInvoice', 'openVoucher', 'openAccountStatement', 'showMessage'};`).
- أي أمر مالي يصل عبر `NasqoHome` وهو غير مُدرج في القائمة المسموحة للدفعة الحالية **يُرفض فورًا في Dart** برد `{ ok: false, error: { code: "UNAUTHORIZED_ACTION", message: "..." } }` حتى لو تم التلاعب بـ JavaScript أو إرسال `readOnlyFinancial: false`.
- يُفحص كل `payload` بشكل متكرر في Dart لرفض أي مفاتيح محظورة (`sql`, `rawSql`, `execSql`, `sqliteQuery`, `shellCommand`, `__proto__`).

#### الطبقة 2 — منع الترحيل المتكرر في SQLite عبر `UNIQUE(idempotency_key)` + `db.transaction`
عند تفعيل أوامر الترحيل المالي في الدفعات اللاحقة، يجب إنشاء جدول مفاتيح عدم التكرار داخل نفس قاعدة SQLite:

```sql
CREATE TABLE IF NOT EXISTS bridge_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
```

وتُنفّذ كل عملية مالية داخل **معاملة SQLite ذرّية واحدة (`db.transaction`)**:

```dart
Future<Map<String, dynamic>> executeIdempotentFinancialCommand({
  required Database db,
  required String action,
  required String idempotencyKey,
  required String requestHash,
  required Future<Map<String, dynamic>> Function(Transaction txn) work,
}) async {
  if (idempotencyKey.trim().length < 6) {
    return _error('VALIDATION_ERROR', 'Missing mandatory idempotencyKey');
  }

  return db.transaction((txn) async {
    // 1. تحقق داخل نفس المعاملة الذرية هل نُفّذ المفتاح سابقًا
    final existing = await txn.query(
      'bridge_idempotency_keys',
      where: 'idempotency_key = ?',
      whereArgs: [idempotencyKey],
      limit: 1,
    );
    if (existing.isNotEmpty) {
      if (existing.first['request_hash'] != requestHash) {
        return _error('DUPLICATE_REQUEST', 'Idempotency key reused with different payload');
      }
      // إرجاع النتيجة السابقة بدون إعادة ترحيل أي قيد أو خصم مخزون!
      return jsonDecode(existing.first['response_json'] as String) as Map<String, dynamic>;
    }

    // 2. تنفيذ الترحيل المالي وتحديث المخزون داخل نفس txn
    final result = await work(txn);

    // 3. تسجيل المفتاح والنتيجة في نفس المعاملة؛ إذا فشلت أي خطوة يتم Rollback كامل
    await txn.insert(
      'bridge_idempotency_keys',
      {
        'idempotency_key': idempotencyKey,
        'action': action,
        'request_hash': requestHash,
        'response_json': jsonEncode(result),
        'created_at_ms': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.abort,
    );
    return result;
  });
}
```

#### الطبقة 3 — تجريد حزمة الإنتاج من المحاكي والبيانات الاختبارية (`mockFlutter=1` غير موجود نهائيًا)
- تم فصل `src/hybrid/mockFlutterHost.ts` و `src/hybrid/homeFixture.ts` بالكامل عن شجرة استيراد `src/hybrid/entry.tsx`.
- يقوم سكربت البناء `scripts/build-hybrid.mjs` بفحص **كل ملف HTML/JS/CSS** في `dist/hybrid/` ويفشل البناء فورًا إذا وُجد أي أثر لـ `mockFlutter` أو `installMockFlutterHost` أو `__nasqoMockBridgeLog` أو أسماء حسابات/أصناف الاختبار.
- يؤكد `hybrid-manifest.json` ذلك بحقل `"mockHostStripped": true`، وتتحقق منه كل من اختبارات الوحدة (`tests/hybrid.test.ts`) واختبار المتصفح رقم 11 (`11_prod_bundle_blocks_mockFlutter_param`).

---

## 5. قائمة التحقق الموصى بها لفريق Flutter عند الدمج في `integration/hybrid-seven-20261121`

1. أنشئ فرع تجربة فرعي من `integration/hybrid-seven-20261121` دون المساس بـ Commit `0d734ca` أو قناة إصدار APK.
2. راجع الفروقات المستقلة في مجلد `patches/` قبل تطبيق أي تعديل على ملفات React القائمة.
3. انسخ `dist/hybrid/` إلى مسار الأصول الذي يقرؤه `HybridHomeView.kt` (وتحقق من مطابقة `SHA256SUMS.txt`).
4. تأكد في `HybridHomeView.kt` أن `WebViewCompat.addWebMessageListener` مسجل باسم `"NasqoHome"` وأن الردود تُرسل عبر `JavaScriptReplyProxy.postMessage(json)` أو `window.__nasqoHybridReceive(...)`.
5. فعّل القائمة البيضاء في Dart (`batch1AllowedActions`) للدفعة 1 بحيث يرفض Dart أي أمر ترحيل مالي مستقلًا عن JS.
6. شغّل اختبارات Android (`flutter test` + اختبارات التكامل على جهاز/محاكي Android) للتحقق من:
   - استقبال `getSnapshot` الحقيقي من SQLite (وليس بيانات اختبار).
   - تعدد العملات وإشارات الأرصدة (`له`/`عليه`).
   - تبديل العملة وحفظ تفضيلات بطائق الرئيسية (`saveUiPreferences`).
   - زر الرجوع الفيزيائي (`backPressed` / `goBack`) والوضعين الفاتح والداكن.
