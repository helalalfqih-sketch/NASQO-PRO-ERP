import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePdfSummaryData } from "../src/utils/exportPdf";
import type { LedgerEntryRecord } from "../src/types";

const sampleMultiLineInvoice: LedgerEntryRecord = {
  id: "ent_9001",
  ownerId: "local-erp-workspace",
  accountId: "acc_sales_1",
  accountName: "مؤسسة الأفق التجارية",
  counterpartAccountId: "acc_cash",
  counterpartAccountName: "الصندوق الرئيسي",
  kind: "invoice",
  typeLabel: "فاتورة مبيعات نقدية",
  payment: "cash",
  direction: "debit",
  amount: 8050,
  currency: "ريال",
  exchangeRate: 1,
  details: [
    "شاشة عرض 27 بوصة | 2 حبة × 1500",
    "طابعة فواتير حرارية | 1 حبة × 4000",
    "ضريبة القيمة المضافة 15% (1050 ريال)",
  ].join("\n"),
  documentNumber: "INV-9001",
  warehouseId: "wh_1",
  warehouseName: "المخزن الرئيسي",
  invoiceContent: "items",
  entryNumber: 9001,
  deleted: false,
  entryDate: "2026-11-15",
  dueDate: "2026-11-30",
};

test("buildInvoicePdfSummaryData parses structured item lines and VAT", () => {
  const fixedDate = new Date("2026-11-15T10:30:00.000Z");
  const summary = buildInvoicePdfSummaryData(sampleMultiLineInvoice, {
    companyName: "شركة النخبة للتجارة",
    footerNote: "شكراً لتعاملكم معنا",
    generatedAt: fixedDate,
  });

  assert.equal(summary.entryId, "ent_9001");
  assert.equal(summary.entryNumber, 9001);
  assert.equal(summary.documentNumber, "INV-9001");
  assert.equal(summary.companyName, "شركة النخبة للتجارة");
  assert.equal(summary.paymentLabel, "نقدي");
  assert.equal(summary.directionLabel, "مدين (عليه)");
  assert.equal(summary.statusLabel, "معتمد");
  assert.equal(summary.vatLine, "ضريبة القيمة المضافة 15% (1050 ريال)");
  assert.equal(summary.footerNote, "شكراً لتعاملكم معنا");
  assert.equal(summary.generatedAtIso, "2026-11-15T10:30:00.000Z");
  assert.equal(summary.lines.length, 2);
  assert.deepEqual(summary.lines[0], {
    description: "شاشة عرض 27 بوصة",
    unit: "حبة",
    quantity: "2",
    unitPrice: "1500",
    lineTotal: "3,000",
  });
  assert.deepEqual(summary.lines[1], {
    description: "طابعة فواتير حرارية",
    unit: "حبة",
    quantity: "1",
    unitPrice: "4000",
    lineTotal: "4,000",
  });
});

test("buildInvoicePdfSummaryData handles plain single-line and cancelled invoices", () => {
  const plainEntry: LedgerEntryRecord = {
    id: "ent_1140",
    ownerId: "user_1",
    accountId: "acc_barari",
    accountName: "البراري للتوريد",
    counterpartAccountId: "",
    counterpartAccountName: "",
    kind: "invoice",
    typeLabel: "فاتورة آجلة",
    payment: "credit",
    direction: "credit",
    amount: 3000,
    currency: "ريال",
    exchangeRate: 1,
    details: "",
    documentNumber: "",
    warehouseId: "wh_1",
    warehouseName: "",
    invoiceContent: "none",
    entryNumber: 1140,
    deleted: true,
    entryDate: "2026-11-10",
  };

  const summary = buildInvoicePdfSummaryData(plainEntry);
  assert.equal(summary.companyName, "نسقو برو");
  assert.equal(summary.counterpartName, "—");
  assert.equal(summary.warehouseName, "المخزن الرئيسي");
  assert.equal(summary.documentNumber, "#1140");
  assert.equal(summary.paymentLabel, "آجل");
  assert.equal(summary.directionLabel, "دائن (له)");
  assert.equal(summary.statusLabel, "ملغى");
  assert.equal(summary.lines.length, 1);
  assert.equal(summary.lines[0].description, "فاتورة آجلة");
  assert.equal(summary.lines[0].lineTotal, "3,000");
});

test("free invoice PDF uses saved descriptive lines, quantities and prices", () => {
  const summary = buildInvoicePdfSummaryData({ ...sampleMultiLineInvoice,
    invoiceContent: "free", amount: 19.5, details: "ملاحظة اصطناعية", warehouseId: "", warehouseName: "",
    lines: [
      { itemName: "خدمة اصطناعية أ", unit: "حبة", quantity: 1.5, price: 10, total: 15 },
      { itemName: "بند اصطناعي ب", unit: "حبة", quantity: 2, price: 2.25, total: 4.5 },
    ],
  });
  assert.equal(summary.lines.length, 2);
  assert.equal(summary.lines[0].description, "خدمة اصطناعية أ");
  assert.equal(summary.lines[0].quantity, "1.5");
  assert.equal(summary.lines[0].unitPrice, "10");
  assert.equal(summary.lines[1].lineTotal, "4.5");
  assert.equal(summary.amount, 19.5);
  assert.equal(summary.warehouseName, "—");
});
