import { expect, test } from "@playwright/test";
import initSqlJs from "sql.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

test("SQLite one-click import populates live screens, persists and searches source invoice lines", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20000 });
  await page.getByLabel("إضافة", { exact: true }).click();
  await page.getByTestId("dashboard-add-menu").getByRole("menuitem", { name: "مركز استيراد وترحيل قواعد البيانات" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#legacy-center-sqlite-input").setInputFiles({
    name: "legacy-ui-test.sqlite", mimeType: "application/x-sqlite3", buffer: await sampleSqlite(),
  });
  await expect(dialog.getByText(/تم فتح قاعدة البيانات بنجاح/)).toBeVisible();
  await dialog.getByTestId("legacy-import-and-show").click();
  await expect(dialog.getByText(/تم حفظ الأرشيف وإظهار البيانات/)).toBeVisible({ timeout: 45000 });
  await dialog.getByRole("button", { name: "✕" }).click();
  await page.getByLabel("إضافة", { exact: true }).click();
  await page.getByTestId("dashboard-add-menu").getByRole("menuitem", { name: "الفواتير التاريخية والمطابقة" }).click();
  const archive = page.getByRole("dialog");
  await archive.getByPlaceholder(/بحث برقم الفاتورة/).fill("BAR-9988");
  await expect(archive.getByText("عميل اختبار نسق").first()).toBeVisible();
  await archive.getByRole("button", { name: "فتح البنود" }).click();
  await expect(archive.getByTestId("legacy-invoice-detail").getByText("فلتر محرك مميز")).toBeVisible();
  await archive.getByRole("button", { name: "✕" }).click();
  await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20000 });
  await page.getByLabel("فتح القائمة", { exact: true }).click();
  await page.getByLabel("قائمة نسقو", { exact: true }).getByRole("button", { name: "الأصناف والمخزون", exact: true }).click();
  await expect(page.getByTestId("inventory-report-screen")).toBeVisible();
  await page.getByLabel("البحث في الأصناف").fill("BAR-9988");
  await expect(page.getByText("فلتر محرك مميز")).toBeVisible();
  await expect(page.getByText("بحاجة إلى تسوية").first()).toBeVisible();
  await page.getByRole("button", { name: "بحث في فواتير الصنف فلتر محرك مميز" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "فتح البنود" })).toBeVisible();
});
