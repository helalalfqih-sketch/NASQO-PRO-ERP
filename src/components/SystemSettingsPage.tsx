import { useRef, useState, type ChangeEvent } from "react";
import {
  FilePlusIcon,
  FileTextIcon,
  GearIcon,
  MagnifyingGlassIcon,
  Cross2Icon,
} from "@radix-ui/react-icons";
import { KeyboardInput, MobileScroll, useKeyboard } from "../mobile";
import { isBackupOverdue } from "../accounting";
import { saveWorkspaceSettings } from "../firebase";
import { CURRENCIES, type CurrencyCode, type WorkspaceSettings } from "../types";
import {
  APP_FONT_FAMILY_PRESETS,
  CARD_BORDER_PRESETS,
  CARD_COLOR_PRESETS,
  CARD_SHAPE_PRESETS,
  CARD_SHADOW_PRESETS,
  CARD_SIZE_PRESETS,
  DEFAULT_EXTENDED_SETTINGS,
  HOME_BANNER_STYLE_PRESETS,
  HOME_BUTTON_STYLE_PRESETS,
  HOME_COLOR_PRESETS,
  HOME_COLUMNS_PRESETS,
  HOME_FONT_SIZE_PRESETS,
  resolveHomeAppearanceTokens,
  type ExtendedAppSettings,
} from "../utils/appSettings";
import { BRAND_COLOR_PRESETS } from "../utils/brandColor";
import { APP_ICON_URL } from "../utils/appBrand";
import { triggerHaptic } from "../utils/haptics";
import type { ThemeMode } from "../utils/theme";

interface SystemSettingsPageProps {
  uid: string;
  userEmail: string;
  workspace: WorkspaceSettings | null;
  currencyOptions?: readonly string[];
  extended: ExtendedAppSettings;
  onChangeExtended: (next: ExtendedAppSettings) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  brandColor: string;
  onChangeBrandColor: (hex: string) => void;
  onResetBrandColor: () => void;
  hapticsEnabled: boolean;
  onChangeHaptics: (enabled: boolean) => void;
  lastBackupIso: string | null;
  onOpenBackupModal: () => void;
  onOpenGoogleDrive?: () => void;
  onOpenFullSqliteImport?: () => void;
  onRestoreJson: () => void;
  onOpenTrash?: () => void;
  onSignOut: () => void;
  onNotify: (msg: string) => void;
  onBack: () => void;
  onSaveWorkspaceSettings?: (next: WorkspaceSettings) => Promise<void>;
}

export function SystemSettingsPage({
  uid,
  userEmail,
  workspace,
  currencyOptions = CURRENCIES,
  extended,
  onChangeExtended,
  themeMode,
  onChangeThemeMode,
  brandColor,
  onChangeBrandColor,
  onResetBrandColor,
  hapticsEnabled,
  onChangeHaptics,
  lastBackupIso,
  onOpenBackupModal,
  onOpenGoogleDrive,
  onOpenFullSqliteImport,
  onRestoreJson,
  onSignOut,
  onNotify,
  onBack,
  onSaveWorkspaceSettings,
}: SystemSettingsPageProps) {
  const keyboard = useKeyboard();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState(workspace?.companyName ?? "نسقو برو");
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(
    workspace?.defaultCurrency ?? "ريال",
  );
  const [whatsappPhone, setWhatsappPhone] = useState(workspace?.whatsappPhone ?? "771370740");
  const [draft, setDraft] = useState<ExtendedAppSettings>(extended);
  const [faqOpen, setFaqOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const backupStatus = isBackupOverdue(lastBackupIso);

  const updateField = <K extends keyof ExtendedAppSettings>(
    key: K,
    value: ExtendedAppSettings[K],
  ) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onChangeExtended(next);
  };

  const updateFields = (patch: Partial<ExtendedAppSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChangeExtended(next);
  };

  const resetCardAppearance = () => {
    triggerHaptic("light");
    updateFields({
      cardSize: DEFAULT_EXTENDED_SETTINGS.cardSize,
      cardPadding: DEFAULT_EXTENDED_SETTINGS.cardPadding,
      cardGap: DEFAULT_EXTENDED_SETTINGS.cardGap,
      cardScale: DEFAULT_EXTENDED_SETTINGS.cardScale,
      cardShape: DEFAULT_EXTENDED_SETTINGS.cardShape,
      cardRadius: DEFAULT_EXTENDED_SETTINGS.cardRadius,
      cardShadow: DEFAULT_EXTENDED_SETTINGS.cardShadow,
      cardBorderStyle: DEFAULT_EXTENDED_SETTINGS.cardBorderStyle,
      cardBorderWidth: DEFAULT_EXTENDED_SETTINGS.cardBorderWidth,
      cardColorPreset: DEFAULT_EXTENDED_SETTINGS.cardColorPreset,
      cardBgColor: DEFAULT_EXTENDED_SETTINGS.cardBgColor,
      cardBorderColor: DEFAULT_EXTENDED_SETTINGS.cardBorderColor,
      cardTextColor: DEFAULT_EXTENDED_SETTINGS.cardTextColor,
      cardAccentColor: DEFAULT_EXTENDED_SETTINGS.cardAccentColor,
    });
    onNotify("تمت استعادة الإعدادات الافتراضية للبطائق");
  };

  const resetHomeAppearance = () => {
    triggerHaptic("light");
    updateFields({
      homeButtonStyle: DEFAULT_EXTENDED_SETTINGS.homeButtonStyle,
      homeColumns: DEFAULT_EXTENDED_SETTINGS.homeColumns,
      homeBannerStyle: DEFAULT_EXTENDED_SETTINGS.homeBannerStyle,
      homeButtonRadius: DEFAULT_EXTENDED_SETTINGS.homeButtonRadius,
      homeButtonHeight: DEFAULT_EXTENDED_SETTINGS.homeButtonHeight,
      homeGridGap: DEFAULT_EXTENDED_SETTINGS.homeGridGap,
      homeColorPreset: DEFAULT_EXTENDED_SETTINGS.homeColorPreset,
      homePrimaryBtnColor: DEFAULT_EXTENDED_SETTINGS.homePrimaryBtnColor,
      homeSecondaryBtnColor: DEFAULT_EXTENDED_SETTINGS.homeSecondaryBtnColor,
      homeHeaderColor: DEFAULT_EXTENDED_SETTINGS.homeHeaderColor,
      homeBannerBgColor: DEFAULT_EXTENDED_SETTINGS.homeBannerBgColor,
      homeCanvasBgColor: DEFAULT_EXTENDED_SETTINGS.homeCanvasBgColor,
      homeBtnTextColor: DEFAULT_EXTENDED_SETTINGS.homeBtnTextColor,
      homeFontFamily: DEFAULT_EXTENDED_SETTINGS.homeFontFamily,
      homeFontSize: DEFAULT_EXTENDED_SETTINGS.homeFontSize,
    });
    onResetBrandColor();
    onChangeThemeMode("light");
    onNotify("تمت استعادة الإعدادات الافتراضية (نيلي حديث • فاتح)");
  };

  const homeTokens = resolveHomeAppearanceTokens(draft);

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateField("logoDataUrl", reader.result);
        triggerHaptic("success");
        onNotify("تم تحديث شعار المنشأة");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAll = async () => {
    keyboard.hide();
    onChangeExtended(draft);
    if (!workspace) {
      triggerHaptic("success");
      onNotify("تم حفظ الإعدادات محليًا");
      return;
    }
    setSaving(true);
    try {
      const nextWorkspace: WorkspaceSettings = {
        ...workspace,
        companyName: companyName.trim() || workspace.companyName,
        defaultCurrency,
        whatsappPhone: whatsappPhone.trim(),
        whatsappInstantEnabled: draft.autoWhatsapp,
        whatsappProvider: draft.whatsappVariant === "green" ? "external" : "nasqo",
      };
      if (onSaveWorkspaceSettings) {
        await onSaveWorkspaceSettings(nextWorkspace);
      } else {
        await saveWorkspaceSettings(uid, nextWorkspace);
      }
      triggerHaptic("success");
      onNotify("تم حفظ جميع إعدادات النظام بنجاح");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileScroll className="app-screen sys-settings-scroll">
      <main className="sys-settings-page page-with-footer" data-testid="system-settings-screen">
        {/* Top Activation & Version Banner */}
        <div className="sys-activation-pill">
          <span>التطبيق مفعل — سنوي</span>
          <bdi>610870500</bdi>
        </div>

        <div className="sys-email-bar">
          <bdi>{userEmail || "مستخدم سحابي"}</bdi>
        </div>

        {/* Usage & Sync Mode */}
        <div className="sys-row sys-radio-row">
          <span className="sys-row-label accent-red">نوع الاستخدام</span>
          <div className="sys-radios" role="radiogroup" aria-label="نوع الاستخدام">
            <label>
              <input
                type="radio"
                name="sys-usage-mode"
                checked={draft.usageMode === "local"}
                onChange={() => {
                  triggerHaptic("light");
                  updateField("usageMode", "local");
                }}
              />
              <span>المحلي</span>
            </label>
            <label>
              <input
                type="radio"
                name="sys-usage-mode"
                checked={draft.usageMode === "sync"}
                onChange={() => {
                  triggerHaptic("light");
                  updateField("usageMode", "sync");
                }}
              />
              <span>المزامنة</span>
            </label>
          </div>
        </div>

        <div className="sys-row sys-radio-row">
          <span className="sys-row-label accent-red">نوع المزامنة</span>
          <div className="sys-radios-with-icons">
            <div className="sys-radios" role="radiogroup" aria-label="نوع المزامنة">
              <label>
                <input
                  type="radio"
                  name="sys-sync-mode"
                  checked={draft.syncMode === "auto"}
                  onChange={() => {
                    triggerHaptic("light");
                    updateField("syncMode", "auto");
                  }}
                />
                <span>تلقائية</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="sys-sync-mode"
                  checked={draft.syncMode === "manual"}
                  onChange={() => {
                    triggerHaptic("light");
                    updateField("syncMode", "manual");
                  }}
                />
              <span>يدوية</span>
              </label>
            </div>
          </div>
        </div>

        <div className="sys-btn-grid" style={{ gridTemplateColumns: "1fr" }}>
          <button
            type="button"
            className="danger"
            onClick={() => {
              triggerHaptic("warning");
              onSignOut();
            }}
          >
            تسجيل الخروج
          </button>
        </div>

        <div className="sys-faq-row">
          <button
            type="button"
            className="sys-faq-link"
            onClick={() => setFaqOpen((prev) => !prev)}
          >
            أسئلة شائعة
          </button>
        </div>
        {faqOpen ? (
          <div className="sys-faq-card">
            <strong>أبرز الإرشادات:</strong>
            <p>• يمكنك حفظ نسخة احتياطية كاملة في أي وقت من قسم النسخ الاحتياطي.</p>
            <p>• يمكنك تخصيص مسمى (الرصيد لكم / عليكم) وملاحظات الفواتير أسفل هذه الصفحة.</p>
          </div>
        ) : null}

        {/* Logo & Business Bilingual Fields */}
        <section className="sys-card">
          <div className="sys-logo-row">
            <span className="sys-blue-label">الشعار</span>
            <button
              type="button"
              className="sys-logo-thumb"
              onClick={() => logoInputRef.current?.click()}
              aria-label="تغيير شعار المنشأة"
            >
              {draft.logoDataUrl ? (
                <img src={draft.logoDataUrl} alt="شعار المنشأة" draggable={false} />
              ) : (
                <img
                  src={APP_ICON_URL}
                  alt="أيقونة التطبيق"
                  className="app-brand-icon-img"
                  draggable={false}
                />
              )}
            </button>
            {draft.logoDataUrl ? (
              <button
                type="button"
                className="sys-logo-clear"
                aria-label="إزالة الشعار"
                onClick={() => updateField("logoDataUrl", "")}
              >
                <Cross2Icon />
              </button>
            ) : null}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleLogoUpload}
            />
          </div>

          <label className="sys-row sys-check-row">
            <span className="accent-red">لا أريد ظهور الإعلانات</span>
            <input
              type="checkbox"
              checked={draft.hideAds}
              onChange={(e) => updateField("hideAds", e.target.checked)}
            />
          </label>

          <div className="sys-bilingual-grid">
            <label className="sys-field-box">
              <span>الاسم</span>
              <KeyboardInput
                aria-label="اسم النشاط بالعربية"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>الاسم بالإنجليزية</span>
              <KeyboardInput
                aria-label="Business Name EN"
                value={draft.companyNameEn}
                onChange={(e) => updateField("companyNameEn", e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>العنوان</span>
              <KeyboardInput
                aria-label="العنوان بالعربية"
                value={draft.addressAr}
                onChange={(e) => updateField("addressAr", e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>العنوان بالإنجليزية</span>
              <KeyboardInput
                aria-label="Address EN"
                value={draft.addressEn}
                onChange={(e) => updateField("addressEn", e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>رقم الجوال</span>
              <KeyboardInput
                aria-label="رقم الجوال"
                inputMode="tel"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>رقم الجوال بالإنجليزية</span>
              <KeyboardInput
                aria-label="Mobile EN"
                inputMode="tel"
                value={draft.mobileEn}
                onChange={(e) => updateField("mobileEn", e.target.value)}
              />
            </label>
          </div>

          <div className="sys-bilingual-grid">
            <label className="sys-field-box">
              <span>الرقم الضريبي</span>
              <KeyboardInput
                aria-label="الرقم الضريبي"
                placeholder="الرقم الضريبي"
                value={draft.taxNumber}
                onChange={(e) => updateField("taxNumber", e.target.value)}
              />
            </label>
            <label className="sys-field-box">
              <span>العملة الافتراضية</span>
              <select
                aria-label="العملة الافتراضية"
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value as CurrencyCode)}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Main Home Interface Colors, Shapes, Banner & Layout Controls */}
        <section
          className="settings-appearance-box card-ctrl-section"
          data-testid="home-appearance-settings"
        >
          <div className="card-ctrl-header">
            <div>
              <div className="settings-subhead">تخصيص الواجهة الرئيسية (الألوان والأشكال والتخطيط)</div>
              <p className="card-ctrl-subtitle">
                تحكّم فوري بأزرار الرئيسية، الشعار، الشريط العلوي، وعدد الأعمدة مع معاينة مباشرة.
              </p>
            </div>
            <button
              type="button"
              className="settings-reset-color-btn"
              onClick={resetHomeAppearance}
              data-testid="home-reset-defaults-btn"
            >
              الافتراضي
            </button>
          </div>

          {/* Live Home Miniature Preview */}
          <div className="home-ctrl-preview-frame" aria-label="معاينة مباشرة للواجهة الرئيسية">
            <div
              className="home-ctrl-preview-stage"
              data-testid="home-appearance-preview"
              data-home-preview-style={draft.homeButtonStyle}
              data-home-preview-columns={draft.homeColumns}
              data-home-preview-banner={draft.homeBannerStyle}
              style={{
                background: homeTokens.canvasBg || undefined,
                fontFamily: homeTokens.fontFamilyCss,
              }}
            >
              <div
                className="home-ctrl-preview-header"
                style={{
                  background: homeTokens.headerBg || undefined,
                }}
              >
                <span className="home-ctrl-preview-brand">
                  <span className="home-ctrl-preview-header-icon" aria-hidden="true">
                    <img
                      src={draft.logoDataUrl || APP_ICON_URL}
                      alt=""
                      className={draft.logoDataUrl ? "" : "app-brand-icon-img"}
                      draggable={false}
                    />
                  </span>
                  <span>{companyName === "نسقو برو ERP" ? "نسقو برو" : companyName || "نسقو برو"}</span>
                </span>
                <span className="home-ctrl-preview-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>

              <div className="home-ctrl-preview-body">
                {draft.homeBannerStyle !== "hidden" ? (
                  <div
                    className={`home-ctrl-preview-banner style-${draft.homeBannerStyle}`}
                    style={{
                      background: homeTokens.bannerBg || undefined,
                      color: homeTokens.bannerInk || undefined,
                    }}
                  >
                    <span className="home-ctrl-preview-emblem" aria-hidden="true">
                      <img
                        src={draft.logoDataUrl || APP_ICON_URL}
                        alt=""
                        className={draft.logoDataUrl ? "" : "app-brand-icon-img"}
                        draggable={false}
                      />
                    </span>
                    <div className="home-ctrl-preview-banner-text">
                      <strong style={{ color: homeTokens.bannerInk || undefined }}>
                        {companyName === "نسقو برو ERP" ? "نسقو برو" : companyName || "نسقو برو"}
                      </strong>
                      {draft.homeBannerStyle !== "compact" ? (
                        <small style={{ color: homeTokens.bannerSubInk || undefined }}>
                          إدارة الحسابات والمبيعات والمخزون
                        </small>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div
                  className="home-ctrl-preview-grid"
                  style={{
                    gap: `${Math.max(4, Math.round(draft.homeGridGap * 0.7))}px`,
                  }}
                >
                  {[
                    { label: "سند جديد", kind: "primary", Icon: FilePlusIcon },
                    { label: "فاتورة جديدة", kind: "primary", Icon: FileTextIcon },
                    { label: "البحث السريع", kind: "secondary", Icon: MagnifyingGlassIcon },
                    { label: "الإعدادات", kind: "secondary", Icon: GearIcon },
                  ].map(({ label, kind, Icon }) => (
                    <span
                      key={label}
                      className={`home-ctrl-preview-btn ${kind}`}
                      style={{
                        borderRadius: `${Math.min(draft.homeButtonRadius, 24)}px`,
                        minHeight:
                          draft.homeButtonStyle === "tile" || draft.homeButtonStyle === "icon-grid"
                            ? `${Math.max(48, Math.round(draft.homeButtonHeight * 0.92))}px`
                            : `${Math.max(30, Math.round(draft.homeButtonHeight * 0.72))}px`,
                        background:
                          kind === "primary"
                            ? homeTokens.primaryBg || "#4338ca"
                            : homeTokens.secondaryBg || "#0891b2",
                        color: homeTokens.btnText || "#ffffff",
                        fontSize: `${Math.max(9.5, Math.min(15, Math.round(draft.homeFontSize * 0.78 * 10) / 10))}px`,
                      }}
                    >
                      <span className="home-ctrl-preview-btn-ico" aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="home-ctrl-preview-btn-lbl">{label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 1. Home Button Shape Style */}
          <div className="card-ctrl-group">
            <span className="card-ctrl-label">شكل أزرار الواجهة الرئيسية</span>
            <div className="card-ctrl-segmented" role="group" aria-label="شكل أزرار الرئيسية">
              {HOME_BUTTON_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`home-style-${preset.id}`}
                  className={draft.homeButtonStyle === preset.id ? "active" : ""}
                  onClick={() => {
                    triggerHaptic("light");
                    updateFields({
                      homeButtonStyle: preset.id,
                      homeButtonRadius: preset.radius,
                      homeButtonHeight: preset.height,
                    });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Columns & Banner Style */}
          <div className="card-ctrl-group">
            <div className="card-ctrl-subrow">
              <span className="card-ctrl-label">عدد أعمدة الأزرار</span>
              <div className="card-ctrl-segmented" role="group" aria-label="عدد أعمدة أزرار الرئيسية">
                {HOME_COLUMNS_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`home-cols-${preset.id}`}
                    className={draft.homeColumns === preset.id ? "active" : ""}
                    onClick={() => {
                      triggerHaptic("light");
                      updateField("homeColumns", preset.id);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-ctrl-subrow">
              <span className="card-ctrl-label">بطاقة الشعار في الرئيسية</span>
              <div className="card-ctrl-segmented" role="group" aria-label="نمط بطاقة الشعار">
                {HOME_BANNER_STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`home-banner-${preset.id}`}
                    className={draft.homeBannerStyle === preset.id ? "active" : ""}
                    onClick={() => {
                      triggerHaptic("light");
                      updateField("homeBannerStyle", preset.id);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-ctrl-sliders">
              <label className="card-ctrl-slider-row">
                <span>استدارة الزوايا</span>
                <input
                  type="range"
                  min={0}
                  max={32}
                  step={1}
                  aria-label="استدارة زوايا أزرار الرئيسية"
                  value={draft.homeButtonRadius}
                  onChange={(e) => updateField("homeButtonRadius", Number(e.target.value))}
                />
                <b><bdi>{draft.homeButtonRadius}px</bdi></b>
              </label>
              <label className="card-ctrl-slider-row">
                <span>ارتفاع الأزرار</span>
                <input
                  type="range"
                  min={44}
                  max={76}
                  step={2}
                  aria-label="ارتفاع أزرار الرئيسية"
                  value={draft.homeButtonHeight}
                  onChange={(e) => updateField("homeButtonHeight", Number(e.target.value))}
                />
                <b><bdi>{draft.homeButtonHeight}px</bdi></b>
              </label>
              <label className="card-ctrl-slider-row">
                <span>تباعد الأزرار</span>
                <input
                  type="range"
                  min={4}
                  max={20}
                  step={1}
                  aria-label="المسافة بين أزرار الرئيسية"
                  value={draft.homeGridGap}
                  onChange={(e) => updateField("homeGridGap", Number(e.target.value))}
                />
                <b><bdi>{draft.homeGridGap}px</bdi></b>
              </label>
            </div>
          </div>

          {/* 3. Font Family & Main Screen Font Size */}
          <div className="card-ctrl-group" data-testid="home-font-settings">
            <span className="card-ctrl-label">نوع الخط وحجمه للشاشات الرئيسية</span>
            <div className="home-font-grid" role="group" aria-label="نوع الخط">
              {APP_FONT_FAMILY_PRESETS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  data-testid={`home-font-${font.id}`}
                  className={`home-font-chip ${draft.homeFontFamily === font.id ? "active" : ""}`}
                  style={{ fontFamily: font.cssFamily }}
                  onClick={() => {
                    triggerHaptic("light");
                    updateField("homeFontFamily", font.id);
                  }}
                >
                  <strong>{font.label}</strong>
                  <small>{font.sample}</small>
                </button>
              ))}
            </div>

            <div className="card-ctrl-subrow">
              <span className="card-ctrl-sublabel">حجم الخط في الشاشات الرئيسية</span>
              <div className="card-ctrl-segmented" role="group" aria-label="حجم الخط السريع">
                {HOME_FONT_SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`home-font-size-${preset.id}`}
                    className={draft.homeFontSize === preset.size ? "active" : ""}
                    onClick={() => {
                      triggerHaptic("light");
                      updateField("homeFontSize", preset.size);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-ctrl-sliders">
              <label className="card-ctrl-slider-row">
                <span>حجم الخط</span>
                <input
                  type="range"
                  min={11}
                  max={20}
                  step={1}
                  aria-label="حجم خط الشاشات الرئيسية"
                  data-testid="home-font-size-slider"
                  value={draft.homeFontSize}
                  onChange={(e) => updateField("homeFontSize", Number(e.target.value))}
                />
                <b><bdi>{draft.homeFontSize}px</bdi></b>
              </label>
            </div>
          </div>

          {/* 4. Home Color Presets & Custom Color Pickers */}
          <div className="card-ctrl-group">
            <span className="card-ctrl-label">ألوان الواجهة الرئيسية</span>
            <div className="card-ctrl-palette" role="group" aria-label="قوالب ألوان الواجهة الرئيسية">
              {HOME_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`home-color-preset-${preset.id}`}
                  className={`card-ctrl-preset-chip ${draft.homeColorPreset === preset.id ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    updateFields({
                      homeColorPreset: preset.id,
                      homePrimaryBtnColor: preset.primary,
                      homeSecondaryBtnColor: preset.secondary,
                      homeHeaderColor: preset.header,
                      homeBannerBgColor: preset.bannerBg,
                      homeCanvasBgColor: preset.canvasBg,
                      homeBtnTextColor: preset.btnText,
                    });
                    if (preset.primary) {
                      onChangeBrandColor(preset.primary);
                    }
                  }}
                >
                  <span
                    className="card-ctrl-swatch-dot"
                    style={{ background: preset.swatch }}
                    aria-hidden="true"
                  />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            <div className="card-ctrl-color-grid">
              <label className="card-ctrl-color-cell">
                <span>الأزرار الأساسية</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون الأزرار الأساسية في الرئيسية"
                    value={draft.homePrimaryBtnColor || homeTokens.primaryBg || "#4338ca"}
                    onChange={(e) => {
                      updateFields({
                        homeColorPreset: "custom",
                        homePrimaryBtnColor: e.target.value,
                      });
                      onChangeBrandColor(e.target.value);
                    }}
                  />
                  {draft.homePrimaryBtnColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون الأزرار الأساسية"
                      onClick={() =>
                        updateFields({ homePrimaryBtnColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>الأزرار الثانوية</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون الأزرار الثانوية في الرئيسية"
                    value={draft.homeSecondaryBtnColor || homeTokens.secondaryBg || "#0891b2"}
                    onChange={(e) =>
                      updateFields({
                        homeColorPreset: "custom",
                        homeSecondaryBtnColor: e.target.value,
                      })
                    }
                  />
                  {draft.homeSecondaryBtnColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون الأزرار الثانوية"
                      onClick={() =>
                        updateFields({ homeSecondaryBtnColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>الشريط العلوي</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون الشريط العلوي للرئيسية"
                    value={draft.homeHeaderColor || homeTokens.headerBg || "#312e81"}
                    onChange={(e) =>
                      updateFields({
                        homeColorPreset: "custom",
                        homeHeaderColor: e.target.value,
                      })
                    }
                  />
                  {draft.homeHeaderColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون الشريط العلوي"
                      onClick={() =>
                        updateFields({ homeHeaderColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>بطاقة الشعار</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون بطاقة الشعار في الرئيسية"
                    value={draft.homeBannerBgColor || homeTokens.bannerBg || "#ffffff"}
                    onChange={(e) =>
                      updateFields({
                        homeColorPreset: "custom",
                        homeBannerBgColor: e.target.value,
                      })
                    }
                  />
                  {draft.homeBannerBgColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون بطاقة الشعار"
                      onClick={() =>
                        updateFields({ homeBannerBgColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>خلفية الرئيسية</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون خلفية الواجهة الرئيسية"
                    value={draft.homeCanvasBgColor || homeTokens.canvasBg || "#f8fafc"}
                    onChange={(e) =>
                      updateFields({
                        homeColorPreset: "custom",
                        homeCanvasBgColor: e.target.value,
                      })
                    }
                  />
                  {draft.homeCanvasBgColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون خلفية الرئيسية"
                      onClick={() =>
                        updateFields({ homeCanvasBgColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>نص الأزرار</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون نص وأيقونات أزرار الرئيسية"
                    value={draft.homeBtnTextColor || homeTokens.btnText || "#ffffff"}
                    onChange={(e) =>
                      updateFields({
                        homeColorPreset: "custom",
                        homeBtnTextColor: e.target.value,
                      })
                    }
                  />
                  {draft.homeBtnTextColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون نص الأزرار"
                      onClick={() =>
                        updateFields({ homeBtnTextColor: "", homeColorPreset: "custom" })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* Full Card Size, Shape, Border, Shadow & Color Controls Across All Screens */}
        <section className="settings-appearance-box card-ctrl-section" data-testid="card-appearance-settings">
          <div className="card-ctrl-header">
            <div>
              <div className="settings-subhead">التحكم الكامل في البطائق (الأحجام والألوان والأشكال)</div>
              <p className="card-ctrl-subtitle">ينطبق فورياً على البطائق في الرئيسية، الحسابات، الكشوفات، المخازن، والفواتير.</p>
            </div>
            <button
              type="button"
              className="settings-reset-color-btn"
              onClick={resetCardAppearance}
              data-testid="card-reset-defaults-btn"
            >
              الافتراضي
            </button>
          </div>

          {/* Live Card Preview */}
          <div className="card-ctrl-preview-wrap" aria-label="معاينة مباشرة لشكل البطاقة">
            <article className="card-ctrl-preview-card" data-testid="card-appearance-preview">
              <div className="card-ctrl-preview-badge">ن</div>
              <div className="card-ctrl-preview-body">
                <strong>شركة النور للتوريدات</strong>
                <small>حساب تجاري • حركات: 12</small>
              </div>
              <div className="card-ctrl-preview-amt">
                <b>22,250</b>
                <small>ريال</small>
              </div>
            </article>
          </div>

          {/* 1. Card Size & Spacing */}
          <div className="card-ctrl-group">
            <span className="card-ctrl-label">حجم البطائق والكثافة</span>
            <div className="card-ctrl-segmented" role="group" aria-label="حجم البطائق">
              {CARD_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`card-size-${preset.id}`}
                  className={draft.cardSize === preset.id ? "active" : ""}
                  onClick={() => {
                    triggerHaptic("light");
                    updateFields({
                      cardSize: preset.id,
                      cardPadding: preset.padding,
                      cardGap: preset.gap,
                      cardScale: preset.scale,
                    });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="card-ctrl-sliders">
              <label className="card-ctrl-slider-row">
                <span>الحشو الداخلي</span>
                <input
                  type="range"
                  min={6}
                  max={22}
                  step={1}
                  aria-label="الحشو الداخلي للبطاقة"
                  value={draft.cardPadding}
                  onChange={(e) => updateField("cardPadding", Number(e.target.value))}
                />
                <b><bdi>{draft.cardPadding}px</bdi></b>
              </label>
              <label className="card-ctrl-slider-row">
                <span>تباعد البطائق</span>
                <input
                  type="range"
                  min={4}
                  max={22}
                  step={1}
                  aria-label="المسافة بين البطائق"
                  value={draft.cardGap}
                  onChange={(e) => updateField("cardGap", Number(e.target.value))}
                />
                <b><bdi>{draft.cardGap}px</bdi></b>
              </label>
              <label className="card-ctrl-slider-row">
                <span>مقياس الحجم</span>
                <input
                  type="range"
                  min={85}
                  max={125}
                  step={5}
                  aria-label="مقياس حجم البطاقة"
                  value={draft.cardScale}
                  onChange={(e) => updateField("cardScale", Number(e.target.value))}
                />
                <b><bdi>{draft.cardScale}%</bdi></b>
              </label>
            </div>
          </div>

          {/* 2. Card Shape, Radius, Border & Shadow */}
          <div className="card-ctrl-group">
            <span className="card-ctrl-label">الشكل والزوايا والإطار والظل</span>
            <div className="card-ctrl-segmented" role="group" aria-label="شكل البطاقة">
              {CARD_SHAPE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`card-shape-${preset.id}`}
                  className={draft.cardShape === preset.id ? "active" : ""}
                  onClick={() => {
                    triggerHaptic("light");
                    updateFields({
                      cardShape: preset.id,
                      cardRadius: preset.radius,
                    });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="card-ctrl-sliders">
              <label className="card-ctrl-slider-row">
                <span>استدارة الزوايا</span>
                <input
                  type="range"
                  min={0}
                  max={28}
                  step={1}
                  aria-label="استدارة زوايا البطاقة"
                  value={draft.cardRadius}
                  onChange={(e) => updateField("cardRadius", Number(e.target.value))}
                />
                <b><bdi>{draft.cardRadius}px</bdi></b>
              </label>
            </div>

            <div className="card-ctrl-subrow">
              <span className="card-ctrl-sublabel">نمط الإطار</span>
              <div className="card-ctrl-segmented compact" role="group" aria-label="نمط إطار البطاقة">
                {CARD_BORDER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`card-border-${preset.id}`}
                    className={draft.cardBorderStyle === preset.id ? "active" : ""}
                    onClick={() => {
                      triggerHaptic("light");
                      updateFields({
                        cardBorderStyle: preset.id,
                        cardBorderWidth: preset.width,
                      });
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-ctrl-subrow">
              <span className="card-ctrl-sublabel">شدة الظل</span>
              <div className="card-ctrl-segmented compact" role="group" aria-label="شدة ظل البطاقة">
                {CARD_SHADOW_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`card-shadow-${preset.id}`}
                    className={draft.cardShadow === preset.id ? "active" : ""}
                    onClick={() => {
                      triggerHaptic("light");
                      updateField("cardShadow", preset.id);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Card Color Presets & Custom Pickers */}
          <div className="card-ctrl-group">
            <span className="card-ctrl-label">ألوان البطائق</span>
            <div className="card-ctrl-palette" role="group" aria-label="قوالب ألوان البطائق">
              {CARD_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`card-color-preset-${preset.id}`}
                  className={`card-ctrl-preset-chip ${draft.cardColorPreset === preset.id ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    updateFields({
                      cardColorPreset: preset.id,
                      cardBgColor: preset.bg,
                      cardBorderColor: preset.border,
                      cardTextColor: preset.text,
                      cardAccentColor: preset.accent,
                    });
                  }}
                >
                  <span className="card-ctrl-swatch-dot" style={{ background: preset.swatch }} aria-hidden="true" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            <div className="card-ctrl-color-grid">
              <label className="card-ctrl-color-cell">
                <span>خلفية البطاقة</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون خلفية البطاقة"
                    value={draft.cardBgColor || "#ffffff"}
                    onChange={(e) =>
                      updateFields({ cardColorPreset: "custom", cardBgColor: e.target.value })
                    }
                  />
                  {draft.cardBgColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون الخلفية المخصص"
                      onClick={() => updateFields({ cardBgColor: "", cardColorPreset: "custom" })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>لون الإطار</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون إطار البطاقة"
                    value={draft.cardBorderColor || "#cbd5e1"}
                    onChange={(e) =>
                      updateFields({ cardColorPreset: "custom", cardBorderColor: e.target.value })
                    }
                  />
                  {draft.cardBorderColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون الإطار المخصص"
                      onClick={() => updateFields({ cardBorderColor: "", cardColorPreset: "custom" })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>لون النص</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون نص البطاقة"
                    value={draft.cardTextColor || "#0f172a"}
                    onChange={(e) =>
                      updateFields({ cardColorPreset: "custom", cardTextColor: e.target.value })
                    }
                  />
                  {draft.cardTextColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون النص المخصص"
                      onClick={() => updateFields({ cardTextColor: "", cardColorPreset: "custom" })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="card-ctrl-color-cell">
                <span>لون التمييز</span>
                <div className="card-ctrl-color-input-wrap">
                  <input
                    type="color"
                    aria-label="لون تمييز البطاقة"
                    value={draft.cardAccentColor || brandColor}
                    onChange={(e) =>
                      updateFields({ cardColorPreset: "custom", cardAccentColor: e.target.value })
                    }
                  />
                  {draft.cardAccentColor ? (
                    <button
                      type="button"
                      aria-label="إلغاء لون التمييز المخصص"
                      onClick={() => updateFields({ cardAccentColor: "", cardColorPreset: "custom" })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* Theme, Brand Color, Haptics & Backup Freshness (Preserved Dashboard Controls) */}
        <section className="settings-appearance-box" data-testid="settings-appearance-box">
          <div className="settings-subhead">المظهر ولون العلامة والاهتزاز والنسخ الاحتياطي</div>
          <div className="exec-segmented" role="group" aria-label="وضع الألوان">
            {(
              [
                ["light", "فاتح"],
                ["dark", "داكن"],
                ["system", "النظام"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={themeMode === m ? "active" : ""}
                onClick={() => {
                  triggerHaptic("light");
                  onChangeThemeMode(m);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="exec-color-swatches">
            {BRAND_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`exec-color-swatch ${brandColor === preset.hex ? "active" : ""}`}
                style={{ background: preset.hex }}
                aria-label={preset.label}
                onClick={() => {
                  triggerHaptic("light");
                  onChangeBrandColor(preset.hex);
                }}
              />
            ))}
            <input
              type="color"
              aria-label="لون مخصص للواجهة"
              value={brandColor}
              onChange={(e) => onChangeBrandColor(e.target.value)}
              style={{ width: 28, height: 28, padding: 0, border: 0 }}
            />
            <button
              type="button"
              className="settings-reset-color-btn"
              onClick={() => {
                triggerHaptic("light");
                onResetBrandColor();
                onChangeThemeMode("light");
              }}
            >
              الافتراضي
            </button>
          </div>
          <label className="exec-haptic-toggle">
            <input
              type="checkbox"
              checked={hapticsEnabled}
              onChange={(e) => onChangeHaptics(e.target.checked)}
            />
            <span>تفعيل ردود الفعل اللمسية (الاهتزاز) عند التفاعل</span>
          </label>
          <div
            className={`settings-backup-freshness ${backupStatus.overdue ? "overdue" : "healthy"}`}
            data-testid="settings-backup-banner"
          >
            <strong>
              {backupStatus.overdue
                ? backupStatus.daysSince === null
                  ? "تنبيه: لم يتم أخذ نسخة احتياطية بعد"
                  : `تنبيه: آخر نسخة احتياطية منذ ${backupStatus.daysSince} يومًا`
                : `النسخة الاحتياطية محدثة (منذ ${backupStatus.daysSince ?? 0} يوم)`}
            </strong>
            {lastBackupIso ? (
              <div style={{ fontSize: 11, marginTop: 3 }}>
                آخر تصدير: <bdi>{new Date(lastBackupIso).toLocaleString("en-GB")}</bdi>
              </div>
            ) : null}
          </div>
          <div className="sys-backup-btns">
            <button
              type="button"
              className="ref-btn blue"
              onClick={() => {
                triggerHaptic("light");
                onOpenBackupModal();
              }}
              data-testid="settings-backup-modal-btn"
            >
              حفظ نسخة احتياطية
            </button>
            <button
              type="button"
              className="ref-btn green"
              onClick={() => {
                triggerHaptic("light");
                onRestoreJson();
              }}
            >
              استعادة نسخة من ملف
            </button>
            {onOpenFullSqliteImport ? (
              <button
                type="button"
                className="ref-btn orange"
                style={{ background: "#ea580c", color: "#ffffff" }}
                onClick={() => {
                  triggerHaptic("light");
                  onOpenFullSqliteImport();
                }}
                data-testid="settings-full-sqlite-import-btn"
              >
                إدارة السجلات والنسخ
              </button>
            ) : null}
            {onOpenGoogleDrive ? (
              <button
                type="button"
                className="ref-btn purple"
                onClick={() => {
                  triggerHaptic("light");
                  onOpenGoogleDrive();
                }}
                data-testid="settings-open-drive-btn"
              >
                Google Drive السحابي
              </button>
            ) : null}
          </div>
        </section>

        {/* General & Printing & WhatsApp Toggles */}
        <label className="sys-row sys-check-row">
          <span>رسم التوقيع أسفل الفواتير والسندات</span>
          <input
            type="checkbox"
            checked={draft.drawSignature}
            onChange={(e) => updateField("drawSignature", e.target.checked)}
          />
        </label>

        <label className="sys-row sys-check-row">
          <span>استخدام رسائل الواتساب التلقائية</span>
          <input
            type="checkbox"
            checked={draft.autoWhatsapp}
            onChange={(e) => updateField("autoWhatsapp", e.target.checked)}
          />
        </label>

        <div className="sys-row sys-color-bar-row">
          <input
            type="color"
            aria-label="تلوين التقارير"
            value={draft.reportColor}
            onChange={(e) => updateField("reportColor", e.target.value)}
            className="sys-color-chip"
          />
          <div className="sys-report-color-label">تلوين التقارير</div>
        </div>

        <div className="sys-row sys-font-row">
          <div className="sys-stepper">
            <button
              type="button"
              aria-label="تكبير الخط"
              onClick={() => updateField("fontSize", Math.min(10, draft.fontSize + 1))}
            >
              +
            </button>
            <b>{draft.fontSize}</b>
            <button
              type="button"
              aria-label="تصغير الخط"
              onClick={() => updateField("fontSize", Math.max(1, draft.fontSize - 1))}
            >
              -
            </button>
          </div>
          <span className="sys-blue-label">مقاس الخطوط</span>
          <label className="sys-inline-check">
            <input
              type="checkbox"
              checked={draft.yellowPaper}
              onChange={(e) => updateField("yellowPaper", e.target.checked)}
            />
            <span>ورقة صفراء</span>
          </label>
        </div>

        <div className="sys-row sys-radio-row">
          <span className="sys-blue-label">الطباعة إلى</span>
          <div className="sys-radios" role="radiogroup" aria-label="الطباعة إلى">
            <label>
              <input
                type="radio"
                name="sys-print-target"
                checked={draft.printTarget === "pdf"}
                onChange={() => updateField("printTarget", "pdf")}
              />
              <span>PDF</span>
            </label>
            <label>
              <input
                type="radio"
                name="sys-print-target"
                checked={draft.printTarget === "printer"}
                onChange={() => updateField("printTarget", "printer")}
              />
              <span>الطابعة</span>
            </label>
          </div>
        </div>

        <label className="sys-row sys-check-row">
          <span>التذكير بالنسخ الاحتياطي عند الإغلاق</span>
          <input
            type="checkbox"
            checked={draft.backupReminderOnExit}
            onChange={(e) => updateField("backupReminderOnExit", e.target.checked)}
          />
        </label>

        <div className="sys-row sys-radio-row">
          <span className="sys-blue-label">الواتساب المستخدم</span>
          <div className="sys-radios" role="radiogroup" aria-label="الواتساب المستخدم">
            <label>
              <input
                type="radio"
                name="sys-wa-variant"
                checked={draft.whatsappVariant === "green"}
                onChange={() => updateField("whatsappVariant", "green")}
              />
              <span>الأخضر</span>
            </label>
            <label>
              <input
                type="radio"
                name="sys-wa-variant"
                checked={draft.whatsappVariant === "business"}
                onChange={() => updateField("whatsappVariant", "business")}
              />
              <span>أعمال</span>
            </label>
            <label>
              <input
                type="radio"
                name="sys-wa-variant"
                checked={draft.whatsappVariant === "omar"}
                onChange={() => updateField("whatsappVariant", "omar")}
              />
              <span>عمر</span>
            </label>
          </div>
        </div>

        <label className="sys-row sys-check-row">
          <span>الحماية بكلمة مرور</span>
          <input
            type="checkbox"
            className="account-form-switch"
            role="switch"
            checked={draft.passwordLock}
            onChange={(e) => updateField("passwordLock", e.target.checked)}
          />
        </label>

        {/* Blue Section Banner: Accounts Settings */}
        <div className="sys-section-banner">اعدادات الحسابات</div>

        <div className="sys-row sys-dual-checks">
          <label className="sys-inline-check">
            <span>عرض الرصيد في السند</span>
            <input
              type="checkbox"
              checked={draft.showBalanceInVoucher}
              onChange={(e) => updateField("showBalanceInVoucher", e.target.checked)}
            />
          </label>
          <label className="sys-inline-check">
            <span>عرض وقت السند</span>
            <input
              type="checkbox"
              checked={draft.showTimeInVoucher}
              onChange={(e) => updateField("showTimeInVoucher", e.target.checked)}
            />
          </label>
        </div>

        {(
          [
            ["hideCashboxesOnHome", "إخفاء إجمالي الصناديق في الشاشة الرئيسية"],
            ["hideVoucherSuggestions", "إخفاء اقتراحات تفاصيل السند"],
            ["useReceiptPaymentVoucher", "استخدام سند صرف/قبض"],
            ["useTwoDecimals", "استخدام الفاصل العشري .00"],
            ["showAllCurrenciesToLocal", "عرض خيار جميع العملات إلى عملة محلية"],
            ["hideAllUsersOption", "عدم عرض خيار جميع المستخدمين"],
          ] as const
        ).map(([key, label]) => (
          <label className="sys-row sys-check-row" key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => updateField(key, e.target.checked)}
            />
          </label>
        ))}

        <div className="sys-row sys-dual-checks">
          <label className="sys-inline-check">
            <span>طباعة السندات بـ طابعة حرارية</span>
            <input
              type="checkbox"
              checked={draft.thermalPrintPdf}
              onChange={(e) => updateField("thermalPrintPdf", e.target.checked)}
            />
          </label>
          <span className="sys-inline-tag">PDF</span>
        </div>

        {(
          [
            ["showGeneralEntryOnHome", "إضافة قيد عام إلى الشاشة الرئيسية"],
            ["useNotifMsgInPaymentReq", "استخدام رسالة الإشعارات في طلب السداد"],
            ["showDateInSms", "عرض تاريخ الإرسال في الرسائل النصية"],
            ["showVoucherNoInSms", "عرض رقم السند في الرسائل النصية"],
          ] as const
        ).map(([key, label]) => (
          <label className="sys-row sys-check-row" key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => updateField(key, e.target.checked)}
            />
          </label>
        ))}

        <label className="sys-field-box full">
          <span>ملاحظات أسفل كشف الحساب</span>
          <KeyboardInput
            aria-label="ملاحظات أسفل كشف الحساب"
            value={draft.statementFooterNote}
            onChange={(e) => updateField("statementFooterNote", e.target.value)}
          />
        </label>

        <div className="sys-bilingual-grid">
          <label className="sys-field-box">
            <span>مقدمة الرسالة</span>
            <KeyboardInput
              aria-label="مقدمة الرسالة"
              placeholder="مقدمة الرسالة"
              value={draft.messageIntro}
              onChange={(e) => updateField("messageIntro", e.target.value)}
            />
          </label>
          <label className="sys-field-box">
            <span>ختام الرسالة</span>
            <KeyboardInput
              aria-label="ختام الرسالة"
              placeholder="ختام الرسالة"
              value={draft.messageOutro}
              onChange={(e) => updateField("messageOutro", e.target.value)}
            />
          </label>
          <label className="sys-field-box">
            <span>الرصيد لكم</span>
            <KeyboardInput
              aria-label="مسمى الرصيد لكم"
              value={draft.creditBalanceLabel}
              onChange={(e) => updateField("creditBalanceLabel", e.target.value)}
            />
          </label>
          <label className="sys-field-box">
            <span>الرصيد عليكم</span>
            <KeyboardInput
              aria-label="مسمى الرصيد عليكم"
              value={draft.debitBalanceLabel}
              onChange={(e) => updateField("debitBalanceLabel", e.target.value)}
            />
          </label>
        </div>

        {/* Blue Section Banner: Sales & Purchases Settings */}
        <div className="sys-section-banner">اعدادات المبيعات والمشتريات</div>

        <label className="sys-field-box full">
          <span>ملاحظات أسفل فواتير المبيعات</span>
          <KeyboardInput
            aria-label="ملاحظات أسفل فواتير المبيعات"
            value={draft.salesInvoiceFooterNote}
            onChange={(e) => updateField("salesInvoiceFooterNote", e.target.value)}
          />
        </label>

        <div className="sys-row sys-dual-checks">
          <label className="sys-inline-check">
            <span>بيع بسعر أقل من التكلفة</span>
            <input
              type="checkbox"
              checked={draft.sellBelowCost}
              onChange={(e) => updateField("sellBelowCost", e.target.checked)}
            />
          </label>
          <label className="sys-inline-check">
            <span>بيع بدون رصيد</span>
            <input
              type="checkbox"
              checked={draft.sellWithoutBalance}
              onChange={(e) => updateField("sellWithoutBalance", e.target.checked)}
            />
          </label>
        </div>

        <div className="sys-row sys-radio-row">
          <span className="sys-blue-label">نموذج طباعة الفواتير</span>
          <div className="sys-radios" role="radiogroup" aria-label="نموذج طباعة الفواتير">
            <label>
              <input
                type="radio"
                name="sys-invoice-tpl"
                checked={draft.invoicePrintTemplate === "1"}
                onChange={() => updateField("invoicePrintTemplate", "1")}
              />
              <span>1</span>
            </label>
            <label>
              <input
                type="radio"
                name="sys-invoice-tpl"
                checked={draft.invoicePrintTemplate === "2"}
                onChange={() => updateField("invoicePrintTemplate", "2")}
              />
              <span>2</span>
            </label>
          </div>
        </div>

        {(
          [
            ["hidePriceIn80mm", "عدم طباعة سعر البيع في فواتير mm80"],
            ["useWeightedAverage", "استخدام المتوسط المرجح"],
            ["hideItemCost", "عدم إظهار تكلفة الأصناف"],
            ["showItemsInInvoiceDetails", "عرض الأصناف في تفاصيل الفاتورة"],
            ["hideExpiryInInvoice", "عدم عرض تاريخ الانتهاء في الفاتورة"],
            ["useFreeBonusQty", "استخدام البونص (الكمية المجانية)"],
            ["hidePrintDateInInvoice", "عدم عرض تاريخ الطباعة في الفاتورة"],
            ["useLargestUnitAsMain", "استخدام أكبر وحدة كـ وحدة رئيسية"],
          ] as const
        ).map(([key, label]) => (
          <label className="sys-row sys-check-row" key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => updateField(key, e.target.checked)}
            />
          </label>
        ))}

        <p className="sys-important-note">
          ملاحظة هامة جدًا: لا ينصح بتفعيل هذا الخيار، يتم اختيار هذا الإعداد عندما تستخدم أكبر وحدة كـ وحدة رئيسية، مثلًا تستخدم الكرتون كـ وحدة رئيسية وليس الحبة.
        </p>

        <div className="sys-save-footer">
          <button
            type="button"
            className="ref-btn blue"
            disabled={saving}
            onClick={() => void handleSaveAll()}
            data-testid="system-settings-save-btn"
          >
            {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </button>
          <button
            type="button"
            className="ref-btn purple"
            onClick={() => {
              keyboard.hide();
              onBack();
            }}
          >
            رجوع
          </button>
        </div>
      </main>
    </MobileScroll>
  );
}
