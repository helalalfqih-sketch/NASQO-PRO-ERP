import test from "node:test";
import assert from "node:assert/strict";
import {
  buildItemMovementsLedger,
  classifyItemMovement,
  filterItemMovements,
  formatExpiryStatus,
  summarizeItemMovements,
  type RawItemMovement,
} from "../src/utils/itemMovementSummary";

const SAMPLE_MOVEMENTS: RawItemMovement[] = [
  {
    source: "invoice",
    refId: "inv-1",
    entryNumber: 101,
    date: "2026-10-01",
    label: "فاتورة مشتريات آجل",
    accountName: "مؤسسة الأمل للتوريد",
    warehouseName: "المخزن الرئيسي",
    quantity: 10,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 10,
    effectQty: 10,
    price: 500,
    total: 5000,
    currency: "ريال",
    docType: 3,
    kind: "invoice",
  },
  {
    source: "invoice",
    refId: "inv-2",
    entryNumber: 102,
    date: "2026-10-03",
    label: "فاتورة مشتريات نقد",
    accountName: "شركة النور",
    warehouseName: "المخزن الرئيسي",
    quantity: 5,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 5,
    effectQty: 5,
    price: 10,
    total: 50,
    currency: "دولار",
    docType: 9,
    kind: "invoice",
  },
  {
    source: "invoice",
    refId: "inv-3",
    entryNumber: 105,
    date: "2026-10-05",
    label: "فاتورة مبيعات نقد",
    accountName: "عميل نقدي",
    warehouseName: "المخزن الرئيسي",
    quantity: 4,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 4,
    effectQty: -4,
    price: 750,
    total: 3000,
    currency: "ريال",
    docType: 7,
    kind: "invoice",
  },
  {
    source: "invoice",
    refId: "inv-4",
    entryNumber: 106,
    date: "2026-10-06",
    label: "مردود مبيعات",
    accountName: "عميل نقدي",
    warehouseName: "المخزن الرئيسي",
    quantity: 1,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 1,
    effectQty: 1,
    price: 750,
    total: 750,
    currency: "ريال",
    docType: 4,
    kind: "return",
  },
  {
    source: "invoice",
    refId: "inv-5",
    entryNumber: 108,
    date: "2026-10-07",
    label: "مردود مشتريات",
    accountName: "مؤسسة الأمل للتوريد",
    warehouseName: "المخزن الرئيسي",
    quantity: 2,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 2,
    effectQty: -2,
    price: 500,
    total: 1000,
    currency: "ريال",
    docType: 5,
    kind: "return",
  },
  {
    source: "transfer",
    refId: "tx-12",
    date: "2026-10-09",
    label: "تحويل مخزني",
    accountName: "المخزن الرئيسي ⟵ فرع السوق",
    warehouseName: "فرع السوق",
    quantity: 3,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 3,
    effectQty: 0,
    price: 0,
    total: 0,
  },
];

test("classifyItemMovement identifies structured docTypes and legacy label-only rows", () => {
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[0]).category, "purchase");
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[1]).category, "purchase");
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[2]).category, "sale");
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[3]).category, "sale_return");
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[4]).category, "purchase_return");
  assert.equal(classifyItemMovement(SAMPLE_MOVEMENTS[5]).category, "transfer");

  // Fallback without docType/kind (e.g. legacy/hybrid bridge payload)
  const legacySupply: RawItemMovement = {
    source: "invoice",
    refId: "legacy-1",
    date: "2026-10-10",
    label: "سند توريد مخزني",
    accountName: "مورد",
    warehouseName: "رئيسي",
    quantity: 6,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 6,
    effectQty: 6,
    price: 100,
    total: 600,
  };
  assert.equal(classifyItemMovement(legacySupply).category, "purchase");

  const transferOut: RawItemMovement = {
    source: "transfer",
    refId: "tx-99",
    date: "2026-10-11",
    label: "تحويل مخزني",
    accountName: "المخزن الرئيسي ⟵ فرع 2",
    warehouseName: "المخزن الرئيسي",
    quantity: 2,
    unit: "حبة",
    unitNum: 1,
    baseQuantity: 2,
    effectQty: -2,
    price: 0,
    total: 0,
  };
  const outClass = classifyItemMovement(transferOut);
  assert.equal(outClass.category, "transfer");
  assert.equal(outClass.badgeLabel, "تحويل صادر");

  const adjustment: RawItemMovement = {
    ...transferOut,
    label: "تسوية / جرد مخزني",
    effectQty: 4,
  };
  assert.equal(classifyItemMovement(adjustment).category, "adjustment");
});

test("summarizeItemMovements computes accurate quantities and separates currencies strictly", () => {
  const summary = summarizeItemMovements(SAMPLE_MOVEMENTS, "ريال");

  assert.equal(summary.totalCount, 6);
  assert.equal(summary.purchasesCount, 2);
  assert.equal(summary.purchasesQty, 15);
  assert.deepEqual(summary.purchasesByCurrency, [
    { currency: "ريال", amount: 5000 },
    { currency: "دولار", amount: 50 },
  ]);

  assert.equal(summary.salesCount, 1);
  assert.equal(summary.salesQty, 4);
  assert.deepEqual(summary.salesByCurrency, [{ currency: "ريال", amount: 3000 }]);

  assert.equal(summary.saleReturnsCount, 1);
  assert.equal(summary.saleReturnsQty, 1);
  assert.equal(summary.purchaseReturnsCount, 1);
  assert.equal(summary.purchaseReturnsQty, 2);

  assert.equal(summary.transfersCount, 1);
  assert.equal(summary.transferTotalMovedQty, 3);
  // Net effect: +10 +5 -4 +1 -2 +0 = 10
  assert.equal(summary.netEffectQty, 10);
});

test("buildItemMovementsLedger walks running balance accurately backward from availableQty", () => {
  // Suppose opening balance before these movements was 2, so current available qty = 2 + 10 = 12
  const ledger = buildItemMovementsLedger(SAMPLE_MOVEMENTS, 12);
  assert.equal(ledger.length, 6);

  // Newest first: tx-12 (effect 0) -> balance 12
  assert.equal(ledger[0].refId, "tx-12");
  assert.equal(ledger[0].runningBalance, 12);

  // inv-5 (effect -2) -> balance after inv-5 was 12 (before tx-12 which had 0 effect)
  assert.equal(ledger[1].refId, "inv-5");
  assert.equal(ledger[1].runningBalance, 12);

  // inv-4 (effect +1) -> balance after inv-4 was 14 (14 - 2 = 12)
  assert.equal(ledger[2].refId, "inv-4");
  assert.equal(ledger[2].runningBalance, 14);

  // inv-3 (effect -4) -> balance after inv-3 was 13 (13 + 1 = 14)
  assert.equal(ledger[3].refId, "inv-3");
  assert.equal(ledger[3].runningBalance, 13);

  // inv-2 (effect +5) -> balance after inv-2 was 17 (17 - 4 = 13)
  assert.equal(ledger[4].refId, "inv-2");
  assert.equal(ledger[4].runningBalance, 17);

  // inv-1 (effect +10) -> balance after inv-1 was 12 (opening 2 + 10 = 12, then +5 = 17)
  assert.equal(ledger[5].refId, "inv-1");
  assert.equal(ledger[5].runningBalance, 12);
});

test("filterItemMovements filters by purchases, sales, returns, transfers, and all", () => {
  const ledger = buildItemMovementsLedger(SAMPLE_MOVEMENTS, 10);
  assert.equal(filterItemMovements(ledger, "all").length, 6);
  assert.equal(filterItemMovements(ledger, "purchases").length, 2);
  assert.equal(filterItemMovements(ledger, "sales").length, 1);
  assert.equal(filterItemMovements(ledger, "returns").length, 2);
  assert.equal(filterItemMovements(ledger, "transfers").length, 1);
});

test("formatExpiryStatus classifies expired, due today, expiring soon, valid, and missing dates", () => {
  const refToday = Date.UTC(2026, 10, 23); // 2026-11-23
  assert.equal(formatExpiryStatus("", refToday).tone, "none");
  assert.deepEqual(formatExpiryStatus("2026-11-20", refToday), {
    displayDate: "2026-11-20",
    statusLabel: "منتهي منذ 3 يوم",
    label: "منتهي منذ 3 يوم",
    days: -3,
    tone: "expired",
    isLegacyShortYear: false,
  });
  assert.deepEqual(formatExpiryStatus("2026-11-23", refToday), {
    displayDate: "2026-11-23",
    statusLabel: "ينتهي اليوم",
    label: "ينتهي اليوم",
    days: 0,
    tone: "soon",
    isLegacyShortYear: false,
  });
  assert.deepEqual(formatExpiryStatus("2026-12-10", refToday), {
    displayDate: "2026-12-10",
    statusLabel: "متبقي 17 يوم",
    label: "متبقي 17 يوم",
    days: 17,
    tone: "soon",
    isLegacyShortYear: false,
  });
  assert.equal(formatExpiryStatus("2027-06-01", refToday).tone, "ok");
});

test("SQLite getInventoryMovementsReport returns complete item movements and respects warehouse scoping", async () => {
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
    const uid = "test-item-drilldown-ws";
    ensureEmptyWorkspace(db, uid);

    const whMain = upsertWarehouseRow(db, uid, {
      name: "المخزن الرئيسي",
      isDefault: true,
      codeNumber: 1,
    });
    const whBranch = upsertWarehouseRow(db, uid, {
      name: "فرع السوق",
      isDefault: false,
      codeNumber: 2,
    });

    const sup = upsertAccountRow(db, uid, {
      name: "مؤسسة الأمل للتوريد",
      category: "purchases",
      currency: "ريال",
    });
    const cli = upsertAccountRow(db, uid, {
      name: "عميل التجزئة",
      category: "sales",
      currency: "ريال",
    });

    const item = insertInventoryItemRow(db, uid, {
      name: "ابجورة اضاءة شكل قلص",
      warehouseId: whMain.id,
      unit: "حبة",
      quantity: 0,
      avgCost: 1200,
      sellingPrice: 1800,
      sku: "LAMP-01",
      currencyCode: "ريال",
      expiryDate: "2027-04-07",
    });

    insertLedgerEntryRow(db, uid, {
      accountId: sup.id,
      accountName: sup.name,
      kind: "invoice",
      typeLabel: "فاتورة مشتريات آجل",
      payment: "credit",
      direction: "credit",
      amount: 12000,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryDate: "2026-10-01",
      docType: 3,
      lines: [
        {
          lineKind: "item",
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

    insertLedgerEntryRow(db, uid, {
      accountId: cli.id,
      accountName: cli.name,
      kind: "invoice",
      typeLabel: "فاتورة مبيعات نقد",
      payment: "cash",
      direction: "debit",
      amount: 5400,
      currency: "ريال",
      warehouseId: whMain.id,
      warehouseName: whMain.name,
      invoiceContent: "items",
      entryDate: "2026-10-05",
      docType: 7,
      lines: [
        {
          lineKind: "item",
          inventoryItemId: item.id,
          warehouseId: whMain.id,
          itemName: item.name,
          unit: "حبة",
          unitNum: 1,
          quantity: 3,
          price: 1800,
          total: 5400,
        },
      ],
    });

    const txRes = db
      .prepare(
        `INSERT INTO stock_transfers (workspace_id, transfer_date, transfer_type, from_warehouse_id, to_warehouse_id, details)
         VALUES (?, '2026-10-08', 1, ?, ?, 'تغذية الفرع')`,
      )
      .run(uid, whMain.id, whBranch.id);
    db.prepare(
      `INSERT INTO stock_transfer_lines (workspace_id, transfer_id, inventory_item_id, unit, unit_num, quantity)
       VALUES (?, ?, ?, 'حبة', 1, 4)`,
    ).run(uid, Number(txRes.lastInsertRowid), item.id);

    const allReport = getInventoryMovementsReport(db, uid, { itemId: item.id });
    assert.equal(allReport.movements.length, 3);
    const summaryAll = summarizeItemMovements(allReport.movements, "ريال");
    assert.equal(summaryAll.purchasesQty, 10);
    assert.equal(summaryAll.salesQty, 3);
    assert.equal(summaryAll.transfersCount, 1);
    assert.equal(summaryAll.transferTotalMovedQty, 4);
    assert.deepEqual(summaryAll.purchasesByCurrency, [{ currency: "ريال", amount: 12000 }]);
    assert.deepEqual(summaryAll.salesByCurrency, [{ currency: "ريال", amount: 5400 }]);

    const branchReport = getInventoryMovementsReport(db, uid, {
      itemId: item.id,
      warehouseId: whBranch.id,
    });
    assert.equal(branchReport.movements.length, 1);
    assert.equal(branchReport.movements[0].source, "transfer");
    assert.equal(branchReport.movements[0].effectQty, 4);
    assert.equal(branchReport.movements[0].label, "تحويل وارد");

    const mainReport = getInventoryMovementsReport(db, uid, {
      itemId: item.id,
      warehouseId: whMain.id,
    });
    assert.equal(mainReport.movements.length, 3);
    const txMain = mainReport.movements.find((m) => m.source === "transfer");
    assert.ok(txMain);
    assert.equal(txMain.effectQty, -4);
    assert.equal(txMain.label, "تحويل صادر");
  } finally {
    closeSqliteDb();
  }
});

