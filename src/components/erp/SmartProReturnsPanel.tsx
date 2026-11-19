import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "../../firebase";
import { KeyboardInput, KeyboardTextarea } from "../../mobile";

type SourceInvoice = {
 id:number;date:string;documentType:number;accountId:number;accountName:string;cashboxId:number;
};
type SourceLine = {
 id:number;prod_id:number;store_id:number;price:string;amount:string;unit:string;
 product_name:string;returned_quantity:string;
};
type ReturnSource = {
 invoice:{id:number;date:string;doc_type:number;account_name:string};
 lines:SourceLine[];
};
const API = new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname;
async function call<T>(path:string,method="GET",body?:unknown):Promise<T>{
 const user=auth.currentUser;
 if(!user)throw new Error("يلزم تسجيل الدخول بحساب Google.");
 const token=await user.getIdToken();
 const response=await fetch(API+path,{
  method,headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 const json=await response.json().catch(()=>({error:"تعذر قراءة الرد."}));
 if(!response.ok)throw new Error(json.error||"تعذر الوصول إلى مرتجعات SmartPro.");
 return json as T;
}
const dateToday=()=>{
 const now=new Date();
 return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const fmt=(value:string|number)=>Number(value).toLocaleString("ar-YE",{maximumFractionDigits:4});
export function SmartProReturnsPanel({canWrite,stockVerified}:{
 canWrite:boolean;stockVerified:boolean;
}){
 const [sources,setSources]=useState<SourceInvoice[]>([]);
 const [sourceId,setSourceId]=useState("");
 const [details,setDetails]=useState<ReturnSource|null>(null);
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [date,setDate]=useState(dateToday);
 const [note,setNote]=useState("");
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const key=useRef<string|null>(null);
 useEffect(()=>{
  let cancelled=false;
  void call<{rows:SourceInvoice[]}>("invoice/returnable")
   .then(result=>{if(!cancelled){setSources(result.rows);setSourceId(old=>old||String(result.rows[0]?.id??""))}})
   .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e))})
   .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[]);
 const loadSource=async(id:string)=>{
  if(!id){setDetails(null);return}
  setLoading(true);setError("");setDetails(null);setQuantities({});
  try{setDetails(await call<ReturnSource>("invoice/returnable/"+encodeURIComponent(id)))}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 };
 useEffect(()=>{if(sourceId)void loadSource(sourceId)},[sourceId]);
 const lines=useMemo(()=>{
  return details?.lines
   .map(item=>({
    sourceLineId:String(item.id),
    quantity:(quantities[String(item.id)]??"").trim(),
    maximum:Math.max(0,Number(item.amount)-Number(item.returned_quantity)),
    item,
   }))
   .filter(item=>item.quantity!==""&&Number(item.quantity)>0)??[];
 },[details,quantities]);
 const isPurchaseReturn=details?.invoice.doc_type===3;
 const save=async()=>{
  if(!canWrite){setError("لم يتم اعتماد تفعيل مرتجعات SmartPro.");return}
  if(isPurchaseReturn&&!stockVerified){setError("مردود المشتريات يصرف مخزونًا؛ يلزم اعتماد الجرد أولًا.");return}
  if(!sourceId||!lines.length){setError("حدد الفاتورة الأصلية وكميات البنود المرتجعة.");return}
  if(lines.some(l=>!Number.isFinite(Number(l.quantity))||Number(l.quantity)>l.maximum)){
   setError("كمية أحد البنود تتجاوز المتاح للإرجاع.");return;
  }
  setSaving(true);setError("");setSuccess("");
  try {
   if(!key.current)key.current=crypto.randomUUID();
   const result=await call<{id:string;total:string;sourceId:string;duplicate?:boolean}>("invoice/return","POST",{
    requestId:key.current,sourceInvoiceId:sourceId,date,note,
    lines:lines.map(l=>({sourceLineId:l.sourceLineId,quantity:l.quantity})),
   });
   key.current=null;setQuantities({});setNote("");
   setSuccess("سُجّل المرتجع رقم "+result.id+" بقيمة "+fmt(result.total)+(result.duplicate?" (تأكيد لطلب سبق حفظه)":"")+".");
   await loadSource(sourceId);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setSaving(false)}
 };
 return <section className="smartpro-panel" data-testid="smartpro-returns-panel">
  <h3>مرتجعات المبيعات والمشتريات</h3>
  <p className="smartpro-caption">يرتبط كل مرتجع بالفاتورة الأصلية وبنودها، ولا يمكن إعادة كمية تتجاوز الكمية المتاحة.</p>
  {!canWrite?<p className="smartpro-alert">إنشاء المرتجعات غير مفعل حتى اعتماد الترحيل المحاسبي. يمكنك مراجعة الفواتير المؤهلة.</p>:null}
  {loading?<p role="status">جارٍ تحميل الفواتير ومتاح المرتجع...</p>:null}
  {error?<p className="smartpro-alert" role="alert">{error}</p>:null}
  {success?<p className="smartpro-success" role="status">{success}</p>:null}
  {sources.length===0&&!loading?<p>لا توجد فواتير متاحة لإصدار مرتجع مرتبط بها حالياً.</p>:null}
  {sources.length>0?<div className="smartpro-invoice-form">
   <div className="smartpro-invoice-grid">
    <label className="smartpro-label">الفاتورة الأصلية
     <select value={sourceId} onChange={e=>{setSourceId(e.target.value);key.current=null}}>
      {sources.map(src=><option value={src.id} key={src.id}>
       #{src.id} — {src.documentType===2?"مبيعات":"مشتريات"} — {src.accountName}
      </option>)}
     </select>
    </label>
    <label className="smartpro-label">تاريخ المرتجع
     <KeyboardInput type="date" value={date} onChange={e=>setDate(e.target.value)}/>
    </label>
   </div>
   {details?<div className="smartpro-detail-box">
    <h3>جدول بنود الفاتورة #{details.invoice.id}</h3>
    <div className="smartpro-table-wrap">
     <table className="smartpro-inv-table">
      <thead>
       <tr>
        <th>الصنف</th>
        <th>السعر</th>
        <th>المتاح</th>
        <th>المرتجع</th>
       </tr>
      </thead>
      <tbody>
       {details.lines.map(line=>{
        const remaining=Math.max(0,Number(line.amount)-Number(line.returned_quantity));
        return <tr key={line.id}>
         <td className="name-cell">
          <strong>{line.product_name}</strong>
          <small style={{display:"block",color:"#64748b"}}>أصل: {fmt(line.amount)} · سابق: {fmt(line.returned_quantity)} {line.unit}</small>
         </td>
         <td className="num-cell">{fmt(line.price)}</td>
         <td className="num-cell"><b>{fmt(remaining)}</b></td>
         <td>
          <KeyboardInput
           className="smartpro-cell-input"
           aria-label={`الكمية المرتجعة لصنف ${line.product_name}`}
           inputMode="decimal"
           disabled={remaining<=0}
           placeholder="0"
           value={quantities[String(line.id)]??""}
           onChange={e=>setQuantities(q=>({...q,[line.id]:e.target.value}))}
          />
         </td>
        </tr>;
       })}
      </tbody>
     </table>
    </div>
   </div>:null}
   <label className="smartpro-label">سبب/بيان المرتجع
    <KeyboardTextarea rows={2} value={note} onChange={e=>setNote(e.target.value)}/>
   </label>
   {isPurchaseReturn&&!stockVerified?<p className="smartpro-alert">مردود المشتريات يحتاج مطابقة رصيد المخزن.</p>:null}
   <button type="button" className="smartpro-primary"
    disabled={!canWrite||saving||!lines.length||(isPurchaseReturn&&!stockVerified)}
    data-testid="smartpro-post-return" onClick={()=>void save()}>
    {saving?"جارٍ حفظ المرتجع...":"ترحيل المرتجع وبنوده"}
   </button>
  </div>:null}
 </section>;
}
