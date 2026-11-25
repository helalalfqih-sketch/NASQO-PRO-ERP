import {useRef,useState} from 'react';
import {KeyboardInput,useKeyboard} from '../mobile';
import {useBackLayer} from '../hybrid/backCoordinator';
import {hybridBridge} from '../hybrid/bridge';
import {createIdempotencyKey,type HybridWorkspaceSnapshot} from '../hybrid/contracts';
import {applyHybridSnapshot} from '../hybrid/serviceAdapter';
import type {AccountRecord,CashboxRecord} from '../types';
import {AccountSelectCombobox} from './AccountSelectCombobox';

export function CashboxReferenceManager({workspace,currency,accounts,boxes,onSelect,onClose,onAddAccount,blocked}:{blocked?:boolean;workspace:string;currency:string;accounts:readonly AccountRecord[];boxes:readonly CashboxRecord[];onSelect?:(id:number)=>void;onClose:()=>void;onAddAccount:(select:(id:string)=>void)=>void}){
 const keyboard=useKeyboard();const [query,setQuery]=useState('');const [editing,setEditing]=useState<CashboxRecord|null|undefined>();const [name,setName]=useState(''),[accountId,setAccountId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const gate=useRef(false);const [confirmArchive,setConfirmArchive]=useState(false);
 useBackLayer(!blocked,()=>{if(!gate.current){keyboard.hide();onClose();}return true;},250);
 const scoped=boxes.filter(b=>b.currencyCode===currency&&b.name.includes(query));
 const eligible=accounts.filter(a=>a.isCashAccount&&a.currency===currency);
 async function save(active=true){if(gate.current)return;gate.current=true;setBusy(true);setError('');keyboard.hide();try{
  const result=await hybridBridge.invoke<'saveCashbox',{cashbox:CashboxRecord;snapshot:HybridWorkspaceSnapshot}>('saveCashbox',{workspaceId:workspace,payload:{...(editing?{id:editing.id}:{}),name,currencyCode:currency,accountId,isActive:active}},{idempotencyKey:createIdempotencyKey('saveCashbox')});
  applyHybridSnapshot(result.snapshot);if(active&&onSelect){onSelect(result.cashbox.id);onClose();}else setEditing(undefined);
 }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الصندوق');}finally{gate.current=false;setBusy(false);}}
 return <div className="center-modal-layer" style={{zIndex:310}} data-testid="cashbox-reference-manager"><section className="transaction-modal" role="dialog" aria-label="إدارة الصناديق" dir="rtl"><h2>إدارة الصناديق — {currency}</h2><p>إنشاء الصندوق لا يحفظ السند أو يرحّله. الربط بحساب نقدي صريح من العملة نفسها.</p><KeyboardInput aria-label="البحث عن صندوق" value={query} onChange={e=>setQuery(e.target.value)}/>
 {scoped.map(box=><div key={box.id}><button disabled={box.isActive===false||box.state===0} onClick={()=>{onSelect?.(box.id);onClose();}}>{box.name} — {onSelect?'اختيار والعودة':'إغلاق'}</button><button onClick={()=>{setEditing(box);setName(box.name);setAccountId('accountId' in box?String(box.accountId):'');}}>تعديل {box.name}</button></div>)}
 <button onClick={()=>{setEditing(null);setName('');setAccountId('');}}>صندوق جديد</button>
 {editing!==undefined?<fieldset disabled={busy}><KeyboardInput aria-label="اسم الصندوق الجديد" value={name} onChange={e=>setName(e.target.value)}/><AccountSelectCombobox accounts={eligible} value={accountId} onChange={setAccountId} ariaLabel="حساب ترحيل الصندوق" onAddAccount={()=>onAddAccount(setAccountId)}/><button onClick={()=>void save(true)}>{onSelect?'حفظ واختيار':'حفظ الصندوق'}</button>{editing?<button onClick={()=>setConfirmArchive(true)}>أرشفة الصندوق</button>:null}<button onClick={()=>setEditing(undefined)}>إلغاء التعديل</button></fieldset>:null}
 {confirmArchive?<div role="alertdialog" aria-label="تأكيد أرشفة الصندوق"><p>أرشفة «{editing?.name}»؟ تبقى الحركات محفوظة.</p><button disabled={busy} onClick={()=>{setConfirmArchive(false);void save(false);}}>تأكيد الأرشفة</button><button onClick={()=>setConfirmArchive(false)}>إلغاء الأرشفة</button></div>:null}
 {error?<p role="alert">{error}</p>:null}<button disabled={busy} onClick={()=>{keyboard.hide();onClose();}}>إلغاء والعودة</button></section></div>;
}
