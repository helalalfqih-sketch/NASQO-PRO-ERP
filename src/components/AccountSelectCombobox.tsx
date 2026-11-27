import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  Cross2Icon,
  MagnifyingGlassIcon,
  PersonIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { KeyboardInput, useKeyboard } from "../mobile";
import { useBackLayer } from "../hybrid/backCoordinator";
import type { AccountCategory, AccountRecord } from "../types";
import {
  filterComboboxAccounts,
  formatAccountOptionMeta,
} from "../utils/accountCombobox";

export interface AccountSelectComboboxProps {
  accounts: readonly AccountRecord[];
  value: string;
  onChange: (accountId: string) => void;
  preferredCategories?: AccountCategory | AccountCategory[];
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noMatchesText?: string;
  ariaLabel: string;
  searchAriaLabel?: string;
  triggerTestId?: string;
  searchTestId?: string;
  listTestId?: string;
  clearTestId?: string;
  addTestId?: string;
  invalid?: boolean;
  compact?: boolean;
  allowClear?: boolean;
  onClear?: () => void;
  onAddAccount?: () => void;
  addAccountAriaLabel?: string;
  leadingAction?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
  maxVisible?: number;
}

export function AccountSelectCombobox({
  accounts,
  value,
  onChange,
  preferredCategories,
  label,
  placeholder = "اختر العميل / الحساب",
  searchPlaceholder = "ابحث بالاسم أو الرقم أو الهاتف...",
  emptyText = "لا توجد حسابات — أضف حسابًا من +",
  noMatchesText = "لا توجد حسابات مطابقة للبحث",
  ariaLabel,
  searchAriaLabel = "البحث عن الحساب",
  triggerTestId,
  searchTestId,
  listTestId,
  clearTestId,
  addTestId,
  invalid = false,
  compact = false,
  allowClear = false,
  onClear,
  onAddAccount,
  addAccountAriaLabel = "إضافة حساب جديد",
  leadingAction,
  triggerRef,
  className,
  maxVisible = 80,
}: AccountSelectComboboxProps) {
  const keyboard = useKeyboard();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  useBackLayer(open, () => {
    keyboard.hide();
    setOpen(false);
    setQuery("");
    setShowAll(false);
    return true;
  }, 200);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const labelId = useId();

  const selectedAccount = useMemo(
    () => accounts.find((acc) => acc.id === value) ?? null,
    [accounts, value],
  );

  const filtered = useMemo(
    () =>
      filterComboboxAccounts(accounts, query, {
        preferredCategories,
        selectedId: value,
        maxVisible,
        showAll,
      }),
    [accounts, query, preferredCategories, value, maxVisible, showAll],
  );

  // Close when clicking or tapping outside the integrated combobox container
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
        setQuery("");
        setShowAll(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
        setShowAll(false);
        keyboard.hide();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, keyboard]);

  // Gently bring the expanded panel into view inside scrollable modals
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const toggleOpen = () => {
    keyboard.hide();
    setOpen((prev) => {
      const next = !prev;
      if (!next) {
        setQuery("");
        setShowAll(false);
      }
      return next;
    });
  };

  const handleSelect = (accountId: string) => {
    onChange(accountId);
    setOpen(false);
    setQuery("");
    setShowAll(false);
    keyboard.hide();
  };

  const handleClearSelection = () => {
    setQuery("");
    setShowAll(false);
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  const selectedMeta = selectedAccount ? formatAccountOptionMeta(selectedAccount) : "";

  return (
    <div
      ref={rootRef}
      className={[
        "nasqo-account-combo",
        open ? "is-open" : "",
        invalid ? "is-invalid" : "",
        compact ? "is-compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      dir="rtl"
    >
      {label ? (
        <span id={labelId} className="nasqo-account-combo-label">
          {label}
        </span>
      ) : null}

      <div className="nasqo-account-combo-row">
        {leadingAction ? (
          <div className="nasqo-account-combo-leading">{leadingAction}</div>
        ) : null}

        {onAddAccount ? (
          <button
            type="button"
            className="nasqo-account-combo-add"
            data-testid={addTestId}
            aria-label={addAccountAriaLabel}
            onClick={() => {
              setOpen(false);
              setQuery("");
              keyboard.hide();
              onAddAccount();
            }}
          >
            <PlusIcon />
          </button>
        ) : null}

        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-labelledby={label ? labelId : undefined}
          data-testid={triggerTestId}
          className={`nasqo-account-combo-trigger ${selectedAccount ? "has-value" : "is-placeholder"}`}
          onClick={toggleOpen}
        >
          <span className="nasqo-account-combo-trigger-icon" aria-hidden="true">
            <PersonIcon />
          </span>
          <span className="nasqo-account-combo-trigger-text">
            <span className="nasqo-account-combo-trigger-name">
              {selectedAccount
                ? selectedAccount.name
                : accounts.length === 0
                  ? emptyText
                  : placeholder}
            </span>
            {selectedMeta ? (
              <span className="nasqo-account-combo-trigger-meta">{selectedMeta}</span>
            ) : null}
          </span>
          <span
            className={`nasqo-account-combo-chevron ${open ? "is-rotated" : ""}`}
            aria-hidden="true"
          >
            <ChevronDownIcon />
          </span>
        </button>

        {allowClear && (value || query) ? (
          <button
            type="button"
            className="nasqo-account-combo-clear-selection"
            data-testid={clearTestId}
            aria-label={`مسح ${ariaLabel}`}
            onClick={handleClearSelection}
          >
            <Cross2Icon />
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          ref={panelRef}
          className="nasqo-account-combo-panel"
          data-testid={listTestId ? `${listTestId}-panel` : undefined}
        >
          <div className="nasqo-account-combo-search-wrap">
            <MagnifyingGlassIcon
              className="nasqo-account-combo-search-icon"
              aria-hidden="true"
            />
            <KeyboardInput
              aria-label={searchAriaLabel}
              data-testid={searchTestId}
              className="nasqo-account-combo-search-input"
              placeholder={searchPlaceholder}
              value={query}
              onFocus={(event) => {
                event.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowAll(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered.visibleOptions.length > 0) {
                  event.preventDefault();
                  handleSelect(filtered.visibleOptions[0].id);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  setQuery("");
                  keyboard.hide();
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="nasqo-account-combo-search-clear"
                aria-label="مسح البحث"
                onClick={() => {
                  setQuery("");
                  setShowAll(false);
                }}
              >
                <Cross2Icon />
              </button>
            ) : null}
          </div>

          <div className="nasqo-account-combo-meta-bar">
            <span>
              {accounts.length === 0
                ? "لا توجد حسابات"
                : query.trim()
                  ? `${filtered.totalMatches} نتيجة مطابقة`
                  : `${accounts.length} حساب`}
            </span>
            <button
              type="button"
              className="nasqo-account-combo-close-text"
              onClick={() => {
                setOpen(false);
                setQuery("");
                setShowAll(false);
                keyboard.hide();
              }}
            >
              إغلاق
            </button>
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            data-testid={listTestId}
            className="nasqo-account-combo-list"
          >
            {accounts.length === 0 ? (
              <div className="nasqo-account-combo-empty">
                <span>{emptyText}</span>
                {onAddAccount ? (
                  <button
                    type="button"
                    className="nasqo-account-combo-empty-add"
                    onClick={() => {
                      setOpen(false);
                      keyboard.hide();
                      onAddAccount();
                    }}
                  >
                    <PlusIcon />
                    <span>إضافة حساب جديد</span>
                  </button>
                ) : null}
              </div>
            ) : filtered.visibleOptions.length === 0 ? (
              <div className="nasqo-account-combo-empty">
                <span>{noMatchesText}</span>
                {onAddAccount ? (
                  <button
                    type="button"
                    className="nasqo-account-combo-empty-add"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      keyboard.hide();
                      onAddAccount();
                    }}
                  >
                    <PlusIcon />
                    <span>إضافة عميل / حساب جديد</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {filtered.visibleOptions.map((acc) => {
                  const isSelected = acc.id === value;
                  const meta = formatAccountOptionMeta(acc);
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-account-id={acc.id}
                      className={`nasqo-account-combo-option ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelect(acc.id)}
                    >
                      <span className="nasqo-account-combo-option-main">
                        <span className="nasqo-account-combo-option-name">{acc.name}</span>
                        {meta ? (
                          <span className="nasqo-account-combo-option-meta">{meta}</span>
                        ) : null}
                      </span>
                      <span className="nasqo-account-combo-option-end">
                        {acc.currency ? (
                          <span className="nasqo-account-combo-option-currency">
                            {acc.currency}
                          </span>
                        ) : null}
                        {isSelected ? (
                          <CheckIcon
                            className="nasqo-account-combo-check"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
                {filtered.truncatedCount > 0 ? (
                  <button
                    type="button"
                    className="nasqo-account-combo-more"
                    onClick={() => setShowAll(true)}
                  >
                    عرض باقي الحسابات (+{filtered.truncatedCount})
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
