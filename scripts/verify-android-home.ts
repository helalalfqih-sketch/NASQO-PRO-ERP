/** Real bundled React -> Android bridge -> SQLite acceptance on a fresh CI emulator. */
import { _android, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Isolated CI emulator only');
const pkg = 'com.indexesstore.nasqo_pro_erp', out = 'home-android-evidence';
fs.mkdirSync(out, {recursive:true});
const adb = (...args:string[]) => execFileSync('adb',args,{timeout:30000}).toString().trim();
assert.match(adb('get-serialno'), /^emulator-/);
const sdk = adb('shell','getprop','ro.build.version.sdk');
const webview = adb('shell','dumpsys','webviewupdate');
fs.writeFileSync(`${out}/webview.txt`,webview);
if(sdk==='30') assert.match(webview,/Current WebView package.*83\./, 'API 30 must exercise WebView 83, not a newer substitute');
adb('shell','svc','wifi','disable'); adb('shell','svc','data','disable');
adb('shell','am','start','-W','-n',`${pkg}/.MainActivity`);
function diagnostics() {
  for (const [name, args] of [
    ['activity.txt', ['shell', 'dumpsys', 'activity', 'activities']],
    ['logcat.txt', ['logcat', '-d', '-t', '1500']],
    ['sockets.txt', ['shell', 'cat', '/proc/net/unix']],
  ] as const) {
    try { fs.writeFileSync(`${out}/${name}`, execFileSync('adb', [...args], {timeout:15000,maxBuffer:8*1024*1024})); } catch { /* Best-effort diagnostics on this synthetic emulator. */ }
  }
  try { fs.writeFileSync(`${out}/device.png`,execFileSync('adb',['exec-out','screencap','-p'],{timeout:15000,maxBuffer:8*1024*1024})); } catch { /* Emulator may already have exited. */ }
}
async function connect() {
  // WebView exposes an Android DevTools socket, not Chrome's HTTP browser endpoint.
  const [device] = await _android.devices({omitDriverInstall:true});
  assert(device, 'The isolated Android emulator must be attached');
  try {
    const view=await device.webView({pkg},{timeout:60000});
    const page=await view.page();
    page.setDefaultTimeout(20000);
    await page.waitForURL(/appassets\.androidplatform\.net/, {timeout:30000});
    return {browser:{close:()=>device.close()},page};
  } catch(error) { diagnostics();await device.close();throw error; }
}
async function command(page:Page,action:string,payload:unknown) {
  return page.evaluate(({action,payload})=>new Promise<any>((resolve,reject)=>{
    const w=window as any, prior=w.__nasqoHybridReceive, id=`home-qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer=setTimeout(()=>{w.__nasqoHybridReceive=prior;reject(new Error(`Native timeout: ${action}`));},20000);
    w.__nasqoHybridReceive=(raw:unknown)=>{
      const r=typeof raw==='string'?JSON.parse(raw):raw as any;
      if(r.requestId===id) {clearTimeout(timer);w.__nasqoHybridReceive=prior;r.ok?resolve(r.data):reject(new Error(JSON.stringify(r.error)));return true;}
      return prior(raw);
    };
    (w.NasqoHome??w.NasqoFlutterBridge).postMessage(JSON.stringify({protocolVersion:'1.0.0',kind:'request',requestId:id,action,payload,idempotencyKey:id}));
  }),{action,payload});
}
const workspaceId='local-erp-workspace';
let {browser,page}=await connect();
const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
try {
  const setup=page.getByTestId('business-setup-modal');
  await expect(setup).toBeVisible({timeout:60000});
  await setup.getByLabel('اسم المنشأة',{exact:true}).fill('QA Home Android');
  for(let i=0;i<3;i++) await setup.getByRole('button',{name:'التالي',exact:true}).click();
  await setup.getByRole('button',{name:'إكمال التهيئة',exact:true}).click();
  await expect(setup).toBeHidden({timeout:30000});
  await expect(page.getByTestId('home-freshness')).toContainText('محدّث من السجلات');
  const initial=await command(page,'getSnapshot',{workspaceId});
  assert.equal(initial.ledger.length,0,'Only a new synthetic workspace is permitted');
  assert.equal(initial.inventory.length,0);
  const customerResult=await command(page,'saveAccount',{workspaceId,payload:{name:'QA Home Customer',category:'clients',currency:'ريال',isCashAccount:false}});
  const customer=customerResult.snapshot.accounts.find((a:any)=>a.name==='QA Home Customer'); assert(customer);
  const vendorResult=await command(page,'saveAccount',{workspaceId,payload:{name:'QA Home Vendor',category:'purchases',currency:'ريال',isCashAccount:false}});
  const vendor=vendorResult.snapshot.accounts.find((a:any)=>a.name==='QA Home Vendor'); assert(vendor);
  const today=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  for(const [account,amount,direction] of [[customer,320,'debit'],[vendor,120,'credit']] as const) {
    await command(page,'createLedgerEntry',{workspaceId,payload:{id:`home-qa-${direction}`,accountId:account.id,accountName:account.name,kind:'invoice',invoiceContent:'free',payment:'credit',direction,currency:'ريال',amount,entryDate:today,warehouseId:'',lines:[{itemName:'QA service',unit:'خدمة',quantity:1,price:amount,total:amount}]}});
  }
  await command(page,'saveWorkspaceSettings',{workspaceId,updates:{userPreferences:{...initial.workspace.userPreferences,defaultWarehouseId:''}}});
  await page.reload();
  await expect(page.getByTestId('home-kpi-sales')).toContainText('320');
  await expect(page.getByTestId('home-kpi-purchases')).toContainText('120');
  await expect(page.getByTestId('home-kpi-receivables')).toContainText('320');
  await expect(page.getByTestId('home-kpis').getByRole('button')).toHaveCount(4);
  await expect(page.getByTestId('home-modules').getByRole('button')).toHaveCount(8);
  for(const [action,type] of [['sale','فاتورة بيع'],['purchase','فاتورة شراء']]) {
    await page.getByTestId(`home-action-${action}`).click();
    const modal=page.getByTestId('invoice-modal');await expect(modal.getByRole('radio',{name:type,exact:true})).toBeChecked();
    await modal.getByRole('button',{name:'إغلاق',exact:true}).click();
  }
  for(const [action,side] of [['receipt','له'],['payment','عليه']]) {
    await page.getByTestId(`home-action-${action}`).click();
    const modal=page.getByTestId('transaction-modal');await expect(modal.getByRole('radio',{name:side,exact:true})).toBeChecked();
    await modal.getByRole('button',{name:'إلغاء',exact:true}).click();
  }
  await page.getByTestId('home-action-journal').click();await expect(page.getByTestId('simple-entry-screen')).toBeVisible();
  await page.getByRole('button',{name:'رجوع',exact:true}).last().click();
  for(const width of [320,360,412,768]) {
    await page.setViewportSize({width,height:1024});
    const home=page.getByTestId('dashboard-screen');
    assert(await home.evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.screenshot({path:`${out}/home-${width}.png`});
  }
  await page.getByRole('button',{name:'تفضيلات الرئيسية',exact:true}).click();
  const prefs=page.getByTestId('home-preferences');await prefs.getByRole('combobox',{name:'المظهر',exact:true}).selectOption('dark');
  await prefs.getByRole('button',{name:'حفظ التفضيلات',exact:true}).click();await expect(prefs).toBeHidden();
  const before=await command(page,'getSnapshot',{workspaceId});
  assert.equal(before.ledger.length,2); assert.equal(before.inventory.length,0);
  await browser.close();adb('shell','am','force-stop',pkg);adb('shell','am','start','-W','-n',`${pkg}/.MainActivity`);
  ({browser,page}=await connect());
  await expect(page.getByTestId('home-kpi-sales')).toContainText('320');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const after=await command(page,'getSnapshot',{workspaceId});
  assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.inventory,before.inventory);
  await page.screenshot({path:`${out}/restart-dark-offline.png`});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(`${out}/result.json`,JSON.stringify({sdk,webview,passed:true,offline:true,records:after.ledger.length,widths:[320,360,412,768],productionDataTouched:false},null,2));
} catch(e) {
  diagnostics();
  await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  fs.writeFileSync(`${out}/failure.html`,await page.content().catch(()=>''));
  throw e;
} finally { await browser.close(); }
