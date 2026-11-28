import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultBusinessProfile,
  defaultUserPreferences,
  validateBusinessSetup,
  validateUserPreferences,
} from '../src/utils/businessSetup.ts';

test('first-run setup and preferences work without Object.hasOwn (Android WebView 83)', () => {
  const original = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
  try {
    Reflect.deleteProperty(Object, 'hasOwn');
    const preferences = defaultUserPreferences();
    assert.doesNotThrow(() => validateBusinessSetup({
      companyName: 'منشأة اختبار',
      currency: 'ريال',
      warehouseName: 'مخزن اختبار',
      cashboxName: 'صندوق اختبار',
      bankName: '',
      profile: defaultBusinessProfile(),
      preferences,
    }));
    assert.throws(
      () => validateUserPreferences({ ...preferences, favoriteActions: ['constructor'] }),
      { message: 'راجع بيانات التهيئة والتفضيلات والمراجع المحددة.' },
    );
  } finally {
    if (original) Object.defineProperty(Object, 'hasOwn', original);
  }
});
