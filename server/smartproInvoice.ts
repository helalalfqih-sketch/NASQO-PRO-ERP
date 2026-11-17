import { InputError, validId } from "./smartproPolicy.ts";

const SCALE = 10_000n;
const MAX_AMOUNT = 999_999_999_999n * SCALE;

export function scaledPositive(raw: unknown, label: string, allowZero = false): bigint {
  if (typeof raw !== "string" && typeof raw !== "number") throw new InputError("قيمة غير صحيحة: " + label);
  const value = String(raw).trim();
  if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,4})?$/.test(value)) {
    throw new InputError("اكتب " + label + " كرقم موجب بأربع خانات عشرية كحد أقصى.");
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  if ((scaled === 0n && !allowZero) || scaled > MAX_AMOUNT) throw new InputError("قيمة خارج المدى: " + label);
  return scaled;
}
export function formatScaled(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = String(abs / SCALE);
  const decimal = String(abs % SCALE).padStart(4, "0").replace(/0+$/, "");
  return sign + whole + (decimal ? "." + decimal : "");
}
function documentDate(v: unknown): string {
  const value = v == null || v === "" ? new Date().toISOString().slice(0, 10) : String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
    throw new InputError("تاريخ الفاتورة غير صحيح.");
  }
  return value;
}
export type PostedLine = {
  productId: string;
  storeId: string;
  quantity: string;
  price: string;
  total: string;
};
export type InvoicePosting = {
  requestId: string;
  type: "sale" | "purchase";
  docType: 2 | 3;
  accountId: string;
  currencyId: string;
  cashboxId: string;
  payment: "cash" | "credit";
  date: string;
  note: string;
  lines: PostedLine[];
  grandTotal: string;
  dain: string;
  madin: string;
};
export function validateInvoicePosting(raw: unknown): InvoicePosting {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("بيانات الفاتورة غير صحيحة.");
  const input = raw as Record<string, unknown>;
  if (input.type !== "sale" && input.type !== "purchase") throw new InputError("نوع الفاتورة يجب أن يكون بيعًا أو شراءً.");
  if (input.payment !== "cash" && input.payment !== "credit") throw new InputError("طريقة الدفع غير صحيحة.");
  if(typeof input.requestId!=="string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) {
    throw new InputError("مفتاح منع تكرار الفاتورة غير صالح.");
  }
  const accountId = validId(input.accountId);
  const currencyId = validId(input.currencyId ?? "1");
  const cashboxId = input.payment === "cash" ? validId(input.cashboxId) : "0";
  const note = input.note == null ? "" : String(input.note).trim();
  if (note.length > 500) throw new InputError("بيان الفاتورة طويل جدًا.");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 60) {
    throw new InputError("يجب أن تحتوي الفاتورة على بند واحد إلى 60 بندًا.");
  }
  const seen = new Set<string>();
  let sum = 0n;
  const lines: PostedLine[] = input.lines.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InputError("بند فاتورة غير صحيح.");
    const row = item as Record<string, unknown>;
    const productId = validId(row.productId);
    const storeId = validId(row.storeId);
    const marker = storeId + ":" + productId;
    if (seen.has(marker)) throw new InputError("أُضيف الصنف نفسه مرتين للمخزن ذاته؛ اجمع الكميات في بند واحد.");
    seen.add(marker);
    const quantity = scaledPositive(row.quantity, "الكمية");
    const price = scaledPositive(row.price, "سعر الوحدة", true);
    const lineTotal = (quantity * price + SCALE / 2n) / SCALE;
    if (lineTotal > MAX_AMOUNT) throw new InputError("إجمالي البند أكبر من الحد المقبول.");
    sum += lineTotal;
    if (sum > MAX_AMOUNT) throw new InputError("إجمالي الفاتورة أكبر من الحد المقبول.");
    return {
      productId,
      storeId,
      quantity: formatScaled(quantity),
      price: formatScaled(price),
      total: formatScaled(lineTotal),
    };
  });
  if (sum <= 0n) throw new InputError("إجمالي الفاتورة يجب أن يكون أكبر من الصفر.");
  const grandTotal = formatScaled(sum);
  const paid = input.payment === "cash" ? grandTotal : "0";
  return {
    requestId: input.requestId.toLowerCase(),
    type: input.type,
    docType: input.type === "sale" ? 2 : 3,
    accountId,
    currencyId,
    cashboxId,
    payment: input.payment,
    date: documentDate(input.date),
    note,
    lines,
    grandTotal,
    // Based on verified SmartPro historical invoice types:
    // sale: debit invoice amount, credit cash settlement if paid
    // purchase: credit invoice amount, debit cash settlement if paid
    dain: input.type === "sale" ? grandTotal : paid,
    madin: input.type === "purchase" ? grandTotal : paid,
  };
}
