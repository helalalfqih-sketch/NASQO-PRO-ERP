/**
 * Pure analysis of the legacy tables: documents, evidence for document types, voucher grouping,
 * reconciliation status and the (policy-gated) posting plan.
 *
 * Nothing here guesses accounting semantics silently:
 *  - roles of `bill_type` values are SUGGESTIONS built from measurable evidence and stay
 *    "unconfirmed" until the user approves them;
 *  - the meaning of dain/madin (credit/debit) is NEVER defaulted: posting needs an explicit policy;
 *  - only vouchers that belong to a verified balanced group can be posted.
 */
import type { Row, Tables } from "./adapter";

export const TOLERANCE = 0.005;

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function normalizeName(value: unknown): string {
  return text(value)
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isoDate(row: Row): string | null {
  const y = Number(row.year);
  const m = Number(row.month);
  const d = Number(row.day);
  if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const nd = text(row.ndate);
  if (/^\d{8}$/.test(nd) && nd !== "00000000") {
    return `${nd.slice(0, 4)}-${nd.slice(4, 6)}-${nd.slice(6, 8)}`;
  }
  return null;
}

/* ------------------------------------------------------------------ roles / evidence */

export type DocumentRole =
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "free_sale"
  | "free_purchase"
  | "voucher"
  | "unknown";

export const ROLE_LABELS: Record<DocumentRole, string> = {
  sale: "فاتورة بيع",
  purchase: "فاتورة شراء",
  sale_return: "مردود بيع",
  purchase_return: "مردود شراء",
  free_sale: "فاتورة بيع حرة البنود",
  free_purchase: "فاتورة شراء حرة البنود",
  voucher: "سند / قيد حساب",
  unknown: "غير محدد",
};

export type BillTypeEvidence = {
  billType: number;
  rows: number;
  deletedRows: number;
  withPricedLines: number;
  withFreeLines: number;
  /** which header field equals the sum of the document lines */
  totalSide: "dain" | "madin" | "mixed" | "none";
  sideMatchedRows: number;
  comparedRows: number;
  priceEqualsProductPrice: number;
  priceEqualsProductPrice2: number;
  oneSidedRows: number;
  equalSidedRows: number;
  otherSidedRows: number;
  topAccountGroups: { groupId: number; groupName: string; count: number }[];
  suggestedRole: DocumentRole;
  basis: string[];
};

type LinesIndex = { priced: Map<string, Row[]>; free: Map<string, Row[]> };

function indexLines(tables: Tables, pricedTable: string, freeTable: string): LinesIndex {
  const group = (rows: Row[] | undefined) => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = String(r.bill_id);
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    return map;
  };
  return { priced: group(tables[pricedTable]), free: group(tables[freeTable]) };
}

function lineTotal(rows: Row[]): number | null {
  let sum = 0;
  for (const r of rows) {
    const v = num(r.total);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export function billTypeEvidence(tables: Tables): BillTypeEvidence[] {
  const live = indexLines(tables, "bill_details", "bill_details2");
  const del = indexLines(tables, "bin_bill_details", "bin_bill_details2");
  const products = new Map((tables.products ?? []).map((p) => [String(p.id), p]));
  const customers = new Map((tables.customers ?? []).map((c) => [String(c.id), c]));
  const groups = new Map((tables.boxes ?? []).map((b) => [Number(b.id), text(b.name)]));

  type Acc = BillTypeEvidence & { groupCounts: Map<number, number>; priceLines: number };
  const byType = new Map<number, Acc>();
  const acc = (t: number): Acc => {
    let a = byType.get(t);
    if (!a) {
      a = {
        billType: t, rows: 0, deletedRows: 0, withPricedLines: 0, withFreeLines: 0,
        totalSide: "none", sideMatchedRows: 0, comparedRows: 0,
        priceEqualsProductPrice: 0, priceEqualsProductPrice2: 0,
        oneSidedRows: 0, equalSidedRows: 0, otherSidedRows: 0,
        topAccountGroups: [], suggestedRole: "unknown", basis: [],
        groupCounts: new Map(), priceLines: 0,
      };
      byType.set(t, a);
    }
    return a;
  };
  const sideVotes = new Map<number, { dain: number; madin: number; compared: number }>();

  const scan = (moves: Row[], lines: LinesIndex, deleted: boolean) => {
    for (const m of moves) {
      const t = Number(m.bill_type);
      const a = acc(t);
      if (deleted) a.deletedRows += 1;
      else a.rows += 1;
      const dain = num(m.dain);
      const madin = num(m.madin);
      if (dain !== null && madin !== null) {
        if (dain > 0 && madin > 0) {
          if (Math.abs(dain - madin) < TOLERANCE) a.equalSidedRows += 1;
          else a.otherSidedRows += 1;
        } else if (dain > 0 || madin > 0) a.oneSidedRows += 1;
      }
      const cust = customers.get(String(m.per_id));
      if (cust && !deleted) a.groupCounts.set(Number(cust.type), (a.groupCounts.get(Number(cust.type)) ?? 0) + 1);

      const pricedLines = lines.priced.get(String(m.id));
      const freeLines = lines.free.get(String(m.id));
      if (pricedLines?.length) a.withPricedLines += 1;
      if (freeLines?.length) a.withFreeLines += 1;
      const ls = pricedLines?.length ? pricedLines : freeLines;
      if (!deleted && ls?.length && dain !== null && madin !== null) {
        const total = lineTotal(ls);
        if (total !== null) {
          const v = sideVotes.get(t) ?? { dain: 0, madin: 0, compared: 0 };
          v.compared += 1;
          if (Math.abs(total - dain) < 0.01) v.dain += 1;
          if (Math.abs(total - madin) < 0.01) v.madin += 1;
          sideVotes.set(t, v);
        }
      }
      if (!deleted && pricedLines?.length) {
        for (const l of pricedLines) {
          const p = products.get(String(l.prod_id));
          const lp = num(l.price);
          if (!p || lp === null) continue;
          a.priceLines += 1;
          if (Math.abs(lp - (num(p.price) ?? NaN)) < 0.005) a.priceEqualsProductPrice += 1;
          if (Math.abs(lp - (num(p.price2) ?? NaN)) < 0.005) a.priceEqualsProductPrice2 += 1;
        }
      }
    }
  };
  scan(tables.input_move ?? [], live, false);
  scan(tables.bin ?? [], del, true);

  const list = [...byType.values()].sort((a, b) => a.billType - b.billType);
  for (const a of list) {
    const v = sideVotes.get(a.billType);
    a.comparedRows = v?.compared ?? 0;
    if (v && v.compared > 0) {
      const dRatio = v.dain / v.compared;
      const mRatio = v.madin / v.compared;
      if (dRatio >= 0.95 && mRatio < 0.95) { a.totalSide = "dain"; a.sideMatchedRows = v.dain; }
      else if (mRatio >= 0.95 && dRatio < 0.95) { a.totalSide = "madin"; a.sideMatchedRows = v.madin; }
      else if (dRatio >= 0.95 && mRatio >= 0.95) { a.totalSide = "mixed"; a.sideMatchedRows = v.compared; }
      else { a.totalSide = "mixed"; a.sideMatchedRows = Math.max(v.dain, v.madin); }
    }
    a.topAccountGroups = [...a.groupCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([groupId, count]) => ({ groupId, groupName: groups.get(groupId) ?? `مجموعة ${groupId}`, count }));
  }

  // Reference "sale" side: the priced type whose lines use the product's first price the most.
  const priced = list.filter((a) => a.withPricedLines > 0 && (a.totalSide === "dain" || a.totalSide === "madin"));
  const reference = [...priced].sort(
    (a, b) => (b.priceEqualsProductPrice - b.priceEqualsProductPrice2) - (a.priceEqualsProductPrice - a.priceEqualsProductPrice2),
  )[0];
  const saleSide = reference && reference.priceEqualsProductPrice > reference.priceEqualsProductPrice2 ? reference.totalSide : null;

  for (const a of list) {
    const basis: string[] = [];
    const hasLines = a.withPricedLines + a.withFreeLines > 0;
    if (!hasLines) {
      a.suggestedRole = "voucher";
      basis.push("لا توجد بنود مرتبطة بهذا النوع في bill_details أو bill_details2.");
      a.basis = basis;
      continue;
    }
    if (a.totalSide === "dain" || a.totalSide === "madin") {
      basis.push(`مجموع بنود المستند يطابق الحقل ${a.totalSide} في ${a.sideMatchedRows} من ${a.comparedRows} مستندًا.`);
    }
    if (saleSide === null || (a.totalSide !== "dain" && a.totalSide !== "madin")) {
      a.suggestedRole = "unknown";
      basis.push("الأدلة غير كافية لاقتراح دور محاسبي.");
      a.basis = basis;
      continue;
    }
    if (a.withPricedLines > 0) {
      const sellLike = a.priceEqualsProductPrice > a.priceEqualsProductPrice2;
      basis.push(`سعر البند يساوي price في الصنف ${a.priceEqualsProductPrice} مرة، ويساوي price2 ${a.priceEqualsProductPrice2} مرة (من ${a.priceLines} بندًا).`);
      const onSaleSide = a.totalSide === saleSide;
      a.suggestedRole = sellLike ? (onSaleSide ? "sale" : "sale_return") : (onSaleSide ? "purchase_return" : "purchase");
    } else {
      basis.push("بنود حرة بلا ربط بالأصناف؛ الاقتراح مبني على جهة المجموع فقط.");
      a.suggestedRole = a.totalSide === saleSide ? "free_sale" : "free_purchase";
    }
    const top = a.topAccountGroups[0];
    if (top) basis.push(`أكثر حسابات هذا النوع تنتمي للمجموعة «${top.groupName}» (${top.count}).`);
    a.basis = basis;
  }
  return list.map(({ groupCounts: _g, priceLines: _p, ...rest }) => rest);
}

export type RoleMapping = Record<string, { role: DocumentRole; confirmed: boolean }>;

export function suggestedRoleMapping(evidence: BillTypeEvidence[]): RoleMapping {
  const mapping: RoleMapping = {};
  for (const e of evidence) mapping[String(e.billType)] = { role: e.suggestedRole, confirmed: false };
  return mapping;
}

/* ------------------------------------------------------------------ documents */

export type InvoiceLine = {
  ref: string;
  table: string;
  id: number;
  productId: number | null;
  productName: string;
  description: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  total: number | null;
  storeId: number | null;
  kind: "priced" | "free";
};

export type LegacyInvoice = {
  id: number;
  table: "input_move" | "bin";
  billType: number;
  role: DocumentRole;
  roleConfirmed: boolean;
  personId: number | null;
  personName: string;
  date: string | null;
  documentNumber: string;
  details: string;
  currencyId: number | null;
  currencyName: string;
  headerDain: number | null;
  headerMadin: number | null;
  totalSide: "dain" | "madin" | null;
  originalTotal: number | null;
  linesTotal: number | null;
  lines: InvoiceLine[];
  match: "matches_header" | "mismatch" | "no_lines";
  deleted: boolean;
  postingStatus: "historical_unposted";
};

export type DocumentContext = {
  customers: Map<string, Row>;
  products: Map<string, Row>;
  currencies: Map<string, Row>;
  evidence: Map<number, BillTypeEvidence>;
  roles: RoleMapping;
};

export function documentContext(tables: Tables, roles: RoleMapping, evidence: BillTypeEvidence[]): DocumentContext {
  return {
    customers: new Map((tables.customers ?? []).map((c) => [String(c.id), c])),
    products: new Map((tables.products ?? []).map((p) => [String(p.id), p])),
    currencies: new Map((tables.currencies ?? []).map((c) => [String(c.id), c])),
    evidence: new Map(evidence.map((e) => [e.billType, e])),
    roles,
  };
}

export function composeInvoice(
  move: Row,
  table: "input_move" | "bin",
  pricedRows: Row[],
  freeRows: Row[],
  ctx: DocumentContext,
): LegacyInvoice {
  const billType = Number(move.bill_type);
  const lines: InvoiceLine[] = [];
  const linePrefix = table === "bin" ? "bin_" : "";
  for (const r of pricedRows) {
    const product = ctx.products.get(String(r.prod_id));
    lines.push({
      ref: `${linePrefix}bill_details:${r.id}`,
      table: `${linePrefix}bill_details`,
      id: Number(r.id),
      productId: r.prod_id === null || r.prod_id === undefined ? null : Number(r.prod_id),
      productName: product ? text(product.name) : "",
      description: text(r.details),
      unit: text(r.unit),
      quantity: num(r.amount),
      unitPrice: num(r.price),
      discount: num(r.discount),
      total: num(r.total),
      storeId: r.store_id === null || r.store_id === undefined ? null : Number(r.store_id),
      kind: "priced",
    });
  }
  for (const r of freeRows) {
    lines.push({
      ref: `${linePrefix}bill_details2:${r.id}`,
      table: `${linePrefix}bill_details2`,
      id: Number(r.id),
      productId: null,
      productName: "",
      description: text(r.details),
      unit: text(r.unit),
      quantity: num(r.amount),
      unitPrice: num(r.price),
      discount: num(r.discount),
      total: num(r.total),
      storeId: null,
      kind: "free",
    });
  }
  const dain = num(move.dain);
  const madin = num(move.madin);
  const evidence = ctx.evidence.get(billType);
  const totalSide = evidence && (evidence.totalSide === "dain" || evidence.totalSide === "madin") ? evidence.totalSide : null;
  const linesTotal = lines.length ? lineTotal([...pricedRows, ...freeRows]) : null;
  const headerOnSide = totalSide === "dain" ? dain : totalSide === "madin" ? madin : null;
  let match: LegacyInvoice["match"] = "no_lines";
  if (lines.length) {
    match = linesTotal !== null && headerOnSide !== null && Math.abs(linesTotal - headerOnSide) < 0.01 ? "matches_header" : "mismatch";
  }
  const person = ctx.customers.get(String(move.per_id));
  const currency = ctx.currencies.get(String(move.cur));
  const mapped = ctx.roles[String(billType)];
  return {
    id: Number(move.id),
    table,
    billType,
    role: mapped?.role ?? "unknown",
    roleConfirmed: mapped?.confirmed ?? false,
    personId: move.per_id === null || move.per_id === undefined ? null : Number(move.per_id),
    personName: person ? text(person.name) : text(move.pername),
    date: isoDate(move),
    documentNumber: text(move.bill),
    details: text(move.details),
    currencyId: move.cur === null || move.cur === undefined ? null : Number(move.cur),
    currencyName: currency ? text(currency.name) : text(move.curname),
    headerDain: dain,
    headerMadin: madin,
    totalSide,
    originalTotal: headerOnSide,
    linesTotal,
    lines,
    match,
    deleted: table === "bin",
    postingStatus: "historical_unposted",
  };
}

/* ------------------------------------------------------------------ move review */

export type ReasonCode =
  | "deleted_in_source"
  | "invoice_needs_counter_account"
  | "voucher_no_pair"
  | "voucher_ref_single"
  | "voucher_unbalanced"
  | "both_sides_positive"
  | "both_sides_zero"
  | "invalid_amount"
  | "invalid_date"
  | "missing_account"
  | "unregistered_currency"
  | "unsupported_currency"
  | "mixed_currency_group"
  | "same_account_pair"
  | "policy_not_selected"
  | "account_not_migrated";

export const REASON_LABELS: Record<ReasonCode, string> = {
  deleted_in_source: "محذوف في المصدر (جدول bin)",
  invoice_needs_counter_account: "فاتورة: لا يوجد حساب مقابل (مبيعات/مشتريات/صندوق) في المصدر",
  voucher_no_pair: "قيد أحادي الطرف بلا حركة مقابلة مرتبطة",
  voucher_ref_single: "له مرجع ربط لكن لا توجد حركة أخرى بنفس المرجع",
  voucher_unbalanced: "مجموعة المرجع غير متوازنة (مجموع dain ≠ مجموع madin)",
  both_sides_positive: "القيمتان موجبتان في الحركة نفسها",
  both_sides_zero: "القيمتان صفر",
  invalid_amount: "مبلغ غير صالح",
  invalid_date: "تاريخ غير صالح",
  missing_account: "الحساب المرتبط غير موجود",
  unregistered_currency: "معرّف العملة غير مسجل في جدول العملات",
  unsupported_currency: "عملة غير مدعومة في نسق برو",
  mixed_currency_group: "عملات مختلفة داخل مجموعة المرجع",
  same_account_pair: "طرفا القيد على الحساب نفسه",
  policy_not_selected: "لم يحدد المستخدم تفسير dain/madin",
  account_not_migrated: "لم تُرحَّل بيانات الحساب إلى نسق برو بعد",
};

export type MoveStatus = "eligible" | "pending" | "rejected" | "deleted";

export type MoveReview = {
  table: "input_move" | "bin";
  id: number;
  billType: number;
  kind: "voucher" | "invoice";
  personId: number | null;
  personName: string;
  date: string | null;
  dain: number | null;
  madin: number | null;
  currencyId: number | null;
  documentNumber: string;
  details: string;
  groupRef: string;
  status: MoveStatus;
  reasons: ReasonCode[];
};

export type VoucherGroup = {
  groupRef: string;
  rows: number[];
  sumDain: number;
  sumMadin: number;
  balanced: boolean;
};

export function documentTypesWithLines(tables: Tables): Set<number> {
  const billIdsWithLines = new Set<string>();
  for (const r of tables.bill_details ?? []) billIdsWithLines.add(String(r.bill_id));
  for (const r of tables.bill_details2 ?? []) billIdsWithLines.add(String(r.bill_id));
  const types = new Set<number>();
  for (const m of tables.input_move ?? []) if (billIdsWithLines.has(String(m.id))) types.add(Number(m.bill_type));
  const binIds = new Set<string>();
  for (const r of tables.bin_bill_details ?? []) binIds.add(String(r.bill_id));
  for (const r of tables.bin_bill_details2 ?? []) binIds.add(String(r.bill_id));
  for (const m of tables.bin ?? []) if (binIds.has(String(m.id))) types.add(Number(m.bill_type));
  return types;
}

export function voucherGroups(tables: Tables, invoiceTypes: Set<number>): Map<string, VoucherGroup> {
  const groups = new Map<string, VoucherGroup>();
  for (const m of tables.input_move ?? []) {
    if (invoiceTypes.has(Number(m.bill_type))) continue;
    const ref = text(m.ref);
    if (!ref) continue;
    const g = groups.get(ref) ?? { groupRef: ref, rows: [], sumDain: 0, sumMadin: 0, balanced: false };
    g.rows.push(Number(m.id));
    g.sumDain += num(m.dain) ?? 0;
    g.sumMadin += num(m.madin) ?? 0;
    groups.set(ref, g);
  }
  for (const g of groups.values()) g.balanced = g.rows.length >= 2 && Math.abs(g.sumDain - g.sumMadin) < TOLERANCE;
  return groups;
}

export function reviewMoves(tables: Tables): { reviews: MoveReview[]; groups: Map<string, VoucherGroup> } {
  const invoiceTypes = documentTypesWithLines(tables);
  const groups = voucherGroups(tables, invoiceTypes);
  const customers = new Map((tables.customers ?? []).map((c) => [String(c.id), c]));
  const currencies = new Set((tables.currencies ?? []).map((c) => String(c.id)));
  const movesById = new Map((tables.input_move ?? []).map((m) => [Number(m.id), m]));
  const reviews: MoveReview[] = [];

  const push = (m: Row, table: "input_move" | "bin") => {
    const billType = Number(m.bill_type);
    const kind: MoveReview["kind"] = invoiceTypes.has(billType) ? "invoice" : "voucher";
    const dain = num(m.dain);
    const madin = num(m.madin);
    const date = isoDate(m);
    const groupRef = text(m.ref);
    const reasons: ReasonCode[] = [];
    let status: MoveStatus = "pending";

    if (table === "bin") {
      reasons.push("deleted_in_source");
      status = "deleted";
    } else if (kind === "invoice") {
      reasons.push("invoice_needs_counter_account");
    } else {
      const g = groupRef ? groups.get(groupRef) : undefined;
      if (dain === null || madin === null || dain < 0 || madin < 0) { reasons.push("invalid_amount"); status = "rejected"; }
      else if (dain > 0 && madin > 0) { reasons.push("both_sides_positive"); status = "rejected"; }
      else if (dain === 0 && madin === 0) { reasons.push("both_sides_zero"); status = "rejected"; }
      if (!customers.has(String(m.per_id))) { reasons.push("missing_account"); status = "rejected"; }
      if (!currencies.has(String(m.cur))) { reasons.push("unregistered_currency"); status = "rejected"; }
      if (!date) { reasons.push("invalid_date"); status = "rejected"; }
      if (!g) { if (status !== "rejected") reasons.push("voucher_no_pair"); }
      else if (g.rows.length < 2) { if (status !== "rejected") reasons.push("voucher_ref_single"); }
      else {
        const curs = new Set(g.rows.map((id) => String(movesById.get(id)?.cur)));
        const accounts = new Set(g.rows.map((id) => String(movesById.get(id)?.per_id)));
        if (curs.size > 1) { reasons.push("mixed_currency_group"); status = "rejected"; }
        if (!g.balanced) { reasons.push("voucher_unbalanced"); status = "rejected"; }
        if (g.rows.length === 2 && accounts.size === 1) { reasons.push("same_account_pair"); status = "rejected"; }
        if (status !== "rejected") status = "eligible";
      }
    }
    reviews.push({
      table,
      id: Number(m.id),
      billType,
      kind,
      personId: m.per_id === null || m.per_id === undefined ? null : Number(m.per_id),
      personName: customers.get(String(m.per_id)) ? text(customers.get(String(m.per_id))!.name) : text(m.pername),
      date,
      dain,
      madin,
      currencyId: m.cur === null || m.cur === undefined ? null : Number(m.cur),
      documentNumber: text(m.bill),
      details: text(m.details),
      groupRef,
      status,
      reasons,
    });
  };
  for (const m of tables.input_move ?? []) push(m, "input_move");
  for (const m of tables.bin ?? []) push(m, "bin");
  return { reviews, groups };
}

export type ReviewSummary = {
  total: number;
  byStatus: Record<MoveStatus, number>;
  byReason: Partial<Record<ReasonCode, number>>;
  byBillType: Record<string, { rows: number; eligible: number; pending: number; rejected: number; deleted: number }>;
};

export function summarizeReview(reviews: MoveReview[]): ReviewSummary {
  const summary: ReviewSummary = {
    total: reviews.length,
    byStatus: { eligible: 0, pending: 0, rejected: 0, deleted: 0 },
    byReason: {},
    byBillType: {},
  };
  for (const r of reviews) {
    summary.byStatus[r.status] += 1;
    for (const reason of r.reasons) summary.byReason[reason] = (summary.byReason[reason] ?? 0) + 1;
    const key = String(r.billType);
    const row = (summary.byBillType[key] ||= { rows: 0, eligible: 0, pending: 0, rejected: 0, deleted: 0 });
    row.rows += 1;
    row[r.status] += 1;
  }
  return summary;
}

/* ------------------------------------------------------------------ posting plan */

export type DirectionPolicy = "dain_credit" | "dain_debit";

export type LedgerDraft = {
  moveId: number;
  accountLegacyId: number;
  counterAccountLegacyId: number | null;
  direction: "debit" | "credit";
  amount: number;
  currencyName: string;
  date: string;
  details: string;
  documentNumber: string;
  groupRef: string;
};

export type PostingGroup = {
  groupRef: string;
  moveIds: number[];
  status: "eligible" | "rejected";
  reasons: ReasonCode[];
  drafts: LedgerDraft[];
};

export type PostingPlan = {
  policy: DirectionPolicy | null;
  groups: PostingGroup[];
  eligibleGroups: number;
  eligibleEntries: number;
  rejectedGroups: number;
  blockers: ReasonCode[];
};

export function planVoucherPosting(
  tables: Tables,
  policy: DirectionPolicy | null,
  supportedCurrencyNames: readonly string[],
  migratedAccountIds: ReadonlySet<number> | null,
): PostingPlan {
  const { reviews, groups } = reviewMoves(tables);
  const byId = new Map(reviews.filter((r) => r.table === "input_move").map((r) => [r.id, r]));
  const currencies = new Map((tables.currencies ?? []).map((c) => [String(c.id), text(c.name)]));
  const plan: PostingPlan = { policy, groups: [], eligibleGroups: 0, eligibleEntries: 0, rejectedGroups: 0, blockers: [] };
  if (!policy) plan.blockers.push("policy_not_selected");

  for (const g of groups.values()) {
    if (g.rows.length < 2) continue;
    const rows = g.rows.map((id) => byId.get(id)!).filter(Boolean);
    const reasons = new Set<ReasonCode>();
    for (const r of rows) for (const reason of r.reasons) if (reason !== "voucher_no_pair") reasons.add(reason);
    const rejected = rows.some((r) => r.status !== "eligible");
    for (const r of rows) {
      const currencyName = currencies.get(String(r.currencyId)) ?? "";
      if (!supportedCurrencyNames.includes(currencyName)) reasons.add("unsupported_currency");
      if (migratedAccountIds && r.personId !== null && !migratedAccountIds.has(r.personId)) reasons.add("account_not_migrated");
    }
    const blocked = rejected || reasons.has("unsupported_currency") || reasons.has("account_not_migrated");
    const drafts: LedgerDraft[] = [];
    if (!blocked && policy) {
      for (const r of rows) {
        const isDain = (r.dain ?? 0) > 0;
        const direction: "debit" | "credit" =
          policy === "dain_credit" ? (isDain ? "credit" : "debit") : isDain ? "debit" : "credit";
        const counter = rows.length === 2 ? rows.find((x) => x.id !== r.id) : undefined;
        drafts.push({
          moveId: r.id,
          accountLegacyId: r.personId!,
          counterAccountLegacyId: counter?.personId ?? null,
          direction,
          amount: isDain ? r.dain! : r.madin!,
          currencyName: currencies.get(String(r.currencyId)) ?? "",
          date: r.date!,
          details: r.details,
          documentNumber: r.documentNumber,
          groupRef: g.groupRef,
        });
      }
    }
    const status: PostingGroup["status"] = blocked ? "rejected" : "eligible";
    plan.groups.push({ groupRef: g.groupRef, moveIds: g.rows, status, reasons: [...reasons], drafts });
    if (status === "eligible") {
      plan.eligibleGroups += 1;
      plan.eligibleEntries += rows.length;
    } else plan.rejectedGroups += 1;
  }
  return plan;
}

/** Final guard used right before writing: debit total must equal credit total per group and currency. */
export function assertBalanced(drafts: LedgerDraft[]): void {
  const byGroup = new Map<string, { debit: number; credit: number }>();
  for (const d of drafts) {
    const k = `${d.groupRef}|${d.currencyName}`;
    const s = byGroup.get(k) ?? { debit: 0, credit: 0 };
    if (d.direction === "debit") s.debit += d.amount;
    else s.credit += d.amount;
    byGroup.set(k, s);
  }
  for (const [k, s] of byGroup) {
    if (Math.abs(s.debit - s.credit) >= TOLERANCE) {
      throw new Error(`رفض الترحيل: القيد ${k} غير متوازن (مدين ${s.debit} ≠ دائن ${s.credit}).`);
    }
  }
}

/* ------------------------------------------------------------------ duplicates */

export type DuplicateReport = {
  customerNames: { name: string; ids: number[] }[];
  productNames: { name: string; ids: number[] }[];
  productBarcodes: { barcode: string; ids: number[] }[];
  movesWithSameSignature: number;
  movesInSignatureGroups: number;
};

export function findDuplicates(tables: Tables): DuplicateReport {
  const group = (rows: Row[], key: (r: Row) => string) => {
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const l = map.get(k);
      if (l) l.push(Number(r.id));
      else map.set(k, [Number(r.id)]);
    }
    return [...map.entries()].filter(([, ids]) => ids.length > 1);
  };
  const sig = new Map<string, number>();
  for (const m of tables.input_move ?? []) {
    const k = [m.per_id, m.dain, m.madin, m.cur, m.bill_type, text(m.details), isoDate(m), text(m.ref), text(m.bill)].join("|");
    sig.set(k, (sig.get(k) ?? 0) + 1);
  }
  const dupSigs = [...sig.values()].filter((n) => n > 1);
  return {
    customerNames: group(tables.customers ?? [], (r) => normalizeName(r.name)).map(([name, ids]) => ({ name, ids })),
    productNames: group(tables.products ?? [], (r) => normalizeName(r.name)).map(([name, ids]) => ({ name, ids })),
    productBarcodes: group(tables.products ?? [], (r) => text(r.barcode)).map(([barcode, ids]) => ({ barcode, ids })),
    movesWithSameSignature: dupSigs.length,
    movesInSignatureGroups: dupSigs.reduce((a, b) => a + b, 0),
  };
}
