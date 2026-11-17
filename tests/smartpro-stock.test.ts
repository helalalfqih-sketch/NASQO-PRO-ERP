import assert from "node:assert/strict";
import { test } from "node:test";
import { InputError } from "../server/smartproPolicy.ts";
import { quantityFixed, signedQuantityFixed, validateStockTransfer } from "../server/smartproTransfer.ts";
import { stockFindings, pageParams, requireIsoDate, type StockMovementRow } from "../server/smartproReports.ts";

const transfer={
 requestId:"11111111-1111-4111-8111-111111111111",
 sourceStoreId:"6",destinationStoreId:"7",
 date:"2026-11-17",note:"تحويل تجريبي",
 lines:[{productId:"13",quantity:"1.5"},{productId:"22",quantity:"0.25"}],
};
test("warehouse transfer maps to original SmartPro warehouse and product references",()=>{
 const r=validateStockTransfer(transfer);
 assert.equal(r.sourceStoreId,"6");
 assert.equal(r.destinationStoreId,"7");
 assert.equal(r.lines[0].quantity,"1.5");
 assert.equal(r.lines[1].quantity,"0.25");
});
test("warehouse transfer rejects malformed, duplicate and self-transfers",()=>{
 for(const bad of [
  {...transfer,requestId:"not-uuid"},
  {...transfer,sourceStoreId:"7"},
  {...transfer,destinationStoreId:"-1"},
  {...transfer,lines:[]},
  {...transfer,lines:[transfer.lines[0],transfer.lines[0]]},
  {...transfer,lines:[{productId:"13",quantity:"-1"}]},
  {...transfer,lines:[{productId:"13",quantity:"0"}]},
  {...transfer,lines:[{productId:"13",quantity:"1.11111"}]},
  {...transfer,lines:[{productId:"13",quantity:"1e6"}]},
  {...transfer,date:"2026-02-30"},
  {...transfer,note:"x".repeat(501)},
 ])assert.throws(()=>validateStockTransfer(bad),InputError);
});
test("quantities use fixed four-decimal integer math",()=>{
 assert.equal(quantityFixed("12.3456"),123456n);
 assert.equal(signedQuantityFixed("-0.0001"),-1n);
 assert.equal(signedQuantityFixed("2.04"),20400n);
 assert.throws(()=>signedQuantityFixed("not-a-number"),InputError);
});
test("stock reconciliation flags lost warehouses and negative active quantities separately",()=>{
 const rows=[
  {productId:3,warehouseId:6,warehouseName:"Main",warehouseState:1,productName:"A",netMovementQuantity:"-1.00"},
  {productId:3,warehouseId:5,warehouseName:"Retired",warehouseState:0,productName:"A",netMovementQuantity:"-4.50"},
  {productId:4,warehouseId:3,warehouseName:null,warehouseState:null,productName:"B",netMovementQuantity:"8.00"},
 ] as StockMovementRow[];
 const result=stockFindings(rows,[{transferType:1,sourceWarehouseId:2,destinationWarehouseId:3,documents:2,unknownSources:2,unknownDestinations:2}]);
 assert.equal(result.positions,3);
 assert.equal(result.negativePositions,2);
 assert.equal(result.negativeProducts,1);
 assert.equal(result.negativeActivePositions,1);
 assert.equal(result.unresolvedPositions,1);
 assert.deepEqual(result.missingWarehouseIds,[2,3]);
 assert.equal(result.status,"RECONCILIATION_REQUIRED");
});
test("date and pagination inputs cannot become an unchecked SQL range",()=>{
 assert.equal(requireIsoDate("2026-11-17","1900-01-01"),"2026-11-17");
 assert.deepEqual(pageParams(undefined,undefined),{offset:0,limit:40});
 for(const bad of ["2026-02-31","2099/12/31","2026-01-01 OR 1=1"])assert.throws(()=>requireIsoDate(bad,"1900-01-01"),InputError);
 for(const invalid of [{offset:-1,limit:1},{offset:100001,limit:5},{offset:1,limit:501}])
  assert.throws(()=>pageParams(invalid.offset,invalid.limit),InputError);
});
