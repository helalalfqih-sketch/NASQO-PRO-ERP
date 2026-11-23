import {
  getCategoryTitle,
  limitSelectAccounts,
  rankAccountSearchMatches,
} from "../accounting";
import type { AccountCategory, AccountRecord } from "../types";

export interface FilteredComboboxResult {
  totalMatches: number;
  visibleOptions: AccountRecord[];
  truncatedCount: number;
}

/**
 * Pure filtering, ranking, and truncation helper for NASQO's integrated
 * customer/account combobox. Keeps the currently selected account visible
 * when no search query is active, and applies Arabic-aware search ranking
 * with optional preferred category boosting.
 */
export function filterComboboxAccounts(
  accounts: readonly AccountRecord[],
  query: string,
  options?: {
    preferredCategories?: AccountCategory | AccountCategory[];
    selectedId?: string;
    maxVisible?: number;
    showAll?: boolean;
  },
): FilteredComboboxResult {
  const trimmed = query.trim();
  const preferredCategories = options?.preferredCategories;
  const ranked = rankAccountSearchMatches(accounts, trimmed, preferredCategories);
  const totalMatches = ranked.length;

  if (options?.showAll || !options?.maxVisible || options.maxVisible <= 0) {
    return {
      totalMatches,
      visibleOptions: ranked,
      truncatedCount: 0,
    };
  }

  const limited = limitSelectAccounts(
    ranked,
    trimmed ? undefined : options.selectedId,
    options.maxVisible,
  );
  return {
    totalMatches,
    visibleOptions: limited.options,
    truncatedCount: limited.truncatedCount,
  };
}

/**
 * Formats compact unboxed inline metadata for a customer/account option
 * (category Arabic label · code number · phone if present).
 */
export function formatAccountOptionMeta(account: AccountRecord): string {
  const parts: string[] = [];
  if (account.category) {
    parts.push(getCategoryTitle(account.category));
  }
  if (Number.isFinite(account.codeNumber) && account.codeNumber > 0) {
    parts.push(`#${account.codeNumber}`);
  }
  if (account.phone && account.phone.trim()) {
    parts.push(account.phone.trim());
  }
  return parts.join(" · ");
}
