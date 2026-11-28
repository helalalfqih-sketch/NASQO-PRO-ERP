import { useEffect, useRef, useState } from 'react';
import { KeyboardInput, useKeyboard } from '../mobile';
import { completeBusinessSetup, saveWorkspaceSettings } from '../firebase';
import { parseArabicNumber } from '../accounting';
import { useInvoiceViewport } from '../hooks/useInvoiceViewport';
import { ACTION_LABELS, SETUP_TIMEZONES, defaultBusinessProfile, defaultUserPreferences, validateBusinessProfile, validateUserPreferences, type BusinessSetupInput, type QuickAction } from '../utils/businessSetup';
import type { CashboxRecord, WarehouseRecord, WorkspaceSettings } from '../types';

export function BusinessSetupModal({ workspace, warehouses, cashboxes, currencies, onClose, onImport, onSaved }: {
  workspace: WorkspaceSettings; warehouses: WarehouseRecord[]; cashboxes: CashboxRecord[]; currencies: readonly string[];
  onClose: () => void; onImport: () => void; onSaved: () => void;
}) {
  const editing = Boolean(workspace.businessProfile);
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const keyboard = useKeyboard(), viewport = useInvoiceViewport(true);
  const [draft, setDraft] = useState<BusinessSetupInput>(() => ({ companyName: workspace.companyName === 'نسقو برو' ? '' : workspace.companyName,
    currency: workspace.userPreferences?.defaultCurrency ?? workspace.defaultCurrency,
    warehouseName: warehouses[0]?.name ?? 'المخزن الرئيسي', cashboxName: cashboxes[0]?.name ?? 'الصندوق الرئيسي', bankName: '',
    profile: workspace.businessProfile ?? defaultBusinessProfile(), preferences: workspace.userPreferences ?? defaultUserPreferences(workspace.defaultCurrency) }));
  const initial = useRef(JSON.stringify(draft));
  const [taxText, setTaxText] = useState(String(draft.profile.taxRateBps / 100));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const patch = (p: Partial<BusinessSetupInput>) => { setDraft(d => ({ ...d, ...p })); setError(''); };
  const profile = (p: Partial<BusinessSetupInput['profile']>) => patch({ profile: { ...draft.profile, ...p } });
  const prefs = (p: Partial<BusinessSetupInput['preferences']>) => patch({ preferences: { ...draft.preferences, ...p } });
  const close = () => { keyboard.hide(); if (!busy) JSON.stringify(draft) === initial.current ? onClose() : setConfirmLeave(true); };
  useEffect(() => { window.addEventListener("nasqo:setup-back",close); return () => window.removeEventListener("nasqo:setup-back",close); });
  const validate = () => {
    if (!draft.companyName.trim() || draft.companyName.length > 100) throw new Error('أدخل اسم المنشأة، بحد أقصى 100 حرف.');
    validateBusinessProfile(draft.profile); validateUserPreferences(draft.preferences);
  };
  const next = () => { keyboard.hide(); try { validate(); setError(''); setStep(s => Math.min(s + 1, 3)); } catch (e) { setError((e as Error).message); } };
  const save = async () => {
    keyboard.hide(); if (busy) return;
    try {
      validate(); setBusy(true); setError('');
      if (editing) await saveWorkspaceSettings(workspace.id, { ...workspace, companyName: draft.companyName, businessProfile: draft.profile, userPreferences: draft.preferences });
      else await completeBusinessSetup(workspace.id, draft);
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر الحفظ. بيانات النموذج محفوظة هنا، أعد المحاولة.'); }
    finally { setBusy(false); }
  };
  const field = (label: string, value: string, set: (value: string) => void, maxLength = 100) => <label className="setup-field">{label}<KeyboardInput aria-label={label} value={value} maxLength={maxLength} onChange={e => set(e.target.value)} /></label>;
  const payment = (label: string, value: string, set: (v: 'cash' | 'credit') => void) => <label className="setup-field">{label}<select aria-label={label} value={value} onChange={e => set(e.target.value as 'cash' | 'credit')}><option value="cash">نقدي</option><option value="credit">آجل</option></select></label>;
  return <div className="center-modal-layer invoice-adaptive-layer" ref={viewport.ref} style={{ '--invoice-available-height': viewport.height ? `${viewport.height}px` : undefined } as React.CSSProperties} data-testid="business-setup-modal">
    <button className="center-modal-backdrop" aria-label="إغلاق معالج البداية" disabled={busy} onClick={close} />
    <section className="invoice-modal invoice-modal-pro business-setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" dir="rtl">
      <header className="invoice-modal-head"><div><h2 id="setup-title">{editing ? 'المنشأة وتفضيلاتي' : 'مرحبًا بك في نسقو برو'}</h2><small>خطوة {step + 1} من 4 · {['بيانات المنشأة', 'إعداد التشغيل', 'تفضيلاتي', 'المراجعة'][step]}</small></div><button className="ref-btn" aria-label="إغلاق التهيئة" disabled={busy} onClick={close}>×</button></header>
      <div className="invoice-modal-body"><fieldset disabled={busy} className="setup-fields">
        {step === 0 && <>
          {!editing && <div className="setup-import"><strong>هل لديك بيانات سابقة؟</strong><p>استعد نسختك الحالية لتواصل من أرصدتها وحركاتها.</p><button className="ref-btn" onClick={() => { keyboard.hide(); onImport(); }}>استيراد نسخة احتياطية</button></div>}
          {field('اسم المنشأة', draft.companyName, companyName => patch({ companyName }))}
          <label className="setup-field">نوع النشاط<select aria-label="نوع النشاط" value={draft.profile.businessType} onChange={e => profile({ businessType: e.target.value as typeof draft.profile.businessType })}><option value="retail">تجارة تجزئة</option><option value="wholesale">تجارة جملة</option><option value="services">خدمات</option><option value="mixed">نشاط متنوع</option></select></label>
          <label className="setup-field">لغة الواجهة<select aria-label="لغة الواجهة" value="ar" disabled><option value="ar">العربية</option></select></label>
          {field('اسم المسؤول', draft.profile.adminName, adminName => profile({ adminName }))}
          <p className="setup-help">تستخدم صلاحيات مالك مساحة العمل الحالية.</p>
        </>}
        {step === 1 && <>
          <label className="setup-field">العملة الافتراضية<select aria-label="العملة الافتراضية للتهيئة" value={draft.currency} onChange={e => patch({ currency: e.target.value, preferences: { ...draft.preferences, defaultCurrency: e.target.value, defaultCashboxId: null } })}>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="setup-field">المنطقة الزمنية<select aria-label="المنطقة الزمنية" value={draft.profile.timezone} onChange={e => profile({ timezone: e.target.value })}>{SETUP_TIMEZONES.map(z => <option key={z}>{z}</option>)}</select></label>
          <label className="setup-field">شهر بداية السنة المالية<select aria-label="شهر بداية السنة المالية" value={draft.profile.fiscalYearStartMonth} onChange={e => profile({ fiscalYearStartMonth: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
          {field('اسم الفرع الرئيسي', draft.profile.branch.name, name => profile({ branch: { id: 'main', name } }))}
          <label className="setup-field">المخزن الافتراضي<select aria-label="مخزن المستخدم" value={draft.preferences.defaultWarehouseId} onChange={e => prefs({ defaultWarehouseId: e.target.value })}><option value="">استخدام مخزن المنشأة</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="setup-field">الصندوق الافتراضي<select aria-label="صندوق المستخدم" value={draft.preferences.defaultCashboxId ?? ''} onChange={e => prefs({ defaultCashboxId: e.target.value ? Number(e.target.value) : null })}><option value="">استخدام صندوق المنشأة</option>{cashboxes.filter(b => b.currencyCode === draft.currency && b.state !== 0 && b.isActive !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          {!editing && <>{field('اسم المخزن الأول', draft.warehouseName, warehouseName => patch({ warehouseName }))}{field('اسم الصندوق الأول', draft.cashboxName, cashboxName => patch({ cashboxName }))}{field('اسم الحساب البنكي (اختياري)', draft.bankName, bankName => patch({ bankName }))}<p className="setup-help">ستُستخدم السجلات الموجودة. يُنشأ البنك كحساب نقدي مستقل يمكن استخدامه في الحوالات والمستندات.</p></>}
          {field('الوحدة الافتراضية', draft.profile.defaultUnit, defaultUnit => profile({ defaultUnit }), 32)}
          <label className="setup-field">تقييم المخزون<select value="weighted-average" disabled><option value="weighted-average">المتوسط المرجح</option></select></label>
          <label className="setup-field">ضريبة الفاتورة الافتراضية (%)<KeyboardInput aria-label="نسبة الضريبة الافتراضية" inputMode="decimal" value={taxText} onChange={e => {
            const text=e.target.value; setTaxText(text);
            profile({ taxRateBps: /^[0-9٠-٩۰-۹]+([.٫][0-9٠-٩۰-۹]{0,2})?$/.test(text.trim()) ? Math.round(parseArabicNumber(text)*100) : NaN });
          }} /></label>
          <p className="setup-help">صفر يعني دون ضريبة. تطبق النسبة على الفواتير الجديدة فقط.</p>
        </>}
        {step === 2 && <>
          <label className="setup-field">المظهر<select aria-label="المظهر المفضل" value={draft.preferences.theme} onChange={e => prefs({ theme: e.target.value as typeof draft.preferences.theme })}><option value="system">حسب الجهاز</option><option value="light">فاتح</option><option value="dark">داكن</option></select></label>
          <label className="setup-field">أعمدة الرئيسية<select aria-label="أعمدة الرئيسية" value={draft.preferences.homeColumns} onChange={e => prefs({ homeColumns: e.target.value === 'auto' ? 'auto' : Number(e.target.value) as 1 | 2 | 3 })}><option value="auto">تلقائي</option><option value="1">عمود واحد</option><option value="2">عمودان</option><option value="3">ثلاثة أعمدة</option></select></label>
          {payment('الدفع في البيع', draft.profile.salesPayment, salesPayment => profile({ salesPayment }))}{payment('الدفع في الشراء', draft.profile.purchasePayment, purchasePayment => profile({ purchasePayment }))}
          <strong>الإجراءات المفضلة</strong>{Object.entries(ACTION_LABELS).map(([key, label]) => <label className="setup-check" key={key}><input type="checkbox" checked={draft.preferences.favoriteActions.includes(key as QuickAction)} onChange={e => prefs({ favoriteActions: e.target.checked ? [...draft.preferences.favoriteActions, key as QuickAction] : draft.preferences.favoriteActions.filter(a => a !== key) })} />{label}</label>)}
          <label className="setup-check"><input type="checkbox" checked={draft.profile.backupReminderOnExit} onChange={e => profile({ backupReminderOnExit: e.target.checked })} />التذكير بالنسخ الاحتياطي عند الخروج</label>
          <label className="setup-check"><input type="checkbox" checked={draft.profile.notificationsEnabled} onChange={e => profile({ notificationsEnabled: e.target.checked })} />إظهار تنبيهات التطبيق</label>
        </>}
        {step === 3 && <div className="setup-review"><h3>{draft.companyName}</h3><p>{draft.profile.branch.name} · {draft.currency}</p><p>المنطقة الزمنية: {draft.profile.timezone}</p><p>بداية السنة المالية: الشهر {draft.profile.fiscalYearStartMonth}</p><p>تقييم المخزون: المتوسط المرجح</p><p>ضريبة الفواتير الجديدة: {draft.profile.taxRateBps / 100}%</p><p>{editing ? 'تسري التفضيلات على الاستخدام والمستندات الجديدة.' : 'يبدأ النشاط الجديد بأرصدة صفرية. عند وجود سجلات سابقة تبقى أرصدتها وحركاتها محفوظة.'}</p><p>يمكن إدخال الأرصدة الافتتاحية من الحسابات، أو استعادة نسخة سابقة من إعدادات النسخ الاحتياطي.</p></div>}
      </fieldset>{error && <p className="auth-error" role="alert">{error}</p>}
      {confirmLeave && <div role="alert"><p>هناك تعديلات لم تُحفظ.</p><button className="ref-btn" onClick={() => setConfirmLeave(false)}>متابعة التعديل</button><button className="ref-btn" onClick={onClose}>تجاهل وإغلاق</button></div>}</div>
      <footer className="invoice-modal-footer"><button className="ref-btn" disabled={busy || step === 0} onClick={() => { keyboard.hide(); setStep(s => s - 1); }}>السابق</button><button className="ref-btn blue" disabled={busy} onClick={step === 3 ? () => void save() : next}>{busy ? 'جارٍ الحفظ…' : step === 3 ? editing ? 'حفظ التفضيلات' : 'إكمال التهيئة' : 'التالي'}</button></footer>
    </section>
  </div>;
}
