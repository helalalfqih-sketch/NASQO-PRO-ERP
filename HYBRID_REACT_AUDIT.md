# تدقيق مشروع React لتحويله إلى حزمة هجينة قابلة للدمج مع Flutter Android WebView (`HYBRID_REACT_AUDIT.md`)

تاريخ التدقيق: 2026-11-21  
نطاق الفحص: مشروع `NASQO PRO ERP` الحالي (React 19 + TypeScript + Vite + CSS RTL) مع الحفاظ الكامل على نسخة الويب وبيئة العرض المحمية دون حذف أي مكوّن أصلي.

---

## 1. المكونات البصرية القابلة لإعادة الاستخدام مباشرة (Presentation Layer)

تتركز المكونات البصرية الأصلية في `src/Prototype.tsx`، `src/prototype.css`، و`src/components/`، وتعتمد على `@radix-ui/react-icons` و`motion/react` و`@use-gesture/react` و`d3` مع دعم كامل للغة العربية (RTL) والوضعين الفاتح والداكن (`:root.dark`):

| المكوّن | الملف | الوصف البصري والتفاعلي | الدفعة |
| --- | --- | --- | --- |
| `DashboardPage` + `DashboardHeader` + `DashboardBottomNav` + `AppDrawer` + `DashboardAddMenu` | `src/Prototype.tsx` | الشاشة الرئيسية الأصلية: الشريط العلوي، الشريط السفلي، جدول مجموعات الحسابات، بطاقات المؤشرات الثماني، شبكة الاختصارات القابلة للضغط المطول والسحب والترتيب والتثبيت وتغيير اللون والإخفاء/الإظهار، والقائمة الجانبية. | الدفعة 1 |
| `PurchasesPage` + `PurchasesHeader` + `CategoryFinancialFooter` + `ShopPage` + `SupplierPage` + `CashSupplierPage` + `CashOperationsMenu` | `src/Prototype.tsx` | قوائم الموردين والعملاء والمحل، كشف الحساب الآجل والنقدي، قوائم الفرز والبحث، قوائم عمليات الحساب. | الدفعة 2 |
| `AccountGroupsModal` + `ChartOfAccountsModal` + `CurrenciesModal` + `AccountPickerModal` + `AccountCreateModal` + `CurrencyPage` | `src/Prototype.tsx` | إدارة مجموعات الحسابات، دليل الحسابات، العملات، منتقي الحسابات، نموذج إنشاء/تعديل الحساب (المضغوط والموسع مع الرصيد الافتتاحي)، ومصارفة العملات. | الدفعة 2 |
| `InvoiceModal` + `TransactionModal` + `SimpleEntryPage` + `TransferModal` + `OutlinedAmountField` + `ExpenseCategorySelector` | `src/Prototype.tsx`, `src/components/TransferModal.tsx`, `src/components/OutlinedAmountField.tsx`, `src/components/ExpenseCategorySelector.tsx` | نماذج الفواتير (مبيعات/مشتريات/مرتجعات/عروض أسعار/طلبات)، سندات القبض والصرف، القيد البسيط، الحوالات، وحقل المبلغ بالتفقيط العربي المباشر. | الدفعة 3 |
| `WarehousesPage` + `WarehouseModal` + `ItemsCatalogPage` + `InventoryItemModal` + `InventoryBulkEditBar` | `src/Prototype.tsx`, `src/components/InventoryBulkEditBar.tsx` | إدارة المخازن، دليل الأصناف، التعديل الجماعي، واستيراد الأصناف. | الدفعة 3 |
| `ReportsHubModal` + `TrialBalanceModal` + `CashboxesReportModal` + `InventoryReportPage` + `DailyJournalPage` + `CashInvoicePreviewPage` + `CashInvoiceDocument` + `PrintOptionsModal` + `DashboardScreen` | `src/components/ReportsHubModal.tsx`, `src/Prototype.tsx`, `src/components/PrintOptionsModal.tsx`, `src/components/DashboardScreen.tsx`, `src/components/SalesTrendChart.tsx`, `src/components/SupplierPerformanceChart.tsx`, `src/components/ExpenseTrendsChart.tsx` | مركز التقارير المحاسبية (بفصل كامل لكل عملة دون دمج)، ميزان المراجعة، الصناديق، حركة المخازن والمخزون المتبقي الفعلي، اليومية العامة، معاينة الفاتورة الأفقية مع التكبير/التصغير، وخيارات الطباعة والتصدير. | الدفعة 4 |
| `SystemSettingsPage` + `WhatsAppSettingsPage` + `BackupNameModal` + `GoogleDriveModal` + `FullSqliteImportModal` + `NotificationCenter` + `TrashModal` + `QrScannerModal` | `src/components/SystemSettingsPage.tsx`, `src/Prototype.tsx`, `src/components/BackupNameModal.tsx`, `src/components/GoogleDriveModal.tsx`, `src/components/FullSqliteImportModal.tsx`, `src/components/NotificationCenter.tsx`, `src/components/QrScannerModal.tsx` | شاشة الإعدادات الاحترافية ذات التبويبات الأربع (`المنشأة`، `المظهر`، `الطباعة`، `قاعدة البيانات`) وبطاقة النسخ الاحتياطي، إعدادات واتساب، الإشعارات، سلة المهملات، والماسح. | الدفعة 5 |
| `NasqoBrandLoader` + `ErrorBoundary` + `WhatsAppIcon` | `src/components/` | شاشة التحميل، حاجز الأخطاء، والأيقونات المخصصة. | مشترك |

---

## 2. مكونات العمليات والإدخال والتعديل المالي (Write & Mutation Surfaces)

جميع العمليات التي تُحدث تغييرًا في قاعدة البيانات (`SQLite`) تمر عبر هذه المكونات:
- **القيود والفواتير والسندات**: `InvoiceModal`, `TransactionModal`, `SimpleEntryPage`, `TransferModal`, `CurrencyPage`, `TrashModal` (حذف/استعادة/حذف نهائي).
- **الحسابات والمجموعات والعملات**: `AccountCreateModal`, `AccountGroupsModal`, `ChartOfAccountsModal`, `CurrenciesModal`.
- **المخازن والأصناف**: `WarehouseModal`, `InventoryItemModal`, `InventoryBulkEditBar`, `handleItemsFileImport` (استيراد أصناف).
- **الإعدادات والنسخ الاحتياطي**: `SystemSettingsPage`, `BackupNameModal`, `FullSqliteImportModal`, `GoogleDriveModal`, `ResetDatabaseConfirmModal`.

**قاعدة السلامة المحاسبية للهجين**:
في حزمة Flutter الهجينة، تبقى هذه النماذج في React للعرض والإدخال والتحقق المبدئي، لكن **كل عملية حفظ/ترحيل/حذف** يجب أن تُرسل إلى Flutter عبر جسر الرسائل مع `requestId` فريد و`idempotencyKey`، ويُمنع عرض رسالة نجاح قبل وصول رد `{ ok: true }` مؤكد من Dart/SQLite.

---

## 3. الاعتماديات على Firebase والخادم والمتصفح (Isolation Boundaries)

| المصدر الحالي | الملفات المستخدمة له | الوضع في نسخة الويب | المعالجة في حزمة Flutter الهجينة |
| --- | --- | --- | --- |
| `firebase/app` و`firebase/auth` | `src/firebase.ts`, `src/Prototype.tsx`, `src/components/erp/SmartProControlScreen.tsx` | مصادقة ويب ومزود Google OAuth | **عزل كامل عبر Vite alias** في `vite.hybrid.config.ts` واستبداله بـ`src/hybrid/serviceAdapter.ts` و`src/hybrid/firebaseAuthStub.ts` — صفر حزم Firebase داخل `dist/hybrid/`. |
| Express SQLite API (`/api/sqlite/*`) | `src/firebase.ts`, `src/erp.ts`, `src/Prototype.tsx` | خادم Node محلي على المنفذ 3000 | **استبدال كامل بجسر `NasqoFlutterBridge`** داخل حزمة الهجين؛ لا توجد أي استدعاءات `fetch()` من الواجهة الهجينة. |
| `src/services/googleDrive.ts` | `src/components/GoogleDriveModal.tsx`, `src/Prototype.tsx` | اتصال مباشر بـ Google Drive API | يمر عبر أوامر Flutter المصرح بها (`googleDriveAction` / `backupAction`) ولا يفترض وجود توكن أو شبكة داخل JS المضمّن. |
| `src/components/ExpenseCategorySelector.tsx` | `fetch("/api/ai/categorize-expense")` | اقتراح تصنيف عبر الخادم | يُعطّل الشبكة في وضع الهجين ويكتفي بالتصنيف المحلي الحتمي (`inferExpenseCategory`) دون أي طلب HTTP. |
| `src/mobile/*` (`PhoneFrame`, `StatusBar`, `KeyboardDock`) | `src/App.tsx`, `src/Prototype.tsx`, `src/components/*` | محاكي إطار الهاتف ولوحة المفاتيح للويب | **تبقى محمية 100% للويب**؛ وفي حزمة الهجين تُستبدل عبر alias بـ`src/hybrid/mobileAdapter.tsx` لتقديم `FlowStack`, `MobileScroll`, `BottomSheet`, `KeyboardInput`, `KeyboardTextarea`, `useKeyboard`, `useScreenPortal` مكيّفة لـ Android WebView الأصلي دون إطار هاتف وهمي. |
| Google Fonts (`https://fonts.googleapis.com`) | `index.html` | تحميل خطوط ويب خارجي | في `hybrid.html` يُحذف رابط Google Fonts بالكامل، وتُضمّن الخطوط العربية محليًا عبر `@fontsource/ibm-plex-sans-arabic` و`@fontsource/cairo` مع `CSP` تمنع `connect-src 'none'`. |
| الأصول الثابتة (`/assets/aistudio/NASQO_PRO_ERP_800_022d325f.png`) | `src/utils/appBrand.ts` | مسار جذري `/assets/...` | في حزمة الهجين يُستبدل بمسار محلي مُجمّع نسبيًا عبر Vite (`src/hybrid/brandAssetAdapter.ts`) ليعمل داخل أصول APK دون خادم. |

---

## 4. استدعاءات الشبكة المرصودة (Network Audit)

1. `src/firebase.ts`: `fetch("/api/sqlite/...")` (جميع عمليات القراءة والكتابة والتقارير والنسخ الاحتياطي).
2. `src/Prototype.tsx`: `fetch("/api/sqlite/auth/status|login|logout")` و`fetch("/api/smartpro/status")` في `NasqoProductionShell`.
3. `src/erp.ts`: `fetch("/api/sqlite/workspace/local-erp-workspace/erp")` عند `saveErpWorkspaceData`.
4. `src/services/googleDrive.ts`: `fetch("https://www.googleapis.com/...")`.
5. `src/components/ExpenseCategorySelector.tsx`: `fetch("/api/ai/categorize-expense")`.
6. `index.html`: `<link href="https://fonts.googleapis.com/...">`.

**النتيجة في حزمة الهجين**: جميع هذه الاستدعاءات معزولة عن حزمة `dist/hybrid/`؛ ويتم فرض ذلك أيضًا عبر `Content-Security-Policy` (`connect-src 'none'`).

---

## 5. التخزين المحلي والتفضيلات (`localStorage` / UI Preferences)

| المفتاح | الملف | المحتوى | الربط مع Flutter في الهجين |
| --- | --- | --- | --- |
| `nasqo-home-tile-layout-v1` | `src/utils/dashboardPrefs.ts` | ترتيب بطاقات الاختصارات، المثبتة، المخفية، وتخصيص اللون (`blue`/`amber`). | يُقرأ من Snapshot Flutter ويُرسل فور تغييره عبر `saveUiPreferences`. |
| `nasqo-home-metrics-order` | `src/utils/dashboardPrefs.ts` | ترتيب بطاقات المؤشرات الثماني. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-dashboard-widget-order` | `src/utils/dashboardPrefs.ts` | ترتيب ويدجت لوحة المبيعات. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-pinned-favorites` | `src/utils/dashboardPrefs.ts` | المفضلات المثبتة. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-extended-settings-v1` | `src/utils/appSettings.ts` | إعدادات المظهر والبطاقات والخطوط والطباعة ونصوص الفواتير. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-theme-mode-v2` | `src/utils/theme.ts` | المظهر (`light` / `dark` / `system`). | يُزامن بالاتجاهين عبر `saveUiPreferences` وحدث `themeChanged`. |
| `nasqo-brand-color-v2` | `src/utils/brandColor.ts` | اللون الرئيسي للعلامة. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-haptics-enabled` | `src/utils/haptics.ts` | تفعيل الاهتزاز اللمسي. | يُزامن عبر `saveUiPreferences`. |
| `nasqo-read-notifs` / `nasqo-dismissed-notifs` | `src/Prototype.tsx` | حالة قراءة/تجاهل الإشعارات. | يُزامن عبر `saveUiPreferences`. |

---

## 6. وظائف المحاسبة والمخزون النقية (Pure Domain Logic)

- `src/accounting.ts`: دوال نقية خالية من الشبكة لحساب ملخص الحسابات (`computeAccountSummary`), كشف الحساب (`computeStatementRows`), إجماليات الفئات المفصولة بالعملة (`computeCategoryTotalsByCurrency`), ميزان المراجعة المفصول بالعملة (`computeTrialBalanceReport`, `computeTrialBalanceByCurrency`), ملخص المخزون (`computeInventorySummary`), التفقيط العربي (`amountToArabicWords`), الإشعارات (`computeWorkspaceNotifications`), وبناء CSV.
- `src/erp.ts`: الدوال التحليلية للموارد البشرية، المشتريات، التصنيع، القوائم المالية، والضريبة (تُعزل دالة `saveErpWorkspaceData` فقط لتمر عبر الجسر في الهجين).
- `server/sqliteDb.ts`: يمثل المرجع التوثيقي لمنطق SQLite (تقارير حركة المخازن `getInventoryMovementsReport` وتقرير الصناديق `getCashboxesReport` ومعادلات الفواتير والترحيل) الذي ينفذه فريق Flutter داخل Dart/SQLite.

---

## 7. نقاط التنقل والطباعة والملفات

- **التنقل (`FlowStack` & `routes.ts`)**: يدير `AuthenticatedWorkspace` مكدس الشاشات (`dashboard`, `purchases`, `sales`, `clients`, `employees`, `transfers`, `shop`, `supplier`, `warehouses`, `items`, `inventory-report`, `daily-journal`, `analytics-dashboard`, `simple-entry`, `currency`, `whatsapp`, `settings`, `cash-invoice-preview`, و`erp:*`) إضافة إلى النوافذ المنبثقة (`OverlayKind`). في الهجين يرتبط ذلك بأوامر `navigate` و`goBack` واستقبال زر الرجوع الفعلي من Android (`backPressed`).
- **الطباعة وتصدير PDF**: تستدعي حاليًا `window.print()` و`jspdf` / `canvasExport`. في الهجين تمر عبر أوامر الجسر `printDocument` و`exportPdf` (مع الاحتفاظ بتوليد HTML/PDF محلي عند طلب Flutter).
- **اختيار الملفات والاستيراد/النسخ الاحتياطي**: `<input type="file">` لملفات الاستعادة (`.sql/.sqlite/.json`) واستيراد الأصناف (`.xlsx/.csv`) ورفع الشعار، تمر في الهجين عبر أمر `pickFile` مع دعم الاحتياطي الآمن.

---

## 8. الحركات والقوائم والنوافذ المنبثقة

- **الحركات**: `motion/react` (`AnimatePresence`, `motion.div`) لانتقالات الشاشات، القوائم المنبثقة، والـ `BottomSheet`، وحركات CSS (`nasqo-modal-rise`, `nasqo-menu-rise`, `nasqo-loader-spin`) مع احترام `prefers-reduced-motion`.
- **الضغط المطول والسحب**: محرر بطاقات الرئيسية (`DashboardPage`) يستخدم `pointerdown`/`pointerup` للضغط المطول والسحب للترتيب، إضافة إلى أزرار التثبيت وتغيير اللون والإخفاء.
- **النوافذ المنبثقة**: جميع النوافذ تعمل داخل `.center-modal-layer` مع `role="dialog"` و`aria-modal="true"` وتقييد العرض إلى `calc(100% - 16px)` لدعم الشاشات من `320px` إلى `427px` وتكبير الخط حتى `130%`.

---

## 9. التحقق من وجود بنية هجينة سابقة

- تم فحص `qa/` ولم يتم العثور على مجلد `qa/hybrid_home/` أو ملفات `host.tsx` / `build.mjs`.
- تم فحص `flutter_app/` (للقراءة فقط): يحتوي على تطبيق Flutter/Dart مع `sqflite` (`local_database.dart`, `accounting_engine.dart`, `erp_controller.dart`) ولا يحتوي بعد على طبقة WebView bridge؛ لذا سيتم إنشاء بنية `src/hybrid/` قياسية ونظيفة وتوثيق عقد التكامل الكامل في `HYBRID_BRIDGE_CONTRACT.md` و`HYBRID_FLUTTER_HANDOFF.md`.
- المشروع الحالي ليس مستودع Git مهيأً (`not a git repository`)؛ لذلك سيتم حصر الإضافات الهجينة في مجلد `src/hybrid/` وملفات البناء/التوثيق المستقلة مع أقل تعديل جراحي ممكن على الملفات القائمة ودون المساس بملفات `flutter_app/` أو ملفات `mobile-runtime.lock.json` المحمية.
