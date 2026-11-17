import assert from "node:assert/strict";
import { test } from "node:test";
import { InputError } from "../server/smartproPolicy.ts";
import { validateVoucher,voucherSides } from "../server/smartproVoucher.ts";

const voucher={
 requestId:"12345678-1234-4234-8234-123456789012",
 accountId:"45",cashboxId:"2",currencyId:"1",
 direction:"dain",amount:"5000.25",date:"2026-11-17",
 note:"سند مالي تجريبي",documentNumber:"INV-15",
};
test("SmartPro doc_type=1 cashbox vouchers are one-sided and individually audited",()=>{
 const v=validateVoucher(voucher);
 assert.deepEqual(voucherSides(v),{dain:"5000.25",madin:"0"});
 assert.deepEqual(voucherSides(validateVoucher({...voucher,direction:"madin"})),{dain:"0",madin:"5000.25"});
 assert.equal(v.documentNumber,"INV-15");
});
test("invalid amounts, references, dates and descriptions reject before SQL",()=>{
 for(const bad of [
  {...voucher,requestId:"invalid"},
  {...voucher,amount:"-10"},
  {...voucher,amount:"0"},
  {...voucher,amount:"NaN"},
  {...voucher,amount:"5000.12345"},
  {...voucher,cashboxId:"0"},
  {...voucher,direction:"other"},
  {...voucher,date:"2026-02-31"},
  {...voucher,note:""},
  {...voucher,note:"x".repeat(501)},
  {...voucher,documentNumber:"x".repeat(61)},
 ])assert.throws(()=>validateVoucher(bad),InputError);
});
test("decimal vouchers never use floating point rounding",()=>{
 const v=validateVoucher({...voucher,amount:"0.0001"});
 assert.deepEqual(voucherSides(v),{dain:"0.0001",madin:"0"});
});
