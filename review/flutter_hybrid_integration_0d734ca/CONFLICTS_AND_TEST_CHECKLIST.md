# قائمة التعارضات المصحّحة واختبارات القبول (الأوفلاين + Android)

- **المصدر المرجعي للويب**: `https://nasqo-pro-erp-1.ai.studio/` (نسخة React الحالية في مشروع AI Studio)
- **المستودع المرجعي لـ Flutter**: `helalalfqih-sketch/nasqo-pro-mobile`
- **فرع التكامل**: `integration/hybrid-seven-20261121`
- **Commit المرجعي**: `0d734ca2ce1716de8f7005f8339f395fbd396da6`
- **حالة الدمج الفعلية**: **جاهز للبناء والاختبار لدى فريق ChatGPT Work — لم يُعلَن اكتمال الدمج بعد حتى ينجح `flutter analyze` و`flutter test` وبناء واختبار Debug APK على جهاز Android حقيقي في وضع الطيران.**

---

## 1. جدول التعارضات ونقاط الخادم التي تم إصلاحها

| # | النقطة / التعارض | الحل المنفّذ والمؤكّد |
|---|---|---|
| 1 | هوية تطبيق Android (`applicationId`) | الحفاظ الكامل على **`com.indexesstore.nasqo_qa`** في Kotlin وجميع ملفات الحزمة. |
| 2 | ملفات Gradle (`*.gradle.kts`) والتوقيع والتحديث | الإبقاء على ملفات **Kotlin DSL** الأصلية والتوقيع وقناة التحديثات دون أي ملفات Groovy بديلة. |
| 3 | قاعدة البيانات والدفتر المحاسبي | العمل حصريًا فوق **`ErpController` + `LocalDatabase` + `AccountingEngine` + `PostingReceiptGuard`** داخل نفس قاعدة SQLite الحالية (صفر قاعدة موازية، صفر دفتر موازٍ). |
| 4 | جسر WebView و`NasqoHome` | الإبقاء على `HybridHomeView.kt` و`WebViewCompat` و`NasqoHome` و`MethodChannel("nasqo/home/$id")` وإضافة `NasqoProtocolCompatBridge.kt` مع تمرير رسائل `0d734ca` القديمة كما هي. |
| 5 | طلبات الخادم المتبقية في React (`api/db/auth/*`, `api/smartpro/*`, `api/ai/categorize-expense`) | تم استئصالها بالكامل في بناء الهجين: تخطي فحص المصادقة وSmartPro عند البدء، استبدال `SmartProControlScreen` بمحول محلي أوفلاين (`smartProOfflineAdapter.tsx`)، وتشغيل تصنيف المصروفات محليًا، مع تدقيق بناء يرفض أي `/api/*` أو `ai.studio` في `dist/hybrid/`. |
| 6 | سلوك Debug APK التجريبي vs الإنتاج | في Debug APK (`kDebugMode == true`): تعمل واجهة React الحالية افتراضيًا مع **زر رجوع فوري (`العودة للسابقة`)** إلى `0d734ca` ومفتاح تعطيل `--dart-define=NASQO_REACT_HYBRID_V2=false`. أما في Release فتبقى القيمة الافتراضية `false`. |
| 7 | أول تشغيل فارغ + حفظ بيانات الترقية | `ErpHybridAdapter.loadOrInitializeUpgradeSafe()` يبدأ بقاعدة نظيفة فارغة عند أول تثبيت، ويحفظ 100% من الصفوف الموجودة عند ترقية APK فوق إصدار سابق. |

---

## 2. قائمة الاختبارات المنفّذة محليًا مقابل المعلّقة على Android

### أ) اختبارات React والأوفلاين والمقارنة البصرية (تم تشغيلها ونجحت محليًا)
- [x] `npm run check:runtime` (28 ملفًا محميًا سليمًا)
- [x] `npx tsc --noEmit`
- [x] `npm run build:hybrid` (0 مخالفات: لا `/api/smartpro`, لا `/api/db/auth`, لا `/api/ai/`, لا `ai.studio`, لا `fonts.googleapis`, سياسة CSP `connect-src 'none'`)
- [x] `npx tsx --test tests/hybrid.test.ts` (اختبارات البروتوكول ومنع التكرار وService Adapter)
- [x] `node scripts/verify-hybrid-home.mjs` (11 سيناريو للشاشة الرئيسية عبر `window.NasqoHome` و6 مقاسات)
- [x] `node scripts/verify-hybrid-full-offline.mjs` (وضع طيران كامل بقطع الشبكة: 0 طلبات شبكة، إنشاء حساب + فاتورة + سند + حركة مخزون + تخصيص بطاقات + إعادة تحميل الصفحة والتحقق من بقاء البيانات والأرصدة والتفضيلات + مقارنة لقطات الوضع الفاتح والداكن مع نسخة الويب المرجعية)
- [x] `node scripts/verify-flutter-integration.mjs` (مطابقة 1:1 بين React وKotlin وDart)

### ب) اختبارات Flutter / Dart / SQLite / Android (**معلّقة — للتنفيذ لدى فريق ChatGPT Work**)
- [ ] دمج مجلد المراجعة أو تطبيق `patches/0001-flutter-hybrid-compat-integration.patch` على فرع مستقل فوق `integration/hybrid-seven-20261121` (`0d734ca`)
- [ ] تشغيل `npm run sync:flutter-hybrid -- --skip-build` لنسخ `dist/hybrid/` إلى `flutter_app/assets/web/`
- [ ] تشغيل `cd flutter_app && flutter pub get && flutter analyze` (يجب 0 أخطاء)
- [ ] تشغيل `cd flutter_app && flutter test test/accounting_engine_test.dart test/hybrid_erp_adapter_test.dart`
- [ ] بناء `cd flutter_app && flutter build apk --debug` وتثبيت APK على جهاز Android / Emulator في **وضع الطيران الكامل**
- [ ] اختبار دورة Android الحقيقية في وضع الطيران:
  1. أول تشغيل على قاعدة فارغة ونظيفة (0 عملاء/فواتير وهمية، 0 طلبات إنترنت).
  2. إنشاء حساب + فاتورة + سند + حركة مخزون + تخصيص البطاقات وتبديل الوضع الداكن/الفاتح.
  3. إغلاق التطبيق نهائيًا وإعادة فتحه والتأكد من بقاء كل البيانات والأرصدة والتفضيلات.
  4. تثبيت ترقية APK فوق نسخة فيها بيانات مسبقة والتأكد من بقاء البيانات القديمة سليمة 100%.
  5. اختبار زر `العودة للسابقة` والعودة لواجهة React الحالية دون فقدان بيانات.
  6. تصدير واستعادة نسخة احتياطية تجريبية على بيانات اختبار فقط.
  7. مقارنة بصرية (فاتح وداكن) بين Debug APK على Android ونسخة الويب `https://nasqo-pro-erp-1.ai.studio/`.
