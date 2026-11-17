import { expect, test } from "@playwright/test";

const ws = "/api/db/workspace/local-erp-workspace";

test("local SQLite ERP starts empty, reaches dashboard and opens options without cloud initialization", async ({ page }) => {
  test.setTimeout(45000);
  const reset = await page.request.post(ws + "/reset", { headers: { "X-NASQO-CSRF": "1" }, data: { confirmation: "RESET:local-erp-workspace" } });
  expect(reset.status()).toBe(200);
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("startup-storage-error")).toHaveCount(0);
  await expect(page.getByTestId("empty-workspace-banner")).toBeVisible();
  const status = await (await page.request.get("/api/db/status")).json();
  expect(status.accountsCount).toBe(0);
  expect(status.inventoryCount).toBe(0);
  await page.getByTestId("header-options-btn").click();
  await expect(page.getByTestId("options-restore-backup-btn")).toBeVisible();
  await expect(page.getByTestId("options-backup-btn")).toBeVisible();
});

test("an old IndexedDB v1 browser tab cannot block the new server SQLite database", async ({ browser }) => {
  test.setTimeout(45000);
  const ctx = await browser.newContext();
  try {
    const old = await ctx.newPage();
    await old.goto("/");
    await old.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("nasqo_pro_erp_db", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("accounts", {keyPath:"id"});
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      (window as Window & { __staleIdb?: IDBDatabase }).__staleIdb = db;
    });
    const app = await ctx.newPage();
    await app.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
    await app.goto("/?autostart=1");
    await expect(app.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
    await expect(app.getByTestId("startup-storage-error")).toHaveCount(0);
    const access = await (await app.request.get("/api/db/status")).json();
    expect(access.engine).toContain("SQLite");
    await old.evaluate(() => (window as Window & {__staleIdb?: IDBDatabase}).__staleIdb?.close());
  } finally { await ctx.close(); }
});

test("old IndexedDB-only records are never silently seeded into the single SQLite database", async ({ page }) => {
  test.setTimeout(45000);
  const reset = await page.request.post(ws + "/reset", { headers: { "X-NASQO-CSRF": "1" }, data: { confirmation: "RESET:local-erp-workspace" } });
  expect(reset.status()).toBe(200);
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve,reject) => {
      const open=indexedDB.open("nasqo_pro_erp_db",1);
      open.onupgradeneeded=()=>open.result.createObjectStore("accounts",{keyPath:"id"});
      open.onsuccess=()=>{
        const db=open.result;
        const tx=db.transaction("accounts","readwrite");
        tx.objectStore("accounts").put({id:"stale-idb-only",name:"لا تستورد تلقائيًا"});
        tx.oncomplete=()=>{db.close();resolve()};
        tx.onerror=()=>reject(tx.error);
      };
      open.onerror=()=>reject(open.error);
    });
  });
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
  const status=await(await page.request.get("/api/db/status")).json();
  expect(status.accountsCount).toBe(0);
});
