import { useLayoutEffect, useEffect, useState } from 'react';
import { computeStatementRows } from '../accounting';
import type {AccountRecord,LedgerEntryRecord} from '../types';
import { outputNativeDocument, usesNativeDocumentOutput } from '../hybrid/documentOutput';
export type ReportCell=string|number;
export type ReportDocument={title:string;kind:string;scope:Record<string,string>;columns:string[];rows:Array<{id:string;currency:string;cells:ReportCell[]}>;totals:Array<{currency:string;debit:number;credit:number;balance:number}>;confirmation?:boolean};
export type ReportSource=(allCurrencies:boolean)=>ReportDocument|Promise<ReportDocument>;
export const reportSources=new Map<string,ReportSource>();
const reportListeners=new Map<string,Set<()=>void>>();
export function useReportPreview(key:string){
 const [report,setReport]=useState<ReportDocument|null>(null);
 useEffect(()=>{let generation=0,live=true;const update=()=>{const request=++generation;const source=reportSources.get(key);if(!source){setReport(null);return;}Promise.resolve().then(()=>source(false)).then(r=>{if(live&&request===generation)setReport(r);}).catch(()=>{if(live&&request===generation)setReport(null);});};const listeners=reportListeners.get(key)??new Set();reportListeners.set(key,listeners);listeners.add(update);update();return()=>{live=false;listeners.delete(update);};},[key]);
 return report;
}
export function reportTotalText(report:ReportDocument|null,key:'debit'|'credit'|'balance'){return report?report.totals.map(t=>`${t[key].toLocaleString('en-US',{maximumFractionDigits:2})} ${t.currency}`).join(' / ')||'0':'—';}

export function useReportSource(key:string,source:ReportSource){
 useLayoutEffect(()=>{reportSources.set(key,source);reportListeners.get(key)?.forEach(fn=>fn());return()=>{if(reportSources.get(key)===source){reportSources.delete(key);reportListeners.get(key)?.forEach(fn=>fn());}};});
}
export function buildStatementReport(account:AccountRecord,ledger:readonly LedgerEntryRecord[],options:Parameters<typeof computeStatementRows>[2],all=false):ReportDocument{
 const currency=all?'الكل':options?.currency??account.currency;
 if(currency==='مصارفة الكل بعملة ريال')throw new Error('لا يوجد مصدر موثق لسعر الصرف المعتمد؛ اختر عملة واحدة أو جميع العملات دون مصارفة');
 const statement=computeStatementRows(account,ledger,{...options,currency});
 const totals=statement.currencyTotals??[{currency:['الكل','جميع العملات بدون مصارفة'].includes(currency)?(statement.rows[0]?.currency||account.currency):currency,debit:statement.debitTotal,credit:statement.creditTotal,balance:statement.netBalance}];
 return {kind:'statement',title:'كشف حساب: '+account.name,scope:{accountId:account.id,account:account.name,from:options?.fromDate||'',to:options?.toDate||'',search:options?.searchQuery||'',currency},columns:['الرقم','التاريخ','النوع','البيان','المبلغ','العملة','الرصيد'],rows:statement.rows.map(r=>({id:r.id,currency:r.currency,cells:[r.entryNumber,r.entryDate,r.typeLabel||r.kind,r.details||'',r.amount,r.currency,r.runningBalance]})),totals};
}
export function reportSummaryText(r:ReportDocument){return r.totals.map(t=>`${t.currency}: عليه ${t.debit}، له ${t.credit}، الرصيد ${t.balance}`).join(' | ');}
export async function reportXlsxBytes(r:ReportDocument):Promise<Uint8Array>{
 const x=await import('xlsx');const book=x.utils.book_new();
 const sheet=x.utils.aoa_to_sheet([r.columns,...r.rows.map(row=>row.cells)]);
 sheet['!views']=[{RTL:true}];sheet['!cols']=r.columns.map(()=>({wch:22}));
 x.utils.book_append_sheet(book,sheet,'التقرير');
 x.utils.book_append_sheet(book,x.utils.aoa_to_sheet([['العملة','عليه','له','الرصيد'],...r.totals.map(t=>[t.currency,t.debit,t.credit,t.balance])]),'الأرصدة');
 x.utils.book_append_sheet(book,x.utils.aoa_to_sheet([['التقرير',r.title],...Object.entries(r.scope)]),'نطاق التقرير');
 return new Uint8Array(x.write(book,{type:'array',bookType:'xlsx',compression:true}));
}
function wrap(ctx:CanvasRenderingContext2D,text:string,width:number):string[]{
 const lines:string[]=[];let line='';for(const ch of text){if(ch==='\n'||ctx.measureText(line+ch).width>width){lines.push(line);line=ch==='\n'?'':ch;}else line+=ch;}lines.push(line);return lines;
}
export async function renderReportPages(r:ReportDocument):Promise<HTMLCanvasElement[]>{
 await document.fonts.ready;const pages:HTMLCanvasElement[]=[];let canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D,y=0;
 const width=1240,height=1754,margin=44,colWidth=(width-margin*2)/r.columns.length,rowLimit=height-180;
 const newPage=()=>{canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#0b385d';ctx.font='bold 30px "IBM Plex Sans Arabic"';ctx.fillText(r.title,width-margin,55);ctx.font='18px "IBM Plex Sans Arabic"';y=88;
  for(const text of wrap(ctx,Object.entries(r.scope).filter(([k,v])=>v&&k!=='accountId').map(([k,v])=>`${({from:'من',to:'إلى',currency:'العملة',search:'البحث',account:'الحساب',warehouse:'المخزن'} as Record<string,string>)[k]??k}: ${v}`).join(' | '),width-margin*2)){ctx.fillText(text,width-margin,y);y+=24;}
  ctx.fillText('عدد الصفوف: '+r.rows.length,width-margin,y);y+=32;ctx.fillStyle='#e7eff7';ctx.fillRect(margin,y,width-margin*2,36);ctx.fillStyle='#0b385d';r.columns.forEach((label,i)=>ctx.fillText(label,width-margin-i*colWidth-8,y+25,colWidth-16));y+=40;pages.push(canvas);
 };
 newPage();
 for(const row of r.rows){
  ctx!.font='18px "IBM Plex Sans Arabic"';const cells=row.cells.map(c=>wrap(ctx!,String(c),colWidth-16));let start=0;const total=Math.max(...cells.map(c=>c.length));
  while(start<total){if(y+30>rowLimit)newPage();const take=Math.min(total-start,Math.max(1,Math.floor((rowLimit-y-10)/26)));
   ctx!.fillStyle=pages.length%2?'#f7fafc':'#f0f5fa';ctx!.fillRect(margin,y,width-margin*2,take*26+10);ctx!.fillStyle='#172e46';
   cells.forEach((lines,i)=>lines.slice(start,start+take).forEach((line,j)=>ctx!.fillText(line,width-margin-i*colWidth-8,y+25+j*26)));
   y+=take*26+12;start+=take;if(start<total)newPage();
  }
 }
 if(!r.rows.length){ctx!.fillText('لا توجد نتائج ضمن النطاق المحدد',width-margin,y+30);y+=70;}
 for(const text of r.totals.map(t=>`${t.currency} — عليه: ${t.debit} | له: ${t.credit} | الرصيد: ${t.balance}`)){
  if(y+40>rowLimit)newPage();ctx!.font='bold 20px "IBM Plex Sans Arabic"';ctx!.fillText(text,width-margin,y+28);y+=40;
 }
 if(r.confirmation){if(y+150>rowLimit)newPage();ctx!.fillText('نرجو مصادقة الرصيد أعلاه عن الفترة والعملات المحددة.',width-margin,y+40);ctx!.fillText('الاسم: __________________   التوقيع والختم: __________________',width-margin,y+90);}
 pages.forEach((p,i)=>{const c=p.getContext('2d')!;c.font='18px "IBM Plex Sans Arabic"';c.fillStyle='#526c82';c.textAlign='right';c.fillText(`صفحة ${i+1} من ${pages.length}`,width-margin,height-38);});
 return pages;
}
export async function outputBytes(bytes:Uint8Array,name:string,mime:string,mode:'save'|'share'|'print'):Promise<boolean>{
 if(usesNativeDocumentOutput())return outputNativeDocument(bytes,name,mime as Parameters<typeof outputNativeDocument>[2],mode);
 const blob=new Blob([bytes.slice().buffer],{type:mime});
 if(mode==='share'){const file=new File([blob],name,{type:mime});if(!navigator.canShare?.({files:[file]}))throw new Error('مشاركة الملفات غير متاحة في هذا المتصفح؛ اختر حفظ');try{await navigator.share({files:[file],title:name});return true;}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return false;throw e;}}
 const url=URL.createObjectURL(blob);if(mode==='print'){window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);return true;}
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
}
export async function exportReport(r:ReportDocument,format:'pdf'|'excel'|'image',mode:'save'|'share'|'print'){
 const name=`nasqo-${r.kind}-${new Date().toISOString().slice(0,10)}`;
 if(format==='excel')return outputBytes(await reportXlsxBytes(r),name+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',mode==='print'?'save':mode);
 const pages=await renderReportPages(r);
 if(format==='image'){
  for(let i=0;i<pages.length;i++){const blob=await new Promise<Blob>((resolve,reject)=>pages[i].toBlob(b=>b?resolve(b):reject(new Error('تعذر إنشاء الصورة')),'image/png'));if(!await outputBytes(new Uint8Array(await blob.arrayBuffer()),`${name}-${i+1}-of-${pages.length}.png`,'image/png',mode==='print'?'save':mode))return false;}return true;
 }
 const {jsPDF}=await import('jspdf');const pdf=new jsPDF({unit:'px',format:[1240,1754],hotfixes:['px_scaling']});pages.forEach((p,i)=>{if(i)pdf.addPage([1240,1754]);pdf.addImage(p.toDataURL('image/png'),'PNG',0,0,1240,1754,undefined,'FAST');});
 return outputBytes(new Uint8Array(pdf.output('arraybuffer')),name+'.pdf','application/pdf',mode);
}
