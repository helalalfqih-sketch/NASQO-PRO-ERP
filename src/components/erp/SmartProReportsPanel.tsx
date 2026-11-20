import { useCallback, useEffect, useState } from "react";
import { auth } from "../../firebase";
import { KeyboardInput } from "../../mobile";
import { matchesArabicSearch } from "../../accounting";

type Document = {
  documentType:number;documents:number;dainTotal:string;madinTotal:string;cashboxLinked:number;
};
type DocumentsReport = {
  counts:{accounts:number;products:number;stores:number;billLines:number;transferDocuments:number};
  documents:Document[];note:string;
};
type MovementRow = {
  productId:number;productName:string|null;unit:string|null;
  warehouseId:number;warehouseName:string|null;warehouseState:number|null;
  saleQuantity:string;purchaseQuantity:string;
  saleReturnQuantity:string;purchaseReturnQuantity:string;
  transferInQuantity:string;transferOutQuantity:string;
  openingLikeQuantity:string;netMovementQuantity:string;
};
type Finding = {
  status:string;positions:number;negativePositions:number;
  negativeActivePositions:number;negativeProducts:number;
  unresolvedPositions:number;missingWarehouseIds:number[];
  unknownSourceTransfers:number;unknownDestinationTransfers:number;
  explanations:string[];
};
type Stock = {
  findings:Finding;rows:MovementRow[];totalFiltered:number;
  offset:number;limit:number;verified:false;
};
type Account = {id:number;name:string;box_id:number;groupName:string|null};
type StatementEntry = {
  id:number;date:string;documentType:number;
  details:string|null;currencyId:number;currencyName:string|null;dain:string;madin:string;
};
type CurrencyTotal = {
  currencyId:number;currencyName:string|null;documents:number;dainTotal:string;madinTotal:string;
};
type Statement = {
  account:Account;start:string;end:string;totals:CurrencyTotal[];
  entries:StatementEntry[];hasMore:boolean;offset:number;limit:number;note:string;
};

const API_ROOT=new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname;
async function fetchReport<T>(path:string):Promise<T>{
  const person=auth.currentUser;
  if(!person)throw new Error("يجب تسجيل الدخول بحساب Google المصرح به.");
  const token=await person.getIdToken();
  const response=await fetch(API_ROOT+path,{headers:{"Authorization":"Bearer "+token}});
  const body=await response.json().catch(()=>({error:"الاستجابة غير صالحة."}));
  if(!response.ok)throw new Error(body.error||"تعذر تحميل التقرير.");
  return body as T;
}
const amount=(value:string|number)=>Number(value).toLocaleString("ar-YE",{maximumFractionDigits:4});
const TYPES:Record<number,string>={
  1:"سندات وحركات حسابية",2:"مبيعات",3:"مشتريات",4:"مردود مبيعات",
  5:"مردود مشتريات",7:"نوع مستند 7",9:"نوع مستند 9",
};
export function SmartProReportsPanel(){
  const [tab,setTab]=useState<"docs"|"stock"|"account">("docs");
  const [docs,setDocs]=useState<DocumentsReport|null>(null);
  const [stock,setStock]=useState<Stock|null>(null);
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState("");
  const [statement,setStatement]=useState<Statement|null>(null);
  const [start,setStart]=useState("1900-01-01");
  const [end,setEnd]=useState("2099-12-31");
  const [stockPage,setStockPage]=useState(0);
  const [accountPage,setAccountPage]=useState(0);
  const [warehouseId,setWarehouseId]=useState("");
  const [onlyNegative,setOnlyNegative]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [accountSearch,setAccountSearch]=useState("");

  const refreshDocuments=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const [documents,accountList]=await Promise.all([
        fetchReport<DocumentsReport>("reports/documents"),
        fetchReport<{rows:Account[]}>("reports/accounts"),
      ]);
      setDocs(documents);setAccounts(accountList.rows);
      setAccountId(id=>id||String(accountList.rows[0]?.id??""));
    }catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{void refreshDocuments()},[refreshDocuments]);

  const refreshStock=useCallback(async()=>{
    setLoading(true);setError("");
    const qs=new URLSearchParams({offset:String(stockPage*40),limit:"40"});
    if(onlyNegative)qs.set("onlyNegative","1");
    if(warehouseId)qs.set("warehouseId",warehouseId);
    try{setStock(await fetchReport<Stock>("reports/stock?"+qs.toString()))}
    catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setLoading(false)}
  },[stockPage,onlyNegative,warehouseId]);
  useEffect(()=>{if(tab==="stock")void refreshStock()},[tab,refreshStock]);

  const refreshAccount=useCallback(async()=>{
    if(!accountId)return;
    setLoading(true);setError("");
    const qs=new URLSearchParams({start,end,offset:String(accountPage*40),limit:"40"});
    try{setStatement(await fetchReport<Statement>("reports/account/"+accountId+"?"+qs.toString()))}
    catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setLoading(false)}
  },[accountId,start,end,accountPage]);
  useEffect(()=>{if(tab==="account")void refreshAccount()},[tab,refreshAccount]);
  const filterAccounts=accounts.filter(a=>matchesArabicSearch(`${a.name} ${a.id}`,accountSearch));

  return <section className="smartpro-panel" data-testid="smartpro-reports-panel">
    <h3>تقارير SmartPro المركزية</h3>
    <p className="smartpro-caption">تعتمد هذه التقارير مباشرةً على MariaDB، ولا تحفظ نسخًا منها في Firebase أو تخزين المتصفح.</p>
    <nav className="smartpro-tabs" aria-label="أنواع التقارير">
      <button type="button" aria-current={tab==="docs"?"page":undefined} onClick={()=>setTab("docs")}>المستندات</button>
      <button type="button" aria-current={tab==="stock"?"page":undefined} onClick={()=>setTab("stock")}>مطابقة المخزون</button>
      <button type="button" aria-current={tab==="account"?"page":undefined} onClick={()=>setTab("account")}>كشف الحساب</button>
    </nav>
    {loading?<p role="status">جارٍ تحميل التقرير من MariaDB...</p>:null}
    {error?<p className="smartpro-alert" role="alert">{error}</p>:null}

    {tab==="docs"&&docs?<div className="smartpro-report-stack">
      <p className="smartpro-caption">{docs.note}</p>
      <div className="smartpro-report-grid">
        <div><small>الحسابات</small><strong>{docs.counts.accounts.toLocaleString("ar-YE")}</strong></div>
        <div><small>الأصناف</small><strong>{docs.counts.products.toLocaleString("ar-YE")}</strong></div>
        <div><small>المخازن</small><strong>{docs.counts.stores.toLocaleString("ar-YE")}</strong></div>
        <div><small>بنود الفواتير</small><strong>{docs.counts.billLines.toLocaleString("ar-YE")}</strong></div>
        <div><small>حركات التحويل</small><strong>{docs.counts.transferDocuments.toLocaleString("ar-YE")}</strong></div>
      </div>
      {docs.documents.map(doc=><article className="smartpro-record" key={doc.documentType}>
        <div className="smartpro-record-head">
          <strong>{TYPES[doc.documentType]??"نوع "+doc.documentType}</strong>
          <b>{doc.documents.toLocaleString("ar-YE")} مستند</b>
        </div>
        <div className="smartpro-record-details">
          <span>dain: {amount(doc.dainTotal)}</span>
          <span>madin: {amount(doc.madinTotal)}</span>
          <span>مرتبطة بصندوق: {doc.cashboxLinked}</span>
        </div>
      </article>)}
      <button type="button" onClick={()=>void refreshDocuments()}>تحديث المستندات</button>
    </div>:null}

    {tab==="stock"&&stock?<div className="smartpro-report-stack">
      <p className="smartpro-alert">
        هذا تقرير <b>حركة مخزنية تقديرية غير معتمدة للجرد</b>. لا يُستخدم للسماح بالبيع.
        تشمل الحسابات حركة البيع والشراء والمرتجعات والتحويلات، مع احتمال وجود أرصدة افتتاحية غير موثقة.
      </p>
      <div className="smartpro-report-grid">
        <div><small>أرصدة حركة</small><strong>{stock.findings.positions.toLocaleString("ar-YE")}</strong></div>
        <div><small>مواقع سالبة تقديرية</small><strong>{stock.findings.negativePositions}</strong></div>
        <div><small>سالبة بمخزن نشط</small><strong>{stock.findings.negativeActivePositions}</strong></div>
        <div><small>مراجع مخازن غير معروفة</small><strong>{stock.findings.missingWarehouseIds.join("، ")||"لا توجد"}</strong></div>
      </div>
      <p className="smartpro-caption">
        حركات ذات مخزن مصدر مفقود: {stock.findings.unknownSourceTransfers}،
        ومخزن وجهة مفقود: {stock.findings.unknownDestinationTransfers}.
      </p>
      <div className="smartpro-report-filter">
        <label><input type="checkbox" checked={onlyNegative}
          onChange={e=>{setOnlyNegative(e.target.checked);setStockPage(0)}}/> عرض الرصيد السالب فقط</label>
        <label className="smartpro-label">المخزن (المعرّف)
          <KeyboardInput value={warehouseId} placeholder="جميع المخازن"
            inputMode="numeric" onChange={e=>{setWarehouseId(e.target.value);setStockPage(0)}}/>
        </label>
      </div>
      <small>عدد المواقع المطابقة للمرشح: {stock.totalFiltered}؛ صفحة {stockPage+1}</small>
      {stock.rows.map(row=><article className="smartpro-record" key={row.productId+":"+row.warehouseId}>
        <div className="smartpro-record-head">
          <strong>{row.productName??"صنف غير معروف"} #{row.productId}</strong>
          <b>{amount(row.netMovementQuantity)} {row.unit||""}</b>
        </div>
        <small>{row.warehouseName??"مخزن محذوف أو غير معروف"} #{row.warehouseId} {row.warehouseState===1?"(نشط)":"(غير نشط/غير معروف)"}</small>
        <div className="smartpro-record-details">
          <span>مبيعات: {amount(row.saleQuantity)}</span>
          <span>مشتريات: {amount(row.purchaseQuantity)}</span>
          <span>مردود بيع: {amount(row.saleReturnQuantity)}</span>
          <span>مردود شراء: {amount(row.purchaseReturnQuantity)}</span>
          <span>تحويل وارد: {amount(row.transferInQuantity)}</span>
          <span>تحويل صادر: {amount(row.transferOutQuantity)}</span>
          <span>تسوية/افتتاح محتمل: {amount(row.openingLikeQuantity)}</span>
        </div>
      </article>)}
      <div className="smartpro-pagination">
        <button disabled={stockPage===0||loading} onClick={()=>setStockPage(p=>Math.max(p-1,0))}>السابق</button>
        <button disabled={(stockPage+1)*40>=stock.totalFiltered||loading} onClick={()=>setStockPage(p=>p+1)}>التالي</button>
      </div>
    </div>:null}

    {tab==="account"?<div className="smartpro-report-stack">
      <p className="smartpro-caption">كشف حساب يعرض حقول SmartPro الأصلية حسب العملة. لا يُصدر رصيدًا معتمدًا قبل مراجعة دلالة القيد الافتتاحي.</p>
      <label className="smartpro-label">ابحث عن حساب
        <KeyboardInput
          value={accountSearch}
          onChange={e=>setAccountSearch(e.target.value)}
          onKeyDown={e=>{
            if(e.key==="Enter"&&filterAccounts.length>0){
              e.preventDefault();
              setAccountId(String(filterAccounts[0].id));
              setAccountSearch("");
              setAccountPage(0);
            }
          }}
          placeholder="اسم الحساب أو الرقم"
        />
      </label>
      {accountSearch.trim()?(
        <div className="instant-search-results" role={filterAccounts.length?"listbox":"status"}>
          {filterAccounts.length===0?(
            <p className="instant-search-empty">لا توجد حسابات مطابقة لـ «{accountSearch.trim()}»</p>
          ):(
            filterAccounts.slice(0,8).map(a=>(
              <button
                key={a.id}
                type="button"
                role="option"
                onClick={()=>{setAccountId(String(a.id));setAccountSearch("");setAccountPage(0)}}
              >
                <span className="instant-search-main">
                  <strong>{a.name}</strong>
                  <small>#{a.id}</small>
                </span>
              </button>
            ))
          )}
        </div>
      ):null}
      <label className="smartpro-label">الحساب
        <select value={accountId} onChange={e=>{setAccountId(e.target.value);setAccountPage(0)}}>
          {filterAccounts.length===0?<option value="">لا توجد حسابات مطابقة</option>:null}
          {(()=>{
            const capped = filterAccounts.slice(0, 150);
            const hasSel = !accountId || capped.some(a => String(a.id) === accountId);
            const selObj = !hasSel ? filterAccounts.find(a => String(a.id) === accountId) : undefined;
            const list = selObj ? [selObj, ...capped] : capped;
            return <>
              {list.map(a=><option value={a.id} key={a.id}>{a.name} #{a.id}</option>)}
              {filterAccounts.length > 150 ? <option value="" disabled>— ابحث أعلاه لعرض باقي الحسابات (+{filterAccounts.length - 150}) —</option> : null}
            </>;
          })()}
        </select>
      </label>
      <div className="smartpro-invoice-grid">
        <label className="smartpro-label">من
          <KeyboardInput type="date" dir="ltr" value={start} onChange={v=>{setStart(v.target.value);setAccountPage(0)}}/>
        </label>
        <label className="smartpro-label">إلى
          <KeyboardInput type="date" dir="ltr" value={end} onChange={v=>{setEnd(v.target.value);setAccountPage(0)}}/>
        </label>
      </div>
      {statement?<div>
        <h3>{statement.account.name}</h3>
        {statement.totals.map(t=><article className="smartpro-record" key={t.currencyId}>
          <strong>{t.currencyName??"عملة #"+t.currencyId}: {t.documents} مستند</strong>
          <div className="smartpro-record-details">
            <span>dain: {amount(t.dainTotal)}</span><span>madin: {amount(t.madinTotal)}</span>
          </div>
        </article>)}
        {statement.entries.map(item=><article className="smartpro-record" key={item.id}>
          <div className="smartpro-record-head">
            <strong>#{item.id} — {TYPES[item.documentType]??"مستند "+item.documentType}</strong><small>{item.date}</small>
          </div>
          <p>{item.details||"—"}</p>
          <div className="smartpro-record-details">
            <span>dain: {amount(item.dain)}</span>
            <span>madin: {amount(item.madin)}</span>
            <span>{item.currencyName??"عملة "+item.currencyId}</span>
          </div>
        </article>)}
        <div className="smartpro-pagination">
          <button disabled={accountPage===0||loading} onClick={()=>setAccountPage(p=>Math.max(0,p-1))}>السابق</button>
          <button disabled={!statement.hasMore||loading} onClick={()=>setAccountPage(p=>p+1)}>التالي</button>
        </div>
      </div>:null}
    </div>:null}
  </section>;
}
