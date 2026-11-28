import type { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { buildHomeSnapshot, buildHomeDetail, resolveHomeScope, type HomeMetric, type HomeDetail, type HomeScope, type HomeSnapshot } from '../src/dashboard/model.ts';
import { DEFAULT_WORKSPACE_ID, getCashboxesReport, getFullWorkspaceBundle, resolveSqliteDbPath, SqliteValidationError } from './sqliteDb.ts';
import { readJournalProjections } from './financialReports.ts';

// Existing SQLite authentication authenticates the workspace proprietor only.
// A Google profile or editable employee role title is NOT a grant of ERP access.
export const localHomePrincipal = (workspace: string) => {
  if(workspace!==DEFAULT_WORKSPACE_ID) throw new SqliteValidationError('لا تملك صلاحية عرض مساحة العمل.',403);
  return {id: `${workspace}:owner`,workspaceId:workspace,role:'manager' as const};
};
export async function readHomeDashboard(db: DatabaseSync, workspace: string, raw: Partial<HomeScope>, now=new Date(), detail?: HomeMetric): Promise<HomeSnapshot | HomeDetail> {
  const principal=localHomePrincipal(workspace);
  // One WAL snapshot for invoices, standalone journals, cash and stock. No writes, seed, migrations or imports.
  db.exec('BEGIN');
  try {
    const input=getFullWorkspaceBundle(db,workspace,true), scope=resolveHomeScope(input,raw,now);
    input.ledger.push(...readJournalProjections(db,workspace));
    const cash=getCashboxesReport(db,workspace,{currency:scope.currency,toDate:scope.toDate});
    db.exec('COMMIT');
    return detail ? await buildHomeDetail(input,scope,cash,principal,detail,now) : await buildHomeSnapshot(input,scope,cash,principal,now);
  } catch(e) { if(db.isTransaction) db.exec('ROLLBACK'); throw e; }
}
let worker: Worker | undefined;
let sequence=0;
const pending=new Map<number,{resolve:(v:HomeSnapshot | HomeDetail)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
/** The SQLite queries run off the HTTP event loop; requests are bounded and serialized in the reader. */
export function loadHomeDashboard(workspace: string, scope: Partial<HomeScope>, detail?: HomeMetric): Promise<HomeSnapshot | HomeDetail> {
  localHomePrincipal(workspace);
  if(pending.size>=8) return Promise.reject(new SqliteValidationError('تحديث الرئيسية مشغول، حاول بعد لحظة.',503));
  if(!worker) {
    worker=new Worker(new URL('./homeDashboardWorker.mjs',import.meta.url));
    const current=worker;
    worker.unref();
    worker.on('message',({id,result,error})=>{const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);error?p.reject(new SqliteValidationError(error)):p.resolve(result);});
    const fail=()=>{if(worker!==current)return;worker=undefined;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('تعذر تحديث الرئيسية.'));}pending.clear();};
    worker.on('error',fail); worker.on('exit',fail); worker.unref();
  }
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('انتهت مهلة تحديث الرئيسية.'));void worker?.terminate();},20_000);
    pending.set(id,{resolve,reject,timer});worker!.postMessage({id,path:resolveSqliteDbPath(),workspace,scope,detail});
  });
}
