import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTENDED_SETTINGS,
  HOME_COLOR_PRESETS,
  isDarkHexColor,
  normalizeExtendedSettings,
  resolveHomeAppearanceTokens,
} from "../src/utils/appSettings";

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

test("resolveHomeAppearanceTokens uses classic uncustomized defaults cleanly", () => {
  const tokens = resolveHomeAppearanceTokens(DEFAULT_EXTENDED_SETTINGS);
  assert.equal(tokens.style, "pill");
  assert.equal(tokens.columns, "auto");
  assert.equal(tokens.bannerStyle, "card");
  assert.equal(tokens.customized, false);
  assert.equal(tokens.primaryBg, "");
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
  });
  assert.equal(darkTokens.customized, true);
  assert.equal(darkTokens.style, "tile");
  assert.equal(darkTokens.columns, "3");
  assert.equal(darkTokens.primaryBg, midnightPreset.primary);
  assert.equal(darkTokens.bannerInk, "#f8fafc");

  const lightTokens = resolveHomeAppearanceTokens({
    ...DEFAULT_EXTENDED_SETTINGS,
    homeColorPreset: "emerald",
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
  const normalized = normalizeExtendedSettings({
    homeFontFamily: "unknown-font" as unknown as "cairo",
    homeFontSize: 35,
  });
  assert.equal(normalized.homeFontFamily, "system");
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

