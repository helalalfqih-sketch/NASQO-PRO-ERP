import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { applyErpRecordChanges, ERP_COLLECTIONS, erpRows, ErpValidationError, type ErpCollection, type ErpRow } from '../src/erpRecordRules.ts';
import { loadErpDataRows, withTransaction, writeAudit } from './sqliteDb.ts';

const tables:Record<Exclude<ErpCollection,'vatConfig'>,string>={employees:'erp_employees',leaveRequests:'erp_leave_requests',deals:'erp_deals',purchaseOrders:'erp_purchase_orders',boms:'erp_boms',productionOrders:'erp_production_orders',costCenters:'erp_cost_centers'};
const columns:Record<string,string>={accountId:'account_id',roleTitle:'role_title',basicSalary:'basic_salary',hireDate:'hire_date',leaveBalanceDays:'leave_balance_days',attendanceToday:'attendance_today',employeeId:'employee_id',employeeName:'employee_name',leaveType:'leave_type',startDate:'start_date',clientAccountId:'client_account_id',clientName:'client_name',expectedCloseDate:'expected_close_date',assignedTo:'assigned_to',poNumber:'po_number',supplierAccountId:'supplier_account_id',supplierName:'supplier_name',warehouseId:'warehouse_id',warehouseName:'warehouse_name',orderDate:'order_date',expectedDate:'expected_date',lines:'lines_json',finishedItemId:'finished_item_id',finishedItemName:'finished_item_name',finishedUnit:'finished_unit',components:'components_json',orderNumber:'order_number',bomId:'bom_id',bomName:'bom_name',quantityToProduce:'quantity_to_produce',createdDate:'created_date',costCenterId:'cost_center_id',managerName:'manager_name',extraPostedSpend:'extra_posted_spend',linkedCategories:'linked_categories_json'};
export function saveErpRecords(db:DatabaseSync, workspace:string, changes:unknown) {
  if(!db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspace)) throw new ErpValidationError('مساحة العمل غير موجودة.',404);
  return withTransaction(db,()=>{
    const before=loadErpDataRows(db,workspace);
    const next=applyErpRecordChanges(before,changes,{
      accounts:db.prepare('SELECT id,currency FROM accounts WHERE workspace_id=?').all(workspace) as Array<{id:string;currency:string}>,
      inventory:db.prepare('SELECT id,unit FROM inventory_items WHERE workspace_id=?').all(workspace) as Array<{id:string;unit:string}>,
      warehouses:db.prepare('SELECT id FROM warehouses WHERE workspace_id=?').all(workspace) as Array<{id:string}>,
      currencies:(db.prepare('SELECT name FROM currencies WHERE workspace_id=?').all(workspace) as Array<{name:string}>).map(r=>r.name),
    });
    for(const c of ERP_COLLECTIONS) {
      const oldRows=erpRows(before,c), rows=erpRows(next,c);
      for(const old of oldRows) if(!rows.some(r=>r.id===old.id) && c!=='vatConfig') db.prepare(`DELETE FROM ${tables[c]} WHERE workspace_id=? AND id=?`).run(workspace,old.id);
      for(const row of rows) {
        const old=oldRows.find(r=>r.id===row.id);
        if(JSON.stringify(old)===JSON.stringify(row)) continue;
        if(c==='vatConfig') {
          const {_revision,id,...config}=row;
          db.prepare('UPDATE erp_meta SET vat_config_json=?, updated_at=? WHERE workspace_id=?').run(JSON.stringify(config),new Date().toISOString(),workspace);
          continue;
        }
        const values:Record<string,SQLInputValue>={};
        for(const [key,value] of Object.entries(row)) {
          if(key==='_revision')continue;
          values[columns[key]??key]=(Array.isArray(value)?JSON.stringify(value):value??null) as SQLInputValue;
        }
        if(old) {
          // Optional fields removed by the editor must really be cleared.
          for(const key of Object.keys(old)) if(key!=='_revision' && !(key in row)) values[columns[key]??key]=null;
          delete values.id;
          db.prepare(`UPDATE ${tables[c]} SET ${Object.keys(values).map(k=>`${k}=?`).join(',')} WHERE workspace_id=? AND id=?`).run(...Object.values(values),workspace,row.id);
        } else {
          values.workspace_id=workspace;
          db.prepare(`INSERT INTO ${tables[c]} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
        }
      }
    }
    writeAudit(db,workspace,'local-admin','erp_records','batch','change',{count:(changes as unknown[]).length});
    return loadErpDataRows(db,workspace);
  });
}
