import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTENDED_SETTINGS,
  HOME_COLOR_PRESETS,
  isDarkHexColor,
  normalizeExtendedSettings,
  resolveHomeAppearanceTokens,
} from "../src/utils/appSettings";
import {
  DEFAULT_HOME_TILE_LAYOUT,
  DEFAULT_HOME_TILE_ORDER,
  getVisibleOrderedHomeTiles,
  isDefaultHomeTileLayout,
  moveHomeTile,
  normalizeHomeTileLayout,
  stepHomeTile,
  toggleHideHomeTile,
  togglePinHomeTile,
  toggleToneHomeTile,
} from "../src/utils/dashboardPrefs";
import {
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  resolveEffectiveTheme,
} from "../src/utils/theme";

test("normalizeExtendedSettings clamps numeric bounds and guards invalid enum values", () => {
  const normalized = normalizeExtendedSettings({
    homeButtonStyle: "invalid" as unknown as "pill",
    homeColumns: "9" as unknown as "2",
    homeBannerStyle: "bad" as unknown as "card",
    homeButtonRadius: 120,
    homeButtonHeight: 12,
    homeGridGap: -5,
  });

  assert.equal(normalized.homeButtonStyle, "pill");
  assert.equal(normalized.homeColumns, "auto");
  assert.equal(normalized.homeBannerStyle, "card");
  assert.equal(normalized.homeButtonRadius, 32);
  assert.equal(normalized.homeButtonHeight, 44);
  assert.equal(normalized.homeGridGap, 4);
});

test("resolveHomeAppearanceTokens uses Modern Indigo (نيلي حديث) as default cleanly", () => {
  const tokens = resolveHomeAppearanceTokens(DEFAULT_EXTENDED_SETTINGS);
  assert.equal(tokens.style, "pill");
  assert.equal(tokens.columns, "auto");
  assert.equal(tokens.bannerStyle, "card");
  assert.equal(tokens.colorPreset, "indigo");
  assert.equal(tokens.customized, true);
  assert.equal(tokens.primaryBg, "#4338ca");
  assert.equal(tokens.secondaryBg, "#0891b2");
  assert.equal(tokens.headerBg, "#312e81");
  assert.equal(tokens.bannerBg, "#eef2ff");
  assert.equal(tokens.canvasBg, "#f5f7ff");
  assert.equal(tokens.btnText, "#ffffff");
  assert.equal(tokens.buttonRadiusPx, "26px");
  assert.equal(tokens.buttonHeightPx, "48px");
  assert.equal(tokens.gridGapPx, "9px");
});

test("resolveHomeAppearanceTokens resolves presets and adapts banner ink contrast", () => {
  const midnightPreset = HOME_COLOR_PRESETS.find((p) => p.id === "midnight");
  assert.ok(midnightPreset);

  const darkTokens = resolveHomeAppearanceTokens({
    ...DEFAULT_EXTENDED_SETTINGS,
    homeButtonStyle: "tile",
    homeColumns: "3",
    homeColorPreset: "midnight",
    homePrimaryBtnColor: "",
    homeSecondaryBtnColor: "",
    homeHeaderColor: "",
    homeBannerBgColor: "",
    homeCanvasBgColor: "",
    homeBtnTextColor: "",
  });
  assert.equal(darkTokens.customized, true);
  assert.equal(darkTokens.style, "tile");
  assert.equal(darkTokens.columns, "3");
  assert.equal(darkTokens.primaryBg, midnightPreset.primary);
  assert.equal(darkTokens.bannerInk, "#f8fafc");

  const lightTokens = resolveHomeAppearanceTokens({
    ...DEFAULT_EXTENDED_SETTINGS,
    homeColorPreset: "emerald",
    homePrimaryBtnColor: "",
    homeSecondaryBtnColor: "",
    homeHeaderColor: "",
    homeBannerBgColor: "",
    homeCanvasBgColor: "",
    homeBtnTextColor: "",
  });
  assert.equal(lightTokens.customized, true);
  assert.equal(lightTokens.bannerInk, "#047857");
});

test("resolveHomeAppearanceTokens allows custom hex overrides and ignores malformed hex values", () => {
  const customTokens = resolveHomeAppearanceTokens({
    ...DEFAULT_EXTENDED_SETTINGS,
    homeColorPreset: "custom",
    homePrimaryBtnColor: "#114488",
    homeSecondaryBtnColor: "not-a-color",
    homeBannerBgColor: "#111827",
  });
  assert.equal(customTokens.customized, true);
  assert.equal(customTokens.primaryBg, "#114488");
  assert.equal(customTokens.secondaryBg, "");
  assert.equal(customTokens.bannerInk, "#f8fafc");
});

test("isDarkHexColor handles 3-digit and 6-digit hex colors", () => {
  assert.equal(isDarkHexColor("#000"), true);
  assert.equal(isDarkHexColor("#0f172a"), true);
  assert.equal(isDarkHexColor("#fff"), false);
  assert.equal(isDarkHexColor("#f8fafc"), false);
});

test("font family and main screen font size normalize and resolve cleanly", () => {
  const defaultTokens = resolveHomeAppearanceTokens(DEFAULT_EXTENDED_SETTINGS);
  assert.equal(defaultTokens.fontFamily, "ibm-plex");
  assert.match(defaultTokens.fontFamilyCss, /"IBM Plex Sans Arabic"/);

  const normalized = normalizeExtendedSettings({
    homeFontFamily: "unknown-font" as unknown as "cairo",
    homeFontSize: 35,
  });
  assert.equal(normalized.homeFontFamily, "ibm-plex");
  assert.equal(normalized.homeFontSize, 20);

  const lowClamped = normalizeExtendedSettings({
    homeFontFamily: "cairo",
    homeFontSize: 4,
  });
  assert.equal(lowClamped.homeFontFamily, "cairo");
  assert.equal(lowClamped.homeFontSize, 11);

  const tokens = resolveHomeAppearanceTokens({
    ...DEFAULT_EXTENDED_SETTINGS,
    homeFontFamily: "amiri",
    homeFontSize: 18,
  });
  assert.equal(tokens.fontFamily, "amiri");
  assert.match(tokens.fontFamilyCss, /"Amiri"/);
  assert.equal(tokens.fontSizePx, "18px");
  assert.equal(tokens.fontScale, "1.286");
});


test("home tile layout normalizes invalid entries, deduplicates ids, and protects settings", () => {
  const normalized = normalizeHomeTileLayout({
    order: ["new-invoice", "new-invoice", "invalid-id" as unknown as "settings", "reports"],
    pinned: ["reports", "settings", "unknown" as unknown as "reports"],
    hidden: ["settings", "reports", "orders" as unknown as "new-order"],
    toneOverrides: {
      reports: "blue",
      "new-order": "invalid" as unknown as "amber",
    },
  });

  assert.equal(normalized.order.length, DEFAULT_HOME_TILE_ORDER.length);
  assert.equal(normalized.order[0], "new-invoice");
  assert.equal(normalized.order[1], "reports");
  // settings cannot be hidden; hidden tile ("reports") is stripped from pinned
  assert.equal(normalized.hidden.includes("settings"), false);
  assert.equal(normalized.hidden.includes("reports"), true);
  assert.equal(normalized.pinned.includes("reports"), false);
  assert.equal(normalized.pinned.includes("settings"), true);
  assert.equal(normalized.toneOverrides.reports, "blue");
  assert.equal(normalized.toneOverrides["new-order"], undefined);
});

test("home tile pin, reorder, step, hide, and tone helpers behave predictably", () => {
  assert.equal(isDefaultHomeTileLayout(DEFAULT_HOME_TILE_LAYOUT), true);

  const pinned = togglePinHomeTile(DEFAULT_HOME_TILE_LAYOUT, "reports");
  assert.equal(isDefaultHomeTileLayout(pinned), false);
  assert.deepEqual(pinned.pinned, ["reports"]);
  const visibleWithPin = getVisibleOrderedHomeTiles(pinned);
  assert.equal(visibleWithPin.pinnedIds[0], "reports");
  assert.equal(visibleWithPin.allVisibleIds[0], "reports");

  // Reorder within unpinned tiles
  const moved = moveHomeTile(pinned, "new-invoice", "new-voucher");
  assert.equal(moved.order.indexOf("new-invoice") < moved.order.indexOf("new-voucher"), true);

  // Step forward/backward inside the visible list
  const stepped = stepHomeTile(DEFAULT_HOME_TILE_LAYOUT, "new-voucher", 1);
  assert.equal(stepped.order[0], "new-transfer");
  assert.equal(stepped.order[1], "new-voucher");

  // Hide and restore; settings remains protected
  const hiddenReports = toggleHideHomeTile(DEFAULT_HOME_TILE_LAYOUT, "reports");
  assert.equal(hiddenReports.hidden.includes("reports"), true);
  assert.equal(getVisibleOrderedHomeTiles(hiddenReports).allVisibleIds.includes("reports"), false);
  const stillHasSettings = toggleHideHomeTile(hiddenReports, "settings");
  assert.equal(stillHasSettings.hidden.includes("settings"), false);
  const restoredReports = toggleHideHomeTile(hiddenReports, "reports");
  assert.equal(restoredReports.hidden.includes("reports"), false);

  // Toggle tone overrides default, second toggle clears override back to default
  const blueReports = toggleToneHomeTile(DEFAULT_HOME_TILE_LAYOUT, "reports", "amber");
  assert.equal(blueReports.toneOverrides.reports, "blue");
  const resetReportsTone = toggleToneHomeTile(blueReports, "reports", "amber");
  assert.equal(resetReportsTone.toneOverrides.reports, undefined);
  assert.equal(isDefaultHomeTileLayout(resetReportsTone), true);
});

test("default theme mode is light (فاتح)", () => {
  assert.equal(DEFAULT_THEME_MODE, "light");
  assert.equal(readStoredThemeMode(), "light");
  assert.equal(resolveEffectiveTheme(DEFAULT_THEME_MODE), "light");
});

