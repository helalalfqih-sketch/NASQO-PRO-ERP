import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseItemsSpreadsheetBytes, parseItemsWorkbook } from "../src/utils/importItemsFile.ts";
import { parseAccountCards } from "../src/utils/accountCsvImport.ts";
import { workbookRows, MAX_IMPORT_ROWS, readImportWorkbook } from "../src/utils/tabularImport.ts";
import { reportXlsxBytes, type ReportDocument } from "../src/utils/reportDocument.ts";
import { catalogCardsForReport } from "../src/utils/catalogWorkbook.ts";
import type { InventoryItemRecord } from "../src/types.ts";
import { validateJsonBackupCandidate } from "../src/utils/backupFormat.ts";
const csv = (value: string) => new TextEncoder().encode(value);

test("account CSV keeps quoted commas/newlines and leading-zero phones; only mapped balance column is read", () => {
  const rows = parseAccountCards(csv('الاسم,الهاتف,الرصيد,الاتجاه,التصنيف,العملة\n"شركة, فرع\nالمدينة",001234,25,دائن,العملاء,ريال'), "ريال");
  assert.equal(rows[0].name, "شركة, فرع\nالمدينة");
  assert.equal(rows[0].phone, "001234");
  assert.equal(rows[0].openingBalance, 25);
  assert.equal(rows[0].openingDirection, "credit");
  assert.equal(rows[0].category, "clients");
  assert.throws(() => parseAccountCards(csv("الاسم,الهاتف\nعميل,00999"), "ريال"), /التصنيف/);
  assert.equal(parseAccountCards(csv("الاسم,الهاتف\nعميل,00999"), "دولار", "sales")[0].currency, "دولار");
  assert.throws(() => parseAccountCards(csv("الاسم,الرصيد\nعميل,abc"), "ريال", "clients"), /رقم/);
  assert.throws(() => parseAccountCards(csv("الاسم,الرصيد\nعميل,20"), "ريال", "clients"), /اتجاه/);
});

test("catalog CSV preserves inactive state and reference prices without generating operational cost, quantity or warehouse", () => {
  const [row] = parseItemsSpreadsheetBytes(csv("اسم الصنف,الباركود,سعر الشراء,سعر البيع,الحالة\nصنف,0000123,١٢٫٥,20,خامل"), "ريال").items;
  assert.equal(row.sku, "0000123"); assert.equal(row.isActive, false);
  assert.equal(row.catalogReferenceCost, 12.5); assert.equal(row.sellingPrice, 20);
  assert.equal(row.currencyCode, "ريال");
  for (const field of ["warehouseId", "quantity", "avgCost"]) assert.equal(Object.hasOwn(row, field), false);
});

test("catalog rejects fake PDF/image/text, missing headers, invalid prices and implicit unit conversions", () => {
  for (const input of ["%PDF-1.7\nname,cost\nFake,1", "<html>name,price</html>", "{\"name\":\"Item\"}", "Item,1,2"]) assert.throws(() => parseItemsSpreadsheetBytes(csv(input)));
  for (const [header, value] of [["سعر الشراء", "oops"], ["سعر البيع", "-1"], ["سعر البيع", "2.123"], ["الكمية", "4"], ["تاريخ الانتهاء", "2026-02-30"], ["الحالة", "unknown"]]) {
    assert.throws(() => parseItemsSpreadsheetBytes(csv(`اسم الصنف,${header}\nصنف,${value}`)));
  }
  assert.throws(() => parseItemsSpreadsheetBytes(csv("اسم الصنف,الوحدة 2\nصنف,علبة")), /معامل/);
  assert.throws(() => parseItemsSpreadsheetBytes(csv("اسم الصنف,الكمية المتوفرة\nصنف,35")), /كمية مخزون/);
  const [row] = parseItemsSpreadsheetBytes(csv("اسم الصنف,الوحدة 2,count2,الوحدة 3,count3\nصنف,علبة,10,كرتون,8")).items;
  assert.equal(row.count2, 10); assert.equal(row.count3, 8);
});

test("Excel numeric barcode format, date cells and explicitly selected sheets survive parsing", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["ملاحظات"], ["هذه ليست ورقة الأصناف"]]), "ملاحظات");
  const sheet = XLSX.utils.aoa_to_sheet([["اسم الصنف", "الباركود", "تاريخ الانتهاء"], ["صنف", 123, new Date("2027-01-20T00:00:00.000Z")]]);
  sheet.B2.z = "000000";
  XLSX.utils.book_append_sheet(book, sheet, "الأصناف");
  for (const bookType of ["xlsx", "xls"] as const) {
    const bytes = new Uint8Array(XLSX.write(book, { type: "buffer", bookType }));
    assert.throws(() => parseItemsSpreadsheetBytes(bytes));
    const [row] = parseItemsSpreadsheetBytes(bytes, "ريال", { sheetName: "الأصناف" }).items;
    assert.equal(row.sku, "000123"); assert.equal(row.expiryDate, "2027-01-20");
  }
  const formatted = XLSX.utils.aoa_to_sheet([["اسم الصنف", "الباركود"], ["صنف", 123]]);
  formatted.B2.z = "000000";
  formatted["!ref"] = "A1:XFD1048576";
  formatted.XFD1048576 = {t:"z",v:undefined};
  const sparse = { SheetNames: ["s"], Sheets: { s: formatted } };
  assert.equal(workbookRows(sparse).rows.length, 2, "empty formatting must not count as data");
  assert.equal(parseItemsWorkbook(sparse).items[0].sku, "000123");
  formatted.A1048576 = {t:"s",v:"real data"};
  assert.throws(() => workbookRows(sparse), /10000.*1048576/);
  delete formatted.A1048576;
  formatted.CW1 = {t:"s",v:"real column"};
  assert.throws(() => workbookRows(sparse), /100.*101/);
});

const inventoryReport = (count: number): ReportDocument => ({
  kind:"inventory", title:"حركة المخزون", scope:{warehouse:"جميع المخازن"},
  columns:["الرقم","الصنف","الوحدة","المتوفر","الشراء","البيع","قيمة المتبقي","الربح","العملة"],
  rows:Array.from({length:count}, (_,i)=>({id:`item-${i}`,currency:"ريال",cells:[i+1,`صنف اختبار ${i}`,"حبة",7,5000,8000,2000,3000,"ريال"]})),
  totals:[],
});

test("an older NASQO inventory export above 2000 rows imports cards without treating totals as unit prices or inventory", async () => {
  const report = inventoryReport(3000);
  report.rows.push({...report.rows[0],id:"same-product-second-warehouse",cells:[...report.rows[0].cells]});
  const result = parseItemsSpreadsheetBytes(await reportXlsxBytes(report));
  assert.equal(result.items.length,3000); assert.equal(result.skippedRows,1);
  assert.equal(result.notices.length,1);
  for(const row of result.items) {
    assert.equal(row.unit,"حبة"); assert.equal(row.currencyCode,"ريال");
    for(const key of ["catalogReferenceCost","sellingPrice","quantity","avgCost","warehouseId"]) assert.equal(Object.hasOwn(row,key),false);
  }
  // No silent merging of a different source product with the same name.
  report.rows.at(-1)!.cells[0] = 9000;
  const conflicting=await reportXlsxBytes(report);
  assert.throws(()=>parseItemsSpreadsheetBytes(conflicting), /مكرر/);
  const foreignReport=await reportXlsxBytes({...inventoryReport(1),title:"تقرير آخر"});
  assert.throws(()=>parseItemsSpreadsheetBytes(foreignReport), /كمية مخزون/);
});

test("new inventory exports select the card sheet and round-trip full card metadata independently of report totals", async () => {
  const card:InventoryItemRecord = {id:"master",ownerId:"test",name:"صنف متعدد الوحدات",sku:"000001234567890123",unit:"حبة",warehouseId:"",quantity:0,avgCost:0,minThreshold:3,
    catalogReferenceCost:17.5,sellingPrice:25,currencyCode:"ريال",isActive:false,unit2:"علبة",count2:10,sprice2:240,unit3:"كرتون",count3:5,sprice3:1150,defaultUnit:2,expiryDate:"2027-01-20"};
  const cards = Array.from({length:2501},(_,i)=>({...card,id:`master-${i}`,name:`صنف اختبار ${i}`,sku:`000${i}`}));
  cards[0] = card;
  const location = {...card,id:"location",catalogSourceItemId:card.id,warehouseId:"wh",quantity:7,avgCost:18};
  assert.deepEqual(catalogCardsForReport([card,location],new Set([location.id])),[card]);
  const report={...inventoryReport(3000),catalogCards:[...cards,location]};
  const bytes=await reportXlsxBytes(report), result=parseItemsSpreadsheetBytes(bytes);
  assert.equal(result.sheetName,"بطاقات الأصناف"); assert.equal(result.items.length,2501);
  const row=result.items[0];
  for(const field of ["name","sku","unit","catalogReferenceCost","sellingPrice","currencyCode","isActive","unit2","count2","sprice2","unit3","count3","sprice3","defaultUnit","expiryDate","minThreshold"] as const) assert.equal(row[field],card[field],field);
  assert.equal(readImportWorkbook(bytes).Sheets["بطاقات الأصناف"].C2.t,"s");
  for(const key of ["quantity","avgCost","warehouseId"]) assert.equal(Object.hasOwn(row,key),false);
  assert.equal(parseItemsSpreadsheetBytes(bytes,"ريال",{sheetName:"التقرير"}).items.length,3000);
});

test("item and account readers share a bounded 10000-row limit", () => {
  const items=Array.from({length:MAX_IMPORT_ROWS},(_,i)=>`صنف ${i}`).join("\n");
  const accounts=Array.from({length:MAX_IMPORT_ROWS},(_,i)=>`حساب ${i}`).join("\n");
  assert.equal(parseItemsSpreadsheetBytes(csv(`اسم الصنف\n${items}`)).items.length,MAX_IMPORT_ROWS);
  assert.equal(parseAccountCards(csv(`الاسم\n${accounts}`),"ريال","clients").length,MAX_IMPORT_ROWS);
  assert.throws(()=>parseItemsSpreadsheetBytes(csv(`اسم الصنف\n${items}\nصنف زائد`)),/10000/);
  assert.throws(()=>parseAccountCards(csv(`الاسم\n${accounts}\nحساب زائد`),"ريال","clients"),/10000/);
});

test("Android operational backup has explicit web compatibility rejection", () => {
  assert.match(validateJsonBackupCandidate({ format: "nasqo-android-backup-v1" })!, /Android/);
});
