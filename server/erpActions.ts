import type { DatabaseSync } from 'node:sqlite';
import { ErpValidationError, erpRows } from '../src/erpRecordRules.ts';
import { getFullWorkspaceBundle, loadErpDataRows, withTransaction, insertLedgerEntryRow, upsertAccountRow, writeAudit } from './sqliteDb.ts';
import { computeEmployeeNetSalary } from '../src/erp.ts';
/** Existing web business buttons execute one transaction, never a UI sequence of
 * stock writes followed by a possibly failed record save. Amounts come from DB. */
export function executeErpAction(db:DatabaseSync,w:string,input:Record<string,unknown>){
 if(!input||Object.keys(input).some(k=>!['action','id','expectedRevision','currency','month'].includes(k)))throw new ErpValidationError('طلب ترحيل غير صالح.');
 const action=input.action;
 if(!['receivePurchaseOrder','convertDeal','completeProduction','postPayroll'].includes(String(action)))throw new ErpValidationError('العملية غير مدعومة.');
 return withTransaction(db,()=>{
  const data=loadErpDataRows(db,w),bundle=getFullWorkspaceBundle(db,w),today=new Date().toISOString().slice(0,10);
  if(action==='postPayroll'){
   const month=input.month,currency=input.currency;
   if(month!==today.slice(0,7)||typeof currency!=='string'||!bundle.currencies.some(c=>c.name===currency))throw new ErpValidationError('شهر الرواتب أو العملة غير صالح.');
   const key=`erp-payroll:${month}`;
   if(db.prepare('SELECT 1 FROM ledger_entries WHERE workspace_id=? AND idempotency_key=?').get(w,key))return bundle;
   const amount=data.employees.filter(e=>e.status!=='inactive').reduce((sum,e)=>sum+computeEmployeeNetSalary(e),0);
   if(!Number.isFinite(amount)||amount<=0)throw new ErpValidationError('لا توجد رواتب مستحقة.');
   const account=upsertAccountRow(db,w,{name:`مسير رواتب ${month}`,category:'employees',currency:currency as any,openingBalance:0});
   insertLedgerEntryRow(db,w,{accountId:account.id,accountName:account.name,kind:'voucher',typeLabel:'صرف رواتب',payment:'cash',direction:'debit',amount,currency:currency as any,exchangeRate:1,invoiceContent:'none',entryDate:today,details:`مسير رواتب ${month}`,expenseCategory:'رواتب وأجور',idempotencyKey:key});
   db.prepare('UPDATE erp_meta SET last_payroll_run_month=? WHERE workspace_id=?').run(month,w);
  }else{
   const c=action==='receivePurchaseOrder'?'purchaseOrders':action==='convertDeal'?'deals':'productionOrders';
   const record=erpRows(data,c).find(r=>r.id===input.id);if(!record)throw new ErpValidationError('السجل غير موجود.',404);
   if(record.postedLedgerEntryId||record.convertedInvoiceEntryId||record.status==='completed')return bundle;
   if(record._revision!==input.expectedRevision)throw new ErpValidationError('تغيّر السجل؛ حدّثه قبل الترحيل.',409);
   if(action==='receivePurchaseOrder'){
    if(record.status!=='approved')throw new ErpValidationError('اعتمد أمر الشراء أولًا.');
    const supplier=bundle.accounts.find(a=>a.id===record.supplierAccountId);if(!supplier||supplier.currency!==record.currency)throw new ErpValidationError('حساب المورد أو عملته غير صالح.');
    const lines=record.lines.map((l:any)=>{const item=bundle.inventory.find(i=>i.id===l.inventoryItemId);if(!item||item.quantityUnverified||item.warehouseId&&item.warehouseId!==record.warehouseId)throw new ErpValidationError('الصنف غير متاح في مخزن الاستلام.');return {inventoryItemId:item.id,itemName:item.name,unit:item.unit,warehouseId:record.warehouseId,quantity:l.quantity,price:l.unitCost,total:l.quantity*l.unitCost};});
    const entry=insertLedgerEntryRow(db,w,{accountId:supplier.id,accountName:supplier.name,kind:'invoice',typeLabel:'فاتورة شراء (PO)',payment:'credit',direction:'credit',amount:lines.reduce((n:number,l:any)=>n+l.total,0),currency:record.currency,exchangeRate:1,details:record.notes,documentNumber:record.poNumber,warehouseId:record.warehouseId,warehouseName:record.warehouseName,invoiceContent:'items',entryDate:today,lines,idempotencyKey:`erp-po:${record.id}`});
    db.prepare("UPDATE erp_purchase_orders SET status='received',posted_ledger_entry_id=? WHERE workspace_id=? AND id=?").run(entry.id,w,record.id);
   }else if(action==='convertDeal'){
    if(record.stage!=='won')throw new ErpValidationError('يجب إغلاق الصفقة بنجاح أولًا.');
    const account=bundle.accounts.find(a=>a.id===record.clientAccountId);if(!account||account.currency!==record.currency||record.value<=0)throw new ErpValidationError('حساب الصفقة أو قيمتها غير صالح.');
    const entry=insertLedgerEntryRow(db,w,{accountId:account.id,accountName:account.name,kind:'invoice',typeLabel:'فاتورة مبيعات حرة',payment:'credit',direction:'debit',amount:record.value,currency:record.currency,exchangeRate:1,details:record.title,invoiceContent:'free',entryDate:today,idempotencyKey:`erp-deal:${record.id}`});
    db.prepare('UPDATE erp_deals SET converted_invoice_entry_id=? WHERE workspace_id=? AND id=?').run(entry.id,w,record.id);
   }else{
    const bom=data.boms.find(b=>b.id===record.bomId),finished=bundle.inventory.find(i=>i.id===record.finishedItemId&&i.warehouseId===record.warehouseId);
    if(!bom||!finished||finished.quantityUnverified||record.quantityToProduce<=0)throw new ErpValidationError('تحقق من قائمة المواد ورصيد المنتج ومخزن الإنتاج.');
    let cost=0;const quantities=new Map<string,number>();
    for(const line of bom.components){const item=bundle.inventory.find(i=>i.id===line.inventoryItemId&&i.warehouseId===record.warehouseId),qty=line.quantityPerUnit*record.quantityToProduce;if(!item||item.quantityUnverified||qty<=0||qty>item.quantity||item.id===finished.id||quantities.has(item.id))throw new ErpValidationError('الخامات غير كافية أو غير صالحة للإنتاج.');quantities.set(item.id,item.quantity-qty);cost+=qty*item.avgCost;}
    const newQty=finished.quantity+record.quantityToProduce,avg=(finished.quantity*finished.avgCost+cost)/newQty;
    if(!Number.isFinite(avg)||avg<0)throw new ErpValidationError('تكلفة الإنتاج غير صالحة.');
    for(const [id,quantity] of quantities)db.prepare('UPDATE inventory_items SET quantity=?,updated_at=? WHERE workspace_id=? AND id=?').run(quantity,new Date().toISOString(),w,id);
    db.prepare('UPDATE inventory_items SET quantity=?,avg_cost=?,updated_at=? WHERE workspace_id=? AND id=?').run(newQty,avg,new Date().toISOString(),w,finished.id);
    db.prepare("UPDATE erp_production_orders SET status='completed',completed_date=? WHERE workspace_id=? AND id=?").run(today,w,record.id);
   }
  }
  writeAudit(db,w,w,'erp_records',String(input.id??input.month),String(action));
  return getFullWorkspaceBundle(db,w);
 });
}
