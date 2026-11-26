# بناء نسقو برو عبر Bitrise

الإعداد في `bitrise.yml` يخص المستودع `helalalfqih-sketch/NASQO-PRO-ERP`.
مصدر العمل هو الفرع الحالي بعد إصدار 1.0.141، بدءًا من
`06b4a3e1bafe37ec8aa3f01b4edbcde6300ff6e7`؛ لا يعود إلى إصدار قديم.

## ما ينفذه workflow المسمى primary

1. تثبيت Node 24.12.0 وFlutter 3.29.3 وJava 17.
2. تثبيت اعتماديات JavaScript من lockfile، وفحص الملفات المحمية ومنع تسرب النسخ الاحتياطية.
3. بناء React المحلي ونسخه إلى أصول Flutter والتحقق من بصماته، ثم اختبارات الجسر والحفظ والاستئناف ومساحة العمل والمراجع والنسخ الاحتياطي الاصطناعية.
4. توليد هيكل Android وتشغيل إعداد الحزمة والهوية العربية الحاليين، ثم تحليل Flutter واختباراته المعتمدة في المستودع.
5. بناء debug APK والتحقق من الحزمة `com.indexesstore.nasqo_pro_erp` والاسم «نسقو برو» وكتابة SHA256 وSHA المصدر.
6. حفظ APK والسجلات كملفات خاصة داخل Bitrise، حتى عند فشل مرحلة سابقة. لا تُنشأ صفحة تثبيت عامة، ولا تُرسل إشعارات بريد من خطوة حفظ الملفات.

الـ APK للتجربة على محاكي نظيف. توقيعه التجريبي ليس توقيع تحديث النسخة المثبتة، ولا ينبغي إزالة التطبيق الحالي أو بياناته لتثبيته. هذا workflow لا ينشر Google Play أو GitHub Release، ولا يغيّر حزمة الإنتاج أو مفاتيحها. وجود APK ناجح لا يثبت اختبار الواجهة على هاتف.

## ربط الحساب عندما يصبح الوصول متاحًا

- مساحة العمل المستهدفة: `720aec51ef50c0ba`.
- المستودع: `https://github.com/helalalfqih-sketch/NASQO-PRO-ERP.git`.
- فرع الإعداد: `agent/bitrise-android-ci`.
- نوع المشروع: Flutter. موقع المشروع: `flutter_app`، وملف الإعداد `bitrise.yml` في جذر المستودع.
- استخدم stack من نوع Ubuntu for Android & Docker، وموارد ضمن خطة الحساب المجانية فقط. الإعداد لا يختار جهازًا مدفوعًا أو يغيّر الاشتراك.
- استخدم الإعداد المخزن في المستودع وشغّل `primary` يدويًا أولًا. `trigger_map` فارغ؛ إضافة الملف لا تفعّل بناءً دوريًا أو بناءً عند كل push تلقائيًا.
- لا تحتاج مفاتيح توقيع الإنتاج أو Google Drive أو Firebase لهذا المسار. منح Bitrise صلاحية قراءة المستودع يتم عبر الربط الرسمي للحساب؛ لا تُنسخ رموز دخول المتصفح إلى الكود.

ربط حساب Bitrise وتشغيل أول بناء فيه يحتاجان وصولًا فعليًا إلى الإضافة أو المتصفح. إنشاء الملف أو دفعه إلى GitHub لا يثبت تنفيذ هذه الخطوة الخارجية. نتائج التحقق المحلي مذكورة في `deliverables/bitrise-ci/REPORT-AR.md`.

## إعادة التحقق محليًا

استخدم checkout منفصلًا وNode وFlutter وAndroid SDK، ثم عيّن `BITRISE_DEPLOY_DIR` إلى مجلد أدلة خاص خارج المستودع وشغّل مراحل `scripts/bitrise-android-ci.sh` بالترتيب: `web` ثم `prepare` ثم `test` ثم `apk`.

المرجع: [Flutter على Bitrise](https://docs.bitrise.io/en/bitrise-ci/getting-started/quick-start-guides/getting-started-with-flutter-projects)، [تحديد إصدارات الأدوات](https://docs.bitrise.io/en/bitrise-ci/configure-builds/configuring-build-settings/configuring-tool-versions)، [إعداد ملفات البناء الخاصة](https://github.com/bitrise-steplib/steps-deploy-to-bitrise-io/blob/master/step.yml).
