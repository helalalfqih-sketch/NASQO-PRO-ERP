import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

test.use({ viewport: { width: 1400, height: 1100 }, channel: "chrome" });

test.describe("NASQO Pro Legacy SQLite Center E2E", () => {
  test.setTimeout(120_000);

  test("imports real SQLite DB, exports exact SHA-256 copy, stages 26,001 rows, posts balanced vouchers, checks customer statement & inventory, and persists across reload", async ({
    page,
  }) => {
    const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
    const expectedSha = crypto
      .createHash("sha256")
      .update(fs.readFileSync("backup_2026.11.08_03.49.26.back"))
      .digest("hex");

    await page.addInitScript(() => {
      window.localStorage.setItem("nasqo-local-session-active", "1");
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });

    // 1. Open Dashboard Add Menu (+) and launch Migration Center
    await page.getByLabel("إضافة", { exact: true }).click();
    const menu = page.getByTestId("dashboard-add-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "مركز استيراد وترحيل قواعد البيانات", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "مركز استيراد وترحيل قواعد البيانات" })).toBeVisible();

    // 2. Upload real SQLite file (`backup_2026.11.08_03.49.26.back` == `nasqo_exact_original.sqlite`)
    await dialog.locator("#legacy-center-sqlite-input").setInputFiles("backup_2026.11.08_03.49.26.back");

    // Verify 22 tables, 26,001 rows, integrity ok
    await expect(
      dialog.getByText(/تم فتح قاعدة البيانات بنجاح: 22 جدولًا و 26,001 سجل \(السلامة: ok\)/),
    ).toBeVisible({ timeout: 30_000 });

    // 3. Mode A: Save exact original replica & verify duplicate prevention + byte-for-byte export SHA-256
    await dialog.getByRole("button", { name: "أ. حفظ نسخة أصلية مطابقة" }).click();
    await expect(dialog.getByText(/تم حفظ النسخة الأصلية المطابقة بنجاح \(1,585,152 بايت\)/)).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByRole("button", { name: "أ. حفظ نسخة أصلية مطابقة" }).click();
    await expect(dialog.getByText(/النسخة الأصلية محفوظة مسبقًا في المخزن المستقل/)).toBeVisible({ timeout: 15_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "تصدير SQLite الأصلية" }).click(),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const downloadedSha = crypto.createHash("sha256").update(fs.readFileSync(downloadPath!)).digest("hex");
    expect(downloadedSha).toBe(expectedSha);

    // 4. Mode B: Import full historical archive (26,001 rows into IndexedDB)
    await dialog.getByRole("button", { name: /ب\. استيراد الأرشيف التاريخي/ }).click();
    await expect(dialog.getByText(/تم استيراد كامل الأرشيف التاريخي/)).toBeVisible({ timeout: 45_000 });

    // 5. Mode C: Migrate master data (125 accounts, 5 warehouses, 1,402 products)
    await dialog.getByRole("button", { name: /ج\. ترحيل العملاء والأصناف والمخازن/ }).click();
    await expect(dialog.getByText(/تم ترحيل البيانات الأساسية/)).toBeVisible({ timeout: 25_000 });

    // 6. Test policy-gated balanced voucher posting (6 groups = 12 balanced entries; 2 unbalanced groups rejected)
    await dialog.getByRole("button", { name: "المطابقة والترحيل المحاسبي" }).click();
    await dialog.getByRole("radio", { name: /dain = دائن/ }).check();
    await dialog.getByRole("checkbox", { name: /أوافق على ترحيل القيود المتوازنة/ }).check();
    await dialog.getByRole("button", { name: "ترحيل القيود المعتمدة المتوازنة فقط" }).click();
    await expect(dialog.getByText(/تم ترحيل 12 قيدًا متوازنًا فقط/)).toBeVisible({ timeout: 20_000 });

    // 7. Switch to Reconciliation & Historical Invoices tab and open a multi-line invoice
    await dialog.getByRole("button", { name: "مطابقة القيود والفواتير" }).click();
    await dialog.getByRole("button", { name: /الفواتير التاريخية/ }).click();
    await dialog.getByRole("button", { name: "فتح البنود" }).first().click();

    const detail = dialog.getByTestId("legacy-invoice-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByText(/فاتورة تاريخية غير مُرحّلة للأستاذ العام/)).toBeVisible();

    // Close Migration Center
    await dialog.getByRole("button", { name: "✕" }).click();

    // 8. Reload the page and verify IndexedDB persistence + live screens integration
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 20_000 });

    // 9. Search for migrated customer "حسن مثنى" and open statement + historical archive section
    await page.getByLabel("بحث", { exact: true }).click();
    const picker = page.getByTestId("account-picker-modal");
    await expect(picker).toBeVisible();
    await picker.getByTestId("account-picker-search-input").fill("حسن مثنى");
    await page.keyboard.press("Escape");
    const custOption = picker.getByRole("option", { name: "حسن مثنى", exact: true });
    await expect(custOption).toBeVisible({ timeout: 10_000 });
    await custOption.click();
    await picker.getByRole("button", { name: "موافق", exact: true }).click();

    await expect(page.getByTestId("supplier-screen")).toBeVisible();
    const custArchive = page.getByTestId("customer-legacy-archive-section");
    await expect(custArchive).toBeVisible({ timeout: 15_000 });
    await custArchive.getByRole("button", { name: /عرض الحركات/ }).click();
    await custArchive.getByRole("button", { name: "فتح البنود" }).first().click();
    await expect(page.getByTestId("customer-legacy-invoice-detail")).toBeVisible({ timeout: 10_000 });

    // Navigate back to dashboard
    await page.getByLabel("رجوع", { exact: true }).click();
    await expect(page.getByTestId("dashboard-screen")).toBeVisible();

    // 10. Open Inventory Report via Drawer, search for imported product, and verify "بحاجة إلى تسوية"
    await page.getByLabel("فتح القائمة", { exact: true }).click();
    const drawer = page.getByLabel("قائمة نسقو", { exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "الأصناف والمخزون", exact: true }).click();
    await expect(page.getByTestId("inventory-report-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("البحث في الأصناف").fill("صفارة شكمان");
    await page.keyboard.press("Escape");
    await expect(page.getByText("صفارة شكمان سيارة ملون")).toBeVisible();
    await expect(page.getByText("بحاجة إلى تسوية").first()).toBeVisible();
  });
});
