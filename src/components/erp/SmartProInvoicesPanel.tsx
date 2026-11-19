import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "../../firebase";
import { KeyboardInput, KeyboardTextarea } from "../../mobile";
import { matchesArabicSearch } from "../../accounting";

type Option = { id: string|number; name: string };
type Product = Option & { unit: string; sell_price:string; buy_price:string };
type Lookup = { accounts: Option[]; products: Product[]; stores: Option[]; cashboxes: Option[]; currencies: Option[] };
type Invoice = { id:number; date:string; doc_type:number; dain:string; madin:string; details:string; account_name:string; line_count:number };
type Line = { productId:string; storeId:string; quantity:string; price:string };
const BASE = new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname;
async function request<T>(path:string,method="GET",body?:unknown):Promise<T> {
  const user=auth.currentUser;
  if(!user)throw new Error("يلزم تسجيل الدخول بحساب Google المصرّح به.");
  const token=await user.getIdToken();
  const response=await fetch(BASE+path,{
    method,headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const json=await response.json().catch(()=>({error:"تعذر استجابة الخادم."}));
  if(!response.ok)throw new Error(json.error||"تعذر الوصول إلى الفواتير.");
  return json as T;
}
const money=(v:string|number)=>Number(v).toLocaleString("ar-YE",{maximumFractionDigits:4});
export function SmartProInvoicesPanel({canWrite,canSell}:{canWrite:boolean;canSell:boolean}) {
  const [lookup,setLookup]=useState<Lookup|null>(null);
  const [recent,setRecent]=useState<Invoice[]>([]);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [kind,setKind]=useState<"sale"|"purchase">("sale");
  const [payment,setPayment]=useState<"cash"|"credit">("credit");
  const [date,setDate]=useState(()=>{
    const now=new Date();
    return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  });
  const [accountId,setAccountId]=useState("");
  const [currencyId,setCurrencyId]=useState("");
  const [cashboxId,setCashboxId]=useState("");
  const [storeId,setStoreId]=useState("");
  const [search,setSearch]=useState("");
  const [productId,setProductId]=useState("");
  const [quantity,setQuantity]=useState("1");
  const [price,setPrice]=useState("");
  const [note,setNote]=useState("");
  const [lines,setLines]=useState<Line[]>([]);
  // Retain the same key after a timeout so retries do not double-post.
  const requestKey=useRef<string|null>(null);
  const [opened,setOpened]=useState<number|null>(null);
  const [detail,setDetail]=useState<{invoice:Record<string,unknown>;lines:(Record<string,unknown>)[]}|null>(null);

  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const [catalog,history]=await Promise.all([
        request<Lookup>("invoice/lookup"),request<{rows:Invoice[]}>("invoice/recent"),
      ]);
      setLookup(catalog);setRecent(history.rows);
      setAccountId(old=>old||String(catalog.accounts[0]?.id??""));
      setCurrencyId(old=>old||String(catalog.currencies[0]?.id??""));
      setCashboxId(old=>old||String(catalog.cashboxes[0]?.id??""));
      setStoreId(old=>old||String(catalog.stores[0]?.id??""));
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);
  const visibleProducts=useMemo(()=>{
    return (lookup?.products??[]).filter(p=>matchesArabicSearch(`${p.name} ${p.id}`,search)).slice(0,60);
  },[lookup,search]);
  const selected=lookup?.products.find(p=>String(p.id)===productId);
  const total=lines.reduce((sum,line)=>sum+Number(line.price)*Number(line.quantity),0);

  const selectProduct=(value:string)=>{
    setProductId(value);
    const p=lookup?.products.find(x=>String(x.id)===value);
    if(p)setPrice(kind==="sale"?p.sell_price:p.buy_price);
  };
  const addLine=()=>{
    if(!productId||!storeId||!Number.isFinite(Number(quantity))||Number(quantity)<=0||
       !Number.isFinite(Number(price))||Number(price)<0){
      setError("اختر الصنف والمخزن وأدخل كمية وسعرًا صالحين.");return;
    }
    if(lines.some(l=>l.productId===productId&&l.storeId===storeId)){
      setError("الصنف مضاف بالفعل لهذا المخزن؛ عدّل كميته أو احذف البند القديم.");return;
    }
    setLines(prev=>[...prev,{productId,storeId,quantity,price}]);
    setError("");setProductId("");setQuantity("1");setPrice("");setSearch("");
  };
  const save=async()=>{
    if(!canWrite){setError("لم تُفعّل صلاحية ترحيل الفواتير على الخادم.");return;}
    if(kind==="sale"&&!canSell){setError("مبيعات الأصناف مقفلة حتى مطابقة أرصدة المخازن.");return;}
    if(!accountId||!currencyId||!lines.length||(payment==="cash"&&!cashboxId)){
      setError("أكمل الحساب والعملة والبنود والصندوق عند الدفع النقدي.");return;
    }
    setSaving(true);setError("");setSuccess("");
    try {
      if(!requestKey.current)requestKey.current=crypto.randomUUID();
      const posted=await request<{id:number;total:string;lineCount:number}>("invoice","POST",{
        requestId:requestKey.current,type:kind,payment,accountId,currencyId,
        cashboxId:payment==="cash"?cashboxId:undefined,
        date,note,lines,
      });
      requestKey.current=null;
      setLines([]);setNote("");setProductId("");
      setSuccess("حُفظت الفاتورة رقم "+posted.id+" بقيمة "+money(posted.total)+"، مع بنودها وسجل التدقيق.");
      const result=await request<{rows:Invoice[]}>("invoice/recent");
      setRecent(result.rows);
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  };
  const openDetail=async(id:number)=>{
    setOpened(id);setDetail(null);setError("");
    try{setDetail(await request("invoice/"+id))}
    catch(e){setError(e instanceof Error?e.message:String(e))}
  };

  const updateLineField=(index:number,field:"quantity"|"price",value:string)=>{
    setLines(list=>list.map((row,i)=>i===index?{...row,[field]:value}:row));
  };

  return <section className="smartpro-panel" data-testid="smartpro-invoice-workflow">
    <h3>إنشاء ومراجعة الفواتير</h3>
    <p className="smartpro-caption">تُحفظ الفاتورة مع كامل بنودها وأثرها المحاسبي والمخزني في خطوة واحدة.</p>
    {loading?<p role="status">جارٍ تحميل الحسابات والأصناف والمخازن...</p>:null}
    {error?<p role="alert" className="smartpro-alert">{error}</p>:null}
    {success?<p role="status" className="smartpro-success">{success}</p>:null}
    {!canWrite?<p className="smartpro-alert">إنشاء الفواتير غير متاح حاليًا حتى تفعيل صلاحية الترحيل المحاسبي.</p>:null}
    {!canSell?<p className="smartpro-alert">المبيعات محمية مؤقتًا حتى مطابقة أرصدة المخزون.</p>:null}
    {lookup?<div className="smartpro-invoice-form">
      <div className="smartpro-invoice-grid">
        <label className="smartpro-label">نوع العملية
          <select value={kind} onChange={e=>{setKind(e.target.value as "sale"|"purchase");setLines([]);setProductId("");setPrice("")}}>
            <option value="sale">فاتورة مبيعات</option><option value="purchase">فاتورة مشتريات</option>
          </select>
        </label>
        <label className="smartpro-label">طريقة الدفع
          <select value={payment} onChange={e=>setPayment(e.target.value as "cash"|"credit")}>
            <option value="credit">آجل</option><option value="cash">نقدًا</option>
          </select>
        </label>
        <label className="smartpro-label">التاريخ
          <KeyboardInput type="date" dir="ltr" value={date} onChange={e=>setDate(e.target.value)}/>
        </label>
        <label className="smartpro-label">الحساب
          <select value={accountId} onChange={e=>setAccountId(e.target.value)}>
            {lookup.accounts.map(a=><option key={a.id} value={a.id}>{a.name} (#{a.id})</option>)}
          </select>
        </label>
        <label className="smartpro-label">العملة
          <select value={currencyId} onChange={e=>setCurrencyId(e.target.value)}>
            {lookup.currencies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {payment==="cash"?<label className="smartpro-label">الصندوق
          <select value={cashboxId} onChange={e=>setCashboxId(e.target.value)}>
            {lookup.cashboxes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>:null}
        <label className="smartpro-label">المخزن
          <select value={storeId} onChange={e=>setStoreId(e.target.value)}>
            {lookup.stores.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      </div>
      <div className="smartpro-invoice-line-entry">
        <label className="smartpro-label">بحث عن صنف
          <KeyboardInput
            placeholder="اسم الصنف أو رقمه"
            value={search}
            onChange={e=>{setSearch(e.target.value);setProductId("")}}
            onKeyDown={e=>{
              if(e.key==="Enter"&&visibleProducts.length>0){
                e.preventDefault();
                selectProduct(String(visibleProducts[0].id));
                setSearch("");
              }
            }}
          />
        </label>
        {search.trim()?(
          <div className="instant-search-results" role={visibleProducts.length?"listbox":"status"}>
            {visibleProducts.length===0?(
              <p className="instant-search-empty">لا توجد أصناف مطابقة لـ «{search.trim()}»</p>
            ):(
              visibleProducts.slice(0,8).map(p=>(
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  onClick={()=>{selectProduct(String(p.id));setSearch("")}}
                >
                  <span className="instant-search-main">
                    <strong>{p.name}</strong>
                    <small>#{p.id}</small>
                  </span>
                  <span className="instant-search-badge">{money(kind==="sale"?p.sell_price:p.buy_price)}</span>
                </button>
              ))
            )}
          </div>
        ):null}
        <label className="smartpro-label">الصنف
          <select value={productId} onChange={e=>selectProduct(e.target.value)}>
            <option value="">اختر من {visibleProducts.length} نتيجة</option>
            {visibleProducts.map(p=><option key={p.id} value={p.id}>{p.name} (#{p.id})</option>)}
            {selected&&!visibleProducts.some(p=>p.id===selected.id)?<option value={selected.id}>{selected.name}</option>:null}
          </select>
        </label>
        <div className="smartpro-invoice-grid">
          <label className="smartpro-label">الكمية
            <KeyboardInput inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
          </label>
          <label className="smartpro-label">سعر الوحدة
            <KeyboardInput inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/>
          </label>
        </div>
        <button type="button" className="smartpro-primary" onClick={addLine}>+ إضافة صنف إلى الجدول</button>
      </div>
      {lines.length>0?(
        <div className="smartpro-table-wrap">
          <table className="smartpro-inv-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>السعر</th>
                <th>الإجمالي</th>
                <th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l,index)=>{
                const p=lookup.products.find(product=>String(product.id)===l.productId);
                const lineTotal=(Number(l.price)||0)*(Number(l.quantity)||0);
                return <tr key={l.productId+":"+l.storeId}>
                  <td>{index+1}</td>
                  <td className="name-cell">{p?.name??l.productId}</td>
                  <td>
                    <KeyboardInput
                      className="smartpro-cell-input"
                      aria-label="تعديل الكمية"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={e=>updateLineField(index,"quantity",e.target.value)}
                    />
                  </td>
                  <td>
                    <KeyboardInput
                      className="smartpro-cell-input"
                      aria-label="تعديل السعر"
                      inputMode="decimal"
                      value={l.price}
                      onChange={e=>updateLineField(index,"price",e.target.value)}
                    />
                  </td>
                  <td className="num-cell"><b>{money(lineTotal)}</b></td>
                  <td>
                    <button type="button" className="smartpro-del-btn" onClick={()=>setLines(list=>list.filter((_,i)=>i!==index))}>حذف</button>
                  </td>
                </tr>;
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><b>الإجمالي ({lines.length} صنف)</b></td>
                <td colSpan={2} className="num-cell"><b>{money(total)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ):(
        <strong className="smartpro-invoice-total">الإجمالي: {money(total)}</strong>
      )}
      <label className="smartpro-label">بيان الفاتورة
        <KeyboardTextarea rows={2} value={note} onChange={e=>setNote(e.target.value)}/>
      </label>
      <button type="button" className="smartpro-primary" disabled={saving||!canWrite||(kind==="sale"&&!canSell)||!lines.length}
        onClick={()=>void save()} data-testid="smartpro-post-invoice">
        {saving?"جارٍ حفظ الفاتورة والبنود...":"ترحيل الفاتورة وحفظ البنود"}
      </button>
    </div>:null}
    <div className="smartpro-records-head">
      <h3>أحدث الفواتير المسجلة</h3>
      <button type="button" onClick={()=>void refresh()}>تحديث القائمة</button>
    </div>
    <div className="smartpro-records">
      {recent.map(inv=><article className="smartpro-record" key={inv.id}>
        <div className="smartpro-record-head"><b>#{inv.id}</b><strong>{inv.doc_type===2?"بيع":"شراء"} — {inv.account_name}</strong></div>
        <div className="smartpro-record-details"><span>{inv.date}</span><span>{inv.line_count} بند</span><span>مدين {money(inv.dain)}</span><span>دائن {money(inv.madin)}</span></div>
        <button type="button" onClick={()=>void openDetail(inv.id)}>عرض جدول البنود</button>
        {opened===inv.id?(!detail?<p>جارٍ تحميل البنود...</p>:<div className="smartpro-detail-box">
          <div className="smartpro-table-wrap">
            <table className="smartpro-inv-table">
              <thead>
                <tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                {detail.lines.map(row=>{
                  const q=Number(row.amount)||0;
                  const pr=Number(row.price)||0;
                  return <tr key={String(row.id)}>
                    <td className="name-cell">{String(row.product_name)}</td>
                    <td className="num-cell">{money(q)}</td>
                    <td className="num-cell">{money(pr)}</td>
                    <td className="num-cell"><b>{money(q*pr)}</b></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={()=>{setOpened(null);setDetail(null)}}>إغلاق</button>
        </div>):null}
      </article>)}
    </div>
  </section>;
}
