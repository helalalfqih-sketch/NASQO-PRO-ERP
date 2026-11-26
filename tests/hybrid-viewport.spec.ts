import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 320, height: 616 }, { width: 616, height: 320 }]) {
  test(`viewport and footer remain usable without dvh at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // WebView 83 ignores dynamic viewport units. Invalidate only those values,
    // retaining the actual stylesheet and any preceding compatible fallback.
    await page.route("**/src/hybrid/hybrid.css", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/(\d+(?:\.\d+)?)dvh/g, "$1unsupported") });
    });
    await page.goto("/tests/hybrid-viewport-fixture.html");
    const bounds = await page.getByTestId("hybrid-viewport").boundingBox();
    expect(bounds?.height).toBe(viewport.height);
    await expect(page.getByRole("heading", { name: "Synthetic home" })).toBeVisible();
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic settings" })).toBeVisible();
  });
}
