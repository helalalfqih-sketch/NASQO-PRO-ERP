# NASQO PRO ERP — حزمة التسليم والتكامل للدفعة الثانية (React Hybrid → Flutter Android)

هذا الأرشيف (`nasqo-react-hybrid-batch2-handoff.zip`) هو الحزمة الكاملة القابلة للمراجعة والتدقيق والدمج الآمن في فرع التكامل **`integration/hybrid-seven-20261121`** من المستودع `helalalfqih-sketch/nasqo-pro-mobile` دون استبدال Commit `0d734ca` مباشرة ودون تعديل أي ملف Flutter أو Android أو توقيع APK.

---

## 1. هيكل الأرشيف ومحتوياته

```text
nasqo-react-hybrid-batch2-handoff.zip
├── README_INTEGRATION.md                      # هذا الدليل (تعليمات التحقق، التشغيل، والدمج)
├── SHA256SUMS.txt                             # بصمات SHA-256 لكل ملف داخل الأرشيف
├── docs/
│   ├── HYBRID_FLUTTER_HANDOFF.md              # دليل التسليم وعينات JSON ونتائج الاختبارات
│   ├── HYBRID_BRIDGE_CONTRACT.md              # عقد البروتوكول الصارم (1.0.0) والأوامر والأخطاء
│   ├── HYBRID_BRIDGE_COMPATIBILITY.md         # مقارنة NasqoHome (0d734ca) مقابل NasqoFlutterBridge + الدفاع المتعمّق
│   └── HYBRID_REACT_AUDIT.md                  # التدقيق المعماري وتصنيف الشاشات والدفعات
├── patches/
│   ├── 01-src-Prototype.tsx.patch             # فرق مستقل لتعديلات src/Prototype.tsx
│   ├── 02-src-accounting.ts.patch             # فرق مستقل لتعديل src/accounting.ts (سطر واحد)
│   ├── 03-src-erp.ts.patch                    # فرق مستقل لتعديل src/erp.ts (عزل /api/db/*/erp)
│   ├── 04-src-prototype.css.patch             # فرق مستقل لتعديلات src/prototype.css (الوضع الداكن وتبويبات الإعدادات)
│   ├── 05-src-components-ExpenseCategorySelector.tsx.patch
│   ├── 06-package.json.patch                  # إضافة سكربت build:hybrid فقط
│   └── ALL_EXISTING_FILES_MODIFIED.patch      # الفرق المجمع لجميع الملفات القائمة المعدلة
├── new-files/                                 # جميع الملفات الجديدة بمساراتها الأصلية داخل المشروع
│   ├── hybrid.html
│   ├── vite.hybrid.config.ts
│   ├── scripts/build-hybrid.mjs
│   ├── scripts/verify-hybrid-home.mjs
│   ├── src/hybrid/
│   │   ├── brandAssetAdapter.ts
│   │   ├── bridge.ts
│   │   ├── contracts.ts
│   │   ├── entry.tsx
│   │   ├── firebaseAuthStub.ts
│   │   ├── googleDriveAdapter.ts
│   │   ├── homeFixture.ts                     # للاختبارات فقط — غير مضمن في dist/hybrid/
│   │   ├── hybrid.css
│   │   ├── mobileAdapter.tsx
│   │   ├── mockFlutterHost.ts                 # مرجعي غير مستورد — غير مضمن في dist/hybrid/
│   │   ├── presentationAdapter.tsx
│   │   ├── routes.ts
│   │   └── serviceAdapter.ts
│   └── tests/hybrid.test.ts
├── dist/hybrid/                               # حزمة الإنتاج الجاهزة للعمل دون اتصال (64 ملفًا)
│   ├── index.html                             # CSP connect-src 'none' — بدون mockFlutter
│   ├── hybrid-manifest.json                   # بصمات SHA-256 + bridgeChannel: "NasqoHome" + mockHostStripped: true
│   └── assets/...                             # JS + CSS + الخطوط العربية + شعار التطبيق
├── logs/                                      # السجلات الخام الفعلية لإعادة تشغيل كل الاختبارات
│   ├── 01-build-hybrid.log
│   ├── 02-check-runtime.log
│   ├── 03-tsc-lint.log
│   ├── 04-unit-tests.log
│   ├── 05-playwright-home-qa.log
│   ├── 06-web-build.log
│   └── home-verification-report.json
└── qa/hybrid_home/                            # 10 لقطات شاشة للمقارنة البصرية (فاتح/داكن/320/360/393/427/130%)
```

---

## 2. التحقق من سلامة الملفات (SHA-256)

بعد فك ضغط الأرشيف في مجلد مؤقت:

```bash
# التحقق من بصمة ملف الـ ZIP نفسه (إن أرفقت ملف .sha256 بجانبه)
sha256sum -c nasqo-react-hybrid-batch2-handoff.zip.sha256

# فك الضغط والتحقق من بصمة كل ملف داخل الأرشيف
mkdir -p /tmp/nasqo-handoff && unzip nasqo-react-hybrid-batch2-handoff.zip -d /tmp/nasqo-handoff
cd /tmp/nasqo-handoff && sha256sum -c SHA256SUMS.txt
```

---

## 3. أوامر تشغيل جميع الاختبارات في بيئة React (من جذر مشروع الويب)

```bash
# 1) بناء حزمة Android WebView المحلية وتدقيق خلوها من الروابط الخارجية وmockFlutter
npm run build:hybrid

# 2) التحقق من عدم المساس بملفات وقت التشغيل المحمية الـ 28
npm run check:runtime

# 3) فحص الأنواع (TypeScript)
npx tsc --noEmit

# 4) تشغيل اختبارات الوحدة والعقود (15 اختبارًا عبر node:test)
npx --yes tsx --test tests/hybrid.test.ts

# 5) تشغيل اختبارات المتصفح الإحدى عشرة عبر Playwright وقناة window.NasqoHome
node scripts/verify-hybrid-home.mjs

# 6) التحقق من بناء تطبيق الويب الكامل (Sites/Cloudflare)
npm run build
```

---

## 4. خطوات المراجعة والدمج الآمن في فرع `integration/hybrid-seven-20261121`

1. **لا تستبدل Commit `0d734ca` مباشرة**؛ أنشئ فرع تكامل فرعي جديد من `integration/hybrid-seven-20261121`.
2. **راجع الفروقات المستقلة أولًا** داخل `patches/` (`01-src-Prototype.tsx.patch` إلى `06-package.json.patch`)؛ يمكن تطبيقها بـ `git apply --check patches/ALL_EXISTING_FILES_MODIFIED.patch` ثم `git apply`.
3. **انسخ الملفات الجديدة** من `new-files/` إلى مساراتها المقابلة في المشروع، وانسخ `docs/*` إلى الجذر.
4. **أعد استخدام `HybridHomeView.kt` الواحد فقط**:
   - راجع `docs/HYBRID_BRIDGE_COMPATIBILITY.md` للتحقق من توافق `window.NasqoHome` و `MethodChannel("nasqo/home/$id")` في `flutter_app/lib/hybrid/hybrid_home_view.dart`.
   - انسخ `dist/hybrid/` إلى مسار الأصول المحلي الذي يحمله `WebViewAssetLoader`.
5. **طبّق الدفاع المتعمّق في Dart وSQLite**:
   - لا تعتمد على `capabilities.readOnlyFinancial` في JS وحده؛ افرض القائمة البيضاء في Dart مستقلًا، وعند تفعيل أوامر الترحيل المالي نفّذ كل عملية داخل `db.transaction` واحدة مع `UNIQUE(idempotency_key)` في جدول `bridge_idempotency_keys`.
6. **اختبر على Android فعليًا** (`flutter test` + تشغيل على جهاز/محاكي Android) قبل اعتماد الدمج في `integration/hybrid-seven-20261121`.
