import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const hybridDir = path.join(rootDir, "dist", "hybrid");
const outDir = path.join(rootDir, "qa", "hybrid_home");
const artifactDir = path.join(
  rootDir,
  ".aistudio",
  "artifacts",
  "brain",
  "1a86142a-936d-407e-b821-58c1ebd3e6b0",
  "hybrid_home_qa",
);

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(artifactDir, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

/**
 * Shared multi-currency fixture identical to src/hybrid/homeFixture.ts
 * Used for BOTH Hybrid Home and Web Reference side-by-side comparison.
 */
function buildSharedFixture() {
  return {
    workspaceId: "local-erp-workspace",
    userEmail: "offline@nasqo.local",
    workspace: {
      id: "local-erp-workspace",
      ownerId: "local-erp-workspace",
      companyName: "مؤسسة نسقو التجارية",
      defaultCurrency: "ريال",
      whatsappProvider: "nasqo",
      whatsappInstantEnabled: false,
      whatsappPhone: "777000111",
    },
    currencies: [
      { id: 1, code: "YER", name: "ريال", symbol: "ر.ي", ratePrimary: 1, rateSecondary: 1, nameSecondary: "فلس" },
      { id: 2, code: "USD", name: "دولار", symbol: "$", ratePrimary: 530, rateSecondary: 1, nameSecondary: "سنت" },
      { id: 3, code: "SAR", name: "سعودي", symbol: "ر.س", ratePrimary: 140, rateSecondary: 1, nameSecondary: "هللة" },
    ],
    accountGroups: [
      { id: 1, legacyId: 1, name: "المشتريات والموردون", category: "purchases", currencyCode: "ريال", sortOrder: 1 },
      { id: 2, legacyId: 2, name: "المبيعات", category: "sales", currencyCode: "ريال", sortOrder: 2 },
      { id: 3, legacyId: 3, name: "العملاء", category: "clients", currencyCode: "ريال", sortOrder: 3 },
      { id: 4, legacyId: 4, name: "حوالات خارجية", category: "transfers", currencyCode: "دولار", sortOrder: 4 },
      { id: 5, legacyId: 5, name: "الصناديق والمحل", category: "shop", currencyCode: "ريال", sortOrder: 5 },
    ],
    accounts: [
      {
        id: "acc_sup_1",
        ownerId: "local-erp-workspace",
        groupId: 1,
        codeNumber: 101,
        name: "مؤسسة البراري للتوريد",
        category: "purchases",
        phone: "770123456",
        creditLimit: 0,
        currency: "ريال",
        isCashAccount: false,
        accountImage: "1",
        sortOrder: 1,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "whatsapp",
        sendMode: "never",
        note: "",
        openingBalance: 120000,
        openingDirection: "credit",
      },
      {
        id: "acc_sup_usd",
        ownerId: "local-erp-workspace",
        groupId: 1,
        codeNumber: 102,
        name: "شركة الخليج للطاقة (دولار)",
        category: "purchases",
        phone: "770654321",
        creditLimit: 0,
        currency: "دولار",
        isCashAccount: false,
        accountImage: "1",
        sortOrder: 2,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "whatsapp",
        sendMode: "never",
        note: "",
        openingBalance: 2400,
        openingDirection: "credit",
      },
      {
        id: "acc_cli_1",
        ownerId: "local-erp-workspace",
        groupId: 3,
        codeNumber: 201,
        name: "شركة الأفق للمبيعات",
        category: "clients",
        phone: "771222333",
        creditLimit: 500000,
        currency: "ريال",
        isCashAccount: false,
        accountImage: "1",
        sortOrder: 3,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "whatsapp",
        sendMode: "never",
        note: "",
        openingBalance: 85000,
        openingDirection: "debit",
      },
      {
        id: "acc_trf_usd",
        ownerId: "local-erp-workspace",
        groupId: 4,
        codeNumber: 401,
        name: "حوالات الصرافة الدولية",
        category: "transfers",
        phone: "772333444",
        creditLimit: 0,
        currency: "دولار",
        isCashAccount: false,
        accountImage: "1",
        sortOrder: 4,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "whatsapp",
        sendMode: "never",
        note: "",
        openingBalance: 1250,
        openingDirection: "debit",
      },
      {
        id: "acc_shop_1",
        ownerId: "local-erp-workspace",
        groupId: 5,
        codeNumber: 301,
        name: "مصروفات المحل",
        category: "shop",
        phone: "",
        creditLimit: 0,
        currency: "ريال",
        isCashAccount: true,
        accountImage: "1",
        sortOrder: 5,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "sms",
        sendMode: "never",
        note: "",
        openingBalance: 45000,
        openingDirection: "credit",
      },
    ],
    cashboxes: [
      { id: 1, name: "الصندوق الرئيسي", details: "الصندوق العام", currencyCode: "ريال", isActive: true, state: 1 },
    ],
    ledger: [
      {
        id: "led_1001",
        ownerId: "local-erp-workspace",
        entryNumber: 1001,
        accountId: "acc_sup_1",
        accountName: "مؤسسة البراري للتوريد",
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "invoice",
        typeLabel: "فاتورة مشتريات",
        payment: "credit",
        direction: "credit",
        amount: 45000,
        currency: "ريال",
        exchangeRate: 1,
        details: "توريد بطاريات ومستلزمات طاقة",
        documentNumber: "INV-1001",
        entryDate: "2026-11-20",
        deleted: false,
        createdAtMs: 1732100000000,
      },
      {
        id: "led_1002",
        ownerId: "local-erp-workspace",
        entryNumber: 1002,
        accountId: "acc_cli_1",
        accountName: "شركة الأفق للمبيعات",
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "voucher",
        typeLabel: "سند قبض",
        payment: "cash",
        direction: "credit",
        amount: 30000,
        currency: "ريال",
        exchangeRate: 1,
        details: "دفعة نقدية من الحساب",
        documentNumber: "V-1002",
        entryDate: "2026-11-21",
        deleted: false,
        createdAtMs: 1732150000000,
      },
      {
        id: "led_1003",
        ownerId: "local-erp-workspace",
        entryNumber: 1003,
        accountId: "acc_sup_usd",
        accountName: "شركة الخليج للطاقة (دولار)",
        counterpartAccountId: "",
        counterpartAccountName: "",
        kind: "invoice",
        typeLabel: "فاتورة مشتريات",
        payment: "credit",
        direction: "credit",
        amount: 600,
        currency: "دولار",
        exchangeRate: 530,
        details: "شحنة ألواح طاقة شمسية",
        documentNumber: "USD-1003",
        entryDate: "2026-11-21",
        deleted: false,
        createdAtMs: 1732160000000,
      },
    ],
    warehouses: [
      { id: "wh_main", ownerId: "local-erp-workspace", codeNumber: 1, name: "المخزن الرئيسي", details: "المستودع المركزي", isDefault: true },
      { id: "wh_branch", ownerId: "local-erp-workspace", codeNumber: 2, name: "مخزن المعرض", details: "", isDefault: false },
    ],
    inventory: [
      { id: "inv_1", ownerId: "local-erp-workspace", sku: "BAT-200", name: "بطارية شمسية 200 أمبير", warehouseId: "wh_main", unit: "حبة", quantity: 14, avgCost: 42000, sellingPrice: 52000, minThreshold: 4 },
      { id: "inv_2", ownerId: "local-erp-workspace", sku: "INV-3K", name: "محول طاقة 3 كيلووات", warehouseId: "wh_branch", unit: "جهاز", quantity: 6, avgCost: 75000, sellingPrice: 92000, minThreshold: 2 },
    ],
    uiPreferences: { themeMode: "light" },
    capabilities: {
      offlineReady: true,
      printingSupported: true,
      pdfExportSupported: true,
      filePickerSupported: true,
      googleDriveConfigured: false,
      whatsappShareSupported: true,
      readOnlyFinancial: true,
    },
    activeRoute: "home",
    activeCurrency: "ريال",
    snapshotVersion: 1,
  };
}

function startOfflineHybridServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const safeRel = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
      const absPath = path.join(hybridDir, safeRel);
      if (!absPath.startsWith(hybridDir) || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(absPath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(absPath).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function saveShot(page, name) {
  const qaPath = path.join(outDir, `${name}.png`);
  const artPath = path.join(artifactDir, `${name}.png`);
  await page.screenshot({ path: qaPath, fullPage: false });
  fs.copyFileSync(qaPath, artPath);
  return qaPath;
}

async function auditLayoutGeometry(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const bodyOverflow = document.body.scrollWidth - document.body.clientWidth;
    const dir = document.documentElement.getAttribute("dir");
    const theme = document.documentElement.getAttribute("data-theme") || "light";

    // Verify no visible interactive button overflows outside viewport horizontally
    const buttons = Array.from(document.querySelectorAll("button, select")).filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= vh;
    });
    const offscreenButtons = buttons
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -2 || r.right > vw + 2;
      })
      .map((el) => ({ text: (el.textContent || "").trim().slice(0, 30), rect: el.getBoundingClientRect().toJSON() }));

    // Check header vs main content overlap
    const headerEl = document.querySelector(".flow-fixed-header");
    const plaqueEl = document.querySelector('[data-testid="home-brand-plaque"]');
    const headerRect = headerEl?.getBoundingClientRect();
    const plaqueRect = plaqueEl?.getBoundingClientRect();
    const headerOverlapsContent = Boolean(headerRect && plaqueRect && plaqueRect.top < headerRect.bottom - 2);

    // Verify RTL scrolling works and bottom nav doesn't permanently block last tile after scrolling
    const scrollEl = document.querySelector('[data-testid="mobile-scroll"]');
    let canScroll = false;
    let lastTileClearsBottomNav = true;
    if (scrollEl) {
      const before = scrollEl.scrollTop;
      scrollEl.scrollTop = scrollEl.scrollHeight;
      canScroll = scrollEl.scrollHeight <= scrollEl.clientHeight || scrollEl.scrollTop > before;
      const footerEl = document.querySelector(".flow-fixed-footer");
      const tiles = Array.from(document.querySelectorAll("[data-home-tile-id]"));
      const lastTile = tiles[tiles.length - 1];
      if (footerEl && lastTile) {
        const fRect = footerEl.getBoundingClientRect();
        const tRect = lastTile.getBoundingClientRect();
        lastTileClearsBottomNav = tRect.bottom <= fRect.top + 8;
      }
      scrollEl.scrollTop = 0;
    }

    return {
      vw,
      vh,
      dir,
      theme,
      docOverflow,
      bodyOverflow,
      offscreenButtonCount: offscreenButtons.length,
      offscreenButtons,
      headerOverlapsContent,
      canScroll,
      lastTileClearsBottomNav,
    };
  });
}

async function run() {
  const { server, port } = await startOfflineHybridServer();
  const hybridUrl = `http://127.0.0.1:${port}/`;
  const fixture = buildSharedFixture();

  const report = {
    timestamp: new Date().toISOString(),
    offlineMode: true,
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    failedRequests: [],
    step7Checks: {},
    viewports: {},
    screenshots: [],
  };

  const preinstalledChrome = "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell";
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(preinstalledChrome) ? { executablePath: preinstalledChrome } : {}),
  });

  try {
    // ------------------------------------------------------------------
    // TEST 10: Bridge Failure Handling (No Flutter Bridge Attached -> Honest Error + Retry)
    // ------------------------------------------------------------------
    const failCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "ar" });
    const failPage = await failCtx.newPage();
    await failPage.goto(hybridUrl, { waitUntil: "networkidle" });
    await failPage.waitForSelector('[data-testid="hybrid-boot-error"]', { timeout: 6000 });
    const failText = await failPage.locator('[data-testid="hybrid-boot-error"]').innerText();
    const hasRetryBtn = await failPage.locator('[data-testid="hybrid-boot-retry"]').isVisible();
    report.step7Checks["10_bridge_failure_honest_error"] =
      failText.includes("تعذر الاتصال بقاعدة البيانات المحلية") && hasRetryBtn;
    report.screenshots.push(await saveShot(failPage, "hybrid-10-bridge-error-393"));
    await failCtx.close();

    // ------------------------------------------------------------------
    // TEST 11: Production Safety — ?mockFlutter=1 MUST NOT activate mock mode in dist/hybrid/
    // ------------------------------------------------------------------
    const prodGuardCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "ar" });
    const prodGuardPage = await prodGuardCtx.newPage();
    await prodGuardPage.goto(`${hybridUrl}?mockFlutter=1`, { waitUntil: "networkidle" });
    await prodGuardPage.waitForSelector('[data-testid="hybrid-boot-error"]', { timeout: 6000 });
    const prodGuardHasDashboard = await prodGuardPage.locator('[data-testid="dashboard-screen"]').isVisible().catch(() => false);
    const prodGuardHasBootError = await prodGuardPage.locator('[data-testid="hybrid-boot-error"]').isVisible();
    report.step7Checks["11_prod_bundle_blocks_mockFlutter_param"] = prodGuardHasBootError && !prodGuardHasDashboard;
    await prodGuardCtx.close();

    // ------------------------------------------------------------------
    // MAIN HYBRID HOME SUITE (External Playwright WebViewCompat `window.NasqoHome` Harness)
    // ------------------------------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "ar" });
    await ctx.addInitScript((initialSnapshot) => {
      const snapshot = JSON.parse(JSON.stringify(initialSnapshot));
      const log = [];
      const listeners = [];
      window.__nasqoMockBridgeLog = log;

      const deliverToWebView = (envelope) => {
        const serialized = JSON.stringify(envelope);
        queueMicrotask(() => {
          if (listeners.length > 0) {
            for (const fn of listeners) {
              try {
                fn({ data: serialized });
              } catch {
                // ignore listener error
              }
            }
          } else if (typeof window.__nasqoHybridReceive === "function") {
            window.__nasqoHybridReceive(serialized);
          }
        });
      };

      window.__nasqoEmitMockHostEvent = (event, payload = {}) => {
        deliverToWebView({
          protocolVersion: "1.0.0",
          kind: "event",
          event,
          payload,
          timestampMs: Date.now(),
        });
      };

      // Simulate Android WebViewCompat `NasqoHome` WebMessageListener object
      window.NasqoHome = {
        addEventListener: (type, listener) => {
          if (type === "message" && typeof listener === "function") {
            listeners.push(listener);
          }
        },
        postMessage: (raw) => {
          let req;
          try {
            req = typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch {
            return;
          }
          log.push({
            action: req.action,
            payload: req.payload,
            requestId: req.requestId,
            timestampMs: Date.now(),
          });

          const respondOk = (data) => {
            deliverToWebView({
              protocolVersion: "1.0.0",
              kind: "response",
              requestId: req.requestId,
              action: req.action,
              ok: true,
              data,
              timestampMs: Date.now(),
            });
          };

          const respondErr = (code, message) => {
            deliverToWebView({
              protocolVersion: "1.0.0",
              kind: "response",
              requestId: req.requestId,
              action: req.action,
              ok: false,
              error: { code, message, retryable: false },
              timestampMs: Date.now(),
            });
          };

          if (req.action === "getSnapshot") {
            respondOk(snapshot);
            return;
          }
          if (req.action === "saveUiPreferences") {
            const prefs = req.payload?.preferences || {};
            snapshot.uiPreferences = { ...(snapshot.uiPreferences || {}), ...prefs };
            respondOk({ saved: true, uiPreferences: snapshot.uiPreferences });
            return;
          }
          if (req.action === "changeCurrency") {
            if (req.payload?.currency) snapshot.activeCurrency = String(req.payload.currency);
            respondOk({ ok: true, currency: snapshot.activeCurrency });
            return;
          }
          if (
            req.action === "navigate" ||
            req.action === "goBack" ||
            req.action === "openInvoice" ||
            req.action === "openVoucher" ||
            req.action === "openAccountStatement" ||
            req.action === "showMessage"
          ) {
            respondOk({ ok: true });
            return;
          }
          respondErr("UNAUTHORIZED_ACTION", "Host rejected financial mutation in Batch 1 read-only mode.");
        },
      };
    }, fixture);

    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") report.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => report.pageErrors.push(String(err)));
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith(hybridUrl) && !url.startsWith("data:") && !url.startsWith("blob:")) {
        report.externalRequests.push(url);
      }
    });
    page.on("requestfailed", (req) => {
      report.failedRequests.push(`${req.url()} (${req.failure()?.errorText || "failed"})`);
    });

    await page.goto(hybridUrl, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 6000 });
    await page.waitForTimeout(400);
    report.bridgeChannelTested = "NasqoHome";

    // TEST 1 & TEST 2: Snapshot received & multi-currency signed balances displayed accurately
    const tableTexts = await page.evaluate(() => {
      const rows = {};
      for (const id of [1, 2, 3, 4, 5]) {
        const el = document.querySelector(`[data-testid="group-row-${id}"]`);
        const sel = document.querySelector(`[data-testid="group-currency-select-${id}"]`);
        rows[id] = {
          text: el ? el.textContent?.replace(/\s+/g, " ").trim() : "",
          currency: sel ? sel.value : "",
        };
      }
      return rows;
    });
    report.step7Checks["01_snapshot_received_and_rendered"] =
      tableTexts[1]?.text.includes("المشتريات والموردون") && tableTexts[4]?.text.includes("حوالات خارجية");
    report.step7Checks["02_signed_balances_with_correct_currencies"] =
      tableTexts[1]?.text.includes("165,000-") &&
      tableTexts[1]?.currency === "ريال" &&
      tableTexts[2]?.text.includes("0") &&
      tableTexts[3]?.text.includes("55,000") &&
      tableTexts[4]?.text.includes("1,250") &&
      tableTexts[4]?.currency === "دولار" &&
      tableTexts[5]?.text.includes("45,000-");

    // TEST 9: Multi-viewport & 130% Font Scaling + Light/Dark screenshots
    report.viewports["393x852_light"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-01-home-393-light"));

    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(250);
    report.viewports["320x640_light"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-02-home-320-light"));

    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(250);
    report.viewports["360x800_light"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-03-home-360-light"));

    // TEST 7: Dark Mode via Flutter host event
    await page.evaluate(() => window.__nasqoEmitMockHostEvent("themeChanged", { mode: "dark" }));
    await page.waitForTimeout(300);
    report.viewports["360x800_dark"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-04-home-360-dark"));

    await page.evaluate(() => window.__nasqoEmitMockHostEvent("themeChanged", { mode: "light" }));
    await page.setViewportSize({ width: 427, height: 952 });
    await page.waitForTimeout(250);
    report.viewports["427x952_light"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-05-home-427-light"));

    // 130% Font Scale at 393px
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "130%";
    });
    await page.waitForTimeout(250);
    report.viewports["393x852_font130"] = await auditLayoutGeometry(page);
    report.screenshots.push(await saveShot(page, "hybrid-06-home-393-font130"));
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.waitForTimeout(200);

    report.step7Checks["07_light_and_dark_themes"] =
      report.viewports["360x800_light"].theme === "light" &&
      report.viewports["360x800_dark"].theme === "dark";
    report.step7Checks["08_zero_external_network_requests"] =
      report.externalRequests.length === 0 && report.failedRequests.length === 0;
    report.step7Checks["09_all_viewports_zero_overflow_and_clean_geometry"] = Object.values(report.viewports).every(
      (v) =>
        v.docOverflow <= 1 &&
        v.bodyOverflow <= 1 &&
        v.offscreenButtonCount === 0 &&
        !v.headerOverlapsContent &&
        v.lastTileClearsBottomNav &&
        v.dir === "rtl",
    );

    // TEST 3: Currency Switch on Home Group Row -> updates balance AND dispatches changeCurrency ONCE
    const currLogBefore = await page.evaluate(
      () => (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "changeCurrency").length,
    );
    await page.locator('[data-testid="group-currency-select-1"]').selectOption("دولار");
    await page.waitForTimeout(250);
    const group1AfterUsd = await page.locator('[data-testid="group-row-1"]').innerText();
    const currEventsAfter = await page.evaluate(() =>
      (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "changeCurrency"),
    );
    report.step7Checks["03_currency_switch_updates_balance_and_notifies_flutter"] =
      group1AfterUsd.includes("3,000-") &&
      currEventsAfter.length === currLogBefore + 1 &&
      currEventsAfter[currEventsAfter.length - 1]?.payload?.currency === "دولار";
    // Restore Group 1 currency back to ريال
    await page.locator('[data-testid="group-currency-select-1"]').selectOption("ريال");
    await page.waitForTimeout(200);

    // TEST 5: Long-press tile -> Pin, Reorder, Color Toggle, Hide, Restore, Save & Reset via Flutter Bridge
    const firstTile = page.locator('[data-testid="home-tile-new-invoice"]');
    const box = await firstTile.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(550);
      await page.mouse.up();
    }
    await page.waitForSelector('[data-testid="home-tiles-edit-bar"]', { timeout: 3000 });
    report.screenshots.push(await saveShot(page, "hybrid-07-tile-edit-mode-393"));

    // Reorder tile first, then pin + toggle color + hide another tile + restore + save
    await page.locator('[data-testid="selected-tile-next-btn"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="selected-tile-pin-btn"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="selected-tile-tone-btn"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="tile-hide-quote"]').dispatchEvent("click");
    await page.waitForTimeout(250);
    const hiddenTrayVisible = await page.locator('[data-testid="home-hidden-tiles-tray"]').isVisible();
    await page.locator('[data-testid="tile-restore-quote"]').dispatchEvent("click");
    await page.waitForTimeout(250);
    await page.locator('[data-testid="home-tiles-save-btn"]').click();
    await page.waitForTimeout(250);

    const prefSaves = await page.evaluate(() =>
      (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "saveUiPreferences"),
    );
    const lastSavedLayout = prefSaves[prefSaves.length - 1]?.payload?.preferences?.homeTileLayout;
    report.step7Checks["05_tile_longpress_pin_color_hide_restore_and_bridge_save"] =
      hiddenTrayVisible &&
      Array.isArray(lastSavedLayout?.pinned) &&
      lastSavedLayout.pinned.includes("new-invoice") &&
      lastSavedLayout.order?.[0] === "new-invoice" &&
      lastSavedLayout.toneOverrides?.["new-invoice"] === "amber" &&
      lastSavedLayout.hidden?.length === 0;

    // Reset back to default layout
    const tileAgain = page.locator('[data-testid="home-tile-new-invoice"]');
    const box2 = await tileAgain.boundingBox();
    if (box2) {
      await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(550);
      await page.mouse.up();
    }
    await page.waitForSelector('[data-testid="home-tiles-reset-btn"]', { timeout: 3000 });
    await page.locator('[data-testid="home-tiles-reset-btn"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="home-tiles-save-btn"]').click();
    await page.waitForTimeout(200);

    // TEST 4: Single Navigation Dispatch + TEST 6: Back & Re-open Page
    const navCountBefore = await page.evaluate(
      () => (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "navigate").length,
    );
    await page.locator('[data-testid="group-row-1"] .smart-col-name button').click();
    await page.waitForTimeout(350);
    const navAfterPush = await page.evaluate(() =>
      (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "navigate"),
    );
    const emittedExactlyOnce =
      navAfterPush.length === navCountBefore + 1 &&
      navAfterPush[navAfterPush.length - 1]?.payload?.route === "purchases";

    // Back via Flutter hardware backPressed -> returns to dashboard
    await page.evaluate(() => window.__nasqoEmitMockHostEvent("backPressed", {}));
    await page.waitForTimeout(300);
    const backToHomeVisible = await page.locator('[data-testid="dashboard-screen"]').isVisible();

    // Press backPressed on root dashboard -> emits goBack with stackDepth: 1
    const goBackBefore = await page.evaluate(
      () => (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "goBack").length,
    );
    await page.evaluate(() => window.__nasqoEmitMockHostEvent("backPressed", {}));
    await page.waitForTimeout(250);
    const goBackAfter = await page.evaluate(() =>
      (window.__nasqoMockBridgeLog || []).filter((e) => e.action === "goBack"),
    );

    // Re-open purchases again cleanly
    await page.locator('[data-testid="group-row-1"] .smart-col-name button').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__nasqoEmitMockHostEvent("backPressed", {}));
    await page.waitForTimeout(250);
    const reopenedAndReturned = await page.locator('[data-testid="dashboard-screen"]').isVisible();

    report.step7Checks["04_single_navigation_event_per_click"] = emittedExactlyOnce;
    report.step7Checks["06_back_and_reopen_works"] =
      backToHomeVisible &&
      reopenedAndReturned &&
      goBackAfter.length === goBackBefore + 1 &&
      goBackAfter[goBackAfter.length - 1]?.payload?.stackDepth === 1;

    const allLogged = await page.evaluate(() => window.__nasqoMockBridgeLog || []);
    report.bridgeActionsObserved = Array.from(new Set(allLogged.map((e) => e.action)));
    await ctx.close();

    // ------------------------------------------------------------------
    // SAME-FIXTURE WEB REFERENCE COMPARISON (Intercepts ONLY Playwright webPage's /api/db)
    // ------------------------------------------------------------------
    const webCtx = await browser.newContext({ viewport: { width: 427, height: 952 }, locale: "ar" });
    const webPage = await webCtx.newPage();
    await webPage.route("**/api/db/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/workspace/")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workspace: fixture.workspace,
            currencies: fixture.currencies,
            accountGroups: fixture.accountGroups,
            accounts: fixture.accounts,
            cashboxes: fixture.cashboxes,
            ledger: fixture.ledger,
            warehouses: fixture.warehouses,
            inventory: fixture.inventory,
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      await webPage.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 10000 });
      await webPage.waitForTimeout(600);
      const quickEnter = webPage.locator('button:has-text("الدخول"), button:has-text("بدء"), [data-testid="enter-local-btn"]').first();
      if (await quickEnter.isVisible().catch(() => false)) {
        await quickEnter.click();
        await webPage.waitForTimeout(600);
      }
      report.screenshots.push(await saveShot(webPage, "ref-05-web-home-427-light"));

      // Dark mode Web reference comparison
      await webPage.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.classList.add("dark");
      });
      await webPage.setViewportSize({ width: 360, height: 800 });
      await webPage.waitForTimeout(300);
      report.screenshots.push(await saveShot(webPage, "ref-04-web-home-360-dark"));
    } catch (err) {
      report.webComparisonWarning = String(err);
    }
    await webCtx.close();
  } finally {
    await browser.close();
    server.close();
  }

  fs.writeFileSync(path.join(outDir, "home-verification-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));

  const failedChecks = Object.entries(report.step7Checks).filter(([, ok]) => !ok);
  if (failedChecks.length > 0 || report.consoleErrors.length > 0 || report.pageErrors.length > 0) {
    console.error("FAILED STAGE 2 CHECKS:", failedChecks);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
