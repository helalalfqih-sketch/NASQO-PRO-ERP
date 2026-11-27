# إصدار Android 1.0.124 (1124)

نُشر 25 نوفمبر 2026 ، الساعة 22:25 بتوقيت عدن، كإصدار GitHub مستقر android-v1124. يوجد رابط توافق android-preview-v1124 للنسخ القديمة؛ كلاهما نفس APK وبصمة SHA-256. لا يعني هذا اعتماد كل وظائف ERP للإنتاج.

- مصدر APK: b607fa74925c8fc2c4662c6cb1e82f8164b1b25e. أداة التحقق والنشر: eb38115a8d4bb1c2bafd16cdefce386b50116beb.
- الاختبارات 90Flutter و 18 جسر ناجحة على المصدر. ملفات WebView التنفيذية والمرئية 63 مطابقة لأدلة القبول السابقة؛ اختلاف وقت الوصف فقط.
- التوقيع صالح وبنفس شهادة 1.0.123 ، الحزمة والصلاحيات التسع وميزات الجهاز مطابقة، debug غيرمفعل، والبناء ارتفع 1123 إلى 1124.
- ثبت Android الحزمة بواسطة install -r دون uninstall/clear ، وبقي appId نفسه وبدأت العملية دون FATAL EXCEPTION. السيناريو قاعدة فارغة اصطناعية، لا مقارنة سجلات متجر حقيقية.
- فشلت المحاولة الأولى في قارئ اسم userId بعد نجاح التثبيت؛ صحح إلى appId/userId وثبتت النتائج المحفوظة. إعادة المحاكاة نجحت ثم نشر CI الملفات. فشل الرفع من الجلسة 401 لم يعطل الرفع باستخدام GitHub Actions.
- الصورة الأولى لنفس APK تظهر الرئيسية. اللقطة في التشغيل الأخير التقطت شاشة تحميل مساحة العمل؛ لذلك اختبار install/launch لا يثبت اكتمال تحميل الرئيسية في مدة محددة أو استعادة المسودة بعد قتل العملية.

الدليل: upgrade-first/ و upgrade-final/، و verification.json و upgrade-static-comparison.json و artifact-verification-summary.json و publication-verification.json. النشر والتحقق النهائي: https://github.com/helalalfqih-sketch/NASQO-PRO-ERP/actions/runs/45684547905 .

تفاصيل الإصلاح والحدود في RELEASE-NOTES-AR.md. لم يُدمج main ، وبقي dev/offline-first-android-phase2 عند 0a0b2414207166f783ea2bee2e64d4df4a4fa394. لم يُثبت على هاتف المستخدم ولم تمس بياناته.
