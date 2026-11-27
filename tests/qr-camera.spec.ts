import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function stats(page: Page) {
  return page.evaluate(() => {
    const camera = (window as any).__qrCamera;
    return { calls: camera.calls, plays: camera.plays, stopped: camera.stopped, writes: camera.writes };
  });
}
async function start(page: Page) { await page.getByTestId("qr-start-camera-btn").click(); }

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/qr-camera-fixture.html");
  await expect(page.getByTestId("qr-scanner-modal")).toBeVisible();
});

test("stop and close release the stream; reopening does not start automatically", async ({ page }) => {
  await start(page);
  await page.getByTestId("qr-stop-camera-btn").click();
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject)).toBe(null);
  await start(page);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await expect(page.getByTestId("qr-scanner-modal")).toHaveCount(0);
  await expect.poll(async () => (await stats(page)).stopped).toBe(2);
  await page.getByRole("button", { name: "Open QR fixture" }).click();
  expect((await stats(page)).calls).toHaveLength(2);
});

test("one pending prompt cannot create multiple streams; cancellation stops a late grant", async ({ page }) => {
  await page.evaluate(() => { (window as any).__qrCamera.mode = "pending"; });
  await start(page);
  await expect(page.getByTestId("qr-start-camera-btn")).toBeDisabled();
  await page.getByTestId("qr-start-camera-btn").evaluate((button: HTMLButtonElement) => button.click());
  expect((await stats(page)).calls).toHaveLength(1);
  await page.getByTestId("qr-stop-camera-btn").click();
  await page.evaluate(() => (window as any).__qrCamera.resolve());
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  expect((await stats(page)).plays).toBe(0);
  await expect(page.getByTestId("qr-start-camera-btn")).toBeEnabled();
});

test("closing during a permission prompt stops its later granted stream", async ({ page }) => {
  await page.evaluate(() => { (window as any).__qrCamera.mode = "pending"; });
  await start(page);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.evaluate(() => (window as any).__qrCamera.resolve());
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  expect((await stats(page)).plays).toBe(0);
  await expect(page.getByTestId("qr-scanner-modal")).toHaveCount(0);
});

test("unmount releases an active stream and rejects a later permission grant", async ({ page }) => {
  await start(page);
  await page.evaluate(() => (window as any).__qrUnmount());
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  await page.reload();
  await page.evaluate(() => { (window as any).__qrCamera.mode = "pending"; });
  await start(page);
  await page.evaluate(() => (window as any).__qrUnmount());
  await expect(page.getByTestId("qr-scanner-modal")).toHaveCount(0);
  await page.evaluate(() => (window as any).__qrCamera.resolve());
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  expect((await stats(page)).plays).toBe(0);
});

for (const lifecycle of ["visibilitychange", "pagehide", "nasqo:camera-stop"]) {
  test(`${lifecycle} releases camera and never automatically restarts`, async ({ page }) => {
    await start(page);
    await page.evaluate((eventName) => {
      if (eventName === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event(eventName));
      } else window.dispatchEvent(new Event(eventName));
    }, lifecycle);
    await expect.poll(async () => (await stats(page)).stopped).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect((await stats(page)).calls).toHaveLength(1);
    await expect(page.getByTestId("qr-start-camera-btn")).toBeEnabled();
  });
}

for (const [name, message] of [
  ["NotAllowedError", "الأذونات"], ["NotFoundError", "كاميرا متاحة"], ["NotReadableError", "تطبيق آخر"],
]) {
  test(`${name} explains an actionable recovery and allows explicit retry`, async ({ page }) => {
    await page.evaluate((error) => { Object.assign((window as any).__qrCamera, { mode: "reject", error }); }, name);
    await start(page);
    await expect(page.getByRole("status")).toContainText(message);
    await expect(page.getByTestId("qr-start-camera-btn")).toBeEnabled();
    expect((await stats(page)).plays).toBe(0);
    await page.evaluate(() => { (window as any).__qrCamera.mode = "grant"; });
    await start(page);
    await expect.poll(async () => (await stats(page)).plays).toBe(1);
  });
}

test("video playback failure releases permission-granted tracks", async ({ page }) => {
  await page.evaluate(() => { (window as any).__qrCamera.rejectPlay = true; });
  await start(page);
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByTestId("qr-start-camera-btn")).toBeEnabled();
});

test("manual QR lookup stops the camera and does not write inventory", async ({ page }) => {
  await start(page);
  await page.getByRole("textbox", { name: "إدخال كود QR أو رمز الصنف" }).fill("SYNTHETIC-SKU-ONLY");
  await page.getByTestId("qr-lookup-btn").click();
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  await expect(page.getByTestId("qr-new-item-form")).toBeVisible();
  expect((await stats(page)).writes).toBe(0);
});

test("a granted camera attaches to the mounted video and plays after an explicit click", async ({ page }) => {
  expect((await stats(page)).calls).toEqual([]);
  await start(page);
  await expect.poll(async () => (await stats(page)).plays).toBe(1);
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject !== null)).toBe(true);
  expect((await stats(page)).calls).toEqual([{ video: { facingMode: { ideal: "environment" } }, audio: false }]);
  expect((await stats(page)).writes).toBe(0);
});

test("closing during pending video playback cannot reactivate the camera", async ({ page }) => {
  await page.evaluate(() => { (window as any).__qrCamera.deferPlay = true; });
  await start(page);
  await expect.poll(async () => (await stats(page)).plays).toBe(1);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.evaluate(() => (window as any).__qrCamera.resolvePlay());
  await expect.poll(async () => (await stats(page)).stopped).toBe(1);
  await page.getByRole("button", { name: "Open QR fixture" }).click();
  await expect(page.getByTestId("qr-start-camera-btn")).toBeEnabled();
  expect((await stats(page)).calls).toHaveLength(1);
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.srcObject)).toBe(null);
});

test("a camera QR decode stops scanning without automatically writing inventory", async ({ page }) => {
  await page.evaluate(() => {
    for (const [key, value] of [["readyState", 2], ["videoWidth", 16], ["videoHeight", 16]] as const) {
      Object.defineProperty(HTMLVideoElement.prototype, key, { configurable: true, get: () => value });
    }
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as any;
    (window as any).BarcodeDetector = class {
      async detect() { return [{ rawValue: "SYNTHETIC-CAMERA-DECODE" }]; }
    };
  });
  await start(page);
  await expect(page.getByTestId("qr-new-item-form")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "إدخال كود QR أو رمز الصنف" })).toHaveValue("SYNTHETIC-CAMERA-DECODE");
  expect((await stats(page)).stopped).toBe(1);
  expect((await stats(page)).writes).toBe(0);
});

test("real canvas MediaStream plays and stops under the unchanged hybrid media policy", async ({ page }) => {
  const html = readFileSync(fileURLToPath(new URL("../hybrid.html", import.meta.url)), "utf8");
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  expect(policy).toBeTruthy();
  await page.goto("/tests/qr-camera-fixture.html?realMedia=1");
  await expect(page.getByTestId("qr-scanner-modal")).toBeVisible();
  // Apply the exact production policy before requesting media. Loading the Vite
  // fixture first avoids its development-only inline React refresh preamble.
  // This tests media policy enforcement, not the production bundle bootstrap.
  await page.evaluate((csp) => {
    (window as any).__qrMediaViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (["media-src", "default-src"].includes(event.effectiveDirective)) {
        (window as any).__qrMediaViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      }
    });
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = csp!;
    document.head.append(meta);
  }, policy);
  expect(await page.evaluate(() => HTMLMediaElement.prototype.play.toString())).toContain("[native code]");
  expect(await page.evaluate(() => Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")!.set!.toString())).toContain("[native code]");
  await start(page);
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) =>
    video.srcObject instanceof MediaStream && video.readyState >= 2 && !video.paused && video.currentTime > 0)).toBe(true);
  const playback = await page.locator("video").evaluate((video: HTMLVideoElement) => ({
    width: video.videoWidth, height: video.videoHeight, tracks: (video.srcObject as MediaStream).getTracks().map((track) => track.kind),
  }));
  expect(playback).toEqual({ width: 64, height: 64, tracks: ["video"] });
  await page.getByTestId("qr-stop-camera-btn").click();
  await expect.poll(() => page.evaluate(() => ((window as any).__qrCamera.streams[0] as MediaStream)
    .getTracks().every((track) => track.readyState === "ended"))).toBe(true);
  expect(await page.evaluate(() => (window as any).__qrMediaViolations)).toEqual([]);
  expect((await stats(page)).writes).toBe(0);
  console.log(JSON.stringify({ policy, playback, stopped: true, mediaPolicyViolations: [], environment: "Chromium; canvas.captureStream; native video srcObject/play; not Android" }));
});
