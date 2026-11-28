import type { CashboxRecord, WarehouseRecord } from '../types.ts';

export const SETUP_TIMEZONES = ['UTC', 'Asia/Aden', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Baghdad', 'Asia/Amman', 'Asia/Beirut', 'Africa/Cairo', 'Africa/Khartoum', 'Africa/Casablanca', 'Europe/London', 'Europe/Paris', 'America/New_York'] as const;
export const ACTION_LABELS = { sale: 'فاتورة بيع', purchase: 'فاتورة شراء', inventory: 'المخزون', accounts: 'الحسابات', backup: 'نسخة احتياطية', receipt: 'سند قبض', payment: 'سند صرف', journal: 'قيد يومية' } as const;
export type QuickAction = keyof typeof ACTION_LABELS;
export type BusinessProfile = {
  version: 1; completedAt: string; businessType: 'retail' | 'wholesale' | 'services' | 'mixed';
  language: 'ar'; timezone: string; fiscalYearStartMonth: number;
  branch: { id: 'main'; name: string }; adminName: string;
  valuationMethod: 'weighted-average'; defaultUnit: string;
  salesPayment: 'cash' | 'credit'; purchasePayment: 'cash' | 'credit';
  taxRateBps: number; backupReminderOnExit: boolean; notificationsEnabled: boolean;
};
export type UserPreferences = {
  version: 1; theme: 'light' | 'dark' | 'system'; homeColumns: 'auto' | 1 | 2 | 3;
  defaultBranchId: '' | 'main'; defaultWarehouseId: string; defaultCashboxId: number | null;
  defaultCurrency: string; favoriteActions: QuickAction[]; recentActions: QuickAction[];
};
export type BusinessSetupInput = {
  companyName: string; currency: string; warehouseName: string; cashboxName: string; bankName: string;
  profile: BusinessProfile; preferences: UserPreferences;
};
export const defaultUserPreferences = (currency = 'ريال'): UserPreferences => ({ version: 1, theme: 'system', homeColumns: 'auto',
  defaultBranchId: 'main', defaultWarehouseId: '', defaultCashboxId: null, defaultCurrency: currency,
  favoriteActions: ['sale', 'purchase', 'inventory'], recentActions: [] });
export const defaultBusinessProfile = (): BusinessProfile => ({ version: 1, completedAt: '', businessType: 'retail', language: 'ar',
  timezone: 'Asia/Aden', fiscalYearStartMonth: 1,
  branch: { id: 'main', name: 'الفرع الرئيسي' }, adminName: 'المدير', valuationMethod: 'weighted-average', defaultUnit: 'حبة',
  salesPayment: 'cash', purchasePayment: 'cash', taxRateBps: 0, backupReminderOnExit: true, notificationsEnabled: true });
const fail = (): never => { throw new Error('راجع بيانات التهيئة والتفضيلات والمراجع المحددة.'); };
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max: number, empty = false) { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) fail(); }
function keys(v: unknown, expected: string[]) {
  if (!object(v) || Object.keys(v).sort().join() !== expected.sort().join()) fail();
}
export function validateBusinessProfile(value: unknown): asserts value is BusinessProfile {
  keys(value, Object.keys(defaultBusinessProfile())); const p = value as BusinessProfile;
  if (p.version !== 1 || !['retail', 'wholesale', 'services', 'mixed'].includes(p.businessType) || p.language !== 'ar' ||
      p.valuationMethod !== 'weighted-average' || !Number.isInteger(p.fiscalYearStartMonth) || p.fiscalYearStartMonth < 1 || p.fiscalYearStartMonth > 12 ||
      !['cash', 'credit'].includes(p.salesPayment) || !['cash', 'credit'].includes(p.purchasePayment) ||
      !Number.isInteger(p.taxRateBps) || p.taxRateBps < 0 || p.taxRateBps > 10000 ||
      typeof p.backupReminderOnExit !== 'boolean' || typeof p.notificationsEnabled !== 'boolean') fail();
  text(p.timezone, 80); if (!(SETUP_TIMEZONES as readonly string[]).includes(p.timezone)) fail(); try { new Intl.DateTimeFormat('en', { timeZone: p.timezone }); } catch { fail(); }
  text(p.defaultUnit, 32); text(p.adminName, 100); text(p.completedAt, 40, true);
  if (p.completedAt && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(p.completedAt)) fail();
  keys(p.branch, ['id', 'name']); if (p.branch.id !== 'main') fail(); text(p.branch.name, 100);
}
export function validateUserPreferences(value: unknown): asserts value is UserPreferences {
  keys(value, Object.keys(defaultUserPreferences())); const p = value as UserPreferences;
  if (p.version !== 1 || !['light', 'dark', 'system'].includes(p.theme) || !['auto', 1, 2, 3].includes(p.homeColumns) ||
      !['', 'main'].includes(p.defaultBranchId) || p.defaultCashboxId !== null && (!Number.isSafeInteger(p.defaultCashboxId) || p.defaultCashboxId <= 0)) fail();
  text(p.defaultWarehouseId, 150, true); text(p.defaultCurrency, 64);
  for (const list of [p.favoriteActions, p.recentActions]) if (!Array.isArray(list) || list.length > 6 || new Set(list).size !== list.length || list.some(a => !Object.hasOwn(ACTION_LABELS, a))) fail();
}
export function validatePreferenceReferences(p: UserPreferences, currencies: string[], warehouses: Pick<WarehouseRecord, 'id'>[], cashboxes: Pick<CashboxRecord, 'id' | 'currencyCode' | 'state' | 'isActive'>[]) {
  validateUserPreferences(p);
  if (!currencies.includes(p.defaultCurrency) || p.defaultWarehouseId && !warehouses.some(w => w.id === p.defaultWarehouseId) ||
      p.defaultCashboxId !== null && !cashboxes.some(b => b.id === p.defaultCashboxId && b.currencyCode === p.defaultCurrency && b.state !== 0 && b.isActive !== false)) fail();
}
export function validateBusinessSetup(value: unknown): asserts value is BusinessSetupInput {
  keys(value, ['companyName', 'currency', 'warehouseName', 'cashboxName', 'bankName', 'profile', 'preferences']); const p = value as BusinessSetupInput;
  for (const k of ['companyName', 'warehouseName', 'cashboxName'] as const) text(p[k], 100);
  text(p.bankName, 100, true); text(p.currency, 64); validateBusinessProfile(p.profile); validateUserPreferences(p.preferences);
  if (p.currency !== p.preferences.defaultCurrency || p.profile.completedAt !== '') fail();
}
export function businessToday(timezone?: string, now = new Date()): string {
  if (!timezone) return now.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
