export const TABLES = ["accounts","alerts","bill_details","bill_details2","bin","bin_bill_details","bin_bill_details2","bounds","boxes","cboxes","currencies","offers","offer_bill_details","offer_sbill_details","prems","products","stores","store_trans","trans_details","users"] as const;
export type TableName = (typeof TABLES)[number];
export type Role = "admin" | "editor" | "viewer";
export type Column = { name:string; type:string; nullable:boolean; autoIncrement:boolean; maxLength:number|null; hasDefault:boolean; defaultValue:string|null };
export class InputError extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
export function tableName(v:unknown):TableName {if(typeof v!=="string"||!(TABLES as readonly string[]).includes(v))throw new InputError("الجدول غير معروف",404);return v as TableName}
export function ident(v:string):string {if(!/^[a-z][a-z0-9_]*$/.test(v))throw new InputError("معرف غير صالح");return String.fromCharCode(96)+v+String.fromCharCode(96)}
export function editable(t:TableName,columns:Column[]):Column[]{return columns.filter(c=>c.name!=="password"&&c.name!=="id"&&!c.autoIncrement&&!(t==="users"&&c.name==="username"))}
export function visible(columns:Column[]):Column[]{return columns.filter(c=>c.name!=="password")}
export function validateFields(t:TableName,columns:Column[],raw:unknown):Record<string,string|number|null> {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new InputError("بيانات السجل غير صحيحة");
  const allowed=new Map(editable(t,columns).map(c=>[c.name,c]));
  const output:Record<string,string|number|null>={};
  for(const [key,val] of Object.entries(raw)){
    const col=allowed.get(key);
    if(!col)throw new InputError("حقل غير مسموح: "+key);
    if(val===null){if(!col.nullable)throw new InputError("لا يقبل الحقل قيمة فارغة: "+key);output[key]=null;continue}
    if(typeof val!=="string"&&typeof val!=="number")throw new InputError("قيمة غير صحيحة: "+key);
    if(["int","bigint","tinyint","smallint","mediumint","decimal","float","double"].includes(col.type)){
      const n=Number(val);
      if(!Number.isFinite(n)||(["int","bigint","tinyint","smallint","mediumint"].includes(col.type)&&!Number.isSafeInteger(n)))throw new InputError("رقم غير صحيح: "+key);
      output[key]=n;continue;
    }
    const text=String(val);
    if(text.length>80000||(col.maxLength!==null&&text.length>col.maxLength))throw new InputError("قيمة طويلة جدًا: "+key);
    if(["date","datetime","timestamp"].includes(col.type)&&text&&!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(text))throw new InputError("تاريخ غير صحيح: "+key);
    output[key]=text;
  }
  if(Object.keys(output).length===0)throw new InputError("اختر حقلاً واحدًا على الأقل");
  return output;
}
export function authorize(role:Role,action:"read"|"create"|"update"|"delete"|"roles"):void {
  if(action==="read")return;
  if((action==="create"||action==="update")&&(role==="editor"||role==="admin"))return;
  if(role==="admin")return;
  throw new InputError("ليس لديك صلاحية هذا الإجراء",403);
}
// Prevent isolated row-level mutations from bypassing financial posting,
// stock movement, archived document integrity and mandatory audit semantics.
export const ACCOUNTING_DOCUMENT_TABLES = new Set<TableName>([
  "bounds","bill_details","bill_details2",
  "bin","bin_bill_details","bin_bill_details2",
  "store_trans","trans_details",
  "offers","offer_bill_details","offer_sbill_details",
  "prems",
]);
export function requireDocumentWorkflow(table:TableName):void {
  if(ACCOUNTING_DOCUMENT_TABLES.has(table)) {
    throw new InputError("هذا جدول مستندات محاسبية؛ يجب إجراء التعديل عبر عملية مالية مترابطة، وليس تعديل صف منفرد.",409);
  }
}
export function validId(v:unknown):string {
  const id=String(v??"");
  if(!/^[1-9]\d{0,17}$/.test(id))throw new InputError("رقم السجل غير صحيح");
  return id;
}
