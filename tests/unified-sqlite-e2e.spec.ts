import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);

test.use({ channel: "chrome" });

async function sampleSqlite() {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE boxes (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, type INTEGER, phone TEXT, lim REAL);
    CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT, details TEXT, state INTEGER);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, unit TEXT, price REAL, price2 REAL);
    CREATE TABLE currencies (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE input_move (id INTEGER PRIMARY KEY, bill TEXT, per_id INTEGER, bill_type INTEGER, bstate INTEGER, year INTEGER, month INTEGER, day INTEGER, dain REAL, madin REAL, cur INTEGER, details TEXT);
    CREATE TABLE bill_details (id INTEGER PRIMARY KEY, bill_id INTEGER, prod_id INTEGER, store_id INTEGER, unit TEXT, amount REAL, price REAL, discount REAL, total REAL);
    CREATE TABLE bill_details2 (id INTEGER PRIMARY KEY, bill_id INTEGER, details TEXT, total REAL);
    INSERT INTO boxes VALUES (1, 'العملاء');
    INSERT INTO customers VALUES (10, 'عميل اختبار نسق', 1, '777123456', 0);
    INSERT INTO stores VALUES (3, 'مخزن اختبار نسق', '', 1);
    INSERT INTO products VALUES (20, 'فلتر محرك مميز', 'BAR-9988', 'حبة', 150, 100);
    INSERT INTO currencies VALUES (1, 'ريال');
    INSERT INTO input_move VALUES (30, 'INV-9000', 10, 2, 1, 2026, 11, 15, 300, 0, 1, 'اختبار فاتورة تاريخية');
    INSERT INTO bill_details VALUES (40, 30, 20, 3, 'حبة', 2, 150, 0, 300);
  `);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

test("unified single SQLite backend persists data, imports SQLite, opens invoice lines, exports .sqlite, and uses zero IndexedDB/Firestore", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const firestoreRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("firestore.googleapis.com")) {
      firestoreRequests.push(req.url());
    }
  });

  // The shared browser test database must start empty even if another spec
  // just created test records. This is test-only, never production data.
  const reset = await page.request.post("/api/db/workspace/local-erp-workspace/reset", {
    headers: { "X-NASQO-CSRF": "1" },
    data: { confirmation: "RESET:local-erp-workspace" },
  });
  expect(reset.status()).toBe(200);
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });
  // Empty initial workspace: no hardcoded accounts/groups until user restores backup
  await expect(page.getByTestId("empty-workspace-banner")).toBeVisible({ timeout: 10_000 });

  // Open Options ("خيارات") dropdown menu and verify alternating backup / restore actions
  await page.getByTestId("header-options-btn").click();
  await expect(page.getByTestId("options-menu")).toBeVisible();
  await expect(page.getByTestId("options-backup-btn")).toHaveText("نسخ إحتياطي");
  await expect(page.getByTestId("options-restore-backup-btn")).toHaveText("إستعادة نسخة");
  await page.getByLabel("إغلاق الخيارات").click();

  const dbs = await page.evaluate(async () => {
    if (!("databases" in indexedDB)) return [];
    const list = await indexedDB.databases();
    return list.map((d) => d.name);
  });
  expect(dbs).not.toContain("nasqo_pro_erp_db");
  expect(dbs).not.toContain("nasqo_legacy_center");
  expect(dbs).not.toContain("nasqo_legacy_archive");

  // Upload SQLite backup via Options -> Restore Backup directly and confirm dashboard hydrates dynamically
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    (async () => {
      await page.getByTestId("header-options-btn").click();
      await page.getByTestId("options-restore-backup-btn").click();
    })(),
  ]);
  await fileChooser.setFiles({
    name: "erp-backup-test.back",
    mimeType: "application/octet-stream",
    buffer: await sampleSqlite(),
  });
  await expect(page.getByTestId("empty-workspace-banner")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("account-groups-table").getByText("العملاء")).toBeVisible({ timeout: 10_000 });

  // Also check Settings -> SQLite table browser works over the restored DB
  await page.getByLabel("الإعدادات", { exact: true }).click();
  await expect(page.getByTestId("settings-full-sqlite-import-btn")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("settings-full-sqlite-import-btn").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /مستعرض جداول SQLite/ }).click();
  await expect(dialog.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "✕" }).click();
  await page.getByLabel("رجوع", { exact: true }).click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 10_000 });

  // Verify native customer statement has NO redundant secondary archive table and opens real invoice lines directly
  await page.getByRole("button", { name: "كشف حساب", exact: true }).click();
  await page.getByLabel("البحث عن الحساب").fill("عميل اختبار نسق");
  await page.getByRole("option", { name: "عميل اختبار نسق" }).first().click();
  await page.getByRole("button", { name: "موافق", exact: true }).click();
  await expect(page.getByTestId("supplier-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("customer-legacy-archive-section")).toHaveCount(0);
  await page.getByRole("button", { name: /ملف PDF للعملية/ }).first().click();
  await expect(page.getByTestId("cash-invoice-document")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("cash-invoice-document").getByText("فلتر محرك مميز")).toBeVisible();
  await expect(page.getByTestId("cash-invoice-tafqeet")).toContainText("ريال فقط لا غير");
  await page.getByLabel("رجوع", { exact: true }).click();
  await page.getByLabel("رجوع", { exact: true }).click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 10_000 });

  // Create a native multi-line invoice via InvoiceModal and verify Tafqeet preview + SQLite persistence
  await page.getByRole("button", { name: "فاتورة جديدة", exact: true }).click();
  const invModal = page.getByTestId("invoice-modal");
  await expect(invModal).toBeVisible();
  await invModal.getByTestId("invoice-item-search").fill("BAR-9988");
  await invModal.getByRole("listbox", { name: "نتائج الأصناف" }).getByRole("option").first().click();
  await invModal.getByTestId("invoice-save-btn").click();
  await expect(invModal).toHaveCount(0);

  // Open Chart of Accounts ("الحسابات"), locate test customer, jump to statement, edit newly created invoice lines, verify NO duplicate row
  await page.getByRole("button", { name: "الحسابات", exact: true }).click();
  const coaModal = page.getByTestId("chart-of-accounts-modal");
  await expect(coaModal).toBeVisible();
  await coaModal.getByTestId("coa-search-input").fill("عميل اختبار نسق");
  await coaModal.getByRole("button", { name: "كشف", exact: true }).first().click();
  await expect(page.getByTestId("supplier-screen")).toBeVisible({ timeout: 10_000 });
  const preEditCount = await page.locator(".transaction-card").count();
  expect(preEditCount).toBeGreaterThanOrEqual(2);
  await page.locator(".transaction-actions button[aria-label^='تعديل #']").first().click();
  const editInvModal = page.getByTestId("invoice-modal");
  await expect(editInvModal).toBeVisible();
  await expect(editInvModal.locator("#invoice-title")).toContainText("تعديل");
  await expect(editInvModal.getByLabel("اسم الصنف").first()).toHaveValue("فلتر محرك مميز");
  await editInvModal.getByLabel("كمية الصنف").first().fill("3");
  await editInvModal.getByTestId("invoice-save-btn").click();
  await expect(editInvModal).toHaveCount(0);
  await expect(page.locator(".transaction-card")).toHaveCount(preEditCount);
  await page.getByLabel("رجوع", { exact: true }).click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 10_000 });

  // Check inventory item is persisted across reload and verify stocktake saves cleanly to SQLite
  await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("open-erp-hub-btn").click();
  await expect(page.getByTestId("erp-hub-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("local-db-section")).toContainText("SQLite");

  const [sqliteDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("local-db-sqlite-download-btn").click(),
  ]);
  expect(sqliteDownload.suggestedFilename()).toMatch(/^nasqo-unified-.*\.sqlite$/);

  await page.getByLabel("رجوع", { exact: true }).click();
  await page.getByLabel("فتح القائمة", { exact: true }).click();
  await page.getByLabel("قائمة نسقو", { exact: true }).getByRole("button", { name: "الأصناف والمخزون", exact: true }).click();
  await expect(page.getByTestId("inventory-report-screen")).toBeVisible();
  await page.getByLabel("البحث في الأصناف").fill("BAR-9988");
  await expect(page.getByText("فلتر محرك مميز")).toBeVisible();
  await expect(page.getByText("بحاجة إلى تسوية").first()).toBeVisible();
  await page.getByRole("button", { name: "حركة صنف فلتر محرك مميز" }).click();
  const moveModal = page.getByTestId("item-movements-modal");
  await expect(moveModal).toBeVisible();
  await expect(moveModal.getByText("عميل اختبار نسق").first()).toBeVisible();
  await moveModal.locator("section[role='dialog']").getByRole("button", { name: "إغلاق", exact: true }).last().click();
  await page.getByLabel("تحديد فلتر محرك مميز").check();
  await page.getByLabel("نوع تعديل الكمية").selectOption("set");
  await page.getByLabel("قيمة تعديل الكمية").fill("7");
  await page.getByLabel("سعر البيع المعتمد").fill("200");
  await page.getByLabel("تأكيد جرد المخزون الفعلي").check();
  await page.getByLabel("تأكيد اعتماد سعر البيع").check();
  await page.getByTestId("bulk-apply-btn").click();
  await expect(page.getByText("بحاجة إلى تسوية")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });

  // Verify again zero IndexedDB stores & zero Firestore requests throughout entire session
  const postDbs = await page.evaluate(async () => {
    if (!("databases" in indexedDB)) return [];
    const list = await indexedDB.databases();
    return list.map((d) => d.name);
  });
  expect(postDbs).not.toContain("nasqo_pro_erp_db");
  expect(postDbs).not.toContain("nasqo_legacy_center");
  expect(postDbs).not.toContain("nasqo_legacy_archive");
  expect(firestoreRequests).toEqual([]);
});
