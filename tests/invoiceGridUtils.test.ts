import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceWhatsAppMessage,
  computeInvoiceLineNet,
  stepInvoiceQuantity,
} from "../src/utils/invoiceGridUtils";

test("stepInvoiceQuantity increments and decrements Arabic/English quantities cleanly with min clamp 1", () => {
  assert.equal(stepInvoiceQuantity("1", 1), "2");
  assert.equal(stepInvoiceQuantity("٢", 1), "3");
  assert.equal(stepInvoiceQuantity("3", -1), "2");
  assert.equal(stepInvoiceQuantity("1", -1), "1");
  assert.equal(stepInvoiceQuantity("", 1), "1");
  assert.equal(stepInvoiceQuantity("0", -1), "1");
  assert.equal(stepInvoiceQuantity("2.5", 1), "3.5");
  assert.equal(stepInvoiceQuantity("1.5", -1), "1");
});

test("computeInvoiceLineNet computes rounded net total and never goes negative", () => {
  assert.equal(computeInvoiceLineNet("2", "2500", "0"), 5000);
  assert.equal(computeInvoiceLineNet("3", "1500", "250"), 4250);
  assert.equal(computeInvoiceLineNet("1", "100", "500"), 0);
  assert.equal(computeInvoiceLineNet("٢", "١٢٥٠", "٥٠"), 2450);
});

test("buildInvoiceWhatsAppMessage formats professional Arabic ERP invoice with items, discounts, and balance", () => {
  const msg = buildInvoiceWhatsAppMessage({
    companyName: "مؤسسة نسقو التجارية",
    typeLabel: "فاتورة بيع آجل",
    entryNumber: 1042,
    entryDate: "2026-11-23",
    accountName: "اندكس ستور",
    payment: "credit",
    currency: "ريال",
    lines: [
      {
        warehouseId: "wh_1",
        itemName: "ابجورة اضاءة شكل قلص",
        unit: "حبة",
        unitNum: 1,
        quantity: 2,
        price: 2500,
        discount: 0,
        total: 5000,
      },
      {
        warehouseId: "wh_1",
        itemName: "كشاف ليد",
        unit: "كرتون",
        unitNum: 2,
        quantity: 1,
        price: 1800,
        discount: 100,
        total: 1700,
      },
    ],
    totalAmount: 6700,
    totalDiscount: 100,
    note: "تسليم فوري",
    updatedBalance: { amount: 51700, tone: "debit" },
  });

  assert.match(msg, /مؤسسة نسقو التجارية/);
  assert.match(msg, /فاتورة بيع آجل رقم #1042/);
  assert.match(msg, /اندكس ستور/);
  assert.match(msg, /1\. ابجورة اضاءة شكل قلص — 2 حبة × 2,500 = \*5,000\*/);
  assert.match(msg, /2\. كشاف ليد — 1 كرتون × 1,800 \(خصم 100\) = \*1,700\*/);
  assert.match(msg, /إجمالي الخصم: 100 ريال/);
  assert.match(msg, /\*الصافي: 6,700 ريال\*/);
  assert.match(msg, /الرصيد بعد الفاتورة: 51,700 ريال \(عليه\)/);
  assert.match(msg, /ملاحظة: تسليم فوري/);
});

test("buildInvoiceWhatsAppMessage handles free-form invoices without lines cleanly", () => {
  const msg = buildInvoiceWhatsAppMessage({
    typeLabel: "فاتورة بيع نقدي",
    entryNumber: 1050,
    entryDate: "2026-11-23",
    accountName: "عميل نقدي",
    payment: "cash",
    currency: "دولار",
    lines: [],
    totalAmount: 250,
    note: "خدمات صيانة",
  });

  assert.doesNotMatch(msg, /\*الأصناف:\*/);
  assert.match(msg, /الدفع: نقدي/);
  assert.match(msg, /\*الصافي: 250 دولار\*/);
  assert.match(msg, /ملاحظة: خدمات صيانة/);
});
