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


## React AI Studio → Flutter Android (offline preview, work branch)

This repository's `main` remains the source of truth synchronized with AI Studio.
The feature branch `work/flutter-hybrid-local-sqlite-20261123` provides the first
**read-only hybrid integration**, without changing the production default.

**Architecture:** original React/Vite UI in Android WebView → JSON protocol
`NasqoFlutterBridge` → on-device `LocalDatabase` (SQLite).
No Cloud SQL or Firestore is involved in local financial storage.

### Prepare and run a developer preview

From the repository root, with Node.js, Flutter, Android SDK and Java installed:

```sh
npm ci
npm run sync:flutter-hybrid
cd flutter_app
# The source repository has no Android platform scaffold committed yet:
flutter create --platforms=android .
flutter pub get
flutter test
flutter run
```

In an **Android debug build only**, tap the web icon in the top app bar to
open the original React hybrid bundle. The icon is intentionally absent from
release builds until end-to-end verification is complete.

`npm run sync:flutter-hybrid` builds `dist/hybrid`, checks its offline
security manifest and copies it to `flutter_app/assets/web/`. Run it each
time React changes, then rebuild the Android app. Do not commit generated
bundles, APKs, SQLite databases, real customer exports or API secrets.

### Current safety boundaries

- Fresh installations start with **no fictitious customers, stock or ledger**.
  Existing stored records are loaded even when the accounts table is empty.
- `getSnapshot` is the only command currently supported by
  `HybridReadOnlyProtocol`; **all financial write commands are denied**.
- Snapshots are derived from persisted SQLite records, never sample fixtures.
- Some new React schema features (cashboxes, account groups, document line
  structures) do not exist in the older Flutter SQLite v1 model yet. Their
  compatibility adapters and verified atomic/idempotent posting remain pending.
- No real Android build, Flutter unit test run, or offline WebView UI test has
  been completed in this environment; do not ship this as a production APK.

### Review before enabling financial posting

Check Android WebView navigation/network isolation, real asset loading,
SQLite empty/restore/migration behavior, account and currency mappings,
transaction rollback, duplicate-submission protection, invoice and stock
integrity, Arabic/RTL layouts and real-device tests. Never merge into `main`
until the tests pass and the user approves.
