import type { UnifiedInvoiceDetail } from "../firebase";
import type { DocumentRole, InvoiceLine, LegacyInvoice } from "./analysis";

function roleFromEntry(detail: UnifiedInvoiceDetail): DocumentRole {
  const { entry } = detail;
  if (entry.kind === "return") {
    return entry.direction === "credit" ? "sale_return" : "purchase_return";
  }
  if (entry.kind === "invoice") {
    if (entry.invoiceContent === "free") {
      return entry.direction === "debit" ? "free_sale" : "free_purchase";
    }
    return entry.direction === "debit" ? "sale" : "purchase";
  }
  if (entry.kind === "voucher") return "voucher";
  return "unknown";
}

export function unifiedDetailToLegacyInvoice(detail: UnifiedInvoiceDetail): LegacyInvoice {
  const { entry, lines } = detail;
  const legacyIdNum = Number(entry.legacyRef?.split(":").at(-1) ?? entry.entryNumber ?? 0);
  const id = Number.isFinite(legacyIdNum) && legacyIdNum > 0 ? legacyIdNum : entry.entryNumber;
  const role = roleFromEntry(detail);

  const mappedLines: InvoiceLine[] = lines.map((line) => ({
    ref: `sqlite:${line.id}`,
    table: line.lineKind === "free" ? "invoice_lines(free)" : "invoice_lines(item)",
    id: line.id,
    productId: line.inventoryItemId ? Number(line.inventoryItemId.replace(/\D/g, "")) || null : null,
    productName: line.itemName,
    description: line.details,
    unit: line.unit || "حبة",
    quantity: line.quantity,
    unitPrice: line.price,
    discount: line.discount,
    total: line.total,
    storeId: null,
    kind: line.lineKind === "free" ? "free" : "priced",
  }));

  const linesTotal = mappedLines.length
    ? mappedLines.reduce((sum, l) => sum + (l.total ?? 0), 0)
    : null;
  const warehouses = [...new Set(lines.map((l) => l.warehouseName).filter(Boolean))];
  if (warehouses.length === 0 && entry.warehouseName) warehouses.push(entry.warehouseName);

  const headerDain = entry.rawDain ?? (entry.direction === "debit" ? entry.amount : 0);
  const headerMadin = entry.rawMadin ?? (entry.direction === "credit" ? entry.amount : 0);
  const originalTotal = entry.amount;

  let match: LegacyInvoice["match"] = "no_lines";
  if (mappedLines.length > 0 && linesTotal !== null) {
    match = Math.abs(linesTotal - originalTotal) < 1 ? "matches_header" : "mismatch";
  }

  return {
    id,
    table: "input_move",
    billType: entry.kind === "invoice" ? (entry.direction === "debit" ? 2 : 3) : 1,
    role,
    roleConfirmed: true,
    personId: Number(entry.accountId.replace(/\D/g, "")) || null,
    personName: entry.accountName,
    date: entry.entryDate || null,
    documentNumber: entry.documentNumber,
    details: entry.details,
    currencyId: 1,
    currencyName: entry.currency,
    headerDain,
    headerMadin,
    totalSide: headerDain >= headerMadin ? "dain" : "madin",
    originalTotal,
    linesTotal,
    lines: mappedLines,
    match,
    deleted: entry.deleted,
    postingStatus: "historical_unposted",
    sourceBoxName: "",
    warehouseNames: warehouses,
    sourceTime: null,
    headerDiscount: null,
  };
}
