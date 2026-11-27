import * as XLSX from "xlsx";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export function importHeader(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
export function importNumber(value: unknown, field: string, row: number): number | undefined {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const text = String(value).trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/٬/g, ",").replace(/٫/g, ".");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error(`الصف ${row}: ${field} ليس رقمًا صالحًا.`);
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error(`الصف ${row}: ${field} خارج الحد المدعوم.`);
  return n;
}
export function importText(value: unknown, field: string, row: number, max: number): string {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new Error(`الصف ${row}: ${field} يتجاوز ${max} حرفًا؛ لم يُقتطع النص.`);
  return text;
}
export function readImportWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) throw new Error("اختر ملف جدول غير فارغ لا يتجاوز 8 ميجابايت.");
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const biff = bytes[0] === 9 && [0, 2, 4, 8].includes(bytes[1]);
  if (zip) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let unpacked = 0, entries = 0;
    for (let i = 0; i + 46 <= bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      unpacked += view.getUint32(i + 24, true); entries++;
      if (unpacked > 32 * 1024 * 1024 || entries > 2000) throw new Error("محتوى ملف Excel بعد فك الضغط أكبر من الحد المدعوم.");
      i += 45 + view.getUint16(i + 28, true) + view.getUint16(i + 30, true) + view.getUint16(i + 32, true);
    }
    if (!entries) throw new Error("بنية ملف Excel المضغوط غير صالحة.");
  }
  if (zip || ole || biff) return XLSX.read(bytes, { type: "array", raw: true, cellDates: true, cellNF: true });
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("نوع الملف غير مدعوم؛ استخدم Excel أو CSV بترميز UTF-8."); }
  if (/^\s*(?:%PDF-|<|\{|\[|SQLite)/i.test(text) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new Error("هذا الملف ليس جدول أصناف أو حسابات؛ لا يمكن استيراد PDF أو الصور كصفوف.");
  }
  return XLSX.read(text, { type: "string", raw: true, cellDates: false });
}
export function workbookRows(book: XLSX.WorkBook, sheetName = book.SheetNames[0]) {
  if (!sheetName || !book.Sheets[sheetName]) throw new Error("ورقة البيانات المحددة غير موجودة.");
  const sheet = book.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  if (range.e.r > MAX_IMPORT_ROWS + 15 || range.e.c >= 100) throw new Error("الحد الأقصى 2000 صف و100 عمود في الاستيراد الواحد.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true, raw: true, range: { s: { r: 0, c: 0 }, e: range.e } });
  return { rows, sheet, sheetName };
}
export function importIdentifier(sheet: XLSX.WorkSheet, row: number, column: number, raw: unknown): string {
  if (typeof raw === "number" && !Number.isSafeInteger(raw)) throw new Error(`الصف ${row + 1}: احفظ الباركود أو الهاتف الطويل كنص للحفاظ على دقته.`);
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
  return cell && typeof raw === "number" ? XLSX.utils.format_cell(cell) : String(raw ?? "");
}
