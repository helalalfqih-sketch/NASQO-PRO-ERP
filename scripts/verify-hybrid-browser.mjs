import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const hybridDir = path.join(rootDir, "dist", "hybrid");
const outDir = path.join(rootDir, "qa", "hybrid-comparison");
const artifactDir = path.join(
  rootDir,
  ".aistudio",
  "artifacts",
  "brain",
  "1a86142a-936d-407e-b821-58c1ebd3e6b0",
  "hybrid_qa",
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

function buildFlutterBridgeInitScript() {
  return () => {
    const log = [];
    const state = {
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
      ],
      accountGroups: [
        { id: 1, name: "المشتريات والموردون", category: "purchases", currencyCode: "ريال", sortOrder: 1 },
        { id: 2, name: "المبيعات", category: "sales", currencyCode: "ريال", sortOrder: 2 },
        { id: 3, name: "العملاء", category: "clients", currencyCode: "ريال", sortOrder: 3 },
        { id: 4, name: "الصناديق والمحل", category: "shop", currencyCode: "ريال", sortOrder: 4 },
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
          sortOrder: 2,
          settlement: false,
          documentNumberRequired: false,
          messageMethod: "whatsapp",
          sendMode: "never",
          note: "",
          openingBalance: 85000,
          openingDirection: "debit",
        },
        {
          id: "acc_shop_1",
          ownerId: "local-erp-workspace",
          groupId: 4,
          codeNumber: 301,
          name: "مصروفات المحل",
          category: "shop",
          phone: "",
          creditLimit: 0,
          currency: "ريال",
          isCashAccount: true,
          accountImage: "1",
          sortOrder: 3,
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
      ],
      warehouses: [
        { id: "wh_main", ownerId: "local-erp-workspace", codeNumber: 1, name: "المخزن الرئيسي", details: "المستودع المركزي", isDefault: true },
        { id: "wh_branch", ownerId: "local-erp-workspace", codeNumber: 2, name: "مخزن المعرض", details: "", isDefault: false },
      ],
      inventory: [
        {
          id: "inv_1",
          ownerId: "local-erp-workspace",
          sku: "BAT-200",
          name: "بطارية شمسية 200 أمبير",
          warehouseId: "wh_main",
          unit: "حبة",
          quantity: 14,
          avgCost: 42000,
          sellingPrice: 52000,
          minThreshold: 4,
        },
        {
          id: "inv_2",
          ownerId: "local-erp-workspace",
          sku: "INV-3K",
          name: "محول طاقة 3 كيلووات",
          warehouseId: "wh_branch",
          unit: "جهاز",
          quantity: 6,
          avgCost: 75000,
          sellingPrice: 92000,
          minThreshold: 2,
        },
      ],
      uiPreferences: { themeMode: "light" },
      capabilities: {
        offlineReady: true,
        printingSupported: true,
        pdfExportSupported: true,
        filePickerSupported: true,
        googleDriveConfigured: true,
        whatsappShareSupported: true,
      },
      snapshotVersion: 1,
    };

    const reply = (requestId, action, ok, data, error) => {
      setTimeout(() => {
        window.__nasqoHybridReceive?.({
          protocolVersion: "1.0.0",
          kind: "response",
          requestId,
          action,
          ok,
          ...(ok ? { data } : { error }),
          timestampMs: Date.now(),
        });
      }, 15);
    };

    window.__nasqoBridgeLog = log;
    window.__nasqoEmitHostEvent = (event, payload = {}) => {
      window.__nasqoHybridReceive?.({
        protocolVersion: "1.0.0",
        kind: "event",
        event,
        payload,
        timestampMs: Date.now(),
      });
    };

    window.NasqoFlutterBridge = {
      postMessage: (raw) => {
        const req = JSON.parse(raw);
        log.push({ action: req.action, requestId: req.requestId, idempotencyKey: req.idempotencyKey, payload: req.payload });
        switch (req.action) {
          case "getSnapshot":
            return reply(req.requestId, req.action, true, state);
          case "createLedgerEntry": {
            const p = req.payload?.payload || {};
            if (p.details === "__FORCE_FAIL__") {
              return reply(req.requestId, req.action, false, undefined, {
                code: "VALIDATION_ERROR",
                message: "رفض Flutter العملية التجريبية بنجاح (اختبار الفشل)",
              });
            }
            const created = {
              id: `led_${Date.now()}`,
              ownerId: "local-erp-workspace",
              entryNumber: 1000 + state.ledger.length + 1,
              accountId: p.accountId || "acc_sup_1",
              accountName: p.accountName || "مؤسسة البراري للتوريد",
              counterpartAccountId: "",
              counterpartAccountName: "",
              kind: p.kind || "voucher",
              typeLabel: p.typeLabel || "سند قبض",
              payment: p.payment || "cash",
              direction: p.direction || "credit",
              amount: Number(p.amount || 0),
              currency: p.currency || "ريال",
              exchangeRate: Number(p.exchangeRate || 1),
              details: p.details || "",
              documentNumber: p.documentNumber || "",
              entryDate: p.entryDate || "2026-11-21",
              deleted: false,
              createdAtMs: Date.now(),
            };
            state.ledger.push(created);
            return reply(req.requestId, req.action, true, { entry: created, snapshot: state });
          }
          case "getInventoryMovementsReport":
            return reply(req.requestId, req.action, true, {
              warehouses: state.warehouses.map((w) => ({ id: w.id, name: w.name })),
              warehouseStocks: [],
              itemRows: state.inventory.map((i, idx) => ({
                id: i.id,
                code: idx + 1,
                name: i.name,
                sku: i.sku,
                unit: i.unit,
                unit2: "",
                count2: null,
                warehouseId: i.warehouseId,
                currencyCode: "ريال",
                buyQty: i.quantity,
                sellQty: 0,
                transferInQty: 0,
                transferOutQty: 0,
                buyTotal: i.quantity * i.avgCost,
                sellTotal: 0,
                availableQty: i.quantity,
                unitCost: i.avgCost,
                remainingValue: i.quantity * i.avgCost,
                profit: 0,
                avgCost: i.avgCost,
                sellingPrice: i.sellingPrice,
                catalogQuantity: i.quantity,
                quantityUnverified: false,
                hasMovement: true,
              })),
              totals: {
                totalSales: 0,
                totalPurchases: 1038000,
                totalProfit: 0,
                totalRemainingValue: 1038000,
                activeItemsCount: 2,
                profitBasis: "avg",
              },
              totalsByCurrency: [
                {
                  currency: "ريال",
                  totalSales: 0,
                  totalPurchases: 1038000,
                  totalProfit: 0,
                  totalRemainingValue: 1038000,
                  totalRemainingQty: 20,
                  activeItemsCount: 2,
                },
              ],
              movements: [],
              anomalies: {
                unverifiedItemsCount: 0,
                unresolvedTransfersCount: 0,
                unresolvedTransfers: [],
                negativeComputedItems: [],
              },
            });
          case "getCashboxesReport":
            return reply(req.requestId, req.action, true, {
              cashboxes: [
                {
                  id: 1,
                  name: "الصندوق الرئيسي",
                  currencyCode: "ريال",
                  isActive: true,
                  totalIn: 30000,
                  totalOut: 0,
                  netBalance: 30000,
                  entryCount: 1,
                },
              ],
              reconciliation: {
                currencyFilter: "الكل",
                fromDate: null,
                toDate: null,
                linkedCashboxesNet: 30000,
                unlinkedCashIn: 0,
                unlinkedCashOut: 0,
                unlinkedCashNet: 0,
                unlinkedCashCount: 0,
                totalCashNet: 30000,
                activeCount: 1,
                inactiveCount: 0,
                totalsByCurrency: [
                  {
                    currency: "ريال",
                    linkedCashboxesNet: 30000,
                    unlinkedCashIn: 0,
                    unlinkedCashOut: 0,
                    unlinkedCashNet: 0,
                    unlinkedCashCount: 0,
                    totalCashNet: 30000,
                  },
                ],
              },
            });
          case "pickFile":
            return reply(req.requestId, req.action, true, { cancelled: true, fileName: "", mimeType: "", sizeBytes: 0, base64Content: "" });
          default:
            return reply(req.requestId, req.action, true, { ok: true });
        }
      },
    };
  };
}

async function saveShot(page, name) {
  const qaPath = path.join(outDir, `${name}.png`);
  const artPath = path.join(artifactDir, `${name}.png`);
  await page.screenshot({ path: qaPath, fullPage: false });
  fs.copyFileSync(qaPath, artPath);
  return qaPath;
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const bodyOverflow = document.body.scrollWidth - document.body.clientWidth;
    const dir = document.documentElement.getAttribute("dir");
    const theme = document.documentElement.getAttribute("data-theme") || "light";
    const fontFamily = getComputedStyle(document.body).fontFamily;
    return {
      docOverflow,
      bodyOverflow,
      dir,
      theme,
      fontFamily,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

async function run() {
  const { server, port } = await startOfflineHybridServer();
  const hybridUrl = `http://127.0.0.1:${port}/`;
  const report = {
    hybridUrl,
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    failedRequests: [],
    viewports: {},
    bridgeActionsVerified: [],
    screenshots: [],
  };

  const preinstalledChrome = "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell";
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(preinstalledChrome) ? { executablePath: preinstalledChrome } : {}),
  });
  try {
    // 1. Verify Hybrid offline bundle across viewports, 130% font scale, Dark mode, and all 5 batches
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "ar" });
    await context.addInitScript(buildFlutterBridgeInitScript());
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") report.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      report.pageErrors.push(String(err));
    });
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
    try {
      await page.waitForSelector('[data-testid="flow-stack"]', { timeout: 6000 });
    } catch (waitErr) {
      const diag = await page.evaluate(() => ({
        bodyText: document.body.innerText.slice(0, 600),
        html: document.body.innerHTML.slice(0, 600),
        bridgeLog: window.__nasqoBridgeLog || [],
        hasReceive: typeof window.__nasqoHybridReceive,
        hybridReady: window.__nasqoHybridReady,
      }));
      console.error("BOOT DIAGNOSTICS:", JSON.stringify({ ...diag, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, failedRequests: report.failedRequests }, null, 2));
      throw waitErr;
    }
    await page.waitForTimeout(450);

    // 393x852 Light Home
    report.viewports["393x852_light"] = await measureOverflow(page);
    report.screenshots.push(await saveShot(page, "01-hybrid-home-393-light"));

    // 320x640 Narrow Screen Light Home
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(300);
    report.viewports["320x640_light"] = await measureOverflow(page);
    report.screenshots.push(await saveShot(page, "02-hybrid-home-320-narrow"));

    // 360x800 Standard Android Dark Mode via Flutter host event
    await page.setViewportSize({ width: 360, height: 800 });
    await page.evaluate(() => window.__nasqoEmitHostEvent("themeChanged", { mode: "dark" }));
    await page.waitForTimeout(350);
    report.viewports["360x800_dark"] = await measureOverflow(page);
    report.screenshots.push(await saveShot(page, "03-hybrid-home-360-dark"));

    // Switch back to Light + 427x952 + 130% Font Scaling
    await page.evaluate(() => {
      window.__nasqoEmitHostEvent("themeChanged", { mode: "light" });
      document.documentElement.style.fontSize = "130%";
    });
    await page.setViewportSize({ width: 427, height: 952 });
    await page.waitForTimeout(350);
    report.viewports["427x952_font130"] = await measureOverflow(page);
    report.screenshots.push(await saveShot(page, "04-hybrid-home-427-font130"));

    // Reset font scale to 100% and 393x852 for Batch 2-5 functional journeys
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(250);

    // Batch 2: Navigate to Supplier Account Statement via Flutter routeChanged + verify interactive ledger posting
    await page.evaluate(() =>
      window.__nasqoEmitHostEvent("routeChanged", { route: "supplier", params: { accountId: "acc_sup_1" } }),
    );
    await page.waitForTimeout(450);
    report.screenshots.push(await saveShot(page, "05-hybrid-supplier-statement-393"));

    // Interactive financial mutation verification:
    // (a) Forced Flutter rejection -> must NOT show false success
    // (b) Valid submission -> must send idempotencyKey & post entry
    report.interactiveChecks = {};
    const fabBtn = page.locator(".statement-fab, .cash-statement-fab, button[aria-label*='عملية'], button[aria-label*='جديد']").first();
    if (await fabBtn.isVisible().catch(() => false)) {
      await fabBtn.click();
      await page.waitForTimeout(300);
      const amountInput = page.locator(".tx-modal input[type='number'], .modal-card input[inputmode='decimal'], .modal-card input[placeholder*='المبلغ']").first();
      const detailsInput = page.locator(".tx-modal textarea, .modal-card textarea, .modal-card input[placeholder*='التفاصيل'], .modal-card input[placeholder*='البيان']").first();
      const saveBtn = page.locator(".tx-modal button:has-text('حفظ'), .modal-card button:has-text('حفظ')").first();
      if ((await amountInput.isVisible().catch(() => false)) && (await saveBtn.isVisible().catch(() => false))) {
        await amountInput.fill("15000");
        if (await detailsInput.isVisible().catch(() => false)) {
          await detailsInput.fill("__FORCE_FAIL__");
        }
        await saveBtn.click();
        await page.waitForTimeout(350);
        const afterFailText = await page.evaluate(() => document.body.innerText);
        report.interactiveChecks.forcedFailureRejectedHonestly =
          afterFailText.includes("رفض Flutter العملية التجريبية") && !afterFailText.includes("تم حفظ العملية بنجاح");

        // Now submit valid voucher
        if (await detailsInput.isVisible().catch(() => false)) {
          await detailsInput.fill("سند قبض اختبار جسر فلاتر");
        }
        await saveBtn.click();
        await page.waitForTimeout(400);
        const ledgerCalls = await page.evaluate(() =>
          (window.__nasqoBridgeLog || []).filter((e) => e.action === "createLedgerEntry"),
        );
        report.interactiveChecks.createLedgerEntryCount = ledgerCalls.length;
        report.interactiveChecks.allHaveIdempotencyKey =
          ledgerCalls.length >= 2 && ledgerCalls.every((c) => typeof c.idempotencyKey === "string" && c.idempotencyKey.length >= 8);
      }
    }

    // Android hardware backPressed returns to dashboard
    await page.evaluate(() => window.__nasqoEmitHostEvent("backPressed", {}));
    await page.waitForTimeout(350);

    // Batch 4: Open Reports Hub via Flutter routeChanged
    await page.evaluate(() => window.__nasqoEmitHostEvent("routeChanged", { route: "reports-hub" }));
    await page.waitForTimeout(400);
    report.screenshots.push(await saveShot(page, "06-hybrid-reports-hub-393"));
    await page.evaluate(() => window.__nasqoEmitHostEvent("backPressed", {}));
    await page.waitForTimeout(300);

    // Batch 4: Open Inventory Movements Report
    await page.evaluate(() => window.__nasqoEmitHostEvent("routeChanged", { route: "inventory-report" }));
    await page.waitForTimeout(450);
    report.screenshots.push(await saveShot(page, "07-hybrid-inventory-report-393"));
    await page.evaluate(() => window.__nasqoEmitHostEvent("backPressed", {}));
    await page.waitForTimeout(300);

    // Batch 5: Open System Settings (4 tabs) + verify full 4th tab label & Dark mode Settings
    await page.evaluate(() => window.__nasqoEmitHostEvent("routeChanged", { route: "settings" }));
    await page.waitForTimeout(400);
    report.screenshots.push(await saveShot(page, "08-hybrid-settings-393"));

    // Verify Settings tab 4 ("قاعدة البيانات") has zero ellipsis truncation & switches cleanly in Dark Mode
    await page.evaluate(() => window.__nasqoEmitHostEvent("themeChanged", { mode: "dark" }));
    await page.waitForTimeout(250);
    const dbTab = page.locator('[data-testid="settings-tabs"] button:has-text("قاعدة البيانات")').first();
    if (await dbTab.isVisible().catch(() => false)) {
      report.interactiveChecks.dbTabNotTruncated = await dbTab.evaluate((el) => el.scrollWidth <= el.clientWidth + 2);
      await dbTab.click();
      await page.waitForTimeout(300);
      report.screenshots.push(await saveShot(page, "10-hybrid-settings-dark-db-393"));
    }

    // Collect logged bridge actions
    const bridgeLog = await page.evaluate(() => window.__nasqoBridgeLog || []);
    report.bridgeActionsVerified = Array.from(new Set(bridgeLog.map((e) => e.action)));
    report.totalBridgeMessages = bridgeLog.length;

    await context.close();

    // 2. Capture Web Reference Screenshot from http://localhost:3000 for Side-by-Side Comparison
    const webCtx = await browser.newContext({ viewport: { width: 427, height: 952 }, locale: "ar" });
    const webPage = await webCtx.newPage();
    try {
      await webPage.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 10000 });
      await webPage.waitForTimeout(500);
      // Enter local workspace if welcome screen is visible
      const quickEnter = webPage.locator('button:has-text("الدخول"), button:has-text("بدء"), [data-testid="enter-local-btn"]').first();
      if (await quickEnter.isVisible().catch(() => false)) {
        await quickEnter.click();
        await webPage.waitForTimeout(700);
      }
      report.screenshots.push(await saveShot(webPage, "09-web-reference-home-427"));
    } catch (err) {
      report.webComparisonWarning = String(err);
    }
    await webCtx.close();
  } finally {
    await browser.close();
    server.close();
  }

  fs.writeFileSync(path.join(outDir, "verification-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
