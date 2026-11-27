import type { AccountRecord, InventoryItemRecord, LedgerEntryRecord, WarehouseRecord } from "../types";
import { computeInvoiceLineNet } from "./invoiceGridUtils";

export type LegacyRecordKind = "offers" | "trash" | "alerts";
export type LegacyRecordLine = {
  id: string; lineKind: "item" | "free"; inventoryItemId: string; itemName: string;
  warehouseId: string; warehouseName: string; quantity: number; price: number;
  total: number; discount: number; bonus: number; unit: string; unitNum: number;
  details: string; expiryDate: string; sourceFields?: Record<string, unknown>;
};
export type LegacyRecord = {
  id: string; sourceSha: string; recordKind: LegacyRecordKind; accountId: string;
  accountName: string; entryDate: string; details: string; amount: number; currency: string;
  documentNumber: string; sourceReference: string; headerDiscount: number; docType: number;
  direction: "debit" | "credit"; deleted: boolean; read: boolean; dismissed: boolean;
  payment: "cash" | "credit"; exchangeRate: number;
  cashboxId?: number;
  amountValid?: boolean; draftBlockedReason?: string;
  lines?: LegacyRecordLine[]; fields?: Record<string, unknown>;
};

export function legacyCopySourceSha(id?: string): string | undefined {
  return id ? /^legacy-copy-([a-f0-9]{64})-/.exec(id)?.[1] : undefined;
}
export function legacyCopySourceMatches(draft: { entryId: string; sourceSha?: string }, currentSource?: string): boolean {
  const encoded = legacyCopySourceSha(draft.entryId);
  if (draft.entryId.startsWith("legacy-copy-") && (!encoded || encoded !== draft.sourceSha)) return false;
  return draft.sourceSha === undefined || draft.sourceSha === currentSource;
}

/** Explicit copying only. The source stays immutable/deleted; no posting API. */
export function legacyRecordDraft(record: LegacyRecord, state: {
  accounts: readonly AccountRecord[]; inventory: readonly InventoryItemRecord[];
  warehouses: readonly WarehouseRecord[]; ledger: readonly LedgerEntryRecord[];
  currencyCodes: readonly string[];
  cashboxes?: readonly { id: number }[];
}) {
  if (record.recordKind === "alerts") throw new Error("التنبيه ليس مستندًا ماليًا.");
  if (record.draftBlockedReason) throw new Error(record.draftBlockedReason);
  if (record.recordKind === "trash" && ![2, 3, 4, 5, 7, 9].includes(record.docType))
    throw new Error("السند المحذوف محفوظ للعرض؛ لا يدعم محرر الفاتورة استعادته كمسودة سند.");
  if (!state.accounts.some((a) => a.id === record.accountId)) throw new Error("حساب المستند غير موجود؛ لا يمكن اختيار حساب بديل تلقائيًا.");
  if (!state.currencyCodes.includes(record.currency) || !["ريال", "دولار", "يورو"].includes(record.currency))
    throw new Error("عملة المستند غير معرّفة؛ أكمل تعريفها قبل إنشاء مسودة.");
  const calendar = new Date(`${record.entryDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.entryDate) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== record.entryDate)
    throw new Error("تاريخ المستند غير مكتمل أو غير صالح.");
  if (!Number.isFinite(record.amount) || record.amount < 0 || !Number.isFinite(record.exchangeRate) || record.exchangeRate <= 0 || !["cash", "credit"].includes(record.payment))
    throw new Error("المبلغ أو سعر الصرف أو طريقة الدفع يحتاج مراجعة قبل إنشاء المسودة.");
  if (record.exchangeRate !== 1) throw new Error("سعر الصرف الأصلي غير مدعوم في حفظ المسودة المحلية حاليًا؛ بقي المستند الأصلي دون تغيير.");
  if (record.payment === "cash" && (!record.cashboxId || !state.cashboxes?.some((box) => box.id === record.cashboxId)))
    throw new Error("الصندوق النقدي غير محدد أو غير موجود؛ لن نختار صندوقًا بديلًا تلقائيًا.");
  const lines = record.lines ?? [];
  const items = lines.filter((line) => line.lineKind === "item");
  if (items.length && items.length !== lines.length) throw new Error("المستند يجمع بنود أصناف وبنودًا حرة؛ راجع تفاصيله قبل إدخاله في المحرر.");
  if (items.length > 150) throw new Error("المستند يتجاوز عدد البنود المدعوم في المسودة؛ جميع بنوده متاحة للعرض.");
  if (record.headerDiscount !== 0 || lines.some((line) => line.bonus !== 0 || line.expiryDate))
    throw new Error("يحتوي المستند خصم رأس أو مكافأة أو صلاحية لا يدعم محرر المسودة نقلها كاملة؛ التفاصيل الأصلية متاحة أدناه.");
  const warehouseId = items[0]?.warehouseId ?? "";
  const money = (n: number) => Math.round(n * 100);
  for (const line of items) {
    const item = state.inventory.find((p) => p.id === line.inventoryItemId);
    if (!item || !state.warehouses.some((w) => w.id === line.warehouseId) || line.warehouseId !== warehouseId || item.warehouseId !== warehouseId)
      throw new Error("أحد الأصناف أو المخازن غير موجود أو البنود موزعة على مخازن مختلفة؛ لم تُستبدل المراجع تلقائيًا.");
    if (![1, 2, 3].includes(line.unitNum) || !Number.isFinite(line.quantity) || line.quantity <= 0 ||
      !Number.isFinite(line.price) || line.price < 0 || !Number.isFinite(line.discount) || line.discount < 0 ||
      !Number.isFinite(line.total) || line.total < 0 || money(computeInvoiceLineNet(line.quantity, line.price, line.discount)) !== money(line.total))
      throw new Error("حساب أو وحدة أحد البنود يحتاج مراجعة؛ لن نغيّر قيمه تلقائيًا.");
  }
  if (items.length && money(items.reduce((sum, l) => sum + l.total, 0)) !== money(record.amount))
    throw new Error("مجموع البنود يختلف عن رأس المستند؛ راجع الأصل قبل إنشاء مسودة.");
  const intent = record.recordKind === "offers" ? "quote" as const : [4, 5].includes(record.docType) ? "return" as const : "invoice" as const;
  const kind = (record.recordKind === "offers" ? record.direction === "credit" : [3, 5, 9].includes(record.docType)) ? "purchase" as const : "sale" as const;
  const note = [record.details, record.sourceReference ? `مرجع المصدر: ${record.sourceReference}` : "",
    ...lines.filter((l) => l.lineKind === "free").map((l) => `${l.details || l.itemName} — ${l.quantity} ${l.unit} × ${l.price} = ${l.total} ${record.currency}`)]
    .filter(Boolean).join("\n");
  const entryId = `legacy-copy-${record.sourceSha}-${record.recordKind}-${record.id}`;
  if (!/^[A-Za-z0-9:_-]{1,140}$/.test(entryId)) throw new Error("معرف السجل غير مدعوم لإنشاء مسودة؛ الأصل متاح للعرض.");
  return {
    version: 1 as const, intent, kindOverride: kind, accountId: record.accountId,
    entryId, sourceSha: record.sourceSha,
    fields: {
      content: items.length ? "items" : "free", payment: record.payment, kind, isReturn: intent === "return",
      amount: String(record.amount), note, documentNumber: record.documentNumber,
      entryNumber: String(state.ledger.reduce((max, entry) => Math.max(max, entry.entryNumber), 0) + 1), entryDate: record.entryDate,
      expenseCategory: "", currency: record.currency, exchangeRate: String(record.exchangeRate), warehouseId,
      ...(record.cashboxId ? { cashboxId: record.cashboxId } : {}),
      accountId: record.accountId, itemSearch: "", localTaxAmount: "0", localTaxMode: "amount",
      localOriginalId: "", localReturnQty: {},
      rows: items.map((l, index) => ({ rowId: `legacy-row-${index}`, inventoryItemId: l.inventoryItemId,
        itemName: l.itemName, unit: l.unit || "حبة", unitNum: l.unitNum as 1 | 2 | 3,
        quantity: String(l.quantity), price: String(l.price), discount: String(l.discount) })),
    },
  };
}
