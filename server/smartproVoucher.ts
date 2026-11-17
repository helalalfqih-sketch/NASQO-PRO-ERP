import { InputError, validId } from "./smartproPolicy.ts";
import { requireIsoDate } from "./smartproReports.ts";
import { formatScaled,scaledPositive } from "./smartproInvoice.ts";

export type VoucherPosting={
 requestId:string;
 accountId:string;
 cashboxId:string;
 currencyId:string;
 direction:"dain"|"madin";
 amount:string;
 date:string;
 note:string;
 documentNumber:string;
};
export function validateVoucher(raw:unknown):VoucherPosting{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new InputError("طلب السند غير صالح.");
 const r=raw as Record<string,unknown>;
 if(typeof r.requestId!=="string"||
   !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.requestId))
  throw new InputError("مفتاح منع تكرار السند غير صالح.");
 if(r.direction!=="dain"&&r.direction!=="madin")throw new InputError("اختر حركة السند: دائن أو مدين.");
 const amount=formatScaled(scaledPositive(r.amount,"مبلغ السند"));
 const note=r.note==null?"":String(r.note).trim();
 const documentNumber=r.documentNumber==null?"":String(r.documentNumber).trim();
 if(!note||note.length>500)throw new InputError("يلزم بيان للسند من 1 إلى 500 حرف.");
 if(documentNumber.length>60)throw new InputError("رقم المستند طويل.");
 return {
  requestId:r.requestId.toLowerCase(),
  accountId:validId(r.accountId),
  cashboxId:validId(r.cashboxId),
  currencyId:validId(r.currencyId),
  direction:r.direction,
  amount,
  date:requireIsoDate(r.date,new Date().toISOString().slice(0,10)),
  note,documentNumber,
 };
}
export function voucherSides(posting:VoucherPosting){
 return posting.direction==="dain"?
  {dain:posting.amount,madin:"0"}:
  {dain:"0",madin:posting.amount};
}
