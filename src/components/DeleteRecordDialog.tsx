import { useRef, useState } from 'react';
import { ReferenceManagerDialog } from './ReferenceManagerDialog';
import { useBackLayer } from '../hybrid/backCoordinator';
import { useKeyboard } from '../mobile';
export function DeleteRecordDialog({name,onDelete,onClose,onDeleted}:{name:string;onDelete:()=>Promise<void>;onClose:()=>void;onDeleted:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),gate=useRef(false),keyboard=useKeyboard();
 const close=()=>{if(!gate.current){keyboard.hide();onClose();}};
 useBackLayer(true,()=>{close();return true;},250);
 const remove=async()=>{if(gate.current)return;keyboard.hide();gate.current=true;setBusy(true);try{await onDelete();onDeleted();}catch(e){setError(e instanceof Error?e.message:'تعذر حذف السجل');}finally{gate.current=false;setBusy(false);}};
 return <ReferenceManagerDialog title="تأكيد الحذف" onClose={close} busy={busy} alert footer={<><button className="reference-button secondary" disabled={busy} onClick={close}>إلغاء</button><button className="reference-button danger" disabled={busy} onClick={()=>void remove()}>تأكيد الحذف</button></>}><p>حذف «{name}»؟ سيبقى السجل محفوظًا إذا كان مرتبطًا بأرصدة أو مستندات أو إعدادات.</p>{error&&<p role="alert" className="reference-error">{error}</p>}</ReferenceManagerDialog>;
}
