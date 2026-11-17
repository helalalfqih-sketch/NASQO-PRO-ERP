import { InputError, validId } from "./smartproPolicy.ts";
import { quantityFixed } from "./smartproTransfer.ts";
import { formatScaled, scaledPositive } from "./smartproInvoice.ts";

const SCALE=10000n;
const MAX_TOTAL=999_999_999_999n*SCALE;
export type ReturnPosting={
 requestId:string;
 sourceInvoiceId:string;
 note:string;
 date:string;
 lines:{sourceLineId:string;quantity:string}[];
};
export function validateReturnPosting(raw:unknown):ReturnPosting{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new InputError("طلب المرتجع غير صالح.");
 const r=raw as Record<string,unknown>;
 if(typeof r.requestId!=="string"||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.requestId))
   throw new InputError("مفتاح المرتجع غير صالح.");
 const sourceInvoiceId=validId(r.sourceInvoiceId);
 const note=r.note==null?"":String(r.note).trim();
 if(note.length>500)throw new InputError("بيان المرتجع طويل جدًا.");
 const date=r.date;
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
    !Number.isFinite(Date.parse(date))||
    new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)
   throw new InputError("تاريخ المرتجع غير صحيح.");
 if(!Array.isArray(r.lines)||r.lines.length<1||r.lines.length>60)
   throw new InputError("يجب أن يحتوي المرتجع على بند واحد إلى 60 بندًا.");
 const keys=new Set<string>();
 const lines=r.lines.map(item=>{
   if(!item||typeof item!=="object"||Array.isArray(item))throw new InputError("بند مرتجع غير صالح.");
   const row=item as Record<string,unknown>;
   const sourceLineId=validId(row.sourceLineId);
   if(keys.has(sourceLineId))throw new InputError("بند المرتجع مكرر.");
   keys.add(sourceLineId);
   return {sourceLineId,quantity:formatScaled(quantityFixed(row.quantity))};
 });
 return {requestId:r.requestId.toLowerCase(),sourceInvoiceId,note,date,lines};
}
export function returnDocType(sourceType:number):4|5{
 if(sourceType===2)return 4;
 if(sourceType===3)return 5;
 throw new InputError("المرتجع يجب أن يُربط بفاتورة بيع أو شراء أصلية.",409);
}
export function returnLineValue(quantity:string,sourcePrice:string):string{
 const qty=quantityFixed(quantity);
 const price=scaledPositive(sourcePrice,"السعر الأصلي",true);
 const value=(qty*price+SCALE/2n)/SCALE;
 if(value>MAX_TOTAL)throw new InputError("إجمالي المرتجع خارج المدى.");
 return formatScaled(value);
}
export function returnFinancialSides(docType:4|5,total:string,cash:boolean){
 // Mirrors native SmartPro's sale/purchase return direction.
 return {
  dain:docType===5?total:cash?total:"0",
  madin:docType===4?total:cash?total:"0",
 };
}
