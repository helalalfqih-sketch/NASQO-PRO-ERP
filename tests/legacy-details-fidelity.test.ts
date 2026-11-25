import test from "node:test";
import assert from "node:assert/strict";
import { unifiedDetailToLegacyInvoice } from "../src/legacy/unifiedView";
import { buildInvoicePdfSummaryData, invoiceSourceDetailBlocks, paginateInvoiceSourceDetails } from "../src/utils/exportPdf";
import type { LedgerEntryRecord } from "../src/types";
import type { UnifiedInvoiceDetail } from "../src/firebase";

const notes = `بداية\n${"تفصيل محفوظ ".repeat(300)}نهاية — [لا تقص]`;
const entry: LedgerEntryRecord = {
  id:"legacy-ent-1",ownerId:"local-erp-workspace",accountId:"legacy-acc-1",accountName:"حساب اصطناعي",
  counterpartAccountId:"",counterpartAccountName:"",kind:"invoice",typeLabel:"فاتورة بيع",payment:"credit",direction:"debit",
  amount:100,rawDain:100,rawMadin:0,currency:"ريال",exchangeRate:1,details:notes,documentNumber:"DOC-1",
  sourceReference:"REF-1",headerDiscount:7,warehouseId:"legacy-wh-1",warehouseName:"مخزن اصطناعي",
  invoiceContent:"items",entryNumber:1,deleted:false,entryDate:"2026-11-08",createdAtMs:0,
};
const detail: UnifiedInvoiceDetail = {entry,lines:[{
  id:1,lineKind:"item",inventoryItemId:"legacy-prod-1",itemName:"صنف اصطناعي",sku:"TEST-1",warehouseName:"مخزن اصطناعي",
  quantity:1,price:100,total:100,discount:3,bonus:2,unit:"حبة",unitNum:1,details:"تفاصيل البند",expiryDate:"2027-06-30",
}]};

test("legacy preview and PDF carry source metadata without subtracting discounts twice",()=>{
  const legacy=unifiedDetailToLegacyInvoice(detail);
  assert.equal(legacy.details,notes);assert.equal(legacy.sourceReference,"REF-1");
  assert.equal(legacy.headerDiscount,7);assert.equal(legacy.originalTotal,100);
  assert.equal(legacy.lines[0].total,100);assert.equal(legacy.lines[0].discount,3);
  assert.equal(legacy.lines[0].bonus,2);assert.equal(legacy.lines[0].expiryDate,"2027-06-30");
  const summary=buildInvoicePdfSummaryData({...entry,lines:detail.lines.map(l=>({...l,inventoryItemId:l.inventoryItemId??undefined}))});
  assert.equal(summary.amount,100);assert.equal(summary.notes,notes);
  assert.equal(summary.sourceReference,"REF-1");assert.equal(summary.headerDiscount,7);
  assert.equal(summary.lines[0].lineTotal,"100");
  const blocks=invoiceSourceDetailBlocks(summary).join("\n");
  for(const token of [notes,"REF-1","خصم الفاتورة المسجل: 7","خصم البند المسجل: 3","الكمية المجانية: 2","2027-06-30","تفاصيل البند"])assert.ok(blocks.includes(token),token.slice(0,30));
});

test("complete PDF detail layout paginates long notes and references without dropping characters",()=>{
  const summary=buildInvoicePdfSummaryData({...entry,sourceReference:"R".repeat(1600)});
  const blocks=invoiceSourceDetailBlocks(summary);
  const pages=paginateInvoiceSourceDetails(summary,text=>Array.from(text).length*10,200,10);
  assert.ok(pages.length>10);assert.ok(pages.every(p=>p.length<=10));
  assert.ok(pages.flat().every(line=>Array.from(line).length<=20));
  // Only original newlines and paragraph separators may move during wrapping.
  assert.equal(pages.flat().join(""),blocks.join("").replace(/\r|\n/g,""));
});
