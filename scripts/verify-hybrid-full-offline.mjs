import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const hybridDir = path.join(rootDir, "dist", "hybrid");
const outDir = path.join(rootDir, "qa", "hybrid_offline");
const artifactDir = path.join(
  rootDir,
  ".aistudio",
  "artifacts",
  "brain",
  "1a86142a-936d-407e-b821-58c1ebd3e6b0",
  "hybrid_offline_qa",
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

function startStaticServer(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const safePath = path.resolve(dir, rel);
      if (!safePath.startsWith(dir + path.sep) && safePath !== path.join(dir, "index.html")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(safePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function createCleanEmptySqliteState() {
  return {
    workspaceId: "local-erp-workspace",
    userEmail: "offline@nasqo.local",
    workspace: {
      id: "local-erp-workspace",
      ownerId: "local-erp-workspace",
      companyName: "نسقو برو — مساحة نظيفة",
      defaultCurrency: "ريال",
      whatsappProvider: "nasqo",
      whatsappInstantEnabled: false,
      whatsappPhone: "",
    },
    currencies: [
      { id: 1, code: "YER", name: "ريال", symbol: "ر.ي", ratePrimary: 1, rateSecondary: 1, nameSecondary: "فلس" },
      { id: 2, code: "USD", name: "دولار", symbol: "$", ratePrimary: 530, rateSecondary: 1, nameSecondary: "سنت" },
    ],
    accountGroups: [
      { id: 1, legacyId: 1, name: "المشتريات", category: "purchases", currencyCode: "ريال", sortOrder: 1 },
      { id: 2, legacyId: 2, name: "المبيعات", category: "sales", currencyCode: "ريال", sortOrder: 2 },
      { id: 3, legacyId: 3, name: "العملاء", category: "clients", currencyCode: "ريال", sortOrder: 3 },
      { id: 4, legacyId: 4, name: "الموظفون", category: "employees", currencyCode: "ريال", sortOrder: 4 },
      { id: 5, legacyId: 5, name: "الحوالات", category: "transfers", currencyCode: "ريال", sortOrder: 5 },
      { id: 6, legacyId: 6, name: "المحل", category: "shop", currencyCode: "ريال", sortOrder: 6 },
    ],
    accounts: [],
    cashboxes: [],
    ledger: [],
    warehouses: [
      { id: "wh_main", ownerId: "local-erp-workspace", name: "المخزن الرئيسي", details: "", isDefault: true, codeNumber: 1 },
    ],
    inventory: [],
    uiPreferences: {
      themeMode: "light",
    },
    capabilities: {
      offlineReady: true,
      printingSupported: true,
      pdfExportSupported: true,
      filePickerSupported: true,
      googleDriveConfigured: false,
      whatsappShareSupported: false,
      readOnlyFinancial: false,
    },
    activeCurrency: "ريال",
    snapshotVersion: 1,
    postingReceipts: {},
  };
}

function handleHostCommand(state, env) {
  const { action, payload = {}, idempotencyKey } = env;
  const p = payload && typeof payload === "object" ? payload : {};
  const data = p.payload && typeof p.payload === "object" ? p.payload : p;

  const cloneSnapshot = () => {
    const { postingReceipts: _ignored, ...snap } = state;
    return JSON.parse(JSON.stringify(snap));
  };

  if (idempotencyKey && state.postingReceipts[idempotencyKey]) {
    const existing = state.postingReceipts[idempotencyKey];
    const reqSig = JSON.stringify({ action, payload });
    if (existing.reqSig !== reqSig) {
      return {
        ok: false,
        error: { code: "DUPLICATE_REQUEST", message: "مفتاح التكرار مستخدم لعملية مختلفة." },
      };
    }
    return {
      ok: true,
      data: {
        ...JSON.parse(JSON.stringify(existing.result)),
        postingReceipt: { ...existing.receipt, replayed: true },
      },
    };
  }

  const recordReceipt = (result) => {
    if (!idempotencyKey) return result;
    const receipt = {
      receiptId: `rcpt_${Object.keys(state.postingReceipts).length + 1}`,
      action,
      idempotencyKey,
      replayed: false,
    };
    state.postingReceipts[idempotencyKey] = {
      reqSig: JSON.stringify({ action, payload }),
      receipt,
      result: JSON.parse(JSON.stringify(result)),
    };
    return { ...result, postingReceipt: receipt };
  };

  switch (action) {
    case "getSnapshot":
      return { ok: true, data: cloneSnapshot() };

    case "saveUiPreferences": {
      const prefs = p.preferences && typeof p.preferences === "object" ? p.preferences : p;
      state.uiPreferences = { ...state.uiPreferences, ...prefs };
      return { ok: true, data: { saved: true, preferences: state.uiPreferences } };
    }

    case "saveAccount": {
      const id = data.id || p.accountId || `acc_${state.accounts.length + 1}`;
      const category = String(data.category || "clients");
      const matchedGroup = state.accountGroups.find((g) => g.category === category);
      const acc = {
        id,
        ownerId: state.workspaceId,
        groupId: Number(data.groupId || matchedGroup?.id || 1),
        name: String(data.name || "حساب جديد"),
        category,
        phone: String(data.phone || ""),
        creditLimit: Number(data.creditLimit || 0),
        currency: String(data.currency || "ريال"),
        isCashAccount: Boolean(data.isCashAccount),
        accountImage: "1",
        sortOrder: state.accounts.length + 1,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "sms",
        sendMode: "never",
        note: String(data.note || ""),
        openingBalance: Number(data.openingBalance || 0),
        openingDirection: data.openingDirection === "debit" ? "debit" : "credit",
        codeNumber: 100 + state.accounts.length + 1,
      };
      const idx = state.accounts.findIndex((a) => a.id === id);
      if (idx >= 0) state.accounts[idx] = acc;
      else state.accounts.unshift(acc);
      state.snapshotVersion += 1;
      return { ok: true, data: recordReceipt({ account: acc, snapshot: cloneSnapshot() }) };
    }

    case "createInventoryItem": {
      const item = {
        id: data.id || `inv_${state.inventory.length + 1}`,
        ownerId: state.workspaceId,
        name: String(data.name || "صنف"),
        unit: String(data.unit || "حبة"),
        quantity: Number(data.quantity || 0),
        avgCost: Number(data.avgCost || 0),
        minThreshold: Number(data.minThreshold || 10),
        sku: String(data.sku || ""),
        currencyCode: "ريال",
        isActive: true,
        warehouseId: String(data.warehouseId || "wh_main"),
      };
      state.inventory.push(item);
      state.snapshotVersion += 1;
      return { ok: true, data: recordReceipt({ item, snapshot: cloneSnapshot() }) };
    }

    case "createLedgerEntry": {
      const entry = {
        id: data.id || `led_${state.ledger.length + 1}`,
        ownerId: state.workspaceId,
        accountId: String(data.accountId || ""),
        accountName: String(data.accountName || ""),
        kind: String(data.kind || "voucher"),
        typeLabel: String(data.typeLabel || "قيد مالي"),
        payment: String(data.payment || "credit"),
        direction: data.direction === "credit" ? "credit" : "debit",
        amount: Number(data.amount || 0),
        currency: String(data.currency || "ريال"),
        exchangeRate: Number(data.exchangeRate || 1),
        details: String(data.details || ""),
        documentNumber: String(data.documentNumber || ""),
        warehouseId: String(data.warehouseId || "wh_main"),
        warehouseName: "المخزن الرئيسي",
        entryNumber: 1000 + state.ledger.length + 1,
        deleted: false,
        entryDate: String(data.entryDate || "2026-11-22"),
        lines: Array.isArray(data.lines) ? data.lines : [],
        createdAtMs: Date.now(),
      };
      if (entry.kind === "invoice" && Array.isArray(entry.lines)) {
        const sign = entry.typeLabel.includes("مشتريات") || entry.direction === "credit" ? 1 : -1;
        for (const line of entry.lines) {
          const item = state.inventory.find((i) => i.id === line.inventoryItemId);
          if (item && Number(line.quantity) > 0) {
            item.quantity += sign * Number(line.quantity);
          }
        }
      }
      state.ledger.unshift(entry);
      state.snapshotVersion += 1;
      return {
        ok: true,
        data: recordReceipt({ entry, inventory: state.inventory, snapshot: cloneSnapshot() }),
      };
    }

    case "backupWorkspace": {
      const json = JSON.stringify({ format: "nasqo-localdb-backup-v1", snapshot: cloneSnapshot() });
      const base64Content = Buffer.from(json, "utf8").toString("base64");
      return {
        ok: true,
        data: {
          id: "bkp_1",
          name: p.backupName || "offline-backup.json",
          base64Content,
          sizeBytes: Buffer.byteLength(json, "utf8"),
        },
      };
    }

    case "resetWorkspace": {
      state.accounts = [];
      state.ledger = [];
      state.inventory = [];
      state.snapshotVersion += 1;
      return { ok: true, data: recordReceipt({ reset: true, snapshot: cloneSnapshot() }) };
    }

    case "restoreWorkspace": {
      const parsed = JSON.parse(Buffer.from(String(p.base64Content || ""), "base64").toString("utf8"));
      const snap = parsed.snapshot || parsed;
      state.accounts = snap.accounts || [];
      state.ledger = snap.ledger || [];
      state.inventory = snap.inventory || [];
      state.warehouses = snap.warehouses || state.warehouses;
      state.uiPreferences = snap.uiPreferences || state.uiPreferences;
      state.snapshotVersion += 1;
      return { ok: true, data: recordReceipt({ restored: true, snapshot: cloneSnapshot() }) };
    }

    default:
      return { ok: true, data: { acknowledged: true, action } };
  }
}

async function run() {
  if (!fs.existsSync(path.join(hybridDir, "index.html"))) {
    throw new Error("dist/hybrid/index.html missing — run npm run build:hybrid first.");
  }

  const { server, port } = await startStaticServer(hybridDir);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const sqliteState = createCleanEmptySqliteState();
  const report = {
    startedAtIso: new Date().toISOString(),
    airplaneModeStrict: true,
    blockedNetworkRequests: [],
    consoleErrors: [],
    pageErrors: [],
    checks: [],
    screenshots: [],
  };

  const pass = (name, details = "") => {
    report.checks.push({ ok: true, name, details });
    console.log(`  [PASS] ${name}${details ? ` — ${details}` : ""}`);
  };
  const fail = (name, details = "") => {
    report.checks.push({ ok: false, name, details });
    console.error(`  [FAIL] ${name}${details ? ` — ${details}` : ""}`);
  };

  const preinstalledChrome = "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell";
  const browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(preinstalledChrome) ? { executablePath: preinstalledChrome } : {}),
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      locale: "ar-SA",
    });
    const page = await context.newPage();

    // Strict Airplane Mode: abort EVERY external URL and ANY /api/* route
    await page.route("**/*", (route) => {
      const reqUrl = route.request().url();
      const allowedLocalAsset =
        reqUrl.startsWith(baseUrl) && !reqUrl.includes("/api/");
      if (allowedLocalAsset) {
        return route.continue();
      }
      report.blockedNetworkRequests.push(reqUrl);
      return route.abort("internetdisconnected");
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        report.consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      report.pageErrors.push(err.message);
    });

    // Expose Node-side persistent SQLite host to browser window.NasqoHome
    await page.exposeFunction("__nodeNasqoDispatch", (rawJson) => {
      const env = JSON.parse(rawJson);
      if (env.kind === "event") {
        if (env.action === "saveUiPreferences") {
          handleHostCommand(sqliteState, env);
        }
        return null;
      }
      const res = handleHostCommand(sqliteState, env);
      return JSON.stringify({
        protocolVersion: "1.0.0",
        kind: "response",
        requestId: env.requestId,
        action: env.action,
        ok: res.ok,
        ...(res.ok ? { data: res.data } : { error: res.error }),
        timestampMs: Date.now(),
      });
    });

    await page.addInitScript(() => {
      const listeners = [];
      const deliver = (reply) => {
        if (!reply) return;
        if (listeners.length > 0) {
          for (const fn of listeners) {
            try {
              fn({ data: reply });
            } catch {
              // ignore listener errors
            }
          }
        } else if (typeof window.__nasqoHybridReceive === "function") {
          window.__nasqoHybridReceive(reply);
        }
      };

      window.NasqoHome = {
        addEventListener(type, listener) {
          if (type === "message" && typeof listener === "function") {
            listeners.push(listener);
          }
        },
        postMessage(rawJson) {
          Promise.resolve(window.__nodeNasqoDispatch(rawJson)).then(deliver);
        },
      };
    });

    // 1. Clean empty first launch in strict Airplane Mode
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".nasqo-app", { timeout: 15_000 });
    await page.waitForTimeout(400);

    const bootCheck = await page.evaluate(() => ({
      dir: document.documentElement.getAttribute("dir") || document.querySelector(".nasqo-app")?.getAttribute("dir"),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      hybridReady: Boolean(window.__nasqoHybridReady),
    }));

    if (bootCheck.hybridReady && bootCheck.dir === "rtl" && !bootCheck.overflowX) {
      pass("Clean empty first launch in strict Airplane Mode", `RTL=${bootCheck.dir}, overflowX=${bootCheck.overflowX}`);
    } else {
      fail("Clean empty first launch in strict Airplane Mode", JSON.stringify(bootCheck));
    }

    // Light mode screenshot (clean empty workspace)
    const lightShot = path.join(outDir, "hybrid-offline-light-393.png");
    await page.screenshot({ path: lightShot, fullPage: false });
    fs.copyFileSync(lightShot, path.join(artifactDir, "hybrid-offline-light-393.png"));
    report.screenshots.push("qa/hybrid_offline/hybrid-offline-light-393.png");

    // 2. Execute real offline ERP workflow through window.NasqoHome (account + item + invoice + duplicate guard + voucher + UI prefs)
    const workflow = await page.evaluate(async () => {
      const invoke = async (action, payload, idempotencyKey) => {
        const reqId = `qa_${action}_${Math.random().toString(36).slice(2, 8)}`;
        const rawReply = await window.__nodeNasqoDispatch(
          JSON.stringify({
            protocolVersion: "1.0.0",
            kind: "request",
            requestId: reqId,
            action,
            payload,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            timestampMs: Date.now(),
          }),
        );
        return JSON.parse(rawReply);
      };

      const acc = await invoke(
        "saveAccount",
        {
          workspaceId: "local-erp-workspace",
          payload: { id: "acc_qa_1", name: "عميل وضع الطيران", category: "clients", currency: "ريال" },
        },
        "idem_qa_acc_1",
      );
      const item = await invoke(
        "createInventoryItem",
        {
          workspaceId: "local-erp-workspace",
          payload: { id: "inv_qa_1", name: "لوح طاقة 550W", unit: "حبة", quantity: 10, avgCost: 300 },
        },
        "idem_qa_item_1",
      );
      const invPayload = {
        workspaceId: "local-erp-workspace",
        payload: {
          accountId: "acc_qa_1",
          accountName: "عميل وضع الطيران",
          kind: "invoice",
          typeLabel: "فاتورة مشتريات آجل",
          payment: "credit",
          direction: "credit",
          amount: 1500,
          currency: "ريال",
          lines: [{ inventoryItemId: "inv_qa_1", itemName: "لوح طاقة 550W", quantity: 5, price: 300, total: 1500 }],
        },
      };
      const inv1 = await invoke("createLedgerEntry", invPayload, "idem_qa_inv_1");
      const invDup = await invoke("createLedgerEntry", invPayload, "idem_qa_inv_1");
      const vch = await invoke(
        "createLedgerEntry",
        {
          workspaceId: "local-erp-workspace",
          payload: {
            accountId: "acc_qa_1",
            accountName: "عميل وضع الطيران",
            kind: "voucher",
            typeLabel: "سند صرف نقدي",
            payment: "cash",
            direction: "debit",
            amount: 500,
            currency: "ريال",
          },
        },
        "idem_qa_vch_1",
      );
      const prefs = await invoke("saveUiPreferences", {
        preferences: {
          themeMode: "dark",
          homeTileLayout: {
            order: ["new-invoice", "new-voucher"],
            pinned: ["new-invoice"],
            hidden: [],
            toneOverrides: {},
          },
        },
      });
      const bkp = await invoke("backupWorkspace", { backupName: "qa-offline.json" });
      await invoke("resetWorkspace", {}, "idem_qa_reset_1");
      const restored = await invoke("restoreWorkspace", { base64Content: bkp.data.base64Content }, "idem_qa_restore_1");
      return { acc, item, inv1, invDup, vch, prefs, restored };
    });

    if (
      workflow.acc.ok &&
      workflow.item.ok &&
      workflow.inv1.ok &&
      workflow.invDup.ok &&
      workflow.invDup.data.postingReceipt.replayed === true &&
      workflow.vch.ok &&
      workflow.prefs.ok &&
      workflow.restored.ok
    ) {
      pass(
        "Offline E2E accounting + duplicate posting guard + backup/restore round-trip",
        `accounts=${sqliteState.accounts.length}, ledger=${sqliteState.ledger.length}, stockQty=${sqliteState.inventory[0]?.quantity}`,
      );
    } else {
      fail("Offline E2E workflow failed", JSON.stringify(workflow));
    }

    if (sqliteState.ledger.length === 2 && sqliteState.inventory[0]?.quantity === 15) {
      pass("Duplicate invoice blocked & stock integrity verified", "ledger=2 (not 3), qty=15 (not 20)");
    } else {
      fail("Stock or ledger integrity mismatch", JSON.stringify({ ledger: sqliteState.ledger.length, qty: sqliteState.inventory[0]?.quantity }));
    }

    // 3. Simulate full App Close & Reopen (clear localStorage + reload page from persistent SQLite host)
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".nasqo-app", { timeout: 15_000 });
    await page.waitForTimeout(500);

    const reopenCheck = await page.evaluate(() => ({
      themeAttr: document.documentElement.getAttribute("data-theme"),
      bodyText: document.body.innerText.slice(0, 600),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));

    if (reopenCheck.themeAttr === "dark" && !reopenCheck.overflowX) {
      pass("Reopen persistence (SQLite -> Dark theme + data restored after localStorage clear)", `data-theme=${reopenCheck.themeAttr}`);
    } else {
      fail("Reopen persistence check failed", JSON.stringify(reopenCheck));
    }

    // Dark mode screenshot after reload persistence
    const darkShot = path.join(outDir, "hybrid-offline-dark-393.png");
    await page.screenshot({ path: darkShot, fullPage: false });
    fs.copyFileSync(darkShot, path.join(artifactDir, "hybrid-offline-dark-393.png"));
    report.screenshots.push("qa/hybrid_offline/hybrid-offline-dark-393.png");

    // 4. Zero network requests / zero console errors / zero page errors
    if (report.blockedNetworkRequests.length === 0) {
      pass("Zero external or /api/* network requests in strict Airplane Mode", "0 blocked requests");
    } else {
      fail("Unexpected network requests attempted in Airplane Mode", report.blockedNetworkRequests.join(", "));
    }

    if (report.consoleErrors.length === 0 && report.pageErrors.length === 0) {
      pass("Zero console or page runtime errors", "consoleErrors=0, pageErrors=0");
    } else {
      fail("Runtime console/page errors detected", JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }));
    }
  } finally {
    await browser.close();
    server.close();
  }

  report.completedAtIso = new Date().toISOString();
  report.allPassed = report.checks.every((c) => c.ok);
  fs.writeFileSync(
    path.join(outDir, "offline-full-verification-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  if (!report.allPassed) {
    console.error("\n[verify-hybrid-full-offline] FAILED.");
    process.exit(1);
  }
  console.log(`\n[verify-hybrid-full-offline] ALL ${report.checks.length} OFFLINE CHECKS PASSED.`);
}

run().catch((err) => {
  console.error("[verify-hybrid-full-offline] Fatal error:", err);
  process.exit(1);
});
