/** Private CI regression: process the real 22-table source only in an isolated
 * browser fixture. Source bytes must NEVER be emitted as static/site assets. */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import initSqlJs from "sql.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const privatePath = process.env.NASQO_PRIVATE_E2E_SOURCE;
const sourceSha = "14789d4c093ab51e1cffbffeb6bdaee03bb8513f67753f09bc12753fee3f0ca2";

async function archivedCounts(page: Page) {
  return page.evaluate(async (sha: string) => {
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await open("nasqo_pro_erp_db");
    try {
      const tx = records.transaction(["accounts_v2", "warehouses_v2", "inventory_v2", "ledger_v2"], "readonly");
      const count = (name: string) => new Promise<number>((resolve, reject) => {
        const request = tx.objectStore(name).index("byOwner").getAll(IDBKeyRange.only("local-erp-workspace"));
        request.onsuccess = () => resolve((request.result as { legacyRef?: string }[])
          .filter((row) => row.legacyRef?.startsWith(`${sha.slice(0, 12)}:`)).length);
        request.onerror = () => reject(request.error);
      });
      const [accounts, warehouses, inventory, ledger] = await Promise.all([
        count("accounts_v2"), count("warehouses_v2"), count("inventory_v2"), count("ledger_v2"),
      ]);
      const archive = await open("nasqo_legacy_center");
      try {
        const archived = await new Promise<number>((resolve, reject) => {
          const request = archive.transaction("records", "readonly").objectStore("records")
            .index("byBatch").count(IDBKeyRange.only(`archive:${sha}`));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return { accounts, warehouses, inventory, ledger, archived };
      } finally { archive.close(); }
    } finally { records.close(); }
  }, sourceSha);
}

test("real private source: 26,001 rows, 125 accounts, 1,402 products, 5 stores and multi-line invoices survive reload", async ({ page }) => {
  test.skip(!privatePath, "Run only with an explicitly supplied private SQLite file path");
  test.setTimeout(240_000);
  const original = readFileSync(privatePath!);
  expect(createHash("sha256").update(original).digest("hex")).toBe(sourceSha);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const sql = new SQL.Database(new Uint8Array(original));
  const target = sql.exec("SELECT bill_id, COUNT(*) AS line_count FROM bill_details GROUP BY bill_id HAVING COUNT(*) >= 2 ORDER BY bill_id LIMIT 1");
  expect(target.length).toBe(1);
  const invoiceId = Number(target[0].values[0][0]);
  const pricedLines = Number(target[0].values[0][1]);
  const freeLineResult = sql.exec(`SELECT COUNT(*) FROM bill_details2 WHERE bill_id = ${invoiceId}`);
  const totalLines = pricedLines + Number(freeLineResult[0]?.values[0]?.[0] ?? 0);
  sql.close();

  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("إضافة", { exact: true }).click();
  await page.getByTestId("dashboard-add-menu").getByRole("menuitem", { name: "مركز استيراد وترحيل قواعد البيانات" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#legacy-center-sqlite-input").setInputFiles({
    name: "verified-original.sqlite", mimeType: "application/x-sqlite3", buffer: original,
  });
  await expect(dialog.getByText(/تم فتح قاعدة البيانات بنجاح: 22 جدولًا و 26,001 سجل/)).toBeVisible({ timeout: 30_000 });
  await dialog.getByTestId("legacy-import-and-show").click();
  await expect(dialog.getByText(/تم حفظ الأرشيف وإظهار البيانات/)).toBeVisible({ timeout: 100_000 });
  const initial = await archivedCounts(page);
  expect(initial.accounts).toBe(125);
  expect(initial.warehouses).toBe(5);
  expect(initial.inventory).toBe(1402);
  expect(initial.archived).toBe(26001);

  await dialog.getByRole("button", { name: "✕" }).click();
  await page.getByLabel("إضافة", { exact: true }).click();
  await page.getByTestId("dashboard-add-menu").getByRole("menuitem", { name: "الفواتير التاريخية والمطابقة" }).click();
  const archive = page.getByRole("dialog");
  await archive.getByPlaceholder(/بحث برقم الفاتورة/).fill(String(invoiceId));
  const tableRow = archive.locator("tr").filter({ has: archive.getByText(`#${invoiceId}`, { exact: true }) }).first();
  await tableRow.getByRole("button", { name: "فتح البنود" }).click();
  await expect(archive.getByTestId("legacy-invoice-detail").locator("tbody tr")).toHaveCount(totalLines, { timeout: 20_000 });
  await archive.getByRole("button", { name: "✕" }).click();

  await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });
  expect(await archivedCounts(page)).toEqual(initial);
});
