import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseItemsSpreadsheetBytes } from "../src/utils/importItemsFile.ts";
import { parseAccountCards } from "../src/utils/accountCsvImport.ts";
import { workbookRows } from "../src/utils/tabularImport.ts";
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
  const sparse = { SheetNames: ["s"], Sheets: { s: { "!ref": "A1000000:A1000001" } } };
  assert.throws(() => workbookRows(sparse), /2000/);
});

test("Android operational backup has explicit web compatibility rejection", () => {
  assert.match(validateJsonBackupCandidate({ format: "nasqo-android-backup-v1" })!, /Android/);
});
