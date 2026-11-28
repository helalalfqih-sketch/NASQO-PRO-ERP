import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx');

test.use({launchOptions: {executablePath: process.env.TEST_BROWSER_EXECUTABLE}});
const ws = '/api/db/workspace/local-erp-workspace';
const headers = {'X-NASQO-CSRF': '1'};

test('actual SQLite journal reaches the visible trial balance, reload and error recovery', async ({page}) => {
  test.setTimeout(90_000);
  // The Playwright server uses test-results/playwright-test.sqlite, never a live workspace.
  expect((await page.request.post(ws + '/reset', {headers, data: {confirmation: 'RESET:local-erp-workspace'}})).status()).toBe(200);
  const accounts = [];
  for (const name of ['مدين اختبار اليومية', 'دائن اختبار اليومية']) {
    const response = await page.request.post(ws + '/accounts', {headers, data: {account: {name, category: 'shop', currency: 'ريال'}}});
    expect(response.status()).toBe(201); accounts.push((await response.json()).account);
  }
  const journal = {entryDate: '2026-11-01', currency: 'ريال', idempotencyKey: 'ui-journal', lines: [{accountId: accounts[0].id, debit: 500}, {accountId: accounts[1].id, credit: 500}]};
  expect((await page.request.post(ws + '/journals', {headers, data: journal})).status()).toBe(201);
  await page.addInitScript(() => localStorage.setItem('nasqo-local-session-active', '1'));
  await page.goto('/?autostart=1');
  await expect(page.getByTestId('dashboard-screen')).toBeVisible({timeout: 30_000});
  await page.getByTestId('home-nav-services').click();
  await page.getByTestId('erp-mod-btn-erp-finance').click();
  const card = page.getByTestId('erp-trial-balance-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('row').filter({hasText: accounts[0].name})).toContainText('500');
  await expect(card.getByRole('row').filter({hasText: accounts[1].name})).toContainText('500');
  await page.screenshot({path: 'test-results/erp-journal-trial-balance.png'});
  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', {name: 'تصدير Excel'}).click();
  const download = await downloadPromise;
  const book = XLSX.readFile((await download.path())!);
  const cells = book.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(book.Sheets[name], {header: 1}));
  expect(JSON.stringify(cells)).toContain(accounts[0].name);
  expect(JSON.stringify(cells)).toContain('500');
  await page.reload();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible({timeout: 30_000});
  await page.getByTestId('home-nav-services').click(); await page.getByTestId('erp-mod-btn-erp-finance').click();
  await expect(card).toBeVisible({timeout: 30_000});
  await page.route('**/reports/trial-balance?**', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'فشل اختباري في قراءة التقرير'})}));
  await page.getByTestId('erp-finance-period-select').selectOption('monthly');
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'تصدير Excel', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'إعادة المحاولة', exact: true})).toBeVisible();
  await page.unroute('**/reports/trial-balance?**');
  await page.getByRole('button', {name: 'إعادة المحاولة', exact: true}).click();
  await expect(card).toBeVisible();
  const bundle = await (await page.request.get(ws)).json();
  expect(bundle.ledger).toHaveLength(0); // read projection never creates a duplicate document
});
