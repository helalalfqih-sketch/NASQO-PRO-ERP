import { createHash } from 'node:crypto';
import { ERP_COLLECTIONS, erpRows, type ErpRow } from '../src/erpRecordRules.ts';
import type { ErpWorkspaceData } from '../src/erp.ts';
export function recordRevision(row: ErpRow): string {
  const {_revision, ...record}=row;
  const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):value;
  return createHash('sha256').update(JSON.stringify(sorted(record))).digest('hex');
}
export function revisionedErpData(data: ErpWorkspaceData): ErpWorkspaceData {
  for(const c of ERP_COLLECTIONS) for(const row of erpRows(data,c)) {
    const rev=recordRevision(row);
    if(c==='vatConfig') (data.vatConfig as ErpRow)._revision=rev; else row._revision=rev;
  }
  return data;
}
