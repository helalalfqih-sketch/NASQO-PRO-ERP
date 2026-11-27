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

const uid = "local-erp-workspace";
test("SQLite importer stores real historical invoice lines and makes them searchable after reload", async ({ page }) => {
  test.setTimeout(70000);
  const headers = { "X-NASQO-CSRF": "1" };
  expect((await page.request.post(`/api/db/workspace/${uid}/reset`,{headers,data:{confirmation:"RESET:local-erp-workspace"}})).status()).toBe(200);
  const review = await (await page.request.post(`/api/db/workspace/${uid}/restore/prepare`, {headers,data:{}})).json();
  const result = await page.request.post(`/api/db/workspace/${uid}/import/sqlite-legacy`,{
    headers,
    data: { base64: (await sampleSqlite()).toString("base64"),
      fileName:"legacy-ui-test.sqlite", mode:"import", replaceExisting:true, restoreToken:review.token },
  });
  expect(result.status()).toBe(200);
  const payload=await result.json();
  expect(payload.result).toBeTruthy();
  const rows=await(await page.request.get(`/api/db/workspace/${uid}/invoices?q=BAR-9988`)).json();
  expect(rows.total).toBeGreaterThanOrEqual(1);
  const detail=await page.request.get(`/api/db/workspace/${uid}/invoices/${rows.invoices[0].id}`);
  expect(detail.status()).toBe(200);
  const invoice=await detail.json();
  expect(JSON.stringify(invoice)).toContain("فلتر محرك مميز");
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
  await page.reload();
  const stats=await(await page.request.get("/api/db/status")).json();
  expect(stats.accountsCount).toBe(1);
  expect(stats.invoiceLinesCount).toBe(1);
});

test("SQLite records persist when legacy localStorage data quota is exhausted", async ({ page }) => {
  test.setTimeout(60000);
  const headers={"X-NASQO-CSRF":"1"};
  expect((await page.request.post(`/api/db/workspace/${uid}/reset`,{headers,data:{confirmation:"RESET:local-erp-workspace"}})).status()).toBe(200);
  await page.addInitScript(() => {
    const save=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==="nasqo-local-workspace-v1") throw new DOMException("Storage quota exceeded","QuotaExceededError");
      return save.call(this,key,value);
    };
    localStorage.setItem("nasqo-local-session-active","1");
  });
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
  const review = await (await page.request.post(`/api/db/workspace/${uid}/restore/prepare`, {headers,data:{}})).json();
  const result=await page.request.post(`/api/db/workspace/${uid}/import/sqlite-legacy`,{
    headers,data:{base64:(await sampleSqlite()).toString("base64"),fileName:"quota-test.sqlite",mode:"import",replaceExisting:true,restoreToken:review.token},
  });
  expect(result.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
  const data=await(await page.request.get(`/api/db/workspace/${uid}`)).json();
  expect(data.accounts.some((a:{name:string})=>a.name==="عميل اختبار نسق")).toBe(true);
  expect(data.inventory.some((i:{name:string})=>i.name==="فلتر محرك مميز")).toBe(true);
});
