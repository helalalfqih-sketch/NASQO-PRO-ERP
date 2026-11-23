import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDateSearchTokens,
  extractIsoDate,
  formatDateRangeLabel,
  formatDisplayDate,
  isWithinDateRange,
  parseNormalizedDate,
} from "../src/utils/dateUtils.ts";
import { formatExpiryStatus } from "../src/utils/itemMovementSummary.ts";
import { matchesArabicSearch } from "../src/accounting.ts";

test("parseNormalizedDate cleans legacy midnight timestamp and preserves short-year dates safely", () => {
  const legacy = parseNormalizedDate("07/08/47 12:00:00 ص");
  assert.equal(legacy.display, "07/08/47");
  assert.equal(legacy.isLegacyShortYear, true);
  assert.equal(legacy.iso, null);
  assert.equal(legacy.isValidGregorian, false);

  const isoWithTime = parseNormalizedDate("2026-11-22 12:00:00 م");
  assert.equal(isoWithTime.display, "2026-11-22");
  assert.equal(isoWithTime.iso, "2026-11-22");
  assert.equal(isoWithTime.isValidGregorian, true);

  const dmyArabicDigits = parseNormalizedDate("٢٢/١١/٢٠٢٦");
  assert.equal(dmyArabicDigits.iso, "2026-11-22");
  assert.equal(dmyArabicDigits.display, "2026-11-22");
});

test("formatExpiryStatus never duplicates legacy short-year strings and strips 12:00:00 ص", () => {
  const refToday = Date.UTC(2026, 10, 22); // 2026-11-22

  const legacyStatus = formatExpiryStatus("07/08/47 12:00:00 ص", refToday);
  assert.equal(legacyStatus.displayDate, "07/08/47");
  assert.equal(legacyStatus.statusLabel, "صيغة قديمة");
  assert.equal(legacyStatus.days, null);
  assert.equal(legacyStatus.tone, "none");
  assert.notEqual(legacyStatus.displayDate, legacyStatus.statusLabel);

  const expired = formatExpiryStatus("2026-11-10", refToday);
  assert.equal(expired.displayDate, "2026-11-10");
  assert.equal(expired.tone, "expired");
  assert.equal(expired.days, -12);
  assert.equal(expired.statusLabel, "منتهي منذ 12 يوم");

  const upcoming = formatExpiryStatus("22/12/2026", refToday);
  assert.equal(upcoming.displayDate, "2026-12-22");
  assert.equal(upcoming.tone, "soon");
  assert.equal(upcoming.days, 30);
});

test("isWithinDateRange filters ISO and slash dates accurately", () => {
  assert.equal(isWithinDateRange("2026-11-15", "2026-11-01", "2026-11-30"), true);
  assert.equal(isWithinDateRange("15/11/2026", "2026-11-01", "2026-11-30"), true);
  assert.equal(isWithinDateRange("2026-10-31", "2026-11-01", "2026-11-30"), false);
  assert.equal(isWithinDateRange("2026-12-01", "2026-11-01", "2026-11-30"), false);
  assert.equal(isWithinDateRange("07/08/47 12:00:00 ص", "2026-11-01", "2026-11-30"), false);
  assert.equal(isWithinDateRange("07/08/47 12:00:00 ص", "", ""), true);
  assert.equal(extractIsoDate("2026/05/04"), "2026-05-04");
  assert.equal(formatDisplayDate(""), "—");
});

test("buildDateSearchTokens enables searching by ISO, slash, month, Arabic digits, and legacy date", () => {
  const isoTokens = buildDateSearchTokens("2026-11-22");
  assert.equal(matchesArabicSearch(isoTokens, "22/11/2026"), true);
  assert.equal(matchesArabicSearch(isoTokens, "2026-11"), true);
  assert.equal(matchesArabicSearch(isoTokens, "11/2026"), true);
  assert.equal(matchesArabicSearch(isoTokens, "٢٢/١١/٢٠٢٦"), true);
  assert.equal(matchesArabicSearch(isoTokens, "2026/11/22"), true);
  assert.equal(matchesArabicSearch(isoTokens, "2025-11-22"), false);

  const legacyTokens = buildDateSearchTokens("07/08/47 12:00:00 ص");
  assert.equal(matchesArabicSearch(legacyTokens, "07/08/47"), true);
  assert.equal(matchesArabicSearch(legacyTokens, "٠٧/٠٨/٤٧"), true);
});

test("formatDateRangeLabel formats compact inline labels cleanly with LTR date isolation", () => {
  const stripBidi = (s: string) => s.replace(/[\u2066\u2069]/g, "");
  assert.equal(formatDateRangeLabel("", ""), "");
  assert.equal(stripBidi(formatDateRangeLabel("2026-11-01", "2026-11-22")), "الفترة: 2026-11-01 ← 2026-11-22");
  assert.equal(formatDateRangeLabel("2026-11-01", "2026-11-22").includes("\u20662026-11-01\u2069"), true);
  assert.equal(stripBidi(formatDateRangeLabel("2026-11-22", "2026-11-22")), "التاريخ: 2026-11-22");
  assert.equal(stripBidi(formatDateRangeLabel("2026-11-01", "")), "من 2026-11-01");
  assert.equal(stripBidi(formatDateRangeLabel("", "2026-11-22")), "حتى 2026-11-22");
});

test("SQLite getInventoryMovementsReport filters itemId movements by fromDate and toDate", async () => {
  const {
    closeSqliteDb,
    ensureEmptyWorkspace,
    getInventoryMovementsReport,
    getSqliteDb,
    insertInventoryItemRow,
    insertLedgerEntryRow,
    upsertAccountRow,
    upsertWarehouseRow,
  } = await import("../server/sqliteDb");

  const db = getSqliteDb(":memory:");
  try {
    const uid = "ws-date-filter-test";
    ensureEmptyWorkspace(db, uid);

    const whMain = upsertWarehouseRow(db, uid, {
      name: "المخزن الرئيسي",
      isDefault: true,
      codeNumber: 1,
    });
    const sup = upsertAccountRow(db, uid, {
      name: "مورد التوريد",
      category: "purchases",
      currency: "ريال",
    });
    const cli = upsertAccountRow(db, uid, {
      name: "عميل المبيعات",
      category: "sales",
      currency: "ريال",
    });
    const item = insertInventoryItemRow(db, uid, {
      name: "ابجورة اضاءة شكل قلص",
      warehouseId: whMain.id,
      unit: "حبة",
      quantity: 0,
      avgCost: 1200,
      sellingPrice: 2500,
      expiryDate: "07/08/47 12:00:00 ص",
      currencyCode: "ريال",
    });

    // Purchase on 2026-10-05 (+10)
    insertLedgerEntryRow(db, uid, {
      accountId: sup.id,
      accountName: sup.name,
      entryDate: "2026-10-05",
      kind: "invoice",
      docType: 3,
      typeLabel: "فاتورة شراء",
      direction: "credit",
      amount: 12000,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      lines: [
        {
          inventoryItemId: item.id,
          warehouseId: whMain.id,
          itemName: item.name,
          unit: "حبة",
          unitNum: 1,
          quantity: 10,
          price: 1200,
          total: 12000,
        },
      ],
    });

    // Sale on 2026-11-10 (-3)
    insertLedgerEntryRow(db, uid, {
      accountId: cli.id,
      accountName: cli.name,
      entryDate: "2026-11-10",
      kind: "invoice",
      docType: 2,
      typeLabel: "فاتورة بيع",
      direction: "debit",
      amount: 7500,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      lines: [
        {
          inventoryItemId: item.id,
          warehouseId: whMain.id,
          itemName: item.name,
          unit: "حبة",
          unitNum: 1,
          quantity: 3,
          price: 2500,
          total: 7500,
        },
      ],
    });

    // Sale on 2026-11-22 (-2)
    insertLedgerEntryRow(db, uid, {
      accountId: cli.id,
      accountName: cli.name,
      entryDate: "2026-11-22",
      kind: "invoice",
      docType: 2,
      typeLabel: "فاتورة بيع",
      direction: "debit",
      amount: 5000,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      lines: [
        {
          inventoryItemId: item.id,
          warehouseId: whMain.id,
          itemName: item.name,
          unit: "حبة",
          unitNum: 1,
          quantity: 2,
          price: 2500,
          total: 5000,
        },
      ],
    });

    const allReport = getInventoryMovementsReport(db, uid, { itemId: item.id });
    assert.equal(allReport.movements.length, 3);

    const novOnly = getInventoryMovementsReport(db, uid, {
      itemId: item.id,
      fromDate: "2026-11-01",
      toDate: "2026-11-15",
    });
    assert.equal(novOnly.movements.length, 1);
    assert.equal(novOnly.movements[0]?.date, "2026-11-10");
    assert.equal(novOnly.itemRows[0]?.sellQty, 3);
    assert.equal(novOnly.itemRows[0]?.openingQty, 10);
    assert.equal(novOnly.itemRows[0]?.availableQty, 7);
  } finally {
    closeSqliteDb(db);
  }
});
