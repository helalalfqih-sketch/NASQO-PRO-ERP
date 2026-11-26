/** Full built React UI with an in-memory synthetic host only: no Android, SQLite or production data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createHybridHomeFixtureSnapshot } from "../src/hybrid/homeFixture";
import { isFinancialMutationCommand, type HybridCommandAction } from "../src/hybrid/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(process.env.NASQO_HYBRID_BUNDLE || path.join(root, "dist/hybrid"));
const baseline = process.env.NASQO_EXPECT_BASELINE === "1";
const evidence = path.resolve(process.env.NASQO_ACCEPTANCE_OUT || path.join(root, "deliverables/invoice-catalog-fix", baseline ? "baseline" : "browser"));
fs.mkdirSync(evidence, { recursive: true });
const snapshot = createHybridHomeFixtureSnapshot();
snapshot.workspace!.companyName = "اختبار اصطناعي — ملف الأصناف والفاتورة";
snapshot.workspace!.whatsappPhone = "";
snapshot.accounts.forEach((account, index) => { account.name = `حساب اصطناعي ${index + 1}`; account.phone = ""; });
snapshot.ledger = [];
snapshot.inventory = [
  {id:"synthetic-catalog-only",ownerId:snapshot.workspaceId,name:"بطاقة جديدة اصطناعية",unit:"حبة",warehouseId:"",quantity:0,avgCost:0,catalogOnly:true},
  { id: "synthetic-imported", ownerId: snapshot.workspaceId, name: "صنف مستورد اصطناعي", sku: "TEST-IMPORTED",
    warehouseId: "wh_main", unit: "حبة", quantity: 0, avgCost: 10, sellingPrice: 15, quantityUnverified: true,
    legacySourceItemId: "synthetic-legacy-item", legacyHistoricalQtyByWarehouse: { wh_main: 7 } },
  { id: "synthetic-other-warehouse", ownerId: snapshot.workspaceId, name: "صنف مخزن آخر اصطناعي", sku: "TEST-OTHER",
    warehouseId: "wh_branch", unit: "حبة", quantity: 3, avgCost: 10, sellingPrice: 15 },
  { id: "synthetic-approved", ownerId: snapshot.workspaceId, name: "صنف معتمد اصطناعي", sku: "TEST-APPROVED",
    warehouseId: "wh_main", unit: "حبة", quantity: 5, avgCost: 10, sellingPrice: 15 },
  { id: "synthetic-family-source", ownerId: snapshot.workspaceId, name: "صنف عائلة مستوردة اصطناعية", sku: "TEST-FAMILY",
    warehouseId: "wh_branch", unit: "حبة", quantity: 0, avgCost: 10, sellingPrice: 15, quantityUnverified: true,
    legacyHistoricalQtyByWarehouse: { wh_main: 12 } },
  { id: "legacy-location-synthetic-family", ownerId: snapshot.workspaceId, name: "صنف عائلة مستوردة اصطناعية", sku: "TEST-FAMILY",
    warehouseId: "wh_main", unit: "حبة", quantity: 12, avgCost: 10, sellingPrice: 15, quantityUnverified: false,
    legacySourceItemId: "synthetic-family-source" },
];
snapshot.capabilities = { ...snapshot.capabilities!, readOnlyFinancial: true, localDocumentPosting: true,
  localStockPosting: true, localCatalogEditing: true };

function installHost(state: typeof snapshot) {
  const win = window as any;
  win.__catalogCommands = [];
  win.__catalogState = state;
  win.__catalogEmit = (event: string, payload: unknown) => win.__nasqoHybridReceive?.({
    protocolVersion: "1.0.0", kind: "event", event, payload, timestampMs: Date.now(),
  });
  const allowed = new Set(["getSnapshot", "navigate", "goBack", "openInvoice", "showMessage", "saveUiPreferences", "changeCurrency",
    "getProductPriceStats", "getInventoryMovementsReport", "openStockReconciliation"]);
  win.NasqoHome = { postMessage(raw: string) {
    const request = JSON.parse(raw);
    win.__catalogCommands.push({ action: request.action, payload: request.payload, idempotencyKey: request.idempotencyKey });
    let data: unknown = { ok: true };
    let ok = allowed.has(request.action);
    if (request.action === "getSnapshot") data = state;
    if (request.action === "getProductPriceStats") data = { minPrice: 10, maxPrice: 10, lastPrice: 10 };
    if (request.action === "openStockReconciliation") data = { changed: false };
    if (request.action === "getInventoryMovementsReport") data = {
      warehouses: state.warehouses, warehouseStocks: [], itemRows: [], movements: [],
      totals: { totalSales: 0, totalPurchases: 0, totalProfit: 0, totalRemainingValue: 0, activeItemsCount: 0, profitBasis: "avg" },
      anomalies: { unverifiedItemsCount: 1, negativeItemsCount: 0, missingPricesCount: 0 },
    };
    // A single explicit test may acknowledge a new synthetic document. No real
    // database, journal or inventory quantity is changed by this host.
    if (request.action === "createLedgerEntry" && win.__allowOneSyntheticReceipt === true) {
      win.__allowOneSyntheticReceipt = false;
      const entry = { ...request.payload.payload, ownerId: state.workspaceId, createdAtMs: Date.now() };
      data = { entry, snapshot: { ...state, ledger: [...state.ledger, entry] } };
      ok = true;
    }
    setTimeout(() => win.__nasqoHybridReceive?.({ protocolVersion: "1.0.0", kind: "response",
      requestId: request.requestId, action: request.action, ok,
      ...(ok ? { data } : { error: { code: "UNAUTHORIZED_ACTION", message: "Synthetic host rejects mutations" } }),
      timestampMs: Date.now(),
    }), 0);
  } };
}

const fixture = `(${installHost.toString()})(${JSON.stringify(snapshot).replace(/</g, "\\u003c")});`;
const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/__synthetic_catalog_host.js") {
    response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    response.end(fixture); return;
  }
  const file = path.resolve(bundle, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${bundle}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (file.endsWith("index.html")) response.end(fs.readFileSync(file, "utf8").replace("<head>", '<head><script src="/__synthetic_catalog_host.js"></script>'));
  else fs.createReadStream(file).pipe(response);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await context.newPage();
const browserErrors: string[] = [], externalRequests: string[] = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("request", (request) => { if (!request.url().startsWith(url) && /^https?:/.test(request.url())) externalRequests.push(request.url()); });
const results: { name: string; passed: boolean; error?: string }[] = [];
let sequence = 0;
const commands = () => page.evaluate(() => (window as any).__catalogCommands as { action: string; payload: any; idempotencyKey?: string }[]);
const emit = (event: string, payload: unknown) => page.evaluate(({ event, payload }) => (window as any).__catalogEmit(event, payload), { event, payload });
const back = async () => { await emit("backPressed", { requestId: `catalog-back-${++sequence}` }); await page.waitForTimeout(240); };
const fresh = async () => {
  await page.goto(url); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.reload();
  await expect(page.getByTestId("dashboard-screen")).toBeVisible();
};
const openInvoice = async () => {
  await emit("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } });
  await expect(page.getByTestId("supplier-screen")).toBeVisible();
  await page.locator(".footer-menu").click();
  await page.getByRole("menuitem", { name: "فاتورة جديدة", exact: true }).click();
  await expect(page.getByTestId("invoice-modal")).toBeVisible();
};
const selectItem = async (name: string) => {
  await page.getByTestId("invoice-item-search").fill(name);
  await page.getByRole("option").filter({ hasText: name }).click();
};
const noSideEffects = async (allowReceipt = false) => {
  const requests = await commands();
  const mutations = requests.filter((request) => isFinancialMutationCommand(request.action as HybridCommandAction) || request.action === "saveErpData");
  assert.equal(mutations.length, allowReceipt ? 1 : 0, "Unexpected financial/catalog write");
  if (allowReceipt) assert.equal(mutations[0].action, "createLedgerEntry");
  assert.deepEqual(requests.filter((request) => request.action === "openStockReconciliation"), [], "Invoice/catalog navigation must not open stock approval");
  assert.deepEqual(await page.evaluate(() => (window as any).__catalogState.inventory), snapshot.inventory, "No fixture stock quantities or approval flags may change");
};
const run = async (name: string, action: () => Promise<void>, allowReceipt = false) => {
  try {
    await fresh(); await action(); if (!baseline) await noSideEffects(allowReceipt);
    fs.writeFileSync(path.join(evidence, `${name}-commands.json`), JSON.stringify(await commands(), null, 2));
    results.push({ name, passed: true }); console.log(`PASS ${name}`);
  }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); await page.screenshot({ path: path.join(evidence, `${name}-failure.png`) }); }
};

try {
  if (baseline) {
    await run("baseline-release-imported-item-incorrectly-opens-native-reconciliation", async () => {
      await openInvoice(); await selectItem("صنف مستورد اصطناعي");
      await expect.poll(async () => (await commands()).filter((command) => command.action === "openStockReconciliation").length).toBe(1);
      await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("");
      await page.screenshot({ path: path.join(evidence, "release-item-selection-diverts.png") });
      fs.writeFileSync(path.join(evidence, "commands.json"), JSON.stringify(await commands(), null, 2));
      console.log("REPRODUCED: released 1.0.121 requests native reconciliation and leaves invoice line empty; no Android UI was opened by this synthetic host.");
    });
  } else {
    await run("unverified-imported-item-stays-in-invoice-without-native-navigation", async () => {
      await openInvoice(); await selectItem("صنف مستورد اصطناعي");
      await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف مستورد اصطناعي");
      await expect(page.getByTestId("invoice-line-stock-status")).toContainText(/غير معتمد/);
      await expect(page.getByTestId("invoice-modal")).toBeVisible();
      await page.screenshot({ path: path.join(evidence, "imported-item-selected-in-invoice.png") });
    });
    await run("unverified-item-save-is-blocked-inline-with-zero-posting", async () => {
      await openInvoice(); await selectItem("صنف مستورد اصطناعي");
      await page.getByTestId("invoice-save-btn").click();
      await expect(page.getByTestId("invoice-validation-error")).toContainText(/غير معتمد|اعتمد/);
      await expect(page.getByTestId("invoice-modal")).toBeVisible();
      await page.getByTestId("invoice-validation-error").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, "unverified-save-inline-error.png") });
    });
    await run("unverified-item-local-draft-restores-without-approval-or-posting", async () => {
      await openInvoice(); await selectItem("صنف مستورد اصطناعي");
      await page.getByTestId("invoice-modal").getByRole("button", { name: "إلغاء", exact: true }).click();
      await expect(page.getByTestId("invoice-unsaved-dialog")).toBeVisible();
      await page.getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
      await noSideEffects(); await page.reload();
      await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف مستورد اصطناعي");
      await page.screenshot({ path: path.join(evidence, "imported-item-draft-restored.png") });
    });
    await run("other-warehouse-item-is-selectable-but-save-validates-inside-invoice", async () => {
      await openInvoice(); await selectItem("صنف مخزن آخر اصطناعي");
      await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف مخزن آخر اصطناعي");
      await page.getByTestId("invoice-save-btn").click();
      await expect(page.getByTestId("invoice-validation-error")).toContainText(/مخزن|المخزن/);
      await expect(page.getByTestId("invoice-modal")).toBeVisible();
    });
    await run("dashboard-catalog-and-movement-destinations-are-distinct", async () => {
      await expect(page.getByTestId("open-items-btn")).toContainText("ملف الأصناف");
      await page.getByTestId("open-items-btn").click();
      await expect(page.getByTestId("items-catalog-screen")).toBeVisible();
      await expect(page.getByTestId("inventory-report-screen")).toHaveCount(0);
      await page.screenshot({ path: path.join(evidence, "item-master-catalog.png") });
      await back();
      await page.getByTestId("open-stock-movement-btn").click();
      await expect(page.getByTestId("inventory-report-screen")).toBeVisible();
      await expect(page.getByTestId("items-catalog-screen")).toHaveCount(0);
      await page.screenshot({ path: path.join(evidence, "stock-movement-report.png") });
    });
    await run("drawer-catalog-and-movement-destinations-are-distinct", async () => {
      await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
      await page.getByRole("complementary", { name: "قائمة نسقو" }).getByRole("button", { name: "ملف الأصناف", exact: true }).click();
      await expect(page.getByTestId("items-catalog-screen")).toBeVisible();
      await back();
      await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
      await page.getByRole("complementary", { name: "قائمة نسقو" }).getByRole("button", { name: "حركة المخزون", exact: true }).click();
      await expect(page.getByTestId("inventory-report-screen")).toBeVisible();
      await expect(page.getByTestId("items-catalog-screen")).toHaveCount(0);
    });
    await run("new-catalog-card-reaches-first-purchase-with-selected-warehouse", async () => {
      await openInvoice(); await selectItem("بطاقة جديدة اصطناعية");
      await page.getByLabel("سعر السطر 1",{exact:true}).fill("5");
      await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
      await page.getByTestId("invoice-save-btn").click();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
      const posts=(await commands()).filter(command=>command.action==="createLedgerEntry");
      assert.equal(posts.length,1);assert.equal(posts[0].payload.payload.warehouseId,"wh_main");
      assert.equal(posts[0].payload.payload.lines[0].inventoryItemId,"synthetic-catalog-only");
    },true);
    await run("approved-item-explicit-save-sends-one-synthetic-document", async () => {
      await openInvoice(); await selectItem("صنف معتمد اصطناعي");
      await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
      await page.getByTestId("invoice-save-btn").click();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
      const posts = (await commands()).filter((command) => command.action === "createLedgerEntry");
      assert.equal(posts.length, 1); assert(posts[0].idempotencyKey);
      assert.equal(posts[0].payload.payload.lines[0].inventoryItemId, "synthetic-approved");
    }, true);
    await run("multiwarehouse-source-family-selects-existing-approved-warehouse-id", async () => {
      await openInvoice();
      await page.getByTestId("invoice-item-search").fill("synthetic-family-source");
      await expect(page.getByRole("listbox", { name: "نتائج الأصناف" }).getByRole("option")).toHaveCount(1);
      await page.getByRole("listbox", { name: "نتائج الأصناف" }).getByRole("option").click();
      await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف عائلة مستوردة اصطناعية");
      await expect.poll(() => page.evaluate(() => {
        const saved = Object.values(localStorage).map((raw) => { try { return JSON.parse(raw); } catch { return null; } })
          .find((value) => value?.slot === "invoice-draft");
        return saved?.value?.fields?.rows?.[0]?.inventoryItemId;
      })).toBe("legacy-location-synthetic-family");
      await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
      await page.getByTestId("invoice-save-btn").click();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
      const posts = (await commands()).filter((command) => command.action === "createLedgerEntry");
      assert.equal(posts.length, 1);
      assert.equal(posts[0].payload.payload.lines[0].inventoryItemId, "legacy-location-synthetic-family");
    }, true);
  }
} finally {
  const manifest = path.join(bundle, "hybrid-manifest.json");
  const result = { environment: "Chromium full built hybrid UI; synthetic host, NOT Android or accounting engine", baseline,
    bundle, manifestSha256: fs.existsSync(manifest) ? crypto.createHash("sha256").update(fs.readFileSync(manifest)).digest("hex") : null,
    results, browserErrors, externalRequests };
  fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify(result, null, 2));
  await context.close(); await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve()));
  if (results.some((result) => !result.passed) || browserErrors.length || externalRequests.length) process.exitCode = 1;
  console.log(JSON.stringify(result, null, 2));
}
