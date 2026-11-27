/** Browser-only acceptance against the built hybrid bundle. Never connects to SQLite or a device. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, } from "@playwright/test";
import { createHybridHomeFixtureSnapshot } from "../src/hybrid/homeFixture";
import { isFinancialMutationCommand, type HybridCommandAction } from "../src/hybrid/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = process.env.NASQO_HYBRID_BUNDLE || path.join(root, "dist/hybrid");
const evidence = process.env.NASQO_ACCEPTANCE_OUT || path.join(root, "test-results/hybrid-back-resume");
fs.mkdirSync(evidence, { recursive: true });
const snapshot = createHybridHomeFixtureSnapshot();
snapshot.workspace!.companyName = "اختبار اصطناعي — الرجوع والاستئناف";
snapshot.accounts.forEach((account, index) => {
  account.name = `حساب اصطناعي ${index + 1}`;
  account.phone = "";
});
snapshot.ledger.forEach((entry) => {
  entry.accountName = snapshot.accounts.find((account) => account.id === entry.accountId)?.name || "حساب اصطناعي";
});
const sourceRow = snapshot.ledger.find((entry) => entry.accountId === "acc_sup_1")!;
snapshot.ledger.push(...Array.from({ length: 70 }, (_, index) => ({ ...sourceRow,
  id: `synthetic-scroll-${index}`, entryNumber: 2000 + index, amount: 10,
  details: `حركة اصطناعية ${index + 1}`, documentNumber: `TEST-${index + 1}`,
})));
snapshot.capabilities = { ...snapshot.capabilities!, readOnlyFinancial: true, localDocumentPosting: true, localStockPosting: true };

function installSyntheticBridge(state: typeof snapshot) {
  const win = window as any;
  win.__nasqoAcceptanceCommands = [];
  win.__nasqoAcceptancePageInstance = `${Date.now()}-${Math.random()}`;
  win.__nasqoAcceptanceEmit = (event: string, payload: unknown) => win.__nasqoHybridReceive?.({
    protocolVersion: "1.0.0", kind: "event", event, payload, timestampMs: Date.now(),
  });
  if (sessionStorage.getItem("acceptance-remove-account") === "1") {
    state.accounts = state.accounts.filter((account) => account.id !== "acc_sup_1");
  }
  const readOnly = new Set(["getSnapshot", "navigate", "goBack", "openInvoice", "openVoucher",
    "openAccountStatement", "showMessage", "saveUiPreferences", "changeCurrency", "backHandled",
    "backResult", "pickFile", "shareText", "saveUiState"]);
  win.NasqoHome = {
    postMessage(raw: string) {
      const request = JSON.parse(raw);
      win.__nasqoAcceptanceCommands.push({ action: request.action, payload: request.payload });
      let data: unknown = { ok: true };
      if (request.action === "getSnapshot") data = state;
      if (request.action === "pickFile") data = { cancelled: true };
      let ok = readOnly.has(request.action);
      // This branch is enabled only by the explicit synthetic-success test.
      if (request.action === "createLedgerEntry" && win.__nasqoAllowSyntheticPost === true) {
        const entry = { ...request.payload.payload, ownerId: state.workspaceId,
          createdAtMs: Date.now(), deleted: false };
        state.ledger.push(entry);
        data = { entry, snapshot: state };
        ok = true;
      }
      setTimeout(() => win.__nasqoHybridReceive?.({
        protocolVersion: "1.0.0", kind: "response", requestId: request.requestId,
        action: request.action, ok,
        ...(ok ? { data } : { error: { code: "UNAUTHORIZED_ACTION", message: "Synthetic acceptance host forbids writes" } }),
        timestampMs: Date.now(),
      }), 0);
    },
  };
}

const fixtureScript = `(${installSyntheticBridge.toString()})(${JSON.stringify(snapshot).replace(/</g, "\\u003c")});`;
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/__synthetic_bridge.js") {
    response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    response.end(fixtureScript);
    return;
  }
  const absolute = path.resolve(bundle, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!absolute.startsWith(`${path.resolve(bundle)}${path.sep}`) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(absolute)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (absolute.endsWith("index.html")) {
    // Test host script runs before the real production entry, and is never bundled into the APK.
    response.end(fs.readFileSync(absolute, "utf8").replace("<head>", '<head><script src="/__synthetic_bridge.js"></script>'));
  } else fs.createReadStream(absolute).pipe(response);
});
await new Promise<void>((resolve) => server.listen(Number(process.env.NASQO_ACCEPTANCE_PORT || 4185), "0.0.0.0", resolve));
const address = server.address();
assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}`;
console.log(`Synthetic-only hybrid browser preview: ${url}`);
if (process.env.NASQO_PREVIEW_ONLY === "1") {
  console.log("Preview remains running. All financial commands are rejected; no Android or production data is connected.");
} else {
  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  let page = await context.newPage();
  const errors: string[] = [];
  const results: { name: string; passed: boolean; error?: string }[] = [];
  let sequence = 0;
  const event = async (event: string, payload: unknown) => page.evaluate(({ event, payload }) => (window as any).__nasqoAcceptanceEmit(event, payload), { event, payload });
  const back = async () => {
    const requestId = `acceptance-${++sequence}`;
    await event("backPressed", { requestId });
    await page.waitForTimeout(240);
  };
  const fresh = async () => {
    // A pagehide checkpoint can repopulate storage after clear()+reload().
    // Isolate scenarios while keeping reloads within each scenario persistent.
    await context.close();
    context = await browser.newContext({ viewport: { width: 412, height: 915 } });
    page = await context.newPage();
    page.on("pageerror", (error) => { errors.push(error.message); console.error(`BROWSER_ERROR ${error.message}`); });
    await page.goto(url);
    await expect(page.getByTestId("dashboard-screen")).toBeVisible();
  };
  const supplier = async () => {
    await event("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } });
    await expect(page.getByTestId("supplier-screen")).toBeVisible();
  };
  const openInvoice = async () => {
    await supplier();
    await page.locator(".footer-menu").click();
    await page.getByRole("menuitem", { name: "فاتورة جديدة", exact: true }).click();
    await expect(page.getByTestId("invoice-modal")).toBeVisible();
  };
  const noWrites = async () => {
    const commands: { action: string }[] = await page.evaluate(() => (window as any).__nasqoAcceptanceCommands);
    const writes = commands.filter((command) => isFinancialMutationCommand(command.action as HybridCommandAction) || command.action === "saveErpData");
    assert.deepEqual(writes, [], "Navigation/draft restoration must never issue financial commands");
  };
  const run = async (name: string, action: () => Promise<void>) => {
    try { await fresh(); await action(); await noWrites(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); await page.screenshot({ path: path.join(evidence, `${results.length}-failure.png`) }); }
  };
  try {
    await run("supplier-menu-consumes-back-before-screen", async () => {
      await supplier();
      await page.locator(".footer-menu").click();
      await expect(page.getByTestId("cash-operations-menu")).toBeVisible();
      await back();
      await expect(page.getByTestId("cash-operations-menu")).toBeHidden();
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      await page.screenshot({ path: path.join(evidence, "supplier-after-menu-back.png") });
      await back();
      await expect(page.getByTestId("dashboard-screen")).toBeVisible();
    });
    await run("supplier-route-restores-after-new-document", async () => {
      await supplier();
      const before = await page.evaluate(() => (window as any).__nasqoAcceptancePageInstance);
      await page.reload();
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      const after = await page.evaluate(() => (window as any).__nasqoAcceptancePageInstance);
      assert.notEqual(before, after, "This must recreate document memory, not just hide/show the same page");
      await page.screenshot({ path: path.join(evidence, "supplier-cold-document-restore.png") });
    });
    await run("supplier-search-filter-scroll-restores-after-new-document", async () => {
      await supplier();
      await page.getByTestId("supplier-toggle-filters").click();
      await page.getByLabel("نوع المستند", { exact: true }).selectOption("invoice");
      await page.getByTestId("supplier-search-input").fill("اصطناعية");
      await page.getByTestId("supplier-search-input").press("Enter");
      const scroll = page.getByTestId("supplier-screen").getByTestId("mobile-scroll");
      await scroll.evaluate((element) => { element.scrollTop = 700; element.dispatchEvent(new Event("scroll")); });
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
      await page.reload();
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      await expect(page.getByTestId("supplier-search-input")).toHaveValue("اصطناعية");
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
      await page.screenshot({ path: path.join(evidence, "supplier-search-filter-scroll-restored.png") });
      await page.getByTestId("supplier-search-bar-cancel").click();
      await page.getByTestId("supplier-toggle-filters").click();
      await expect(page.getByLabel("نوع المستند", { exact: true })).toHaveValue("invoice");
    });
    await run("missing-account-cold-restore-falls-back-safely", async () => {
      await supplier();
      await page.evaluate(() => sessionStorage.setItem("acceptance-remove-account", "1"));
      await page.reload();
      await expect(page.getByTestId("dashboard-screen")).toBeVisible();
      await expect(page.getByTestId("supplier-screen")).toHaveCount(0);
    });
    await run("invoice-back-protects-draft-and-restores-after-reload", async () => {
      await openInvoice();
      const invoice = page.getByTestId("invoice-modal");
      await expect(invoice).toBeVisible();
      await invoice.getByLabel("بيان الفاتورة", { exact: true }).fill("مسودة اصطناعية لا تُرحّل");
      await back(); // An active input is a browser approximation, not proof of Android IME behavior.
      await expect(invoice).toBeVisible();
      if (!(await page.getByTestId("invoice-unsaved-dialog").isVisible())) await back();
      await expect(page.getByTestId("invoice-unsaved-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "متابعة التحرير", exact: true }).click();
      await expect(invoice.getByLabel("بيان الفاتورة", { exact: true })).toHaveValue("مسودة اصطناعية لا تُرحّل");
      await back();
      await page.getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(invoice).toBeHidden();
      await page.reload();
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      await expect(invoice).toBeVisible();
      await expect(invoice.getByLabel("بيان الفاتورة", { exact: true })).toHaveValue("مسودة اصطناعية لا تُرحّل");
      await page.screenshot({ path: path.join(evidence, "invoice-restored-draft.png") });
    });
    await run("invoice-account-picker-back-closes-only-picker", async () => {
      await openInvoice();
      const invoice = page.getByTestId("invoice-modal");
      await invoice.getByTestId("invoice-account-trigger").click();
      await expect(invoice.getByRole("listbox", { name: "حساب الفاتورة", exact: true })).toBeVisible();
      await back();
      await expect(invoice.getByRole("listbox", { name: "حساب الفاتورة", exact: true })).toHaveCount(0);
      await expect(invoice).toBeVisible();
      await expect(page.getByTestId("invoice-unsaved-dialog")).toHaveCount(0);
    });
    await run("invoice-discard-clears-only-local-draft", async () => {
      await openInvoice();
      await page.getByTestId("invoice-modal").getByLabel("بيان الفاتورة", { exact: true }).fill("مسودة سيتم تجاهلها");
      await back();
      await expect(page.getByTestId("invoice-unsaved-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "تجاهل التعديلات", exact: true }).click();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      await expect(page.getByTestId("invoice-modal")).toHaveCount(0);
    });
    await run("rapid-two-backs-close-one-layer-without-exit", async () => {
      await supplier();
      await page.locator(".footer-menu").click();
      await expect(page.getByTestId("cash-operations-menu")).toBeVisible();
      await page.evaluate(() => {
        const emit = (window as any).__nasqoAcceptanceEmit;
        emit("backPressed", { requestId: "rapid-1" });
        emit("backPressed", { requestId: "rapid-2" });
      });
      await expect(page.getByTestId("cash-operations-menu")).toHaveCount(0);
      await expect(page.getByTestId("supplier-screen")).toBeVisible();
      const homeReplies = await page.evaluate(() => (window as any).__nasqoAcceptanceCommands.filter((command: any) => command.action === "goBack" && command.payload?.outcome === "home"));
      assert.deepEqual(homeReplies, []);
    });
    await run("synthetic-lifecycle-events-preserve-page-and-draft-without-bootstrap", async () => {
      await openInvoice();
      const invoice = page.getByTestId("invoice-modal");
      await invoice.getByLabel("بيان الفاتورة", { exact: true }).fill("مسودة استئناف اصطناعية");
      const before = await page.evaluate(() => ({ instance: (window as any).__nasqoAcceptancePageInstance,
        snapshots: (window as any).__nasqoAcceptanceCommands.filter((command: any) => command.action === "getSnapshot").length }));
      await page.evaluate(() => {
        window.dispatchEvent(new Event("nasqo:checkpoint"));
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(invoice.getByLabel("بيان الفاتورة", { exact: true })).toHaveValue("مسودة استئناف اصطناعية");
      const after = await page.evaluate(() => ({ instance: (window as any).__nasqoAcceptancePageInstance,
        snapshots: (window as any).__nasqoAcceptanceCommands.filter((command: any) => command.action === "getSnapshot").length }));
      assert.deepEqual(after, before);
    });
    await run("simple-entry-unsaved-draft-restores-without-posting", async () => {
      await page.getByRole("button", { name: "قيد بسيط", exact: true }).click();
      await expect(page.getByTestId("simple-entry-document")).toBeVisible();
      await page.getByTestId("simple-entry-document").fill("SYNTHETIC-SIMPLE-DRAFT");
      await page.getByTestId("simple-entry-cancel").click();
      await expect(page.getByTestId("unsaved-form-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(page.getByTestId("simple-entry-document")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId("simple-entry-document")).toHaveValue("SYNTHETIC-SIMPLE-DRAFT");
    });
    await run("currency-unsaved-draft-restores-without-posting", async () => {
      await supplier();
      await page.locator(".footer-menu").click();
      await page.getByRole("menuitem", { name: "صرف عملات", exact: true }).click();
      await expect(page.getByTestId("currency-screen")).toBeVisible();
      await page.locator("#currency-note").fill("مسودة صرف اصطناعية");
      await back();
      await expect(page.getByTestId("unsaved-form-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(page.getByTestId("currency-screen")).toHaveCount(0);
      await page.reload();
      await expect(page.locator("#currency-note")).toHaveValue("مسودة صرف اصطناعية");
    });
    await run("voucher-unsaved-draft-restores-without-posting", async () => {
      await supplier();
      await page.getByRole("button", { name: "إضافة سند", exact: true }).click();
      const voucher = page.getByTestId("transaction-modal");
      await expect(voucher).toBeVisible();
      await voucher.locator("#new-transaction-note").fill("مسودة سند اصطناعية");
      await back();
      await expect(page.getByTestId("unsaved-form-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(voucher).toHaveCount(0);
      await page.reload();
      await expect(voucher.locator("#new-transaction-note")).toHaveValue("مسودة سند اصطناعية");
    });
    await run("sales-account-unsaved-draft-retains-category-after-reload", async () => {
      await event("routeChanged", { route: "sales" });
      await expect(page.getByTestId("purchases-screen")).toBeVisible();
      await page.getByRole("button", { name: "إضافة مورد أو عملية", exact: true }).click();
      await page.getByRole("menuitem", { name: "حساب جديد", exact: true }).click();
      const account = page.getByTestId("account-form-extended");
      await expect(account).toBeVisible();
      await account.getByLabel("اسم الحساب", { exact: true }).fill("حساب مبيعات اصطناعي غير محفوظ");
      await back();
      await expect(page.getByTestId("unsaved-form-dialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button", { name: "حفظ مسودة دون ترحيل", exact: true }).click();
      await expect(account).toHaveCount(0);
      await page.reload();
      await expect(account.getByLabel("اسم الحساب", { exact: true })).toHaveValue("حساب مبيعات اصطناعي غير محفوظ");
      await expect(account.getByLabel("تصنيف الحساب الموسع", { exact: true })).toHaveValue("sales");
    });
    await run("missing-account-draft-is-preserved-until-explicit-discard", async () => {
      await openInvoice();
      await page.getByTestId("invoice-modal").getByLabel("بيان الفاتورة", { exact: true }).fill("مسودة بحساب غير متاح");
      await page.evaluate(() => sessionStorage.setItem("acceptance-remove-account", "1"));
      await page.reload();
      const recovery = page.getByRole("alertdialog", { name: "تعذر استعادة المسودة", exact: true });
      await expect(recovery).toBeVisible();
      await recovery.getByRole("button", { name: "الاحتفاظ بالمسودة", exact: true }).click();
      await expect(recovery).toHaveCount(0);
      await page.reload();
      await expect(recovery).toBeVisible();
      await recovery.getByRole("button", { name: "تجاهل المسودة صراحةً", exact: true }).click();
      await page.reload();
      await expect(page.getByTestId("dashboard-screen")).toBeVisible();
      await expect(recovery).toHaveCount(0);
    });
    for (const screen of ["simple", "currency"] as const) {
      await run(`${screen}-explicit-synthetic-save-closes-form-and-does-not-replay`, async () => {
        if (screen === "simple") {
          await page.getByRole("button", { name: "قيد بسيط", exact: true }).click();
          await page.getByTestId("simple-entry-amount").fill("10");
        } else {
          await supplier();
          await page.locator(".footer-menu").click();
          await page.getByRole("menuitem", { name: "صرف عملات", exact: true }).click();
          await page.getByTestId("currency-amount").fill("10");
        }
        await page.evaluate(() => { (window as any).__nasqoAllowSyntheticPost = true; });
        await page.getByTestId(screen === "simple" ? "simple-entry-save" : "currency-save").click();
        const form = page.getByTestId(screen === "simple" ? "simple-entry-screen" : "currency-screen");
        await expect(form).toHaveCount(0);
        const writes = await page.evaluate(() => (window as any).__nasqoAcceptanceCommands.filter((command: any) => command.action === "createLedgerEntry"));
        assert.equal(writes.length, 1, "One explicit click must send exactly one synthetic posting");
        await page.reload();
        await expect(page.getByTestId(screen === "simple" ? "dashboard-screen" : "supplier-screen")).toBeVisible();
        await expect(form).toHaveCount(0);
        // run() checks the new page issued no replay after reload.
      });
    }
  } finally {
    fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ environment: "Chromium production hybrid bundle; synthetic bridge; NOT Android", results, browserErrors: errors }, null, 2));
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (results.some((result) => !result.passed) || errors.length) process.exitCode = 1;
}
