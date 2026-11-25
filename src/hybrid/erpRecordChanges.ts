import type { ErpWorkspaceData } from '../erp';
export function buildErpRecordChanges(before:ErpWorkspaceData,after:ErpWorkspaceData){
  const changes:Array<{collection:string;record:Record<string,unknown>;expectedRevision:number}>=[];
  const allowed=['employees','deals','purchaseOrders','costCenters','productionOrders','vatConfig'];
  for(const key of Object.keys(after) as Array<keyof ErpWorkspaceData>){
    if(JSON.stringify(before[key])===JSON.stringify(after[key]))continue;
    if(!allowed.includes(key))throw new Error('هذا الإجراء الإداري غير مدعوم محليًا؛ لم تُحفظ تغييرات');
    const oldRows=key==='vatConfig'?(before[key]?[{...before[key] as object,id:'config'}]:[]):before[key] as unknown as Array<Record<string,unknown>>;
    const newRows=key==='vatConfig'?[{...after[key] as object,id:'config'}]:after[key] as unknown as Array<Record<string,unknown>>;
    if(oldRows.some(old=>!newRows.some(next=>next.id===old.id)))throw new Error('حذف السجلات الإدارية غير مدعوم من هذا المسار');
    for(const next of newRows){
      const old=oldRows.find(row=>row.id===next.id);
      if(JSON.stringify(old)===JSON.stringify(next))continue;
      const {_revision,...record}=next;
      changes.push({collection:key,record,expectedRevision:Number(old?._revision??0)});
    }
  }
  if(changes.length>10)throw new Error('احفظ عشرة سجلات إدارية أو أقل في كل إجراء');
  return changes;
}
