import assert from "node:assert/strict";
import { test } from "node:test";
import { InputError } from "../server/smartproPolicy.ts";
import { validateReturnPosting,returnDocType,returnLineValue,returnFinancialSides } from "../server/smartproReturns.ts";

const request={
 requestId:"12345678-1234-4234-8234-123456789012",
 sourceInvoiceId:"842",
 date:"2026-11-17",
 note:"مرتجع اختباري",
 lines:[{sourceLineId:"3144",quantity:"1.5"},{sourceLineId:"3145",quantity:"0.25"}],
};
test("return claims original invoice and detail IDs, never accepts arbitrary prices",()=>{
 const v=validateReturnPosting(request);
 assert.equal(v.sourceInvoiceId,"842");
 assert.equal(v.lines.length,2);
 assert.equal(v.lines[1].quantity,"0.25");
 assert.equal((v.lines[0] as Record<string,unknown>).price,undefined);
});
test("sale return reverses direction of original sale, purchase return reverses purchase",()=>{
 assert.equal(returnDocType(2),4);
 assert.equal(returnDocType(3),5);
 assert.deepEqual(returnFinancialSides(4,"120",false),{dain:"0",madin:"120"});
 assert.deepEqual(returnFinancialSides(4,"120",true),{dain:"120",madin:"120"});
 assert.deepEqual(returnFinancialSides(5,"500",false),{dain:"500",madin:"0"});
 assert.deepEqual(returnFinancialSides(5,"500",true),{dain:"500",madin:"500"});
 assert.throws(()=>returnDocType(1),InputError);
});
test("original unit price controls returned value with four-digit arithmetic",()=>{
 assert.equal(returnLineValue("1.5","1200.25"),"1800.375");
 assert.equal(returnLineValue("0.1","0.2"),"0.02");
 assert.throws(()=>returnLineValue("-1","400"),InputError);
 assert.throws(()=>returnLineValue("2","-400"),InputError);
});
test("invalid or duplicate source details and date are rejected before SQL",()=>{
 for(const bad of [
  {...request,sourceInvoiceId:"0"},
  {...request,requestId:"wrong"},
  {...request,date:"2026-02-31"},
  {...request,lines:[]},
  {...request,lines:[request.lines[0],request.lines[0]]},
  {...request,lines:[{sourceLineId:"3144",quantity:"0"}]},
  {...request,lines:[{sourceLineId:"3144",quantity:"1000.12345"}]},
  {...request,note:"x".repeat(501)},
 ])assert.throws(()=>validateReturnPosting(bad),InputError);
});
