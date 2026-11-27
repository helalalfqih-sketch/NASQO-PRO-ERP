/** Real built hybrid UI, synthetic native Drive responses only. No Google login, database or device. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import { createHybridHomeFixtureSnapshot } from "../src/hybrid/homeFixture";
import { isFinancialMutationCommand, type HybridCommandAction } from "../src/hybrid/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.resolve(process.env.NASQO_HYBRID_BUNDLE || path.join(root, "dist/hybrid"));
const evidence = process.env.NASQO_ACCEPTANCE_OUT || path.join(root, "test-results/hybrid-drive");
fs.mkdirSync(evidence, { recursive: true });
const snapshot = createHybridHomeFixtureSnapshot();
snapshot.workspace!.companyName = "اختبار اصطناعي — ربط Google Drive";
snapshot.workspace!.whatsappPhone = "";
snapshot.userEmail = "synthetic@nasqo.invalid";
snapshot.accounts = [];
snapshot.ledger = [];
snapshot.inventory = [];
snapshot.warehouses = [];
snapshot.capabilities = { ...snapshot.capabilities!, googleDriveConfigured: true, readOnlyFinancial: true };

type ResponsePlan = { code?: string; connected?: boolean; cancelled?: boolean; hold?: boolean; malformedConnected?: string };
function installSyntheticDriveBridge(state: typeof snapshot) {
  const win = window as any;
  const commands: { action: string; operation?: string }[] = [];
  const plans: ResponsePlan[] = [];
  const held: (() => void)[] = [];
  let connected = false;
  let statusError = new URL(location.href).searchParams.get("statusError");
  const defaultCode = new URL(location.href).searchParams.get("driveError") || "GOOGLE_NETWORK_ERROR";
  win.__nasqoDriveFixture = {
    commands, plans,
    release: () => held.splice(0).forEach((reply) => reply()),
    forbidden: [],
  };
  const readOnly = new Set(["getSnapshot", "navigate", "goBack", "showMessage", "saveUiPreferences", "changeCurrency", "saveUiState"]);
  win.NasqoHome = {
    postMessage(raw: string) {
      const request = JSON.parse(raw);
      const operation = request.payload?.operation;
      commands.push({ action: request.action, ...(operation ? { operation } : {}) });
      let data: unknown = { ok: true };
      let code: string | undefined;
      let hold = false;
      if (request.action === "getSnapshot") data = state;
      else if (request.action === "cloudIdentityAction" && operation === "status") data = { configured: true, signedIn: connected };
      else if (request.action === "googleDriveAction") {
        if (operation === "status") {
          code = statusError || undefined;
          statusError = null;
          data = { configured: true, connected };
        } else if (operation === "connect") {
          const plan = plans.shift() || (defaultCode === "success" ? { connected: true } : { code: defaultCode });
          connected = plan.connected === true;
          code = plan.code;
          hold = plan.hold === true;
          data = { configured: true, connected: plan.malformedConnected ?? connected, cancelled: plan.cancelled === true,
            ...(connected ? { email: "synthetic@nasqo.invalid", displayName: "حساب اصطناعي" } : {}) };
        } else if (operation === "listFiles" && connected) data = [{ id: "synthetic-note", name: "synthetic-drive-note.txt", mimeType: "text/plain", size: "12" }];
        else if (operation === "getAbout" && connected) data = { user: { displayName: "حساب اصطناعي", emailAddress: "synthetic@nasqo.invalid" } };
        else if (operation === "disconnect") { connected = false; data = { connected: false }; }
        else code = "UNAUTHORIZED_ACTION";
      } else if (!readOnly.has(request.action)) code = "UNAUTHORIZED_ACTION";
      if (code === "UNAUTHORIZED_ACTION") win.__nasqoDriveFixture.forbidden.push({ action: request.action, operation });
      const reply = () => win.__nasqoHybridReceive?.({ protocolVersion: "1.0.0", kind: "response", requestId: request.requestId,
        action: request.action, ok: !code, ...(code ? { error: { code,
          message: "SYNTHETIC_RAW_PROVIDER_DETAIL https://example.invalid/private?token=synthetic-sensitive-value" } } : { data }), timestampMs: Date.now() });
      if (hold) held.push(reply); else setTimeout(reply, 0);
    },
  };
}
// tsx preserves function names with this helper; the isolated injected script supplies it explicitly.
const fixtureScript = `const __name = (value) => value; (${installSyntheticDriveBridge.toString()})(${JSON.stringify(snapshot).replace(/</g, "\\u003c")});`;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none';";
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  response.setHeader("Content-Security-Policy", csp);
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/__synthetic_drive_bridge.js") {
    response.setHeader("Content-Type", "application/javascript"); response.end(fixtureScript); return;
  }
  const absolute = path.resolve(bundle, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!absolute.startsWith(`${bundle}${path.sep}`) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    response.writeHead(404); response.end(); return;
  }
  response.setHeader("Content-Type", mime[path.extname(absolute)] || "application/octet-stream");
  if (absolute.endsWith("index.html")) response.end(fs.readFileSync(absolute, "utf8").replace("<head>", '<head><script src="/__synthetic_drive_bridge.js"></script>'));
  else fs.createReadStream(absolute).pipe(response);
});
await new Promise<void>((resolve) => server.listen(Number(process.env.NASQO_ACCEPTANCE_PORT || 4188), "0.0.0.0", resolve));
const address = server.address();
assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}`;
console.log(`Synthetic-only built hybrid Drive preview: ${url}`);
if (process.env.NASQO_PREVIEW_ONLY === "1") {
  console.log("Open menu > settings > Google Drive. Default simulated error: GOOGLE_NETWORK_ERROR; use ?driveError=success or another safe error code. CSP blocks external connections; all upload/financial commands are rejected.");
} else {
  const browser = await chromium.launch({ headless: true });
  const results: { name: string; passed: boolean; error?: string; commands?: unknown; screenshot?: string }[] = [];
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  const connectButton = (page: Page) => page.getByTestId("drive-google-signin-btn");
  const gate = (page: Page) => page.getByTestId("gdrive-connect-gate");
  const banner = (page: Page) => page.getByTestId("gdrive-error-banner");
  const queue = (page: Page, ...plans: ResponsePlan[]) => page.evaluate((next) => (window as any).__nasqoDriveFixture.plans.push(...next), plans);
  const connectCount = (page: Page) => page.evaluate(() => (window as any).__nasqoDriveFixture.commands.filter((item: any) => item.action === "googleDriveAction" && item.operation === "connect").length);
  const openDrive = async (page: Page) => {
    await expect(page.getByTestId("dashboard-screen")).toBeVisible();
    await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
    await page.getByRole("complementary", { name: "قائمة نسقو", exact: true }).getByRole("button", { name: "الإعدادات", exact: true }).click();
    await expect(page.getByTestId("system-settings-screen")).toBeVisible();
    await page.getByTestId("settings-top-drive-btn").click();
    await expect(page.getByRole("dialog", { name: "Google Drive السحابي", exact: true })).toBeVisible();
    await expect(gate(page)).toBeVisible();
  };
  const expectDisconnected = async (page: Page) => {
    await expect(gate(page)).toBeVisible();
    await expect(connectButton(page)).toBeEnabled();
    await expect(page.locator(".gdrive-status-strip")).toHaveCount(0);
    await expect(page.getByText("تم ربط حساب Google Drive بنجاح", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("gdrive-backup-now-btn")).toHaveCount(0);
    await expect(banner(page)).not.toContainText("SYNTHETIC_RAW_PROVIDER_DETAIL");
    await expect(banner(page)).not.toContainText("synthetic-sensitive-value");
  };
  const run = async (name: string, action: (page: Page) => Promise<void>, query = "") => {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === url) return route.continue();
      externalRequests.push(new URL(route.request().url()).origin);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    let result: (typeof results)[number] = { name, passed: false };
    try {
      await page.goto(url + query);
      await openDrive(page);
      await action(page);
      const audit = await page.evaluate(() => ({ commands: (window as any).__nasqoDriveFixture.commands, forbidden: (window as any).__nasqoDriveFixture.forbidden }));
      assert.deepEqual(audit.forbidden, [], "Synthetic host must never receive upload/mutation/unknown commands");
      const writes = audit.commands.filter((command: any) => isFinancialMutationCommand(command.action as HybridCommandAction) || command.action === "saveErpData" ||
        (command.action === "googleDriveAction" && !["status", "connect", "disconnect", "listFiles", "getAbout"].includes(command.operation)));
      assert.deepEqual(writes, [], "Drive connection must not upload, restore, delete or post financial operations");
      result = { name, passed: true, commands: audit.commands, screenshot: `${name}.png` };
      console.log(`PASS ${name}`);
    } catch (error) {
      result.error = String(error);
      console.error(`FAIL ${name}: ${error}`);
    } finally {
      await page.screenshot({ path: path.join(evidence, `${name}.png`) });
      results.push(result);
      await context.close();
    }
  };
  try {
    const codes = [
      ["GOOGLE_CONFIG_MISSING", "إعداد ربط Google غير مكتمل"],
      ["GOOGLE_PROVIDER_CONFIG", "GOOGLE_PROVIDER_CONFIG"],
      ["GOOGLE_NETWORK_ERROR", "تحقق من الشبكة"],
      ["GOOGLE_SCOPE_DENIED", "لم تُمنح صلاحية"],
      ["GOOGLE_AUTH_CANCELLED", "أُلغي اختيار حساب"],
      ["DRIVE_API_DISABLED", "DRIVE_API_DISABLED"],
      ["DRIVE_PERMISSION_DENIED", "DRIVE_PERMISSION_DENIED"],
    ] as const;
    const messages = new Set<string>();
    for (const [code, fragment] of codes) await run(`connect-${code.toLowerCase()}`, async (page) => {
      await queue(page, { code });
      await connectButton(page).click();
      await expect(banner(page)).toContainText(fragment);
      await expectDisconnected(page);
      const text = await banner(page).innerText();
      assert(!messages.has(text), "Distinct errors must not collapse into the same generic explanation");
      messages.add(text);
      assert.equal(await connectCount(page), 1);
    });
    await run("cancelled-profile-stays-disconnected", async (page) => {
      await queue(page, { connected: false, cancelled: true });
      await connectButton(page).click();
      await expect(banner(page)).toContainText("أُلغي اختيار حساب");
      await expectDisconnected(page);
      assert.equal(await connectCount(page), 1);
    });
    await run("incomplete-profile-never-announces-success", async (page) => {
      await queue(page, { connected: false });
      await connectButton(page).click();
      await expect(banner(page)).toContainText("GOOGLE_CONNECTION_INCOMPLETE");
      await expectDisconnected(page);
      assert.equal(await connectCount(page), 1);
    });
    await run("malformed-truthy-profile-never-announces-success", async (page) => {
      await queue(page, { malformedConnected: "true" });
      await connectButton(page).click();
      await expect(banner(page)).toContainText("GOOGLE_CONNECTION_INCOMPLETE");
      await expectDisconnected(page);
      assert.equal(await connectCount(page), 1);
    });
    await run("retry-success-requires-connected-true", async (page) => {
      await queue(page, { code: "GOOGLE_NETWORK_ERROR" }, { connected: true });
      await connectButton(page).click();
      await expect(banner(page)).toContainText("تحقق من الشبكة");
      await expectDisconnected(page);
      await connectButton(page).click();
      await expect(gate(page)).toHaveCount(0);
      await expect(page.locator(".gdrive-status-strip")).toContainText("حساب اصطناعي");
      await expect(page.getByTestId("gdrive-files-list")).toContainText("synthetic-drive-note.txt");
      await expect(banner(page)).toHaveCount(0);
      assert.equal(await connectCount(page), 2);
    });
    await run("rapid-double-tap-one-native-connect", async (page) => {
      await queue(page, { connected: true, hold: true });
      await connectButton(page).evaluate((button) => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await expect.poll(() => connectCount(page)).toBe(1);
      await expect(connectButton(page)).toBeDisabled();
      await expect(gate(page)).toBeVisible();
      await expect(page.locator(".gdrive-status-strip")).toHaveCount(0);
      await page.screenshot({ path: path.join(evidence, "double-tap-pending.png") });
      await page.evaluate(() => (window as any).__nasqoDriveFixture.release());
      await expect(page.getByTestId("gdrive-files-list")).toContainText("synthetic-drive-note.txt");
      assert.equal(await connectCount(page), 1, "A second chooser must not be queued after the first completes");
    });
    await run("initial-status-error-is-safe-and-retryable", async (page) => {
      await expect(banner(page)).toContainText("تحقق من الشبكة");
      await expectDisconnected(page);
      assert.equal(await connectCount(page), 0, "Opening Drive must not trigger interactive Google login");
      await queue(page, { connected: true });
      await connectButton(page).click();
      await expect(page.getByTestId("gdrive-files-list")).toContainText("synthetic-drive-note.txt");
      assert.equal(await connectCount(page), 1);
    }, "?statusError=GOOGLE_NETWORK_ERROR");
  } finally {
    const manifest = path.join(bundle, "hybrid-manifest.json");
    fs.writeFileSync(path.join(evidence, "results.json"), JSON.stringify({
      environment: "Chromium production hybrid bundle + synthetic native bridge; NOT Android and NOT a real Google login",
      bundleManifestSha256: fs.existsSync(manifest) ? crypto.createHash("sha256").update(fs.readFileSync(manifest)).digest("hex") : null,
      noDeviceNoProductionData: true, externalRequests, results, browserErrors,
      passed: results.filter((result) => result.passed).length, failed: results.filter((result) => !result.passed).length,
    }, null, 2));
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (results.some((result) => !result.passed) || browserErrors.length || externalRequests.length) process.exitCode = 1;
}
