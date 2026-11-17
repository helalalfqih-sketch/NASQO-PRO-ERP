import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "../../firebase";
import { KeyboardInput, KeyboardTextarea } from "../../mobile";

type Product = {id:number;name:string;unit:string};
type Store = {id:number;name:string};
type Lookup = {products:Product[];stores:Store[]};
type Transfer = {id:number;date:string;type:number;fromId:number;toId:number;fromName:string|null;toName:string|null;lineCount:number};
type Line = {productId:string;quantity:string};

const BASE = new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname;
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{
 const user=auth.currentUser;
 if(!user)throw new Error("يجب تسجيل الدخول بحساب Google.");
 const token=await user.getIdToken();
 const response=await fetch(BASE+path,{
  method,headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 const json=await response.json().catch(()=>({error:"تعذر قراءة استجابة الخادم."}));
 if(!response.ok)throw new Error(json.error||"تعذر الاتصال بقاعدة المخزون.");
 return json as T;
}
const localDate=()=>{
 const d=new Date();
 return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
export function SmartProTransfersPanel({canWrite}:{canWrite:boolean}){
 const [lookup,setLookup]=useState<Lookup|null>(null);
 const [recent,setRecent]=useState<Transfer[]>([]);
 const [fromId,setFromId]=useState("");
 const [toId,setToId]=useState("");
 const [date,setDate]=useState(localDate);
 const [note,setNote]=useState("");
 const [search,setSearch]=useState("");
 const [productId,setProductId]=useState("");
 const [quantity,setQuantity]=useState("1");
 const [lines,setLines]=useState<Line[]>([]);
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const requestKey=useRef<string|null>(null);

 const refresh=async()=>{
  setLoading(true);setError("");
  try{
   const [catalog,history]=await Promise.all([
    request<Lookup>("invoice/lookup"),
    request<{rows:Transfer[]}>("warehouse/transfers"),
   ]);
   setLookup(catalog);setRecent(history.rows);
   setFromId(old=>old||String(catalog.stores[0]?.id??""));
   setToId(old=>old||String(catalog.stores[1]?.id??""));
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[]);
 const products=useMemo(()=>{
  const q=search.trim().toLocaleLowerCase("ar");
  return (lookup?.products??[]).filter(p=>!q||p.name.toLocaleLowerCase("ar").includes(q)||String(p.id).includes(q)).slice(0,75);
 },[lookup,search]);
 const addLine=()=>{
  if(!productId||!(Number(quantity)>0)||!Number.isFinite(Number(quantity))){
   setError("اختر صنفًا وأدخل كمية موجبة.");return;
  }
  if(lines.some(l=>l.productId===productId)){
   setError("الصنف مكرر؛ احذف البند السابق أو اجمع كميته.");return;
  }
  setLines(prev=>[...prev,{productId,quantity}]);
  setQuantity("1");setProductId("");setSearch("");setError("");
 };
 const save=async()=>{
  if(!canWrite){setError("تحويلات المخزون مقفلة حتى اعتماد مطابقة الجرد.");return}
  if(!fromId||!toId||fromId===toId||!lines.length){
   setError("اختر مخزنين مختلفين وبندًا واحدًا على الأقل.");return;
  }
  setSaving(true);setError("");setSuccess("");
  try{
   if(!requestKey.current)requestKey.current=crypto.randomUUID();
   const result=await request<{id:string;lineCount:number;duplicate?:boolean}>("warehouse/transfer","POST",{
    requestId:requestKey.current,sourceStoreId:fromId,destinationStoreId:toId,date,note,lines,
   });
   requestKey.current=null;
   setLines([]);setNote("");
   setSuccess("تم تسجيل التحويل رقم "+result.id+" وبنوده"+(result.duplicate?" (إعادة تأكيد طلب سابق)":"")+".");
   const refreshed=await request<{rows:Transfer[]}>("warehouse/transfers");
   setRecent(refreshed.rows);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setSaving(false)}
 };
 return <section className="smartpro-panel" data-testid="smartpro-transfers-panel">
  <h3>التحويلات بين المخازن — MariaDB</h3>
  <p className="smartpro-caption">إنشاء رأس التحويل والبنود وسجل التدقيق في معاملة واحدة، بدون كتابة إلى Firestore أو IndexedDB.</p>
  {!canWrite?<p className="smartpro-alert">التحويلات غير مفعّلة حتى مطابقة الرصيد المتاح بالمخازن واعتماد إعدادات الكتابة المركزية.</p>:null}
  {loading?<p role="status">جارٍ تحميل الأصناف والمخازن...</p>:null}
  {error?<p className="smartpro-alert" role="alert">{error}</p>:null}
  {success?<p className="smartpro-success" role="status">{success}</p>:null}
  {lookup?<div className="smartpro-invoice-form">
   <div className="smartpro-invoice-grid">
    <label className="smartpro-label">من مخزن
     <select value={fromId} onChange={e=>setFromId(e.target.value)}>
      {lookup.stores.map(s=><option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
     </select>
    </label>
    <label className="smartpro-label">إلى مخزن
     <select value={toId} onChange={e=>setToId(e.target.value)}>
      {lookup.stores.map(s=><option key={s.id} value={s.id}>{s.name} #{s.id}</option>)}
     </select>
    </label>
   </div>
   <label className="smartpro-label">التاريخ
    <KeyboardInput type="date" value={date} onChange={e=>setDate(e.target.value)}/>
   </label>
   <div className="smartpro-invoice-line-entry">
    <label className="smartpro-label">البحث عن الصنف
     <KeyboardInput value={search} onChange={e=>{setSearch(e.target.value);setProductId("")}} placeholder="الاسم أو رقم الصنف"/>
    </label>
    <label className="smartpro-label">الصنف
     <select value={productId} onChange={e=>setProductId(e.target.value)}>
      <option value="">اختر صنفًا</option>
      {products.map(p=><option key={p.id} value={p.id}>{p.name} #{p.id}</option>)}
     </select>
    </label>
    <label className="smartpro-label">الكمية
     <KeyboardInput value={quantity} inputMode="decimal" onChange={e=>setQuantity(e.target.value)}/>
    </label>
    <button type="button" className="smartpro-primary" onClick={addLine}>إضافة صنف للتحويل</button>
   </div>
   {lines.map(l=><div className="smartpro-invoice-line" key={l.productId}>
    <strong>{lookup.products.find(p=>String(p.id)===l.productId)?.name??l.productId}</strong>
    <span>الكمية: {l.quantity}</span>
    <button type="button" onClick={()=>setLines(items=>items.filter(x=>x.productId!==l.productId))}>حذف البند</button>
   </div>)}
   <label className="smartpro-label">بيان التحويل
    <KeyboardTextarea rows={2} value={note} onChange={e=>setNote(e.target.value)}/>
   </label>
   <button type="button" className="smartpro-primary"
    disabled={!canWrite||saving||!lines.length||fromId===toId}
    onClick={()=>void save()} data-testid="smartpro-post-transfer">
    {saving?"جارٍ حفظ التحويل...":"حفظ التحويل وبنوده"}
   </button>
  </div>:null}
  <h3>أحدث الحركات المخزنية</h3>
  <button type="button" onClick={()=>void refresh()}>تحديث الحركات</button>
  {recent.map(t=><article className="smartpro-record" key={t.id}>
   <div className="smartpro-record-head">
    <strong>تحويل #{t.id} — {t.type===1?"بين مخزنين":"نوع حركة "+t.type}</strong>
    <small>{t.date}</small>
   </div>
   <div className="smartpro-record-details">
    <span>من: {t.fromName??"مخزن مفقود #"+t.fromId}</span>
    <span>إلى: {t.toName??"مخزن مفقود #"+t.toId}</span>
    <span>{t.lineCount} بند</span>
   </div>
  </article>)}
 </section>;
}
