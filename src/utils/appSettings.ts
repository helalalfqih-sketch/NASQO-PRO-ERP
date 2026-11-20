export type WhatsAppClientVariant = "green" | "business" | "omar";

export type CardSizePreset = "compact" | "normal" | "large" | "xlarge";
export type CardShapePreset = "sharp" | "rounded" | "soft" | "pill";
export type CardShadowPreset = "none" | "soft" | "medium" | "strong";
export type CardBorderStyle = "thin" | "medium" | "accent" | "none";
export type CardColorPreset =
  | "auto"
  | "white"
  | "tinted"
  | "cream"
  | "slate"
  | "emerald"
  | "royal"
  | "custom";

export type HomeButtonStyle = "pill" | "soft" | "tile" | "icon-grid";
export type HomeColumnsMode = "auto" | "1" | "2" | "3";
export type HomeBannerStyle = "card" | "tinted" | "compact" | "hidden";
export type HomeColorPreset =
  | "classic"
  | "emerald"
  | "indigo"
  | "burgundy"
  | "midnight"
  | "slate"
  | "custom";
export type AppFontFamily = "system" | "cairo" | "tajawal" | "ibm-plex" | "almarai" | "amiri";

export interface ExtendedAppSettings {
  usageMode: "sync" | "local";
  syncMode: "auto" | "manual";
  hideAds: boolean;
  logoDataUrl: string;
  companyNameEn: string;
  addressAr: string;
  addressEn: string;
  mobileEn: string;
  taxNumber: string;
  drawSignature: boolean;
  autoWhatsapp: boolean;
  reportColor: string;
  fontSize: number;
  yellowPaper: boolean;
  printTarget: "pdf" | "printer";
  backupReminderOnExit: boolean;
  whatsappVariant: WhatsAppClientVariant;
  passwordLock: boolean;
  showBalanceInVoucher: boolean;
  showTimeInVoucher: boolean;
  hideCashboxesOnHome: boolean;
  hideVoucherSuggestions: boolean;
  useReceiptPaymentVoucher: boolean;
  useTwoDecimals: boolean;
  showAllCurrenciesToLocal: boolean;
  hideAllUsersOption: boolean;
  thermalPrintPdf: boolean;
  showGeneralEntryOnHome: boolean;
  useNotifMsgInPaymentReq: boolean;
  showDateInSms: boolean;
  showVoucherNoInSms: boolean;
  statementFooterNote: string;
  messageIntro: string;
  messageOutro: string;
  creditBalanceLabel: string;
  debitBalanceLabel: string;
  salesInvoiceFooterNote: string;
  sellBelowCost: boolean;
  sellWithoutBalance: boolean;
  invoicePrintTemplate: "1" | "2";
  hidePriceIn80mm: boolean;
  useWeightedAverage: boolean;
  hideItemCost: boolean;
  showItemsInInvoiceDetails: boolean;
  hideExpiryInInvoice: boolean;
  useFreeBonusQty: boolean;
  hidePrintDateInInvoice: boolean;
  useLargestUnitAsMain: boolean;
  // Full card size, shape, border, shadow, and color controls across all screens
  cardSize: CardSizePreset;
  cardPadding: number;
  cardGap: number;
  cardScale: number;
  cardShape: CardShapePreset;
  cardRadius: number;
  cardShadow: CardShadowPreset;
  cardBorderStyle: CardBorderStyle;
  cardBorderWidth: number;
  cardColorPreset: CardColorPreset;
  cardBgColor: string;
  cardBorderColor: string;
  cardTextColor: string;
  cardAccentColor: string;
  // Main home screen layout, button shape, banner, and color controls
  homeButtonStyle: HomeButtonStyle;
  homeColumns: HomeColumnsMode;
  homeBannerStyle: HomeBannerStyle;
  homeButtonRadius: number;
  homeButtonHeight: number;
  homeGridGap: number;
  homeColorPreset: HomeColorPreset;
  homePrimaryBtnColor: string;
  homeSecondaryBtnColor: string;
  homeHeaderColor: string;
  homeBannerBgColor: string;
  homeCanvasBgColor: string;
  homeBtnTextColor: string;
  homeFontFamily: AppFontFamily;
  homeFontSize: number;
}

export const APP_FONT_FAMILY_PRESETS: ReadonlyArray<{
  id: AppFontFamily;
  label: string;
  sample: string;
  cssFamily: string;
}> = [
  {
    id: "ibm-plex",
    label: "رسمي (Plex)",
    sample: "نسقو برو 123",
    cssFamily: '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif',
  },
  {
    id: "tajawal",
    label: "تجوال",
    sample: "نسقو برو 123",
    cssFamily: '"Tajawal", "Segoe UI", Tahoma, Arial, sans-serif',
  },
  {
    id: "system",
    label: "خط النظام",
    sample: "نسقو برو 123",
    cssFamily: '"Segoe UI", Tahoma, Arial, sans-serif',
  },
  {
    id: "cairo",
    label: "القاهرة",
    sample: "نسقو برو 123",
    cssFamily: '"Cairo", "Segoe UI", Tahoma, Arial, sans-serif',
  },
  {
    id: "almarai",
    label: "المرعى",
    sample: "نسقو برو 123",
    cssFamily: '"Almarai", "Segoe UI", Tahoma, Arial, sans-serif',
  },
  {
    id: "amiri",
    label: "أميري كلاسيكي",
    sample: "نسقو برو 123",
    cssFamily: '"Amiri", Georgia, "Times New Roman", serif',
  },
];

export const HOME_FONT_SIZE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  size: number;
}> = [
  { id: "sm", label: "صغير", size: 12 },
  { id: "md", label: "متوسط", size: 14 },
  { id: "lg", label: "كبير", size: 16 },
  { id: "xl", label: "كبير جداً", size: 18 },
];

export const HOME_BUTTON_STYLE_PRESETS: ReadonlyArray<{
  id: HomeButtonStyle;
  label: string;
  radius: number;
  height: number;
}> = [
  { id: "pill", label: "كبسولة", radius: 26, height: 48 },
  { id: "soft", label: "أركان ناعمة", radius: 12, height: 48 },
  { id: "tile", label: "مربع حديث", radius: 14, height: 64 },
  { id: "icon-grid", label: "شبكة أيقونات", radius: 16, height: 62 },
];

export const HOME_COLUMNS_PRESETS: ReadonlyArray<{
  id: HomeColumnsMode;
  label: string;
}> = [
  { id: "auto", label: "تلقائي" },
  { id: "1", label: "عمود واحد" },
  { id: "2", label: "عمودان" },
  { id: "3", label: "3 أعمدة" },
];

export const HOME_BANNER_STYLE_PRESETS: ReadonlyArray<{
  id: HomeBannerStyle;
  label: string;
}> = [
  { id: "card", label: "بطاقة" },
  { id: "tinted", label: "ملوّن" },
  { id: "compact", label: "مضغوط" },
  { id: "hidden", label: "إخفاء" },
];

export const HOME_COLOR_PRESETS: ReadonlyArray<{
  id: HomeColorPreset;
  label: string;
  primary: string;
  secondary: string;
  header: string;
  bannerBg: string;
  canvasBg: string;
  btnText: string;
  swatch: string;
}> = [
  {
    id: "indigo",
    label: "نيلي حديث",
    primary: "#4338ca",
    secondary: "#0891b2",
    header: "#312e81",
    bannerBg: "#eef2ff",
    canvasBg: "#f5f7ff",
    btnText: "#ffffff",
    swatch: "linear-gradient(135deg, #4338ca 50%, #0891b2 50%)",
  },
  {
    id: "classic",
    label: "الكلاسيكي",
    primary: "#0b5ca8",
    secondary: "#ea8c0d",
    header: "#06356b",
    bannerBg: "#ffffff",
    canvasBg: "#f4f7fb",
    btnText: "#ffffff",
    swatch: "linear-gradient(135deg, #0b5ca8 50%, #ea8c0d 50%)",
  },
  {
    id: "emerald",
    label: "زمردي احترافي",
    primary: "#047857",
    secondary: "#d97706",
    header: "#065f46",
    bannerBg: "#ecfdf5",
    canvasBg: "#f2fbf7",
    btnText: "#ffffff",
    swatch: "linear-gradient(135deg, #047857 50%, #d97706 50%)",
  },
  {
    id: "burgundy",
    label: "عنابي دافئ",
    primary: "#9f1239",
    secondary: "#b45309",
    header: "#881337",
    bannerBg: "#fff1f2",
    canvasBg: "#fdf6f7",
    btnText: "#ffffff",
    swatch: "linear-gradient(135deg, #9f1239 50%, #b45309 50%)",
  },
  {
    id: "midnight",
    label: "ليلي أنيق",
    primary: "#1d4ed8",
    secondary: "#0f766e",
    header: "#0f172a",
    bannerBg: "#1e293b",
    canvasBg: "#0b1220",
    btnText: "#f8fafc",
    swatch: "linear-gradient(135deg, #0f172a 50%, #0f766e 50%)",
  },
  {
    id: "slate",
    label: "رمادي عصري",
    primary: "#334155",
    secondary: "#2563eb",
    header: "#1e293b",
    bannerBg: "#ffffff",
    canvasBg: "#f1f5f9",
    btnText: "#ffffff",
    swatch: "linear-gradient(135deg, #334155 50%, #2563eb 50%)",
  },
];

export const CARD_SIZE_PRESETS: ReadonlyArray<{
  id: CardSizePreset;
  label: string;
  padding: number;
  gap: number;
  scale: number;
}> = [
  { id: "compact", label: "صغير", padding: 7, gap: 6, scale: 92 },
  { id: "normal", label: "متوسط", padding: 10, gap: 9, scale: 100 },
  { id: "large", label: "كبير", padding: 14, gap: 12, scale: 108 },
  { id: "xlarge", label: "كبير جداً", padding: 18, gap: 15, scale: 116 },
];

export const CARD_SHAPE_PRESETS: ReadonlyArray<{
  id: CardShapePreset;
  label: string;
  radius: number;
}> = [
  { id: "sharp", label: "حادة", radius: 4 },
  { id: "rounded", label: "دائرية", radius: 12 },
  { id: "soft", label: "ناعمة", radius: 18 },
  { id: "pill", label: "منحنية", radius: 24 },
];

export const CARD_SHADOW_PRESETS: ReadonlyArray<{
  id: CardShadowPreset;
  label: string;
  cssValue: string;
}> = [
  { id: "none", label: "بدون ظل", cssValue: "none" },
  { id: "soft", label: "خفيف", cssValue: "0 2px 7px rgba(11, 56, 107, 0.06)" },
  { id: "medium", label: "متوسط", cssValue: "0 6px 16px rgba(11, 56, 107, 0.11)" },
  { id: "strong", label: "عميق", cssValue: "0 10px 26px rgba(11, 56, 107, 0.18)" },
];

export const CARD_BORDER_PRESETS: ReadonlyArray<{
  id: CardBorderStyle;
  label: string;
  width: number;
}> = [
  { id: "thin", label: "رفيع", width: 1 },
  { id: "medium", label: "سميك", width: 2 },
  { id: "accent", label: "شريط جانبي", width: 1 },
  { id: "none", label: "بدون إطار", width: 0 },
];

export const CARD_COLOR_PRESETS: ReadonlyArray<{
  id: CardColorPreset;
  label: string;
  bg: string;
  border: string;
  text: string;
  accent: string;
  swatch: string;
}> = [
  { id: "auto", label: "تلقائي", bg: "", border: "", text: "", accent: "", swatch: "linear-gradient(135deg, #ffffff 50%, #0f172a 50%)" },
  { id: "white", label: "أبيض ناصع", bg: "#ffffff", border: "#dce5f0", text: "#0f172a", accent: "#0b5ca8", swatch: "#ffffff" },
  { id: "tinted", label: "أزرق هادئ", bg: "#f0f7ff", border: "#bfd7f2", text: "#0b355e", accent: "#0b5ca8", swatch: "#e0efff" },
  { id: "cream", label: "دافئ كريمي", bg: "#fffaf0", border: "#ead8b8", text: "#3b2f1c", accent: "#d97706", swatch: "#fef3c7" },
  { id: "emerald", label: "زمردي ناعم", bg: "#f1fbf6", border: "#b9e4ce", text: "#0b3b2c", accent: "#059669", swatch: "#d1fae5" },
  { id: "slate", label: "رمادي أنيق", bg: "#f4f6f9", border: "#cbd5e1", text: "#1e293b", accent: "#475569", swatch: "#e2e8f0" },
  { id: "royal", label: "ليلي ملكي", bg: "#13233b", border: "#2a456e", text: "#f1f5f9", accent: "#38bdf8", swatch: "#13233b" },
];

export const DEFAULT_EXTENDED_SETTINGS: ExtendedAppSettings = {
  usageMode: "sync",
  syncMode: "auto",
  hideAds: true,
  logoDataUrl: "",
  companyNameEn: "Nasqo Pro Business",
  addressAr: "شارع بينون، صنعاء، اليمن",
  addressEn: "YEMEN SANAA",
  mobileEn: "771370740",
  taxNumber: "",
  drawSignature: true,
  autoWhatsapp: false,
  reportColor: "#4338ca",
  fontSize: 4,
  yellowPaper: false,
  printTarget: "pdf",
  backupReminderOnExit: true,
  whatsappVariant: "business",
  passwordLock: false,
  showBalanceInVoucher: true,
  showTimeInVoucher: true,
  hideCashboxesOnHome: false,
  hideVoucherSuggestions: false,
  useReceiptPaymentVoucher: true,
  useTwoDecimals: false,
  showAllCurrenciesToLocal: false,
  hideAllUsersOption: false,
  thermalPrintPdf: true,
  showGeneralEntryOnHome: true,
  useNotifMsgInPaymentReq: true,
  showDateInSms: true,
  showVoucherNoInSms: false,
  statementFooterNote: "الرصيد صحيح إذا لم تتم المراجعة خلال سبعة أيام من تاريخ صدور الكشف",
  messageIntro: "",
  messageOutro: "",
  creditBalanceLabel: "الرصيد لكم",
  debitBalanceLabel: "الرصيد عليكم",
  salesInvoiceFooterNote: "البضاعة لا ترد إلا في حالة أي خلل مصنعي فقط",
  sellBelowCost: true,
  sellWithoutBalance: true,
  invoicePrintTemplate: "1",
  hidePriceIn80mm: false,
  useWeightedAverage: false,
  hideItemCost: false,
  showItemsInInvoiceDetails: true,
  hideExpiryInInvoice: false,
  useFreeBonusQty: false,
  hidePrintDateInInvoice: false,
  useLargestUnitAsMain: false,
  cardSize: "normal",
  cardPadding: 10,
  cardGap: 9,
  cardScale: 100,
  cardShape: "rounded",
  cardRadius: 12,
  cardShadow: "soft",
  cardBorderStyle: "thin",
  cardBorderWidth: 1,
  cardColorPreset: "auto",
  cardBgColor: "",
  cardBorderColor: "",
  cardTextColor: "",
  cardAccentColor: "",
  homeButtonStyle: "pill",
  homeColumns: "auto",
  homeBannerStyle: "card",
  homeButtonRadius: 26,
  homeButtonHeight: 48,
  homeGridGap: 9,
  homeColorPreset: "indigo",
  homePrimaryBtnColor: "#4338ca",
  homeSecondaryBtnColor: "#0891b2",
  homeHeaderColor: "#312e81",
  homeBannerBgColor: "#eef2ff",
  homeCanvasBgColor: "#f5f7ff",
  homeBtnTextColor: "#ffffff",
  homeFontFamily: "ibm-plex",
  homeFontSize: 14,
};

const EXTENDED_SETTINGS_KEY = "nasqo-extended-settings-v1";
const IBM_PLEX_DEFAULT_MIGRATED_KEY = "nasqo-default-font-ibm-plex-v1";

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== "number" || Number.isNaN(val)) return fallback;
  return Math.min(max, Math.max(min, Math.round(val)));
}

function isValidHexColor(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

export function isDarkHexColor(hex: string): boolean {
  const clean = hex.trim().replace("#", "");
  if (clean.length !== 3 && clean.length !== 6) return false;
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.52;
}

export function normalizeExtendedSettings(parsed?: Partial<ExtendedAppSettings> | null): ExtendedAppSettings {
  const safe = parsed && typeof parsed === "object" ? parsed : {};
  const validStyles: HomeButtonStyle[] = ["pill", "soft", "tile", "icon-grid"];
  const validCols: HomeColumnsMode[] = ["auto", "1", "2", "3"];
  const validBanners: HomeBannerStyle[] = ["card", "tinted", "compact", "hidden"];
  const validFonts: AppFontFamily[] = ["system", "cairo", "tajawal", "ibm-plex", "almarai", "amiri"];
  return {
    ...DEFAULT_EXTENDED_SETTINGS,
    ...safe,
    fontSize: clampNum(safe.fontSize, 1, 12, DEFAULT_EXTENDED_SETTINGS.fontSize),
    cardPadding: clampNum(safe.cardPadding, 6, 22, DEFAULT_EXTENDED_SETTINGS.cardPadding),
    cardGap: clampNum(safe.cardGap, 4, 22, DEFAULT_EXTENDED_SETTINGS.cardGap),
    cardScale: clampNum(safe.cardScale, 85, 125, DEFAULT_EXTENDED_SETTINGS.cardScale),
    cardRadius: clampNum(safe.cardRadius, 0, 28, DEFAULT_EXTENDED_SETTINGS.cardRadius),
    cardBorderWidth: clampNum(safe.cardBorderWidth, 0, 4, DEFAULT_EXTENDED_SETTINGS.cardBorderWidth),
    homeButtonStyle: validStyles.includes(safe.homeButtonStyle as HomeButtonStyle)
      ? (safe.homeButtonStyle as HomeButtonStyle)
      : DEFAULT_EXTENDED_SETTINGS.homeButtonStyle,
    homeColumns: validCols.includes(safe.homeColumns as HomeColumnsMode)
      ? (safe.homeColumns as HomeColumnsMode)
      : DEFAULT_EXTENDED_SETTINGS.homeColumns,
    homeBannerStyle: validBanners.includes(safe.homeBannerStyle as HomeBannerStyle)
      ? (safe.homeBannerStyle as HomeBannerStyle)
      : DEFAULT_EXTENDED_SETTINGS.homeBannerStyle,
    homeButtonRadius: clampNum(safe.homeButtonRadius, 0, 32, DEFAULT_EXTENDED_SETTINGS.homeButtonRadius),
    homeButtonHeight: clampNum(safe.homeButtonHeight, 44, 76, DEFAULT_EXTENDED_SETTINGS.homeButtonHeight),
    homeGridGap: clampNum(safe.homeGridGap, 4, 20, DEFAULT_EXTENDED_SETTINGS.homeGridGap),
    homeFontFamily: validFonts.includes(safe.homeFontFamily as AppFontFamily)
      ? (safe.homeFontFamily as AppFontFamily)
      : DEFAULT_EXTENDED_SETTINGS.homeFontFamily,
    homeFontSize: clampNum(safe.homeFontSize, 11, 20, DEFAULT_EXTENDED_SETTINGS.homeFontSize),
  };
}

export function readExtendedSettings(): ExtendedAppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_EXTENDED_SETTINGS };
  try {
    const raw = window.localStorage.getItem(EXTENDED_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_EXTENDED_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ExtendedAppSettings>;
    const isLegacyUntouchedClassic =
      parsed &&
      parsed.homeColorPreset === "classic" &&
      !parsed.homePrimaryBtnColor &&
      !parsed.homeSecondaryBtnColor &&
      !parsed.homeHeaderColor &&
      !parsed.homeBannerBgColor &&
      !parsed.homeCanvasBgColor &&
      !parsed.homeBtnTextColor;
    const patch: Partial<ExtendedAppSettings> = {};
    if (isLegacyUntouchedClassic) {
      patch.homeColorPreset = DEFAULT_EXTENDED_SETTINGS.homeColorPreset;
      patch.homePrimaryBtnColor = DEFAULT_EXTENDED_SETTINGS.homePrimaryBtnColor;
      patch.homeSecondaryBtnColor = DEFAULT_EXTENDED_SETTINGS.homeSecondaryBtnColor;
      patch.homeHeaderColor = DEFAULT_EXTENDED_SETTINGS.homeHeaderColor;
      patch.homeBannerBgColor = DEFAULT_EXTENDED_SETTINGS.homeBannerBgColor;
      patch.homeCanvasBgColor = DEFAULT_EXTENDED_SETTINGS.homeCanvasBgColor;
      patch.homeBtnTextColor = DEFAULT_EXTENDED_SETTINGS.homeBtnTextColor;
    }
    const fontMigrated = window.localStorage.getItem(IBM_PLEX_DEFAULT_MIGRATED_KEY) === "1";
    if (!fontMigrated) {
      if (
        !parsed.homeFontFamily ||
        parsed.homeFontFamily === "system" ||
        parsed.homeFontFamily === "tajawal"
      ) {
        patch.homeFontFamily = DEFAULT_EXTENDED_SETTINGS.homeFontFamily;
      }
      window.localStorage.setItem(IBM_PLEX_DEFAULT_MIGRATED_KEY, "1");
    }
    const merged = normalizeExtendedSettings({ ...parsed, ...patch });
    if (Object.keys(patch).length > 0) {
      window.localStorage.setItem(EXTENDED_SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return { ...DEFAULT_EXTENDED_SETTINGS };
  }
}

export function writeExtendedSettings(settings: ExtendedAppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXTENDED_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota or storage restrictions
  }
}

export interface ResolvedHomeAppearanceTokens {
  style: HomeButtonStyle;
  columns: HomeColumnsMode;
  bannerStyle: HomeBannerStyle;
  colorPreset: HomeColorPreset;
  fontFamily: AppFontFamily;
  fontFamilyCss: string;
  fontSizePx: string;
  fontScale: string;
  customized: boolean;
  buttonRadiusPx: string;
  buttonHeightPx: string;
  gridGapPx: string;
  primaryBg: string;
  secondaryBg: string;
  headerBg: string;
  bannerBg: string;
  bannerInk: string;
  bannerSubInk: string;
  canvasBg: string;
  btnText: string;
}

export function resolveHomeAppearanceTokens(settings: ExtendedAppSettings): ResolvedHomeAppearanceTokens {
  const normalized = normalizeExtendedSettings(settings);
  const preset = HOME_COLOR_PRESETS.find((p) => p.id === normalized.homeColorPreset);
  const fontPreset =
    APP_FONT_FAMILY_PRESETS.find((f) => f.id === normalized.homeFontFamily) ??
    APP_FONT_FAMILY_PRESETS[0];
  const pick = (customVal: string, presetVal?: string) => {
    const trimmed = customVal.trim();
    if (trimmed && isValidHexColor(trimmed)) return trimmed;
    if (presetVal && isValidHexColor(presetVal)) return presetVal;
    return "";
  };

  const primaryBg = pick(normalized.homePrimaryBtnColor, preset?.primary);
  const secondaryBg = pick(normalized.homeSecondaryBtnColor, preset?.secondary);
  const headerBg = pick(normalized.homeHeaderColor, preset?.header);
  const bannerBg = pick(normalized.homeBannerBgColor, preset?.bannerBg);
  const canvasBg = pick(normalized.homeCanvasBgColor, preset?.canvasBg);
  const btnText = pick(normalized.homeBtnTextColor, preset?.btnText);

  const customized = Boolean(
    primaryBg || secondaryBg || headerBg || bannerBg || canvasBg || btnText,
  );

  let bannerInk = "";
  let bannerSubInk = "";
  if (bannerBg) {
    if (isDarkHexColor(bannerBg)) {
      bannerInk = "#f8fafc";
      bannerSubInk = "#cbd5e1";
    } else {
      bannerInk = primaryBg || "#4338ca";
      bannerSubInk = secondaryBg || "#0891b2";
    }
  }

  const fontScale = Number((normalized.homeFontSize / 14).toFixed(3));

  return {
    style: normalized.homeButtonStyle,
    columns: normalized.homeColumns,
    bannerStyle: normalized.homeBannerStyle,
    colorPreset: normalized.homeColorPreset,
    fontFamily: normalized.homeFontFamily,
    fontFamilyCss: fontPreset.cssFamily,
    fontSizePx: `${normalized.homeFontSize}px`,
    fontScale: String(fontScale),
    customized,
    buttonRadiusPx: `${normalized.homeButtonRadius}px`,
    buttonHeightPx: `${normalized.homeButtonHeight}px`,
    gridGapPx: `${normalized.homeGridGap}px`,
    primaryBg,
    secondaryBg,
    headerBg,
    bannerBg,
    bannerInk,
    bannerSubInk,
    canvasBg,
    btnText,
  };
}

export function applyHomeAppearanceSettings(settings: ExtendedAppSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tokens = resolveHomeAppearanceTokens(settings);

  root.dataset.homeStyle = tokens.style;
  root.dataset.homeColumns = tokens.columns;
  root.dataset.homeBannerStyle = tokens.bannerStyle;
  root.dataset.homeColorPreset = tokens.colorPreset;
  root.dataset.appFont = tokens.fontFamily;

  root.style.setProperty("--nasqo-font-family", tokens.fontFamilyCss);
  root.style.setProperty("--nasqo-home-font-size", tokens.fontSizePx);
  root.style.setProperty("--nasqo-home-font-scale", tokens.fontScale);
  root.style.setProperty("--nasqo-home-btn-radius", tokens.buttonRadiusPx);
  root.style.setProperty("--nasqo-home-btn-height", tokens.buttonHeightPx);
  root.style.setProperty("--nasqo-home-grid-gap", tokens.gridGapPx);

  const setOrClear = (prop: string, val: string) => {
    if (val) root.style.setProperty(prop, val);
    else root.style.removeProperty(prop);
  };

  if (tokens.customized) {
    root.dataset.homeCustomized = "true";
    setOrClear("--nasqo-home-primary-bg", tokens.primaryBg);
    setOrClear("--nasqo-home-secondary-bg", tokens.secondaryBg);
    setOrClear("--nasqo-home-header-bg", tokens.headerBg);
    setOrClear("--nasqo-home-banner-bg", tokens.bannerBg);
    setOrClear("--nasqo-home-banner-ink", tokens.bannerInk);
    setOrClear("--nasqo-home-banner-sub", tokens.bannerSubInk);
    setOrClear("--nasqo-home-canvas-bg", tokens.canvasBg);
    setOrClear("--nasqo-home-btn-text", tokens.btnText);
  } else {
    delete root.dataset.homeCustomized;
    root.style.removeProperty("--nasqo-home-primary-bg");
    root.style.removeProperty("--nasqo-home-secondary-bg");
    root.style.removeProperty("--nasqo-home-header-bg");
    root.style.removeProperty("--nasqo-home-banner-bg");
    root.style.removeProperty("--nasqo-home-banner-ink");
    root.style.removeProperty("--nasqo-home-banner-sub");
    root.style.removeProperty("--nasqo-home-canvas-bg");
    root.style.removeProperty("--nasqo-home-btn-text");
  }
}

export function applyCardAppearanceSettings(settings: ExtendedAppSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const padding = clampNum(settings.cardPadding, 6, 22, DEFAULT_EXTENDED_SETTINGS.cardPadding);
  const gap = clampNum(settings.cardGap, 4, 22, DEFAULT_EXTENDED_SETTINGS.cardGap);
  const scale = clampNum(settings.cardScale, 85, 125, DEFAULT_EXTENDED_SETTINGS.cardScale);
  const radius = clampNum(settings.cardRadius, 0, 28, DEFAULT_EXTENDED_SETTINGS.cardRadius);
  const borderWidth =
    settings.cardBorderStyle === "none"
      ? 0
      : clampNum(settings.cardBorderWidth, 0, 4, DEFAULT_EXTENDED_SETTINGS.cardBorderWidth);

  const shadowInfo =
    CARD_SHADOW_PRESETS.find((p) => p.id === settings.cardShadow) ?? CARD_SHADOW_PRESETS[1];

  root.dataset.cardSize = settings.cardSize || "normal";
  root.dataset.cardShape = settings.cardShape || "rounded";
  root.dataset.cardShadow = settings.cardShadow || "soft";
  root.dataset.cardBorderStyle = settings.cardBorderStyle || "thin";
  root.dataset.cardColorPreset = settings.cardColorPreset || "auto";

  root.style.setProperty("--nasqo-card-padding", `${padding}px`);
  root.style.setProperty("--nasqo-card-gap", `${gap}px`);
  root.style.setProperty("--nasqo-card-scale", (scale / 100).toFixed(2));
  root.style.setProperty("--nasqo-card-radius", `${radius}px`);
  root.style.setProperty("--nasqo-card-border-width", `${borderWidth}px`);
  root.style.setProperty("--nasqo-card-shadow", shadowInfo.cssValue);

  const hasCustomColor =
    settings.cardColorPreset !== "auto" ||
    Boolean(settings.cardBgColor || settings.cardBorderColor || settings.cardTextColor || settings.cardAccentColor);

  if (hasCustomColor) {
    root.dataset.cardCustomized = "true";
    const preset = CARD_COLOR_PRESETS.find((p) => p.id === settings.cardColorPreset);
    const bg = settings.cardBgColor || preset?.bg || "";
    const border = settings.cardBorderColor || preset?.border || "";
    const ink = settings.cardTextColor || preset?.text || "";
    const accent = settings.cardAccentColor || preset?.accent || "";

    if (bg) root.style.setProperty("--nasqo-card-bg", bg);
    else root.style.removeProperty("--nasqo-card-bg");

    if (border) root.style.setProperty("--nasqo-card-border-color", border);
    else root.style.removeProperty("--nasqo-card-border-color");

    if (ink) root.style.setProperty("--nasqo-card-ink", ink);
    else root.style.removeProperty("--nasqo-card-ink");

    if (accent) root.style.setProperty("--nasqo-card-accent", accent);
    else root.style.removeProperty("--nasqo-card-accent");
  } else {
    delete root.dataset.cardCustomized;
    root.style.removeProperty("--nasqo-card-bg");
    root.style.removeProperty("--nasqo-card-border-color");
    root.style.removeProperty("--nasqo-card-ink");
    root.style.removeProperty("--nasqo-card-accent");
  }

  applyHomeAppearanceSettings(settings);
}

