# NASQO PRO ERP — عقد جسر التواصل بين Flutter وReact (`HYBRID_BRIDGE_CONTRACT.md`)

إصدار البروتوكول: **`1.0.0`**  
اسم القناة الأساسية (الأولوية الأولى — متوافق مع Android `WebViewCompat` في `HybridHomeView.kt`): **`window.NasqoHome`** (`postMessage` + `addEventListener("message", ...)`)  
القنوات البديلة المدعومة تلقائيًا: **`window.NasqoFlutterBridge`** ثم **`window.flutter_inappwebview.callHandler("NasqoFlutterBridge", json)`**  
دالة الاستقبال البديلة داخل WebView: **`window.__nasqoHybridReceive(jsonOrObject)`**

> راجع أيضًا [`HYBRID_BRIDGE_COMPATIBILITY.md`](./HYBRID_BRIDGE_COMPATIBILITY.md) لتفاصيل المواءمة مع تنفيذ `0d734ca` (`HybridHomeView.kt` و `MethodChannel("nasqo/home/$id")`) وتصنيف جميع الأوامر.

---

## 1. المبادئ الأمنية والمحاسبية الإلزامية (Defense-in-Depth)

1. **مصدر الحقيقة الوحيد**: قاعدة SQLite المحلية داخل طبقة `Dart / Flutter` هي المصدر الوحيد لأرصدة الحسابات، الفواتير، السندات، المخازن، الصناديق، والتقارير.
2. **منع SQL المباشر من JavaScript**: لا يقبل الجسر أي أوامر SQL أو أسماء جداول حرة أو مفاتيح محظورة (`sql`, `rawSql`, `execSql`, `sqliteQuery`, `shellCommand`, `commandLine`, `evalCode`, `__proto__`). يتم رفضها قبل إرسالها من React، ويجب على Dart رفضها مجددًا عند الاستقبال.
3. **قائمة بيضاء صارمة (`Allowlist`) في الطرفين**: لا يُسمح إلا بالأوامر المدرجة في `HYBRID_ALLOWED_COMMANDS` ضمن `src/hybrid/contracts.ts`. **ويجب على Dart فرض قائمته البيضاء الخاصة مستقلًا**؛ لا يُعد حقل `capabilities.readOnlyFinancial` في JavaScript حماية كافية وحده.
4. **منع تكرار الترحيل المالي (`Idempotency`) الذرّي في SQLite**:
   - كل عملية مالية أو مخزنية تتضمن حقلي `requestId` و `idempotencyKey`.
   - يمنع `NasqoHybridBridge` إرسال نفس العملية مرتين بالتوازي (`DUPLICATE_REQUEST`).
   - **إلزامي في Dart/SQLite**: تنفيذ كل عملية مالية داخل `db.transaction` واحدة مع قيد `UNIQUE(idempotency_key)` في جدول `bridge_idempotency_keys` وإرجاع النتيجة المخزنة دون إعادة ترحيل إذا وصل نفس المفتاح مرة أخرى.
5. **لا نجاح وهمي ولا بيانات اختبار في الإنتاج**:
   - لا يعرض React رسالة نجاح لأي فاتورة أو سند أو تعديل إلا بعد استلام `{ "ok": true }` من Flutter.
   - حزمة الإنتاج `dist/hybrid/` مجرّدة بالكامل من `mockFlutter=1` ومن بيانات الاختبار (`mockHostStripped: true`).

---

## 2. صيغة الرسائل (`JSON Envelope`)

### أ) رسالة طلب من React إلى Flutter (`request`)

```json
{
  "protocolVersion": "1.0.0",
  "kind": "request",
  "requestId": "req_createLedgerEntry_1732200000_1_a9f2k",
  "action": "createLedgerEntry",
  "idempotencyKey": "idem_createLedgerEntry_acc_sup_1_1732200000_1_x7k2p1",
  "timestampMs": 1732200000000,
  "payload": {
    "workspaceId": "local-erp-workspace",
    "payload": {
      "accountId": "acc_sup_1",
      "accountName": "مؤسسة البراري للتوريد",
      "kind": "invoice",
      "direction": "credit",
      "payment": "credit",
      "amount": 15000,
      "currency": "ريال",
      "exchangeRate": 1,
      "entryDate": "2026-11-21",
      "details": "فاتورة شراء بضاعة",
      "lines": []
    }
  }
}
```

### ب) رسالة رد من Flutter إلى React (`response`)

**عند النجاح:**

```json
{
  "protocolVersion": "1.0.0",
  "kind": "response",
  "requestId": "req_createLedgerEntry_1732200000_1_a9f2k",
  "action": "createLedgerEntry",
  "ok": true,
  "data": {
    "entry": { "id": "led_102", "entryNumber": 1002 },
    "snapshot": { "...": "اختياري — لتحديث كامل الحالة فورًا" }
  },
  "timestampMs": 1732200000120
}
```

**عند الفشل:**

```json
{
  "protocolVersion": "1.0.0",
  "kind": "response",
  "requestId": "req_createLedgerEntry_1732200000_1_a9f2k",
  "action": "createLedgerEntry",
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "المبلغ غير صالح أو الحساب غير موجود في قاعدة البيانات.",
    "retryable": false
  },
  "timestampMs": 1732200000120
}
```

**أكواد الأخطاء المعتمدة (`HybridErrorPayload.code`):**
- `INVALID_REQUEST`
- `UNAUTHORIZED_ACTION`
- `VALIDATION_ERROR`
- `DUPLICATE_REQUEST`
- `NOT_FOUND`
- `SERVICE_UNAVAILABLE`
- `TIMEOUT`
- `INTERNAL_ERROR`

### ج) حدث فوري من Flutter إلى React (`event`)

```json
{
  "protocolVersion": "1.0.0",
  "kind": "event",
  "event": "backPressed",
  "payload": {},
  "timestampMs": 1732200001000
}
```

الأحداث المسموح بها من Flutter (`HYBRID_HOST_EVENTS`):
- `snapshotUpdated`: إرسال `HybridWorkspaceSnapshot` كامل عند تغيّر قاعدة SQLite.
- `routeChanged`: `{ route: string, params?: Record<string, string> }` لتوجيه WebView لشاشة محددة.
- `backPressed`: `{}` عند ضغط زر الرجوع الفيزيائي في Android.
- `themeChanged`: `{ mode?: "light" | "dark" | "system", brandColor?: string }`.
- `currencyChanged`: `{ scope: "dashboard" | "category" | "statement" | "report", targetId?: string, currency: string }`.
- `uiPreferencesUpdated`: كائن `HybridUiPreferences` (بما في ذلك `homeTileLayout`).
- `serviceError`: `{ message: string }` لعرض تنبيه غير معطّل عند فشل خدمة خلفية.

---

## 3. قائمة الأوامر المسموح بها (`HYBRID_ALLOWED_COMMANDS`)

### أ) الأوامر الـ 12 الأساسية للواجهة والنظام

| الأمر (`action`) | الاتجاه | يتطلب `idempotencyKey` | الوصف والبيانات المتوقعة |
|---|---|---|---|
| `navigate` | React → Flutter | لا | `{ route, params? }` — إشعار Flutter بانتقال المسار الحالي |
| `goBack` | React → Flutter | لا | `{ currentRoute?, stackDepth? }` — طلب الرجوع عند الوصول لجذر المكدس |
| `getSnapshot` | React → Flutter | لا | `{ workspaceId?, forceRefresh? }` → يعيد `HybridWorkspaceSnapshot` |
| `changeCurrency` | React → Flutter | لا | `{ scope, targetId?, currency }` — توثيق تغيير العملة المختارة |
| `saveUiPreferences` | React → Flutter | لا | `{ preferences: HybridUiPreferences }` — حفظ المظهر وترتيب وتثبيت وإخفاء البطائق |
| `openInvoice` | React → Flutter | لا | `{ intent, accountId?, entryId?, kindOverride? }` — فتح شاشة/نافذة الفاتورة |
| `openVoucher` | React → Flutter | لا | `{ accountId?, entryId? }` — فتح نافذة السند |
| `openAccountStatement` | React → Flutter | لا | `{ accountId, currency? }` — فتح كشف الحساب |
| `printDocument` | React → Flutter | لا | `{ title, kind, accountId?, entryId?, allCurrencies?, htmlSnapshot? }` |
| `exportPdf` | React → Flutter | لا | `{ filename, title, kind, accountId?, entryId?, allCurrencies?, base64Pdf? }` |
| `pickFile` | React → Flutter | لا | `{ purpose, accept[] }` → يعيد `{ cancelled?, fileName, mimeType, sizeBytes, base64Content }` |
| `showMessage` | React → Flutter | لا | `{ message, level? }` — إظهار إشعار أو Toast عبر النظام |

### ب) أوامر البيانات المحاسبية والمخزنية والنسخ الاحتياطي

| الأمر (`action`) | يتطلب `idempotencyKey` | المسؤولية في Flutter / Dart SQLite |
|---|---|---|
| `saveWorkspaceSettings` | لا | تحديث بيانات المنشأة وترويسة وتذييل الطباعة والعملة الافتراضية |
| `saveAccountGroup` | **نعم** | إنشاء/تعديل مجموعة حسابات |
| `saveCurrency` / `deleteCurrency` | **نعم** | إدارة جدول العملات وأسعار الصرف |
| `saveAccount` / `deleteAccount` | **نعم** | إنشاء/تعديل/حذف حساب مع التحقق من القيود المرتبطة |
| `createLedgerEntry` / `updateLedgerEntry` | **نعم** | ترحيل/تعديل فاتورة أو سند أو حوالة أو قيد مع تحديث المخزون في معاملة SQLite واحدة |
| `setLedgerDeleted` / `permanentlyDeleteLedger` | **نعم** | نقل للمهملات/استعادة أو حذف نهائي مع عكس أثر المخزون |
| `saveWarehouse` | **نعم** | إضافة/تعديل مخزن وتحديد المخزن الافتراضي |
| `createInventoryItem` / `updateInventoryItem` / `deleteInventoryItem` | **نعم** | إدارة دليل الأصناف |
| `importInventoryItems` / `batchUpdateInventoryItems` | **نعم** | استيراد دفعة أصناف أو تعديل جماعي داخل معاملة SQLite |
| `getInventoryMovementsReport` | لا | احتساب حركة المخازن والكمية المتبقية الفعلية لكل مخزن ولكل عملة |
| `getCashboxesReport` | لا | احتساب أرصدة الصناديق والمطابقة النقدية مفصولة حسب العملة |
| `getInvoiceDetail` | لا | جلب رأس الفاتورة وبنودها المخزنية والحرة |
| `getProductPriceStats` | لا | إحصائيات أقل/أعلى/آخر سعر للصنف |
| `saveErpData` | لا | حفظ وحدات ERP (الموظفين، الصفقات، أوامر الشراء، مراكز التكلفة) |
| `backupWorkspace` / `restoreWorkspace` / `resetWorkspace` | **نعم** (للاستعادة والتفريغ) | نسخ احتياطي محلي/سحابي واستعادة SQLite/JSON/SQL وتفريغ آمن |
| `googleDriveAction` | لا | تفويض عمليات Google Drive (اتصال، رفع، قائمة، تحميل) لخدمات Flutter الأصلية |
