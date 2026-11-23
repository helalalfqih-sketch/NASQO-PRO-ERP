import { parseNormalizedDate } from "./dateUtils.ts";

export type ItemMovementCategory =
  | "purchase"
  | "sale"
  | "purchase_return"
  | "sale_return"
  | "transfer"
  | "adjustment"
  | "other";

export type ItemMovementFilter = "all" | "purchases" | "sales" | "returns" | "transfers";

export type ItemMovementTone =
  | "in"
  | "out"
  | "transfer"
  | "return-in"
  | "return-out"
  | "neutral";

export interface RawItemMovement {
  source: "invoice" | "transfer";
  refId: string;
  entryNumber?: number;
  date: string;
  label: string;
  accountName: string;
  warehouseName: string;
  warehouseId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  quantity: number;
  unit: string;
  unitNum: number;
  baseQuantity: number;
  effectQty: number;
  price: number;
  total: number;
  bonus?: number;
  currency?: string;
  documentNumber?: string;
  details?: string;
  docType?: number | null;
  kind?: string;
}

export interface EnrichedItemMovement extends RawItemMovement {
  category: ItemMovementCategory;
  badgeLabel: string;
  tone: ItemMovementTone;
  runningBalance: number | null;
}

export interface CurrencyTotalBucket {
  currency: string;
  amount: number;
}

export interface ItemMovementSummary {
  totalCount: number;
  purchasesCount: number;
  purchasesQty: number;
  purchasesByCurrency: CurrencyTotalBucket[];
  salesCount: number;
  salesQty: number;
  salesByCurrency: CurrencyTotalBucket[];
  purchaseReturnsCount: number;
  purchaseReturnsQty: number;
  purchaseReturnsByCurrency: CurrencyTotalBucket[];
  saleReturnsCount: number;
  saleReturnsQty: number;
  saleReturnsByCurrency: CurrencyTotalBucket[];
  transfersCount: number;
  transferInQty: number;
  transferOutQty: number;
  transferTotalMovedQty: number;
  adjustmentsCount: number;
  adjustmentsNetQty: number;
  netEffectQty: number;
}

const round2 = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

function normalizeArabicText(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

/**
 * Classifies a single inventory movement into a canonical ERP movement bucket.
 * Prefers structured docType/kind when present, and safely falls back to label + effectQty
 * for older/hybrid payloads that omit optional metadata.
 */
export function classifyItemMovement(mv: RawItemMovement): {
  category: ItemMovementCategory;
  badgeLabel: string;
  tone: ItemMovementTone;
} {
  const normLabel = normalizeArabicText(mv.label);

  if (mv.source === "transfer") {
    if (normLabel.includes("تسويه") || normLabel.includes("جرد")) {
      return {
        category: "adjustment",
        badgeLabel: mv.label || "تسوية / جرد مخزني",
        tone: mv.effectQty > 0 ? "in" : mv.effectQty < 0 ? "out" : "neutral",
      };
    }
    const badgeLabel =
      mv.effectQty > 0
        ? "تحويل وارد"
        : mv.effectQty < 0
          ? "تحويل صادر"
          : mv.label || "تحويل مخزني";
    return {
      category: "transfer",
      badgeLabel,
      tone: "transfer",
    };
  }

  const dt = mv.docType !== undefined && mv.docType !== null ? Number(mv.docType) : null;
  if (dt === 3 || dt === 9) {
    return {
      category: "purchase",
      badgeLabel: mv.label || (dt === 9 ? "مشتريات نقد" : "مشتريات / توريد"),
      tone: "in",
    };
  }
  if (dt === 2 || dt === 7) {
    return {
      category: "sale",
      badgeLabel: mv.label || (dt === 7 ? "مبيعات نقد" : "مبيعات"),
      tone: "out",
    };
  }
  if (dt === 4) {
    return {
      category: "sale_return",
      badgeLabel: mv.label || "مردود مبيعات",
      tone: "return-in",
    };
  }
  if (dt === 5) {
    return {
      category: "purchase_return",
      badgeLabel: mv.label || "مردود مشتريات",
      tone: "return-out",
    };
  }

  const kind = String(mv.kind || "").toLowerCase();
  const isReturn =
    kind === "return" ||
    normLabel.includes("مردود") ||
    normLabel.includes("مرتجع") ||
    normLabel.includes("ارجاع");

  if (isReturn) {
    if (
      normLabel.includes("مبيع") ||
      normLabel.includes("بيع") ||
      (!normLabel.includes("مشتري") && !normLabel.includes("شراء") && mv.effectQty > 0)
    ) {
      return {
        category: "sale_return",
        badgeLabel: mv.label || "مردود مبيعات",
        tone: "return-in",
      };
    }
    return {
      category: "purchase_return",
      badgeLabel: mv.label || "مردود مشتريات",
      tone: "return-out",
    };
  }

  if (
    normLabel.includes("مشتري") ||
    normLabel.includes("شراء") ||
    normLabel.includes("توريد") ||
    normLabel.includes("وارد")
  ) {
    return {
      category: "purchase",
      badgeLabel: mv.label || "مشتريات / توريد",
      tone: "in",
    };
  }

  if (
    normLabel.includes("مبيع") ||
    normLabel.includes("بيع") ||
    normLabel.includes("صرف") ||
    normLabel.includes("منصرف")
  ) {
    return {
      category: "sale",
      badgeLabel: mv.label || "مبيعات",
      tone: "out",
    };
  }

  if (mv.effectQty > 0) {
    return {
      category: "purchase",
      badgeLabel: mv.label || "وارد مخزني",
      tone: "in",
    };
  }
  if (mv.effectQty < 0) {
    return {
      category: "sale",
      badgeLabel: mv.label || "صادر مخزني",
      tone: "out",
    };
  }

  return {
    category: "other",
    badgeLabel: mv.label || "حركة مخزنية",
    tone: "neutral",
  };
}

function addCurrencyAmount(
  map: Map<string, number>,
  currency: string,
  amount: number,
): void {
  const amt = Number(amount ?? 0);
  if (!Number.isFinite(amt) || Math.abs(amt) < 0.0001) return;
  const curr = String(currency || "").trim() || "ريال";
  map.set(curr, round2((map.get(curr) ?? 0) + amt));
}

function toCurrencyBuckets(map: Map<string, number>): CurrencyTotalBucket[] {
  return [...map.entries()].map(([currency, amount]) => ({
    currency,
    amount: round2(amount),
  }));
}

/**
 * Summarizes an item's movements into purchases/supply, sales, returns, transfers, and adjustments.
 * Keeps monetary totals strictly separated by currency so currencies are never mixed.
 */
export function summarizeItemMovements(
  movements: readonly RawItemMovement[],
  fallbackCurrency = "ريال",
): ItemMovementSummary {
  let purchasesCount = 0;
  let purchasesQty = 0;
  const purchasesValMap = new Map<string, number>();

  let salesCount = 0;
  let salesQty = 0;
  const salesValMap = new Map<string, number>();

  let purchaseReturnsCount = 0;
  let purchaseReturnsQty = 0;
  const purchaseReturnsValMap = new Map<string, number>();

  let saleReturnsCount = 0;
  let saleReturnsQty = 0;
  const saleReturnsValMap = new Map<string, number>();

  let transfersCount = 0;
  let transferInQty = 0;
  let transferOutQty = 0;
  let transferTotalMovedQty = 0;

  let adjustmentsCount = 0;
  let adjustmentsNetQty = 0;

  let netEffectQty = 0;

  for (const mv of movements) {
    const { category } = classifyItemMovement(mv);
    const baseQty = Math.abs(Number(mv.baseQuantity ?? mv.quantity ?? 0));
    const effect = Number(mv.effectQty ?? 0);
    const total = Number(mv.total ?? 0);
    const curr = String(mv.currency || "").trim() || fallbackCurrency || "ريال";

    netEffectQty += effect;

    switch (category) {
      case "purchase":
        purchasesCount += 1;
        purchasesQty += baseQty;
        addCurrencyAmount(purchasesValMap, curr, total);
        break;
      case "sale":
        salesCount += 1;
        salesQty += baseQty;
        addCurrencyAmount(salesValMap, curr, total);
        break;
      case "purchase_return":
        purchaseReturnsCount += 1;
        purchaseReturnsQty += baseQty;
        addCurrencyAmount(purchaseReturnsValMap, curr, total);
        break;
      case "sale_return":
        saleReturnsCount += 1;
        saleReturnsQty += baseQty;
        addCurrencyAmount(saleReturnsValMap, curr, total);
        break;
      case "transfer":
        transfersCount += 1;
        transferTotalMovedQty += baseQty;
        if (effect > 0) transferInQty += baseQty;
        else if (effect < 0) transferOutQty += baseQty;
        break;
      case "adjustment":
        adjustmentsCount += 1;
        adjustmentsNetQty += effect;
        break;
      default:
        break;
    }
  }

  return {
    totalCount: movements.length,
    purchasesCount,
    purchasesQty: round2(purchasesQty),
    purchasesByCurrency: toCurrencyBuckets(purchasesValMap),
    salesCount,
    salesQty: round2(salesQty),
    salesByCurrency: toCurrencyBuckets(salesValMap),
    purchaseReturnsCount,
    purchaseReturnsQty: round2(purchaseReturnsQty),
    purchaseReturnsByCurrency: toCurrencyBuckets(purchaseReturnsValMap),
    saleReturnsCount,
    saleReturnsQty: round2(saleReturnsQty),
    saleReturnsByCurrency: toCurrencyBuckets(saleReturnsValMap),
    transfersCount,
    transferInQty: round2(transferInQty),
    transferOutQty: round2(transferOutQty),
    transferTotalMovedQty: round2(transferTotalMovedQty),
    adjustmentsCount,
    adjustmentsNetQty: round2(adjustmentsNetQty),
    netEffectQty: round2(netEffectQty),
  };
}

/**
 * Enriches movements with canonical category metadata and running stock balance after each movement.
 * Movements are returned newest-first. When `currentAvailableQty` is provided, balances are walked
 * backward from the latest available stock so the newest row equals the real current balance.
 */
export function buildItemMovementsLedger(
  movements: readonly RawItemMovement[],
  currentAvailableQty?: number | null,
): EnrichedItemMovement[] {
  const sortedNewestFirst = [...movements].sort((a, b) => {
    const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateDiff !== 0) return dateDiff;
    const numDiff = Number(b.entryNumber ?? 0) - Number(a.entryNumber ?? 0);
    if (numDiff !== 0) return numDiff;
    return String(b.refId || "").localeCompare(String(a.refId || ""));
  });

  if (currentAvailableQty !== undefined && currentAvailableQty !== null && Number.isFinite(currentAvailableQty)) {
    let cursor = round2(currentAvailableQty);
    return sortedNewestFirst.map((mv) => {
      const { category, badgeLabel, tone } = classifyItemMovement(mv);
      const balanceAfterThisMove = round2(cursor);
      cursor = round2(cursor - Number(mv.effectQty ?? 0));
      return {
        ...mv,
        category,
        badgeLabel,
        tone,
        runningBalance: balanceAfterThisMove,
      };
    });
  }

  // Fallback when no current balance is known: walk chronologically oldest-first from 0
  let running = 0;
  const chronological = [...sortedNewestFirst].reverse().map((mv) => {
    const { category, badgeLabel, tone } = classifyItemMovement(mv);
    running = round2(running + Number(mv.effectQty ?? 0));
    return {
      ...mv,
      category,
      badgeLabel,
      tone,
      runningBalance: running,
    };
  });
  return chronological.reverse();
}

export function filterItemMovements(
  movements: readonly EnrichedItemMovement[],
  filter: ItemMovementFilter,
): EnrichedItemMovement[] {
  if (filter === "all") return [...movements];
  if (filter === "purchases") {
    return movements.filter((m) => m.category === "purchase");
  }
  if (filter === "sales") {
    return movements.filter((m) => m.category === "sale");
  }
  if (filter === "returns") {
    return movements.filter(
      (m) => m.category === "purchase_return" || m.category === "sale_return",
    );
  }
  if (filter === "transfers") {
    return movements.filter(
      (m) => m.category === "transfer" || m.category === "adjustment",
    );
  }
  return [...movements];
}

export function formatExpiryStatus(
  expiryDate?: string,
  todayMs?: number,
): {
  displayDate: string;
  statusLabel: string;
  label: string;
  days: number | null;
  tone: "expired" | "soon" | "ok" | "none";
  isLegacyShortYear: boolean;
} {
  const parsedInfo = parseNormalizedDate(expiryDate);
  if (!parsedInfo.display) {
    return {
      displayDate: "",
      statusLabel: "غير محدد",
      label: "غير محدد",
      days: null,
      tone: "none",
      isLegacyShortYear: false,
    };
  }
  if (!parsedInfo.iso) {
    const statusLabel = parsedInfo.isLegacyShortYear ? "صيغة قديمة" : "";
    return {
      displayDate: parsedInfo.display,
      statusLabel,
      label: statusLabel || parsedInfo.display,
      days: null,
      tone: "none",
      isLegacyShortYear: parsedInfo.isLegacyShortYear,
    };
  }
  const parsed = Date.parse(`${parsedInfo.iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return {
      displayDate: parsedInfo.display,
      statusLabel: "",
      label: parsedInfo.display,
      days: null,
      tone: "none",
      isLegacyShortYear: false,
    };
  }
  const refToday =
    todayMs !== undefined && Number.isFinite(todayMs)
      ? todayMs
      : (() => {
          const now = new Date();
          return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        })();
  const days = Math.round((parsed - refToday) / 86_400_000);
  if (days < 0) {
    const statusLabel = `منتهي منذ ${Math.abs(days)} يوم`;
    return {
      displayDate: parsedInfo.display,
      statusLabel,
      label: statusLabel,
      days,
      tone: "expired",
      isLegacyShortYear: false,
    };
  }
  if (days === 0) {
    return {
      displayDate: parsedInfo.display,
      statusLabel: "ينتهي اليوم",
      label: "ينتهي اليوم",
      days: 0,
      tone: "soon",
      isLegacyShortYear: false,
    };
  }
  if (days <= 30) {
    const statusLabel = `متبقي ${days} يوم`;
    return {
      displayDate: parsedInfo.display,
      statusLabel,
      label: statusLabel,
      days,
      tone: "soon",
      isLegacyShortYear: false,
    };
  }
  const statusLabel = `متبقي ${days} يوم`;
  return {
    displayDate: parsedInfo.display,
    statusLabel,
    label: statusLabel,
    days,
    tone: "ok",
    isLegacyShortYear: false,
  };
}
