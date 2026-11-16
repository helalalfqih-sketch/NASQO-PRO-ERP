# نسقو برو ERP — نسخة Flutter (Dart)

تم تحويل منظومة **نسقو برو ERP** بالكامل إلى مشروع **Flutter (Material 3 + RTL Arabic)** جاهز للتشغيل على Android و iOS و Web و Desktop.

## البنية المعمارية للمشروع
- `lib/main.dart`: نقطة الدخول وإعدادات الثيم (`#0B5CA8` الأزرق الرئيسي و `#F39A16` البرتقالي) ودعم اللغة العربية RTL.
- `lib/models/erp_models.dart`: كافة نماذج البيانات (الحسابات، القيود، المخزون، المستودعات، الموظفون، الصفقات، أوامر الشراء، قوائم المواد BOM، ومراكز التكلفة).
- `lib/services/accounting_engine.dart`: محرك المحاسبة النقي (تحويل الأرقام العربية، ملخص الحسابات، ميزان المراجعة، قائمة الدخل، الميزانية العمومية، ضريبة القيمة المضافة 15%، ومسير الرواتب).
- `lib/state/erp_controller.dart`: إدارة الحالة (`ChangeNotifier`) وربط العمليات لحظياً بين نقاط البيع، الفواتير، المخازن، والأستاذ العام.
- `lib/screens/`: الشاشات الست المتكاملة + لوحة التحكم + `InvoiceFormSheet` + `CustomerListSheet`.
- `test/accounting_engine_test.dart`: اختبارات الوحدة لمحرك المحاسبة والـ ERP.

## أوامر التشغيل المحلية
```bash
cd flutter_app
flutter pub get
flutter test
flutter run
```
