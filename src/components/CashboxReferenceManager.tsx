import {useRef,useState} from 'react';
import {KeyboardInput,useKeyboard} from '../mobile';
import {useBackLayer} from '../hybrid/backCoordinator';
import {hybridBridge} from '../hybrid/bridge';
import {createIdempotencyKey,type HybridWorkspaceSnapshot} from '../hybrid/contracts';
import {applyHybridSnapshot} from '../hybrid/serviceAdapter';
import type {AccountRecord,CashboxRecord} from '../types';
import {AccountSelectCombobox} from './AccountSelectCombobox';
import {ReferenceManagerDialog} from './ReferenceManagerDialog';

export function CashboxReferenceManager({workspace,currency,accounts,boxes,onSelect,onClose,onAddAccount,blocked}:{blocked?:boolean;workspace:string;currency:string;accounts:readonly AccountRecord[];boxes:readonly CashboxRecord[];onSelect?:(id:number)=>void;onClose:()=>void;onAddAccount:(select:(id:string)=>void)=>void}){
 const keyboard=useKeyboard();const [query,setQuery]=useState('');const [editing,setEditing]=useState<CashboxRecord|null|undefined>();const [name,setName]=useState(''),[accountId,setAccountId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const gate=useRef(false);const [confirmArchive,setConfirmArchive]=useState(false);
 const back=()=>{if(gate.current)return;keyboard.hide();setError('');if(confirmArchive)setConfirmArchive(false);else if(editing!==undefined)setEditing(undefined);else onClose();};
 // The account combobox (200) must close before this editor (150).
 useBackLayer(!blocked,()=>{back();return true;},150);
 const scoped=boxes.filter(b=>b.currencyCode===currency&&b.name.includes(query));
 const eligible=accounts.filter(a=>a.isCashAccount&&a.currency===currency);
 const edit=(box:CashboxRecord|null)=>{keyboard.hide();setError('');setEditing(box);setName(box?.name??'');setAccountId(box&&'accountId' in box?String(box.accountId):'');};
 async function save(active=true){if(gate.current)return;gate.current=true;setBusy(true);setError('');keyboard.hide();try{
  const result=await hybridBridge.invoke<'saveCashbox',{cashbox:CashboxRecord;snapshot:HybridWorkspaceSnapshot}>('saveCashbox',{workspaceId:workspace,payload:{...(editing?{id:editing.id}:{}),name,currencyCode:currency,accountId,isActive:active}},{idempotencyKey:createIdempotencyKey('saveCashbox')});
  applyHybridSnapshot(result.snapshot);setConfirmArchive(false);if(active&&onSelect){onSelect(result.cashbox.id);onClose();}else setEditing(undefined);
 }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الصندوق');}finally{gate.current=false;setBusy(false);}}
 return <ReferenceManagerDialog title={confirmArchive?'تأكيد أرشفة الصندوق':editing!==undefined?`${editing?'تعديل':'إضافة'} صندوق — ${currency}`:`إدارة الصناديق — ${currency}`} description="يجهّز النظام حساب الصندوق تلقائيًا. يمكنك اختيار حساب آخر عند الحاجة." onClose={back} busy={busy} hidden={blocked} alert={confirmArchive} testId="cashbox-reference-manager" footer={<>
  <button className="reference-button secondary" disabled={busy} onClick={back}>{confirmArchive?'إلغاء الأرشفة':editing!==undefined?'إلغاء التعديل':'إلغاء والعودة'}</button>
  {confirmArchive?<button className="reference-button danger" disabled={busy} onClick={()=>void save(false)}>تأكيد الأرشفة</button>:editing!==undefined?<button className="reference-button primary" disabled={busy||!name.trim()} onClick={()=>void save(true)}>{busy?'جاري الحفظ...':onSelect?'حفظ واختيار':'حفظ الصندوق'}</button>:<button className="reference-button primary" onClick={()=>edit(null)}>صندوق جديد</button>}
 </>}>
 {confirmArchive?<p>أرشفة «{editing?.name}»؟ تبقى الحركات محفوظة.</p>:editing!==undefined?<fieldset className="reference-manager-fields" disabled={busy}>
  <label className="reference-field"><span>اسم الصندوق</span><KeyboardInput aria-label="اسم الصندوق الجديد" value={name} onChange={e=>setName(e.target.value)}/></label>
  <details className="reference-field"><summary>تخصيص حساب الصندوق (اختياري)</summary><span>{currency}</span><AccountSelectCombobox accounts={eligible} value={accountId} onChange={setAccountId} ariaLabel="حساب ترحيل الصندوق" onAddAccount={()=>{keyboard.hide();onAddAccount(setAccountId);}}/></details>
  {editing?<button className="reference-button danger" onClick={()=>{keyboard.hide();setConfirmArchive(true);}}>أرشفة الصندوق</button>:null}
 </fieldset>:<>
  <label className="reference-field"><span>البحث عن صندوق</span><KeyboardInput aria-label="البحث عن صندوق" placeholder="اكتب اسم الصندوق..." value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <div className="reference-manager-list">{scoped.map(box=><article className="reference-manager-row" key={box.id}>
   <div className="reference-row-heading"><strong>{box.name}</strong><span>{box.isActive===false||box.state===0?'مؤرشف':currency}</span></div>
   <div className="reference-row-actions"><button className="reference-button secondary" onClick={()=>edit(box)} aria-label={`تعديل ${box.name}`}>تعديل</button>
   {onSelect?<button className="reference-button primary" disabled={box.isActive===false||box.state===0} onClick={()=>{keyboard.hide();onSelect(box.id);onClose();}} aria-label={`${box.name} — اختيار والعودة`}>اختيار والعودة</button>:null}</div>
  </article>)}{!scoped.length?<p className="reference-empty">لا توجد صناديق مطابقة لهذه العملة والبحث.</p>:null}</div>
 </>}
 {error?<p className="reference-error" role="alert">{error}</p>:null}
 </ReferenceManagerDialog>;
}
