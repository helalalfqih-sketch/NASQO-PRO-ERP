/**
 * Read/query bridge between the `nasqo_legacy_center` IndexedDB store and the app screens
 * (Sales, Purchases, Historical Invoices, Customer Statements, Inventory Reports, Reconciliation).
 */
import {
  billTypeEvidence,
  composeInvoice,
  documentContext,
  reviewMoves,
  suggestedRoleMapping,
  type BillTypeEvidence,
  type LegacyInvoice,
  type MoveReview,
  type RoleMapping,
} from "./analysis";
import {
  allRows,
  archiveBatchId,
  getRow,
  getSetting,
  listBatches,
  loadTables,
  openCenterDb,
  rowsByFk,
  type BatchRecord,
} from "./store";
import type { Row, Tables } from "./adapter";

export type ActiveArchiveInfo = {
  sha256: string;
  batchId: string;
  batch: BatchRecord;
};

export async function getActiveArchiveInfo(): Promise<ActiveArchiveInfo | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openCenterDb();
  try {
    const batches = await listBatches(db);
    const active = batches.find((b) => b.kind === "archive" && b.status === "complete");
    if (!active) return null;
    return { sha256: active.sha256, batchId: active.batchId, batch: active };
  } finally {
    db.close();
  }
}

export async function loadArchiveContextData(sha256: string): Promise<{
  tables: Tables;
  evidence: BillTypeEvidence[];
  roles: RoleMapping;
  reviews: MoveReview[];
}> {
  const db = await openCenterDb();
  try {
    const batchId = archiveBatchId(sha256);
    const tables = await loadTables(db, batchId, [
      "customers",
      "products",
      "stores",
      "currencies",
      "boxes",
      "input_move",
      "bill_details",
      "bill_details2",
      "bin",
      "bin_bill_details",
      "bin_bill_details2",
      "store_trans",
      "trans_details",
    ]);
    const evidence = billTypeEvidence(tables);
    const savedRoles = await getSetting<RoleMapping>(db, `roles:${sha256}`);
    const roles = savedRoles ?? suggestedRoleMapping(evidence);
    const { reviews } = reviewMoves(tables);
    return { tables, evidence, roles, reviews };
  } finally {
    db.close();
  }
}

export async function loadSingleHistoricalInvoice(
  sha256: string,
  moveId: number,
  table: "input_move" | "bin" = "input_move",
): Promise<LegacyInvoice | null> {
  const db = await openCenterDb();
  try {
    const batchId = archiveBatchId(sha256);
    const move = await getRow(db, batchId, table, moveId);
    if (!move) return null;

    const pricedTable = table === "bin" ? "bin_bill_details" : "bill_details";
    const freeTable = table === "bin" ? "bin_bill_details2" : "bill_details2";

    const [pricedRows, freeRows, customers, products, currencies, boxes, savedRoles] = await Promise.all([
      rowsByFk(db, batchId, pricedTable, moveId),
      rowsByFk(db, batchId, freeTable, moveId),
      allRows(db, batchId, "customers"),
      allRows(db, batchId, "products"),
      allRows(db, batchId, "currencies"),
      allRows(db, batchId, "boxes"),
      getSetting<RoleMapping>(db, `roles:${sha256}`),
    ]);

    const miniTables: Tables = {
      customers,
      products,
      currencies,
      boxes,
      input_move: table === "input_move" ? [move] : [],
      bin: table === "bin" ? [move] : [],
      bill_details: table === "input_move" ? pricedRows : [],
      bill_details2: table === "input_move" ? freeRows : [],
      bin_bill_details: table === "bin" ? pricedRows : [],
      bin_bill_details2: table === "bin" ? freeRows : [],
    };
    const evidence = billTypeEvidence(miniTables);
    const roles = savedRoles ?? suggestedRoleMapping(evidence);
    const ctx = documentContext(miniTables, roles, evidence);
    return composeInvoice(move, table, pricedRows, freeRows, ctx);
  } finally {
    db.close();
  }
}

export async function loadCustomerHistoricalMoves(
  sha256: string,
  legacyCustomerId: number,
): Promise<{
  moves: Row[];
  invoicesCount: number;
  vouchersCount: number;
}> {
  const db = await openCenterDb();
  try {
    const batchId = archiveBatchId(sha256);
    const moves = await rowsByFk(db, batchId, "input_move", legacyCustomerId);
    const invoicesCount = moves.filter((m) => Number(m.bill_type) !== 1).length;
    const vouchersCount = moves.filter((m) => Number(m.bill_type) === 1).length;
    return { moves, invoicesCount, vouchersCount };
  } finally {
    db.close();
  }
}
