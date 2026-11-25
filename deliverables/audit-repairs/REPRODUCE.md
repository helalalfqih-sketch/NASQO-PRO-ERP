# إعادة التحقق — بيانات اصطناعية فقط

نُفذت الأوامر من نسخة العمل التي يحددها manifest؛ إصدارات Flutter3.29.3 وChromium Playwright1.61.1. لا يستعمل أي أمر هنا نسخة المحل الخاصة.

```sh
npm install --no-audit --no-fund
npm run check:runtime
npm run sync:flutter-hybrid
npx tsc --noEmit
npx tsx --test tests/audit-repair-reports.test.ts tests/homeAppearanceSettings.test.ts tests/hybrid.test.ts tests/invoice-pdf.test.ts tests/legacy-invoice-preview.test.ts tests/backupFormat.test.ts tests/hybrid-pending-submission.test.ts tests/legacy-details-fidelity.test.ts tests/legacy-source-scope.test.ts tests/legacy-live-safety.test.ts tests/legacy-record-draft.test.ts tests/legacy-search-binding.test.ts tests/hybrid-resume-state.test.ts tests/quantityFormat.test.ts tests/invoiceCatalog.test.ts tests/invoiceGridUtils.test.ts
bash scripts/test-flutter-audit.sh
npx tsx scripts/verify-audit-repairs.ts
npx tsx scripts/inventory-current-actions.ts
```

`scripts/test-flutter-audit.sh` يستبعد `stock_invoice_commands_test.dart` صراحة بسبب ERP-001-RET-LATE، ويستبعد اختبارَي النسخة الخاصة. تشغيل هذا الملف المحظور ليس شرطًا لهذه النتائج.

لبيانات الأداء: من flutter_app شغّل `NASQO_ACCEPTANCE_OUT=../deliverables/audit-repairs/golden flutter test test/owner_acceptance_test.dart`، ثم من الجذر `npx tsx scripts/verify-audit-performance.ts`. المرجع 1123 يمرر باستخدام `PERF_BUNDLE` و`PERF_BASELINE=1` و`PERF_OUT` منفصل. لا يعد زمن التسليم لجسر الاختبار زمن Android.

سيناريوهات التراجع الإضافية: `verify-hybrid-back-resume.ts` و`verify-hybrid-free-invoice.ts` و`verify-hybrid-quantity-approval.ts` و`verify-hybrid-backup-fidelity.ts` تحت scripts. المجلد الناتج يعين بـNASQO_ACCEPTANCE_OUT. جميعها متصفح وجسر اصطناعيان.

قبول Android: workflow `android-hybrid-ui-smoke.yml` يبني debug ويثبت على محاكي نظيف تطبيق الاختبار وتطبيق استقبال مستقل، ثم يختبر ملفات وإلغاء وأزرار الواجهة. `qa/android-receiver` لا يُدمج في APK التطبيق العادي؛ مصادره تنسخ إلى androidTest فقط. نجاح بناء APK لا يعني نجاح instrumentation، ونتيجة التشغيل الكلية لا تُغيّر لمجرد نجاح بعض حدوده.

مصادر التحقق: `logs/*-final.log`، `browser-final/results.json`، `regression-final/*/results.json`، `performance-{before,after}/results.json`، `android-*/instrumentation.txt` وسجل NASQO_ACCEPTANCE. ملفات commands كبيرة تتضمن فقط ملفات اصطناعية base64 ؛ تحفظ محليًا ولا تدخل جميعها في Git. APK ونسخ `.back` الاصطناعية لا تدخل Git. شجرة المصدر تضم أيضًا callbacks ومكونات ديناميكية؛ لا تستخدم عدد مواضعها بوصفه عدد أزرار مختبرة.
