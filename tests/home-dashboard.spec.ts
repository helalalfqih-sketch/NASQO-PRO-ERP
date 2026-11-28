import { test, expect } from '@playwright/test';
import { defaultBusinessProfile, defaultUserPreferences, businessToday } from '../src/utils/businessSetup';
const ws='/api/db/workspace/local-erp-workspace',headers={'X-NASQO-CSRF':'1'};
async function seed(page:any){
 expect((await page.request.post(ws+'/reset',{headers,data:{confirmation:'RESET:local-erp-workspace'}})).status()).toBe(200);
 expect((await page.request.post(ws+'/setup',{headers,data:{companyName:'شركة قبول الرئيسية',currency:'ريال',warehouseName:'مخزن قبول',cashboxName:'صندوق قبول',bankName:'',profile:defaultBusinessProfile(),preferences:defaultUserPreferences()}})).status()).toBe(200);
 const bundle=await(await page.request.get(ws)).json(),today=businessToday('Asia/Aden');
 const customer=bundle.accounts.find((a:any)=>a.category==='clients'),supplier=bundle.accounts.find((a:any)=>a.category==='purchases');
 for(const e of [{amount:320,account:customer,direction:'debit'},{amount:120,account:supplier,direction:'credit'},{amount:990,account:customer,direction:'debit',postingStatus:'draft'}]) {
  expect((await page.request.post(ws+'/ledger',{headers,data:{entry:{accountId:e.account.id,accountName:e.account.name,kind:'invoice',invoiceContent:'free',warehouseId:bundle.warehouses[0].id,payment:'credit',direction:e.direction,amount:e.amount,currency:'ريال',entryDate:today,postingStatus:e.postingStatus??'posted'}}})).status()).toBe(201);
 }
 await page.goto('/?autostart=1');await expect(page.getByTestId('home-freshness')).toContainText('محدّث من السجلات',{timeout:30000});
 return {bundle,today};
}
test('real home fixed sections, financial reconciliation, detail navigation and incremental refresh',async({page})=>{
 test.setTimeout(90000);const {bundle,today}=await seed(page);
 await expect(page.getByTestId('home-kpis').getByRole('button')).toHaveCount(4);
 await expect(page.locator('[data-testid^="home-action-"]')).toHaveCount(5);
 await expect(page.getByTestId('home-modules').getByRole('button')).toHaveCount(8);
 await expect(page.getByTestId('home-kpi-sales')).toContainText('320');await expect(page.getByTestId('home-kpi-purchases')).toContainText('120');
 await expect(page.getByTestId('home-recent').getByRole('button')).toHaveCount(2);
 await page.getByTestId('home-kpi-sales').click();await expect(page.getByTestId('home-detail-total')).toContainText('320');await expect(page.getByTestId('home-detail').locator('.erp-home-row')).toHaveCount(1);
 await page.getByRole('button',{name:'رجوع',exact:true}).last().click();await expect(page.getByTestId('dashboard-screen')).toBeVisible();
 const before=await page.evaluate(()=>performance.timeOrigin);
 const c=bundle.accounts.find((a:any)=>a.category==='clients');expect((await page.request.post(ws+'/ledger',{headers,data:{entry:{accountId:c.id,accountName:c.name,kind:'invoice',invoiceContent:'free',warehouseId:bundle.warehouses[0].id,payment:'credit',direction:'debit',amount:15,currency:'ريال',entryDate:today}}})).status()).toBe(201);
 await page.getByRole('button',{name:'تحديث الرئيسية',exact:true}).click();await expect(page.getByTestId('home-kpi-sales')).toContainText('335');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(before);
});
test('five real actions open the correct invoice, receipt, payment and journal forms',async({page})=>{
 test.setTimeout(90000);await seed(page);
 for(const [id,title] of [['sale','فاتورة بيع'],['purchase','فاتورة شراء']]){
  await page.getByTestId(`home-action-${id}`).click();const modal=page.getByTestId('invoice-modal');await expect(modal).toBeVisible();await expect(modal.getByRole('radio',{name:title,exact:true})).toBeChecked();
  await modal.getByRole('button',{name:'إغلاق',exact:true}).click();
 }
 for(const [id,direction] of [['receipt','له'],['payment','عليه']]){
  await page.getByTestId(`home-action-${id}`).click();const modal=page.getByTestId('transaction-modal');await expect(modal).toBeVisible();await expect(modal.getByRole('radio',{name:direction,exact:true})).toBeChecked();await modal.getByRole('button',{name:'إلغاء',exact:true}).click();
 }
 await page.getByTestId('home-action-journal').click();await expect(page.getByTestId('simple-entry-screen')).toBeVisible();
 expect((await(await page.request.get(ws)).json()).ledger).toHaveLength(3);
});
test('all eight modules open existing screens and More retains secondary tools',async({page})=>{
 test.setTimeout(120000);await seed(page);
 const modules=[['accounts','chart-of-accounts-modal'],['sales','purchases-screen'],['purchases','purchases-screen'],['inventory','inventory-report-screen'],['cashboxes','cashboxes-report-modal'],['customers','purchases-screen'],['vendors','purchases-screen'],['reports','reports-hub-modal']];
 for(const [id,target] of modules){
  await page.getByTestId(`home-module-${id}`).scrollIntoViewIfNeeded();await page.getByTestId(`home-module-${id}`).click();await expect(page.getByTestId(target)).toBeVisible();
  await page.reload();await expect(page.getByTestId('home-freshness')).toContainText('محدّث من السجلات');
 }
 await page.getByRole('button',{name:'المزيد',exact:true}).click();await expect(page.getByRole('button',{name:'أدوات العمل الموسعة',exact:true})).toBeVisible();
});
test('personal theme/layout/defaults persist after restart, failed save retains inputs and changes no business settings',async({page})=>{
 test.setTimeout(90000);await seed(page);const original=await(await page.request.get(ws)).json();
 await page.getByRole('button',{name:'تفضيلات الرئيسية',exact:true}).click();const prefs=page.getByTestId('home-preferences');await prefs.getByRole('combobox',{name:'المظهر',exact:true}).selectOption('dark');await prefs.getByRole('combobox',{name:'تخطيط البطاقات',exact:true}).selectOption('1');
 await page.route('**/personal-preferences',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"فشل حفظ اختباري"}'}));await prefs.getByRole('button',{name:'حفظ التفضيلات'}).click();await expect(prefs.getByRole('alert')).toContainText('فشل حفظ اختباري');await expect(prefs.getByRole('combobox',{name:'المظهر',exact:true})).toHaveValue('dark');await page.unroute('**/personal-preferences');
 await prefs.getByRole('button',{name:'حفظ التفضيلات'}).click();await expect(prefs).toBeHidden();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByTestId('dashboard-screen')).toHaveAttribute('data-columns','1');
 const current=await(await page.request.get(ws)).json();expect(current.workspace.businessProfile).toEqual(original.workspace.businessProfile);expect(current.workspace.companyName).toBe(original.workspace.companyName);expect(current.ledger).toEqual(original.ledger);
});
test('offline summary remains visible with freshness and a failed query never replaces values with zero',async({page})=>{
 test.setTimeout(90000);await seed(page);await page.route('**/home?*',r=>r.abort());await page.getByRole('button',{name:'تحديث الرئيسية',exact:true}).click();await expect(page.getByTestId('home-freshness')).toContainText('نسخة محفوظة');await expect(page.getByTestId('home-kpi-sales')).toContainText('320');
 await page.unroute('**/home?*');await page.getByRole('button',{name:'تحديث الرئيسية',exact:true}).click();await expect(page.getByTestId('home-freshness')).toContainText('محدّث من السجلات');
});
test('320, 360, 412 and tablet: RTL, fixed minimum heights, no clipping, dark and expanded text',async({page})=>{
 test.setTimeout(120000);await seed(page);
 for(const width of [320,360,412,768])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1024});await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);document.documentElement.classList.toggle('dark',theme==='dark');},theme);
  const geometry=await page.getByTestId('dashboard-screen').evaluate(root=>{
   const e=root as HTMLElement;return {width:e.clientWidth,scroll:e.scrollWidth,rtl:getComputedStyle(e).direction,cards:[...e.querySelectorAll('.erp-home-card')].map(n=>{const r=(n as HTMLElement).getBoundingClientRect();return {height:r.height,scroll:(n as HTMLElement).scrollWidth,width:(n as HTMLElement).clientWidth};})};
  });expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.scroll).toBe(geometry.width);expect(geometry.rtl).toBe('rtl');expect(geometry.cards.slice(0,4).every(c=>c.height>=108&&c.scroll<=c.width+1)).toBe(true);expect(geometry.cards.slice(4).every(c=>c.height>=44&&c.scroll<=c.width+1)).toBe(true);
  await page.screenshot({path:`test-results/home-${width}-${theme}.png`});
 }
 await page.setViewportSize({width:320,height:900});await page.getByTestId('dashboard-screen').evaluate(root=>{const nodes=[...root.querySelectorAll('span,strong,small,h1,h2,button')];const sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>(n as HTMLElement).style.fontSize=`${sizes[i]*1.3}px`);});
 expect(await page.getByTestId('dashboard-screen').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});

test('existing card colors, corner radius, padding and saved tile tone remain in use',async({page})=>{
 await seed(page);
 await page.evaluate(()=>localStorage.setItem('nasqo-home-tile-layout-v1',JSON.stringify({toneOverrides:{'new-invoice':'amber'}})));
 await page.reload();const tile=page.getByTestId('home-action-sale');await expect(tile).toHaveClass(/smart-tile amber/);
 const styles=await tile.evaluate(e=>{
  const reference=document.createElement('button');reference.className='smart-tile amber';reference.textContent='Reference';document.body.append(reference);
  const read=(node:Element)=>{const s=getComputedStyle(node);return {background:s.backgroundColor,color:s.color,radius:s.borderRadius,padding:s.padding,font:s.fontSize};};
  const actual=read(e),old=read(reference);reference.remove();return {actual,old};
 });expect(styles.actual).toEqual(styles.old);
});
test('a recent standalone journal opens its exact lines instead of a generic module',async({page})=>{
 const {bundle,today}=await seed(page);const customer=bundle.accounts.find((a:any)=>a.category==='clients'),vendor=bundle.accounts.find((a:any)=>a.category==='purchases');
 expect((await page.request.post(ws+'/journals',{headers,data:{entryDate:today,currency:'ريال',description:'قيد قبول الرئيسية',lines:[{accountId:customer.id,debit:25},{accountId:vendor.id,credit:25}]}})).status()).toBe(201);
 await page.getByRole('button',{name:'النطاق',exact:true}).click();await page.getByRole('combobox',{name:'مخزن المستندات والأصناف',exact:true}).selectOption('');
 const row=page.getByTestId('home-recent').getByRole('button').filter({hasText:'قيد يومية'});await row.click();await expect(page.getByTestId('home-journal-detail')).toContainText('قيد قبول الرئيسية');await expect(page.getByTestId('home-journal-detail')).toContainText(customer.name);await expect(page.getByTestId('home-journal-detail')).toContainText(vendor.name);
});

test('a failed first summary has no fabricated cache or financial values, and reset invalidates the previous workspace summary',async({page})=>{
 test.setTimeout(90000);await seed(page);
 await page.route('**/home?*',r=>r.abort());
 await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.endsWith(':home-summary'))localStorage.removeItem(key);});
 await page.reload();await expect(page.getByTestId('home-freshness')).toContainText('تعذر تحديث الملخص');
 await expect(page.getByTestId('home-freshness')).not.toContainText('نسخة محفوظة');
 await expect(page.getByTestId('home-kpi-sales')).toBeDisabled();await expect(page.getByTestId('home-kpi-sales')).toContainText('—');
 await page.unroute('**/home?*');await page.getByRole('button',{name:'تحديث الرئيسية',exact:true}).click();await expect(page.getByTestId('home-kpi-sales')).toContainText('320');
 await page.route('**/home?*',r=>r.abort());
 // The actual service performs the confirmed reset against this suite's isolated SQLite fixture.
 await page.evaluate(async()=>{const api=await import('/src/firebase.ts');await api.resetLocalWorkspaceDatabase('local-erp-workspace');});
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.endsWith(':home-summary')))).toHaveLength(0);
 expect((await(await page.request.get(ws)).json()).ledger).toHaveLength(0);
 await expect(page.getByTestId('home-kpi-sales')).not.toContainText('320');
});
