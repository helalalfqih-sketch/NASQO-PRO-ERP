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
const evidence = path.resolve(process.env.NASQO_ACCEPTANCE_OUT || path.join(root, "deliverables/free-invoice-lines", baseline ? "baseline" : "browser"));
fs.mkdirSync(evidence, { recursive: true });
const snapshot = createHybridHomeFixtureSnapshot();
snapshot.workspace!.companyName = "اختبار اصطناعي — ملف الأصناف والفاتورة";
snapshot.workspace!.whatsappPhone = "";
snapshot.accounts.forEach((account, index) => { account.name = `حساب اصطناعي ${index + 1}`; account.phone = ""; });
snapshot.ledger = [];
snapshot.inventory = [
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
    "getProductPriceStats", "getInventoryMovementsReport", "openStockReconciliation", "getInvoiceDetail", "beginDocumentExport", "appendDocumentExport", "finishDocumentExport"]);
  win.NasqoHome = { postMessage(raw: string) {
    const request = JSON.parse(raw);
    win.__catalogCommands.push({ action: request.action, payload: request.action === "appendDocumentExport" ? { ...request.payload, base64: "[PDF bytes omitted]" } : request.payload, idempotencyKey: request.idempotencyKey });
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
    if (request.action === "beginDocumentExport") { win.__freePdfChunks = []; data = { exportId: "synthetic-export" }; }
    if (request.action === "appendDocumentExport") {
      win.__freePdfChunks.push(request.payload.base64);
      data = { received: request.payload.offset + atob(request.payload.base64).length };
    }
    if (request.action === "finishDocumentExport") { win.__freePdfFinished = true; data = { completed: true, mode: "save" }; }
    if (request.action === "getInvoiceDetail") {
      const entry = state.ledger.find((e: any) => e.id === request.payload.entryId);
      data = { entry, lines: (entry as any)?.lines ?? [] };
    }
    // A single explicit test may acknowledge a new synthetic document. No real
    // database, journal or inventory quantity is changed by this host.
    if (request.action === "createLedgerEntry" && win.__allowOneSyntheticReceipt === true) {
      win.__allowOneSyntheticReceipt = false;
      const entry = { ...request.payload.payload, lineCount: request.payload.payload.lines.length, ownerId: state.workspaceId, createdAtMs: Date.now() };
      state.ledger = [...state.ledger, entry];
      data = { entry, snapshot: state };
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
const browser = await chromium.launch({ headless: true });
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

const openFree = async () => { await openInvoice(); await page.getByLabel("حرة", { exact: true }).check(); };
const fillFree = async () => {
  await page.getByLabel("اسم البند الحر 1", { exact: true }).fill("خدمة اصطناعية أ");
  await page.getByLabel("كمية البند الحر 1", { exact: true }).fill("١٫٥");
  await page.getByLabel("سعر البند الحر 1", { exact: true }).fill("١٠");
  await page.getByRole("button", { name: "+ بند حر", exact: true }).click();
  await page.getByLabel("اسم البند الحر 2", { exact: true }).fill("بند اصطناعي ب");
  await page.getByLabel("كمية البند الحر 2", { exact: true }).fill("2");
  await page.getByLabel("سعر البند الحر 2", { exact: true }).fill("2.25");
  await expect(page.getByTestId("invoice-free-total")).toHaveText("19.5 ريال");
};
try {
  await run("manual-lines-total-and-mode-switch-preserve-independent-rows", async () => {
    await openFree(); await fillFree();
    await page.getByLabel("أصناف", { exact: true }).check();
    await expect(page.getByTestId("invoice-item-search")).toBeVisible();
    await page.getByLabel("حرة", { exact: true }).check();
    await expect(page.getByLabel("اسم البند الحر 1", { exact: true })).toHaveValue("خدمة اصطناعية أ");
    await expect(page.getByTestId("invoice-free-total")).toHaveText("19.5 ريال");
    await page.getByTestId("invoice-free-lines").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, "free-lines-total.png") });
    await page.getByLabel("حذف البند الحر 2", { exact: true }).click();
    await expect(page.getByTestId("invoice-free-total")).toHaveText("15 ريال");
  });
  await run("free-draft-persists-across-reload-without-posting", async () => {
    await openFree(); await fillFree();
    await page.getByTestId("invoice-modal").getByRole("button", { name: "إلغاء", exact: true }).click();
    await page.getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
    await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("اسم البند الحر 2", { exact: true })).toHaveValue("بند اصطناعي ب");
    await expect(page.getByTestId("invoice-free-total")).toHaveText("19.5 ريال");
  });
  await run("free-save-sends-descriptions-with-no-stock-identities", async () => {
    await openFree(); await fillFree();
    await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
    await page.getByTestId("invoice-save-btn").click();
    await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
    const post = (await commands()).find((c) => c.action === "createLedgerEntry")!;
    const doc = post.payload.payload;
    assert.equal(doc.invoiceContent, "free"); assert.equal(doc.amount, 19.5);
    assert.equal(doc.warehouseId, ""); assert.equal(doc.lines.length, 2);
    assert(doc.lines.every((l: any) => !l.inventoryItemId && !l.warehouseId));
    assert.equal(doc.lines[0].quantity, 1.5); assert.equal(doc.lines[1].total, 4.5);
  }, true);
  await run("saved-free-lines-appear-in-print-preview", async () => {
    await openFree(); await fillFree();
    await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
    await page.getByRole("button", { name: "حفظ وطباعة الفاتورة", exact: true }).click();
    await expect(page.getByTestId("cash-invoice-document")).toContainText("خدمة اصطناعية أ");
    await expect(page.getByTestId("cash-invoice-document")).toContainText("بند اصطناعي ب");
    await page.screenshot({ path: path.join(evidence, "free-lines-print-preview.png") });
    await page.getByTestId("cash-invoice-download-pdf").click();
    await expect.poll(() => page.evaluate(() => (window as any).__freePdfFinished === true)).toBe(true);
    const chunks = await page.evaluate(() => (window as any).__freePdfChunks as string[]);
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    fs.writeFileSync(path.join(evidence, "synthetic-free-invoice.pdf"), bytes);
  }, true);
  await run("incomplete-or-invalid-free-line-blocks-save-without-dropping-row", async () => {
    await openFree(); await fillFree();
    await page.getByLabel("سعر البند الحر 2", { exact: true }).fill("bad");
    await page.getByTestId("invoice-save-btn").click();
    await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect(page.getByTestId("invoice-free-lines").getByRole("alert")).toContainText("أكمل");
    await page.getByLabel("سعر البند الحر 2", { exact: true }).fill("2.25");
    await page.getByLabel("اسم البند الحر 2", { exact: true }).fill("");
    await page.getByTestId("invoice-save-btn").click();
    await expect(page.getByTestId("invoice-free-lines").getByRole("alert")).toContainText("أكمل");
  });
  await run("amount-only-remains-available-and-retains-unsent-lines", async () => {
    await openFree(); await fillFree();
    await page.getByRole("button", { name: "مبلغ فقط", exact: true }).click();
    await page.getByTestId("invoice-free-amount").fill("25");
    await page.getByRole("button", { name: "إدخال بنود", exact: true }).click();
    await expect(page.getByTestId("invoice-free-total")).toHaveText("19.5 ريال");
    await page.getByRole("button", { name: "مبلغ فقط", exact: true }).click();
    await page.evaluate(() => { (window as any).__allowOneSyntheticReceipt = true; });
    await page.getByTestId("invoice-save-btn").click();
    await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
    const doc = (await commands()).find((c) => c.action === "createLedgerEntry")!.payload.payload;
    assert.equal(doc.amount, 25); assert.deepEqual(doc.lines, []);
  }, true);
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
