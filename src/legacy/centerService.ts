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

export async function getActiveArchiveInfo(
  workspaceId?: string,
  legacyReference?: string,
): Promise<ActiveArchiveInfo | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openCenterDb();
  try {
    const batches = await listBatches(db);
    // A workspace cannot browse a different user's local historical archive.
    // For a linked account, the source ref is stronger than "most recent import".
    let requestedSha: string | null = null;
    if (legacyReference) {
      const match = /^([a-f0-9]{12}):customers:(\d+)$/.exec(legacyReference);
      if (!match) return null;
      requestedSha = batches.find((b) =>
        b.kind === "archive" && b.status === "complete" && b.sha256.startsWith(match[1]),
      )?.sha256 ?? null;
      if (!requestedSha) return null;
    } else if (workspaceId) {
      requestedSha = await getSetting<string>(db, `activeArchive:${workspaceId}`);
      if (!requestedSha) return null;
    }
    const active = batches.find((b) =>
      b.kind === "archive" && b.status === "complete" && (!requestedSha || b.sha256 === requestedSha),
    );
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
  invoiceIds: number[];
}> {
  const db = await openCenterDb();
  try {
    const batchId = archiveBatchId(sha256);
    const moves = await rowsByFk(db, batchId, "input_move", legacyCustomerId);
    const priced = await allRows(db, batchId, "bill_details");
    const free = await allRows(db, batchId, "bill_details2");
    const idsWithLines = new Set([...priced, ...free].map((l) => String(l.bill_id)));
    const invoiceIds = moves.filter((m) => idsWithLines.has(String(m.id))).map((m) => Number(m.id));
    const invoicesCount = invoiceIds.length;
    const vouchersCount = moves.length - invoicesCount;
    return { moves, invoicesCount, vouchersCount, invoiceIds };
  } finally {
    db.close();
  }
}
