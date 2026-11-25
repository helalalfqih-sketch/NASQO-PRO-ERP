/** Built hybrid UI with wholly synthetic records. No SQLite, Android or private backup is served. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHybridHomeFixtureSnapshot } from "../src/hybrid/homeFixture";
import { isFinancialMutationCommand, type HybridCommandAction } from "../src/hybrid/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(process.env.NASQO_HYBRID_BUNDLE || path.join(root, "dist/hybrid"));
const evidence = path.resolve(process.env.NASQO_ACCEPTANCE_OUT || path.join(root, "deliverables/backup-fidelity-fix/browser"));
fs.mkdirSync(evidence, { recursive: true });
const snapshot = createHybridHomeFixtureSnapshot();
snapshot.workspace!.companyName = "اختبار اصطناعي لاستعادة السجلات";
snapshot.workspace!.whatsappPhone = "";
snapshot.workspace!.legacySourceSha = "a".repeat(64);
snapshot.accounts = snapshot.accounts.slice(0, 1).map(a => ({ ...a, name: "حساب اختبار اصطناعي", phone: "", openingBalance: 0 }));
snapshot.currencies = snapshot.currencies.slice(0, 1);
snapshot.inventory = Array.from({ length: 41 }, (_, i) => ({
  id: `synthetic-item-${String(i + 1).padStart(4, "0")}`, ownerId: snapshot.workspaceId,
  name: `صنف اصطناعي ${String(i + 1).padStart(4, "0")}`, sku: `TEST-${String(i + 1).padStart(4, "0")}`,
  warehouseId: "wh_main", unit: "حبة", quantity: i === 40 ? 3 : 0,
  avgCost: i === 40 ? 22 : 0, legacyCatalogCost: i === 40 ? undefined : 10,
  sellingPrice: 50, quantityUnverified: i !== 40, currencyCode: "ريال", legacyId: i + 1,
  computedQuantity: 5, legacyHistoricalQtyByWarehouse: { wh_main: 5 },
}));
const longNote = `بداية ملاحظة اصطناعية ${"تفاصيل محفوظة بلا قص ".repeat(125)} نهاية الملاحظة بعد ستمائة حرف`;
snapshot.ledger = [{ ...snapshot.ledger[0], id: "synthetic-invoice-1001", accountId: "acc_sup_1",
  accountName: "حساب اختبار اصطناعي", entryNumber: 1001, amount: 100, rawDain: 0, rawMadin: 100,
  details: longNote, sourceReference: "TEST-REFERENCE-861", headerDiscount: 7,
  sourceOrigin: "legacy_sqlite", postingStatus: "posted", importedRegister: true, docType: 3,
  entryDate: "2026-11-25", createdAtMs: 1795564800000, lineCount: 1 }];
snapshot.capabilities = { ...snapshot.capabilities!, readOnlyFinancial: true, localDocumentPosting: true,
  localStockPosting: true, localCatalogEditing: true };
const invoiceLines = [{ id: 1, itemName: "صنف اصطناعي 0001", inventoryItemId: "synthetic-item-0001",
  warehouseId: "wh_main", warehouseName: "مخزن اصطناعي", sku: "TEST-0001", lineKind: "item",
  unit: "حبة", quantity: 2, price: 50, total: 100, discount: 3, bonus: 1,
  expiryDate: "2027-12-31", details: "بيان سطر اصطناعي محفوظ" }];

function installHost(state: typeof snapshot, lines: typeof invoiceLines) {
  const win = window as any;
  win.__fidelityCommands = [];
  win.__fidelityState = state;
  win.__delayNextMovement = false;
  win.__failNextMovement = false;
  win.__heldMovement = null;
  win.__failInvoiceDetail = false;
  win.__exportChunks = [];
  win.__exportFinished = false;
  win.__fidelityEmit = (event: string, payload: unknown) => win.__nasqoHybridReceive?.({
    protocolVersion: "1.0.0", kind: "event", event, payload, timestampMs: Date.now(),
  });
  const readActions = new Set(["getSnapshot", "navigate", "goBack", "openInvoice", "showMessage", "saveUiPreferences",
    "changeCurrency", "getProductPriceStats", "getInventoryMovementsReport", "getInvoiceDetail", "legacyArchiveAction",
    "beginDocumentExport", "appendDocumentExport", "finishDocumentExport", "abortDocumentExport"]);
  const archiveSha = sessionStorage.getItem("nasqo-test-archive-source-sha") || "a".repeat(64);
  state.workspace!.legacySourceSha = archiveSha;
  const archiveRows = (kind: string) => Array.from({ length: kind === "offers" ? 55 : 1 }, (_, i) => ({
    id: String(i + 1), sourceSha: archiveSha, recordKind: kind, accountId: "acc_sup_1", accountName: "حساب اختبار اصطناعي",
    entryDate: "2026-11-20", details: kind === "alerts" ? "تنبيه اصطناعي من النسخة" : `مستند اصطناعي مستورد ${i + 1}`,
    amount: kind === "alerts" ? 0 : 100, currency: "ريال", documentNumber: `TEST-${i + 1}`,
    sourceReference: "TEST-ARCHIVE-REF", headerDiscount: 0, docType: 3, direction: "credit", deleted: kind === "trash",
    payment: "credit", exchangeRate: 1, read: false, dismissed: false,
  }));
  win.__archiveRecords = { offers: archiveRows("offers"), trash: archiveRows("trash"), alerts: archiveRows("alerts") };
  const archiveResult = (p: any) => {
    const records = win.__archiveRecords[p.recordKind];
    if (p.operation === "list") {
      const matching = records.filter((r: any) => !p.query || `${r.id} ${r.accountName} ${r.details}`.includes(p.query));
      const offset = p.offset ?? 0, limit = p.limit ?? 50, end = Math.min(offset + limit, matching.length);
      return { available: true, sourceSha: archiveSha, items: matching.slice(offset, end), totalCount: matching.length,
        nextOffset: end < matching.length ? end : null, readOnlyReview: false };
    }
    if (p.sourceSha !== archiveSha) throw new Error("Synthetic source mismatch");
    const record = records.find((r: any) => r.id === p.recordId);
    if (!record) throw new Error("Synthetic source record missing");
    if (p.operation === "alertState") { record.read = p.read; record.dismissed = p.dismissed; return { saved: true }; }
    return { available: true, record: { ...record, fields: { id: record.id, details: record.details },
      lines: p.recordKind === "alerts" ? [] : [{ id: "1", lineKind: "item", inventoryItemId: "synthetic-item-0001",
        itemName: "صنف اصطناعي 0001", warehouseId: "wh_main", warehouseName: "مخزن اصطناعي", quantity: 2,
        price: 50, total: 100, discount: 0, bonus: 0, unit: "حبة", unitNum: 1, details: "بند مستورد اصطناعي", expiryDate: "" }] } };
  };
  const movementRows = (itemId: string) => Array.from({ length: win.__historyScopeScenario ? 19 : itemId === "synthetic-item-0001" ? 516 : 2 }, (_, i) => ({
    movementId: `${itemId}:event:${i}`, itemId, sourceItemId: itemId, source: i === 515 ? "transfer" : "invoice",
    historical: true, role: i === 515 ? "transferIn" : "buy", refId: `${itemId}:ref:${i}`,
    date: i === 515 ? "2026-11-20" : "2026-11-25", entryNumber: 10000 - i,
    label: i === 515 ? "تحويل بين المخازن" : "فاتورة شراء اصطناعية", accountName: "حساب اختبار اصطناعي",
    warehouseId: win.__historyScopeScenario && i>=3 ? "wh_branch" : "wh_main", warehouseName: win.__historyScopeScenario && i>=3 ? "مخزن اصطناعي آخر" : "مخزن اصطناعي", quantity: 1, unit: "حبة", baseQuantity: 1,
    effectQty: 1, price: i === 515 ? 0 : 10, total: i === 515 ? 0 : 10, currency: win.__historyScopeScenario && i>=17 ? "دولار" : "ريال",
  }));
  const report = (options: any) => {
    const all = options.itemId ? movementRows(options.itemId).filter(e => (!options.fromDate || e.date >= options.fromDate)
      && (!options.toDate || e.date <= options.toDate) && (!options.currency || e.currency === options.currency)
      && (!options.warehouseId || e.warehouseId === options.warehouseId)) : [];
    const offset = options.movementOffset ?? 0, limit = options.movementLimit ?? 100;
    const end = Math.min(offset + limit, all.length);
    return { warehouses: state.warehouses, warehouseStocks: [],
      itemRows: state.inventory.slice(0, 2).map((item, i) => ({ id: item.id, code: i + 1, name: item.name, sku: item.sku,
        unit: item.unit, warehouseId: "wh_main", openingQty: 0, periodNetQty: 5, buyQty: 5, sellQty: 0,
        transferInQty: 1, transferOutQty: 0, buyTotal: 50, sellTotal: 0, availableQty: 5, unitCost: 10,
        remainingValue: 0, estimatedRemainingValue: i===0?37.5:12.5,
        profit: 0, avgCost: 0, sellingPrice: 50, catalogQuantity: 0,
        quantityUnverified: true, hasMovement: true })),
      totals: { totalSales: 0, totalPurchases: 50, totalProfit: 0, totalRemainingValue: 0, activeItemsCount: 2, profitBasis: "avg" },
      anomalies: { unverifiedItemsCount: 40, unresolvedTransfersCount: 0, negativeComputedItems: [] },
      dataScopeNote: "بيانات اختبار اصطناعية؛ الرصيد المعتمد لا يتغير عند تصفح التاريخ.",
      movements: all.slice(offset, end), movementPage: { offset, limit, totalCount: all.length,
        nextOffset: end < all.length ? end : null, hasMore: end < all.length },
    };
  };
  win.NasqoHome = { postMessage(raw: string) {
    const request = JSON.parse(raw);
    const loggedPayload = request.action === "appendDocumentExport"
      ? { ...request.payload, base64: "[synthetic PDF bytes omitted]", base64Length: request.payload.base64.length } : request.payload;
    win.__fidelityCommands.push({ action: request.action, payload: loggedPayload, idempotencyKey: request.idempotencyKey });
    let ok = readActions.has(request.action);
    let data: unknown = { ok: true };
    if (request.action === "getSnapshot") data = state;
    if (request.action === "getProductPriceStats") data = { minPrice: 10, maxPrice: 10, lastPrice: 10, txCount: 516 };
    if (request.action === "getInvoiceDetail") data = { entry: state.ledger[0], lines };
    if (request.action === "getInvoiceDetail" && win.__failInvoiceDetail) ok = false;
    if (request.action === "getInventoryMovementsReport") data = report(request.payload.options ?? {});
    if (request.action === "getInventoryMovementsReport" && request.payload.options?.itemId && win.__failNextMovement) {
      win.__failNextMovement = false; ok = false;
    }
    if (request.action === "legacyArchiveAction") data = archiveResult(request.payload);
    if (request.action === "beginDocumentExport") { win.__exportChunks = []; win.__exportFinished = false; data = { exportId: "synthetic-export" }; }
    if (request.action === "appendDocumentExport") {
      win.__exportChunks.push(request.payload.base64); data = { received: request.payload.offset + atob(request.payload.base64).length };
    }
    if (request.action === "finishDocumentExport") { win.__exportFinished = true; data = { completed: true, mode: "save" }; }
    const respond = () => win.__nasqoHybridReceive?.({ protocolVersion: "1.0.0", kind: "response",
      requestId: request.requestId, action: request.action, ok,
      ...(ok ? { data } : { error: { code: "UNAUTHORIZED_ACTION", message: "Synthetic host rejects writes" } }), timestampMs: Date.now() });
    if (request.action === "getInventoryMovementsReport" && request.payload.options?.itemId && win.__delayNextMovement) {
      win.__delayNextMovement = false; win.__heldMovement = respond;
    } else setTimeout(respond, 0);
  } };
}

// tsx may preserve names using __name inside the serialized host's nested functions.
const fixture = `const __name=(fn)=>fn;(${installHost.toString()})(${JSON.stringify(snapshot).replace(/</g, "\\u003c")},${JSON.stringify(invoiceLines)});`;
const mime: Record<string, string> = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/__synthetic_fidelity_host.js") { response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(fixture); return; }
  const file = path.resolve(bundle, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${bundle}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (file.endsWith("index.html")) response.end(fs.readFileSync(file, "utf8").replace("<head>", '<head><script src="/__synthetic_fidelity_host.js"></script>'));
  else fs.createReadStream(file).pipe(response);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
let context: BrowserContext, page: Page;
const browserErrors: string[] = [], externalRequests: string[] = [];
const results: { name: string; passed: boolean; error?: string }[] = [];
const commands = () => page.evaluate(() => (window as any).__fidelityCommands as { action: string; payload: any }[]);
const emit = (event: string, payload: unknown) => page.evaluate(({ event, payload }) => (window as any).__fidelityEmit(event, payload), { event, payload });
async function fresh() {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  await context.route("**/*", route => { if (route.request().url().startsWith(url + "/")) return route.continue(); externalRequests.push(route.request().url()); return route.abort(); });
  page = await context.newPage(); page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(url); await expect(page.getByTestId("dashboard-screen")).toBeVisible();
}
async function noWrites() {
  assert.deepEqual((await commands()).filter(r => isFinancialMutationCommand(r.action as HybridCommandAction) || ["saveErpData", "openStockReconciliation"].includes(r.action)), []);
  assert.deepEqual(await page.evaluate(() => (window as any).__fidelityState.inventory), JSON.parse(JSON.stringify(snapshot.inventory)));
  assert.deepEqual(await page.evaluate(() => (window as any).__fidelityState.ledger), JSON.parse(JSON.stringify(snapshot.ledger)));
}
async function run(name: string, action: () => Promise<void>) {
  if (process.env.NASQO_PREVIEW_ONLY === "1") return;
  if (process.env.NASQO_TEST_FILTER && !name.includes(process.env.NASQO_TEST_FILTER)) return;
  try { await fresh(); await action(); await noWrites(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); await page.screenshot({ path: path.join(evidence, name + "-failure.png") }); }
  fs.writeFileSync(path.join(evidence, name + "-commands.json"), JSON.stringify(await commands(), null, 2));
}
const openReport = async () => { await page.getByTestId("open-stock-movement-btn").click(); await expect(page.getByTestId("inventory-report-screen")).toBeVisible(); };
const openMovements = async (suffix = "0001") => { await page.getByRole("button", { name: `حركة صنف صنف اصطناعي ${suffix}`, exact: true }).click(); await expect(page.getByTestId("item-movements-modal")).toBeVisible(); };
const openDrawerDestination = async (label: string) => {
  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await page.getByRole("complementary", { name: "قائمة نسقو" }).getByRole("button", { name: label, exact: true }).click();
};
const readDraft = () => page.evaluate(() => Object.values(localStorage).map(raw => { try { return JSON.parse(raw); } catch { return null; } })
  .find(value => value?.slot === "invoice-draft")?.value);

try {
  await run("catalog-search-pages-and-reset", async () => {
    await page.getByTestId("open-items-btn").click();
    const search = page.getByTestId("items-catalog-screen").getByRole("textbox").first();
    await search.fill("صنف اصطناعي"); await search.blur();
    await expect(page.getByTestId("catalog-next-page")).toBeVisible();
    const first = await page.locator('[data-testid^="catalog-row-"]').evaluateAll(rows => rows.map(r => r.getAttribute("data-testid")));
    await page.getByTestId("catalog-next-page").click();
    const second = await page.locator('[data-testid^="catalog-row-"]').evaluateAll(rows => rows.map(r => r.getAttribute("data-testid")));
    assert.equal(first.length, 15); assert.equal(second.length, 15); assert.equal(first.filter(id => second.includes(id)).length, 0);
    await page.getByTestId("catalog-next-page").click(); await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(11);
    await search.fill("TEST-0041"); await search.blur();
    await expect(page.getByTestId("catalog-row-synthetic-item-0041")).toBeVisible(); await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(1);
    await search.fill("صنف اصطناعي"); await search.blur(); await page.getByTestId("catalog-show-all").click();
    await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(41);
    await page.screenshot({ path: path.join(evidence, "catalog-search-all.png") });
  });
  await run("catalog-reference-cost-does-not-approve-stock", async () => {
    await page.getByTestId("open-items-btn").click();
    await expect(page.getByTestId("catalog-cost-synthetic-item-0001")).toContainText("10");
    await expect(page.getByTestId("catalog-cost-synthetic-item-0001")).toContainText("مرجعي");
    await page.screenshot({ path: path.join(evidence, "catalog-reference-cost.png") });
    const search = page.getByTestId("items-catalog-screen").getByRole("textbox").first(); await search.fill("TEST-0041"); await search.blur();
    await expect(page.getByTestId("catalog-cost-synthetic-item-0041")).toContainText("22");
    await expect(page.getByTestId("catalog-cost-synthetic-item-0041")).not.toContainText("مرجعي");
  });
  await run("inventory-estimate-separated-from-approved-value", async () => {
    await openReport();
    await expect(page.getByTestId("inventory-estimated-value")).toContainText("50 ريال");
    await expect(page.getByTestId("inventory-movements-footer")).toContainText("قيمة المتبقي المعتمدة : 66");
    await expect(page.getByTestId("inventory-movements-table")).toContainText("37.5");
    await expect(page.getByTestId("inventory-movements-table")).toContainText("تقديرية — غير معتمدة");
    await page.getByTestId("inventory-movements-footer").scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(evidence,"inventory-estimated-value.png")});
    await page.getByRole("button",{name:"طباعة التقرير",exact:true}).click();
    await page.getByLabel("Excel",{exact:true}).check();
    await page.getByRole("button",{name:"حفظ الملف",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__exportFinished)).toBe(true);
    const chunks=await page.evaluate(()=>(window as any).__exportChunks as string[]);
    const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c,"base64")));
    const x=await import("xlsx");const book=x.read(bytes);
    const rows=x.utils.sheet_to_json(book.Sheets["التقرير"],{header:1}) as any[][];
    assert(rows[0].includes("قيمة المتبقي المعتمدة"));assert(rows[0].includes("قيمة المتبقي التقديرية"));
    const first=rows.find(r=>r[1]==="صنف اصطناعي 0001")!;assert(first);
    assert.equal(first[6],0);assert.equal(first[9],37.5);assert.equal(first[10],"كمية غير معتمدة");
    fs.writeFileSync(path.join(evidence,"inventory-estimates.xlsx"),bytes);
  });
  await run("all-516-item-movements-without-duplicates", async () => {
    await openReport(); await openMovements();
    await expect(page.getByTestId("item-movement-row")).toHaveCount(100);
    for (const count of [200, 300, 400, 500, 516]) { await page.getByTestId("item-movements-load-more").click(); await expect(page.getByTestId("item-movement-row")).toHaveCount(count); }
    const ids = await page.getByTestId("item-movement-row").evaluateAll(rows => rows.map(r => r.getAttribute("data-movement-id")));
    assert.equal(new Set(ids).size, 516); await expect(page.getByTestId("item-movements-load-more")).toHaveCount(0);
    await expect(page.getByTestId("item-movement-row").last()).toContainText("2026-11-20");
    await expect(page.getByTestId("item-movement-row").last()).toContainText("تحويل");
    await page.getByTestId("item-movement-row").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, "item-movements-516.png") });
  });
  await run("movement-scope-three-versus-nineteen-preserves-parent-filters",async()=>{
    await page.evaluate(()=>{(window as any).__historyScopeScenario=true;});await openReport();await page.getByTestId("inventory-toggle-filters").click();
    await page.getByRole("combobox",{name:"المخزن",exact:true}).selectOption("wh_main");
    await openMovements();await expect(page.getByTestId("item-movement-row")).toHaveCount(3);
    const modal=page.getByTestId("item-movements-modal");await expect(modal.getByTestId("item-history-scope")).toContainText("المخزن الرئيسي");
    await modal.getByRole("button",{name:"سجل الصنف كاملًا",exact:true}).click();await expect(page.getByTestId("item-movement-row")).toHaveCount(19);
    await expect(modal.getByTestId("item-history-scope")).toContainText("جميع المخازن والعملات والتواريخ");await expect(modal.locator('.item-history-currency').filter({hasText:'دولار'})).toHaveCount(2);
    await page.screenshot({path:path.join(evidence,"item-history-all-warehouses.png"),animations:"disabled"});
    await modal.getByRole("button",{name:"فلاتر التقرير",exact:true}).click();await expect(page.getByTestId("item-movement-row")).toHaveCount(3);
    await page.screenshot({path:path.join(evidence,"item-history-filtered.png"),animations:"disabled"});
    await modal.getByRole("button",{name:"إغلاق",exact:true}).first().click();await expect(page.getByRole("combobox",{name:"المخزن",exact:true})).toHaveValue("wh_main");
    await openMovements();await expect(page.getByTestId("item-movement-row")).toHaveCount(3);
  });
  await run("movement-date-filter-includes-dated-transfer-and-resets-page", async () => {
    await openReport(); await page.getByTestId("inventory-toggle-filters").click();
    await page.getByTestId("inventory-from-date").fill("2026-11-20"); await page.getByTestId("inventory-to-date").fill("2026-11-20");
    await openMovements(); await expect(page.getByTestId("item-movement-row")).toHaveCount(1);
    await expect(page.getByTestId("item-movement-row")).toContainText("تحويل");
    const req = (await commands()).filter(r => r.action === "getInventoryMovementsReport" && r.payload.options?.itemId).at(-1)!;
    assert.equal(req.payload.options.fromDate, "2026-11-20"); assert.equal(req.payload.options.toDate, "2026-11-20"); assert.equal(req.payload.options.movementOffset ?? 0, 0);
    await page.getByTestId("item-movements-modal").getByRole("button", { name: "إغلاق", exact: true }).first().click();
    await page.getByTestId("inventory-clear-dates").click(); await openMovements(); await expect(page.getByTestId("item-movement-row")).toHaveCount(100);
    await page.screenshot({ path: path.join(evidence, "item-movement-filter-reset.png") });
  });
  await run("closed-item-late-response-cannot-replace-new-item", async () => {
    await openReport(); await page.evaluate(() => { (window as any).__delayNextMovement = true; }); await openMovements();
    await expect.poll(() => page.evaluate(() => !!(window as any).__heldMovement)).toBe(true);
    await page.getByTestId("item-movements-modal").getByRole("button", { name: "إغلاق", exact: true }).first().click();
    await openMovements("0002"); await expect(page.getByTestId("item-movement-row")).toHaveCount(2);
    await page.evaluate(() => (window as any).__heldMovement?.());
    await expect(page.getByTestId("item-movements-modal")).toContainText("صنف اصطناعي 0002");
    await expect(page.getByTestId("item-movement-row")).toHaveCount(2);
    assert((await page.getByTestId("item-movement-row").evaluateAll(rows => rows.map(r => r.getAttribute("data-movement-id")))).every(id => id?.startsWith("synthetic-item-0002")));
  });
  await run("movement-read-errors-retain-rows-and-retry-correct-offset", async () => {
    await openReport(); await page.evaluate(() => { (window as any).__failNextMovement = true; }); await openMovements();
    await expect(page.getByTestId("item-movements-error")).toBeVisible();
    await expect(page.getByTestId("item-movements-modal")).not.toContainText("لا توجد فواتير");
    await page.getByTestId("item-movements-retry").click(); await expect(page.getByTestId("item-movement-row")).toHaveCount(100);
    await page.evaluate(() => { (window as any).__failNextMovement = true; }); await page.getByTestId("item-movements-load-more").click();
    await expect(page.getByTestId("item-movements-error")).toBeVisible(); await expect(page.getByTestId("item-movement-row")).toHaveCount(100);
    await page.getByTestId("item-movements-retry").click(); await expect(page.getByTestId("item-movement-row")).toHaveCount(200);
    const offsets = (await commands()).filter(r => r.action === "getInventoryMovementsReport" && r.payload.options?.itemId).map(r => r.payload.options.movementOffset ?? 0);
    assert.deepEqual(offsets, [0, 0, 100, 100]);
  });
  await run("rapid-load-more-sends-one-page-request", async () => {
    await openReport(); await openMovements(); await expect(page.getByTestId("item-movement-row")).toHaveCount(100);
    await page.evaluate(() => { (window as any).__delayNextMovement = true; });
    await page.getByTestId("item-movements-load-more").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => page.evaluate(() => !!(window as any).__heldMovement)).toBe(true);
    assert.equal((await commands()).filter(r => r.action === "getInventoryMovementsReport" && r.payload.options?.movementOffset === 100).length, 1);
    await page.evaluate(() => (window as any).__heldMovement?.()); await expect(page.getByTestId("item-movement-row")).toHaveCount(200);
  });
  await run("invoice-full-note-reference-and-source-discounts", async () => {
    await emit("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } });
    await expect(page.getByTestId("supplier-screen")).toBeVisible();
    await page.getByRole("button", { name: "ملف PDF للعملية #1001", exact: true }).click();
    await expect(page.getByTestId("cash-invoice-document")).toBeVisible();
    await expect(page.getByTestId("cash-invoice-document")).toContainText("نهاية الملاحظة بعد ستمائة حرف");
    await expect(page.getByTestId("cash-invoice-source-reference")).toContainText("TEST-REFERENCE-861");
    await expect(page.getByTestId("cash-invoice-header-discount")).toContainText("7");
    await expect(page.getByTestId("cash-invoice-line-metadata-1")).toContainText("2027-12-31");
    await expect(page.getByTestId("cash-invoice-line-metadata-1")).toContainText("3");
    await expect(page.getByTestId("cash-invoice-grand-total")).toHaveText("100");
    await expect.poll(() => page.getByTestId("cash-invoice-document").evaluate(el => {
      const sheet = el.parentElement!; return sheet.getBoundingClientRect().height + 2 >= el.getBoundingClientRect().height;
    })).toBe(true);
    await page.screenshot({ path: path.join(evidence, "invoice-full-source-details.png") });
  });
  await run("invoice-pdf-contains-multiple-pages-for-full-source-details", async () => {
    await emit("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } });
    await page.getByRole("button", { name: "ملف PDF للعملية #1001", exact: true }).click();
    await expect(page.getByTestId("cash-invoice-document")).toBeVisible();
    await page.getByTestId("cash-invoice-download-pdf").click();
    await expect.poll(() => page.evaluate(() => (window as any).__exportFinished), { timeout: 30000 }).toBe(true);
    const chunks = await page.evaluate(() => (window as any).__exportChunks as string[]);
    const pdf = Buffer.concat(chunks.map(chunk => Buffer.from(chunk, "base64")));
    assert(pdf.toString("ascii", 0, 8).startsWith("%PDF-"));
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    assert(pages >= 2, `Expected multiple pages, received ${pages}`);
    fs.writeFileSync(path.join(evidence, "synthetic-source-invoice.pdf"), pdf);
    fs.writeFileSync(path.join(evidence, "pdf-result.json"), JSON.stringify({ pages, bytes: pdf.length, synthetic: true, nativeFilePickerTested: false }, null, 2));
  });
  await run("invoice-pdf-refuses-missing-line-details", async () => {
    await emit("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } });
    await page.getByRole("button", { name: "ملف PDF للعملية #1001", exact: true }).click();
    await expect(page.getByTestId("cash-invoice-line-metadata-1")).toBeVisible();
    await page.evaluate(() => { (window as any).__failInvoiceDetail = true; });
    await page.getByTestId("cash-invoice-download-pdf").click();
    await expect(page.getByText("تعذّر إنشاء ملف PDF للفاتورة", { exact: true })).toBeVisible();
    assert.equal((await commands()).filter(r => r.action === "beginDocumentExport").length, 0);
  });
  await run("imported-quotes-in-normal-destination-page-and-durable-draft", async () => {
    await openDrawerDestination("عروض الأسعار"); await expect(page.getByTestId("quotes-list-modal")).toBeVisible();
    await expect(page.getByTestId("legacy-offers-panel")).toBeVisible();
    await expect(page.locator('[data-testid^="legacy-offers-record-"]')).toHaveCount(50);
    await page.getByTestId("legacy-offers-load-more").click(); await expect(page.locator('[data-testid^="legacy-offers-record-"]')).toHaveCount(55);
    await page.getByTestId("legacy-offers-record-1").click(); await expect(page.getByTestId("legacy-record-detail")).toContainText("TEST-ARCHIVE-REF");
    await page.screenshot({ path: path.join(evidence, "imported-quote-detail.png") });
    await page.getByTestId("legacy-copy-to-draft").click(); await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف اصطناعي 0001");
    await expect.poll(async () => (await readDraft())?.intent).toBe("quote");
    await noWrites(); await page.reload(); await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف اصطناعي 0001");
    await expect.poll(async () => (await readDraft())?.entryId).toBe(`legacy-copy-${"a".repeat(64)}-offers-1`);
    assert.equal(await page.evaluate(() => (window as any).__archiveRecords.offers.length), 55);
    await page.screenshot({ path: path.join(evidence, "imported-quote-local-draft.png") });
  });
  await run("copied-draft-bound-to-source-sha-through-backup-aba-replacement", async () => {
    await openDrawerDestination("عروض الأسعار"); await page.getByTestId("legacy-offers-record-1").click();
    await page.getByTestId("legacy-copy-to-draft").click(); await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect.poll(async () => (await readDraft())?.sourceSha).toBe("a".repeat(64));
    const originalDraft = await readDraft(); await noWrites();
    await page.evaluate(() => sessionStorage.setItem("nasqo-test-archive-source-sha", "b".repeat(64))); await page.reload();
    await expect(page.getByRole("alertdialog", { name: "تعذر استعادة المسودة", exact: true })).toBeVisible();
    await expect(page.getByTestId("invoice-modal")).toHaveCount(0); assert.deepEqual(await readDraft(), originalDraft); await noWrites();
    await page.screenshot({ path: path.join(evidence, "copied-draft-different-backup-blocked.png") });
    await page.evaluate(() => sessionStorage.setItem("nasqo-test-archive-source-sha", "a".repeat(64))); await page.reload();
    await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect(page.getByLabel("اسم الصنف للسطر 1", { exact: true })).toHaveValue("صنف اصطناعي 0001");
    await expect.poll(async () => (await readDraft())?.entryId).toBe(originalDraft.entryId);
  });
  await run("imported-trash-keeps-original-deleted-when-copying-draft", async () => {
    await openDrawerDestination("سلة المحذوفات"); await expect(page.getByTestId("legacy-trash-panel")).toBeVisible();
    await page.getByTestId("legacy-trash-record-1").click(); await expect(page.getByTestId("legacy-record-detail")).toContainText("100");
    await page.getByTestId("legacy-copy-to-draft").click(); await expect(page.getByTestId("invoice-modal")).toBeVisible();
    await expect.poll(async () => (await readDraft())?.intent).toBe("invoice");
    assert.equal(await page.evaluate(() => (window as any).__archiveRecords.trash[0].deleted), true);
    await page.screenshot({ path: path.join(evidence, "imported-trash-local-draft.png") });
  });
  await run("imported-alert-in-notifications-read-hide-and-show-again", async () => {
    await page.getByRole("button", { name: "التنبيهات", exact: true }).click();
    await expect(page.getByTestId("notification-center-modal")).toBeVisible();
    await page.getByTestId("legacy-alerts-record-1").click();
    await expect(page.getByTestId("legacy-record-detail")).toContainText("تنبيه اصطناعي من النسخة");
    await page.getByTestId("legacy-alert-read").click(); await expect(page.getByTestId("legacy-alert-read")).toHaveText("تحديد كغير مقروء");
    await page.getByTestId("legacy-alert-dismiss").click(); await expect(page.getByTestId("legacy-alert-dismiss")).toHaveText("إظهار التنبيه مجددًا");
    await page.getByRole("button", { name: "العودة إلى القائمة", exact: true }).click();
    await expect(page.getByTestId("legacy-alerts-record-1")).toHaveCount(0);
    await page.getByRole("button", { name: "عرض التنبيهات المخفية", exact: true }).click();
    await page.getByTestId("legacy-alerts-record-1").click(); await page.getByTestId("legacy-alert-dismiss").click();
    assert.deepEqual((await commands()).filter(r => r.action === "legacyArchiveAction" && r.payload.operation === "alertState").map(r => [r.payload.read, r.payload.dismissed]), [[true, false], [true, true], [true, false]]);
    await page.screenshot({ path: path.join(evidence, "imported-alert-managed.png") });
  });
} finally {
  const manifest = path.join(bundle, "hybrid-manifest.json");
  if (process.env.NASQO_PREVIEW_ONLY !== "1") fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ environment: "Chromium built hybrid UI; synthetic host; NOT Android or SQLite", bundle,
    manifestSha256: fs.existsSync(manifest) ? crypto.createHash("sha256").update(fs.readFileSync(manifest)).digest("hex") : null,
    results, browserErrors, externalRequests }, null, 2));
  await context?.close(); await browser.close();
  if (process.env.NASQO_KEEP_PREVIEW === "1") console.log(`SYNTHETIC_PREVIEW_URL=${url}`);
  else await new Promise<void>(resolve => server.close(() => resolve()));
  if (results.some(r => !r.passed) || browserErrors.length || externalRequests.length) process.exitCode = 1;
}
