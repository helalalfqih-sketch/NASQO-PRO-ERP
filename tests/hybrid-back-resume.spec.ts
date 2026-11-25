import { expect, test, type Page } from "@playwright/test";

async function back(page: Page, requestId: string) {
  const accepted = await page.evaluate((id) => (window as any).__sendHybridBack(id), requestId);
  // Independent human presses occur after the adapter's 180 ms transition gate.
  // The dedicated rapid-press tests deliberately bypass this pause.
  await page.waitForTimeout(200);
  return accepted;
}
async function results(page: Page) {
  return page.evaluate(() => (window as any).__hybridBackLog
    .filter((entry: any) => entry.action === "goBack").map((entry: any) => entry.payload));
}
const current = (page: Page) => page.getByTestId("flow-current");

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/hybrid-back-fixture.html");
  await expect(current(page).getByRole("heading", { name: "Screen 1", exact: true })).toBeVisible();
});

test("one correlated host back returns exactly one screen; home alone authorizes confirmation", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await current(page).getByRole("button", { name: "Push screen 3" }).click();
  await back(page, "native_back_0001");
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  expect((await results(page)).at(-1)).toMatchObject({ requestId: "native_back_0001", outcome: "handled", stackDepth: 2 });
  await back(page, "native_back_0002");
  await expect(current(page).getByRole("heading", { name: "Screen 1", exact: true })).toBeVisible();
  expect((await results(page)).at(-1).outcome).toBe("handled");
  await back(page, "native_back_0003");
  expect((await results(page)).at(-1)).toMatchObject({ requestId: "native_back_0003", outcome: "home", currentRoute: "home", stackDepth: 1 });
  await expect(current(page).getByRole("heading", { name: "Screen 1", exact: true })).toBeVisible();
});

test("nested React overlay is consumed before its menu and supplier route", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await current(page).getByRole("button", { name: "Push screen 3" }).click();
  await current(page).getByRole("button", { name: "Open menu 3" }).click();
  await page.getByRole("button", { name: "Open nested dialog" }).click();
  await back(page, "native_layer_0001");
  await expect(page.getByRole("dialog", { name: "Nested dialog" })).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Supplier options" })).toBeVisible();
  await expect(current(page).getByRole("heading", { name: "Screen 3", exact: true })).toBeVisible();
  await back(page, "native_layer_0002");
  await expect(page.getByRole("menu", { name: "Supplier options" })).toHaveCount(0);
  await expect(current(page).getByRole("heading", { name: "Screen 3", exact: true })).toBeVisible();
  expect((await results(page)).every((result: any) => result.outcome === "handled")).toBe(true);
});

test("re-delivery of one request never pops another screen", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await current(page).getByRole("button", { name: "Push screen 3" }).click();
  await page.evaluate(() => {
    (window as any).__sendHybridBack("native_duplicate_0001");
    (window as any).__sendHybridBack("native_duplicate_0001");
  });
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  await back(page, "native_duplicate_0001");
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  expect((await results(page)).some((result: any) => result.outcome === "home")).toBe(false);
});

test("real account combobox consumes back before its containing form layer", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await current(page).getByRole("button", { name: "Open menu 2" }).click();
  await page.getByRole("button", { name: "Open nested dialog" }).click();
  await page.getByRole("combobox", { name: "Synthetic account picker" }).click();
  await expect(page.getByTestId("synthetic-account-options")).toBeVisible();
  await back(page, "native_picker_0001");
  await expect(page.getByTestId("synthetic-account-options")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Nested dialog" })).toBeVisible();
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  await back(page, "native_picker_0002");
  await expect(page.getByRole("dialog", { name: "Nested dialog" })).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Supplier options" })).toBeVisible();
});

test("two distinct rapid presses do not skip an additional route or request exit", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await current(page).getByRole("button", { name: "Push screen 3" }).click();
  await page.evaluate(() => {
    (window as any).__sendHybridBack("native_rapid_0001");
    (window as any).__sendHybridBack("native_rapid_0002");
  });
  const replies = await results(page);
  expect(replies.some((reply: any) => reply.outcome === "home")).toBe(false);
  await expect(current(page)).toHaveCount(1); // Wait for the outgoing animation to unmount.
  await expect(current(page).getByRole("heading")).toHaveText("Screen 2");
  expect(replies.map((reply: any) => reply.outcome)).toEqual(["handled", "blocked"]);
});

test("uncorrelated host events cannot pop or grant home exit", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  await page.evaluate(() => (window as any).__sendHybridBack());
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  expect(await results(page)).toEqual([]);
});

test("missing native reply transport never leaves the current document", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  const location = page.url();
  await page.evaluate(() => {
    // Stop acknowledging bridge requests. Flow UI must remain functional.
    (window as any).__dropHybridReply = true;
  });
  await back(page, "native_timeout_0001");
  await expect(current(page).getByRole("heading", { name: "Screen 1", exact: true })).toBeVisible();
  await page.waitForTimeout(4200);
  expect(page.url()).toBe(location);
  await expect(current(page).getByRole("button", { name: "Push screen 2" })).toBeVisible();
});

test("visible keyboard consumes back before a route and preserves entered text", async ({ page }) => {
  await current(page).getByRole("button", { name: "Push screen 2" }).click();
  const input = current(page).getByRole("textbox", { name: "Search 2" });
  await input.fill("synthetic supplier query");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 500 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(50);
  await back(page, "native_keyboard_0001");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue("synthetic supplier query");
  await expect(current(page).getByRole("heading", { name: "Screen 2", exact: true })).toBeVisible();
  expect((await results(page)).at(-1)).toMatchObject({ outcome: "handled", stackDepth: 2 });
});
