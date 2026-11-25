import test from "node:test";
import assert from "node:assert/strict";
import { legacyRecordDraft, type LegacyRecord } from "../src/utils/legacyRecordDraft";

const state: Parameters<typeof legacyRecordDraft>[1] = {
  accounts: [{ id: "a" }] as any, inventory: [{ id: "i", warehouseId: "w" }] as any,
  warehouses: [{ id: "w" }] as any, ledger: [{ entryNumber: 100 }] as any,
  currencyCodes: ["ريال"], cashboxes: [{ id: 7 }],
};
const record: LegacyRecord = { id: "1", sourceSha: "a".repeat(64), recordKind: "offers", accountId: "a", accountName: "Synthetic",
  entryDate: "2026-11-08", details: "Long note ".repeat(100), amount: 10, currency: "ريال", documentNumber: "R-1", sourceReference: "Ref",
  headerDiscount: 0, docType: 1, direction: "debit", deleted: false, read: false, dismissed: false, payment: "credit", exchangeRate: 1,
  lines: [{ id: "1", lineKind: "item", inventoryItemId: "i", itemName: "Synthetic", warehouseId: "w", warehouseName: "W", quantity: 2, price: 5, total: 10, discount: 0, bonus: 0, unit: "حبة", unitNum: 1, details: "", expiryDate: "" }],
};
test("explicit quote copy preserves notes and fields without mutating source and uses a stable draft identity", () => {
  const original=structuredClone(record),draft=legacyRecordDraft(record,state);
  assert.equal(draft.intent,"quote");assert.equal(draft.fields.payment,"credit");assert.equal(draft.fields.amount,"10");assert.equal(draft.fields.entryNumber,"101");
  assert.equal(draft.fields.rows.length,1);assert.ok(draft.fields.note.includes(record.details));assert.ok(draft.fields.note.includes("Ref"));
  assert.equal(legacyRecordDraft(record,state).entryId,draft.entryId);assert.deepEqual(record,original);
});
test("copy keeps deleted original deleted and preserves valid cashbox while rejecting unsupported values", () => {
  const deleted={...record,recordKind:"trash" as const,deleted:true,docType:2,payment:"cash" as const,cashboxId:7};
  const draft=legacyRecordDraft(deleted,state);assert.equal(draft.intent,"invoice");assert.equal(draft.fields.payment,"cash");assert.equal(draft.fields.cashboxId,7);assert.equal(deleted.deleted,true);
  for(const change of [{accountId:"missing"},{currency:"unknown"},{amount:NaN},{amount:-1},{exchangeRate:2},{headerDiscount:1},{draftBlockedReason:"bad source"},{entryDate:"2026-02-30"}])assert.throws(()=>legacyRecordDraft({...record,...change},state));
  assert.throws(()=>legacyRecordDraft({...record,payment:"cash"},state),/الصندوق/);
  assert.throws(()=>legacyRecordDraft({...deleted,docType:1},state),/سند/);
  assert.throws(()=>legacyRecordDraft({...record,lines:[{...record.lines![0],warehouseId:"missing"}]},state),/المخازن/);
  assert.throws(()=>legacyRecordDraft({...record,amount:11},state),/مجموع/);
});
