# البنود الحرة — إصلاح محلي

التاريخ: 2026-11-25. المستودع: `helalalfqih-sketch/NASQO-PRO-ERP`.
نسخة العمل المعزولة: `/workspace/NASQO-free-invoice`، الفرع `repair/free-invoice-lines`.
SHA الأساس المتحقق منه قبل التعديل: `0a0b2414207166f783ea2bee2e64d4df4a4fa394` (مصدر الإصدار 1.0.123).

## المشكلة والسلوك الجديد

كانت «حرة» تعرض مبلغًا فقط، وترسل `lines: []`، ويرفض أمر الحفظ المحلي البنود غير الفارغة. أصبح اختيار «حرة» يتيح اسم البند والكمية والسعر وإضافة/حذف البنود، مع إجمالي محسوب. الكمية حتى ثلاث منازل عشرية والسعر حتى منزلتين. الحساب والتقريب يتطابقان مع SQLite باستخدام أجزاء صحيحة للأموال والكميات.

البنود وصفية، بلا معرف صنف أو ارتباط بمخزن. يحفظ أمر الفاتورة البنود والقيد المحاسبي داخل المعاملة نفسها، ولا يكتب أي حركة مخزون. تؤكد الاختبارات البيع والشراء النقدي والآجل وتوازن القيود وعدم تكرارها عند إعادة الطلب. يخضع الترحيل لإعدادات الحسابات المحلية المعتادة؛ لا يُنشئ حسابات من تلقائه.

تُحفظ البنود في `invoice_lines` بمعرف صنف فارغ، وتُحفظ أوصافها الكاملة في `erp_state` تحت `free_invoice_lines:<id>`؛ كلاهما مشمولان مسبقًا بالنسخة الاحتياطية الأصلية. لا تغيير لمخطط القاعدة أو إصدارها. تستعيد القراءة المحلية البنود للمعاينة وPDF، وعدد البنود في snapshot يمنع تصدير PDF ناقص عند فقد التفاصيل. لا يُفترض وجود مخزن رئيسي في PDF لفاتورة حرة بلا مخزن.

تحتفظ المسودة بصفوف منفصلة للأصناف والبنود الحرة. خيار «مبلغ فقط» يحافظ على الاستخدام القديم، والفواتير الحرة القديمة بلا بنود تظل قابلة للقراءة. تدعم عروض الأسعار والطلبيات الحرة تخزين البنود وتعديلها وحذف المسودة دون قيد أو مخزون. تبقى الفاتورة المرحّلة خاضعة لقواعد تعديل البيانات الوصفية فقط.

هذا الإصلاح لا يعتمد كميات مستوردة أو أسعار تكلفة ولا يغيّر حماية ترحيل مخزون غير معتمد. لم تُستعمل نسخة المستخدم الخاصة أو بيانات هاتفه.

## التحقق

| الفحص | النتيجة | الدليل |
|---|---|---|
| Flutter كامل | 80 ناجحًا، اختباران خاصان متخطيان عمدًا | `logs/flutter-all.log` |
| SQLite للبنود الحرة | بيع/شراء × نقد/آجل؛ حفظ وقراءة عبر اتصال مستقل؛ إعادة طلب بلا تكرار؛ رفض بيانات تالفة بلا أي تغيير؛ نسخة احتياطية واستعادة مطابقة؛ دورة حياة عرض سعر؛ ثبات المخزون | `logs/flutter-free-lines.log` و`flutter_app/test/free_invoice_lines_test.dart` |
| JavaScript والجسر وPDF | 36 ناجحًا | `logs/js-tests.log` |
| الواجهة المبنية — بنود حرة | 6 سيناريوهات ناجحة؛ لا أخطاء متصفح ولا طلبات شبكة خارجية | `browser/results.json`، `logs/browser.log` |
| تراجع اختيار الأصناف | 8 سيناريوهات ناجحة؛ حماية المخزون غير المعتمد وبقاء الاختيار داخل الفاتورة | `catalog-regression/results.json` |
| TypeScript | ناجح | `logs/typescript.log` |
| بناء Hybrid | ناجح؛ صفر مخالفات فحص offline/security الخاص بالحزمة | `logs/hybrid-build.log` |
| الملفات المحمية | 28 ملفًا سليمة | `logs/protected-runtime.log` |
| Flutter analyze --no-fatal-infos | لا أخطاء أو تحذيرات؛ 140 ملاحظة أسلوبية على المشروع | `logs/flutter-analyze.log` |

أُنشئ ملف PDF فعلي من الواجهة المبنية مع جسر اصطناعي يلتقط البايتات، وتمت معاينة الصفحة الناتجة. هذا يثبت إنشاء المستند وعرض البنود؛ لا يثبت حفظه عبر منتقي Android أو الطباعة على جهاز.

الاختباران المتخطيان: `legacy_existing_file_fidelity_test.dart` و`legacy_actual_file_acceptance_test.dart` لأن متغيرات مسارات النسخ الخاصة غير مضبوطة؛ اختبارات هذه الدفعة اصطناعية فقط.

## الأدلة المرئية والحدود

- [واجهة البنود والإجمالي](browser/free-lines-total.png)
- [معاينة الفاتورة](browser/free-lines-print-preview.png)
- [PDF اصطناعي مولّد](browser/synthetic-free-invoice.pdf)
- [صفحة PDF بعد تحويلها لصورة](browser/synthetic-free-invoice-page.png)
- [جرد الشاشات والأزرار المحدث](../../NASQO-UI-INVENTORY-AR.md)

لم يُختبر هاتف أو محاكي Android، زر النظام والإيماءة، قتل عملية Android، منتقي حفظ PDF أو مشاركة Android أو إرسال واتساب. اختبار إعادة تحميل المتصفح ليس قتل عملية Android؛ اختبار اتصال SQLite مستقل ليس اختبار دورة حياة الهاتف. لم يُرفع أو يُدمج هذا الإصلاح ولم تُنشأ نسخة APK جديدة، ولم تتغير الحزمة أو التوقيع.

## إعادة الاختبار

من جذر المستودع، بعد تجهيز الاعتماديات:

```sh
npm run lint
npm run check:runtime
npm run build:hybrid
npx tsx --test tests/invoice-pdf.test.ts tests/hybrid.test.ts tests/hybrid-pending-submission.test.ts tests/hybrid-resume-state.test.ts tests/invoiceGridUtils.test.ts
npx tsx scripts/verify-hybrid-free-invoice.ts
npx tsx scripts/verify-hybrid-invoice-catalog.ts
```

من `flutter_app`: `flutter test --reporter expanded` و`flutter analyze --no-fatal-infos`.

في بيئة هذه المهمة استُخدم Flutter من `/workspace/toolchains/flutter/bin/flutter` و`PUB_CACHE=/workspace/toolchains/pub-cache` و`LD_LIBRARY_PATH=/workspace/toolchains/lib` وChromium في `/tmp/nasqo-playwright`. لم تتغير ملفات قفل الاعتماديات.

## الملفات المعدلة

- `src/Prototype.tsx`: إدخال البنود الحرة وحسابها واستعادة المسودة وإرسال البنود للحفظ والمشاركة.
- `src/prototype.css`: تنسيق البنود الحرة.
- `src/utils/exportPdf.ts`: منع PDF ناقص وتجنب افتراض مخزن للفواتير الحرة.
- `flutter_app/lib/services/free_invoice_lines.dart`: التحقق والحساب والتخزين والقراءة.
- `flutter_app/lib/services/local_document_commands.dart`: إدخال البنود في المعاملة وهوية طلب الحفظ.
- `flutter_app/lib/services/local_document_lifecycle.dart`: مسودات العرض والطلبية الحرة.
- `flutter_app/lib/hybrid/hybrid_react_preview_screen.dart`: إعادة البنود في قراءة تفاصيل الفاتورة.
- `flutter_app/lib/hybrid/local_snapshot_adapter.dart`: عدد البنود المحفوظة.
- `flutter_app/test/free_invoice_lines_test.dart`: فحوص SQLite الاصطناعية.
- `tests/invoice-pdf.test.ts`: محتوى PDF للفواتير الحرة.
- `scripts/verify-hybrid-free-invoice.ts`: اختبار الواجهة المبنية والجسر الاصطناعي والتقاط PDF.
- `AGENTS.md` و`NASQO-UI-INVENTORY-AR.md`: توثيق توجيه المستخدم ومسارات التحقق.
- `deliverables/free-invoice-lines/`: هذا التقرير وسجلات وأدلة الاختبار الاصطناعية.
