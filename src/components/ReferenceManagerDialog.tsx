import {createPortal} from 'react-dom';
import {useId, type ReactNode} from 'react';
import {Cross2Icon} from '@radix-ui/react-icons';
import {MobileScroll, useKeyboardInsets, useScreenPortal} from '../mobile';

/** Shared phone-scoped reference editor; the calling document stays mounted. */
export function ReferenceManagerDialog({title, description, onClose, busy=false, hidden=false, testId, footer, children, alert=false}: {
 title:string; description?:string; onClose:()=>void; busy?:boolean; hidden?:boolean;
 testId?:string; footer:ReactNode; children:ReactNode; alert?:boolean;
}) {
 const titleId=useId();
 const {bottomInset}=useKeyboardInsets();
 const {screenRef}=useScreenPortal();
 const target=screenRef.current?.querySelector(".nasqo-app")??screenRef.current;
 const content=<div className="center-modal-layer reference-manager-layer" hidden={hidden} data-testid={testId} style={{bottom:bottomInset}}>
  <button className="center-modal-backdrop" disabled={busy} onClick={onClose} aria-label={`إغلاق ${title}`}/>
  <section className="reference-manager-dialog" role={alert?'alertdialog':'dialog'} aria-modal="true" aria-labelledby={titleId} dir="rtl">
   <header className="smart-modal-header">
    <button type="button" className="smart-modal-close" disabled={busy} onClick={onClose} aria-label={`رجوع من ${title}`}><Cross2Icon/></button>
    <h2 id={titleId}>{title}</h2><span aria-hidden="true"/>
   </header>
   <MobileScroll className="reference-manager-scroll">
    <div className="reference-manager-body">
     {description?<p className="reference-manager-note">{description}</p>:null}
     {children}
    </div>
   </MobileScroll>
   <footer className="reference-manager-footer">{footer}</footer>
  </section>
 </div>;
 return target?createPortal(content,target):content;
}
