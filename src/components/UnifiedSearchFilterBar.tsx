import { useRef, type ReactNode } from "react";
import { ChevronDownIcon, Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { KeyboardInput, useKeyboard } from "../mobile";
import { formatSearchResultSummary } from "../utils/searchFocusState";

export interface SearchPanelToggle {
  id: string;
  label: string;
  activeCount?: number;
  expanded?: boolean;
  onClick: () => void;
  testId?: string;
  tone?: "default" | "primary" | "accent";
}

export interface UnifiedSearchFilterBarProps {
  query: string;
  onQueryChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  inputTestId?: string;
  matchedCount: number;
  totalCount?: number;
  unitLabel?: string;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onClear?: () => void;
  onExitSearch?: () => void;
  compactSummary?: ReactNode;
  panelToggles?: readonly SearchPanelToggle[];
  expandedPanel?: ReactNode;
  trailingAction?: ReactNode;
  leadingControl?: ReactNode;
  className?: string;
  testId?: string;
  /** When true, hides compactSummary and trailingAction while focused or non-empty query */
  collapseOnSearch?: boolean;
}

export function UnifiedSearchFilterBar({
  query,
  onQueryChange,
  placeholder,
  ariaLabel,
  inputTestId,
  matchedCount,
  totalCount,
  unitLabel = "نتيجة",
  isFocused,
  onFocus,
  onBlur,
  onClear,
  onExitSearch,
  compactSummary,
  panelToggles,
  expandedPanel,
  trailingAction,
  leadingControl,
  className = "",
  testId,
  collapseOnSearch = true,
}: UnifiedSearchFilterBarProps) {
  const keyboard = useKeyboard();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;
  const searchActive = isFocused || hasQuery;
  const hideAux = collapseOnSearch && searchActive;

  const handleClear = () => {
    if (onClear) onClear();
    else onQueryChange("");
    inputRef.current?.focus();
  };

  const handleExit = () => {
    keyboard.hide();
    inputRef.current?.blur();
    if (onExitSearch) onExitSearch();
    else {
      onQueryChange("");
      onBlur();
    }
  };

  return (
    <section
      className={`nasqo-search-dock${searchActive ? " is-search-active" : ""}${className ? ` ${className}` : ""}`}
      data-testid={testId}
      dir="rtl"
    >
      <div className="nasqo-search-row">
        {leadingControl ? <div className="nasqo-search-leading">{leadingControl}</div> : null}
        <div className="nasqo-search-field">
          <MagnifyingGlassIcon className="nasqo-search-icon" aria-hidden="true" />
          <KeyboardInput
            ref={inputRef}
            className="nasqo-search-input"
            aria-label={ariaLabel}
            data-testid={inputTestId}
            placeholder={placeholder}
            value={query}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                keyboard.hide();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                handleExit();
              }
            }}
          />
          {hasQuery ? (
            <span className="nasqo-search-match-count" aria-live="polite">
              <bdi>{matchedCount}</bdi>
            </span>
          ) : null}
          {hasQuery ? (
            <button
              type="button"
              className="nasqo-search-clear-btn"
              aria-label="مسح نص البحث"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
            >
              <Cross2Icon />
            </button>
          ) : null}
        </div>

        {searchActive ? (
          <button
            type="button"
            className="nasqo-search-cancel-btn"
            data-testid={testId ? `${testId}-cancel` : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleExit}
          >
            {hasQuery ? "إلغاء" : "تم"}
          </button>
        ) : trailingAction ? (
          <div className="nasqo-search-trailing">{trailingAction}</div>
        ) : null}
      </div>

      {searchActive ? (
        <div className="nasqo-search-status-line" role="status" aria-live="polite">
          <span>
            {hasQuery
              ? `نتائج البحث: ${formatSearchResultSummary(matchedCount, totalCount, unitLabel)}`
              : `اكتب للبحث الفوري (${formatSearchResultSummary(matchedCount, totalCount, unitLabel)})`}
          </span>
          {panelToggles && panelToggles.some((t) => (t.activeCount ?? 0) > 0) ? (
            <span className="nasqo-search-active-filters-note">
              فلاتر نشطة:{" "}
              {panelToggles.reduce((sum, t) => sum + (t.activeCount ?? 0), 0)}
            </span>
          ) : null}
        </div>
      ) : null}

      {!hideAux && (panelToggles?.length || compactSummary) ? (
        <div className="nasqo-search-aux-strip">
          {panelToggles && panelToggles.length > 0 ? (
            <div className="nasqo-search-toggles" role="toolbar" aria-label="أدوات التصفية والملخص">
              {panelToggles.map((toggle) => (
                <button
                  key={toggle.id}
                  type="button"
                  data-testid={toggle.testId}
                  className={`nasqo-aux-toggle${toggle.expanded ? " is-expanded" : ""}${
                    toggle.tone && toggle.tone !== "default" ? ` tone-${toggle.tone}` : ""
                  }`}
                  aria-expanded={Boolean(toggle.expanded)}
                  onClick={() => {
                    keyboard.hide();
                    toggle.onClick();
                  }}
                >
                  <span>{toggle.label}</span>
                  {toggle.activeCount && toggle.activeCount > 0 ? (
                    <em className="nasqo-aux-count">{toggle.activeCount}</em>
                  ) : null}
                  <ChevronDownIcon className="nasqo-aux-chevron" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
          {compactSummary ? <div className="nasqo-compact-summary">{compactSummary}</div> : null}
        </div>
      ) : null}

      {!hideAux && expandedPanel ? (
        <div className="nasqo-expanded-panel">{expandedPanel}</div>
      ) : null}
    </section>
  );
}
