import test from "node:test";
import assert from "node:assert/strict";
import { composeInvoice, documentContext, type InvoiceLine } from "../src/legacy/analysis";
import { historicalInvoiceDisplayTotals } from "../src/legacy/invoiceView";
import { unifiedDetailToLegacyInvoice } from "../src/legacy/unifiedView";
import type { UnifiedInvoiceDetail } from "../src/firebase";

test("invoice reference and fallback survive Android WebViews without Array.at", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "at")!;
  try {
    delete (Array.prototype as any).at;
    for (const [legacyRef, expected] of [["source:invoice:516", 516], [undefined, 42], ["source:invalid", 42]] as const) {
      const detail = {
        entry: {
          legacyRef, entryNumber: 42, accountId: "synthetic_7", accountName: "Synthetic",
          kind: "invoice", direction: "debit", invoiceContent: "free", amount: 8,
          currency: "YER", entryDate: "2026-01-01", documentNumber: "TEST-42",
          details: "Synthetic only", deleted: false,
        },
        lines: [],
      } as UnifiedInvoiceDetail;
      const invoice = unifiedDetailToLegacyInvoice(detail);
      assert.equal(invoice.id, expected);
      assert.equal(invoice.originalTotal, 8);
      assert.equal(invoice.documentNumber, "TEST-42");
    }
  } finally {
    Object.defineProperty(Array.prototype, "at", descriptor);
  }
});

// The values here come from the screenshot reference, NOT from the actual backup.
test("reference-style invoice summary computes 53 pieces and 348,100 in original line totals", () => {
  const quantities = [1, 1, 1, 1, 49];
  const lineTotals = [49000, 42000, 600, 11500, 245000];
  const lines = quantities.map((quantity, i): InvoiceLine => ({
    ref: `source:${i}`, table: "bill_details", id: i + 1,
    productId: i + 1, productName: `source item ${i + 1}`, description: "",
    unit: i < 2 ? "كيلو" : "حبة", quantity,
    unitPrice: lineTotals[i] / quantity, discount: 0,
    total: lineTotals[i], storeId: 1, kind: "priced",
  }));
  const totals = historicalInvoiceDisplayTotals({ lines, match: "matches_header", originalTotal: 348100 });
  assert.equal(totals.lineCount, 5);
  assert.equal(totals.pieces, 53);
  assert.equal(totals.lineTotal, 348100);
  assert.equal(totals.verifiedHeaderTotal, 348100);
});

test("source-derived invoice fields resolve customer, store, group, original time and amount without inventing payment", () => {
  const tables = {
    customers: [{ id: 10, name: "عميل النسق" }],
    products: [{ id: 20, name: "صنف من النسخة" }],
    stores: [{ id: 3, name: "المخزن الرئيسي" }],
    boxes: [{ id: 2, name: "مجموعة الحسابات" }],
    currencies: [{ id: 1, name: "ريال" }],
  };
  const line = { id: 7, bill_id: 30, prod_id: 20, amount: 2, price: 100, total: 200, store_id: 3, unit: "حبة" };
  const ctx = documentContext(tables, {}, []);
  const invoice = composeInvoice(
    { id: 30, bill: "INV-30", bill_type: 2, per_id: 10, cur: 1,
      cboxid: 2, year: 2026, month: 3, day: 28, hour: 19, mint: 28,
      dain: 200, madin: 0, discount_amount: 0 },
    "input_move", [line], [], ctx,
  );
  assert.equal(invoice.id, 30);
  assert.equal(invoice.personName, "عميل النسق");
  assert.equal(invoice.sourceBoxName, "مجموعة الحسابات");
  assert.deepEqual(invoice.warehouseNames, ["المخزن الرئيسي"]);
  assert.equal(invoice.sourceTime, "19:28");
  assert.equal(invoice.headerDiscount, 0);
  assert.equal(invoice.lines[0].productName, "صنف من النسخة");
  assert.equal(invoice.role, "unknown");
  assert.equal(invoice.roleConfirmed, false);
  assert.equal(historicalInvoiceDisplayTotals(invoice).lineTotal, 200);
  assert.equal(historicalInvoiceDisplayTotals(invoice).verifiedHeaderTotal, null);
});

test("unknown original quantities/totals stay unknown rather than becoming zero", () => {
  const totals = historicalInvoiceDisplayTotals({
    lines: [{ id: 1, ref: "x", table: "bill_details", productId: 1,
      productName: "a", description: "", unit: "حبة", quantity: null, unitPrice: 100,
      discount: null, total: null, storeId: null, kind: "priced" }],
    match: "no_lines", originalTotal: null,
  });
  assert.equal(totals.pieces, null);
  assert.equal(totals.lineTotal, null);
  assert.equal(totals.verifiedHeaderTotal, null);
});
