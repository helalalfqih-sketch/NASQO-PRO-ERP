/** Local built-UI acceptance with synthetic bridge responses. Native persistence
 * is tested separately against real SQLite; this script never accesses user data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createHybridHomeFixtureSnapshot} from '../src/hybrid/homeFixture';
const out=path.resolve(process.env.IMPORT_UI_OUTPUT||'deliverables/import-repair/ui');fs.mkdirSync(out,{recursive:true});
const bundle=path.resolve(process.env.IMPORT_UI_BUNDLE||'dist/hybrid');
const state=createHybridHomeFixtureSnapshot();state.capabilities={...state.capabilities,localAccountCreation:true,localCatalogEditing:true};state.workspace!.defaultCurrency='ريال';
function host(state:any){
 const w=window as any;localStorage.clear();sessionStorage.clear();w.commands=[];
 w.csv='اسم الصنف,الباركود,سعر الشراء,سعر البيع,الحالة\nصنف مستورد,000123,17.5,25,خامل';
 w.emit=(route:string)=>w.__nasqoHybridReceive?.({protocolVersion:'1.0.0',kind:'event',event:'routeChanged',payload:{route},timestampMs:Date.now()});
 w.NasqoHome={postMessage(raw:string){const r=JSON.parse(raw);w.commands.push(r);let data:any={};
  if(r.action==='getSnapshot')data=state;
  if(r.action==='pickFile')data=w.cancelPicker?{cancelled:true}: {fileName:r.payload.purpose==='import-items'?'items.csv':'accounts.csv',base64Content:btoa(Array.from(new TextEncoder().encode(w.csv),b=>String.fromCharCode(b)).join(''))};
  if(r.action==='importInventoryItems'||r.action==='importAccountCards')data={inserted:1,skipped:0,total:1,snapshot:state};
  if(r.action==='getInventoryMovementsReport')data={warehouses:state.warehouses,warehouseStocks:[],itemRows:[],movements:[],totals:{},issues:{}};
  if(r.action==='cloudIdentityAction')data={configured:false,signedIn:false};
  if(r.action==='googleDriveAction')data={configured:false,connected:false,files:[]};
  if(r.action==='localToolsAction')data={review:false,imported:false};
  if(r.action==='legacyArchiveAction')data={available:false,items:[],totalCount:0};
  setTimeout(()=>w.__nasqoHybridReceive?.({protocolVersion:'1.0.0',kind:'response',requestId:r.requestId,action:r.action,ok:true,data,timestampMs:Date.now()}),0);
 }};
}
const fixture=`(${host.toString()})(${JSON.stringify(state)});`;
const server=http.createServer((req,res)=>{
 const name=new URL(req.url!,'http://localhost').pathname;
 if(name==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}
 const file=path.resolve(bundle,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(bundle+'/')||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'} as any)[path.extname(file)]||'application/octet-stream');
 if(file.endsWith('.html'))res.end(fs.readFileSync(file,'utf8').replace('<head>','<head><script src="/fixture.js"></script>'));else fs.createReadStream(file).pipe(res);
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
const page=await browser.newPage({viewport:{width:393,height:850}});page.setDefaultTimeout(8000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().url().startsWith(url)||!/^https?:/.test(r.request().url())?r.continue():r.abort());
const commands=()=>page.evaluate(()=>(window as any).commands);
const imports=async()=>(await commands()).filter((r:any)=>['importAccountCards','importInventoryItems'].includes(r.action));
const fresh=async()=>{await page.goto(url);await expect(page.getByTestId('dashboard-screen')).toBeVisible();};
const openItems=async()=>{await page.getByTestId('open-items-btn').click();await page.getByRole('button',{name:'خيارات بطاقات الأصناف',exact:true}).click();await page.getByTestId('items-import-btn').click();};
const openAccounts=async()=>{await page.evaluate(()=>(window as any).emit('sales'));await page.getByRole('button',{name:/^تصدير حسابات المبيعات$|^تصدير المبيعات$/}).click();await page.getByRole('button',{name:'استيراد الحسابات من ملف',exact:true}).click();};
const dialog=()=>page.getByRole('dialog',{name:'مراجعة الاستيراد',exact:true});
const results:string[]=[];
try {
 await fresh();await openItems();await expect(dialog()).toBeVisible();await expect(dialog().getByText('000123',{exact:true})).toBeVisible();
 await expect(dialog().getByRole('button',{name:'استيراد البطاقات'})).toBeDisabled();assert.equal((await imports()).length,0);
 await page.screenshot({path:path.join(out,'item-review-mobile.png')});
 const box=await dialog().boundingBox();assert(box&&box.x>=0&&box.x+box.width<=393&&box.y>=0&&box.y+box.height<=850);
 await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'استيراد البطاقات'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
 await expect(dialog()).toBeHidden();const calls=await imports();assert.equal(calls.length,1);assert.equal(calls[0].payload.mode,'insert-only');
 const row=calls[0].payload.items[0];assert.equal(row.sku,'000123');assert.equal(row.catalogReferenceCost,17.5);assert.equal(row.currencyCode,'ريال');assert.equal(row.isActive,false);assert(!row.warehouseId);assert(!Object.hasOwn(row,'avgCost'));results.push('item preview, currency, barcode, reference price, explicit confirm, no warehouse, double-click once');
 await fresh();await page.evaluate(()=>(window as any).cancelPicker=true);await openItems();await expect(dialog()).toBeHidden();assert.equal((await imports()).length,0);results.push('native picker cancel does not import');
 await fresh();await page.evaluate(()=>(window as any).csv='%PDF-1.7\nname,cost\nfake,1');await openItems();await expect(dialog().getByRole('alert')).toBeVisible();await expect(dialog().getByRole('button',{name:'استيراد البطاقات'})).toBeDisabled();assert.equal((await imports()).length,0);results.push('PDF renamed CSV rejected before write');
 await fresh();await page.evaluate(()=>(window as any).csv='الاسم,الهاتف\n"شركة, فرع\nالمدينة",001234');await openAccounts();await expect(dialog().getByRole('alert')).toContainText('التصنيف');
 await dialog().getByLabel('تصنيف الحسابات المستوردة').selectOption('clients');await expect(dialog().getByText('001234',{exact:true})).toBeVisible();
 await dialog().getByRole('checkbox').check();await page.screenshot({path:path.join(out,'account-review-mobile.png')});await dialog().getByRole('button',{name:'استيراد البطاقات'}).click();await expect(dialog()).toBeHidden();
 const account=(await imports())[0].payload.accounts[0];assert.equal(account.name,'شركة, فرع\nالمدينة');assert.equal(account.phone,'001234');assert.equal(account.category,'clients');assert.equal(account.openingBalance,0);results.push('account CSV quotes, phone, explicit category and atomic batch');
 await fresh();await page.evaluate(()=>(window as any).csv='الاسم,الرصيد,الاتجاه,التصنيف\nشركة,100,مدين,العملاء');await openAccounts();await expect(dialog().getByRole('alert')).toContainText('أرصدة افتتاحية');await dialog().getByRole('checkbox').check();await expect(dialog().getByRole('button',{name:'استيراد البطاقات'})).toBeDisabled();assert.equal((await imports()).length,0);results.push('nonzero opening balances blocked before any write');
 await dialog().getByRole('button',{name:'إلغاء',exact:true}).click();await expect(dialog()).toBeHidden();assert.equal((await imports()).length,0);results.push('review cancellation writes nothing');
 assert.deepEqual(errors,[]);
} catch(e){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText());throw e;}
finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({environment:'built hybrid UI in Chromium; synthetic host, not Android',results,errors},null,2));await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
console.log(`PASS ${results.length} import UI scenarios`);
