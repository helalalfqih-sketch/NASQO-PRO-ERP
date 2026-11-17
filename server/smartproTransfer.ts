import { formatScaled } from "./smartproInvoice.ts";
import { InputError, validId } from "./smartproPolicy.ts";
import { requireIsoDate } from "./smartproReports.ts";

const FIXED = 10_000n;
const MAX_QTY = 999_999_999n * FIXED;
export function quantityFixed(raw:unknown):bigint {
 if(typeof raw!=="string"&&typeof raw!=="number")throw new InputError("الكمية يجب أن تكون رقمًا.");
 const s=String(raw);
 if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(s))
  throw new InputError("الكمية غير صحيحة، أو تحتوي على أكثر من أربع خانات عشرية.");
 const [whole,fraction=""]=s.split(".");
 const n=BigInt(whole)*FIXED+BigInt(fraction.padEnd(4,"0"));
 if(n<=0n||n>MAX_QTY)throw new InputError("الكمية غير موجبة أو خارج المدى.");
 return n;
}
export function signedQuantityFixed(raw:unknown):bigint {
 const value=String(raw);
 if(!/^-?\d+(?:\.\d{1,4})?$/.test(value))throw new InputError("قيمة الرصيد المخزني غير مفهومة.");
 const negative=value.startsWith("-");
 const [whole,fraction=""]=value.replace("-","").split(".");
 const result=BigInt(whole)*FIXED+BigInt(fraction.padEnd(4,"0"));
 return negative?-result:result;
}
export type StockTransferPosting = {
 requestId:string;sourceStoreId:string;destinationStoreId:string;
 date:string;note:string;lines:{productId:string;quantity:string}[];
};
export function validateStockTransfer(raw:unknown):StockTransferPosting {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new InputError("طلب التحويل غير صالح.");
 const r=raw as Record<string,unknown>;
 if(typeof r.requestId!=="string" ||
   !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.requestId))
  throw new InputError("مفتاح منع تكرار التحويل غير صالح.");
 const sourceStoreId=validId(r.sourceStoreId);
 const destinationStoreId=validId(r.destinationStoreId);
 if(sourceStoreId===destinationStoreId)throw new InputError("مخزن المصدر والوجهة يجب أن يختلفا.");
 const note=r.note==null?"":String(r.note).trim();
 if(note.length>500)throw new InputError("بيان التحويل طويل.");
 const date=requireIsoDate(r.date,new Date().toISOString().slice(0,10));
 if(!Array.isArray(r.lines)||r.lines.length<1||r.lines.length>60)
  throw new InputError("يجب أن يحتوي التحويل على بند واحد إلى 60 بندًا.");
 const seen=new Set<string>();
 const lines=r.lines.map(item=>{
  if(!item||typeof item!=="object"||Array.isArray(item))throw new InputError("بند تحويل غير صالح.");
  const line=item as Record<string,unknown>;
  const productId=validId(line.productId);
  if(seen.has(productId))throw new InputError("الصنف مكرر في التحويل.");
  seen.add(productId);
  return {productId,quantity:formatScaled(quantityFixed(line.quantity))};
 });
 return {requestId:r.requestId.toLowerCase(),sourceStoreId,destinationStoreId,date,note,lines};
}
