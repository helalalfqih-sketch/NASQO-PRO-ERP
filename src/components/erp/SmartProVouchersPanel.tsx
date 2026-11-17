import { useEffect, useRef, useState } from "react";
import { auth } from "../../firebase";
import { KeyboardInput, KeyboardTextarea } from "../../mobile";

type Choice={id:number;name:string};
type Lookup={accounts:Choice[];cashboxes:Choice[];currencies:Choice[]};
type Voucher={id:number;date:string;dain:string;madin:string;details:string;bill:string;
 accountName:string;cashboxName:string|null;currencyId:number};
const BASE=new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname;
async function request<T>(path:string,method="GET",body?:unknown):Promise<T>{
 const user=auth.currentUser;
 if(!user)throw new Error("يرجى تسجيل الدخول بحساب Google المصرح به.");
 const token=await user.getIdToken();
 const response=await fetch(BASE+path,{
  method,headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 const json=await response.json().catch(()=>({error:"تعذر قراءة الاستجابة."}));
 if(!response.ok)throw new Error(json.error||"تعذر الاتصال بالسندات.");
 return json as T;
}
const localDate=()=>{
 const d=new Date();
 return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
};
const amount=(value:string|number)=>Number(value).toLocaleString("ar-YE",{maximumFractionDigits:4});
export function SmartProVouchersPanel({canWrite}:{canWrite:boolean}){
 const [lookup,setLookup]=useState<Lookup|null>(null);
 const [recent,setRecent]=useState<Voucher[]>([]);
 const [accountId,setAccountId]=useState("");
 const [cashboxId,setCashboxId]=useState("");
 const [currencyId,setCurrencyId]=useState("");
 const [direction,setDirection]=useState<"dain"|"madin">("dain");
 const [value,setValue]=useState("");
 const [date,setDate]=useState(localDate);
 const [note,setNote]=useState("");
 const [documentNumber,setDocumentNumber]=useState("");
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [busy,setBusy]=useState(false);
 const [saving,setSaving]=useState(false);
 const key=useRef<string|null>(null);
 const load=async()=>{
  setBusy(true);setError("");
  try{
   const [look,history]=await Promise.all([
    request<Lookup>("voucher/lookup"),request<{rows:Voucher[]}>("voucher/recent"),
   ]);
   setLookup(look);setRecent(history.rows);
   setAccountId(old=>old||String(look.accounts[0]?.id??""));
   setCashboxId(old=>old||String(look.cashboxes[0]?.id??""));
   setCurrencyId(old=>old||String(look.currencies[0]?.id??""));
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 useEffect(()=>{void load()},[]);
 const save=async()=>{
  if(!canWrite){setError("لم تُفعّل صلاحيات ترحيل السندات بعد.");return}
  if(!accountId||!cashboxId||!currencyId||!(Number(value)>0)||!note.trim()){
   setError("أكمل الحساب والصندوق والعملة والمبلغ والبيان.");return;
  }
  setSaving(true);setError("");setSuccess("");
  try{
   if(!key.current)key.current=crypto.randomUUID();
   const result=await request<{id:string;direction:string;amount:string;duplicate?:boolean}>("voucher","POST",{
    requestId:key.current,accountId,cashboxId,currencyId,direction,
    amount:value,date,note,documentNumber,
   });
   key.current=null;setValue("");setNote("");setDocumentNumber("");
   setSuccess("حُفظ السند رقم "+result.id+" بقيمة "+amount(result.amount)+(result.duplicate?" (تم تأكيد الطلب السابق)":"")+".");
   const history=await request<{rows:Voucher[]}>("voucher/recent");
   setRecent(history.rows);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setSaving(false)}
 };
 return <section className="smartpro-panel" data-testid="smartpro-vouchers-panel">
  <h3>السندات المالية — SmartPro MariaDB</h3>
  <p className="smartpro-caption">سندات مرتبطة بحساب وصندوق، باستخدام نوع المستند 1 وحقلي dain/madin الأصليين. هذا ليس محرر قيود يومية مركبة.</p>
  {!canWrite?<p className="smartpro-alert">الترحيل المالي غير مفعل حتى اعتماد مطابقة السندات والأرصدة. السندات التاريخية معروضة للقراءة.</p>:null}
  {busy?<p role="status">جارٍ تحميل حسابات SmartPro والصناديق...</p>:null}
  {error?<p className="smartpro-alert" role="alert">{error}</p>:null}
  {success?<p className="smartpro-success" role="status">{success}</p>:null}
  {lookup?<div className="smartpro-invoice-form">
   <label className="smartpro-label">الحساب
    <select value={accountId} onChange={e=>setAccountId(e.target.value)}>
     {lookup.accounts.map(a=><option value={a.id} key={a.id}>{a.name} #{a.id}</option>)}
    </select>
   </label>
   <div className="smartpro-invoice-grid">
    <label className="smartpro-label">الصندوق
     <select value={cashboxId} onChange={e=>setCashboxId(e.target.value)}>
      {lookup.cashboxes.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}
     </select>
    </label>
    <label className="smartpro-label">العملة
     <select value={currencyId} onChange={e=>setCurrencyId(e.target.value)}>
      {lookup.currencies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
     </select>
    </label>
    <label className="smartpro-label">الحركة
     <select value={direction} onChange={e=>setDirection(e.target.value as "dain"|"madin")}>
      <option value="dain">دائن (dain)</option><option value="madin">مدين (madin)</option>
     </select>
    </label>
    <label className="smartpro-label">المبلغ
     <KeyboardInput inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} placeholder="0"/>
    </label>
    <label className="smartpro-label">التاريخ
     <KeyboardInput type="date" value={date} onChange={e=>setDate(e.target.value)}/>
    </label>
    <label className="smartpro-label">الرقم المرجعي
     <KeyboardInput value={documentNumber} onChange={e=>setDocumentNumber(e.target.value)}/>
    </label>
   </div>
   <label className="smartpro-label">بيان العملية
    <KeyboardTextarea rows={2} value={note} onChange={e=>setNote(e.target.value)}/>
   </label>
   <button type="button" className="smartpro-primary"
    disabled={!canWrite||saving||!note.trim()||!(Number(value)>0)}
    onClick={()=>void save()} data-testid="smartpro-post-voucher">
    {saving?"جارٍ حفظ السند...":"حفظ السند وتسجيله"}
   </button>
  </div>:null}
  <h3>آخر السندات</h3>
  <button type="button" onClick={()=>void load()}>تحديث السندات</button>
  {recent.map(v=><article className="smartpro-record" key={v.id}>
   <div className="smartpro-record-head"><strong>#{v.id} — {v.accountName}</strong><small>{v.date}</small></div>
   <p>{v.details||"بدون بيان"}</p>
   <div className="smartpro-record-details">
    <span>الصندوق: {v.cashboxName??"غير محدد"}</span>
    <span>دائن: {amount(v.dain)}</span><span>مدين: {amount(v.madin)}</span>
    <span>المرجع: {v.bill||"—"}</span>
   </div>
  </article>)}
 </section>;
}
