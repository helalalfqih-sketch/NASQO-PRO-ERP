import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, signInWithGoogle } from "../../firebase";
import { KeyboardInput, KeyboardTextarea, MobileScroll } from "../../mobile";
import "./SmartProControlScreen.css";

type Column = { name:string; type:string; nullable:boolean; autoIncrement:boolean; maxLength:number|null; hasDefault:boolean; defaultValue:string|null };
type Table = { name:string; columns:Column[]; editableColumns:string[] };
type Metadata = { tables:Table[]; role:"admin"|"editor"|"viewer";writeEnabled:boolean;email:string };
type Wrapped = { data:Record<string,unknown>;etag:string };
type Listed = { rows:Wrapped[];hasMore:boolean };
type RoleRecord = { email:string;role:string;granted_by:string;updated_at:string };
type AuditRecord = { id:number;actor_email:string;table_name:string;row_id:string;action:string;created_at:string };
const LABELS:Record<string,string> = {
  accounts:"الحسابات والعملاء",alerts:"التنبيهات",bill_details:"بنود الفواتير",bill_details2:"بنود فواتير إضافية",
  bin:"أرشيف المحذوفات",bin_bill_details:"بنود الأرشيف",bin_bill_details2:"بنود الأرشيف الإضافية",
  bounds:"السندات والفواتير",boxes:"مجموعات الحسابات",cboxes:"الصناديق",currencies:"العملات",
  offers:"عروض الأسعار",offer_bill_details:"بنود العروض",offer_sbill_details:"بنود العروض الإضافية",
  prems:"صلاحيات SmartPro القديمة",products:"الأصناف",stores:"المخازن",
  store_trans:"حركات المخزون",trans_details:"بنود التحويلات",users:"مستخدمو SmartPro القديمة",
  name:"الاسم",phone:"الهاتف",details:"البيان",price:"السعر",amount:"الكمية أو المبلغ",total:"الإجمالي",
  date:"التاريخ",lim:"الحد الائتماني",box_id:"مجموعة الحساب",user_id:"المستخدم الأصلي",
  prod_id:"رقم الصنف",acc_id:"رقم الحساب",bill_id:"رقم المستند",store_id:"المخزن",
  sell_price:"سعر البيع",buy_price:"سعر الشراء",barcode:"الباركود",unit:"الوحدة",
  dain:"دائن",madin:"مدين",cur_id:"العملة",doc_type:"نوع المستند",
};
const BASE = new URL("api/smartpro/",new URL(import.meta.env.BASE_URL,window.location.origin)).pathname.replace(/\/$/,"");
const numTypes = new Set(["int","bigint","tinyint","smallint","mediumint","decimal","float","double"]);
async function api<T>(path:string,method="GET",data?:unknown):Promise<T> {
  const user=auth.currentUser;
  if(!user)throw new Error("يلزم تسجيل الدخول بحساب Google لاستخدام الصلاحيات المركزية.");
  const token=await user.getIdToken();
  const response=await fetch(BASE+path,{
    method,
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),
  });
  const json=await response.json().catch(()=>({error:"تعذر قراءة استجابة الخادم."}));
  if(!response.ok)throw new Error(json.error||"تعذر الاتصال بقاعدة SmartPro.");
  return json as T;
}
function short(value:unknown):string {
  if(value==null)return "—";
  return String(value).slice(0,110);
}
function rowLabel(row:Record<string,unknown>):string {
  return short(row.name??row.details??row.bill??row.bill_id??row.acc_id??row.prod_id??("السجل رقم "+row.id));
}
function dateField(type:string):boolean{return ["date","datetime","timestamp"].includes(type)}

export function SmartProControlScreen(){
  const [identity,setIdentity]=useState<User|null>(auth.currentUser);
  const [availability,setAvailability]=useState<{available:boolean;writeEnabled:boolean}|null>(null);
  const [meta,setMeta]=useState<Metadata|null>(null);
  const [selected,setSelected]=useState("accounts");
  const [records,setRecords]=useState<Wrapped[]>([]);
  const [search,setSearch]=useState("");
  const [offset,setOffset]=useState(0);
  const [hasMore,setHasMore]=useState(false);
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [mode,setMode]=useState<"records"|"roles"|"audit">("records");
  const [editing,setEditing]=useState<{item:Wrapped|null;values:Record<string,string>}|null>(null);
  const [confirmDelete,setConfirmDelete]=useState<Wrapped|null>(null);
  const [confirmation,setConfirmation]=useState("");
  const [roles,setRoles]=useState<RoleRecord[]>([]);
  const [roleEmail,setRoleEmail]=useState("");
  const [roleKind,setRoleKind]=useState("editor");
  const [audit,setAudit]=useState<AuditRecord[]>([]);

  const table=useMemo(()=>meta?.tables.find(t=>t.name===selected)??null,[meta,selected]);
  const canEdit=Boolean(meta?.writeEnabled&&(meta.role==="admin"||meta.role==="editor"));
  const canDelete=Boolean(meta?.writeEnabled&&meta.role==="admin");
  const canModifySelected=canEdit&&selected!=="users";
  const canDeleteSelected=canDelete&&selected!=="users";

  useEffect(()=>onAuthStateChanged(auth,setIdentity),[]);
  useEffect(()=>{
    let cancelled=false;
    void fetch(BASE+"/status").then(r=>r.json()).then(v=>{if(!cancelled)setAvailability(v)})
      .catch(()=>{if(!cancelled)setAvailability({available:false,writeEnabled:false})});
    return ()=>{cancelled=true};
  },[]);
  useEffect(()=>{
    if(!identity||!availability?.available)return;
    let cancelled=false;
    void api<Metadata>("/meta").then(v=>{if(!cancelled){setMeta(v);setError("")}})
      .catch(e=>{if(!cancelled)setError(String(e.message??e))});
    return ()=>{cancelled=true};
  },[identity,availability?.available]);

  const reload=useCallback(async()=>{
    if(!meta||mode!=="records")return;
    setBusy(true);setError("");
    try{
      const v=await api<Listed>("/table/"+encodeURIComponent(selected)+"?limit=40&offset="+offset+"&q="+encodeURIComponent(search));
      setRecords(v.rows);setHasMore(v.hasMore);
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  },[meta,selected,offset,search,mode]);
  useEffect(()=>{void reload()},[reload]);
  const reloadExtra=useCallback(async(view:"roles"|"audit")=>{
    setBusy(true);setError("");
    try{
      if(view==="roles"){const r=await api<{rows:RoleRecord[]}>("/roles");setRoles(r.rows)}
      else{const r=await api<{rows:AuditRecord[]}>("/audit");setAudit(r.rows)}
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  },[]);
  useEffect(()=>{if(meta&&mode!=="records")void reloadExtra(mode)},[meta,mode,reloadExtra]);

  const openForm=(item:Wrapped|null)=>{
    if(!table)return;
    const initial:Record<string,string>={};
    for(const col of table.columns.filter(c=>table.editableColumns.includes(c.name))){
      const raw=item?item.data[col.name]:col.defaultValue;
      initial[col.name]=raw===null||raw===undefined?"":String(raw);
    }
    setEditing({item,values:initial});setError("");setSuccess("");
  };
  const changeField=(name:string,value:string)=>{
    setEditing(current=>current?{...current,values:{...current.values,[name]:value}}:current);
  };
  const save=async()=>{
    if(!table||!editing)return;
    setSaving(true);setError("");setSuccess("");
    try{
      const values:Record<string,string|number|null>={};
      for(const col of table.columns.filter(c=>table.editableColumns.includes(c.name))){
        const raw=editing.values[col.name]??"";
        if(!editing.item&&raw===""&&col.hasDefault)continue;
        if(raw===""&&col.nullable){values[col.name]=null;continue}
        if(raw===""&&!col.hasDefault&&!col.nullable)continue;
        values[col.name]=numTypes.has(col.type)&&raw!==""?Number(raw):raw;
      }
      if(!Object.keys(values).length)throw new Error("أدخل بيانات للسجل أولًا.");
      if(editing.item){
        await api("/table/"+selected+"/"+editing.item.data.id,"PATCH",{values,etag:editing.item.etag});
        setSuccess("تم تعديل السجل وتسجيل العملية في سجل المراجعة.");
      }else{
        await api("/table/"+selected,"POST",{values});
        setSuccess("تم إنشاء السجل في قاعدة SmartPro المركزية.");
      }
      setEditing(null);await reload();
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  };
  const remove=async()=>{
    if(!confirmDelete)return;
    const required=selected+":"+confirmDelete.data.id;
    if(confirmation!==required){setError("يجب إدخال رمز التأكيد كما يظهر.");return}
    setSaving(true);setError("");setSuccess("");
    try{
      await api("/table/"+selected+"/"+confirmDelete.data.id,"DELETE",{confirmation,etag:confirmDelete.etag});
      setConfirmDelete(null);setConfirmation("");setSuccess("تم حذف السجل مع توثيق العملية.");await reload();
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  };
  const assignRole=async()=>{
    setSaving(true);setError("");setSuccess("");
    try{
      await api("/roles/"+encodeURIComponent(roleEmail.trim()),"PUT",{role:roleKind});
      setRoleEmail("");setSuccess("تم تحديث صلاحيات المستخدم مع تسجيل العملية.");await reloadExtra("roles");
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  };
  const revokeRole=async(email:string)=>{
    if(!window.confirm("هل تريد إلغاء وصول "+email+" إلى قاعدة SmartPro؟"))return;
    setSaving(true);setError("");
    try{await api("/roles/"+encodeURIComponent(email),"DELETE");await reloadExtra("roles")}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  };

  return (
    <MobileScroll className="app-screen smartpro-scroll">
      <main className="smartpro-center" data-testid="smartpro-center">
        <header className="smartpro-hero">
          <small>قاعدة البيانات المركزية • MariaDB</small>
          <h2>SmartPro — إدارة متكاملة</h2>
          <p>إضافة وتعديل وحذف مع توثيق المستخدم ومراجعة التغييرات. البيانات التاريخية الأصلية محفوظة منفصلة.</p>
          {meta?<strong className="smartpro-role" data-testid="smartpro-role">{meta.role==="admin"?"مدير النظام — صلاحيات كاملة":meta.role==="editor"?"محرر":"مشاهدة"} • {meta.email}</strong>:null}
          {identity?<button type="button" className="smartpro-primary" onClick={()=>void signOut(auth)}>تسجيل الخروج</button>:null}
        </header>

        {!availability?<p role="status">جارٍ فحص اتصال قاعدة البيانات المركزية...</p>:null}
        {availability&&!availability.available?<p className="smartpro-alert" role="alert">ربط SmartPro المركزي غير مُفعّل على هذا الخادم حاليًا. لا يتم استخدام البيانات التجريبية بدلًا منه.</p>:null}
        {availability?.available&&!identity?(
          <section className="smartpro-panel">
            <h3>تسجيل الدخول الآمن</h3>
            <p>الصلاحيات الكاملة تحتاج التحقق من حساب Google المصرح به. لن تُستخدم كلمات مرور SmartPro القديمة.</p>
            <button type="button" className="smartpro-primary" onClick={()=>void signInWithGoogle().catch(e=>setError(String(e.message??e)))}>تسجيل الدخول بحساب Google</button>
          </section>
        ):null}
        {error?<p className="smartpro-alert" role="alert" data-testid="smartpro-error">{error}</p>:null}
        {success?<p className="smartpro-success" role="status">{success}</p>:null}

        {meta?(
          <>
            <nav className="smartpro-tabs" aria-label="أقسام إدارة SmartPro">
              <button type="button" aria-current={mode==="records"?"page":undefined} onClick={()=>setMode("records")}>البيانات والجداول</button>
              {meta.role==="admin"?<button type="button" aria-current={mode==="roles"?"page":undefined} onClick={()=>setMode("roles")}>صلاحيات المستخدمين</button>:null}
              {meta.role==="admin"?<button type="button" aria-current={mode==="audit"?"page":undefined} onClick={()=>setMode("audit")}>سجل التغييرات</button>:null}
            </nav>
            {!meta.writeEnabled?<p className="smartpro-alert" role="alert">التعديلات المركزية غير مفعلة بعد في الخادم.</p>:null}
            {mode==="records"?(
              <section className="smartpro-panel">
                <label className="smartpro-label">القسم
                  <select value={selected} onChange={e=>{setSelected(e.target.value);setOffset(0);setEditing(null);setConfirmDelete(null)}}>
                    {meta.tables.map(t=><option value={t.name} key={t.name}>{LABELS[t.name]||t.name}</option>)}
                  </select>
                </label>
                <div className="smartpro-actions">
                  <KeyboardInput placeholder="ابحث باسم الحساب أو الصنف أو البيان" aria-label="بحث SmartPro" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/>
                  <button type="button" onClick={()=>void reload()}>تحديث</button>
                  {canModifySelected?<button type="button" data-testid="smartpro-new" className="smartpro-primary" onClick={()=>openForm(null)}>إضافة سجل</button>:null}
                </div>
                <p className="smartpro-caption">البيانات الحقيقية من {LABELS[selected]||selected} • 40 سجلًا في الصفحة</p>
                {busy?<p role="status">جارٍ تحميل السجلات...</p>:null}
                <div className="smartpro-records">
                  {records.map(item=>(
                    <article className="smartpro-record" key={String(item.data.id)}>
                      <div className="smartpro-record-head">
                        <b>#{short(item.data.id)}</b>
                        <strong>{rowLabel(item.data)}</strong>
                      </div>
                      <div className="smartpro-record-details">
                        {Object.entries(item.data).filter(([k])=>k!=="id"&&k!=="name"&&k!=="details"&&k!=="password").slice(0,4).map(([k,v])=>(
                          <span key={k}>{LABELS[k]||k}: <b>{short(v)}</b></span>
                        ))}
                      </div>
                      <div className="smartpro-record-actions">
                        {canModifySelected?<button type="button" onClick={()=>openForm(item)}>تعديل</button>:null}
                        {canDeleteSelected?<button type="button" className="smartpro-danger-text" onClick={()=>{setConfirmDelete(item);setConfirmation("");setError("")}}>حذف</button>:null}
                      </div>
                    </article>
                  ))}
                  {!busy&&records.length===0?<p>لا توجد سجلات مطابقة.</p>:null}
                </div>
                <div className="smartpro-pagination">
                  <button disabled={offset===0||busy} onClick={()=>setOffset(n=>Math.max(0,n-40))}>السابق</button>
                  <span>الصفحة {Math.floor(offset/40)+1}</span>
                  <button disabled={!hasMore||busy} onClick={()=>setOffset(n=>n+40)}>التالي</button>
                </div>
              </section>
            ):null}
            {mode==="roles"&&meta.role==="admin"?(
              <section className="smartpro-panel">
                <h3>تعيين صلاحيات مستخدمي نسقو</h3>
                <p>مدير: إضافة وتعديل وحذف وإدارة الصلاحيات. محرر: إضافة وتعديل. مشاهد: قراءة فقط. لا تُستخدم كلمات مرور SmartPro القديمة.</p>
                <label className="smartpro-label">البريد الإلكتروني الموثّق
                  <KeyboardInput value={roleEmail} onChange={e=>setRoleEmail(e.target.value)} placeholder="user@example.com"/>
                </label>
                <label className="smartpro-label">الصلاحية
                  <select value={roleKind} onChange={e=>setRoleKind(e.target.value)}>
                    <option value="admin">مدير كامل الصلاحيات</option><option value="editor">محرر</option><option value="viewer">مشاهد</option>
                  </select>
                </label>
                <button type="button" className="smartpro-primary" onClick={()=>void assignRole()} disabled={saving}>حفظ الصلاحية</button>
                {roles.map(r=>(
                  <div className="smartpro-role-item" key={r.email}>
                    <b>{r.email}</b><span>{r.role}</span><button type="button" onClick={()=>void revokeRole(r.email)} disabled={saving}>إلغاء الصلاحية</button>
                  </div>
                ))}
              </section>
            ):null}
            {mode==="audit"&&meta.role==="admin"?(
              <section className="smartpro-panel">
                <h3>آخر العمليات الموثقة</h3>
                {audit.map(log=><article className="smartpro-audit-row" key={log.id}>
                  <b>{log.action} • {LABELS[log.table_name]||log.table_name} #{log.row_id}</b>
                  <small>{log.actor_email} • {log.created_at}</small>
                </article>)}
                {!audit.length?<p>لا توجد تعديلات مسجلة في قاعدة SmartPro الجديدة.</p>:null}
              </section>
            ):null}
          </>
        ):null}

        {editing&&table?(
          <div className="smartpro-dialog" role="dialog" aria-label={editing.item?"تعديل سجل SmartPro":"إنشاء سجل SmartPro"}>
            <div className="smartpro-dialog-body">
              <h3>{editing.item?"تعديل سجل رقم "+editing.item.data.id:"إضافة سجل في "+(LABELS[selected]||selected)}</h3>
              <p>تُحفظ التغييرات مباشرة في قاعدة SmartPro المركزية مع سجل مراجعة.</p>
              <div className="smartpro-fields">
                {table.columns.filter(col=>table.editableColumns.includes(col.name)).map(col=>(
                  <label className="smartpro-label" key={col.name}>
                    {LABELS[col.name]||col.name}{!col.nullable&&!col.hasDefault?" *":""}
                    {col.type==="text"||col.type==="longtext"?(
                      <KeyboardTextarea rows={2} value={editing.values[col.name]??""} onChange={e=>changeField(col.name,e.target.value)}/>
                    ):(
                      <KeyboardInput type={numTypes.has(col.type)?"number":dateField(col.type)&&col.type==="date"?"date":"text"}
                        step={numTypes.has(col.type)?"any":undefined}
                        value={editing.values[col.name]??""} onChange={e=>changeField(col.name,e.target.value)}/>
                    )}
                  </label>
                ))}
              </div>
              <div className="smartpro-dialog-actions">
                <button type="button" onClick={()=>setEditing(null)} disabled={saving}>إلغاء</button>
                <button type="button" className="smartpro-primary" data-testid="smartpro-save" onClick={()=>void save()} disabled={saving}>{saving?"جارٍ الحفظ...":"حفظ وتوثيق"}</button>
              </div>
            </div>
          </div>
        ):null}
        {confirmDelete?(
          <div className="smartpro-dialog" role="alertdialog" aria-label="تأكيد حذف سجل">
            <div className="smartpro-dialog-body">
              <h3>تأكيد حذف سجل مالي</h3>
              <p>قد يكون هذا السجل مرتبطًا بمستندات أخرى. قد يحذف محرك قاعدة البيانات بعض البنود المرتبطة به تلقائيًا. اكتب الرمز التالي حرفيًا للتأكيد:</p>
              <code dir="ltr">{selected+":"+confirmDelete.data.id}</code>
              <KeyboardInput dir="ltr" aria-label="رمز تأكيد الحذف" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
              <div className="smartpro-dialog-actions">
                <button type="button" onClick={()=>setConfirmDelete(null)} disabled={saving}>إلغاء</button>
                <button type="button" className="smartpro-danger" disabled={saving||confirmation!==selected+":"+confirmDelete.data.id} onClick={()=>void remove()}>حذف مع التسجيل</button>
              </div>
            </div>
          </div>
        ):null}
      </main>
    </MobileScroll>
  );
}
