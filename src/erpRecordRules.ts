import type { ErpWorkspaceData } from './erp.ts';

export const ERP_COLLECTIONS = ['employees','leaveRequests','deals','purchaseOrders','boms','productionOrders','costCenters','vatConfig'] as const;
export type ErpCollection = typeof ERP_COLLECTIONS[number];
export type ErpRow = Record<string, any>;
export type ErpRecordChange = { collection: ErpCollection; operation?: 'create'|'update'|'delete'; record: ErpRow; expectedRevision: number|string };
export class ErpValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const ERP_FIELDS: Record<ErpCollection, string[]> = {
  employees: ['id','accountId','name','roleTitle','department','basicSalary','allowances','deductions','status','hireDate','leaveBalanceDays','attendanceToday'],
  leaveRequests: ['id','employeeId','employeeName','leaveType','startDate','days','status','note'],
  deals: ['id','title','clientAccountId','clientName','value','currency','stage','probability','expectedCloseDate','assignedTo'],
  purchaseOrders: ['id','poNumber','supplierAccountId','supplierName','warehouseId','warehouseName','currency','orderDate','expectedDate','status','lines','notes'],
  boms: ['id','name','finishedItemId','finishedItemName','finishedUnit','components'],
  productionOrders: ['id','orderNumber','bomId','bomName','finishedItemId','finishedItemName','quantityToProduce','warehouseId','status','createdDate','costCenterId'],
  costCenters: ['id','code','name','managerName','budget','extraPostedSpend','linkedCategories','status'],
  vatConfig: ['id','jurisdiction','ratePercent','basis'],
};
const fail = (message: string): never => { throw new ErpValidationError(message); };
export function erpRows(data: ErpWorkspaceData, c: ErpCollection): ErpRow[] {
  return c === 'vatConfig' ? (data.vatConfig ? [{...data.vatConfig,id:'config'}] : []) : data[c];
}
export function validateErpRecord(c: ErpCollection, r: ErpRow) {
  if (!ERP_COLLECTIONS.includes(c) || !r || Array.isArray(r) || typeof r !== 'object' || Object.keys(r).some(k=>!ERP_FIELDS[c].includes(k))) fail('حقول السجل غير صالحة.');
  if (typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)) fail('معرف السجل غير صالح.');
  for (const [key,v] of Object.entries(r)) {
    if (v === undefined) continue;
    if (typeof v === 'string' && v.length > 2000) fail('النص يتجاوز 2000 حرف.');
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 1e9)) fail('أدخل أرقامًا موجبة صالحة.');
    if (!['string','number'].includes(typeof v) && !['lines','components','linkedCategories'].includes(key)) fail('نوع الحقل غير صالح.');
  }
  const text = (...keys: string[]) => { for(const k of keys) if(typeof r[k] !== 'string' || !r[k].trim()) fail('أكمل الحقول المطلوبة.'); };
  const num = (k:string,min=0,max=1e9) => { if(typeof r[k] !== 'number'||!Number.isFinite(r[k])||r[k]<min||r[k]>max) fail('أدخل كمية أو مبلغًا صالحًا.'); };
  const choice = (k:string,values:string[]) => { if(!values.includes(r[k])) fail('اختر قيمة صالحة للحالة أو التصنيف.'); };
  const date = (...keys:string[]) => { for(const k of keys) if(typeof r[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r[k])||!Number.isFinite(Date.parse(r[k]))||new Date(r[k]).toISOString().slice(0,10)!==r[k]) fail('أدخل تاريخًا صالحًا.'); };
  if (c==='employees') {
    text('name','roleTitle','department'); date('hireDate'); ['basicSalary','allowances','deductions','leaveBalanceDays'].forEach(k=>num(k));
    choice('status',['active','on-leave','inactive']); choice('attendanceToday',['present','leave','absent']);
  } else if(c==='leaveRequests') {
    text('employeeId','employeeName'); date('startDate'); num('days',0.5,366); choice('leaveType',['سنوية','مرضية','اضطرارية']); choice('status',['pending','approved','rejected']);
  } else if(c==='deals') {
    text('title','clientAccountId','clientName','currency'); date('expectedCloseDate'); num('value'); num('probability',0,100); choice('stage',['lead','proposal','negotiation','won','lost']);
  } else if(c==='purchaseOrders') {
    text('poNumber','supplierAccountId','supplierName','warehouseId','warehouseName','currency'); date('orderDate','expectedDate'); choice('status',['draft','approved']);
  } else if(c==='boms') {
    text('name','finishedItemId','finishedItemName','finishedUnit');
  } else if(c==='productionOrders') {
    text('orderNumber','bomId','bomName','finishedItemId','finishedItemName','warehouseId'); date('createdDate'); num('quantityToProduce',0.000001); choice('status',['planned','in-progress']);
  } else if(c==='costCenters') {
    text('name','code'); num('budget'); num('extraPostedSpend'); choice('status',['active','closed']);
    if(!Array.isArray(r.linkedCategories)||r.linkedCategories.length>30||r.linkedCategories.some((v:unknown)=>typeof v!=='string'||v.length>100)) fail('تصنيفات مركز التكلفة غير صالحة.');
  } else if(c==='vatConfig') {
    if(r.id!=='config') fail('معرف الإعداد غير صالح.'); choice('jurisdiction',['none','sa_15','ae_5','custom']); choice('basis',['recorded_only','estimated_gross']); num('ratePercent',0,100);
    const rates:Record<string,number>={none:0,sa_15:15,ae_5:5}; if(r.jurisdiction in rates && r.ratePercent!==rates[r.jurisdiction]) fail('نسبة الضريبة لا تطابق النظام المختار.');
  }
  if(c==='purchaseOrders'||c==='boms') {
    const rows=c==='boms'?r.components:r.lines, keys=c==='boms'?['inventoryItemId','itemName','unit','quantityPerUnit']:['inventoryItemId','itemName','unit','quantity','unitCost'];
    if(!Array.isArray(rows)||!rows.length||rows.length>100) fail('أضف من بند واحد إلى 100 بند.');
    const seen=new Set();
    for(const line of rows) {
      if(!line||typeof line!=='object'||Object.keys(line).some(k=>!keys.includes(k))) fail('حقول البند غير صالحة.');
      for(const k of ['inventoryItemId','itemName','unit']) if(typeof line[k]!=='string'||!line[k].trim()||line[k].length>200) fail('اختر الصنف والوحدة لكل بند.');
      for(const k of c==='boms'?['quantityPerUnit']:['quantity','unitCost']) if(typeof line[k]!=='number'||!Number.isFinite(line[k])||line[k]<=0||line[k]>1e9) fail('كمية وسعر البند يجب أن يكونا أكبر من صفر.');
      if(c==='boms'&&(line.inventoryItemId===r.finishedItemId||seen.has(line.inventoryItemId))) fail('قائمة المواد لا تقبل المنتج نفسه أو مكوّنًا مكررًا.');
      seen.add(line.inventoryItemId);
    }
  }
}
export function isLockedErpRecord(c: ErpCollection, r: ErpRow) {
  return !!(r.postedLedgerEntryId || r.convertedInvoiceEntryId || r.completedDate || (c==='purchaseOrders'&&r.status==='received') || (c==='productionOrders'&&r.status==='completed'));
}
export type ErpReferences = { accounts: Array<{id:string;currency?:string}>; inventory: Array<{id:string;unit:string}>; warehouses: Array<{id:string}>; currencies: string[] };
/** Pure, bounded command validation shared by HTTP and editor. No financial posting. */
export function applyErpRecordChanges(current: ErpWorkspaceData, changes: unknown, refs: ErpReferences): ErpWorkspaceData {
  if(!Array.isArray(changes)||!changes.length||changes.length>10) fail('احفظ من سجل واحد إلى عشرة سجلات في العملية.');
  const next=structuredClone(current), seen=new Set<string>();
  const leaveDeltas=new Map<string,number>();
  for(const change of changes as ErpRecordChange[]) {
    if(!change||typeof change!=='object'||Object.keys(change).some(k=>!['collection','record','operation','expectedRevision'].includes(k))||!ERP_COLLECTIONS.includes(change.collection)||!change.record) fail('طلب تعديل غير صالح.');
    const {collection:c,record:r,expectedRevision}=change;
    if(typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||seen.has(`${c}:${r.id}`)) fail('معرف سجل مكرر أو غير صالح.');
    seen.add(`${c}:${r.id}`);
    const old=erpRows(current,c).find(v=>v.id===r.id), operation=change.operation??(expectedRevision===0?'create':'update');
    if(!['create','update','delete'].includes(operation)) fail('العملية غير مدعومة.');
    if(operation==='create' ? !!old || expectedRevision!==0 : !old || old._revision!==expectedRevision) throw new ErpValidationError('تغيّر السجل أو حُذف؛ حدّث القائمة قبل إعادة التعديل.',409);
    if(old&&isLockedErpRecord(c,old)) fail('المستند مرحّل ومحفوظ في السجل المالي؛ استخدم إجراء الإلغاء أو العكس من شاشة المستند.');
    if(operation==='delete') {
      if(c==='vatConfig') fail('لا يُحذف إعداد الضريبة؛ يمكن اختيار بدون ضريبة.');
      if(Object.keys(r).some(k=>k!=='id')) fail('طلب حذف غير صالح.');
      if(c==='costCenters'&&old?.extraPostedSpend) fail('المركز مرتبط بتكاليف مسجلة؛ يمكن إغلاقه.');
    } else {
      validateErpRecord(c,r);
      if(c==='costCenters' && r.extraPostedSpend!==(old?.extraPostedSpend??0)) fail('لا يمكن تغيير المصروف المرحّل من بيانات المركز.');
    }
    if(c==='leaveRequests') {
      if(old?.status==='approved') leaveDeltas.set(old.employeeId,(leaveDeltas.get(old.employeeId)??0)+old.days);
      if(operation!=='delete'&&r.status==='approved') leaveDeltas.set(r.employeeId,(leaveDeltas.get(r.employeeId)??0)-r.days);
    }
    const result=erpRows(next,c).filter(v=>v.id!==r.id);
    if(operation!=='delete') result.push({...r,_revision:old?._revision??0});
    if(c==='vatConfig') next.vatConfig=result[0] as any; else (next as any)[c]=result;
  }
  const exists=(list:Array<{id:string}>,id:unknown,label:string)=>{if(typeof id!=='string'||!list.some(v=>v.id===id)) fail(`${label} غير موجود في مساحة العمل.`);};
  // Validate affected references against the final batch, including deletes.
  for(const c of ERP_COLLECTIONS) for(const r of erpRows(next,c)) {
    const changed=seen.has(`${c}:${r.id}`);
    if(c==='leaveRequests'&&(changed||seen.has(`employees:${r.employeeId}`))) { exists(next.employees,r.employeeId,'الموظف'); if(changed)r.employeeName=next.employees.find(e=>e.id===r.employeeId)!.name; }
    if(c==='productionOrders'&&(changed||seen.has(`boms:${r.bomId}`)||seen.has(`costCenters:${r.costCenterId}`))) { exists(next.boms,r.bomId,'قائمة المواد'); if(r.costCenterId)exists(next.costCenters,r.costCenterId,'مركز التكلفة'); }
    if(!changed) continue;
    if(c==='employees'&&r.accountId) exists(refs.accounts,r.accountId,'الحساب');
    if(c==='deals'||c==='purchaseOrders') {
      const accountId=c==='deals'?r.clientAccountId:r.supplierAccountId; exists(refs.accounts,accountId,'الحساب');
      if(!refs.currencies.includes(r.currency)||refs.accounts.find(a=>a.id===accountId)?.currency!==r.currency) fail('عملة الحساب لا تطابق عملة السجل.');
    }
    if(c==='purchaseOrders'||c==='productionOrders') exists(refs.warehouses,r.warehouseId,'المخزن');
    if(c==='boms'||c==='productionOrders') exists(refs.inventory,r.finishedItemId,'المنتج');
    if(c==='boms'&&refs.inventory.find(i=>i.id===r.finishedItemId)?.unit!==r.finishedUnit)fail('وحدة المنتج لا تطابق بطاقة الصنف.');
    if(c==='boms'||c==='purchaseOrders') for(const l of (c==='boms'?r.components:r.lines)) {exists(refs.inventory,l.inventoryItemId,'الصنف');if(refs.inventory.find(i=>i.id===l.inventoryItemId)?.unit!==l.unit)fail('وحدة البند لا تطابق بطاقة الصنف؛ أعد اختيار الصنف.');}
    if(c==='boms'&&current.productionOrders.some(o=>o.bomId===r.id)) fail('قائمة المواد مستخدمة في أمر إنتاج؛ أنشئ قائمة أخرى لتغيير التركيبة.');
    if(c==='productionOrders'&&next.boms.find(b=>b.id===r.bomId)?.finishedItemId!==r.finishedItemId) fail('المنتج لا يطابق قائمة المواد.');
    const uniqueField=({employees:'name',deals:undefined,purchaseOrders:'poNumber',boms:'name',productionOrders:'orderNumber',costCenters:'code'} as Record<string,string|undefined>)[c];
    if(uniqueField&&erpRows(next,c).some(v=>v.id!==r.id&&String(v[uniqueField]).trim().toLowerCase()===String(r[uniqueField]).trim().toLowerCase())) fail('الاسم أو الرقم مستخدم في سجل آخر.');
  }
  for(const [id,delta] of leaveDeltas) {
    const emp=next.employees.find(e=>e.id===id); if(!emp) throw new ErpValidationError('الموظف مرتبط بطلب إجازة.');
    if(seen.has(`employees:${id}`)) fail('احفظ تعديل الموظف وطلب الإجازة في عمليتين منفصلتين.');
    if(emp.leaveBalanceDays+delta<0) fail('رصيد إجازات الموظف غير كافٍ.');
    emp.leaveBalanceDays+=delta;
  }
  return next;
}
