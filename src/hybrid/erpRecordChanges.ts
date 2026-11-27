import type { ErpWorkspaceData } from '../erp';
import { ERP_COLLECTIONS, erpRows, type ErpRecordChange } from '../erpRecordRules';
export function buildErpRecordChanges(before:ErpWorkspaceData,after:ErpWorkspaceData):ErpRecordChange[]{
  const changes:ErpRecordChange[]=[];
  if(before.lastPayrollRunMonth!==after.lastPayrollRunMonth)throw new Error('اعتماد مسير الرواتب يتم من عملية الترحيل المخصصة.');
  for(const c of ERP_COLLECTIONS){
    const oldRows=erpRows(before,c), newRows=erpRows(after,c);
    for(const old of oldRows) if(!newRows.some(r=>r.id===old.id)) changes.push({collection:c,operation:'delete',record:{id:old.id},expectedRevision:old._revision??0});
    for(const next of newRows){
      const old=oldRows.find(row=>row.id===next.id);
      if(JSON.stringify(old)===JSON.stringify(next))continue;
      const {_revision,...record}=next;
      changes.push({collection:c,operation:old?'update':'create',record,expectedRevision:next._revision??old?._revision??0});
    }
  }
  if(changes.length>10)throw new Error('احفظ عشرة سجلات إدارية أو أقل في كل إجراء');
  return changes;
}
