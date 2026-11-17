import { expect, test } from "@playwright/test";

test("local ERP reaches dashboard without waiting for unused ERP modules", async ({ page }) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("startup-storage-error")).toHaveCount(0);
  await page.getByTestId("quick-erp-crm").click();
  await expect(page.getByTestId("erp-crm-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("رجوع", { exact: true }).click();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  await page.getByLabel("إضافة", { exact: true }).click();
  await page.getByTestId("dashboard-add-menu").getByRole("menuitem", { name: "مركز استيراد وترحيل قواعد البيانات" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
});

test("blocked v1 IndexedDB upgrade shows recovery instead of infinite spinner and keeps records", async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  try {
    const holder = await context.newPage();
    await holder.goto("/");
    await holder.evaluate(async () => {
      const opened = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("nasqo_pro_erp_db", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("workspaces", { keyPath: "id" });
          db.createObjectStore("accounts", { keyPath: "id" });
          db.createObjectStore("ledger", { keyPath: "id" });
          db.createObjectStore("warehouses", { keyPath: "id" });
          db.createObjectStore("inventory", { keyPath: "id" });
          db.createObjectStore("erp_modules", { keyPath: "uid" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      (window as Window & { __testHeldDb?: IDBDatabase }).__testHeldDb = opened;
    });

    const app = await context.newPage();
    await app.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
    await app.goto("/?autostart=1");
    await expect(app.getByTestId("startup-storage-error")).toBeVisible({ timeout: 15_000 });
    await expect(app.getByText(/محجوب بواسطة علامة تبويب/)).toBeVisible();
    await expect(app.getByTestId("startup-retry-button")).toBeVisible();
    await expect(app.getByTestId("dashboard-screen")).toHaveCount(0);
    await holder.evaluate(() => {
      (window as Window & { __testHeldDb?: IDBDatabase }).__testHeldDb?.close();
    });
    await app.getByTestId("startup-retry-button").click();
    await expect(app.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByTestId("startup-storage-error")).toHaveCount(0);
    const schemaVersion = await app.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("nasqo_pro_erp_db", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const version = db.version;
      db.close();
      return version;
    });
    expect(schemaVersion).toBe(2);
  } finally {
    await context.close();
  }
});


test("existing v1 accounting records open immediately even while another old tab holds v1", async ({ browser }) => {
  test.setTimeout(35_000);
  const context = await browser.newContext();
  try {
    const oldTab = await context.newPage();
    await oldTab.goto("/");
    await oldTab.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("nasqo_pro_erp_db", 1);
        request.onupgradeneeded = () => {
          const next = request.result;
          for (const name of ["workspaces", "accounts", "ledger", "warehouses", "inventory"])
            next.createObjectStore(name, { keyPath: "id" });
          next.createObjectStore("erp_modules", { keyPath: "uid" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["workspaces", "accounts", "warehouses", "inventory"], "readwrite");
        tx.objectStore("workspaces").put({
          id: "local-erp-workspace", ownerId: "local-erp-workspace", companyName: "بيانات محلية محفوظة",
          defaultCurrency: "ريال", whatsappProvider: "nasqo", whatsappInstantEnabled: false, whatsappPhone: "",
        });
        tx.objectStore("accounts").put({
          id: "acc_legacy_open", ownerId: "local-erp-workspace", name: "حساب موجود من الإصدار القديم",
          category: "clients", sortOrder: 1, codeNumber: 11, currency: "ريال", openingBalance: 0,
          phone: "", creditLimit: 0, isCashAccount: false, accountImage: "1",
          settlement: false, documentNumberRequired: false, messageMethod: "sms", sendMode: "never",
          note: "", openingDirection: "debit",
        });
        tx.objectStore("warehouses").put({ id: "wh_old", ownerId: "local-erp-workspace", name: "مخزن قديم", codeNumber: 1, details: "", isDefault: true });
        tx.objectStore("inventory").put({ id: "item_old", ownerId: "local-erp-workspace", name: "صنف قديم", quantity: 9, avgCost: 1, unit: "حبة", warehouseId: "wh_old" });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      (window as Window & { __heldLegacyDb?: IDBDatabase }).__heldLegacyDb = db;
    });
    const newApp = await context.newPage();
    await newApp.addInitScript(() => localStorage.setItem("nasqo-local-session-active", "1"));
    await newApp.goto("/?autostart=1");
    await expect(newApp.getByTestId("dashboard-screen")).toBeVisible({ timeout: 4_000 });
    await expect(newApp.getByTestId("startup-slow-help")).toHaveCount(0);
    await expect(newApp.getByTestId("startup-storage-error")).toHaveCount(0);
    await oldTab.evaluate(() => (window as Window & { __heldLegacyDb?: IDBDatabase }).__heldLegacyDb?.close());
  } finally {
    await context.close();
  }
});
