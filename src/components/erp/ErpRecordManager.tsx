import { useRef, useState, type ReactNode } from 'react';
import { KeyboardInput, useKeyboard } from '../../mobile';
import { parseErpNumber } from '../../erpInput';
import { normalizeArabicSearch } from '../../accounting';
import { saveErpRecordCommands, type ErpWorkspaceData } from '../../erp';
import { erpRows, isLockedErpRecord, validateErpRecord, type ErpCollection, type ErpRow } from '../../erpRecordRules';
import type { AccountRecord, InventoryItemRecord, WarehouseRecord } from '../../types';
import { ReferenceManagerDialog } from '../ReferenceManagerDialog';
import { useBackLayer } from '../../hybrid/backCoordinator';

type Field = [string,string,'text'|'number'|'date'|'select',string?];
const fields:Record<string,Field[]>={
 employees:[['name','اسم الموظف','text'],['roleTitle','المسمى الوظيفي','text'],['department','القسم','text'],['basicSalary','الراتب الأساسي','number'],['allowances','البدلات','number'],['deductions','الاستقطاعات','number'],['hireDate','تاريخ التعيين','date'],['leaveBalanceDays','رصيد الإجازات','number'],['status','الحالة','select'],['attendanceToday','الحضور','select'],['accountId','الحساب المرتبط (اختياري)','select','accounts']],
 leaveRequests:[['employeeId','الموظف','select','employees'],['leaveType','نوع الإجازة','select'],['startDate','بداية الإجازة','date'],['days','عدد الأيام','number'],['status','الحالة','select'],['note','ملاحظة','text']],
 deals:[['title','عنوان الصفقة','text'],['clientAccountId','حساب العميل','select','accounts'],['value','القيمة','number'],['currency','العملة','select','currencies'],['stage','المرحلة','select'],['probability','احتمال النجاح %','number'],['expectedCloseDate','تاريخ الإغلاق المتوقع','date'],['assignedTo','المسؤول','text']],
 purchaseOrders:[['poNumber','رقم أمر الشراء','text'],['supplierAccountId','حساب المورد','select','accounts'],['warehouseId','المخزن','select','warehouses'],['currency','العملة','select','currencies'],['orderDate','تاريخ الطلب','date'],['expectedDate','التاريخ المتوقع','date'],['status','الحالة','select'],['notes','ملاحظات','text']],
 boms:[['name','اسم قائمة المواد','text'],['finishedItemId','المنتج النهائي','select','inventory']],
 productionOrders:[['orderNumber','رقم أمر الإنتاج','text'],['bomId','قائمة المواد','select','boms'],['quantityToProduce','كمية الإنتاج','number'],['warehouseId','المخزن','select','warehouses'],['costCenterId','مركز التكلفة (اختياري)','select','costCenters'],['status','الحالة','select'],['createdDate','تاريخ الأمر','date']],
 costCenters:[['code','رمز المركز','text'],['name','اسم المركز','text'],['managerName','المسؤول','text'],['budget','الموازنة','number'],['status','الحالة','select']],
};
const titles:Record<string,string>={employees:'الموظفون',leaveRequests:'طلبات الإجازة',deals:'فرص المبيعات',purchaseOrders:'أوامر الشراء',boms:'قوائم المواد',productionOrders:'أوامر الإنتاج',costCenters:'مراكز التكلفة'};
const choices:Record<string,Record<string,string>>={
 'employees.status':{active:'نشط','on-leave':'في إجازة',inactive:'غير نشط'}, 'attendanceToday':{present:'حاضر',leave:'إجازة',absent:'غائب'},
 'leaveRequests.status':{pending:'قيد المراجعة',approved:'معتمدة',rejected:'مرفوضة'}, leaveType:{سنوية:'سنوية',مرضية:'مرضية',اضطرارية:'اضطرارية'},
 'purchaseOrders.status':{draft:'مسودة',approved:'معتمد',received:'مستلم ومرحّل'}, 'productionOrders.status':{planned:'مخطط','in-progress':'قيد التنفيذ',completed:'مكتمل'},
 'costCenters.status':{active:'نشط',closed:'مغلق'}, stage:{lead:'فرصة جديدة',proposal:'عرض سعر',negotiation:'تفاوض',won:'ناجحة',lost:'مفقودة'},
};
const date=()=>new Date().toISOString().slice(0,10);
function newRecord(c:string,currency:string):ErpRow {
 const common={id:`${c}_${crypto.randomUUID().replaceAll('-','')}`};
 const defaults:Record<string,ErpRow>={
 employees:{name:'',roleTitle:'موظف',department:'الإدارة',basicSalary:0,allowances:0,deductions:0,hireDate:date(),leaveBalanceDays:21,status:'active',attendanceToday:'present'},
 leaveRequests:{employeeId:'',employeeName:'',leaveType:'سنوية',startDate:date(),days:1,status:'pending',note:''},
 deals:{title:'',clientAccountId:'',clientName:'',currency,value:0,stage:'lead',probability:25,expectedCloseDate:date(),assignedTo:''},
 purchaseOrders:{poNumber:`PO-${Date.now()}`,supplierAccountId:'',supplierName:'',warehouseId:'',warehouseName:'',currency,orderDate:date(),expectedDate:date(),status:'draft',lines:[],notes:''},
 boms:{name:'',finishedItemId:'',finishedItemName:'',finishedUnit:'',components:[]},
 productionOrders:{orderNumber:`MO-${Date.now()}`,bomId:'',bomName:'',finishedItemId:'',finishedItemName:'',warehouseId:'',quantityToProduce:1,status:'planned',createdDate:date()},
 costCenters:{code:`CC-${Date.now()}`,name:'',managerName:'',budget:0,extraPostedSpend:0,linkedCategories:['مصروفات تشغيلية'],status:'active'},
 };return {...common,...defaults[c]};
}
export function ErpRecordManager({uid,collection,erpData,currency='ريال',accounts=[],warehouses=[],inventory=[],onToast,extraActions}:{uid:string;collection:Exclude<ErpCollection,'vatConfig'>;erpData:ErpWorkspaceData;currency?:string;accounts?:readonly AccountRecord[];warehouses?:readonly WarehouseRecord[];inventory?:readonly InventoryItemRecord[];onToast:(message:string)=>void;extraActions?:(record:ErpRow)=>ReactNode}) {
 const keyboard=useKeyboard(),gate=useRef(false);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState(''),[limit,setLimit]=useState(25);
 const [draft,setDraft]=useState<ErpRow|null>(null),[original,setOriginal]=useState<ErpRow|null>(null),[view,setView]=useState(false),[deleting,setDeleting]=useState<ErpRow|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const close=()=>{if(gate.current)return;keyboard.hide();setDraft(null);setDeleting(null);setError('');};
 useBackLayer(!!draft||!!deleting,()=>{close();return true;},150);
 const records=erpRows(erpData,collection),statusField=collection==='deals'?'stage':'status';
 const statusChoices=choices[`${collection}.${statusField}`]??choices[statusField]??{};
 const label=(r:ErpRow)=>String(r.name??r.title??r.poNumber??r.orderNumber??r.employeeName??r.id);
 const visible=records.filter(r=>(!filter||r[statusField]===filter)&&normalizeArabicSearch(Object.values(r).filter(v=>typeof v==='string').join(' ')).includes(normalizeArabicSearch(query)));
 const open=(r?:ErpRow,readOnly=false)=>{keyboard.hide();setOriginal(r?structuredClone(r):null);setDraft(r?structuredClone(r):newRecord(collection,currency));setView(readOnly);setError('');};
 const options=(key:string,source?:string):Array<[string,string]>=>{
   if(source==='accounts')return accounts.map(r=>[r.id,`${r.name} — ${r.currency}`]);
   if(source==='warehouses')return warehouses.map(r=>[r.id,r.name]);
   if(source==='inventory')return inventory.map(r=>[r.id,`${r.name} — ${r.unit}`]);
   if(source==='currencies')return [...new Set([currency,...accounts.map(a=>a.currency)])].map(v=>[v,v]);
   if(source==='employees'||source==='boms'||source==='costCenters')return erpRows(erpData,source).map(r=>[r.id,r.name]);
   return Object.entries(choices[`${collection}.${key}`]??choices[key]??{}).filter(([v])=>view||!(key==='status'&&['received','completed'].includes(v)));
 };
 const set=(key:string,value:unknown)=>setDraft(prev=>{
   if(!prev)return prev;const next={...prev,[key]:value};
   if(key==='accountId'||key==='costCenterId'){if(value==='')delete next[key];}
   if(key==='clientAccountId'||key==='supplierAccountId'){const a=accounts.find(r=>r.id===value);if(a){next[key==='clientAccountId'?'clientName':'supplierName']=a.name;next.currency=a.currency;}}
   if(key==='employeeId')next.employeeName=erpData.employees.find(r=>r.id===value)?.name??'';
   if(key==='warehouseId') {if(collection==='purchaseOrders')next.warehouseName=warehouses.find(r=>r.id===value)?.name??'';}
   if(key==='finishedItemId'){const item=inventory.find(r=>r.id===value);next.finishedItemName=item?.name??'';next.finishedUnit=item?.unit??'';}
   if(key==='bomId'){const b=erpData.boms.find(r=>r.id===value);next.bomName=b?.name??'';next.finishedItemId=b?.finishedItemId??'';next.finishedItemName=b?.finishedItemName??'';}
   return next;
 });
 async function submit(remove=false){
   if(gate.current)return;const record=remove?deleting:draft;if(!record)return;
   gate.current=true;setBusy(true);setError('');keyboard.hide();
   try{
     const {_revision,...data}=record;
     if(!remove){
       for(const [key,title,type] of fields[collection])if(type==='number')data[key]=parseErpNumber(data[key],title);
       if(collection==='purchaseOrders'||collection==='boms')data[lineKey]=lineRows.map(line=>({...line,...(collection==='boms'?{quantityPerUnit:parseErpNumber(line.quantityPerUnit,'كمية المكوّن')}:{quantity:parseErpNumber(line.quantity,'الكمية'),unitCost:parseErpNumber(line.unitCost,'سعر الوحدة')})}));
       validateErpRecord(collection,data);
     }
     await saveErpRecordCommands(uid,[{collection,operation:remove?'delete':original?'update':'create',record:remove?{id:record.id}:data,expectedRevision:remove?record._revision??0:original?._revision??0}]);
     setDraft(null);setDeleting(null);onToast(remove?'تم حذف السجل بنجاح':'تم حفظ السجل بنجاح');
   }catch(e){setError(e instanceof Error?e.message:'تعذر الحفظ. بقيت المدخلات لإعادة المحاولة.');}
   finally{gate.current=false;setBusy(false);}
 }
 const lineKey=collection==='boms'?'components':'lines',lineRows=(draft?.[lineKey]??[]) as ErpRow[];
 return <section className="erp-card" data-testid={`crud-${collection}`}>
  <div className="erp-card-head"><h3>{titles[collection]}</h3><button className="erp-chip-btn" onClick={()=>open()}>إضافة سجل</button></div>
  <label className="erp-field"><span>البحث</span><KeyboardInput aria-label={`بحث ${titles[collection]}`} value={query} onChange={e=>{setQuery(e.target.value);setLimit(25);}}/></label>
  {!!Object.keys(statusChoices).length&&<label className="erp-field"><span>تصفية الحالة</span><select aria-label={`تصفية ${titles[collection]}`} value={filter} onChange={e=>{setFilter(e.target.value);setLimit(25);}}><option value="">الكل</option>{Object.entries(statusChoices).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>}
  <p role="status">{visible.length} من {records.length} سجل</p>
  <div className="erp-list">{visible.slice(0,limit).map(r=><article className="erp-record-row" key={r.id} data-testid={`record-${r.id}`}><strong>{label(r)}</strong>{r[statusField]&&<span> — {statusChoices[r[statusField]]??r[statusField]}</span>}
   <div className="erp-inline-actions"><button className="erp-chip-btn" onClick={()=>open(r,true)}>عرض</button><button className="erp-chip-btn" disabled={isLockedErpRecord(collection,r)} onClick={()=>open(r)}>تعديل</button><button className="reference-button danger" disabled={isLockedErpRecord(collection,r)} onClick={()=>{keyboard.hide();setError('');setDeleting(structuredClone(r));}}>حذف</button>{extraActions?.(r)}</div>
  </article>)}</div>
  {!visible.length&&<p>لا توجد سجلات مطابقة.</p>}{visible.length>limit&&<button className="erp-chip-btn" onClick={()=>setLimit(v=>v+25)}>عرض المزيد</button>}
  {deleting&&<ReferenceManagerDialog title="تأكيد حذف السجل" onClose={close} busy={busy} alert footer={<><button className="reference-button secondary" disabled={busy} onClick={close}>إلغاء</button><button className="reference-button danger" disabled={busy} onClick={()=>void submit(true)}>تأكيد الحذف</button></>}><p>حذف «{label(deleting)}»؟ لن تُحذف السجلات المالية أو البيانات المرتبطة به.</p>{error&&<p className="reference-error" role="alert">{error}</p>}</ReferenceManagerDialog>}
  {draft&&<ReferenceManagerDialog title={`${view?'عرض':original?'تعديل':'إضافة'} — ${titles[collection]}`} onClose={close} busy={busy} testId={`editor-${collection}`} footer={<><button className="reference-button secondary" disabled={busy} onClick={close}>{view?'إغلاق':'إلغاء'}</button>{!view&&<button className="reference-button primary" disabled={busy} onClick={()=>void submit()}>{busy?'جاري الحفظ…':'حفظ السجل'}</button>}</>}>
   <fieldset className="reference-manager-fields" disabled={busy||view}>
   {(fields[collection]??[]).map(([key,title,type,source])=><label className="reference-field" key={key}><span>{title}</span>{type==='select'?<select aria-label={title} value={draft[key]??''} onChange={e=>set(key,e.target.value)}><option value="">اختر…</option>{options(key,source).map(([id,l])=><option key={id} value={id}>{l}</option>)}</select>:<KeyboardInput aria-label={title} type={type==='date'?'date':'text'} inputMode={type==='number'?'decimal':undefined} value={String(draft[key]??'')} onChange={e=>set(key,e.target.value)}/>}</label>)}
   {collection==='costCenters'&&<label className="reference-field"><span>تصنيفات المصروفات (مفصولة بفاصلة)</span><KeyboardInput aria-label="تصنيفات المصروفات" value={draft.linkedCategories.join('، ')} onChange={e=>set('linkedCategories',e.target.value.split(/[,،]/).map(v=>v.trim()).filter(Boolean))}/></label>}
   {(collection==='boms'||collection==='purchaseOrders')&&<div className="erp-lines-editor"><h4>{collection==='boms'?'مكوّنات التصنيع':'بنود الشراء'}</h4>{lineRows.map((line,index)=><fieldset key={index} className="erp-record-row"><legend>البند {index+1}</legend><label className="reference-field"><span>الصنف</span><select aria-label={`صنف البند ${index+1}`} value={line.inventoryItemId} onChange={e=>{const item=inventory.find(i=>i.id===e.target.value);set(lineKey,lineRows.map((l,j)=>j===index?{...l,inventoryItemId:e.target.value,itemName:item?.name??'',unit:item?.unit??''}:l));}}><option value="">اختر صنفًا</option>{inventory.map(i=><option value={i.id} key={i.id}>{i.name} — {i.unit}</option>)}</select></label>
    <label className="reference-field"><span>الكمية ({line.unit})</span><KeyboardInput aria-label={`كمية البند ${index+1}`} inputMode="decimal" value={String(line[collection==='boms'?'quantityPerUnit':'quantity'])} onChange={e=>set(lineKey,lineRows.map((l,j)=>j===index?{...l,[collection==='boms'?'quantityPerUnit':'quantity']:e.target.value}:l))}/></label>
    {collection==='purchaseOrders'&&<label className="reference-field"><span>سعر الوحدة</span><KeyboardInput aria-label={`سعر البند ${index+1}`} inputMode="decimal" value={String(line.unitCost)} onChange={e=>set(lineKey,lineRows.map((l,j)=>j===index?{...l,unitCost:e.target.value}:l))}/></label>}
    {!view&&<button className="reference-button danger" onClick={()=>set(lineKey,lineRows.filter((_,j)=>j!==index))}>حذف البند</button>}
   </fieldset>)}{!view&&<button className="reference-button secondary" disabled={lineRows.length>=100} onClick={()=>set(lineKey,[...lineRows,{inventoryItemId:'',itemName:'',unit:'',...(collection==='boms'?{quantityPerUnit:1}:{quantity:1,unitCost:0})}])}>إضافة بند</button>}</div>}
   </fieldset>{error&&<p className="reference-error" role="alert">{error}</p>}
  </ReferenceManagerDialog>}
 </section>;
}
