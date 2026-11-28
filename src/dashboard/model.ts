import { affectsAccountBalance, computeAccountSummary } from '../accounting.ts';
import { businessToday } from '../utils/businessSetup.ts';
import { addMoney, subMoney } from '../utils/moneyMath.ts';
import type { AccountRecord, CashboxRecord, InventoryItemRecord, LedgerEntryRecord, WarehouseRecord, WorkspaceSettings } from '../types.ts';

export const HOME_ACTIONS = { sale: 'فاتورة بيع', purchase: 'فاتورة شراء', receipt: 'سند قبض', payment: 'سند صرف', journal: 'قيد يومية' } as const;
export type HomeAction = keyof typeof HOME_ACTIONS;
export const HOME_MODULES = { accounts: 'الحسابات', sales: 'المبيعات', purchases: 'المشتريات', inventory: 'المخزون', cashboxes: 'الصناديق', customers: 'العملاء', vendors: 'الموردون', reports: 'التقارير' } as const;
export type HomeModule = keyof typeof HOME_MODULES;
export type HomeRole = 'manager' | 'accountant' | 'cashier' | 'warehouse' | 'sales' | 'purchasing';
export type HomeMetric = 'sales' | 'purchases' | 'cash' | 'receivables' | 'payables' | 'receipts' | 'payments' | 'stockItems' | 'lowStock' | 'warehouses' | 'outOfStock' | 'invoices' | 'vouchers' | 'customers' | 'vendors';
export type HomePrincipal = { id: string; workspaceId: string; role: HomeRole };
export const HOME_POLICIES: Record<HomeRole, { metrics: HomeMetric[]; actions: HomeAction[]; modules: HomeModule[] }> = {
  manager: { metrics: ['sales','purchases','cash','receivables'], actions: ['sale','purchase','receipt','payment','journal'], modules: ['accounts','sales','purchases','inventory','cashboxes','customers','vendors','reports'] },
  accountant: { metrics: ['receivables','payables','cash','invoices'], actions: ['receipt','payment','journal'], modules: ['accounts','customers','vendors','cashboxes','reports'] },
  cashier: { metrics: ['cash','receipts','payments','vouchers'], actions: ['receipt','payment'], modules: ['cashboxes'] },
  warehouse: { metrics: ['stockItems','lowStock','warehouses','outOfStock'], actions: [], modules: ['inventory'] },
  sales: { metrics: ['sales','receivables','customers','invoices'], actions: ['sale','receipt'], modules: ['sales','customers'] },
  purchasing: { metrics: ['purchases','payables','vendors','invoices'], actions: ['purchase','payment'], modules: ['purchases','vendors'] },
};
export type HomeScope = { currency: string; warehouseId: string; branchId: 'main'; fromDate: string; toDate: string };
export type HomeJournal = {id:string;number:number;date:string;currency:string;description:string;lines:{accountId:string;accountName:string;debit:number;credit:number}[]};
export type HomeTarget = { kind:'journal'; document:HomeJournal } | { kind:'warehouse';id:string } | { kind: 'metric'; metric: HomeMetric } | { kind: 'entry'; id: string } | { kind: 'account'; id: string } | { kind: 'item'; id: string };
export type HomeKpi = { id: HomeMetric; label: string; value: number; unit: string; caption: string };
export type HomeRow = { id: string; title: string; subtitle: string; amount?: number; currency?: string; target: HomeTarget };
export type HomeInput = {
  workspace: WorkspaceSettings; accounts: AccountRecord[]; ledger: LedgerEntryRecord[]; inventory: InventoryItemRecord[];
  warehouses: WarehouseRecord[]; currencies: { name: string; code: string }[]; cashboxes: CashboxRecord[];
};
export type HomeCashReport = { cashboxes: (Omit<CashboxRecord, "details"> & { netBalance: number; totalIn: number; totalOut: number })[] };
export type HomeSnapshot = { version: 1; principal: HomePrincipal; scope: HomeScope; today: string; generatedAt: string;
  source: string; timezone: string; branchName: string; kpis: HomeKpi[]; actions: HomeAction[]; modules: HomeModule[];
  alerts: HomeRow[]; recent: HomeRow[]; currencies: string[]; warehouses: {id:string;name:string}[];
};
export function invoiceSide(e: LedgerEntryRecord): 'sales' | 'purchases' | null {
  if (e.kind !== 'invoice' && e.kind !== 'return') return null;
  if (e.stockPosting) return e.stockSale ? 'sales' : 'purchases';
  if (e.docType !== undefined && [2,7,4].includes(e.docType)) return 'sales';
  if (e.docType !== undefined && [3,9,5].includes(e.docType)) return 'purchases';
  return (e.kind === 'invoice' ? e.direction === 'debit' : e.direction === 'credit') ? 'sales' : 'purchases';
}
export function committed(e: LedgerEntryRecord) { return affectsAccountBalance(e) && (e.postingStatus === 'posted' || e.postingStatus === 'reversed'); }
export function invoiceValue(e:LedgerEntryRecord, byId:Map<string,LedgerEntryRecord>) {
  const original=e.reversedEntryId ? byId.get(e.reversedEntryId) : undefined;
  const source=original??e;
  return {side:invoiceSide(source),amount:(original?-1:1)*(source.kind==='return'?-1:1)*(source.stockPosting?(source.netBeforeTax??source.amount):source.amount)};
}
export function homeEntryAllowed(e: LedgerEntryRecord, role: HomeRole, byId?:Map<string,LedgerEntryRecord>): boolean {
  const source=(e.reversedEntryId&&byId?.get(e.reversedEntryId))||e;
  if (role === 'warehouse') return false; // Stock-only roles must not receive prices or counterparties.
  if (role === 'sales') return invoiceSide(source) === 'sales';
  if (role === 'purchasing') return invoiceSide(source) === 'purchases';
  if (role === 'cashier') return e.kind === 'voucher' && e.payment === 'cash';
  return true;
}
function date(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
export function resolveHomeScope(input: HomeInput, raw: Partial<HomeScope>, now = new Date()): HomeScope {
  if (Object.keys(raw).some(k => !['currency','warehouseId','branchId','fromDate','toDate'].includes(k))) throw new Error('مرشح الرئيسية غير صالح.');
  const p=input.workspace.userPreferences, today=businessToday(input.workspace.businessProfile?.timezone,now);
  const month=input.workspace.businessProfile?.fiscalYearStartMonth ?? 1;
  const fiscalYear=Number(today.slice(0,4))-(Number(today.slice(5,7))<month?1:0);
  const requestedCurrency=raw.currency ?? p?.defaultCurrency ?? input.workspace.defaultCurrency;
  const currency=input.currencies.find(c=>c.name===requestedCurrency||c.code===requestedCurrency)?.name??requestedCurrency;
  // Never silently turn a stale/unauthorized reference into an unfiltered financial query.
  const warehouseId=raw.warehouseId ?? p?.defaultWarehouseId ?? '';
  const result={currency,warehouseId,branchId:raw.branchId ?? 'main',fromDate:raw.fromDate ?? `${fiscalYear}-${String(month).padStart(2,'0')}-01`,toDate:raw.toDate ?? today};
  if (result.branchId!=='main' || !input.currencies.some(c=>c.name===currency || c.code===currency) || currency==='الكل' ||
      typeof warehouseId!=='string' || warehouseId && !input.warehouses.some(w=>w.id===warehouseId) ||
      !date(result.fromDate) || !date(result.toDate) || result.fromDate>result.toDate || result.toDate>today) throw new Error('راجع عملة ونطاق الرئيسية؛ لا يُجمع أكثر من عملة ولا يُستبدل مرجع محذوف تلقائيًا.');
  return result;
}
export function entryInHomeScope(e: LedgerEntryRecord, scope: HomeScope) {
  return committed(e) && e.currency===scope.currency && (!scope.warehouseId || e.warehouseId===scope.warehouseId) && e.entryDate>=scope.fromDate && e.entryDate<=scope.toDate;
}
const yieldTask = () => new Promise<void>(resolve=>setTimeout(resolve,0));
/** Pure read projection. The service supplies the authenticated principal, never preferences or request JSON. */
export async function buildHomeSnapshot(input: HomeInput, scope: HomeScope, cash: HomeCashReport, principal: HomePrincipal, now=new Date()): Promise<HomeSnapshot> {
  if (principal.workspaceId !== input.workspace.id || !Object.prototype.hasOwnProperty.call(HOME_POLICIES,principal.role)) throw new Error('لا تملك صلاحية عرض الرئيسية.');
  const policy=HOME_POLICIES[principal.role], today=businessToday(input.workspace.businessProfile?.timezone,now);
  const entries:LedgerEntryRecord[]=[], balances:LedgerEntryRecord[]=[];
  const byId=new Map(input.ledger.map(e=>[e.id,e]));
  let sales=0,purchases=0,receipts=0,payments=0;
  for(let i=0;i<input.ledger.length;i++) {
    const e=input.ledger[i];
    if(i%250===0) await yieldTask();
    if(!committed(e) || e.currency!==scope.currency || e.entryDate>scope.toDate) continue;
    balances.push(e);
    if(!entryInHomeScope(e,scope) || !homeEntryAllowed(e,principal.role,byId))continue;
    entries.push(e);
    if(e.entryDate!==today) continue;
    const {side,amount}=invoiceValue(e,byId);
    if(side==='sales') sales=addMoney(sales,amount);
    if(side==='purchases') purchases=addMoney(purchases,amount);
    if(e.kind==='voucher' && e.payment==='cash') { if(e.direction==='credit') receipts=addMoney(receipts,e.amount);else payments=addMoney(payments,e.amount); }
  }
  let receivables=0,payables=0; const attention:HomeRow[]=[];
  const byAccount=new Map<string,LedgerEntryRecord[]>();
  for(const e of balances) for(const id of new Set([e.accountId,e.counterpartAccountId,...(e.journalLines??[]).map(l=>l.accountId)])) {
    if(!id)continue;const list=byAccount.get(id)??[];list.push(e);byAccount.set(id,list);
  }
  const customers=input.accounts.filter(a=>a.category==='clients'&&!a.isCashAccount);
  const vendors=input.accounts.filter(a=>a.category==='purchases'&&!a.isCashAccount);
  if(policy.metrics.includes('receivables')||policy.metrics.includes('payables')) {
    let index=0;
    for(const account of [...customers,...vendors]) {
      if(index++%50===0) await yieldTask();
      if(account.category==='clients'&&!policy.metrics.includes('receivables') || account.category==='purchases'&&!policy.metrics.includes('payables')) continue;
      const summary=computeAccountSummary(account,byAccount.get(account.id)??[],scope.currency), net=subMoney(summary.debitTotal,summary.creditTotal);
      if(account.category==='clients') receivables=addMoney(receivables,Math.max(0,net));
      else payables=addMoney(payables,Math.max(0,-net));
      if(account.category==='clients' && net>0 && (byAccount.get(account.id)??[]).some(e=>e.accountId===account.id && invoiceSide(e)==='sales' && e.dueDate && e.dueDate<today)) attention.push({id:`due:${account.id}`,title:`متابعة تحصيل: ${account.name}`,subtitle:'يوجد مستند تجاوز موعده؛ المبلغ رصيد الحساب الحالي',amount:net,currency:scope.currency,target:{kind:'account',id:account.id}});
    }
  }
  const stock=policy.modules.includes('inventory') ? input.inventory.filter(i=>!i.quantityUnverified && (!scope.warehouseId||i.warehouseId===scope.warehouseId) && (i.currencyCode??input.workspace.defaultCurrency)===scope.currency) : [];
  const low=stock.filter(i=>Number(i.minThreshold)>0&&i.quantity<=Number(i.minThreshold));
  for(const item of low.slice(0,5)) attention.push({id:`low:${item.id}`,title:`مخزون منخفض: ${item.name}`,subtitle:`الرصيد الحالي ${item.quantity} ${item.unit} · الحد ${item.minThreshold}`,target:{kind:'item',id:item.id}});
  const activeBoxes=cash.cashboxes.filter(b=>b.currencyCode===scope.currency&&b.isActive!==false&&b.state!==0);
  const values:Record<HomeMetric,number>={sales,purchases,receipts,payments,receivables,payables,cash:activeBoxes.reduce((n,b)=>addMoney(n,b.netBalance),0),stockItems:stock.length,outOfStock:stock.filter(i=>i.quantity<=0).length,lowStock:low.length,warehouses:scope.warehouseId?1:input.warehouses.length,invoices:entries.filter(e=>e.kind==='invoice').length,vouchers:entries.filter(e=>e.kind==='voucher').length,customers:customers.filter(a=>a.currency===scope.currency).length,vendors:vendors.filter(a=>a.currency===scope.currency).length};
  const labels:Record<HomeMetric,string>={sales:'مبيعات اليوم',purchases:'مشتريات اليوم',cash:'النقد المتاح',receivables:'مستحقات العملاء',payables:'مستحقات الموردين',receipts:'مقبوضات اليوم',payments:'مدفوعات اليوم',stockItems:'أصناف المخزون',outOfStock:'أصناف نفدت',lowStock:'أصناف دون الحد',warehouses:'المخازن',invoices:'الفواتير المرحّلة',vouchers:'السندات المرحّلة',customers:'العملاء',vendors:'الموردون'};
  const kpis=policy.metrics.map(id=>({id,label:labels[id],value:values[id],unit:['stockItems','lowStock','warehouses','outOfStock','invoices','vouchers','customers','vendors'].includes(id)?'':scope.currency,
    caption:['cash','receivables','payables'].includes(id)?`حتى ${scope.toDate} · كل المخازن${id==='cash'?' · الصناديق النشطة':''}`:['sales','purchases','receipts','payments'].includes(id)?`${today} · صافي المرتجعات`: `${scope.fromDate} – ${scope.toDate}`}));
  entries.sort((a,b)=>b.entryDate.localeCompare(a.entryDate)||b.createdAtMs-a.createdAtMs||b.entryNumber-a.entryNumber);
  return {version:1,principal,scope,today,generatedAt:now.toISOString(),source:input.workspace.legacySourceSha??'',timezone:input.workspace.businessProfile?.timezone??'UTC',branchName:input.workspace.businessProfile?.branch.name??'الفرع الرئيسي',kpis,actions:[...policy.actions],modules:[...policy.modules],alerts:attention.slice(0,5),recent:entries.slice(0,5).map(e=>({id:e.id,title:`${e.typeLabel} #${e.entryNumber}`,subtitle:`${e.accountName} · ${e.entryDate}`,amount:e.amount,currency:e.currency,target:homeEntryTarget(e,input)})),currencies:[...new Set(input.currencies.map(c=>c.name))],warehouses:input.warehouses.map(w=>({id:w.id,name:w.name}))};
}

function homeEntryTarget(e:LedgerEntryRecord,input:HomeInput):HomeTarget {
  if(e.kind!=='simple-entry') return {kind:'entry',id:e.id};
  const lines=e.journalLines?.length?e.journalLines.map(l=>({accountId:l.accountId,accountName:input.accounts.find(a=>a.id===l.accountId)?.name??l.accountId,debit:l.debitMinor/100,credit:l.creditMinor/100})):
    [{accountId:e.accountId,accountName:e.accountName,debit:e.direction==='debit'?e.amount:0,credit:e.direction==='credit'?e.amount:0},
     {accountId:e.counterpartAccountId??'',accountName:e.counterpartAccountName??'',debit:e.direction==='credit'?e.amount:0,credit:e.direction==='debit'?e.amount:0}];
  return {kind:'journal',document:{id:e.id,number:e.entryNumber,date:e.entryDate,currency:e.currency,description:e.details,lines}};
}
export type HomeDetail = {title:string;total:number|null;unit:string;rows:HomeRow[];scope:HomeScope};
export async function buildHomeDetail(input:HomeInput,scope:HomeScope,cash:HomeCashReport,principal:HomePrincipal,metric:HomeMetric,now=new Date()):Promise<HomeDetail> {
  const snapshot=await buildHomeSnapshot(input,scope,cash,principal,now);
  if(!HOME_POLICIES[principal.role].metrics.includes(metric)) throw new Error('لا تملك صلاحية التقرير.');
  const kpi=snapshot.kpis.find(k=>k.id===metric)!; let rows:HomeRow[]=[]; const byId=new Map(input.ledger.map(e=>[e.id,e]));
  if(metric==='cash') rows=cash.cashboxes.filter(b=>b.currencyCode===scope.currency&&b.state!==0&&b.isActive!==false).map(b=>({id:String(b.id),title:b.name,subtitle:`وارد ${b.totalIn} · صادر ${b.totalOut}`,amount:b.netBalance,currency:scope.currency,target:{kind:'metric',metric:'cash'}}));
  else if(metric==='receivables'||metric==='payables') {
    const entries=input.ledger.filter(e=>committed(e)&&e.currency===scope.currency&&e.entryDate<=scope.toDate);
    for(const a of input.accounts.filter(a=>a.category===(metric==='receivables'?'clients':'purchases')&&!a.isCashAccount)){
      const summary=computeAccountSummary(a,entries,scope.currency), amount=Math.max(0,metric==='receivables'?subMoney(summary.debitTotal,summary.creditTotal):subMoney(summary.creditTotal,summary.debitTotal));
      if(amount>0) rows.push({id:a.id,title:a.name,subtitle:`حتى ${scope.toDate} · كل المخازن`,amount,currency:scope.currency,target:{kind:'account',id:a.id}});
    }
  } else if(['stockItems','lowStock','outOfStock'].includes(metric)) {
    rows=input.inventory.filter(i=>!i.quantityUnverified&&(!scope.warehouseId||i.warehouseId===scope.warehouseId)&&(i.currencyCode??input.workspace.defaultCurrency)===scope.currency&&
      (metric==='lowStock'?Number(i.minThreshold)>0&&i.quantity<=Number(i.minThreshold):metric==='outOfStock'?i.quantity<=0:true))
      .map(i=>({id:i.id,title:i.name,subtitle:`${i.quantity} ${i.unit}`,target:{kind:'item',id:i.id}}));
  } else if(metric==='warehouses') rows=input.warehouses.filter(w=>!scope.warehouseId||w.id===scope.warehouseId).map(w=>({id:w.id,title:w.name,subtitle:'حركة المخزون',target:{kind:'warehouse',id:w.id}}));
  else if(metric==='customers'||metric==='vendors') rows=input.accounts.filter(a=>a.category===(metric==='customers'?'clients':'purchases')&&!a.isCashAccount&&a.currency===scope.currency).map(a=>({id:a.id,title:a.name,subtitle:a.currency,target:{kind:'account',id:a.id}}));
  else rows=input.ledger.filter(e=>entryInHomeScope(e,scope)&&homeEntryAllowed(e,principal.role,byId)&&
      (metric==='invoices'?e.kind==='invoice':metric==='vouchers'?e.kind==='voucher':e.entryDate===snapshot.today&&(metric==='sales'||metric==='purchases'?invoiceValue(e,byId).side===metric:e.kind==='voucher'&&e.payment==='cash'&&e.direction===(metric==='receipts'?'credit':'debit'))))
      .sort((a,b)=>b.entryDate.localeCompare(a.entryDate)||b.createdAtMs-a.createdAtMs).map(e=>({id:e.id,title:`${e.typeLabel} #${e.entryNumber}`,subtitle:`${e.accountName} · ${e.entryDate}`,amount:invoiceValue(e,byId).amount,currency:e.currency,target:homeEntryTarget(e,input)}));
  return {title:kpi.label,total:kpi.value,unit:kpi.unit,rows,scope};
}
