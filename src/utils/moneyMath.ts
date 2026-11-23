/**
 * Exact decimal & integer minor-unit financial math engine for NASQO-PRO-ERP.
 *
 * Eliminates IEEE-754 binary floating-point drift (e.g., 0.1 + 0.2 = 0.30000000000000004
 * and Math.round(1.005 * 100) = 100 instead of 101) by performing all monetary
 * operations on scaled BigInt minor units with deterministic Half-Up rounding.
 */

export const DEFAULT_MONEY_DECIMALS = 2;
export const DEFAULT_QTY_DECIMALS = 4;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeNumericString(raw: string | number): string {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    // Normalize scientific notation cleanly (e.g. 1e-7 -> 0.0000001)
    const str = raw.toString();
    if (!/[eE]/.test(str)) return str;
    return expandScientific(str);
  }
  return String(raw)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)))
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
}

function expandScientific(sci: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(sci.trim());
  if (!match) return sci;
  const sign = match[1] === "-" ? "-" : "";
  const intPart = match[2];
  const fracPart = match[3] ?? "";
  const exp = Number(match[4]);
  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  if (pointPos <= 0) {
    return `${sign}0.${"0".repeat(-pointPos)}${digits}`;
  }
  if (pointPos >= digits.length) {
    return `${sign}${digits}${"0".repeat(pointPos - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
}

/**
 * Parses a decimal number or string into an exact { value: bigint, scale: number } pair.
 * Returns null if the input is not a valid finite decimal number.
 */
export function parseExactDecimal(raw: unknown): { value: bigint; scale: number } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
  } else if (typeof raw !== "string") {
    return null;
  }
  let s = normalizeNumericString(raw);
  if (!s) return null;
  if (/[eE]/.test(s)) {
    s = expandScientific(s);
  }
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(s);
  if (!m) return null;
  const neg = m[1] === "-";
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? m[4] ?? "";
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, "") || "0";
  const scale = fracPart.length;
  const big = BigInt(digits);
  return { value: neg && big !== 0n ? -big : big, scale };
}

/**
 * Rounds a BigInt integer numerator / denominator using Half-Up (away from zero on exact ties).
 * Example: 100.5 -> 101, -100.5 -> -101.
 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("القسمة على صفر غير مسموحة في العمليات المالية.");
  }
  let num = numerator;
  let den = denominator;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const neg = num < 0n;
  const absNum = neg ? -num : num;
  const quotient = absNum / den;
  const remainder = absNum % den;
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;
  return neg ? -rounded : rounded;
}

function pow10(exp: number): bigint {
  return 10n ** BigInt(Math.max(0, exp));
}

/**
 * Converts a finite value into integer minor units (e.g. halalas/cents for decimals = 2)
 * using exact decimal parsing and Half-Up rounding.
 */
export function toMinorUnits(raw: number | string, decimals = DEFAULT_MONEY_DECIMALS): number {
  const parsed = parseExactDecimal(raw);
  if (!parsed) return 0;
  const diff = decimals - parsed.scale;
  let scaled: bigint;
  if (diff >= 0) {
    scaled = parsed.value * pow10(diff);
  } else {
    scaled = divRoundHalfUp(parsed.value, pow10(-diff));
  }
  return Number(scaled);
}

/**
 * Converts integer minor units back to a standard JS number with `decimals` places.
 */
export function fromMinorUnits(minorUnits: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  if (!Number.isFinite(minorUnits) || minorUnits === 0) return 0;
  const factor = 10 ** decimals;
  return Math.trunc(minorUnits) / factor;
}

/**
 * Exact Half-Up decimal rounding (default 2 decimal places for currency).
 * Unlike Math.round(v * 100) / 100, roundMoney(1.005) === 1.01 accurately.
 */
export function roundMoney(value: number | string, decimals = DEFAULT_MONEY_DECIMALS): number {
  const parsed = parseExactDecimal(value);
  if (!parsed) return 0;
  const diff = decimals - parsed.scale;
  let scaled: bigint;
  if (diff >= 0) {
    scaled = parsed.value * pow10(diff);
  } else {
    scaled = divRoundHalfUp(parsed.value, pow10(-diff));
  }
  return Number(scaled) / 10 ** decimals;
}

export function addMoney(a: number, b: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  return fromMinorUnits(toMinorUnits(a, decimals) + toMinorUnits(b, decimals), decimals);
}

export function subMoney(a: number, b: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  return fromMinorUnits(toMinorUnits(a, decimals) - toMinorUnits(b, decimals), decimals);
}

export function sumMoney(values: readonly number[], decimals = DEFAULT_MONEY_DECIMALS): number {
  let acc = 0n;
  for (const v of values) {
    acc += BigInt(toMinorUnits(v, decimals));
  }
  return Number(acc) / 10 ** decimals;
}

/**
 * Exact decimal multiplication rounded Half-Up to `decimals` places.
 */
export function mulMoney(a: number | string, b: number | string, decimals = DEFAULT_MONEY_DECIMALS): number {
  const pa = parseExactDecimal(a);
  const pb = parseExactDecimal(b);
  if (!pa || !pb) return 0;
  const product = pa.value * pb.value;
  const totalScale = pa.scale + pb.scale;
  const diff = decimals - totalScale;
  const scaled = diff >= 0 ? product * pow10(diff) : divRoundHalfUp(product, pow10(-diff));
  return Number(scaled) / 10 ** decimals;
}

/**
 * Exact decimal division rounded Half-Up to `decimals` places.
 */
export function divMoney(
  numerator: number | string,
  denominator: number | string,
  decimals = DEFAULT_MONEY_DECIMALS,
): number {
  const pn = parseExactDecimal(numerator);
  const pd = parseExactDecimal(denominator);
  if (!pn || !pd || pd.value === 0n) return 0;
  const scaleAdjust = decimals + pd.scale - pn.scale;
  let num = pn.value;
  let den = pd.value;
  if (scaleAdjust >= 0) {
    num *= pow10(scaleAdjust);
  } else {
    den *= pow10(-scaleAdjust);
  }
  const scaled = divRoundHalfUp(num, den);
  return Number(scaled) / 10 ** decimals;
}

/**
 * Exact invoice line net total: max(0, roundMoney(qty * price) - roundMoney(discount)).
 */
export function computeExactLineNet(
  quantity: number | string,
  price: number | string,
  discount: number | string = 0,
  decimals = DEFAULT_MONEY_DECIMALS,
): number {
  const gross = mulMoney(quantity, price, decimals);
  const disc = Math.max(0, roundMoney(discount, decimals));
  const netMinor = toMinorUnits(gross, decimals) - toMinorUnits(disc, decimals);
  return netMinor > 0 ? fromMinorUnits(netMinor, decimals) : 0;
}

/**
 * Computes Weighted Average Cost (WAC) after an inbound stock addition (purchase / production).
 *
 * Formula: WAC = (max(0, currentQty) * currentAvgCost + addedQty * addedUnitCost) / (max(0, currentQty) + addedQty)
 */
export function computeWeightedAverageCost(
  currentQty: number,
  currentAvgCost: number,
  addedQty: number,
  addedUnitCost: number,
  decimals = DEFAULT_MONEY_DECIMALS,
): number {
  const safeAddedQty = Number.isFinite(addedQty) ? addedQty : 0;
  const safeAddedCost = Number.isFinite(addedUnitCost) && addedUnitCost >= 0 ? addedUnitCost : 0;
  if (safeAddedQty <= 0) {
    return roundMoney(Math.max(0, Number.isFinite(currentAvgCost) ? currentAvgCost : 0), decimals);
  }
  const safeCurQty = Number.isFinite(currentQty) && currentQty > 0 ? currentQty : 0;
  const safeCurCost = Number.isFinite(currentAvgCost) && currentAvgCost >= 0 ? currentAvgCost : 0;

  if (safeCurQty === 0) {
    return roundMoney(safeAddedCost, decimals);
  }

  const pCurQty = parseExactDecimal(safeCurQty)!;
  const pCurCost = parseExactDecimal(safeCurCost)!;
  const pAddQty = parseExactDecimal(safeAddedQty)!;
  const pAddCost = parseExactDecimal(safeAddedCost)!;

  const val1Scale = pCurQty.scale + pCurCost.scale;
  const val2Scale = pAddQty.scale + pAddCost.scale;
  const maxValScale = Math.max(val1Scale, val2Scale);
  const totalValBig =
    pCurQty.value * pCurCost.value * pow10(maxValScale - val1Scale) +
    pAddQty.value * pAddCost.value * pow10(maxValScale - val2Scale);

  const maxQtyScale = Math.max(pCurQty.scale, pAddQty.scale);
  const totalQtyBig =
    pCurQty.value * pow10(maxQtyScale - pCurQty.scale) +
    pAddQty.value * pow10(maxQtyScale - pAddQty.scale);

  if (totalQtyBig <= 0n) {
    return roundMoney(safeAddedCost, decimals);
  }

  const scaleAdjust = decimals + maxQtyScale - maxValScale;
  let num = totalValBig;
  let den = totalQtyBig;
  if (scaleAdjust >= 0) {
    num *= pow10(scaleAdjust);
  } else {
    den *= pow10(-scaleAdjust);
  }
  const scaled = divRoundHalfUp(num, den);
  return Number(scaled) / 10 ** decimals;
}

/**
 * Validates that a raw input is a valid finite number (rejects NaN, Infinity, non-numeric strings).
 */
export function isStrictlyFiniteNumeric(raw: unknown): boolean {
  if (typeof raw === "number") return Number.isFinite(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    return parseExactDecimal(trimmed) !== null;
  }
  return false;
}
