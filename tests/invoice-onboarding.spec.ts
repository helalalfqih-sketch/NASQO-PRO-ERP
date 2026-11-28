import { test, expect } from '@playwright/test';
import { defaultBusinessProfile, defaultUserPreferences } from '../src/utils/businessSetup';
test.use({ launchOptions: { executablePath: process.env.TEST_BROWSER_EXECUTABLE } });
const ws='/api/db/workspace/local-erp-workspace', headers={'X-NASQO-CSRF':'1'};

test.beforeEach(async({page})=>{
  // This server is configured by playwright.config.ts with a dedicated test database.
  expect((await page.request.post(ws+'/reset',{headers,data:{confirmation:'RESET:local-erp-workspace'}})).status()).toBe(200);
  await page.addInitScript(()=>localStorage.setItem('nasqo-local-session-active','1'));
});

test('first-run wizard validates, retains failed saves, provisions once and persists preferences',async({page})=>{
  test.setTimeout(90_000);
  await page.goto('/?autostart=1'); const modal=page.getByTestId('business-setup-modal');
  await expect(modal).toBeVisible({timeout:30_000});
  await modal.getByRole('button',{name:'التالي',exact:true}).click();
  await expect(modal.getByRole('alert')).toContainText('اسم المنشأة');
  await modal.getByLabel('اسم المنشأة',{exact:true}).fill('شركة قبول تجريبية');
  await modal.getByRole('button',{name:'التالي',exact:true}).click();
  await modal.getByLabel('اسم المخزن الأول',{exact:true}).fill('مخزن قبول');
  await modal.getByLabel('اسم الحساب البنكي (اختياري)',{exact:true}).fill('بنك قبول');
  await modal.getByLabel('نسبة الضريبة الافتراضية').fill('٧٫٥');
  await expect(modal.getByLabel('نسبة الضريبة الافتراضية')).toHaveValue('٧٫٥');
  await modal.getByRole('button',{name:'التالي',exact:true}).click();
  await modal.getByLabel('أعمدة الرئيسية',{exact:true}).selectOption('2');
  await modal.getByRole('button',{name:'التالي',exact:true}).click();
  await page.route('**/workspace/*/setup',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'فشل اتصال اختباري'})}));
  await modal.getByRole('button',{name:'إكمال التهيئة',exact:true}).click();
  await expect(modal.getByRole('alert')).toBeVisible();await expect(modal).toContainText('شركة قبول تجريبية');
  expect((await (await page.request.get(ws)).json()).accounts).toHaveLength(0);
  await page.unroute('**/workspace/*/setup');await modal.getByRole('button',{name:'إكمال التهيئة',exact:true}).click();
  await expect(modal).toBeHidden();
  let data=await (await page.request.get(ws)).json();
  expect(data.workspace.userPreferences.homeColumns).toBe(2); expect(data.warehouses).toHaveLength(1); expect(data.cashboxes).toHaveLength(2);expect(data.ledger).toHaveLength(0);
  expect(data.workspace.businessProfile.taxRateBps).toBe(750);
  await page.reload();await expect(page.getByTestId('user-action-shortcuts')).toBeVisible();await expect(modal).toBeHidden();
  await page.getByTestId('home-nav-profile').click();await page.getByTestId('settings-business-setup').click();
  await expect(modal.getByLabel('اسم المنشأة',{exact:true})).toHaveValue('شركة قبول تجريبية');
  await modal.getByRole('button',{name:'التالي',exact:true}).click();await modal.getByRole('button',{name:'التالي',exact:true}).click();
  await modal.getByLabel('المظهر المفضل').selectOption('dark');await modal.getByRole('button',{name:'التالي',exact:true}).click();await modal.getByRole('button',{name:'حفظ التفضيلات',exact:true}).click();
  await expect(modal).toBeHidden();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  data=await (await page.request.get(ws)).json();expect(data.warehouses).toHaveLength(1);expect(data.cashboxes).toHaveLength(2);
});

test('invoice search, locked controls, mobile viewport, draft recovery and real save without duplicate stock',async({page})=>{
  test.setTimeout(120_000);
  const setup={companyName:'Invoice UI acceptance',currency:'ريال',warehouseName:'Warehouse',cashboxName:'Cashbox',bankName:'',profile:defaultBusinessProfile(),preferences:defaultUserPreferences()};
  expect((await page.request.post(ws+'/setup',{headers,data:setup})).status()).toBe(200);
  let bundle=await (await page.request.get(ws)).json();const warehouse=bundle.warehouses[0].id;
  for(const name of ['قلم قبول','دفتر قبول']) {
    const res=await page.request.post(ws+'/inventory',{headers,data:{item:{name,warehouseId:warehouse,unit:'حبة',quantity:0,avgCost:0,sku:name==='قلم قبول'?'000123':'000124',currencyCode:'ريال'}}});expect(res.status()).toBe(201);
  }
  await page.goto('/?autostart=1');await page.getByTestId('user-action-shortcuts').getByRole('button',{name:'فاتورة شراء',exact:true}).click();
  const modal=page.getByTestId('invoice-modal'); await expect(modal).toBeVisible();
  const locks=await modal.evaluate(node=>{
    const selectors=['.invoice-modal-head','.invoice-meta-grid .invoice-field-box','.invoice-meta-grid input','.invoice-erp-table','.invoice-erp-row','.invoice-modal-footer','.invoice-actions-erp .save'];
    return selectors.map(s=>{const e=node.querySelector(s)!;const c=getComputedStyle(e);return {s,height:(e as HTMLElement).offsetHeight,radius:c.borderRadius,padding:c.padding,background:c.backgroundColor};});
  });
  expect(locks[1].radius).toBe('9px');expect(locks[1].padding).toBe('6px 9px');expect(locks[2].height).toBe(28);
  expect(locks[4].height).toBe(87);expect(locks[6].height).toBe(44);expect(locks[6].background).toBe('rgb(67, 56, 202)');
  const search=page.getByTestId('invoice-item-search');await search.scrollIntoViewIfNeeded();
  const before=await modal.locator('.invoice-erp-table').evaluate(e=>e.getBoundingClientRect().top);
  await search.fill('قلم');await expect(modal.locator('#invoice-search-results')).toContainText('جارٍ البحث');
  await search.fill('دفتر');await expect(modal.getByRole('option').filter({hasText:'دفتر قبول'})).toBeVisible();
  await expect(modal.getByRole('option').filter({hasText:'قلم قبول'})).toHaveCount(0);
  expect(Math.abs(await modal.locator('.invoice-erp-table').evaluate(e=>e.getBoundingClientRect().top)-before)).toBeLessThan(2);
  await search.fill('غيرموجود');await expect(modal.locator('#invoice-search-results')).toContainText('لا توجد أصناف');
  await search.fill('000123');await modal.getByRole('option').filter({hasText:'قلم قبول'}).click();
  await modal.getByLabel('كمية السطر 1',{exact:true}).fill('2');await modal.getByLabel('سعر السطر 1',{exact:true}).fill('7.5');
  await modal.getByLabel('بيان الفاتورة').fill('مسودة اختبار محفوظة');
  await expect(page.getByTestId('invoice-draft-status')).toContainText('حُفظت المسودة');
  await page.reload();await expect(modal).toBeVisible();await expect(modal.getByLabel('بيان الفاتورة')).toHaveValue('مسودة اختبار محفوظة');await expect(modal.getByLabel('كمية السطر 1',{exact:true})).toHaveValue('2');
  for(const height of [844,500]){
    await page.setViewportSize({width:360,height});await modal.getByLabel('بيان الفاتورة').focus();
    await expect.poll(async()=>modal.evaluate(node=>{const dialog=node.querySelector('[role=dialog]')!.getBoundingClientRect(),footer=node.querySelector('.invoice-modal-footer')!.getBoundingClientRect(),body=node.querySelector('.invoice-modal-body')!,focus=document.activeElement!.getBoundingClientRect();return dialog.left>=0&&dialog.right<=innerWidth+1&&footer.bottom<=innerHeight+1&&focus.bottom<=footer.top+1&&body.scrollWidth<=body.clientWidth+1;})).toBe(true);
  }
  await page.screenshot({path:'test-results/invoice-compact-keyboard-viewport.png'});
  await page.route('**/workspace/*/ledger',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'فشل حفظ اختباري'})}));
  await page.getByTestId('invoice-save-btn').click();await expect(page.getByTestId('invoice-validation-error')).toBeVisible();await expect(modal.getByLabel('بيان الفاتورة')).toHaveValue('مسودة اختبار محفوظة');
  expect((await (await page.request.get(ws)).json()).ledger).toHaveLength(0);
  await page.unroute('**/workspace/*/ledger');await page.getByTestId('invoice-save-btn').click();await expect(modal).toBeHidden();
  bundle=await (await page.request.get(ws)).json();expect(bundle.ledger).toHaveLength(1);expect(bundle.ledger[0].amount).toBe(15);expect(bundle.inventory.find((i:any)=>i.sku==='000123').quantity).toBe(2);
  await page.reload();await expect(page.getByTestId('dashboard-screen')).toBeVisible();await expect(modal).toBeHidden();expect((await (await page.request.get(ws)).json()).ledger).toHaveLength(1);
});
