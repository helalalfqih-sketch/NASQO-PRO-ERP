import type { AccountCategory, AccountRecord } from "../types";
import { importHeader, importIdentifier, importNumber, importText, MAX_IMPORT_ROWS, readImportWorkbook, workbookRows } from "./tabularImport";
export type AccountCardImport = Pick<AccountRecord, "name" | "phone" | "category" | "currency" | "openingBalance" | "openingDirection">;
const categories: Record<string, AccountCategory> = {
  purchases: "purchases", "المشتريات": "purchases", "مشتريات": "purchases", "مورد": "purchases",
  sales: "sales", "المبيعات": "sales", "مبيعات": "sales", clients: "clients", "العملاء": "clients", "عميل": "clients",
  employees: "employees", "الموظفين": "employees", "الموظفون": "employees", "موظف": "employees", transfers: "transfers", "الحوالات": "transfers", shop: "shop", "المحل": "shop",
};
export function parseAccountCards(bytes: Uint8Array, defaultCurrency: string, defaultCategory?: AccountCategory): AccountCardImport[] {
  const { rows, sheet } = workbookRows(readImportWorkbook(bytes));
  const h = (rows[0] ?? []).map(importHeader);
  const col = (names: string[]) => h.findIndex(x => names.map(importHeader).includes(x));
  const name = col(["الاسم", "اسم الحساب", "name"]), phone = col(["الهاتف", "رقم الهاتف", "phone"]);
  const amount = col(["الرصيد", "الرصيد الافتتاحي", "opening balance"]), currency = col(["العملة", "currency"]);
  const category = col(["التصنيف", "category"]), direction = col(["الاتجاه", "opening direction"]);
  if (name < 0) throw new Error("صف عناوين CSV يجب أن يتضمن «اسم الحساب» أو «الاسم».");
  const result: AccountCardImport[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every(v => String(v ?? "").trim() === "")) continue;
    const n = importText(r[name], "اسم الحساب", i + 1, 100);
    if (!n) throw new Error(`الصف ${i + 1}: اسم الحساب مطلوب.`);
    const kind = category < 0 || !String(r[category] ?? "").trim() ? defaultCategory : categories[importHeader(r[category])];
    if (!kind) throw new Error(`الصف ${i + 1}: اختر التصنيف أو أضف عمود «التصنيف» الصحيح.`);
    const cur = currency < 0 || !String(r[currency] ?? "").trim() ? defaultCurrency : importText(r[currency], "العملة", i + 1, 32);
    const balance = amount < 0 ? 0 : importNumber(r[amount], "الرصيد", i + 1) ?? 0;
    if (balance < 0) throw new Error(`الصف ${i + 1}: اكتب الرصيد موجبًا وحدد الاتجاه.`);
    const rawDirection = direction < 0 ? "" : importHeader(r[direction]);
    const dir = ["debit", "مدين", "عليه"].includes(rawDirection) ? "debit" : ["credit", "دائن", "داين", "له"].includes(rawDirection) ? "credit" : "";
    if (!dir && (rawDirection || balance !== 0)) throw new Error(`الصف ${i + 1}: حدد اتجاه الرصيد «مدين/دائن».`);
    const key = `${kind}|${n}|${cur}`;
    if (seen.has(key)) throw new Error(`الصف ${i + 1}: الحساب مكرر في الملف.`);
    seen.add(key);
    result.push({ name: n, phone: phone < 0 ? "" : importText(importIdentifier(sheet, i, phone, r[phone]), "الهاتف", i + 1, 32), category: kind, currency: cur, openingBalance: balance, openingDirection: dir || "credit" });
    if (result.length > MAX_IMPORT_ROWS) throw new Error(`الحد الأقصى ${MAX_IMPORT_ROWS} حساب في الدفعة.`);
  }
  if (!result.length) throw new Error("ملف CSV لا يحتوي حسابات.");
  return result;
}
