import type { DatabaseSync } from 'node:sqlite';
import { ErpValidationError, ERP_COLLECTIONS, erpRows } from '../src/erpRecordRules.ts';
import { loadErpDataRows, upsertAccountRow, withTransaction, writeAudit } from './sqliteDb.ts';
import type { CashboxRecord, CurrencyCode } from '../src/types.ts';
export function containsReference(value:unknown,id:string|number,keys:string[]):boolean {
 if(Array.isArray(value))return value.some(v=>containsReference(v,id,keys));
 if(value&&typeof value==='object')return Object.entries(value).some(([k,v])=>(keys.includes(k)&&(v===id||Array.isArray(v)&&v.includes(id)))||containsReference(v,id,keys));
 return false;
}
export function assertMasterNotReferenced(db:DatabaseSync,workspace:string,id:string|number,keys:string[]){
 const erp=loadErpDataRows(db,workspace);
 for(const c of ERP_COLLECTIONS) if(erpRows(erp,c).some(r=>containsReference(r,id,keys)))throw new ErpValidationError('السجل مرتبط ببيانات إدارية؛ عدّل المرجع أولًا.');
 const ws=db.prepare('SELECT reference_defaults_json,cashier_settings_json,user_preferences_json FROM workspaces WHERE id=?').get(workspace) as Record<string,unknown>|undefined;
 for(const value of Object.values(ws??{})) if(value){const cfg=JSON.parse(String(value));
  if(containsReference(cfg,id,[...keys,...keys.map(k => `default${k[0].toUpperCase()}${k.slice(1)}`)]))throw new ErpValidationError('السجل مستخدم في الإعدادات الافتراضية.');
  if(keys.includes('currency')&&String(id) in (cfg.systemCashboxes??{}))throw new ErpValidationError('العملة مستخدمة في الإعدادات الافتراضية.');
  if(keys.includes('cashboxId')&&['systemCashboxes','accountCashboxes','groupCashboxes'].some(k=>Object.values(cfg[k]??{}).includes(id)))throw new ErpValidationError('الصندوق مستخدم في الإعدادات الافتراضية.');
  if((keys.includes('groupId')&&String(id) in (cfg.groupCashboxes??{}))||(keys.includes('accountId')&&String(id) in (cfg.accountCashboxes??{})))throw new ErpValidationError('السجل مستخدم في الإعدادات الافتراضية.');
 }
}
function inUse(db:DatabaseSync,w:string,id:string|number,table:string,fields:string[]){return !!db.prepare(`SELECT 1 FROM ${table} WHERE workspace_id=? AND (${fields.map(k=>`${k}=?`).join(' OR ')}) LIMIT 1`).get(w,...fields.map(()=>id));}
export function deleteMasterRecord(db:DatabaseSync,w:string,kind:'group'|'warehouse'|'cashbox',id:string|number){
 return withTransaction(db,()=>{
  const table={group:'account_groups',warehouse:'warehouses',cashbox:'cashboxes'}[kind];
  if(!db.prepare(`SELECT id FROM ${table} WHERE workspace_id=? AND id=?`).get(w,id))throw new ErpValidationError('السجل غير موجود.',404);
  assertMasterNotReferenced(db,w,id,[{group:'groupId',warehouse:'warehouseId',cashbox:'cashboxId'}[kind]]);
  const used=kind==='group'?inUse(db,w,id,'accounts',['group_id']):kind==='cashbox'?inUse(db,w,id,'ledger_entries',['cashbox_id']):
   inUse(db,w,id,'inventory_items',['warehouse_id'])||inUse(db,w,id,'ledger_entries',['warehouse_id'])||inUse(db,w,id,'invoice_lines',['warehouse_id'])||inUse(db,w,id,'stock_transfers',['from_warehouse_id','to_warehouse_id'])||inUse(db,w,id,'archived_document_lines',['warehouse_id']);
  if(used)throw new ErpValidationError('السجل مرتبط بحسابات أو مستندات محفوظة ولا يمكن حذفه.');
  db.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND id=?`).run(w,id);
  writeAudit(db,w,w,table,String(id),'delete');
 });
}
export function saveCashboxRecord(db:DatabaseSync,w:string,input:Record<string,unknown>):CashboxRecord{
 if(!input||Object.keys(input).some(k=>!['id','name','currencyCode','accountId','isActive'].includes(k)))throw new ErpValidationError('حقول الصندوق غير صالحة.');
 const name=typeof input.name==='string'?input.name.trim():'',currency=input.currencyCode,active=input.isActive??true,id=input.id;
 if(!name||name.length>100||typeof currency!=='string'||typeof active!=='boolean'||id!==undefined&&(!Number.isSafeInteger(id)||Number(id)<=0))throw new ErpValidationError('أدخل اسم الصندوق وعملته بشكل صحيح.');
 if(!db.prepare('SELECT id FROM currencies WHERE workspace_id=? AND name=?').get(w,currency))throw new ErpValidationError('العملة غير موجودة.');
 return withTransaction(db,()=>{
  const old=id===undefined?undefined:db.prepare('SELECT * FROM cashboxes WHERE workspace_id=? AND id=?').get(w,Number(id));
  if(id!==undefined&&!old)throw new ErpValidationError('الصندوق غير موجود.',404);
  if(old&&old.currency_code!==currency)throw new ErpValidationError('عملة الصندوق محفوظة ولا تتغير.');
  if(db.prepare('SELECT id FROM cashboxes WHERE workspace_id=? AND name=? AND id<>?').get(w,name,Number(id??0)))throw new ErpValidationError('اسم الصندوق مستخدم.');
  let accountId=typeof input.accountId==='string'&&input.accountId?input.accountId:old?.account_id as string|undefined;
  if(accountId){
   if(!db.prepare('SELECT id FROM accounts WHERE workspace_id=? AND id=? AND currency=? AND is_cash_account=1').get(w,accountId,currency))throw new ErpValidationError('اختر حساب صندوق من العملة نفسها.');
   if(old?.account_id&&old.account_id!==accountId)throw new ErpValidationError('لا يمكن تغيير حساب الترحيل المرتبط بالصندوق.');
   if(db.prepare('SELECT id FROM cashboxes WHERE workspace_id=? AND account_id=? AND id<>?').get(w,accountId,Number(id??0)))throw new ErpValidationError('الحساب مرتبط بصندوق آخر.');
  }else accountId=upsertAccountRow(db,w,{name:`حساب ${name}`,category:'transfers',currency:currency as CurrencyCode,isCashAccount:true,openingBalance:0,openingDirection:'debit'}).id;
  const actualId=id===undefined?Number(db.prepare('INSERT INTO cashboxes (workspace_id,name,currency_code,state,account_id) VALUES (?,?,?,?,?)').run(w,name,currency,active?1:0,accountId).lastInsertRowid):Number(id);
  if(old)db.prepare('UPDATE cashboxes SET name=?,state=?,account_id=? WHERE workspace_id=? AND id=?').run(name,active?1:0,accountId,w,actualId);
  writeAudit(db,w,w,'cashboxes',String(actualId),old?'update':'create');
  return {id:actualId,name,currencyCode:currency as CurrencyCode,state:active?1:0,isActive:active,details:String(old?.details??''),accountId};
 });
}
