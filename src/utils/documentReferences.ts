import type { AccountRecord, CashboxRecord, ReferenceDefaults } from '../types';

export const emptyReferenceDefaults = (): ReferenceDefaults => ({ warehouseId: '', accountId: '', systemCashboxes: {}, accountCashboxes: {}, groupCashboxes: {} });
export function eligibleCashbox(boxes: readonly CashboxRecord[], id: number | null | undefined, currency: string) {
  return boxes.find(b => b.id === id && b.currencyCode === currency && b.isActive !== false && b.state !== 0)?.id;
}
/** Explicit document choices never fall through. Defaults are used only for new selections. */
export function resolveCashbox(defaults: ReferenceDefaults | undefined, boxes: readonly CashboxRecord[], currency: string, account?: Pick<AccountRecord, 'id' | 'groupId' | 'currency'>, cashierBox?: number | null) {
  const matching = account?.currency === currency ? account : undefined;
  const candidates = [matching && defaults?.accountCashboxes[matching.id], matching?.groupId != null ? defaults?.groupCashboxes[String(matching.groupId)] : undefined, cashierBox, defaults?.systemCashboxes[currency]];
  for (const id of candidates) {
    const valid = eligibleCashbox(boxes, id, currency);
    if (valid !== undefined) return valid;
  }
  return undefined;
}
export function validateReferenceDefaultsShape(value: unknown): asserts value is ReferenceDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('مراجع المستندات غير صالحة.');
  const v = value as ReferenceDefaults;
  if (Object.keys(v).sort().join() !== 'accountCashboxes,accountId,groupCashboxes,systemCashboxes,warehouseId' ||
      [v.accountId, v.warehouseId].some(id => typeof id !== 'string' || id.length > 150)) throw new Error('مراجع المستندات غير صالحة.');
  if (v.groupCashboxes && Object.keys(v.groupCashboxes).some(id => !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('تصنيف الحساب غير صالح.');
  for (const map of [v.systemCashboxes, v.accountCashboxes, v.groupCashboxes]) {
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 20000 ||
        Object.entries(map).some(([id, box]) => !id || id.length > 150 || ['__proto__','constructor','prototype'].includes(id) || !Number.isSafeInteger(box) || box <= 0)) throw new Error('اختيارات الصناديق غير صالحة.');
  }
}
