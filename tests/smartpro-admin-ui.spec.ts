import { expect, test } from "@playwright/test";

test("local management modules open without exposing central schema controls",async ({page})=>{
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("dashboard-screen")).toBeVisible({timeout:20000});
  await page.getByTestId("home-nav-services").click();
  await expect(page.getByTestId("erp-hub-screen")).toBeVisible();
  await expect(page.getByTestId("erp-mod-btn-erp-hr")).toBeVisible();
  await expect(page.getByTestId("smartpro-center")).toHaveCount(0);
});

test("primary SmartPro mode requires verified sign-in and cannot silently enter local ERP", async ({page}) => {
  test.setTimeout(45000);
  await page.route("**/api/smartpro/status", route =>
    route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({available:true,writeEnabled:true,primary:true})})
  );
  await page.goto("/?autostart=1");
  await expect(page.getByTestId("google-signin-button")).toBeVisible({timeout:20000});
  await expect(page.getByTestId("local-erp-signin-button")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-screen")).toHaveCount(0);
});

test("after central cutover, network failure fails closed without writing legacy workspace", async ({page}) => {
  test.setTimeout(45000);
  await page.addInitScript(() => localStorage.setItem("nasqo-smartpro-primary-active","1"));
  await page.route("**/api/smartpro/status", route => route.abort());
  await page.goto("/?autostart=1");
  await expect(page.getByText("تعذر الاتصال بالإدارة المركزية")).toBeVisible({timeout:20000});
  await expect(page.getByTestId("local-erp-signin-button")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-screen")).toHaveCount(0);
});
