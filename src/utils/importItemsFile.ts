import { readImportWorkbook, workbookRows, importNumber, importText, importIdentifier, MAX_IMPORT_ROWS } from "./tabularImport";
import type { CurrencyCode, InventoryItemRecord } from "../types";

export type ImportedInventoryItemInput = Partial<InventoryItemRecord> & {
  name: string;
  warehouseId?: string;
};

export type ParsedItemsImportResult = {
  items: ImportedInventoryItemInput[];
  skippedRows: number;
  sheetName: string;
};

function normalizeHeaderCell(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanTextCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Number.isInteger(raw) ? String(raw) : String(raw);
  }
  return String(raw).trim();
}

type ColumnMap = {
  legacyId?: number;
  sku?: number;
  name?: number;
  unit?: number;
  avgCost?: number;
  sellingPrice?: number;
  unit2?: number;
  count2?: number;
  sprice2?: number;
  unit3?: number;
  count3?: number;
  sprice3?: number;
  currencyCode?: number;
  isActive?: number;
  defaultUnit?: number;
  quantity?: number;
  minThreshold?: number;
  expiryDate?: number;
};

function detectColumnMap(headerRow: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  const headers = headerRow.map(normalizeHeaderCell);

  headers.forEach((h, idx) => {
    if (!h) return;

    if (
      map.name === undefined &&
      (h === "اسم الصنف" ||
        h === "الصنف" ||
        h === "الاسم" ||
        h === "اسم الماده" ||
        h === "اسم المنتج" ||
        h === "name" ||
        h === "item" ||
        h === "item name" ||
        h === "product" ||
        h === "product name")
    ) {
      map.name = idx;
      return;
    }

    if (
      map.sku === undefined &&
      (h === "الباركود" ||
        h === "باركود" ||
        h === "الرمز" ||
        h === "رمز الصنف" ||
        h === "الكود" ||
        h === "كود الصنف" ||
        h === "sku" ||
        h === "barcode" ||
        h === "code")
    ) {
      map.sku = idx;
      return;
    }

    if (
      map.legacyId === undefined &&
      (h === "الرقم" || h === "رقم الصنف" || h === "م" || h === "id" || h === "no" || h === "#")
    ) {
      map.legacyId = idx;
      return;
    }

    if (
      map.unit === undefined &&
      (h === "الوحده" ||
        h === "الوحده1" ||
        h === "الوحده 1" ||
        h === "وحده" ||
        h === "وحده1" ||
        h === "الوحده الاساسيه" ||
        h === "unit" ||
        h === "unit1" ||
        h === "unit 1")
    ) {
      map.unit = idx;
      return;
    }

    if (
      map.unit2 === undefined &&
      (h === "الوحده2" || h === "الوحده 2" || h === "وحده2" || h === "وحده 2" || h === "unit2" || h === "unit 2")
    ) {
      map.unit2 = idx;
      return;
    }

    if (
      map.unit3 === undefined &&
      (h === "الوحده3" || h === "الوحده 3" || h === "وحده3" || h === "وحده 3" || h === "unit3" || h === "unit 3")
    ) {
      map.unit3 = idx;
      return;
    }

    if (
      map.count2 === undefined &&
      (h === "العبوه 2" || h === "العبوه2" || h === "عبوه 2" || h === "عدد 2" || h === "عدد2" || h === "count2")
    ) {
      map.count2 = idx;
      return;
    }

    if (
      map.count3 === undefined &&
      (h === "العبوه 3" || h === "العبوه3" || h === "عبوه 3" || h === "عدد 3" || h === "عدد3" || h === "count3")
    ) {
      map.count3 = idx;
      return;
    }

    if (
      map.avgCost === undefined &&
      (h.includes("التكلفه") ||
        h.includes("تكلفه") ||
        h.includes("سعر الشراء") ||
        h === "الشراء" ||
        h === "cost" ||
        h === "avg cost" ||
        h === "buy price" ||
        h === "purchase price")
    ) {
      map.avgCost = idx;
      return;
    }

    if (h === "سعر 2" || h === "سعر2" || h === "سعر البيع 2" || h === "سعر البيع2" || h === "sprice2" || h === "price2") {
      if (map.sprice2 === undefined) map.sprice2 = idx;
      return;
    }

    if (h === "سعر 3" || h === "سعر3" || h === "سعر البيع 3" || h === "سعر البيع3" || h === "sprice3" || h === "price3") {
      if (map.sprice3 === undefined) map.sprice3 = idx;
      return;
    }

    if (
      h === "سعر البيع" ||
      h === "سعر البيع 1" ||
      h === "سعر البيع1" ||
      h === "سعر بيع" ||
      h === "البيع" ||
      h === "price" ||
      h === "sell price" ||
      h === "selling price"
    ) {
      // Handle repeated "سعر البيع" columns in exports like الاصناف.xls:
      // 1st -> sellingPrice, after unit2 -> sprice2, after unit3 -> sprice3
      if (map.unit3 !== undefined && idx > map.unit3 && map.sprice3 === undefined) {
        map.sprice3 = idx;
      } else if (map.unit2 !== undefined && idx > map.unit2 && map.sprice2 === undefined) {
        map.sprice2 = idx;
      } else if (map.sellingPrice === undefined) {
        map.sellingPrice = idx;
      } else if (map.sprice2 === undefined) {
        map.sprice2 = idx;
      } else if (map.sprice3 === undefined) {
        map.sprice3 = idx;
      }
      return;
    }

    if (map.currencyCode === undefined && (h === "العمله" || h === "عمله" || h === "currency")) {
      map.currencyCode = idx;
      return;
    }

    if (map.isActive === undefined && (h === "الحاله" || h === "حاله" || h === "status" || h === "active")) {
      map.isActive = idx;
      return;
    }

    if (
      map.defaultUnit === undefined &&
      (h === "الوحده الافتراضيه" || h === "وحده افتراضيه" || h === "default unit")
    ) {
      map.defaultUnit = idx;
      return;
    }

    if (
      map.quantity === undefined &&
      (h === "الكميه" || h === "كميه" || h === "الرصيد" || h === "رصيد" || h === "المتوفر" || h === "الكميه المتوفره" || h === "كميه المتبقي" || h === "الكميه الحاليه" || h === "available qty" || h === "remaining quantity" || h === "qty" || h === "quantity")
    ) {
      map.quantity = idx;
      return;
    }

    if (
      map.minThreshold === undefined &&
      (h === "الحد الادني" || h === "حد الطلب" || h === "حد ادني" || h === "min threshold" || h === "min qty")
    ) {
      map.minThreshold = idx;
      return;
    }

    if (
      map.expiryDate === undefined &&
      (h.includes("الانتهاء") || h.includes("الصلاحيه") || h === "expiry" || h === "expiry date")
    ) {
      map.expiryDate = idx;
    }
  });

  return map;
}

function findHeaderRowIndex(rows: unknown[][]): { headerIndex: number; map: ColumnMap } {
  const maxScan = Math.min(rows.length, 15);
  for (let i = 0; i < maxScan; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) continue;
    const map = detectColumnMap(row);
    if (map.name !== undefined) {
      return { headerIndex: i, map };
    }
  }
  return { headerIndex: -1, map: {} };
}

export function parseItemsSpreadsheetBytes(
  bytes: Uint8Array,
  defaultCurrency: CurrencyCode = "ريال",
  options: { sheetName?: string } = {},
): ParsedItemsImportResult {
  const book = readImportWorkbook(bytes);
  const {rows, sheet, sheetName} = workbookRows(book, options.sheetName);
  const {headerIndex, map} = findHeaderRowIndex(rows);
  if(headerIndex < 0) throw new Error("أضف صف عناوين يتضمن «اسم الصنف»؛ لم يُفترض ترتيب الأعمدة.");
  const items: ImportedInventoryItemInput[] = [];
  const seen = new Set<string>();
  let skippedRows = 0;
  const labels: Record<keyof ColumnMap, string> = { legacyId:"رقم الصنف", sku:"الباركود", name:"اسم الصنف", unit:"الوحدة", avgCost:"سعر الشراء المرجعي", sellingPrice:"سعر البيع", unit2:"الوحدة الثانية", count2:"معامل الوحدة الثانية", sprice2:"سعر الوحدة الثانية", unit3:"الوحدة الثالثة", count3:"معامل الوحدة الثالثة", sprice3:"سعر الوحدة الثالثة", currencyCode:"العملة", isActive:"الحالة", defaultUnit:"الوحدة الافتراضية", quantity:"الكمية", minThreshold:"حد الطلب", expiryDate:"تاريخ الانتهاء" };
  for(let r=headerIndex+1;r<rows.length;r++) {
    const row=rows[r];
    if(row.every(c=>String(c??"").trim()==="")){skippedRows++;continue;}
    const text=(key:keyof ColumnMap,max:number)=>importText(map[key]===undefined?"":row[map[key]!],labels[key],r+1,max);
    const num=(key:keyof ColumnMap)=>{
      const n=importNumber(map[key]===undefined?undefined:row[map[key]!],labels[key],r+1);
      if(n!==undefined&&n<0)throw new Error(`الصف ${r+1}: ${labels[key]} لا يقبل قيمة سالبة.`);
      return n;
    };
    const name=text("name",120);
    if(!name)throw new Error(`الصف ${r+1}: اسم الصنف مطلوب.`);
    const sku=map.sku===undefined?"":importText(importIdentifier(sheet,r,map.sku,row[map.sku]),"الباركود",r+1,64);
    const identity=sku?`sku:${sku}`:`name:${normalizeHeaderCell(name)}`;
    if(seen.has(identity))throw new Error(`الصف ${r+1}: صنف مكرر داخل الملف.`);
    seen.add(identity);
    const unit=text("unit",32)||"حبة",unit2=text("unit2",32),unit3=text("unit3",32);
    const count2=num("count2"),count3=num("count3");
    if(unit3&&!unit2)throw new Error(`الصف ${r+1}: الوحدة الثالثة تتطلب الوحدة الثانية.`);
    if((unit2&&(!Number.isInteger(count2)||!count2))||(unit3&&(!Number.isInteger(count3)||!count3)))throw new Error(`الصف ${r+1}: أدخل معاملًا صحيحًا موجبًا لكل وحدة إضافية؛ لا يوجد معامل افتراضي.`);
    if((unit2&&unit2===unit)||(unit3&&(unit3===unit||unit3===unit2)))throw new Error(`الصف ${r+1}: أسماء الوحدات يجب أن تكون مختلفة.`);
    const quantity=num("quantity");
    if(quantity)throw new Error(`الصف ${r+1}: الملف يحتوي كمية مخزون؛ هذا الإجراء لبطاقات الأصناف والأسعار فقط. استعد الرصيد من نسخة أو إجراء افتتاح مستقل.`);
    const status=normalizeHeaderCell(text("isActive",32));
    const inactive=["خامل","موقف","غير نشط","معطل","0","false","inactive"];
    const active=["","نشط","فعال","1","true","active"];
    if(!inactive.includes(status)&&!active.includes(status))throw new Error(`الصف ${r+1}: حالة الصنف غير معروفة.`);
    const def=text("defaultUnit",32);
    let defaultUnit=1;
    if(def&&def!=="1"&&def!==unit){
      if(def==="2"||def===unit2)defaultUnit=2;
      else if(def==="3"||def===unit3)defaultUnit=3;
      else throw new Error(`الصف ${r+1}: الوحدة الافتراضية غير معروفة.`);
    }
    if(defaultUnit===2&&!unit2||defaultUnit===3&&!unit3)throw new Error(`الصف ${r+1}: الوحدة الافتراضية غير مكتملة.`);
    let expiryDate="";
    const rawExpiry=map.expiryDate===undefined?"":row[map.expiryDate];
    if(rawExpiry instanceof Date) expiryDate=rawExpiry.toISOString().slice(0,10);
    else if(String(rawExpiry??"").trim()) {
      expiryDate=String(rawExpiry).trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)||!Number.isFinite(Date.parse(expiryDate))||new Date(expiryDate).toISOString().slice(0,10)!==expiryDate)throw new Error(`الصف ${r+1}: تاريخ الانتهاء يجب أن يكون YYYY-MM-DD أو خلية تاريخ Excel.`);
    }
    const reference=num("avgCost"),selling=num("sellingPrice"),sprice2=num("sprice2"),sprice3=num("sprice3"),min=num("minThreshold");
    if ((!unit2 && (count2 || sprice2)) || (!unit3 && (count3 || sprice3))) throw new Error(`الصف ${r+1}: معامل أو سعر وحدة إضافية دون اسم الوحدة.`);
    for(const value of [reference,selling,sprice2,sprice3])if(value!==undefined&&Math.abs(value*100-Math.round(value*100))>0.00001)throw new Error(`الصف ${r+1}: السعر يجب أن يكون بمنزلتين عشريتين كحد أقصى.`);
    items.push({name,sku,unit,
      ...(reference!==undefined?{catalogReferenceCost:reference}:{}),
      ...(selling!==undefined?{sellingPrice:selling}:{}),
      ...(unit2?{unit2,count2,...(sprice2!==undefined?{sprice2}:{})}:{}),
      ...(unit3?{unit3,count3,...(sprice3!==undefined?{sprice3}:{})}:{}),
      defaultUnit,currencyCode:text("currencyCode",32)||defaultCurrency,isActive:active.includes(status),
      ...(min!==undefined?{minThreshold:min}:{}),...(expiryDate?{expiryDate}:{}),
    });
    if(items.length>MAX_IMPORT_ROWS)throw new Error("الحد الأقصى 2000 صنف في الدفعة الواحدة.");
  }
  if(!items.length)throw new Error("الورقة لا تحتوي على أصناف.");
  return {items,skippedRows,sheetName};
}
