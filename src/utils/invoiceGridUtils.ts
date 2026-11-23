import { formatAmount, parseArabicNumber } from "../accounting";
import type { CurrencyCode, InvoiceLineInput } from "../types";
import { computeExactLineNet } from "./moneyMath";

/**
 * Steps an invoice line quantity by +1 or -1 safely.
 * Clamps downward steps at 1 (minimum standard invoice unit step) while
 * preserving decimal precision when stepping fractional values.
 */
export function stepInvoiceQuantity(current: string, delta: number): string {
  const parsed = parseArabicNumber(current);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  let next: number;
  if (base === 0 && delta > 0) {
    next = 1;
  } else {
    next = Math.round((base + delta) * 1000) / 1000;
    if (next < 1) next = 1;
  }
  return Number.isInteger(next) ? String(next) : String(next);
}

/**
 * Computes net line total = max(0, quantity * price - discount) rounded to 2 decimals.
 */
export function computeInvoiceLineNet(
  quantity: string | number,
  price: string | number,
  discount: string | number = 0,
): number {
  const q = Math.max(0, parseArabicNumber(quantity));
  const p = Math.max(0, parseArabicNumber(price));
  const d = Math.max(0, parseArabicNumber(discount));
  return computeExactLineNet(q, p, d, 2);
}

export interface InvoiceWhatsAppMessageInput {
  companyName?: string;
  typeLabel: string;
  entryNumber: number;
  entryDate: string;
  accountName: string;
  payment: "cash" | "credit";
  currency: CurrencyCode;
  lines: readonly InvoiceLineInput[];
  totalAmount: number;
  totalDiscount?: number;
  note?: string;
  updatedBalance?: {
    amount: number;
    tone: "credit" | "debit" | "neutral";
  } | null;
  extendedSettings?: {
    messageIntro?: string;
    messageOutro?: string;
    creditBalanceLabel?: string;
    debitBalanceLabel?: string;
  };
}

/**
 * Builds a structured, professional Arabic ERP invoice message suitable for
 * WhatsApp sharing right after confirmed SQLite persistence.
 */
export function buildInvoiceWhatsAppMessage(input: InvoiceWhatsAppMessageInput): string {
  const parts: string[] = [];
  const intro = input.extendedSettings?.messageIntro?.trim();
  if (intro) parts.push(intro);

  const company = input.companyName?.trim() || "نسقو برو";
  const paymentText = input.payment === "cash" ? "نقدي" : "آجل";

  parts.push(`*${company}*`);
  parts.push(`${input.typeLabel} رقم #${input.entryNumber}`);
  parts.push(`التاريخ: ${input.entryDate} · الدفع: ${paymentText}`);
  parts.push(`الحساب: ${input.accountName}`);

  if (input.lines.length > 0) {
    parts.push("──────────────");
    parts.push("*الأصناف:*");
    input.lines.forEach((line, idx) => {
      const qtyText = formatAmount(line.quantity);
      const priceText = formatAmount(line.price);
      const totalText = formatAmount(line.total);
      const discPart =
        line.discount && line.discount > 0
          ? ` (خصم ${formatAmount(line.discount)})`
          : "";
      parts.push(
        `${idx + 1}. ${line.itemName} — ${qtyText} ${line.unit} × ${priceText}${discPart} = *${totalText}*`,
      );
    });
  }

  parts.push("──────────────");
  if (input.totalDiscount && input.totalDiscount > 0) {
    parts.push(`إجمالي الخصم: ${formatAmount(input.totalDiscount)} ${input.currency}`);
  }
  parts.push(`*الصافي: ${formatAmount(input.totalAmount)} ${input.currency}*`);

  if (input.note && input.note.trim()) {
    parts.push(`ملاحظة: ${input.note.trim()}`);
  }

  if (input.updatedBalance) {
    const creditLabel = input.extendedSettings?.creditBalanceLabel?.trim() || "له";
    const debitLabel = input.extendedSettings?.debitBalanceLabel?.trim() || "عليه";
    const dirLabel =
      input.updatedBalance.tone === "credit"
        ? creditLabel
        : input.updatedBalance.tone === "debit"
          ? debitLabel
          : "متزن";
    parts.push(
      `الرصيد بعد الفاتورة: ${formatAmount(Math.abs(input.updatedBalance.amount))} ${input.currency} (${dirLabel})`,
    );
  }

  const outro = input.extendedSettings?.messageOutro?.trim();
  if (outro) parts.push(outro);

  return parts.join("\n");
}
