import { expect, test } from "@playwright/test";

test("Android/browser Back returns through nested screens without leaving the app", async ({ page }) => {
  await page.goto("/tests/runtime-fixture.html?fixture=flow");
  await expect(page.getByRole("heading", { name: "Flow root" })).toBeVisible();
  await page.getByRole("button", { name: "Push level 2" }).click();
  await expect(page.getByRole("heading", { name: "Screen stacking works" })).toBeVisible();
  await page.getByRole("button", { name: "Push level 3" }).click();
  await expect(page.getByRole("heading", { name: "Nested view level 3" })).toBeVisible();

  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("heading", { name: "Screen stacking works" })).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("heading", { name: "Flow root" })).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("heading", { name: "Flow root" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("fixture")).toBe("flow");

  // After a root Back, navigation still works in the same mounted app instance.
  await page.getByRole("button", { name: "Push level 2" }).click();
  await expect(page.getByRole("heading", { name: "Screen stacking works" })).toBeVisible();
});


test("hardware Back dismisses an overlay before the underlying screen", async ({ page }) => {
  await page.goto("/tests/runtime-fixture.html?fixture=flow");
  await page.getByRole("button", { name: "Open overlay" }).click();
  await expect(page.getByRole("dialog", { name: "Transient overlay" })).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole("dialog", { name: "Transient overlay" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Flow root" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("fixture")).toBe("flow");
});
