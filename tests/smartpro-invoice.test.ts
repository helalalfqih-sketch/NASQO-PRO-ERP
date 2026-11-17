import assert from "node:assert/strict";
import { test } from "node:test";
import { formatScaled, validateInvoicePosting } from "../server/smartproInvoice.ts";
import { InputError } from "../server/smartproPolicy.ts";

const base = {
  type: "sale",
  requestId: "11111111-1111-4111-8111-111111111111",
  accountId: "18",
  currencyId: "1",
  cashboxId: "2",
  payment: "cash",
  date: "2026-11-17",
  note: "فاتورة اختبار",
  lines: [
    { productId: "34", storeId: "5", quantity: "2.5", price: "1200.25" },
    { productId: "35", storeId: "5", quantity: "1", price: "999" },
  ],
};

test("sale cash invoice maps debit/credit to native SmartPro semantics", () => {
  const invoice = validateInvoicePosting(base);
  assert.equal(invoice.docType, 2);
  assert.equal(invoice.grandTotal, "3999.625");
  assert.equal(invoice.dain, "3999.625");
  assert.equal(invoice.madin, "3999.625");
  assert.equal(invoice.lines[0].total, "3000.625");
  assert.equal(invoice.cashboxId, "2");
});

test("purchase credit invoice maps to native purchase doc type", () => {
  const invoice = validateInvoicePosting({ ...base, type: "purchase", payment: "credit", cashboxId: null });
  assert.equal(invoice.docType, 3);
  assert.equal(invoice.dain, "0");
  assert.equal(invoice.madin, "3999.625");
  assert.equal(invoice.cashboxId, "0");
});

test("cash purchase posts the same settled amount to both sides", () => {
  const invoice = validateInvoicePosting({ ...base, type: "purchase" });
  assert.equal(invoice.dain, invoice.grandTotal);
  assert.equal(invoice.madin, invoice.grandTotal);
});

test("quantity, amount, duplicate product, date and payment validation prevent malformed writes", () => {
  for (const invalid of [
    { ...base, payment: "unknown" },
    { ...base, requestId: "untrusted" },
    { ...base, date: "2026-02-31" },
    { ...base, cashboxId: "0" },
    { ...base, lines: [] },
    { ...base, lines: [{ ...base.lines[0], quantity: "0" }] },
    { ...base, lines: [{ ...base.lines[0], quantity: "-4" }] },
    { ...base, lines: [{ ...base.lines[0], price: "NaN" }] },
    { ...base, lines: [{ ...base.lines[0], quantity: "1.22222" }] },
    { ...base, lines: [base.lines[0], base.lines[0]] },
  ]) assert.throws(() => validateInvoicePosting(invalid), InputError);
});

test("decimal arithmetic is exact up to four decimal places", () => {
  const invoice = validateInvoicePosting({
    ...base,lines: [{ productId: "3", storeId: "5", quantity: "0.1", price: "0.2" }],
  });
  assert.equal(invoice.grandTotal, "0.02");
  assert.equal(formatScaled(1n), "0.0001");
});
