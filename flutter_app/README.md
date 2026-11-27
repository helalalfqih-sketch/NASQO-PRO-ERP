# نسقو برو ERP — Android / Flutter / SQLite

تطبيق Android يستخدم واجهة React المضمّنة داخل WebView، ويتصل بخدمات Flutter وقاعدة SQLite على الجهاز. الحزمة ثابتة: `com.indexesstore.nasqo_pro_erp`.

## الطبقات

- `lib/main.dart`: تشغيل التطبيق.
- `lib/hybrid/`: بروتوكول الأوامر، لقطات البيانات واتصال الواجهة.
- `lib/services/`: قاعدة البيانات، الفواتير والمخزون والبيانات الإدارية والنسخ الاحتياطية.
- `android/app/src/main/kotlin/`: WebView المحلي ودورة الحياة واتصال الرسائل.
- `assets/web/`: ملفات React المولّدة؛ لا تُعدّل يدويًا ولا تُضمّن في Git.

تُخدّم الملفات من `https://appassets.androidplatform.net/offline/flutter_assets/assets/web/` عبر `WebViewAssetLoader`. يحافظ المسار المحلي على قيود المصدر والشبكة، وتُنفّذ الكتابة المحاسبية داخل خدمات SQLite مع المعاملات ومنع تكرار الأوامر.

## بناء وتشغيل نسخة تطوير

المتطلبات المستخدمة في CI: Flutter 3.29.3، Java 17، Node.js 24 وAndroid SDK.

من جذر المستودع:

```sh
npm ci
npm run sync:flutter-hybrid
cd flutter_app
flutter create --platforms=android --org=com.indexesstore .
node ../scripts/setup-android-hybrid.mjs
flutter pub get
flutter test
flutter run
```

أعد `npm run sync:flutter-hybrid` بعد تعديل React. شغّل `setup-android-hybrid.mjs` بعد إعادة توليد ملفات Android لحفظ اسم التطبيق وموارده واتصال WebView.

## الحزم الموقعة والاختبارات

يبني `.github/workflows/flutter-hybrid-preview.yml` الحزم الموقعة من أسرار GitHub Actions. يبقي هوية الحزمة وشهادة التوقيع ثابتتين، ويضبط حزم Google Play على minSdk 24 وtargetSdk 36. لا تحفظ keystore أو كلمات مروره في Git.

اختبارات SQLite الأصلية تنفّذ CRUD والتحقق والمراجع والتراجع ومنع التكرار والنسخ الاحتياطي. اختبارات Android تستخدم محاكي CI وبيانات مصطنعة للتحقق من تحديث التطبيق دون إزالة بياناته، ثم التنقل والاستيراد والعمليات الفعلية. راجع [تقرير التحقق](../docs/verification/full-crud.md) ونتائج Actions الخاصة بكل حزمة.

الواجهة الأصلية البديلة وملفات منصات Flutter لا تعني أن iOS أو Desktop أو Flutter Web اعتمدت للإنتاج. بعض أزرار الترحيل الإداري المتقدم على Android تحتفظ بقيودها الحالية؛ مسارات الفواتير والسندات الأصلية تبقى المسارات المالية المتاحة. لا تنشر حزمة فشلت اختبارات قبولها.
