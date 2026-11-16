/** Source-backed historical invoice search. Never guesses document type or amounts. */
import { normalizeArabicSearch } from "../accounting";
import type { Row, Tables } from "./adapter";
import type { DocumentRole, RoleMapping } from "./analysis";

export type HistoricalInvoiceHit = {
  row: Row;
  table: "input_move" | "bin";
  role: DocumentRole;
  roleConfirmed: boolean;
  personName: string;
  lineCount: number;
  searchText: string;
};

/** Only headers that have at least one real line are treated as historical invoices. */
export function indexHistoricalInvoices(tables: Tables, roles: RoleMapping): HistoricalInvoiceHit[] {
  const customerNames = new Map((tables.customers ?? []).map((c) => [String(c.id), String(c.name ?? "")]));
  const products = new Map((tables.products ?? []).map((p) => [String(p.id), p]));
  const results: HistoricalInvoiceHit[] = [];
  for (const [table, pricedTable, freeTable] of [
    ["input_move", "bill_details", "bill_details2"],
    ["bin", "bin_bill_details", "bin_bill_details2"],
  ] as const) {
    const parts = new Map<string, { count: number; terms: string[] }>();
    const register = (line: Row, priced: boolean) => {
      const key = String(line.bill_id);
      const bucket = parts.get(key) ?? { count: 0, terms: [] };
      bucket.count += 1;
      const product = priced ? products.get(String(line.prod_id)) : undefined;
      bucket.terms.push([
        line.id, line.prod_id, line.details, product?.name, product?.barcode, product?.code,
      ].map((v) => String(v ?? "")).join(" "));
      parts.set(key, bucket);
    };
    for (const line of tables[pricedTable] ?? []) register(line, true);
    for (const line of tables[freeTable] ?? []) register(line, false);
    for (const row of tables[table] ?? []) {
      const part = parts.get(String(row.id));
      if (!part) continue;
      const mapping = roles[String(row.bill_type)];
      const personName = customerNames.get(String(row.per_id)) ?? String(row.pername ?? "");
      results.push({
        row, table,
        role: mapping?.confirmed ? mapping.role : "unknown",
        roleConfirmed: Boolean(mapping?.confirmed),
        personName,
        lineCount: part.count,
        searchText: normalizeArabicSearch([
          row.id, row.bill, row.bill_type, row.details, row.per_id, personName,
          row.year, row.month, row.day, ...part.terms,
        ].map((v) => String(v ?? "")).join(" ")),
      });
    }
  }
  return results;
}

export function searchHistoricalInvoices(
  hits: readonly HistoricalInvoiceHit[],
  search: string,
  roleFilter: string = "all",
): HistoricalInvoiceHit[] {
  const q = normalizeArabicSearch(search);
  return hits.filter((hit) =>
    (roleFilter === "all" || hit.role === roleFilter) && (!q || hit.searchText.includes(q)),
  );
}
