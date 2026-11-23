/**
 * Self-contained exact decimal & integer minor-unit financial math engine
 * for server-side SQLite accounting operations (zero runtime imports from `../src/`).
 */

export const DEFAULT_MONEY_DECIMALS = 2;
export const DEFAULT_QTY_DECIMALS = 4;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeNumericString(raw: string | number): string {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
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

export function toMinorUnits(raw: number | string, decimals = DEFAULT_MONEY_DECIMALS): number {
  const parsed = parseExactDecimal(raw);
  if (!parsed) return 0;
  const diff = decimals - parsed.scale;
  const scaled = diff >= 0 ? parsed.value * pow10(diff) : divRoundHalfUp(parsed.value, pow10(-diff));
  return Number(scaled);
}

export function fromMinorUnits(minorUnits: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  if (!Number.isFinite(minorUnits) || minorUnits === 0) return 0;
  return Math.trunc(minorUnits) / 10 ** decimals;
}

export function roundMoney(value: number | string, decimals = DEFAULT_MONEY_DECIMALS): number {
  const parsed = parseExactDecimal(value);
  if (!parsed) return 0;
  const diff = decimals - parsed.scale;
  const scaled = diff >= 0 ? parsed.value * pow10(diff) : divRoundHalfUp(parsed.value, pow10(-diff));
  return Number(scaled) / 10 ** decimals;
}

export function addMoney(a: number, b: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  return fromMinorUnits(toMinorUnits(a, decimals) + toMinorUnits(b, decimals), decimals);
}

export function subMoney(a: number, b: number, decimals = DEFAULT_MONEY_DECIMALS): number {
  return fromMinorUnits(toMinorUnits(a, decimals) - toMinorUnits(b, decimals), decimals);
}

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
  if (scaleAdjust >= 0) num *= pow10(scaleAdjust);
  else den *= pow10(-scaleAdjust);
  return Number(divRoundHalfUp(num, den)) / 10 ** decimals;
}

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
  if (scaleAdjust >= 0) num *= pow10(scaleAdjust);
  else den *= pow10(-scaleAdjust);
  return Number(divRoundHalfUp(num, den)) / 10 ** decimals;
}

export function isStrictlyFiniteNumeric(raw: unknown): boolean {
  if (typeof raw === "number") return Number.isFinite(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    return parseExactDecimal(trimmed) !== null;
  }
  return false;
}
