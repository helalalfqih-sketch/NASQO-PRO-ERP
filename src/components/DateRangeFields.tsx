import { Cross2Icon } from "@radix-ui/react-icons";

export interface DateRangeFieldsProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (next: string) => void;
  onToDateChange: (next: string) => void;
  onClear?: () => void;
  fromLabel?: string;
  toLabel?: string;
  fromTestId?: string;
  toTestId?: string;
  clearTestId?: string;
  className?: string;
}

/**
 * Compact two-input RTL date range pair ("من تاريخ" / "إلى تاريخ") designed
 * to sit inside collapsible filter panels without cluttering narrow screens.
 */
export function DateRangeFields({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onClear,
  fromLabel = "من تاريخ",
  toLabel = "إلى تاريخ",
  fromTestId,
  toTestId,
  clearTestId,
  className = "",
}: DateRangeFieldsProps) {
  const hasDate = Boolean(fromDate.trim() || toDate.trim());

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onFromDateChange("");
      onToDateChange("");
    }
  };

  return (
    <div className={`nasqo-date-range-block${className ? ` ${className}` : ""}`} dir="rtl">
      <div className="nasqo-date-range-grid">
        <label className="nasqo-date-field">
          <span className="nasqo-date-field-label">{fromLabel}</span>
          <input
            type="date"
            aria-label={fromLabel}
            data-testid={fromTestId}
            value={fromDate}
            onChange={(e) => onFromDateChange(e.target.value)}
          />
        </label>
        <label className="nasqo-date-field">
          <span className="nasqo-date-field-label">{toLabel}</span>
          <input
            type="date"
            aria-label={toLabel}
            data-testid={toTestId}
            value={toDate}
            onChange={(e) => onToDateChange(e.target.value)}
          />
        </label>
      </div>
      {hasDate ? (
        <div className="nasqo-date-range-actions">
          <button
            type="button"
            className="nasqo-date-clear-btn"
            data-testid={clearTestId}
            onClick={handleClear}
          >
            <Cross2Icon aria-hidden="true" />
            <span>مسح التاريخ</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
