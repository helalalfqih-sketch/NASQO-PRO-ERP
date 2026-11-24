import { useEffect, useState } from "react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { nativeIdentity, type NativeCloudProfile } from "../hybrid/cloudSession";
import { hybridBridge } from "../hybrid/bridge";

type ToolsStatus={review:boolean;imported:boolean};
export function HybridCloudAccount({onNotify,onOpenGoogleDrive}:{onNotify:(s:string)=>void;onOpenGoogleDrive?:()=>void}){
  const [profile,setProfile]=useState<NativeCloudProfile|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    void nativeIdentity("status").then(p=>{if(active)setProfile(p);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"تعذر قراءة الحساب.");});
    return ()=>{active=false;};
  },[]);
  async function change(operation:"signIn"|"signOut",chooseAccount=false){
    setBusy(true);setError("");
    try{
      const p=await nativeIdentity(operation,chooseAccount);
      setProfile(p);
      if(p.cancelled){onNotify("أُلغي تسجيل الدخول.");return;}
      if(operation==="signIn"&&!p.signedIn)throw new Error("لم يكتمل التحقق من الحساب.");
      onNotify(operation==="signOut"?"تم تسجيل الخروج من Google؛ بياناتك المحلية محفوظة.":"تم تسجيل الدخول بحساب Google.");
    }catch(e){
      setError(e instanceof Error?e.message:"تعذر إكمال العملية.");
      const p=await nativeIdentity("status").catch(()=>null);
      if(p)setProfile(p);
    }finally{setBusy(false);}
  }
  return <section className="sys-card" data-testid="settings-cloud-account">
    <div className="sys-card-heading">حساب Google</div>
    <p className="sys-row">{profile?.signedIn?<bdi>{profile.email??profile.displayName??"حساب متصل"}</bdi>:profile===null?"جارٍ قراءة حالة الحساب...":"غير متصل — العمل المحلي متاح"}</p>
    <p>تسجيل Google اختياري، ولا يغيّر قاعدة SQLite أو يرفع البيانات تلقائيًا.</p>
    {profile?.configured===false?<p role="alert">إعداد Firebase غير موجود في هذا الإصدار.</p>:null}
    {error?<p role="alert">{error}</p>:null}
    <div className="sys-backup-btns">
      {profile?.signedIn?<><button type="button" className="ref-btn" disabled={busy} onClick={()=>void change("signIn",true)}>تبديل الحساب</button><button type="button" className="ref-btn" disabled={busy} onClick={()=>void change("signOut")}>تسجيل الخروج من Google</button></>:
        <GoogleSignInButton fullWidth disabled={busy||profile===null||profile.configured===false} label={busy?"جارٍ تسجيل الدخول...":"تسجيل الدخول بحساب Google"} onClick={()=>void change("signIn")} testId="native-google-signin-btn"/>}
      {onOpenGoogleDrive?<button type="button" className="ref-btn purple" disabled={busy} onClick={onOpenGoogleDrive}>Google Drive</button>:null}
    </div>
  </section>;
}
export function HybridLocalTools({uid,onNotify}:{uid:string;onNotify:(s:string)=>void}){
  const [status,setStatus]=useState<ToolsStatus|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    void hybridBridge.invoke<"localToolsAction",ToolsStatus>("localToolsAction",{workspaceId:uid,operation:"status"})
      .then(s=>{if(active)setStatus(s);}).catch(()=>{});
    return ()=>{active=false;};
  },[uid]);
  async function open(operation:"history"|"readiness"|"activate"|"leaveReview"){
    setBusy(true);
    try{
      const next=await hybridBridge.invoke<"localToolsAction",ToolsStatus>("localToolsAction",{workspaceId:uid,operation},{timeoutMs:600_000});
      setStatus(next);
      if(status?.review&&!next.review)window.location.reload();
    }catch(e){onNotify(e instanceof Error?e.message:"تعذر فتح أدوات البيانات.");}
    finally{setBusy(false);}
  }
  if(!status||( !status.review&&!status.imported))return null;
  return <section className="sys-card" data-testid="settings-local-review-tools">
    <div className="sys-card-heading">البيانات المستوردة</div>
    {status.review?<p role="status">نسخة تاريخية للمراجعة فقط؛ قاعدة العمل الأصلية محفوظة.</p>:<p>استعادة تشغيلية محلية؛ طابق المخزون غير المعتمد من إعدادات قاعدة البيانات.</p>}
    <div className="sys-backup-btns">
      <button type="button" className="ref-btn" disabled={busy} onClick={()=>void open("history")}>السجلات التاريخية</button>
      {status.review?<><button type="button" className="ref-btn" disabled={busy} onClick={()=>void open("readiness")}>تقرير جاهزية الاستعادة</button>
      <button type="button" className="ref-btn green" disabled={busy} onClick={()=>void open("activate")}>تفعيل النسخة المستوردة</button>
      <button type="button" className="ref-btn" disabled={busy} onClick={()=>void open("leaveReview")}>العودة إلى قاعدة العمل</button></>:null}
    </div>
  </section>;
}
