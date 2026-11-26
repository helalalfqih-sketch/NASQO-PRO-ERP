# NASQO PRO ERP — Android release review (not an approval to publish)

## Build handoff
- Base: e10446709ad3cc5509606713a7a4028056a5c88d (work/flutter-hybrid-local-sqlite-20261123).
- Codemagic: select agent/codemagic-release-prep and Check for configuration files.
- Run nasqo-android-review first; review logs and debug APK.
- Release candidate uses Flutter 3.35.7, Android API 36 and upload-key reference nasqo_upload_key. Actual toolchain compatibility has not been verified.
- Existing Android package ID: com.indexesstore.nasqo_pro_erp. Verify this matches the intended Play app before signing. Do not reuse another app's upload key. An authorized adult maintainer must manage the upload key in Codemagic Code signing identities, retain a secure backup, and approve any account agreements or publication. Never store signing material in GitHub or chat.
- No publishing block, service-account credential, webhooks or automatic build triggers are included.
- Version is 1.0.0+1 from pubspec; confirm it has not already been used before any upload.

## Release blockers
- main.dart enables the React HybridReactPreviewScreen only when kDebugMode is true. Release currently opens the native NasqoMainShell, not the hybrid screen. Do not claim full hybrid integration or switch off this guard merely to publish.
- Existing local snapshot tests exercise adapter mappings, not real SQLite on a device. Financial mutation over the hybrid bridge is read-only in this branch. Verify native writes and persistence independently.
- Inspect generated manifest (permissions, exported components, backup behavior), target/compile SDK 36, AAB signature, 64-bit ABIs, 16 KiB page alignment, no bundled real customer data, and release runtime on Android 16.
- Run on a clean test device: first launch with empty local data, create synthetic account and ledger entry, verify totals, close and reopen app, confirm persistence, verify offline launch and navigation, test invalid entries and interruption, delete test data, compare native and debug hybrid views. Do not use real financial/customer records.
- Capture real release screenshots only after the above. Do not use debug-only screens to advertise release features. Confirm app icon is original brand, 512x512 RGBA PNG, <=1 MiB; phone screenshots 2–8, feature graphic 1024x500; check current Play requirements.
- A build passing unit tests is not financial correctness certification or permission to publish.

## Arabic store listing — draft, conditional on verification
Title: نسقو برو ERP
Short: إدارة الحسابات والمخزون والمعاملات المالية من واجهة عربية.
Long: نسقو برو ERP أداة لتنظيم أعمالك ومراجعة سجلاتك المحاسبية من واجهة عربية. يساعدك على إدارة الحسابات وتنظيم المعاملات ومتابعة المخزون والمستودعات والاطلاع على ملخصات مالية. صُمم التطبيق للعمل مع قاعدة بيانات محلية على الجهاز. تحقق من السجلات والمخرجات قبل الاعتماد عليها في إعداد التقارير الرسمية.
Do not claim cloud sync, tax compliance, encryption, or hybrid features without testing.

## Arabic privacy notice — draft only, NOT a published policy
اسم التطبيق: نسقو برو ERP
الغرض: تنظيم الحسابات والمعاملات والمخزون.
البيانات: قد تتضمن السجلات التي يدخلها المستخدم أسماء الحسابات والعملاء وأرقام الهاتف والملاحظات والأرصدة والمعاملات والمخزون وبيانات المنشأة.
التخزين: الكود الحالي يتضمن قاعدة SQLite محلية. يجب التحقق من سلوك نسخة Release الفعلية، بما في ذلك النسخ الاحتياطي للنظام والأذونات وأي اتصالات أو خدمات خارجية، قبل وصف البيانات بأنها محلية حصراً.
الاستخدام: تستخدم البيانات لتشغيل وظائف التطبيق وإظهار السجلات والملخصات.
الاحتفاظ والحذف: يجب توثيق آلية حذف السجلات والنسخ الاحتياطية بعد اختبارها فعلياً، وبيان ما إذا كان حذف التطبيق يزيل البيانات المحلية.
المشاركة: يجب توثيق جميع الخدمات والأطراف التي تتلقى البيانات فعلياً، إن وجدت، وعدم إعلان عدم المشاركة قبل مراجعة النسخة النهائية.
التواصل: يضيف المسؤول المخوّل اسم الجهة المسؤولة وبريد دعم صالحاً وتاريخ النفاذ.
هذه المسودة غير صالحة للنشر كما هي. بعد إتمام مراجعة البيانات، ينشر المسؤول سياسة نهائية على رابط HTTPS عام ويضيفها داخل التطبيق وصفحة المتجر، ويكمل نموذج Data safety بما يتوافق مع الإصدار الفعلي.

## Official references
- https://docs.codemagic.io/yaml-code-signing/signing-android/
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/9866151
- https://support.google.com/googleplay/android-developer/answer/9859455
