/** Derived display metrics only. Does not modify or post the historical invoice. */
import type { LegacyInvoice } from "./analysis";

export type HistoricalInvoiceDisplayTotals = {
  lineCount: number;
  pieces: number | null;
  lineTotal: number | null;
  verifiedHeaderTotal: number | null;
};

export function historicalInvoiceDisplayTotals(
  invoice: Pick<LegacyInvoice, "lines" | "match" | "originalTotal">,
): HistoricalInvoiceDisplayTotals {
  let pieces = 0;
  let lineTotal = 0;
  let validPieces = true;
  let validTotals = true;
  for (const line of invoice.lines) {
    if (line.quantity === null || !Number.isFinite(line.quantity) || line.quantity < 0) validPieces = false;
    else pieces += line.quantity;
    if (line.total === null || !Number.isFinite(line.total)) validTotals = false;
    else lineTotal += line.total;
  }
  const verifiedHeaderTotal = invoice.match === "matches_header" &&
    invoice.originalTotal !== null && Number.isFinite(invoice.originalTotal)
    ? invoice.originalTotal : null;
  return {
    lineCount: invoice.lines.length,
    pieces: validPieces && invoice.lines.length ? pieces : null,
    lineTotal: validTotals && invoice.lines.length ? lineTotal : null,
    verifiedHeaderTotal,
  };
}
