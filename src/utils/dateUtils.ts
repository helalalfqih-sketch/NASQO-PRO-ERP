const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDateDigits(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)));
}

export function stripLegacyTimeSuffix(raw: string | null | undefined): string {
  const ascii = normalizeDateDigits(raw).trim();
  if (!ascii) return "";
  return ascii
    .replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*(?:ص|م|AM|PM|am|pm|Z|[+-]\d{2}:?\d{2}))?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedDateInfo {
  raw: string;
  cleaned: string;
  display: string;
  iso: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
  isValidGregorian: boolean;
  isLegacyShortYear: boolean;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2150) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseNormalizedDate(raw: string | null | undefined): ParsedDateInfo {
  const original = String(raw ?? "").trim();
  const cleaned = stripLegacyTimeSuffix(original);
  if (!cleaned) {
    return {
      raw: original,
      cleaned: "",
      display: "",
      iso: null,
      year: null,
      month: null,
      day: null,
      isValidGregorian: false,
      isLegacyShortYear: false,
    };
  }

  // 1) YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const ymd = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (isValidCalendarDate(y, m, d)) {
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      return {
        raw: original,
        cleaned,
        display: iso,
        iso,
        year: y,
        month: m,
        day: d,
        isValidGregorian: true,
        isLegacyShortYear: false,
      };
    }
    // Could be a 4-digit Hijri year (e.g. 1447-08-07)
    return {
      raw: original,
      cleaned,
      display: `${y}-${pad2(m)}-${pad2(d)}`,
      iso: null,
      year: y,
      month: m,
      day: d,
      isValidGregorian: false,
      isLegacyShortYear: false,
    };
  }

  // 2) DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy4 = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy4) {
    const a = Number(dmy4[1]);
    const b = Number(dmy4[2]);
    const y = Number(dmy4[3]);
    // Prefer DD/MM/YYYY (standard Arabic/Yemen/GCC format); fallback to MM/DD/YYYY if day > 12 in second position
    let day = a;
    let month = b;
    if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    if (isValidCalendarDate(y, month, day)) {
      const iso = `${y}-${pad2(month)}-${pad2(day)}`;
      return {
        raw: original,
        cleaned,
        display: iso,
        iso,
        year: y,
        month,
        day,
        isValidGregorian: true,
        isLegacyShortYear: false,
      };
    }
    return {
      raw: original,
      cleaned,
      display: `${pad2(a)}/${pad2(b)}/${y}`,
      iso: null,
      year: y,
      month: b,
      day: a,
      isValidGregorian: false,
      isLegacyShortYear: false,
    };
  }

  // 3) Legacy 2-digit year format (e.g. "07/08/47 12:00:00 ص" from Hijri/Access ERP backups)
  const dmy2 = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (dmy2) {
    const p1 = Number(dmy2[1]);
    const p2 = Number(dmy2[2]);
    const yy = Number(dmy2[3]);
    const cleanShort = `${pad2(p1)}/${pad2(p2)}/${pad2(yy)}`;
    return {
      raw: original,
      cleaned,
      display: cleanShort,
      iso: null,
      year: yy,
      month: p2,
      day: p1,
      isValidGregorian: false,
      isLegacyShortYear: true,
    };
  }

  return {
    raw: original,
    cleaned,
    display: cleaned,
    iso: null,
    year: null,
    month: null,
    day: null,
    isValidGregorian: false,
    isLegacyShortYear: false,
  };
}

export function extractIsoDate(raw: string | null | undefined): string | null {
  return parseNormalizedDate(raw).iso;
}

export function formatDisplayDate(raw: string | null | undefined, emptyFallback = "—"): string {
  const parsed = parseNormalizedDate(raw);
  return parsed.display || emptyFallback;
}

export function isWithinDateRange(
  rawDate: string | null | undefined,
  fromDate?: string | null,
  toDate?: string | null,
): boolean {
  const fromIso = extractIsoDate(fromDate);
  const toIso = extractIsoDate(toDate);
  if (!fromIso && !toIso) return true;
  const targetIso = extractIsoDate(rawDate);
  if (!targetIso) return false;
  if (fromIso && targetIso < fromIso) return false;
  if (toIso && targetIso > toIso) return false;
  return true;
}

/**
 * Generates multiple normalized search tokens for a date string so users can
 * search using YYYY-MM-DD, DD/MM/YYYY, D/M/YYYY, YYYY/MM, MM/YYYY, Arabic digits,
 * or legacy short-year formats like 07/08/47.
 */
export function buildDateSearchTokens(rawDate: string | null | undefined): string {
  const parsed = parseNormalizedDate(rawDate);
  if (!parsed.cleaned) return "";
  const tokens = new Set<string>();
  tokens.add(parsed.cleaned);
  if (parsed.display) tokens.add(parsed.display);

  if (parsed.iso && parsed.year !== null && parsed.month !== null && parsed.day !== null) {
    const y = parsed.year;
    const m = parsed.month;
    const d = parsed.day;
    const mm = pad2(m);
    const dd = pad2(d);
    const yy = pad2(y % 100);
    tokens.add(`${y}-${mm}-${dd}`);
    tokens.add(`${y}/${mm}/${dd}`);
    tokens.add(`${dd}/${mm}/${y}`);
    tokens.add(`${dd}-${mm}-${y}`);
    tokens.add(`${d}/${m}/${y}`);
    tokens.add(`${dd}/${mm}/${yy}`);
    tokens.add(`${y}-${mm}`);
    tokens.add(`${y}/${mm}`);
    tokens.add(`${mm}/${y}`);
    tokens.add(`${mm}-${y}`);
  } else if (parsed.isLegacyShortYear && parsed.day !== null && parsed.month !== null && parsed.year !== null) {
    const dd = pad2(parsed.day);
    const mm = pad2(parsed.month);
    const yy = pad2(parsed.year);
    tokens.add(`${dd}/${mm}/${yy}`);
    tokens.add(`${dd}-${mm}-${yy}`);
    tokens.add(`${parsed.day}/${parsed.month}/${yy}`);
    tokens.add(`${mm}/${yy}`);
  }

  return [...tokens].join(" ");
}

const LRI = "\u2066";
const PDI = "\u2069";
const isolateLtr = (value: string) => `${LRI}${value}${PDI}`;

export function formatDateRangeLabel(
  fromDate?: string | null,
  toDate?: string | null,
): string {
  const from = formatDisplayDate(fromDate, "");
  const to = formatDisplayDate(toDate, "");
  if (from && to) {
    return from === to
      ? `التاريخ: ${isolateLtr(from)}`
      : `الفترة: ${isolateLtr(from)} ← ${isolateLtr(to)}`;
  }
  if (from) return `من ${isolateLtr(from)}`;
  if (to) return `حتى ${isolateLtr(to)}`;
  return "";
}

export function countActiveDateBounds(
  fromDate?: string | null,
  toDate?: string | null,
): number {
  return (fromDate?.trim() ? 1 : 0) + (toDate?.trim() ? 1 : 0);
}
