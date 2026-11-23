export interface SearchFocusState {
  query: string;
  isFocused: boolean;
  activePanel: string | null;
}

export function createInitialSearchState(initialQuery = ""): SearchFocusState {
  return {
    query: initialQuery,
    isFocused: false,
    activePanel: null,
  };
}

export function onSearchFocus(state: SearchFocusState): SearchFocusState {
  return {
    ...state,
    isFocused: true,
    activePanel: null,
  };
}

export function onSearchBlur(state: SearchFocusState): SearchFocusState {
  if (!state.isFocused) return state;
  return {
    ...state,
    isFocused: false,
  };
}

export function onSearchQueryChange(state: SearchFocusState, nextQuery: string): SearchFocusState {
  const hasQuery = nextQuery.trim().length > 0;
  return {
    ...state,
    query: nextQuery,
    activePanel: hasQuery ? null : state.activePanel,
  };
}

export function onSearchClear(state: SearchFocusState): SearchFocusState {
  if (!state.query) return state;
  return {
    ...state,
    query: "",
  };
}

export function onSearchExit(): SearchFocusState {
  return {
    query: "",
    isFocused: false,
    activePanel: null,
  };
}

export function onTogglePanel(state: SearchFocusState, panelId: string): SearchFocusState {
  const nextPanel = state.activePanel === panelId ? null : panelId;
  return {
    ...state,
    isFocused: false,
    activePanel: nextPanel,
  };
}

/**
 * True whenever the user is actively focusing the search input or has typed a query.
 * Auxiliary panels (filters, totals, profit basis, add/edit forms) collapse automatically
 * in this mode so matching rows stay visible directly above the mobile keyboard.
 */
export function isSearchActiveMode(state: SearchFocusState): boolean {
  return state.isFocused || state.query.trim().length > 0;
}

/**
 * Counts how many filters currently differ from their default value.
 */
export function countActiveFilters(
  current: Record<string, string | boolean | number | null | undefined>,
  defaults: Record<string, string | boolean | number | null | undefined>,
): number {
  let count = 0;
  for (const key of Object.keys(current)) {
    const val = current[key];
    const def = defaults[key];
    if (val !== def && val !== undefined && val !== null) {
      if (typeof val === "string" && val.trim() === "" && (def === "" || def === undefined || def === null)) {
        continue;
      }
      count += 1;
    }
  }
  return count;
}

export function formatSearchResultSummary(
  matchedCount: number,
  totalCount?: number,
  unitLabel = "نتيجة",
): string {
  const safeMatched = Math.max(0, Math.floor(Number.isFinite(matchedCount) ? matchedCount : 0));
  if (totalCount !== undefined && Number.isFinite(totalCount) && totalCount > safeMatched) {
    return `${safeMatched} من ${Math.max(0, Math.floor(totalCount))} ${unitLabel}`;
  }
  return `${safeMatched} ${unitLabel}`;
}
