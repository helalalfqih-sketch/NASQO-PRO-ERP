/** Audit only. Current worktree built assets, synthetic host, no Android/real writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createHybridHomeFixtureSnapshot } from '../src/hybrid/homeFixture';
const out=process.env.REPAIR_OUT||path.resolve('deliverables/audit-repairs/browser'); fs.mkdirSync(out,{recursive:true});
const bundle=process.env.REPAIR_BUNDLE||path.resolve('dist/hybrid');
const s=createHybridHomeFixtureSnapshot();s.capabilities={...s.capabilities,localAccountCreation:true,localCatalogEditing:true};
s.workspace!.companyName='اختبار اصطناعي للأزرار';s.workspace!.whatsappPhone='';
s.accounts=s.accounts.map((a,i)=>({...a,name:`حساب اصطناعي ${i+1}`,phone:'',openingBalance:0}));
s.ledger=Array.from({length:12},(_,i)=>({...s.ledger[0],id:`audit-${i}`,accountId:'acc_sup_usd',accountName:'حساب اصطناعي 2',entryNumber:2000+i,amount:10+i,currency:i===11?'ريال':'دولار',entryDate:i===11?'2025-01-01':'2026-11-25',details:`بند اصطناعي ${i+1}`,createdAtMs:1795564800000,invoiceContent:'free' as const}));
s.inventory=Array.from({length:12},(_,i)=>({...s.inventory[0],id:`item-${i}`,name:`صنف اصطناعي ${i+1}`,quantity:i+1,avgCost:2,warehouseId:i===11?'wh_branch':'wh_main'}));
function host(state:any){
 const w=window as any;sessionStorage.clear();const erpKey="acceptance-erp:"+location.search;const keptErp=localStorage.getItem(erpKey);localStorage.clear();if(keptErp)localStorage.setItem(erpKey,keptErp);state.erpData=JSON.parse(localStorage.getItem(erpKey)||'{"employees":[],"leaveRequests":[],"deals":[],"purchaseOrders":[],"boms":[],"productionOrders":[],"costCenters":[]}');if(location.search.includes("empty"))state.inventory=[];if(location.search.includes("large"))state.ledger=Array.from({length:516},(_,i)=>({...state.ledger[0],id:"row-"+i,entryNumber:i+1,amount:1,details:"حركة عربية "+(i+1),currency:"دولار"}));w.auditCommands=[];w.auditFiles=[];w.canvasText=[];
 const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t:any,...args:any[]){w.canvasText.push(String(t));return (fill as any).call(this,t,...args)};
 if(location.search.includes('reference-long')){const cash=state.accounts.find((a:any)=>a.isCashAccount);state.accounts.push(...Array.from({length:40},(_,i)=>({...cash,id:'reference-cash-'+i,name:'حساب نقدي اصطناعي طويل للاختبار '+(i+1)})));}
 if(location.search.includes('settings-legacy-on'))state.uiPreferences.extendedSettings={passwordLock:true,backupReminderOnExit:true,sellWithoutBalance:true};
 const allowed=new Set(['saveWorkspaceSettings','saveAccount','saveCashbox','saveErpRecords','backupWorkspace','getSnapshot','navigate','goBack','showMessage','changeCurrency','saveUiPreferences','getProductPriceStats','getInventoryMovementsReport','getCashboxesReport','getInvoiceDetail','beginDocumentExport','appendDocumentExport','finishDocumentExport','abortDocumentExport','printDocument','exportPdf','shareText','cloudIdentityAction','googleDriveAction','localToolsAction','legacyArchiveAction']);
 let doc:any;
 w.auditEmit=(event:string,payload:any)=>w.__nasqoHybridReceive?.({protocolVersion:'1.0.0',kind:'event',event,payload,timestampMs:Date.now()});
 w.NasqoHome={postMessage(raw:string){const r=JSON.parse(raw);w.auditCommands.push(r);let data:any={ok:true};
  if(r.action==='getSnapshot')data=state;
  if(r.action==='saveWorkspaceSettings')data={workspace:{...state.workspace,...r.payload.updates}};
  if(r.action==='saveErpRecords'){
    if(!w.rejectErp){for(const c of r.payload.changes){const row={...c.record,_revision:c.expectedRevision+1};if(c.collection==='vatConfig')state.erpData.vatConfig=row;else {const list=state.erpData[c.collection];const i=list.findIndex((x:any)=>x.id===row.id);if(i<0)list.push(row);else list[i]=row;}}localStorage.setItem(erpKey,JSON.stringify(state.erpData));data={erpData:state.erpData};}
  }
if(r.action==='saveAccount'){const a={...state.accounts[0],...r.payload.payload,id:r.payload.accountId||'new-account-'+state.accounts.length,openingBalance:0};state.accounts.push(a);data={account:a,snapshot:state};}
  if(r.action==='saveCashbox'){const b={...r.payload.payload,id:99};state.cashboxes.push(b);data={cashbox:b,snapshot:state};}
  if(r.action==='backupWorkspace')data={saved:false};
  if(r.action==='getInvoiceDetail')data={entry:state.ledger.find((e:any)=>e.id===r.payload.entryId)||state.ledger[0],lines:[]};
  if(r.action==='beginDocumentExport'){doc={...r.payload,base64:[]};data={exportId:'audit-export'};}
  if(r.action==='appendDocumentExport'){doc.base64.push(r.payload.base64);data={received:r.payload.offset+atob(r.payload.base64).length};}
  if(r.action==='finishDocumentExport'){w.auditFiles.push(doc);data={completed:!w.auditCancel,mode:doc.mode};}
  if(r.action==='shareText')data={opened:true,targeted:false};
  if(['exportPdf','printDocument'].includes(r.action))data={opened:true,visiblePageOnly:true};
  if(r.action==='getProductPriceStats')data={minPrice:2,maxPrice:2,lastPrice:2};
  if(r.action==='getInventoryMovementsReport')data={warehouses:state.warehouses,warehouseStocks:[],itemRows:state.inventory.map((i:any)=>({...i,availableQty:i.quantity,buyQty:2,sellQty:1,transferInQty:0,transferOutQty:0,buyTotal:2,sellTotal:3,profit:1,remainingValue:i.quantity*2})),movements:[],totals:{totalSales:3,totalPurchases:2,totalProfit:1,totalRemainingValue:156,activeItemsCount:12,profitBasis:'avg'},anomalies:{unverifiedItemsCount:0,unresolvedTransfersCount:0}};
  if(r.action==='getCashboxesReport')data={cashboxes:[],movements:[],totals:{}};
  if(r.action==='cloudIdentityAction')data={configured:false,signedIn:false};
  if(r.action==='googleDriveAction')data={configured:false,connected:false,files:[]};
  if(r.action==='localToolsAction')data={review:false,imported:false};
  if(r.action==='legacyArchiveAction')data={available:false,items:[],totalCount:0};
  setTimeout(()=>w.__nasqoHybridReceive?.({protocolVersion:'1.0.0',kind:'response',requestId:r.requestId,action:r.action,ok:allowed.has(r.action)&&!(r.action==='saveErpRecords'&&w.rejectErp)&&!(r.action==='saveUiPreferences'&&w.rejectPreferences),...(allowed.has(r.action)&&!(r.action==='saveErpRecords'&&w.rejectErp)&&!(r.action==='saveUiPreferences'&&w.rejectPreferences)?{data}:{error:{code:'UNAUTHORIZED_ACTION',message:'Audit host rejects writes'}}),timestampMs:Date.now()}),0);
 }};
}
const fixture=`(${host.toString()})(${JSON.stringify(s)});`;
const server=http.createServer((req,res)=>{const p=new URL(req.url!,'http://localhost').pathname;if(p==='/audit.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}const f=path.resolve(bundle,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(bundle+'/')||!fs.existsSync(f)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'} as any)[path.extname(f)]||'application/octet-stream');if(f.endsWith('.html'))res.end(fs.readFileSync(f,'utf8').replace('<head>','<head><script src="/audit.js"></script>'));else fs.createReadStream(f).pipe(res);});
await new Promise<void>(r=>server.listen(process.env.REPAIR_PREVIEW?4173:0,process.env.REPAIR_PREVIEW?'0.0.0.0':'127.0.0.1',r));const addr=server.address() as any;const url=`http://127.0.0.1:${addr.port}`;
if(process.env.REPAIR_PREVIEW){console.log('Synthetic preview ready on port 4173');await new Promise(()=>{});}
const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:360,height:800}});const page=await ctx.newPage();page.setDefaultTimeout(7000);
const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(route.request().url().startsWith(url)||!/^https?:/.test(route.request().url()))return route.continue();external.push(route.request().url());return route.abort();});
let currentId='';const only=process.env.REPAIR_ONLY?.split(',');const results:any[]=[];const commands=()=>page.evaluate(()=>(window as any).auditCommands);
const emit=(route:string,params={})=>page.evaluate(({route,params})=>(window as any).auditEmit('routeChanged',{route,params}),{route,params});
const fresh=async()=>{await page.goto(url+"?case="+currentId);await expect(page.getByTestId('dashboard-screen')).toBeVisible();};
const statement=async()=>{await emit('supplier',{accountId:'acc_sup_usd'});await expect(page.getByTestId('supplier-screen')).toBeVisible();};
const prints=async()=>{await statement();await page.getByRole('button',{name:'طباعة الكشف',exact:true}).click();await expect(page.getByTestId('print-options-modal')).toBeVisible();};
const run=async(id:string,fn:()=>Promise<any>)=>{if(only&&!only.includes(id))return;try{currentId=id;await fresh();const observed=await fn();results.push({id,execution:'observed',...observed});await page.screenshot({path:`${out}/${id}.png`});fs.writeFileSync(`${out}/${id}-commands.json`,JSON.stringify(await commands(),null,2));console.log('OBSERVED '+id);}catch(e){results.push({id,execution:'test-error',error:String(e)});fs.writeFileSync(`${out}/${id}-failed-commands.json`,JSON.stringify(await commands(),null,2));await page.screenshot({path:`${out}/${id}-failure.png`});console.log('ERROR '+id+' '+String(e));}};
const exported=async()=>{await expect.poll(()=>page.evaluate(()=>(window as any).auditFiles.length)).toBe(1);const d=await page.evaluate(()=>(window as any).auditFiles[0]);const bytes=Buffer.concat(d.base64.map((b:string)=>Buffer.from(b,'base64')));fs.writeFileSync(`${out}/${currentId}-${d.fileName}`,bytes);return {d,bytes};};const drawer=async(label:string)=>{await page.getByRole('button',{name:'فتح القائمة',exact:true}).click();await page.getByRole('complementary',{name:'قائمة نسقو'}).getByRole('button',{name:label,exact:true}).click();};
const exportOptions=async()=>{await statement();await page.getByRole('button',{name:'طباعة الكشف',exact:true}).click();};
try{
 await run('voucher-new-cashbox-return',async()=>{
 await page.getByRole('button',{name:'الإجراءات السريعة',exact:true}).click();await page.getByTestId('home-quick-voucher').click();
 await page.getByTestId('transaction-amount').fill('23');
 await page.getByRole('button',{name:'إدارة صندوق السند',exact:true}).click();
 const manager=page.getByTestId('cashbox-reference-manager');
 await manager.getByRole('button',{name:'صندوق جديد',exact:true}).click();
 await manager.getByLabel('اسم الصندوق الجديد',{exact:true}).fill('صندوق الرحلة');
 await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
 await page.screenshot({path:`${out}/cashbox-linked-accounts.png`,animations:"disabled"});
 await page.getByRole('button',{name:'إضافة حساب',exact:true}).click();
 await page.getByRole('textbox',{name:'اسم الحساب',exact:true}).fill('حساب صندوق الرحلة');
 await page.getByTestId('account-form-extended').getByRole('button',{name:'حفظ واختيار',exact:true}).click();
 await expect(manager.getByLabel('اسم الصندوق الجديد',{exact:true})).toHaveValue('صندوق الرحلة');
 await expect(manager.getByRole('combobox',{name:'حساب ترحيل الصندوق',exact:true})).toContainText('حساب صندوق الرحلة');
 await manager.getByRole('button',{name:'حفظ واختيار',exact:true}).click();
 await expect(manager).toHaveCount(0);
 await expect(page.getByTestId('transaction-amount')).toHaveValue('23');
 await expect(page.getByLabel('صندوق النقد',{exact:true})).toHaveValue('99');
 const writes=(await commands()).filter((r:any)=>['saveAccount','saveCashbox','createLedgerEntry','postStockInvoice'].includes(r.action));assert.deepEqual(writes.map((r:any)=>r.action),['saveAccount','saveCashbox']);return{correct:true,parentAmountPreserved:true,parentNotPosted:true};
 });

 const openReferenceEditor=async()=>{
  await page.getByRole('button',{name:'الإجراءات السريعة',exact:true}).click();await page.getByTestId('home-quick-voucher').click();
  await page.getByTestId('transaction-amount').fill('23');
  await page.getByRole('button',{name:'إدارة صندوق السند',exact:true}).click();
  const manager=page.getByTestId('cashbox-reference-manager');
  await manager.getByRole('button',{name:'صندوق جديد',exact:true}).click();
  await manager.getByLabel('اسم الصندوق الجديد',{exact:true}).fill('صندوق اصطناعي محفوظ في النموذج');
  return manager;
 };
 let backSequence=0;
 const backReference=async()=>{await page.evaluate(id=>(window as any).auditEmit('backPressed',{requestId:id}),`reference-${++backSequence}`);await page.waitForTimeout(250);};
 const assertNoPosting=async()=>assert(!(await commands()).some((r:any)=>['createLedgerEntry','postStockInvoice','postFreeInvoice'].includes(r.action)));
 await run('reference-account-cancel-and-system-back',async()=>{
  const manager=await openReferenceEditor();
  await manager.getByRole('combobox',{name:'حساب ترحيل الصندوق',exact:true}).click();
  await expect(manager.getByRole('listbox')).toBeVisible();
  await backReference();await expect(manager.getByRole('listbox')).toHaveCount(0);
  await expect(manager.getByLabel('اسم الصندوق الجديد')).toHaveValue('صندوق اصطناعي محفوظ في النموذج');
  await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
  const accounts=page.getByTestId('reference-account-manager');await expect(accounts).toBeVisible();await expect(manager).toBeHidden();
  await expect(page.getByTestId('transaction-modal')).toBeHidden();
  await accounts.getByRole('button',{name:/^حذف /}).first().click();await expect(accounts.getByRole('alertdialog')).toBeVisible();
  await backReference();await expect(accounts.getByRole('alertdialog')).toHaveCount(0);await expect(accounts).toBeVisible();
  await accounts.getByRole('button',{name:'إلغاء والعودة',exact:true}).click();
  await expect(manager.getByLabel('اسم الصندوق الجديد')).toHaveValue('صندوق اصطناعي محفوظ في النموذج');
  await backReference();await expect(manager.getByRole('button',{name:'صندوق جديد',exact:true})).toBeVisible();
  await backReference();await expect(manager).toHaveCount(0);await expect(page.getByTestId('transaction-amount')).toHaveValue('23');
  await assertNoPosting();assert(!(await commands()).some((r:any)=>['saveCashbox','saveAccount','deleteAccount'].includes(r.action)));
  return{correct:true,oneStepPerBack:true,cancelNoWrites:true,parentAmountPreserved:true};
 });
 await run('reference-account-select-and-delete-rejection',async()=>{
  const manager=await openReferenceEditor();await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
  const accounts=page.getByTestId('reference-account-manager');
  await accounts.getByRole('button',{name:/^حذف /}).first().click();await accounts.getByRole('button',{name:'تأكيد الحذف',exact:true}).click();
  await expect(accounts.getByRole('alert')).toBeVisible();await expect(accounts.getByRole('alertdialog')).toBeVisible();
  await accounts.getByRole('button',{name:'إلغاء الحذف',exact:true}).click();
  await accounts.getByRole('button',{name:/اختيار والعودة/}).first().click();await expect(accounts).toHaveCount(0);
  await expect(manager.getByRole('combobox',{name:'حساب ترحيل الصندوق'})).toContainText('حساب اصطناعي');
  await expect(manager.getByLabel('اسم الصندوق الجديد')).toHaveValue('صندوق اصطناعي محفوظ في النموذج');
  await assertNoPosting();return{correct:true,failedDeleteRetained:true,selectionReturnsToEditor:true};
 });

 await run('reference-edit-and-archive-cancel',async()=>{
  const manager=await openReferenceEditor();await manager.getByRole('button',{name:'إلغاء التعديل',exact:true}).click();
  await manager.getByRole('button',{name:/^تعديل /}).first().click();
  const originalName=await manager.getByLabel('اسم الصندوق الجديد').inputValue();
  await manager.getByRole('button',{name:'أرشفة الصندوق',exact:true}).click();await expect(manager.getByRole('alertdialog')).toBeVisible();
  await backReference();await expect(manager.getByRole('alertdialog')).toHaveCount(0);await expect(manager.getByLabel('اسم الصندوق الجديد')).toHaveValue(originalName);
  await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
  const accounts=page.getByTestId('reference-account-manager');await accounts.getByRole('button',{name:/^تعديل /}).first().click();
  await expect(page.getByTestId('account-form-extended')).toBeVisible();await expect(accounts).toHaveCount(0);await expect(manager).toBeHidden();
  await page.getByTestId('account-form-extended').getByRole('button',{name:'إلغاء',exact:true}).click();await expect(accounts).toBeVisible();
  await accounts.getByRole('button',{name:'إلغاء والعودة',exact:true}).click();await expect(manager.getByLabel('اسم الصندوق الجديد')).toHaveValue(originalName);
  assert(!(await commands()).some((r:any)=>['saveCashbox','saveAccount'].includes(r.action)));await assertNoPosting();return{correct:true,archiveCanceled:true,editCanceled:true};
 });
 await run('reference-long-list-scroll',async()=>{
  const manager=await openReferenceEditor();await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
  const accounts=page.getByTestId('reference-account-manager');const last=accounts.getByRole('button',{name:'حساب نقدي اصطناعي طويل للاختبار 40 — اختيار والعودة',exact:true});
  await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport();
  await expect(accounts.getByRole('button',{name:'إلغاء والعودة',exact:true})).toBeInViewport();
  await page.screenshot({path:`${out}/reference-long-list.png`,animations:'disabled'});
  await last.click();await expect(manager.getByRole('combobox',{name:'حساب ترحيل الصندوق'})).toContainText('للاختبار 40');
  await assertNoPosting();return{correct:true,all41AccountsReachable:true,fixedFooterReachable:true};
 });

 await run('reference-from-cashboxes-report',async()=>{
  await emit('cashboxes-report');const report=page.getByTestId('cashboxes-report-modal');await expect(report).toBeVisible();
  await report.getByRole('button',{name:'إدارة الصناديق',exact:true}).click();
  const manager=page.getByTestId('cashbox-reference-manager');await expect(manager).toBeVisible();await expect(report).toBeHidden();
  assert.equal(await manager.getByRole('button',{name:/اختيار والعودة/}).count(),0);
  await manager.getByRole('button',{name:'إلغاء والعودة',exact:true}).click();await expect(report).toBeVisible();
  assert(!(await commands()).some((r:any)=>r.action==='saveCashbox'));await assertNoPosting();return{correct:true,reportRestored:true,noMisleadingRowClose:true};
 });
 await run('reference-from-invoice-preserves-note',async()=>{
  await statement();await page.locator('.footer-menu').click();await page.getByRole('menuitem',{name:'فاتورة جديدة',exact:true}).click();
  const invoice=page.getByTestId('invoice-modal');await invoice.getByLabel('بيان الفاتورة',{exact:true}).fill('مسودة اصطناعية قبل إدارة الحساب');
  await invoice.getByTestId('invoice-account-add').click();const accounts=page.getByTestId('reference-account-manager');await expect(accounts).toBeVisible();await expect(invoice).toBeHidden();
  await accounts.getByRole('button',{name:'إلغاء والعودة',exact:true}).click();await expect(invoice).toBeVisible();
  await expect(invoice.getByLabel('بيان الفاتورة',{exact:true})).toHaveValue('مسودة اصطناعية قبل إدارة الحساب');await assertNoPosting();return{correct:true,invoiceNotePreserved:true};
 });
 for(const variant of ['narrow','landscape','dark'])await run('reference-layout-'+variant,async()=>{
  await page.setViewportSize(variant==='landscape'?{width:740,height:360}:{width:320,height:640});
  const manager=await openReferenceEditor();await manager.getByRole('button',{name:'إضافة حساب جديد',exact:true}).click();
  if(variant==='dark')await page.evaluate(()=>document.documentElement.classList.add('dark'));
  const accounts=page.getByTestId('reference-account-manager');await expect(accounts).toBeVisible();
  await expect(manager).toBeHidden();await expect(page.getByTestId('transaction-modal')).toBeHidden();
  await expect(accounts.locator('.reference-manager-dialog')).toHaveCSS('opacity','1');
  const layout=await accounts.evaluate(el=>{const panel=el.querySelector('.reference-manager-dialog')!;const box=panel.getBoundingClientRect();const footer=el.querySelector('footer')!.getBoundingClientRect();return{width:box.width,height:box.height,x:box.x,y:box.y,bottom:footer.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:panel.scrollWidth>panel.clientWidth+1,buttons:Array.from(el.querySelectorAll('footer button')).map(b=>b.getBoundingClientRect().height)};});
  assert(!layout.overflow,JSON.stringify(layout));assert(layout.x>=0&&layout.x+layout.width<=layout.viewportWidth);assert(layout.y>=0&&layout.bottom<=layout.viewportHeight,JSON.stringify(layout));assert(layout.buttons.every(n=>n>=43.9),JSON.stringify(layout));
  await page.screenshot({path:`${out}/reference-layout-${variant}-accounts.png`,animations:"disabled"});
  await accounts.getByRole('button',{name:'إلغاء والعودة',exact:true}).click();await expect(manager).toBeVisible();
  await assertNoPosting();await page.evaluate(()=>document.documentElement.classList.remove('dark'));await page.setViewportSize({width:360,height:800});return{correct:true,layout};
 });
 for(const mode of ['on','off'])await run('settings-legacy-'+mode,async()=>{
 await emit('settings');await page.getByRole('tab',{name:'المنشأة',exact:true}).click();await expect(page.getByLabel('بيع بدون رصيد',{exact:true})).toBeDisabled();await expect(page.getByLabel('بيع بدون رصيد',{exact:true})).not.toBeChecked();
 await page.getByRole('tab',{name:'قاعدة البيانات',exact:true}).click();await expect(page.getByRole('switch')).toBeDisabled();await expect(page.getByRole('switch')).not.toBeChecked();await expect(page.getByLabel('التذكير عند الإغلاق — غير متاح؛ احفظ نسخة يدويًا',{exact:true})).toBeDisabled();return{correct:true,storedPreference:mode,actualProtection:false,negativeStockSupported:false};
 });
 await run('settings-save-failure-no-success',async()=>{await emit('settings');await page.evaluate(()=>(window as any).rejectPreferences=true);await page.getByRole('button',{name:'حفظ الإعدادات',exact:true}).click();await expect(page.getByText('Audit host rejects writes',{exact:true})).toBeVisible();assert(!(await commands()).some((r:any)=>r.action==='saveWorkspaceSettings'));await expect(page.getByText('تم حفظ جميع إعدادات النظام في قاعدة البيانات بنجاح',{exact:true})).toHaveCount(0);return{correct:true};});
 await run('currency-route-current-no-provider-crash',async()=>{await drawer('صرف عملات');await expect(page.locator('[aria-label="نوع صرف العملات"]')).toBeVisible();assert(!errors.some(e=>e.includes('KeyboardProvider')));return{correct:true,alreadyFixedInCurrentBranch:true,postingNotTested:true};});
 await run('baseline-catalog-empty',async()=>{await page.getByTestId('open-items-btn').click();return{captured:true};});
 await run('baseline-catalog-edit-textscale',async()=>{await page.getByTestId('open-items-btn').click();await page.getByTestId('items-catalog-table').getByText('صنف اصطناعي 1',{exact:true}).click();await page.addStyleTag({content:'html{font-size:24px!important}.items-default-unit-radios{font-size:20px!important}'});return{captured:true};});
 await run('crm-confirmed-record',async()=>{const open=async()=>{await drawer('نقطة البيع ومتابعة العملاء');await page.getByRole('tab',{name:'فرص المبيعات',exact:true}).click();};await open();await page.getByRole('button',{name:'صفقة جديدة',exact:true}).click();await page.getByPlaceholder('عنوان الفرصة البيعية أو المشروع').fill('فرصة اختبار مستقلة');await page.getByPlaceholder('القيمة المتوقعة').fill('30');await page.getByRole('button',{name:'حفظ الفرصة البيعية',exact:true}).click();await expect(page.getByPlaceholder('عنوان الفرصة البيعية أو المشروع')).toHaveCount(0);await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.getByText('فرصة اختبار مستقلة',{exact:true})).toBeVisible();return{correct:true};});
 await run('procurement-confirmed-record',async()=>{const open=()=>drawer('أوامر الشراء وسلسلة التوريد');await open();await page.getByRole('button',{name:'أمر شراء جديد',exact:true}).click();await page.getByPlaceholder('الكمية',{exact:true}).fill('2');await page.getByPlaceholder('تكلفة الوحدة',{exact:true}).fill('5');await page.getByRole('button',{name:'إنشاء أمر الشراء',exact:true}).click();await expect(page.getByPlaceholder('الكمية',{exact:true})).toHaveCount(0);await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.locator('.erp-row-card')).toHaveCount(1);return{correct:true};});
 await run('costcenter-confirmed-record',async()=>{const open=async()=>{await drawer('التصنيع ومراكز التكلفة');await page.getByRole('tab',{name:'مراكز التكلفة',exact:true}).click();};await open();await page.getByRole('button',{name:'مركز جديد',exact:true}).click();await page.getByPlaceholder('اسم مركز التكلفة (مثال: فرع جدة)').fill('مركز اختبار مستقل');await page.getByPlaceholder('المسؤول',{exact:true}).fill('مسؤول اصطناعي');await page.getByPlaceholder('الموازنة المعتمدة').fill('100');await page.getByRole('button',{name:'حفظ مركز التكلفة',exact:true}).click();await expect(page.getByPlaceholder('اسم مركز التكلفة (مثال: فرع جدة)')).toHaveCount(0);await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.getByText('CC-100 · مركز اختبار مستقل',{exact:true})).toBeVisible();return{correct:true};});
 await run('finance-vat-confirmed-record',async()=>{const open=async()=>{await drawer('القوائم المالية والأستاذ العام');await page.getByRole('tab',{name:'الضرائب',exact:true}).click();};await open();await page.getByTestId('erp-vat-jurisdiction-select').selectOption('ae_5');await page.getByTestId('erp-vat-save-btn').click();await expect.poll(async()=>(await commands()).filter((c:any)=>c.action==='saveErpRecords').length).toBe(1);await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.getByTestId('erp-vat-jurisdiction-select')).toHaveValue('ae_5');return{correct:true};});
 await run('finance-native-xlsx',async()=>{await drawer('القوائم المالية والأستاذ العام');await page.getByRole('button',{name:/تصدير/}).click();const {bytes,d}=await exported();assert.equal(d.mimeType,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');const x=await import('xlsx');assert(x.read(bytes).Sheets['التقرير']);return{correct:true};});
 await run('native-print-pdf',async()=>{await exportOptions();await page.getByRole('button',{name:'طباعة PDF',exact:true}).click();const {d}=await exported();assert.equal(d.mode,'print');assert.equal(d.mimeType,'application/pdf');return{correct:true};});
 await run('catalog-cancel-preserves-unsaved',async()=>{await page.getByTestId('open-items-btn').click();await page.getByTestId('items-catalog-table').getByText('صنف اصطناعي 1',{exact:true}).click();await page.getByTestId('catalog-cancel-btn').click();await expect(page.getByRole('button',{name:'متابعة التحرير',exact:true})).toBeVisible();await page.getByRole('button',{name:'متابعة التحرير',exact:true}).click();await expect(page.getByTestId('catalog-form-card')).toBeVisible();return{correct:true};});
 await run('employee-confirmed-create-edit-reject-double-click',async()=>{
  const open=()=>drawer('الموارد البشرية والرواتب');await open();await page.getByRole('button',{name:'موظف جديد',exact:true}).click();await page.getByPlaceholder('الاسم الكامل للموظف').fill('موظف اختبار البقاء');
  await page.evaluate(()=>(window as any).rejectErp=true);await page.getByRole('button',{name:'حفظ بيانات الموظف',exact:true}).click();await expect(page.getByPlaceholder('الاسم الكامل للموظف')).toHaveValue('موظف اختبار البقاء');await expect(page.getByText('تم حفظ الموظف: موظف اختبار البقاء',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Audit host rejects writes',{exact:true})).toBeVisible();await page.evaluate(()=>(window as any).rejectErp=false);await page.getByRole('button',{name:'حفظ بيانات الموظف',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});await expect(page.getByText('تم حفظ الموظف: موظف اختبار البقاء',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.getByText('موظف اختبار البقاء',{exact:true})).toHaveCount(1);await page.getByRole('button',{name:'تعديل موظف اختبار البقاء',exact:true}).click();await page.getByPlaceholder('الاسم الكامل للموظف').fill('موظف معدل');await page.getByRole('button',{name:'حفظ تعديل الموظف',exact:true}).click();await expect(page.getByText('تم حفظ الموظف: موظف معدل',{exact:true})).toBeVisible();await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await open();await expect(page.getByText('موظف معدل',{exact:true})).toHaveCount(1);return{correct:true,scope:'Chromium persisted mock; independent real SQLite test separately'};
 });
 for(const format of ['PDF','Excel','صورة'])await run('attachment-'+format,async()=>{await exportOptions();await page.getByLabel(format,{exact:true}).check();await page.getByLabel('جميع العملات دون جمعها',{exact:true}).check();await page.getByTestId('print-options-modal').getByRole('button',{name:'مشاركة',exact:true}).click();const {d,bytes}=await exported();assert.equal(d.mode,'share');assert.notEqual(d.mimeType,'text/plain');if(format==='Excel'){assert.equal(bytes.subarray(0,2).toString(),'PK');const x=await import('xlsx');const book=x.read(bytes);const rows=x.utils.sheet_to_json(book.Sheets['التقرير'],{header:1}) as any[][];assert.equal(rows.length,13);assert.equal(typeof rows[1][4],'number');assert.equal(rows[0][5],'العملة');}return{correct:true,mime:d.mimeType,file:d.fileName,bytes:bytes.length,scope:'actual generated file and bridge handoff; no Android receiver'};});
 await run('statement-currencies-scope',async()=>{await exportOptions();await page.getByLabel('Excel',{exact:true}).check();await page.getByRole('button',{name:'حفظ الملف',exact:true}).click();const {bytes}=await exported();const x=await import('xlsx');const book=x.read(bytes);const rows=x.utils.sheet_to_json(book.Sheets['التقرير'],{header:1}) as any[][];assert.equal(rows.length,12);assert(rows.slice(1).every(r=>r[5]==='دولار'));return{correct:true,rows:11};});
 await run('inventory-search-single-and-context',async()=>{await page.getByTestId('open-stock-movement-btn').click();await page.getByTestId('inventory-search-input').fill('صنف اصطناعي 12');await page.getByRole('button',{name:'طباعة التقرير',exact:true}).click();await page.getByLabel('Excel',{exact:true}).check();await page.getByRole('button',{name:'مشاركة',exact:true}).click();const {bytes,d}=await exported();const x=await import('xlsx');const book=x.read(bytes);const rows=x.utils.sheet_to_json(book.Sheets['التقرير'],{header:1}) as any[][];assert.equal(rows.length,2);assert.equal(rows[1][1],'صنف اصطناعي 12');assert.equal(d.mode,'share');return{correct:true,rows};});
 await run('inventory-empty-export',async()=>{await page.getByTestId('open-stock-movement-btn').click();await page.getByTestId('inventory-search-input').fill('NO-MATCH');await page.getByRole('button',{name:'طباعة التقرير',exact:true}).click();await page.getByLabel('Excel',{exact:true}).check();await page.getByRole('button',{name:'حفظ الملف',exact:true}).click();const {bytes}=await exported();const x=await import('xlsx');assert.equal((x.utils.sheet_to_json(x.read(bytes).Sheets['التقرير'],{header:1}) as any[]).length,1);return{correct:true};});
 await run('sales-exports-own-category',async()=>{await emit('sales');await expect(page.getByTestId('purchases-screen')).toBeVisible();await page.getByRole('button',{name:/^تصدير حسابات المبيعات$|^تصدير المبيعات$/}).click();await page.getByRole('button',{name:'تصدير إلى ملف Excel',exact:true}).click();const {bytes}=await exported();const x=await import('xlsx');const rows=x.utils.sheet_to_json(x.read(bytes).Sheets['التقرير'],{header:1}) as any[][];assert(!rows.slice(1).some(r=>r[1]==='حساب اصطناعي 1'));return{correct:true,rows};});
 await run('large-516-image-pages',async()=>{await exportOptions();await page.getByLabel('صورة',{exact:true}).check();await page.getByRole('button',{name:'حفظ الملف',exact:true}).click();await expect(page.getByText('تم حفظ ملف التقرير',{exact:true})).toBeVisible({timeout:120000});const files=await page.evaluate(()=>(window as any).auditFiles);assert(files.length>1);for(const d of files){const bytes=Buffer.concat(d.base64.map((b:string)=>Buffer.from(b,'base64')));fs.writeFileSync(`${out}/${d.fileName}`,bytes);}const drawn=await page.evaluate(()=>(window as any).canvasText as string[]);for(let i=1;i<=516;i++)assert.equal(drawn.filter(t=>t===`حركة عربية ${i}`).length,1,`line ${i}`);return{correct:true,pages:files.length,lastRow:true,all516DrawnOnce:true};});
 await run('balance-confirmation-template',async()=>{await statement();await page.getByRole('button',{name:'تصدير',exact:true}).click();await page.getByRole('button',{name:'طباعة مصادقة الرصيد',exact:true}).click();const {bytes}=await exported();const drawn=await page.evaluate(()=>(window as any).canvasText as string[]);assert(drawn.some(t=>t.includes('مصادقة الرصيد')));assert(drawn.some(t=>t.includes('التوقيع والختم')));return{correct:true,bytes:bytes.length};});
 await run('backup-cancel-honest',async()=>{await emit('settings');await page.getByRole('tab',{name:'قاعدة البيانات',exact:true}).click();await page.getByTestId('settings-download-sqlite-btn').click();await expect(page.getByText('أُلغي الحفظ',{exact:true})).toBeVisible();return{correct:true};});
 await run('settings-no-false-lock-or-reset',async()=>{await emit('settings');await page.getByRole('tab',{name:'قاعدة البيانات',exact:true}).click();await expect(page.getByText('التطبيق لا يطلب كلمة مرور عند الفتح.',{exact:false})).toBeVisible();await expect(page.getByRole('switch')).toBeDisabled();await expect(page.getByRole('button',{name:'تفريغ قاعدة البيانات',exact:true})).toHaveCount(0);return{correct:true,actualLockImplemented:false};});
 await run('catalog-empty-touch',async()=>{await page.getByTestId('open-items-btn').click();await expect(page.getByRole('button',{name:'إضافة أول صنف',exact:true})).toBeVisible();await expect(page.getByTestId('catalog-next-page')).toHaveCount(0);await page.screenshot({path:`${out}/catalog-empty-after.png`});await page.getByRole('button',{name:'إضافة أول صنف',exact:true}).click();await expect(page.getByTestId('catalog-save-btn')).toBeVisible();await expect(page.getByTestId('catalog-update-btn')).toBeHidden();return{correct:true};});
 await run('catalog-touch-edit-delete-name-textscale',async()=>{await page.getByTestId('open-items-btn').click();await expect(page.getByText('التنقل : TAB',{exact:true})).toHaveCount(0);await page.getByTestId('items-catalog-table').getByText('صنف اصطناعي 1',{exact:true}).click();await expect(page.getByTestId('catalog-update-btn')).toBeVisible();await expect(page.getByTestId('catalog-save-btn')).toBeHidden();await page.getByTestId('catalog-delete-btn').click();await expect(page.getByRole('alertdialog',{name:'تأكيد حذف الصنف'})).toContainText('صنف اصطناعي 1');await page.getByRole('alertdialog').getByRole('button',{name:'إلغاء',exact:true}).click();await page.addStyleTag({content:'html{font-size:24px!important}.items-default-unit-radios{font-size:20px!important}'});await page.screenshot({path:`${out}/catalog-edit-large-text-after.png`});return{correct:true};});
 await run('native-template-csv-cancel',async()=>{await page.getByTestId('open-items-btn').click();await page.getByRole('button',{name:'خيارات بطاقات الأصناف',exact:true}).click();await page.evaluate(()=>(window as any).auditCancel=true);await page.getByTestId('items-import-template-btn').click();const {d}=await exported();assert.equal(d.mimeType,'text/csv');await expect(page.getByText('أُلغي الحفظ',{exact:true})).toBeVisible();return{correct:true};});
}finally{fs.writeFileSync(`${out}/results.json`,JSON.stringify({environment:'Chromium built hybrid + synthetic bridge, NOT Android',results,errors,external},null,2));await ctx.close();await browser.close();await new Promise<void>(r=>server.close(()=>r()));}

if(results.some(r=>r.execution==='test-error'))process.exitCode=1;
