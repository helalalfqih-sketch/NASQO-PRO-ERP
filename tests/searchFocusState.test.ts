import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countActiveFilters,
  createInitialSearchState,
  formatSearchResultSummary,
  isSearchActiveMode,
  onSearchBlur,
  onSearchClear,
  onSearchExit,
  onSearchFocus,
  onSearchQueryChange,
  onTogglePanel,
} from "../src/utils/searchFocusState";
import { matchesArabicSearch, normalizeArabicSearch } from "../src/accounting";

describe("searchFocusState", () => {
  it("starts clean with panels collapsed and search inactive", () => {
    const s = createInitialSearchState();
    assert.equal(s.query, "");
    assert.equal(s.isFocused, false);
    assert.equal(s.activePanel, null);
    assert.equal(isSearchActiveMode(s), false);
  });

  it("collapses open filter/totals panels immediately when focusing search", () => {
    let s = createInitialSearchState();
    s = onTogglePanel(s, "filters");
    assert.equal(s.activePanel, "filters");
    assert.equal(isSearchActiveMode(s), false);

    s = onSearchFocus(s);
    assert.equal(s.isFocused, true);
    assert.equal(s.activePanel, null);
    assert.equal(isSearchActiveMode(s), true);
  });

  it("keeps search mode active while query is non-empty even after keyboard blur", () => {
    let s = createInitialSearchState();
    s = onSearchFocus(s);
    s = onSearchQueryChange(s, "خلط");
    s = onSearchBlur(s);
    assert.equal(s.isFocused, false);
    assert.equal(s.query, "خلط");
    assert.equal(isSearchActiveMode(s), true);
  });

  it("exits search mode cleanly and resets query, focus, and panels", () => {
    let s = createInitialSearchState();
    s = onSearchFocus(s);
    s = onSearchQueryChange(s, "مكيف");
    s = onSearchExit();
    assert.equal(s.query, "");
    assert.equal(s.isFocused, false);
    assert.equal(s.activePanel, null);
    assert.equal(isSearchActiveMode(s), false);
  });

  it("toggles panels on/off and dismisses search focus when opening a panel", () => {
    let s = createInitialSearchState();
    s = onSearchFocus(s);
    s = onTogglePanel(s, "totals");
    assert.equal(s.isFocused, false);
    assert.equal(s.activePanel, "totals");

    s = onTogglePanel(s, "totals");
    assert.equal(s.activePanel, null);

    s = onSearchClear(onSearchQueryChange(s, "أرز"));
    assert.equal(s.query, "");
  });

  it("counts only non-default active filters accurately", () => {
    const count = countActiveFilters(
      {
        warehouseId: "wh-1",
        currency: "الكل",
        period: "شهري",
        onlyMoved: true,
        fromDate: "",
      },
      {
        warehouseId: "",
        currency: "الكل",
        period: "الكل",
        onlyMoved: true,
        fromDate: "",
      },
    );
    assert.equal(count, 2);
  });

  it("formats Arabic result counts cleanly", () => {
    assert.equal(formatSearchResultSummary(4, 120, "صنف"), "4 من 120 صنف");
    assert.equal(formatSearchResultSummary(12, 12, "حساب"), "12 حساب");
    assert.equal(formatSearchResultSummary(0, 0, "حركة"), "0 حركة");
  });

  it("normalizes Arabic queries consistently for stock search", () => {
    assert.equal(normalizeArabicSearch("  إبجورة   ١٢٣ "), "ابجوره 123");
    assert.equal(matchesArabicSearch("خلاط كهربائي 500 واط", "خلاط"), true);
    assert.equal(matchesArabicSearch("ابجورة اضاءة شكل قلص", "ابجوره"), true);
  });
});
