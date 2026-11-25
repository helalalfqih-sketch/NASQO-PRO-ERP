# اعتماد الكمية مستقلًا عن التكلفة

التاريخ: 2026-11-25. المستودع: `helalalfqih-sketch/NASQO-PRO-ERP`.
SHA الأساس المتحقق منه قبل التعديل: `61f9736abad3b089602ea0d2c0fa2d29ae45f3a9`، ويشمل إصلاح البنود الحرة السابق.
نسخة العمل المعزولة: `/workspace/NASQO-stock-quantity`، الفرع `repair/stock-quantity-approval`.

## السلوك

المسار: **الإعدادات ← مطابقة مخزون النسخة المستوردة ← اعتماد الكميات الحالية فقط**.

تُعرض الكميات الحالية لكل مخزن، دون تصفية تاريخ. يحدد المستخدم الأصناف، ويقر بأن الكميات هي الرصيد الحالي الصحيح، ثم يؤكد اعتماد الكميات في حوار مستقل. يمكن إلغاء الحوار دون كتابة. لا تؤدي قراءة القائمة أو البحث أو التحديد إلى الاعتماد.

يثبت التطبيق الكمية المعروضة لكل صنف ومخزن مرة واحدة. الاعتماد مستقل عن التكلفة، ولا يعيد ترحيل القيود القديمة أو الحركات القديمة، ولا يضيف حركة مخزون أو قيدًا ماليًا. التحويل غير المكتمل يظل ظاهرًا كتنبيه في المراجعة؛ تأكيد المستخدم يتعلق بالرصيد المعروض، ولا يصلح التحويل أو يخمّن وجهته. الكميات السالبة أو المجهولة بلا حركة محفوظة تُستثنى مع بيان السبب، ولا تتحول تلقائيًا إلى صفر معتمد.

تظهر حالة **«كمية معتمدة — التكلفة غير معتمدة»** في تقرير المخزون والفاتورة. يظل سعر الكتالوج مرجعيًا ولا يُستعمل تلقائيًا لتقييم المخزون. لا تدخل الكميات ذات التكلفة غير المعتمدة في مجموع قيمة المخزون، وتظهر قيمة المتبقي غير معتمدة بدل الإيحاء بأن الصفر تقييم موثوق.

تبقى فواتير الأصناف التي تحتاج تكلفة معتمدة محمية من الترحيل حتى مراجعة التكلفة. الرسالة توضّح أن الكمية معتمدة وأن المتبقي هو التكلفة. البنود الحرة السابقة تظل مستقلة عن المخزون.

عند اعتماد التكلفة لاحقًا، تكون الكمية المثبتة غير قابلة للتعديل في هذه الخطوة. ينشأ القيد المالي الخاص بالقيمة بعد التأكيد، ولا تُضاف الكمية مرة ثانية ولا تنشأ حركة كمية أخرى. التغييرات المالية تظل خاضعة للحسابات والدقة والتواريخ والحماية الموجودة في التطبيق.

## سلامة البيانات

- مراجعة الاعتماد مرتبطة بمساحة العمل، وبصمة النسخة الأصلية، والمخزن، والأصناف المحددة، وبصمة قيم المراجعة. تُرفض المراجعة القديمة أو تغيير المصدر/مساحة العمل قبل أي اعتماد جزئي.
- المعاملة ذرّية لكل المجموعة. فشل صنف يُرجع بقية المجموعة كما كانت.
- إعادة الطلب نفسه، بما فيها فقد تأكيد الحفظ، تعيد النتيجة السابقة دون تكرار الرصيد.
- يُخزن رصيد الكمية في `inventory_items`، وسجل اعتماده في `erp_state` تحت `stock_quantity_approval:<itemId>`، دون تعديل مخطط القاعدة. تبقى علامة عدم اعتماد التكلفة في الحارس المحلي الحالي.
- عند وجود الصنف في أكثر من مخزن، تُستخدم هوية رصيد مستقلة لكل مخزن. لا تُضاف الحركات التاريخية إلى الرصيد المعتمد، وتظل تفاصيل التاريخ محفوظة وقابلة للعرض.
- بيانات الاعتماد تدخل في النسخة الاحتياطية الأصلية المحلية. تتحقق الاستعادة من ارتباط سجل الاعتماد بالصنف والمخزن والمصدر وحالة التكلفة.
- عُرضت الكميات بثلاث منازل عشرية في التقرير، مجموع الكميات، الاختيار داخل الفاتورة وPDF؛ تبقى الأموال بمنزلتين. مثال اصطناعي: `35.125` لا تُعرض `35.13` عند المراجعة.
- لم تُستخدم ملفات المستخدم الخاصة أو بيانات الهاتف أو الإنتاج.

## نتائج التحقق

| الفحص | النتيجة | الدليل |
|---|---|---|
| Flutter كامل | 83 ناجحًا، اختباران لملفات خاصة متخطيان عمدًا | `logs/flutter-all.log` |
| SQLite لاعتماد الكمية والتكلفة اللاحقة | كسر ثلاثي، صفر، سالب، رصيد مجهول، تحويل ناقص، مخزنان، تكرار الطلب، رفض المصدر/مساحة العمل والمراجعة القديمة، تراجع المجموعة، نسخة واستعادة، ثم بيع جديد | `logs/quantity-tests.log`؛ `flutter_app/test/legacy_quantity_approval_test.dart` |
| Flutter Widget | تأكيد من مرحلتين، الإلغاء بلا كتابة، حالة قديمة وإعادة تحميل؛ نافذة 360×800 دون أخطاء تخطيط | `logs/widget-quantity.log` |
| JavaScript والجسر والتنسيق وPDF | 47 ناجحًا | `logs/js-tests.log` |
| Chromium للحالة الجديدة | 3 سيناريوهات ناجحة، دون أخطاء متصفح أو شبكة خارجية | `browser/results.json` |
| تراجع اختيار الأصناف | 8 سيناريوهات ناجحة | `catalog-regression/results.json` |
| تراجع البنود الحرة | 6 سيناريوهات ناجحة | `free-invoice-regression/results.json` |
| TypeScript وبناء Hybrid | ناجحان؛ لا مخالفات فحص offline/security الخاص بالحزمة | `logs/typescript.log` و`logs/hybrid-build.log` |
| الملفات المحمية | 28 ملفًا سليمة | `logs/runtime.log` |
| Flutter analyze --no-fatal-infos | دون أخطاء أو تحذيرات؛ 140 ملاحظة أسلوبية بالمشروع | `logs/flutter-analyze.log` |

اختبارا الملفات الخاصة المتخطيان هما `legacy_existing_file_fidelity_test.dart` و`legacy_actual_file_acceptance_test.dart`. لم تُضبط مسارات نسخ خاصة لهذه الدفعة.

اختبارات SQLite أثبتت بقاء جداول القيود والتاريخ والملف الأصلي دون تغيير عند اعتماد الكمية، وبقاء جدول حركات المخزون خاليًا حتى بعد اعتماد القيمة لاحقًا. البيع الجديد بعد اعتماد القيمة أنقص الكمية مرة واحدة فقط. النسخة الاحتياطية أعادت حالة اعتماد الكمية والتكلفة كما كانت.

## الأدلة والحدود

- [الكمية المعتمدة والتكلفة المعلقة في التقرير](browser/quantity-approved-movement-report.png)
- [رسالة الفاتورة](browser/quantity-approved-cost-pending-invoice.png)
- [سعر التكلفة المرجعي في ملف الأصناف](browser/quantity-approved-catalog-cost.png)
- [جرد الشاشات والأزرار](../../NASQO-UI-INVENTORY-AR.md)

اختبارات Chromium تستخدم حاوية اصطناعية ولا تشغّل SQLite أو Android. اختبارات Flutter Widget لا تمثل هاتفًا أو محاكي Android. جرى اختبار الخدمة والواجهة كلٌّ بطريقتها أعلاه، ولم تُختبر السلسلة كاملة على هاتف. زر النظام والإيماءة وقت الاعتماد، قتل عملية Android، وحفظ/مشاركة الملف عبر منتقي النظام لم تُختبر في هذه الدفعة.

الإصلاح محلي فقط: لا رفع ولا دمج ولا إصدار APK، ولا تغيير للحزمة أو التوقيع. لا اعتماد فعلي لأرصدة هاتف المستخدم من خلال هذه الجلسة؛ أضيف إجراء التأكيد إلى التطبيق.

## الملفات

- `flutter_app/lib/services/legacy_quantity_approval.dart`: قراءة المراجعة وتثبيت الكميات ذرّيًا مع منع التكرار والمراجعة القديمة.
- `flutter_app/lib/services/stock_quantity_approval_state.dart`: قراءة سجل الاعتماد والتحقق منه عند الاستعادة.
- `flutter_app/lib/screens/legacy_quantity_approval_screen.dart`: اختيار المخزن والأصناف والإقرار والتأكيد والإلغاء.
- `flutter_app/lib/screens/legacy_stock_opening_screen.dart`: الوصول للمسار الجديد وفصل اعتماد التكلفة لاحقًا.
- `flutter_app/lib/services/legacy_stock_opening.dart`: اعتماد القيمة دون إعادة إضافة كمية مثبتة.
- `flutter_app/lib/services/legacy_operational_restore.dart`: عرض حالتي الكمية والتكلفة وربط مخازن الصنف.
- `flutter_app/lib/services/local_inventory_reports.dart`: قراءة الرصيد المعتمد دون إعادة التاريخ واستثناء التكلفة المعلقة من التقييم.
- `flutter_app/lib/services/local_database.dart` و`local_invoice_roles.dart` و`local_stock_catalog.dart`: الحفاظ على حواجز التكلفة وسلامة تعديل بطاقات الأصناف.
- `flutter_app/lib/services/local_backup_restore.dart`: تدقيق سجل الاعتماد ومنع تفسير تكلفة غير معتمدة كقيمة موثوقة في الاستيراد الموحد.
- `src/Prototype.tsx` و`src/types.ts` و`src/firebase.ts` و`src/hybrid/serviceAdapter.ts`: حالات الكمية والتكلفة والرسائل والعرض.
- `src/utils/quantityFormat.ts` و`src/utils/exportPdf.ts`: دقة كميات المخزون في العرض وPDF.
- اختبارات جديدة: `legacy_quantity_approval_test.dart` و`legacy_quantity_approval_screen_test.dart` و`tests/quantityFormat.test.ts` و`scripts/verify-hybrid-quantity-approval.ts`.
- تحديث `tests/invoice-pdf.test.ts` لدقة الكميات، و`local_inventory_history_pagination_test.dart` بإضافة جدول حالة التطبيق إلى قاعدة الاختبار الاصطناعية.
- `AGENTS.md` و`NASQO-UI-INVENTORY-AR.md` وهذا التقرير وأدلته.

## إعادة الفحص

من الجذر: `npm run lint`، `npm run check:runtime`، `npm run build:hybrid`، ثم `npx tsx scripts/verify-hybrid-quantity-approval.ts`.
اختبارات JavaScript: `npx tsx --test tests/hybrid.test.ts tests/hybrid-pending-submission.test.ts tests/hybrid-resume-state.test.ts tests/invoiceCatalog.test.ts tests/catalogCosts.test.ts tests/itemMovementSummary.test.ts tests/quantityFormat.test.ts tests/invoice-pdf.test.ts`.
من `flutter_app`: `flutter test --reporter expanded`، ثم `flutter analyze --no-fatal-infos`.

استُخدم Flutter من `/workspace/toolchains/flutter/bin/flutter` مع `PUB_CACHE=/workspace/toolchains/pub-cache` و`LD_LIBRARY_PATH=/workspace/toolchains/lib`، وChromium من `/tmp/nasqo-playwright`. لم تتغير ملفات قفل الاعتماديات.
