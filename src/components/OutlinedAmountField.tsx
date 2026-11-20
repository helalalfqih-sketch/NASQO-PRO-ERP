import { type ReactNode, type Ref } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { KeyboardInput } from "../mobile/Keyboard";
import { amountToArabicWords, parseArabicNumber } from "../accounting";

export interface OutlinedAmountFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  currency?: string;
  currencySlot?: ReactNode;
  placeholder?: string;
  id?: string;
  testId?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  compact?: boolean;
  showWords?: boolean;
  clearable?: boolean;
  className?: string;
}

export function formatAmountWordsInline(amount: number, currency?: string): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const full = amountToArabicWords(safe, currency || "ريال");
  return full.replace(/\s*فقط لا غير\s*$/, "").trim();
}

export function OutlinedAmountField({
  label,
  value,
  onChange,
  currency,
  currencySlot,
  placeholder = "0",
  id,
  testId,
  ariaLabel,
  ariaInvalid,
  inputRef,
  compact = false,
  showWords = true,
  clearable = true,
  className = "",
}: OutlinedAmountFieldProps) {
  const parsed = parseArabicNumber(value);
  const hasValue = value.trim().length > 0;
  const shouldShowWords = showWords && Boolean(currency);
  const wordsText = shouldShowWords
    ? parsed > 0
      ? formatAmountWordsInline(parsed, currency)
      : ""
    : "";

  return (
    <div className={`outlined-amount-wrap${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}>
      <fieldset
        className={`outlined-amount-box${ariaInvalid ? " invalid" : ""}${hasValue ? " has-value" : ""}`}
      >
        <legend className="outlined-amount-legend">{label}</legend>
        <div className="outlined-amount-inner">
          <KeyboardInput
            ref={inputRef}
            id={id}
            data-testid={testId}
            aria-label={ariaLabel ?? label}
            aria-invalid={ariaInvalid}
            className="outlined-amount-input"
            inputMode="decimal"
            dir="ltr"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {clearable && hasValue ? (
            <button
              type="button"
              className="outlined-amount-clear"
              aria-label={`مسح ${label}`}
              onClick={() => onChange("")}
            >
              <Cross2Icon />
            </button>
          ) : null}
          {currencySlot ? <div className="outlined-amount-currency-slot">{currencySlot}</div> : null}
        </div>
      </fieldset>
      {wordsText ? (
        <div className="outlined-amount-words" data-testid={testId ? `${testId}-words` : undefined}>
          {wordsText}
        </div>
      ) : null}
    </div>
  );
}
