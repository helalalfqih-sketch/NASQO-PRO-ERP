# حزمة تحويل نسخة الويب الحالية لـ NASQO PRO ERP إلى تطبيق Android هجين دون إنترنت

> **تنبيه مهم للشفافية**: هذه الحزمة **مجلد مراجعة مستقل** موجّه لفريق ChatGPT Work لدمجه على فرع مستقل فوق `integration/hybrid-seven-20261121` (`0d734ca2ce1716de8f7005f8339f395fbd396da6`).  
> - **لم يتم تعديل** `flutter_app/lib/main.dart` أو ملفات Android Kotlin DSL (`*.gradle.kts`) أو التوقيع أو `main` أو قناة التحديثات.  
> - **لم يُعلَن اكتمال الدمج بعد** بانتظار تشغيل `flutter analyze` و`flutter test` وبناء وتجربة **Debug APK** فعليًا على جهاز Android في وضع الطيران.

## قرارات التشغيل المعتمدة المدمجة في الحزمة

1. **استخراج وبناء نسخة الويب الحالية نفسها (`https://nasqo-pro-erp-1.ai.studio/`) دون إعادة تصميم**:
   - الحزمة `dist/hybrid/` مبنية مباشرة من مصدر React الحالي بجميع أصوله وخطوطه المضمّنة (`Cairo` و`IBM Plex Sans Arabic`) في الوضعين الفاتح والداكن.
   - تم استئصال **100%** من طلبات الخادم المتبقية (`/api/db/auth/*`, `/api/smartpro/*`, `/api/ai/categorize-expense`, `ai.studio`) مع فحص بناء تلقائي (`scripts/build-hybrid.mjs`) يرفض أي رابط خارجي أو مسار `/api/*`.
   - تم تحويل لوحة `SmartPro` إلى محول محلي أوفلاين (`src/hybrid/smartProOfflineAdapter.tsx`) وتصنيف المصروفات إلى تصنيف محاسبي عربي محلي دون إنترنت.
2. **تفعيل React الحالية افتراضيًا في Debug APK مع زر رجوع فوري**:
   - في `nasqo_hybrid_flags.dart`: `NASQO_REACT_HYBRID_V2` و`NASQO_REACT_HYBRID_ALLOW_WRITES` يأخذان القيمة الافتراضية `kDebugMode` (مفعّل تلقائيًا في **Debug APK** التجريبي، ومغلق تلقائيًا `false` في **Release / Profile** لحماية الإنتاج).
   - يوجد زر عائم مدمج **`العودة للسابقة`** (`Key('nasqo_fallback_previous_ui_btn')`) للرجوع بضغطة واحدة إلى واجهة `0d734ca` السابقة، ومفتاح إيقاف بناء `--dart-define=NASQO_REACT_HYBRID_V2=false`.
3. **قاعدة SQLite فارغة ونظيفة عند أول تشغيل + حفظ البيانات عند الترقية**:
   - `ErpHybridAdapter.loadOrInitializeUpgradeSafe()` يبدأ على قاعدة نظيفة فارغة عند أول تثبيت جديد (0 عملاء، 0 فواتير، 0 أرصدة)، بينما إذا كانت هناك بيانات قائمة من نسخة APK سابقة فإنه يقرأها بالكامل ويحفظها دون أي مسح أو تهيئة قسرية.
   - يعمل حصريًا فوق **`ErpController` + `LocalDatabase` + `AccountingEngine` + `PostingReceiptGuard`** دون أي قاعدة بيانات أو دفتر حسابات موازٍ.

## محتويات مجلد المراجعة (`review/flutter_hybrid_integration_0d734ca/`)

1. **`kotlin/com/indexesstore/nasqo_qa/NasqoProtocolCompatBridge.kt`** — محول توافق Kotlin ضمن الهوية الأصلية `com.indexesstore.nasqo_qa` فوق `HybridHomeView.kt` و`NasqoHome` دون استبدالهما.
2. **`gradle_kts_reference/ADD_DEPENDENCY_SNIPPET.gradle.kts`** — مرجع قراءة فقط لملفات `*.gradle.kts` الأصلية (صفر ملفات Groovy).
3. **`dart/lib/hybrid/nasqo_hybrid_flags.dart`** — مفاتيح التبديل (`kDebugMode` للـ Debug APK التجريبي + عزل Release + kill-switch).
4. **`dart/lib/hybrid/hybrid_protocol.dart`** — عقد البروتوكول v1.0.0 المطابق 1:1 مع `src/hybrid/contracts.ts` (37 أمرًا، 17 عملية مالية، SHA-256).
5. **`dart/lib/hybrid/posting_receipt_guard.dart`** — حماية منع تكرار الترحيل المالي ذريًا داخل نفس `LocalDatabase` + `ExternalPostingReceiptBridge`.
6. **`dart/lib/hybrid/erp_hybrid_adapter.dart`** — محول التشغيل الأوفلاين فوق `ErpController` و`LocalDatabase` + `loadOrInitializeUpgradeSafe()` + نسخ احتياطي واستعادة ذرية كاملة.
7. **`dart/lib/hybrid/hybrid_bridge_router.dart`** — موجه الجسر الموحّد مع تمرير رسائل `0d734ca` القديمة دون تغيير.
8. **`dart/lib/hybrid/hybrid_react_v2_shell.dart`** — غلاف `HybridReactV2FeatureGate` مع زر الرجوع الفوري للواجهة السابقة.
9. **`dart/test/hybrid_erp_adapter_test.dart`** — اختبارات `sqflite_common_ffi` حقيقية (التشغيل الفارغ، الإغلاق وإعادة الفتح، الترقية فوق بيانات سابقة، التصدير والاستعادة، منع تكرار الترحيل، وفصل العملات).
10. **`patches/0001-flutter-hybrid-compat-integration.patch`** — ملف Patch موحّد جاهز للمراجعة والتطبيق.
11. **`ci/flutter-hybrid-ci.yml`** — مسار GitHub Actions للفرع المستقل فقط.
12. **`CONFLICTS_AND_TEST_CHECKLIST.md`** — جدول التعارضات المصحّحة وقائمة اختبارات Android المطلوبة.
