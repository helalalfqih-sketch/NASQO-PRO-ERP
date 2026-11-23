# NASQO PRO ERP — حزمة التسليم والتكامل لفريق Flutter (`HYBRID_FLUTTER_HANDOFF.md`)

> **حدود المسؤولية والشفافية**: تم تنفيذ وبناء واختبار واجهة React Hybrid المحلية (`dist/hybrid/`) كاملة للشاشة الرئيسية كأساس قابل للتوسع لبقية الشاشات، والتحقق منها عبر **اختبارات الوحدة (`node:test`)** و**11 اختبار متصفح حقيقي (`Playwright`)** عبر قناة `window.NasqoHome` المحاكاة خارج الحزمة، بما في ذلك إثبات أن `?mockFlutter=1` لا يمكن تفعيله نهائيًا في حزمة الإنتاج.
> **لم يتم تعديل Flutter أو Android أو تشغيل `flutter build apk` أو الاطلاع مباشرة على ملفات Commit `0d734ca` في الفرع `integration/hybrid-seven-20261121`** لعدم توفر بيئة Flutter/Android SDK أو المستودع البعيد هنا؛ ويبقى ذلك مسؤولية فريق Flutter.

---

## 1. الملفات الجديدة والمعدلة ومساراتها داخل المشروع

### الملفات الجديدة لوحدة React Hybrid
- `hybrid.html` — نقطة دخول HTML المستقلة لـ Android WebView (`lang="ar" dir="rtl"`, سياسة CSP صارمة `connect-src 'none'`).
- `vite.hybrid.config.ts` — إعداد Vite المستقل لعزل الخدمات وقت البناء (`base: "./"`, `publicDir: false`, `nasqoHybridIsolationPlugin`).
- `scripts/build-hybrid.mjs` — سكربت بناء الحزمة الثابتة وتوليد `dist/hybrid/hybrid-manifest.json` وتدقيق خلوها من الروابط الخارجية والـ API وFirebase وأي أثر لـ `mockFlutter` أو بيانات الاختبار.
- `src/hybrid/entry.tsx` — مدخل تشغيل React Hybrid المستقل (خالي تمامًا من استيراد `mockFlutterHost` أو `homeFixture`؛ يستقبل ويتحقق من `getSnapshot`، يزامن `snapshotUpdated`، ويعالج فشل الجسر بصدق مع زر إعادة المحاولة).
- `src/hybrid/hybrid.css` — تنسيقات Android WebView الأصلية (`safe-area-inset-*`، الوضعان الفاتح والداكن عبر `--nasqo-*`، تحسين اللمس والشاشات الضيقة 320px–427px وتكبير الخط 130%).
- `src/hybrid/contracts.ts` — تعريفات TypeScript الصارمة لبروتوكول الجسر (`1.0.0`)، قائمة الأوامر المسموحة `HYBRID_ALLOWED_COMMANDS`، حظر حقول SQL/Shell/Prototype Pollution، والتحقق `validateHybridSnapshot`.
- `src/hybrid/bridge.ts` — محرك الجسر `NasqoHybridBridge`: يعطي **الأولوية الأولى** لقناة Android `WebViewCompat` القائمة **`window.NasqoHome`** (`postMessage` + `addEventListener("message", ...)`)، مع دعم بديل لـ `window.NasqoFlutterBridge` و`flutter_inappwebview` و`window.__nasqoHybridReceive`، ومنع التكرار `DUPLICATE_REQUEST`، ومعالجة `TIMEOUT`.
- `src/hybrid/mobileAdapter.tsx` — بديل `src/mobile` لبيئة Android WebView (إزالة `PhoneFrame`/`StatusBar`/`HomeIndicator`، استخدام `visualViewport`، إرسال `navigate`/`goBack` مرة واحدة دون تكرار، وربط زر الرجوع `backPressed`).
- `src/hybrid/presentationAdapter.tsx` — طبقة React Context لربط مكونات React الأصلية بأوامر Flutter.
- `src/hybrid/serviceAdapter.ts` — بديل `src/firebase.ts` عبر الجسر بدون Firebase SDK أو `fetch`.
- `src/hybrid/routes.ts` — خريطة المسارات القانونية للدفعات الخمس وتطبيع معرفات `FlowStack` (`accounts-<category>-*`, `supplier:*`, إلخ).
- `src/hybrid/homeFixture.ts` — بيانات اختبار متعددة العملات (`ريال`, `دولار`, `سعودي`) مخصصة **للاختبارات فقط** (`tests/hybrid.test.ts` و`scripts/verify-hybrid-home.mjs`) وغير مضمنة نهائيًا في `dist/hybrid/`.
- `src/hybrid/mockFlutterHost.ts` — أداة تطوير مرجعية غير مستوردة في مدخل الإنتاج (`entry.tsx`) وغير مضمنة نهائيًا في `dist/hybrid/`.
- `src/hybrid/googleDriveAdapter.ts`, `src/hybrid/brandAssetAdapter.ts`, `src/hybrid/firebaseAuthStub.ts` — محولات عزل الأصول والخدمات.
- `tests/hybrid.test.ts` — اختبارات الوحدة والتكامل عبر `node:test` (تشمل فحص أولوية `window.NasqoHome` وفحص خلو `dist/hybrid/` من `mockFlutter` وبيانات الاختبار).
- `scripts/verify-hybrid-home.mjs` — سكربت التحقق التلقائي بـ Playwright (11 اختبارًا عبر `window.NasqoHome` الخارجي + إثبات تعطيل `?mockFlutter=1` في حزمة الإنتاج).
- `HYBRID_BRIDGE_CONTRACT.md`, `HYBRID_BRIDGE_COMPATIBILITY.md`, و `HYBRID_REACT_AUDIT.md` — توثيق العقد والتوافق مع `0d734ca` والتدقيق المعماري.

### الملفات الأصلية المعدلة تعديلًا جراحيًا محدودًا (مع الفروقات المستقلة في `patches/`)
- `src/Prototype.tsx` (`patches/01-src-Prototype.tsx.patch`) — تصدير `AuthenticatedWorkspace`، ربط `useHybridPresentation()`، إرسال `changeCurrency` من جدول مجموعات الحسابات بالشاشة الرئيسية، وضمان إرسال `saveUiPreferences` مرة واحدة عند تحرير بطائق الرئيسية.
- `src/accounting.ts` (`patches/02-src-accounting.ts.patch`) — احترام `group.currencyCode` قبل `defaultCurrency` في `computeAccountGroupsSummary` لعرض كل مجموعة بعملتها الصحيحة دون دمج عملات.
- `src/erp.ts` (`patches/03-src-erp.ts.patch`) — عزل استدعاءات `/api/db/.../erp` وقت تشغيل الهجين.
- `src/prototype.css` (`patches/04-src-prototype.css.patch`) — إصلاح تباين الوضع الداكن لخلفية الرئيسية وبطاقة الهوية والرصيد الصفري، ومنع اقتطاع عنوان تبويب «قاعدة البيانات» في الإعدادات.
- `src/components/ExpenseCategorySelector.tsx` (`patches/05-src-components-ExpenseCategorySelector.tsx.patch`) — عزل استدعاء `/api/ai/categorize-expense` لصالح تصنيف محلي حتمي دون شبكة في الهجين.
- `package.json` (`patches/06-package.json.patch`) — إضافة السكربت `"build:hybrid": "node scripts/build-hybrid.mjs"`.

---

## 2. أمر البناء ومخرجات الحزمة الثابتة

```bash
npm run build:hybrid
```

المخرجات داخل **`dist/hybrid/`** (**0 مخالفات أمنية أو شبكية — `mockHostStripped: true`**):
- `dist/hybrid/index.html` — مدخل التطبيق مع CSP (`connect-src 'none'`) ومسارات نسبية `./assets/...`.
- `dist/hybrid/assets/nasqo-hybrid-*.js` + حزم الشاشات الكسولة `chunk-*.js`.
- `dist/hybrid/assets/style-*.css` — تنسيقات `styles.css` + `prototype.css` + `hybrid.css`.
- `dist/hybrid/assets/ibm-plex-sans-arabic-*.woff2/.woff` و `cairo-*.woff2/.woff` — الخطوط العربية مضمّنة محليًا 100%.
- `dist/hybrid/assets/NASQO_PRO_ERP_800_*.png` — شعار التطبيق المحلي.
- `dist/hybrid/hybrid-manifest.json` — سجل كامل بأسماء الملفات وأحجامها وبصمات `SHA-256`، مع `"bridgeChannel": "NasqoHome"` و`"mockHostStripped": true`.

### التحقق الأمني لحزمة الإنتاج (بدون محاكي مدمج)
- فتح `dist/hybrid/index.html` أو `dist/hybrid/index.html?mockFlutter=1` في متصفح عادي بدون مضيف Android/Flutter يعرض **رسالة خطأ الاتصال الصادقة مع زر إعادة المحاولة فقط**، ويستحيل تشغيل أي بيانات وهمية أو محاكي من داخل حزمة الإنتاج.
- للاختبار الآلي الكامل في المتصفح مع حقن `window.NasqoHome` من الخارج فقط، يُستخدم `node scripts/verify-hybrid-home.mjs`.

---

## 3. خطوات الدمج داخل Flutter القائم (`integration/hybrid-seven-20261121`) بدون WebView ثانٍ

> للتفاصيل الكاملة حول المواءمة مع `HybridHomeView.kt` و`MethodChannel("nasqo/home/$id")`، راجع **`HYBRID_BRIDGE_COMPATIBILITY.md`**.

1. **إعادة استخدام نفس `HybridHomeView.kt` الواحد**:
   - انسخ محتويات `dist/hybrid/` إلى مجلد الأصول المحلي الذي يقدمه `WebViewAssetLoader` (مثل `flutter_app/assets/web/`).
   - أبقِ `WebViewCompat.addWebMessageListener(webView, "NasqoHome", allowedOrigins, listener)` كما هو؛ حيث يكتشف `src/hybrid/bridge.ts` كائن **`window.NasqoHome`** أولًا تلقائيًا.
2. **تمرير الردود والأحداث من Kotlin/Dart إلى React**:
   - عند استلام رسالة من `NasqoHome`، مرّرها عبر `MethodChannel("nasqo/home/$id")` إلى `hybrid_home_view.dart`.
   - أعد الرد إلى React إما عبر `replyProxy.postMessage(responseJson)` (مفضّل في `WebViewCompat`) أو عبر `evaluateJavascript("window.__nasqoHybridReceive(${jsonEncode(responseJson)});")`.
3. **ربط زر الرجوع الفيزيائي في Android (`PopScope`)**:
   - ادفع حدث `backPressed` (`protocolVersion: "1.0.0"`, `kind: "event"`, `event: "backPressed"`, `payload: {}`) إلى WebView.
   - عند وصول React للجذر سيرسل الأمر `goBack` مع `stackDepth: 1` ليقرر Flutter إغلاق الشاشة/التطبيق.
4. **الأمان المالي الدفاعي المتعمّق (Defense-in-Depth)**:
   - لا تعتمد على `capabilities.readOnlyFinancial: true` وحده؛ يجب أن يفرض Dart قائمته البيضاء المستقلة ويرفض أي أمر كتابة مالية غير مصرح به برمز `UNAUTHORIZED_ACTION`، وأن ينفذ كل ترحيل مالي مستقبلي داخل `db.transaction` واحدة مع `UNIQUE(idempotency_key)` في SQLite.

---

## 4. تعريف رسائل الجسر وأمثلة JSON للشاشة الرئيسية

### أ) طلب واستجابة لقطة الشاشة الرئيسية (`getSnapshot`)

**الطلب الصادر من React إلى Flutter:**
```json
{
  "protocolVersion": "1.0.0",
  "kind": "request",
  "requestId": "req_getSnapshot_1763760000000_1_a9k2p",
  "action": "getSnapshot",
  "payload": {
    "workspaceId": "local-erp-workspace",
    "forceRefresh": true
  },
  "timestampMs": 1763760000000
}
```

**الرد المتوقع من Flutter (مثال JSON كامل للشاشة الرئيسية متعددة العملات):**
```json
{
  "protocolVersion": "1.0.0",
  "kind": "response",
  "requestId": "req_getSnapshot_1763760000000_1_a9k2p",
  "action": "getSnapshot",
  "ok": true,
  "data": {
    "workspaceId": "local-erp-workspace",
    "userEmail": "offline@nasqo.local",
    "workspace": {
      "id": "local-erp-workspace",
      "ownerId": "local-erp-workspace",
      "companyName": "مؤسسة نسقو التجارية",
      "defaultCurrency": "ريال",
      "whatsappProvider": "nasqo",
      "whatsappInstantEnabled": false,
      "whatsappPhone": "777000111"
    },
    "currencies": [
      { "id": 1, "code": "YER", "name": "ريال", "symbol": "ر.ي", "ratePrimary": 1, "rateSecondary": 1, "nameSecondary": "فلس" },
      { "id": 2, "code": "USD", "name": "دولار", "symbol": "$", "ratePrimary": 530, "rateSecondary": 1, "nameSecondary": "سنت" },
      { "id": 3, "code": "SAR", "name": "سعودي", "symbol": "ر.س", "ratePrimary": 140, "rateSecondary": 1, "nameSecondary": "هللة" }
    ],
    "accountGroups": [
      { "id": 1, "legacyId": 1, "name": "المشتريات والموردون", "category": "purchases", "currencyCode": "ريال", "sortOrder": 1 },
      { "id": 2, "legacyId": 2, "name": "المبيعات", "category": "sales", "currencyCode": "ريال", "sortOrder": 2 },
      { "id": 3, "legacyId": 3, "name": "العملاء", "category": "clients", "currencyCode": "ريال", "sortOrder": 3 },
      { "id": 4, "legacyId": 4, "name": "حوالات خارجية", "category": "transfers", "currencyCode": "دولار", "sortOrder": 4 },
      { "id": 5, "legacyId": 5, "name": "الصناديق والمحل", "category": "shop", "currencyCode": "ريال", "sortOrder": 5 }
    ],
    "accounts": [
      {
        "id": "acc_sup_1",
        "ownerId": "local-erp-workspace",
        "groupId": 1,
        "codeNumber": 101,
        "name": "مؤسسة البراري للتوريد",
        "category": "purchases",
        "currency": "ريال",
        "openingBalance": 120000,
        "openingDirection": "credit",
        "isCashAccount": false
      },
      {
        "id": "acc_sup_usd",
        "ownerId": "local-erp-workspace",
        "groupId": 1,
        "codeNumber": 102,
        "name": "شركة الخليج للطاقة (دولار)",
        "category": "purchases",
        "currency": "دولار",
        "openingBalance": 2400,
        "openingDirection": "credit",
        "isCashAccount": false
      },
      {
        "id": "acc_trf_usd",
        "ownerId": "local-erp-workspace",
        "groupId": 4,
        "codeNumber": 401,
        "name": "حوالات الصرافة الدولية",
        "category": "transfers",
        "currency": "دولار",
        "openingBalance": 1250,
        "openingDirection": "debit",
        "isCashAccount": false
      }
    ],
    "cashboxes": [
      { "id": 1, "name": "الصندوق الرئيسي", "details": "الصندوق العام", "currencyCode": "ريال", "isActive": true, "state": 1 }
    ],
    "ledger": [
      {
        "id": "led_1001",
        "ownerId": "local-erp-workspace",
        "entryNumber": 1001,
        "accountId": "acc_sup_1",
        "accountName": "مؤسسة البراري للتوريد",
        "kind": "invoice",
        "typeLabel": "فاتورة مشتريات",
        "payment": "credit",
        "direction": "credit",
        "amount": 45000,
        "currency": "ريال",
        "exchangeRate": 1,
        "details": "توريد بطاريات ومستلزمات طاقة",
        "documentNumber": "INV-1001",
        "entryDate": "2026-11-20",
        "deleted": false,
        "createdAtMs": 1732100000000
      }
    ],
    "warehouses": [
      { "id": "wh_main", "ownerId": "local-erp-workspace", "codeNumber": 1, "name": "المخزن الرئيسي", "details": "المستودع المركزي", "isDefault": true }
    ],
    "inventory": [
      { "id": "inv_1", "ownerId": "local-erp-workspace", "sku": "BAT-200", "name": "بطارية شمسية 200 أمبير", "warehouseId": "wh_main", "unit": "حبة", "quantity": 14, "avgCost": 42000, "sellingPrice": 52000, "minThreshold": 4 }
    ],
    "uiPreferences": {
      "themeMode": "light",
      "homeTileLayout": {
        "order": ["new-voucher", "new-transfer", "new-invoice"],
        "pinned": [],
        "hidden": [],
        "toneOverrides": {}
      }
    },
    "capabilities": {
      "offlineReady": true,
      "printingSupported": true,
      "pdfExportSupported": true,
      "filePickerSupported": true,
      "googleDriveConfigured": false,
      "whatsappShareSupported": true,
      "readOnlyFinancial": true
    },
    "activeRoute": "home",
    "activeCurrency": "ريال",
    "snapshotVersion": 1
  },
  "timestampMs": 1763760000015
}
```

> **حماية الدفعة 1 — الدفاع المتعمّق (`readOnlyFinancial: true` + رفض Dart + `UNIQUE(idempotency_key)`)**:
> الحقل `capabilities.readOnlyFinancial: true` في JavaScript هو طبقة حماية واجهة فقط (Client UX Guard) ولا يُغني أبدًا عن التحقق في Dart. **يجب على Dart مستقلًا رفض أي أمر كتابة مالية غير مصرح به برمز `UNAUTHORIZED_ACTION`**، وعند تفعيل الترحيل في الدفعات اللاحقة يجب تنفيذ كل عملية مالية داخل `db.transaction` واحدة مع قيد `UNIQUE(idempotency_key)` في SQLite (التفاصيل في `HYBRID_BRIDGE_COMPATIBILITY.md`).

---

### ب) قائمة أحداث المستخدم التي سيستقبلها Flutter من الشاشة الرئيسية

| الأمر (`action`) | متى يُرسل من React | مثال `payload` |
|---|---|---|
| `getSnapshot` | عند تشغيل الواجهة أو الضغط على «إعادة المحاولة» | `{ "workspaceId": "local-erp-workspace", "forceRefresh": true }` |
| `navigate` | عند فتح مجموعة حسابات أو شاشة فرعية (يُرسل **مرة واحدة** فقط لكل نقرة) | `{ "route": "purchases" }` |
| `changeCurrency` | عند تبديل عملة صف في جدول مجموعات الحسابات أو الكشف | `{ "scope": "dashboard", "targetId": "1", "currency": "دولار" }` |
| `saveUiPreferences` | عند تبديل المظهر/اللون أو السحب/التثبيت/تبديل اللون/الإخفاء/الإعادة الافتراضية للبطائق | `{ "preferences": { "homeTileLayout": { "order": [...], "pinned": ["new-invoice"], "hidden": [], "toneOverrides": { "new-invoice": "amber" } } } }` |
| `goBack` | عند الضغط على الرجوع في الشاشة الجذرية الرئيسية | `{ "currentRoute": "dashboard", "stackDepth": 1 }` |
| `openInvoice` | عند فتح نافذة فاتورة/مرتجع/عرض سعر/طلبية | `{ "intent": "invoice", "accountId": "acc_sup_1" }` |
| `openVoucher` | عند فتح نافذة سند قبض/صرف | `{ "accountId": "acc_sup_1" }` |
| `openAccountStatement` | عند فتح كشف حساب محدد | `{ "accountId": "acc_sup_1", "currency": "ريال" }` |
| `showMessage` | عند إظهار إشعار أو رسالة خطأ للمستخدم | `{ "message": "تم تثبيت ترتيب البطائق بنجاح", "level": "info" }` |

### ج) أحداث المضيف التي يمكن لـ Flutter دفعها إلى React (`kind: "event"`)
- `snapshotUpdated` — دفع لقطة بيانات محدثة من SQLite (تخضع تلقائيًا لـ `validateHybridSnapshot`).
- `themeChanged` — `{ "mode": "light" | "dark" | "system" }`
- `currencyChanged` — `{ "scope": "dashboard", "targetId": "1", "currency": "دولار" }`
- `uiPreferencesUpdated` — `{ "homeTileLayout": { ... }, "themeMode": "dark" }`
- `routeChanged` — `{ "route": "purchases" | "settings" | "inventory-report" | ... }`
- `backPressed` — `{}` (إغلاق النوافذ المفتوحة أو الرجوع خطوة في `FlowStack`).
- `serviceError` — `{ "message": "..." }`

---

## 5. نتائج الاختبارات وأدلة المقارنة البصرية (السجلات الخام داخل `logs/`)

### أ) اختبارات الوحدات والعقود (`npx --yes tsx --test tests/hybrid.test.ts`)
- **النتيجة**: اجتياز **15/15 اختبارًا** (6 مجموعات — 0 فشل):
  - التحقق من قائمة الأوامر المسموحة `allowlist` وحظر حقول SQL/Shell/Prototype Pollution.
  - التحقق من أولوية قناة Android `WebViewCompat` (`window.NasqoHome`) على `NasqoFlutterBridge` واستقبال الردود والأحداث عبر `addEventListener("message", ...)`.
  - التحقق من `validateHybridSnapshot` ورفض اللقطات غير الصالحة.
  - التحقق من دقة الأرصدة متعددة العملات وإشاراتها (`-165,000 ريال` و`-3,000 دولار` و`+55,000 ريال` و`+1,250 دولار` و`0`) دون دمج عملات.
  - التحقق من حظر الترحيل المالي في وضع القراءة فقط (`readOnlyFinancial: true`)، وفرض `idempotencyKey` ومنع التكرار `DUPLICATE_REQUEST`.
  - التحقق من `moveHomeTile`, `togglePinHomeTile`, `toggleToneHomeTile`, `toggleHideHomeTile`, والإعادة الافتراضية.
  - التحقق من سلامة حزمة `dist/hybrid/` وخلوها تمامًا من الروابط الخارجية ومن أي أثر لـ `mockFlutter` أو بيانات الاختبار (`mockHostStripped: true`).

### ب) اختبارات المتصفح الإحدى عشرة (`node scripts/verify-hybrid-home.mjs` — Playwright عبر `window.NasqoHome`)
- **النتيجة**: **11/11 فحصًا ناجحًا** (`0` أخطاء console، `0` أخطاء صفحة، `0` طلبات خارجية، `0px` تجاوز أفقي):
  1. `01_snapshot_received_and_rendered`: ✅
  2. `02_signed_balances_with_correct_currencies`: ✅
  3. `03_currency_switch_updates_balance_and_notifies_flutter`: ✅
  4. `04_single_navigation_event_per_click`: ✅
  5. `05_tile_longpress_pin_color_hide_restore_and_bridge_save`: ✅
  6. `06_back_and_reopen_works`: ✅
  7. `07_light_and_dark_themes`: ✅
  8. `08_zero_external_network_requests`: ✅
  9. `09_all_viewports_zero_overflow_and_clean_geometry` (`320px`, `360px`, `393px`, `427px`, و`130%` تكبير خط، عدم تداخل الهيدر، عدم تغطية شريط التنقل لآخر بطاقة، تمرير RTL): ✅
  10. `10_bridge_failure_honest_error` (عرض خطأ الاتصال وزر إعادة المحاولة عند غياب مضيف Flutter): ✅
  11. `11_prod_bundle_blocks_mockFlutter_param` (إثبات أن فتح `dist/hybrid/index.html?mockFlutter=1` لا يفعل أي محاكي ولا يعرض بيانات اختبارية): ✅

### ج) فحص وقت التشغيل المحمي وTypeScript وبناء الويب
- `npm run check:runtime`: ✅ ناجح (28 ملفًا محميًا دون تعديل).
- `npx tsc --noEmit` و `npm run build`: ✅ ناجحان بدون أخطاء.

### د) صور مقارنة التصميم (`qa/hybrid_home/`)
التُقطت جميع الصور باستخدام نفس بيانات الاختبار في المرجع والهجين:
- `qa/hybrid_home/hybrid-01-home-393-light.png`
- `qa/hybrid_home/hybrid-02-home-320-light.png`
- `qa/hybrid_home/hybrid-03-home-360-light.png`
- `qa/hybrid_home/hybrid-04-home-360-dark.png` ↔ مرجع الويب: `qa/hybrid_home/ref-04-web-home-360-dark.png`
- `qa/hybrid_home/hybrid-05-home-427-light.png` ↔ مرجع الويب: `qa/hybrid_home/ref-05-web-home-427-light.png`
- `qa/hybrid_home/hybrid-06-home-393-font130.png`
- `qa/hybrid_home/hybrid-07-tile-edit-mode-393.png`
- `qa/hybrid_home/hybrid-10-bridge-error-393.png`
- التقرير الرقمي الكامل: `qa/hybrid_home/home-verification-report.json`

---

## 6. الوظائف غير المكتملة والمتبقية لفريق Flutter (خارج نطاق React)

- [ ] مراجعة التوافق مع Commit `0d734ca` في `integration/hybrid-seven-20261121` وإعادة استخدام `HybridHomeView.kt` الواحد عبر `window.NasqoHome` و `MethodChannel("nasqo/home/$id")` دون WebView ثانٍ.
- [ ] التحقق من مطابقة حقول `getSnapshot` و`saveUiPreferences` و`changeCurrency` مع SQLite / `SharedPreferences` في `flutter_app/lib/hybrid/hybrid_home_view.dart`.
- [ ] فرض القائمة البيضاء ورفض الترحيل المالي مستقلًا في Dart للدفعة 1، ثم تنفيذ `db.transaction` + `UNIQUE(idempotency_key)` في SQLite عند الانتقال للدفعات اللاحقة.
- [ ] ربط الطباعة وPDF واختيار الملفات وGoogle Drive الأصلي (`printDocument`, `exportPdf`, `pickFile`, `googleDriveAction`).
- [ ] اختبار التشغيل الفعلي وبناء `APK` على أجهزة Android حقيقية (بما في ذلك لوحة مفاتيح Android، الرجوع الفيزيائي، والتبديل بين الوضع الفاتح والداكن على النظام).
