import { useMemo, useState } from 'react';
import { ArrowLeftIcon, BarChartIcon, CheckCircledIcon, CubeIcon, FilePlusIcon, FileTextIcon, GearIcon, PersonIcon, ReloadIcon, RowsIcon, SewingPinIcon } from '@radix-ui/react-icons';
import { MobileScroll, KeyboardInput, useKeyboard } from '../mobile';
import { formatAmount } from '../accounting';
import { savePersonalPreferences } from '../firebase';
import { defaultUserPreferences, validatePreferenceReferences, type UserPreferences } from '../utils/businessSetup';
import { HOME_ACTIONS, HOME_MODULES, type HomeAction, type HomeInput, type HomeModule, type HomeScope, type HomeTarget } from '../dashboard/model';
import { useHomeDashboard } from '../dashboard/useHomeDashboard';
import { readHomeTileLayout, type HomeTileId } from '../utils/dashboardPrefs';
import { useBackLayer } from '../hybrid/backCoordinator';

export type SmartHomeProps = {uid:string; input:HomeInput; ready:boolean; revision:readonly unknown[]; onAction:(id:HomeAction)=>void; onModule:(id:HomeModule)=>void; onTarget:(target:HomeTarget,scope:HomeScope)=>void; onMore:()=>void; onTheme:(theme:UserPreferences['theme'])=>void; onNotify:(message:string)=>void};
const tileIds: Record<HomeAction | HomeModule, HomeTileId> = {sale:'new-invoice',purchase:'new-invoice',receipt:'new-voucher',payment:'new-voucher',journal:'simple-entry',accounts:'accounts',sales:'sales-dashboard',purchases:'accounts',inventory:'stock-movement',cashboxes:'cashboxes',customers:'accounts',vendors:'accounts',reports:'trial-balance'};
const iconFor=(id:string)=>id==='inventory'?CubeIcon:id==='customers'||id==='vendors'?PersonIcon:id==='reports'?BarChartIcon:id==='accounts'?RowsIcon:FileTextIcon;
export function SmartHome(props:SmartHomeProps) {
  const {uid,input,revision}=props, keyboard=useKeyboard();
  const [scope,setScope]=useState<Partial<HomeScope>>({}),[filters,setFilters]=useState(false),[preferences,setPreferences]=useState(false);
  const prefs=input.workspace.userPreferences??defaultUserPreferences(input.workspace.defaultCurrency);
  const cacheContext=JSON.stringify([prefs.defaultCurrency,prefs.defaultWarehouseId,input.workspace.businessProfile?.timezone,input.workspace.businessProfile?.fiscalYearStartMonth]);
  const {data,error,loading,stale,refresh}=useHomeDashboard(uid,input.workspace.legacySourceSha??'',scope,[props.ready,...revision],cacheContext);
  const actions=useMemo(()=>{
    if(!data)return [];
    const favorite=prefs.favoriteActions.filter((a):a is HomeAction=>data.actions.includes(a as HomeAction));
    return [...favorite,...data.actions.filter(a=>!favorite.includes(a))].slice(0,6);
  },[data?.actions,prefs.favoriteActions]);
  const activeScope=data?.scope;
  const tones=readHomeTileLayout().toneOverrides;
  const tileTone=(id:HomeAction | HomeModule)=>tones[tileIds[id]]??(['inventory','cashboxes','reports'].includes(id)?'amber':'blue');
  const run=(fn:()=>void)=>{keyboard.hide();fn();};
  return <>
    <MobileScroll className="app-screen dashboard-scroll smart-workbench-scroll erp-home-scroll">
      <main className="erp-home page-with-footer" dir="rtl" data-testid="dashboard-screen" data-columns={prefs.homeColumns}>
        <header className="erp-home-heading"><div><h1>نظرة اليوم</h1><p>{data?.branchName??input.workspace.businessProfile?.branch.name??'الفرع الرئيسي'} · {data?.timezone??input.workspace.businessProfile?.timezone??'UTC'}</p></div><button aria-label="تفضيلات الرئيسية" onClick={()=>run(()=>setPreferences(true))}><GearIcon/></button></header>
        <div className="erp-home-status" role="status" data-testid="home-freshness"><span>{loading?'جارٍ تحديث الملخص…':stale?'نسخة محفوظة · تعذر التحديث':'محدّث من السجلات'}{data?` · ${new Date(data.generatedAt).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'})}`:''}</span><button onClick={refresh} disabled={loading} aria-label="تحديث الرئيسية"><ReloadIcon/></button><button onClick={()=>run(()=>setFilters(!filters))} aria-expanded={filters}>النطاق</button></div>
        {filters&&<fieldset className="erp-home-filters"><legend>نطاق العرض</legend><label>الفرع<select value="main" disabled><option value="main">{data?.branchName??'الفرع الرئيسي'}</option></select></label>
          <label>العملة<select value={scope.currency??activeScope?.currency??prefs.defaultCurrency} onChange={e=>setScope(s=>({...s,currency:e.target.value}))}>{input.currencies.map(c=><option key={c.code} value={c.name}>{c.name}</option>)}</select></label>
          <label>مخزن المستندات والأصناف<select value={scope.warehouseId??activeScope?.warehouseId??''} onChange={e=>setScope(s=>({...s,warehouseId:e.target.value}))}><option value="">كل المخازن</option>{input.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>من تاريخ<KeyboardInput type="date" value={scope.fromDate??activeScope?.fromDate??''} onChange={e=>setScope(s=>({...s,fromDate:e.target.value}))}/></label><label>حتى تاريخ<KeyboardInput type="date" value={scope.toDate??activeScope?.toDate??''} onChange={e=>setScope(s=>({...s,toDate:e.target.value}))}/></label>
          <p>النقد والذمم أرصدة المنشأة حتى التاريخ المحدد. مرشح المخزن يخص المستندات والمخزون.</p><button onClick={()=>setScope({})}>الفترة المالية الحالية</button>
        </fieldset>}
        {activeScope&&<p className="erp-home-scope-label">{activeScope.currency} · {input.warehouses.find(w=>w.id===activeScope.warehouseId)?.name??'كل المخازن'} · {activeScope.fromDate} – {activeScope.toDate}</p>}
        {error&&<p className="erp-home-error" role="alert">{error}{!data?' لم تُعرض أرقام غير متحقق منها.':''}</p>}
        <section aria-label="المؤشرات الرئيسية" className="erp-home-kpis" data-testid="home-kpis" aria-busy={loading}>
          {(data?.kpis??['مبيعات اليوم','مشتريات اليوم','النقد المتاح','مستحقات العملاء'].map((label,index)=>({id:['sales','purchases','cash','receivables'][index] as 'sales',label,value:0,unit:'',caption:'بانتظار قراءة السجلات'}))).map(k=><button key={k.id} className="exec-kpi-card erp-home-card erp-home-kpi" disabled={!data} onClick={()=>data&&run(()=>props.onTarget({kind:'metric',metric:k.id},data.scope))} data-testid={`home-kpi-${k.id}`}><span className="exec-kpi-label">{k.label}</span><strong className="exec-kpi-value" dir="auto">{data?formatAmount(k.value):'—'} <small>{k.unit}</small></strong><small className="exec-kpi-meta">{k.caption}</small></button>)}
        </section>
        <section className="erp-home-section" data-testid="user-action-shortcuts"><h2>إجراء سريع</h2><div className="erp-home-actions">{actions.map(id=><button key={id} className={`smart-tile ${tileTone(id)} erp-home-card erp-home-action`} data-testid={`home-action-${id}`} onClick={()=>run(()=>props.onAction(id))}><span className="smart-tile-icon"><FilePlusIcon/></span><span className="smart-tile-label">{HOME_ACTIONS[id]}</span></button>)}</div>{!data&&<p>تظهر الإجراءات بعد التحقق من الوصول.</p>}</section>
        <section className="erp-home-section"><div className="erp-home-section-title"><h2>وحدات العمل</h2><button onClick={()=>run(props.onMore)}>المزيد <ArrowLeftIcon/></button></div><div className="erp-home-modules" data-testid="home-modules">{data?.modules.map(id=>{const Icon=iconFor(id);return <button key={id} className={`smart-tile ${tileTone(id)} erp-home-card erp-home-module`} data-testid={`home-module-${id}`} onClick={()=>run(()=>props.onModule(id))}><span className="smart-tile-icon"><Icon/></span><span className="smart-tile-label">{HOME_MODULES[id]}</span></button>;})}</div></section>
        <section className="erp-home-section erp-home-list-section"><h2>يحتاج انتباهك</h2><div data-testid="home-alerts">{data?.alerts.length?data.alerts.map(row=><button className="erp-home-row" key={row.id} onClick={()=>run(()=>props.onTarget(row.target,data.scope))}><SewingPinIcon/><span><strong>{row.title}</strong><small>{row.subtitle}</small>{row.amount!==undefined&&<b>{formatAmount(row.amount)} {row.currency}</b>}</span><ArrowLeftIcon/></button>):<p className="erp-home-empty"><CheckCircledIcon/>{data?'لا توجد تنبيهات ضمن هذا النطاق.':'جارٍ التحقق من التنبيهات…'}</p>}</div></section>
        <section className="erp-home-section erp-home-list-section"><h2>آخر المعاملات</h2><div data-testid="home-recent">{data?.recent.length?data.recent.map(row=><button className="erp-home-row" key={row.id} onClick={()=>run(()=>props.onTarget(row.target,data.scope))}><FileTextIcon/><span><strong>{row.title}</strong><small>{row.subtitle}</small><b>{formatAmount(row.amount!)} {row.currency}</b></span><ArrowLeftIcon/></button>):<p className="erp-home-empty">{data?'لا توجد معاملات مرحّلة ضمن النطاق.':'جارٍ قراءة المعاملات…'}</p>}</div></section>
      </main>
    </MobileScroll>
    {preferences&&<HomePreferences {...props} allowedActions={data?.actions??[]} onClose={()=>setPreferences(false)} onSaved={()=>{setPreferences(false);setScope({});refresh();}}/>}
  </>;
}
function HomePreferences(props:SmartHomeProps&{allowedActions:HomeAction[];onClose:()=>void;onSaved:()=>void}) {
  const [draft,setDraft]=useState(()=>({...props.input.workspace.userPreferences??defaultUserPreferences(props.input.workspace.defaultCurrency)}));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);const keyboard=useKeyboard();
  useBackLayer(true,()=>{if(!busy)props.onClose();return true;},220);
  const update=(v:Partial<UserPreferences>)=>setDraft(p=>({...p,...v}));
  async function save(){setError('');setBusy(true);keyboard.hide();try{validatePreferenceReferences(draft,props.input.currencies.flatMap(c=>[c.code,c.name]),props.input.warehouses,props.input.cashboxes);await savePersonalPreferences(props.uid,draft);props.onTheme(draft.theme);props.onNotify('حُفظت تفضيلاتك الشخصية.');props.onSaved();}catch(e){setError(e instanceof Error?e.message:'تعذر حفظ التفضيلات.');}finally{setBusy(false);}}
  return <div className="center-modal-layer erp-home-preferences" data-testid="home-preferences"><section className="warehouse-modal" role="dialog" aria-modal="true" aria-label="تفضيلات الرئيسية" dir="rtl"><header><h2>تفضيلات الرئيسية</h2><button disabled={busy} aria-label="إغلاق التفضيلات" onClick={props.onClose}>×</button></header><div className="erp-home-preferences-body"><p>تخص استخدامك والمستندات الجديدة؛ لا تغيّر حسابات الشركة أو الأرصدة.</p><fieldset disabled={busy}>
    <label>المظهر<select value={draft.theme} onChange={e=>update({theme:e.target.value as UserPreferences['theme']})}><option value="system">حسب الجهاز</option><option value="light">فاتح</option><option value="dark">داكن</option></select></label>
    <label>تخطيط البطاقات<select value={draft.homeColumns} onChange={e=>update({homeColumns:e.target.value==='auto'?'auto':Number(e.target.value) as 1|2|3})}><option value="auto">تلقائي</option><option value="1">عمود واحد</option><option value="2">عمودان</option><option value="3">ثلاثة أعمدة عند اتساع الشاشة</option></select></label>
    <label>العملة الافتراضية<select value={draft.defaultCurrency} onChange={e=>update({defaultCurrency:e.target.value,defaultCashboxId:null})}>{props.input.currencies.map(c=><option key={c.code} value={c.name}>{c.name}</option>)}</select></label>
    <label>الفرع الافتراضي<select value="main" onChange={()=>update({defaultBranchId:'main'})}><option value="main">{props.input.workspace.businessProfile?.branch.name??'الفرع الرئيسي'}</option></select></label>
    <label>المخزن الافتراضي<select value={draft.defaultWarehouseId} onChange={e=>update({defaultWarehouseId:e.target.value})}><option value="">دون تفضيل</option>{props.input.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    <label>الصندوق الافتراضي<select value={draft.defaultCashboxId??''} onChange={e=>update({defaultCashboxId:e.target.value?Number(e.target.value):null})}><option value="">دون تفضيل</option>{props.input.cashboxes.filter(b=>b.currencyCode===draft.defaultCurrency&&b.state!==0&&b.isActive!==false).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <legend>الإجراءات المفضلة أولًا</legend>{props.allowedActions.map(a=><label className="erp-home-check" key={a}><input type="checkbox" checked={draft.favoriteActions.includes(a)} onChange={e=>update({favoriteActions:e.target.checked?[...draft.favoriteActions.filter(v=>props.allowedActions.includes(v as HomeAction)),a]:draft.favoriteActions.filter(v=>v!==a)})}/>{HOME_ACTIONS[a]}</label>)}
  </fieldset>{error&&<p role="alert" className="erp-home-error">{error}</p>}</div><footer><button disabled={busy} onClick={props.onClose}>إلغاء</button><button disabled={busy} onClick={()=>void save()}>{busy?'جارٍ الحفظ…':'حفظ التفضيلات'}</button></footer></section></div>;
}
