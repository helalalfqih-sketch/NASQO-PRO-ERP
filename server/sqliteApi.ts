import { loadHomeDashboard, localHomePrincipal } from "./homeDashboard.ts";
import { completeBusinessSetup, recordRecentAction } from "./businessSetup.ts";
import { getTrialBalanceReport } from "./financialReports.ts";
import { executeErpAction } from "./erpActions.ts";
import { deleteMasterRecord, saveCashboxRecord } from "./masterCrud.ts";
import { saveErpRecords } from "./erpRecords.ts";
import { ErpValidationError } from "../src/erpRecordRules.ts";
import { prepareWorkspaceRestore, withApprovedRestore, readRestoreSafetyBackup } from "./restoreSafety.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express, { Router, type Express, type NextFunction, type Request, type Response } from "express";
import { requireSqliteAccess, sqliteLogin, sqliteLogout, sqliteStatus, validateSqliteProductionConfig } from "./sqliteAccess.ts";
import type { DatabaseSync } from "node:sqlite";
import type { ErpWorkspaceData } from "../src/erp.ts";
import type {
  AccountCategory,
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
  WorkspaceSettings,
} from "../src/types.ts";
import {
  inspectAndExtractLegacySqlite,
  importLegacySqliteIntoUnifiedDb,
} from "./legacySqliteImporter.ts";
import {
  bootstrapSmartProSqlIfConfigured,
  importSmartProSqlDump,
} from "./smartproSqlImporter.ts";
import {
  DEFAULT_WORKSPACE_ID,
  SqliteValidationError,
  batchUpdateInventoryItemRows,
  deleteAccountRow,
  deleteCurrencyRow,
  deleteInventoryCatalogRow,
  deleteLedgerEntryRow,
  ensureEmptyWorkspace,
  exportCleanSqliteSnapshotBytes,
  exportWorkspaceJsonBackup,
  fetchInvoiceDetail,
  getCashboxesReport,
  getDbStats,
  getFullWorkspaceBundle,
  getInventoryMovementsReport,
  getProductPriceStats,
  getSqliteDb,
  importInventoryCatalogRows,
  importAccountCardsRows,
  insertCashTransferAtomic,
  insertInventoryItemRow,
  insertJournalEntryRow,
  insertLedgerEntryRow,
  listUnifiedTablesMeta,
  listWorkspaceInventoryRows,
  makeId,
  mapLedgerRow,
  postDraftLedgerEntryRow,
  queryUnifiedTable,
  resetWorkspaceToEmpty,
  restoreUnifiedJsonBundle,
  reverseJournalEntryRow,
  reverseLedgerEntryRow,
  saveErpDataRows,
  saveWorkspaceSettingsRow,
  setLedgerDeletedRow,
  setWorkspaceClosedUntilDate,
  updateInventoryCatalogRow,
  updateInventoryItemRow,
  updateLedgerEntryRow,
  upsertAccountGroupRow,
  upsertAccountRow,
  upsertCurrencyRow,
  upsertWarehouseRow,
  withTransaction,
  writeAudit,
} from "./sqliteDb.ts";
import { isStrictlyFiniteNumeric, roundMoney } from "./moneyMath.ts";

function paramStr(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

function validWsId(raw: string): string {
  const clean = raw.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clean)) {
    throw new HttpError(400, "معرف مساحة العمل غير صالح.");
  }
  return clean;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function route(fn: (req: Request, res: Response, db: DatabaseSync) => Promise<void> | void) {
  return async (req: Request, res: Response) => {
    try {
      const db = getSqliteDb();
      await fn(req, res, db);
    } catch (error) {
      if (error instanceof HttpError || error instanceof ErpValidationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SqliteValidationError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "خطأ غير متوقع في قاعدة البيانات.";
      console.error("SQLite API error:", error);
      res.status(500).json({ error: message });
    }
  };
}

function mapDocRoleFilter(role: string): string | null {
  switch (role) {
    case "sale":
      return "doc_type IN (2, 7)";
    case "purchase":
      return "doc_type IN (3, 9)";
    case "sale_return":
      return "doc_type = 4";
    case "purchase_return":
      return "doc_type = 5";
    case "free_sale":
      return "doc_type = 7";
    case "free_purchase":
      return "doc_type = 9";
    case "voucher":
      return "(doc_type = 1 OR kind = 'voucher')";
    default:
      return null;
  }
}

export function mountSqliteApi(app: Express): void {
  validateSqliteProductionConfig();
  try {
    const db = getSqliteDb();
    const report = bootstrapSmartProSqlIfConfigured(db);
    if (report && !report.skippedDuplicate) {
      console.log(
        `SQLite unified DB bootstrapped from ${report.sourceName}: ${report.tablesDetected} source tables, ${report.totalSourceRows} rows -> accounts=${report.imported.accounts}, ledger=${report.imported.ledgerEntries}, lines=${report.imported.invoiceLines}, products=${report.imported.inventoryItems}`,
      );
    } else {
      ensureEmptyWorkspace(db, DEFAULT_WORKSPACE_ID);
    }
  } catch (err) {
    // A missing persistent volume must abort startup, not leave a misleading
    // healthy HTTP container with an unusable accounting database.
    if (process.env.NODE_ENV === "production") throw err;
    console.error("SQLite initial bootstrap warning:", err);
  }

  const router = Router();
  router.get("/auth/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(sqliteStatus(req));
  });
  router.post("/auth/login", express.json({ limit: "2kb" }), sqliteLogin);
  router.post("/auth/logout", sqliteLogout);
  router.use(requireSqliteAccess);
  router.use(express.json({ limit: "128mb" }));

  router.get(
    "/status",
    route((req, res, db) => {
      const uid = typeof req.query.uid === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(req.query.uid)
        ? req.query.uid
        : DEFAULT_WORKSPACE_ID;
      ensureEmptyWorkspace(db, uid);
      res.json(getDbStats(db, uid));
    }),
  );

  router.get(
    "/workspace/:uid",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const displayName = typeof req.query.displayName === "string" ? req.query.displayName.slice(0, 80) : undefined;
      ensureEmptyWorkspace(db, uid, displayName);
      res.json(getFullWorkspaceBundle(db, uid));
    }),
  );

  router.get('/workspace/:uid/home', route(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const scope: Record<string,string>={};
    for(const [key,value] of Object.entries(req.query)) {
      if(key==='detail') continue;
      if(!['currency','warehouseId','branchId','fromDate','toDate'].includes(key) || typeof value!=='string' || value.length>150) throw new SqliteValidationError('مرشح الرئيسية غير صالح.');
      scope[key]=value;
    }
    const detail=req.query.detail;
    if(detail!==undefined&&(typeof detail!=='string'||!['sales','purchases','cash','receivables','payables','receipts','payments','invoices','customers','vendors','stockItems','lowStock','warehouses','outOfStock','vouchers'].includes(detail))) throw new SqliteValidationError('التقرير غير صالح.');
    res.json(await loadHomeDashboard(paramStr(req,'uid'),scope,detail as import('../src/dashboard/model.ts').HomeMetric | undefined));
  }));
  router.put('/workspace/:uid/personal-preferences', route((req,res,db) => {
    const uid=paramStr(req,'uid'); localHomePrincipal(uid);
    if(!req.body || Object.keys(req.body).join()!=='preferences') throw new SqliteValidationError('تفضيلات شخصية فقط؛ لا يمكن تعديل إعدادات الشركة هنا.');
    res.json({workspace:saveWorkspaceSettingsRow(db,uid,{userPreferences:req.body.preferences})});
  }));

  router.put(
    "/workspace/:uid",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const workspace = saveWorkspaceSettingsRow(db, uid, (req.body ?? {}) as Partial<WorkspaceSettings>);
      res.json({ workspace });
    }),
  );

  router.put(
    "/workspace/:uid/fiscal-lock",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const closedUntilDate = req.body?.closedUntilDate;
      if (closedUntilDate !== null && (typeof closedUntilDate !== "string" || !closedUntilDate.trim())) {
        throw new HttpError(400, "حدد تاريخ إقفال صالحًا، أو أرسل null لفتح الفترة صراحةً.");
      }
      const workspace = setWorkspaceClosedUntilDate(db, uid, closedUntilDate);
      res.json({ workspace });
    }),
  );

  router.post(
    "/workspace/:uid/reset",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      if (process.env.NODE_ENV === "production" && process.env.NASQO_SQLITE_ALLOW_RESET !== "1") {
        throw new HttpError(403, "تفريغ قاعدة الإنتاج مغلق. يلزم تفعيله صراحةً بعد أخذ نسخة احتياطية.");
      }
      if (req.body?.confirmation !== "RESET:" + uid) {
        throw new HttpError(400, "يلزم تأكيد التفريغ صراحةً.");
      }
      resetWorkspaceToEmpty(db, uid);
      res.json(getFullWorkspaceBundle(db, uid));
    }),
  );

  router.post("/workspace/:uid/recent-action", route((req, res, db) => { res.json({workspace:recordRecentAction(db,validWsId(paramStr(req,"uid")),req.body?.action)}); }));
  router.post("/workspace/:uid/setup", route((req, res, db) => {
    res.json({ bundle: completeBusinessSetup(db, validWsId(paramStr(req, "uid")), req.body) });
  }));

  router.post(
    "/workspace/:uid/seed-demo",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid, "نسقو برو - تجريبي");
      res.json({ bundle: getFullWorkspaceBundle(db, uid) });
    }),
  );

  router.post(
    "/workspace/:uid/groups",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as { group?: { id?: number; name: string; category?: "purchases" | "sales" | "clients" | "employees" | "transfers" | "shop"; currencyCode?: "ريال" | "دولار" | "يورو" | "عملة 2"; sortOrder?: number } };
      if (!body.group?.name) throw new HttpError(400, "اسم الصندوق مطلوب.");
      const group = upsertAccountGroupRow(db, uid, body.group);
      res.status(body.group.id ? 200 : 201).json({ group });
    }),
  );

  router.post(
    "/workspace/:uid/accounts",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as { account?: Partial<AccountRecord> & { name: string }; existingId?: string };
      if (!body.account?.name) throw new HttpError(400, "اسم الحساب مطلوب.");
      const saved = upsertAccountRow(db, uid, body.account, body.existingId);
      res.status(body.existingId ? 200 : 201).json({ account: saved });
    }),
  );

  router.post(
    "/workspace/:uid/ledger",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as { entry?: Partial<LedgerEntryRecord> & { accountId: string; accountName: string } };
      if (!body.entry?.accountId) throw new HttpError(400, "معرف الحساب مطلوب.");
      const entry = insertLedgerEntryRow(db, uid, body.entry);
      const refreshedInventory = body.entry.lines?.length
        ? getFullWorkspaceBundle(db, uid).inventory
        : undefined;
      res.status(201).json({ entry, ...(refreshedInventory ? { inventory: refreshedInventory } : {}) });
    }),
  );

  router.get(
    "/workspace/:uid/products/:itemId/prices",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const itemId = paramStr(req, "itemId").trim();
      res.json(getProductPriceStats(db, uid, itemId));
    }),
  );

  router.patch(
    "/workspace/:uid/ledger/:entryId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const entryId = paramStr(req, "entryId").trim();
      const body = (req.body ?? {}) as { entry?: Partial<LedgerEntryRecord> & { accountId: string; accountName: string } };
      if (!body.entry?.accountId) throw new HttpError(400, "بيانات التحديث غير مكتملة.");
      const entry = updateLedgerEntryRow(db, uid, entryId, body.entry);
      if (!entry) throw new HttpError(404, "السجل غير موجود.");
      const inventory = listWorkspaceInventoryRows(db, uid);
      const lineCountRow = db
        .prepare("SELECT COUNT(*) AS cnt FROM invoice_lines WHERE workspace_id = ?")
        .get(uid) as { cnt: number };
      res.json({ entry, inventory, invoiceLinesCount: Number(lineCountRow?.cnt ?? 0) });
    }),
  );

  router.patch(
    "/workspace/:uid/ledger/:entryId/deleted",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const entryId = paramStr(req, "entryId").trim();
      setLedgerDeletedRow(db, uid, entryId, Boolean(req.body?.deleted));
      const inventory = listWorkspaceInventoryRows(db, uid);
      res.json({ ok: true, inventory });
    }),
  );

  router.post(
    "/workspace/:uid/ledger/:entryId/post",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const entryId = paramStr(req, "entryId").trim();
      const entry = postDraftLedgerEntryRow(db, uid, entryId);
      const inventory = listWorkspaceInventoryRows(db, uid);
      res.json({ entry, inventory });
    }),
  );

  router.post(
    "/workspace/:uid/ledger/:entryId/reverse",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const entryId = paramStr(req, "entryId").trim();
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const reversalDate = typeof req.body?.reversalDate === "string" ? req.body.reversalDate : undefined;
      const result = reverseLedgerEntryRow(db, uid, entryId, { reason, reversalDate });
      const inventory = listWorkspaceInventoryRows(db, uid);
      res.status(201).json({ ...result, inventory });
    }),
  );

  router.get('/workspace/:uid/reports/trial-balance', route((req, res, db) => {
    const options: {currency?: string; fromDate?: string; toDate?: string} = {};
    for (const key of ['currency', 'fromDate', 'toDate'] as const) {
      const value = req.query[key];
      if (value !== undefined && typeof value !== 'string') throw new SqliteValidationError('مرشح التقرير غير صالح.');
      if (value) options[key] = value as string;
    }
    for (const date of [options.fromDate, options.toDate]) {
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) {
        throw new SqliteValidationError('تاريخ التقرير غير صالح.');
      }
    }
    if (options.fromDate && options.toDate && options.fromDate > options.toDate) throw new SqliteValidationError('بداية الفترة يجب ألا تتجاوز نهايتها.');
    res.json(getTrialBalanceReport(db, validWsId(paramStr(req, 'uid')), options));
  }));

  router.post(
    "/workspace/:uid/journals",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const journal = insertJournalEntryRow(db, uid, req.body ?? {});
      res.status(201).json({ journal });
    }),
  );

  router.post(
    "/workspace/:uid/journals/:journalId/reverse",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const journalId = paramStr(req, "journalId").trim();
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const reversalDate = typeof req.body?.reversalDate === "string" ? req.body.reversalDate : undefined;
      const result = reverseJournalEntryRow(db, uid, journalId, { reason, reversalDate });
      res.status(201).json(result);
    }),
  );

  router.post(
    "/workspace/:uid/transfers/cash",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const result = insertCashTransferAtomic(db, uid, req.body ?? {});
      res.status(201).json(result);
    }),
  );

  router.get(
    "/workspace/:uid/inventory/report",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : undefined;
      const itemId = typeof req.query.itemId === "string" ? req.query.itemId.trim() : undefined;
      const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate.trim() : undefined;
      const toDate = typeof req.query.toDate === "string" ? req.query.toDate.trim() : undefined;
      const currency = typeof req.query.currency === "string" ? req.query.currency.trim() : undefined;
      const profitBasisRaw = typeof req.query.profitBasis === "string" ? req.query.profitBasis.trim() : "avg";
      const profitBasis = profitBasisRaw === "cost" || profitBasisRaw === "last" ? profitBasisRaw : "avg";
      res.json(getInventoryMovementsReport(db, uid, { warehouseId, itemId, fromDate, toDate, currency, profitBasis }));
    }),
  );

  router.get(
    "/workspace/:uid/cashboxes/report",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const currency = typeof req.query.currency === "string" ? req.query.currency.trim() : undefined;
      const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate.trim() : undefined;
      const toDate = typeof req.query.toDate === "string" ? req.query.toDate.trim() : undefined;
      res.json(getCashboxesReport(db, uid, { currency, fromDate, toDate }));
    }),
  );

  router.delete(
    "/workspace/:uid/ledger/:entryId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const entryId = paramStr(req, "entryId").trim();
      deleteLedgerEntryRow(db, uid, entryId);
      const inventory = listWorkspaceInventoryRows(db, uid);
      res.json({ ok: true, inventory });
    }),
  );

  router.delete(
    "/workspace/:uid/accounts/:accountId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const accountId = paramStr(req, "accountId").trim();
      deleteAccountRow(db, uid, accountId);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/workspace/:uid/invoices",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
      const role = typeof req.query.role === "string" ? req.query.role.trim() : "all";
      const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const clauses: string[] = ["l.workspace_id = ?"];
      const params: (string | number)[] = [uid];

      if (accountId) {
        clauses.push("l.account_id = ?");
        params.push(accountId);
      }
      if (role !== "all") {
        const roleClause = mapDocRoleFilter(role);
        if (roleClause) clauses.push(`(${roleClause})`);
      }
      if (q) {
        const numMatch = q.startsWith("#") ? q.slice(1).trim() : q;
        const like = `%${q}%`;
        if (/^\d+$/.test(numMatch)) {
          clauses.push(
            `(l.entry_number = ? OR l.legacy_id = ? OR l.document_number LIKE ? OR l.account_name LIKE ? OR l.details LIKE ? OR EXISTS (SELECT 1 FROM invoice_lines il LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id WHERE il.entry_id = l.id AND (il.item_name LIKE ? OR il.details LIKE ? OR ii.sku LIKE ?)))`,
          );
          params.push(Number(numMatch), Number(numMatch), like, like, like, like, like, like);
        } else {
          clauses.push(
            `(l.account_name LIKE ? OR l.details LIKE ? OR l.document_number LIKE ? OR l.type_label LIKE ? OR EXISTS (SELECT 1 FROM invoice_lines il LEFT JOIN inventory_items ii ON ii.id = il.inventory_item_id WHERE il.entry_id = l.id AND (il.item_name LIKE ? OR il.details LIKE ? OR ii.sku LIKE ?)))`,
          );
          params.push(like, like, like, like, like, like, like);
        }
      }

      const whereSql = clauses.join(" AND ");
      const total = Number((db.prepare(`SELECT COUNT(*) AS c FROM ledger_entries l WHERE ${whereSql}`).get(...params) as { c: number }).c);
      const rows = db
        .prepare(
          `SELECT l.*, (SELECT COUNT(*) FROM invoice_lines il WHERE il.entry_id = l.id) AS line_count
           FROM ledger_entries l
           WHERE ${whereSql}
           ORDER BY l.entry_date DESC, l.entry_number DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Record<string, unknown>[];

      res.json({
        total,
        limit,
        offset,
        invoices: rows.map(mapLedgerRow),
      });
    }),
  );

  router.get(
    "/workspace/:uid/invoices/:entryId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const target = paramStr(req, "entryId");
      const detail = fetchInvoiceDetail(db, uid, target);
      if (!detail) throw new HttpError(404, "الفاتورة غير موجودة في قاعدة البيانات.");
      res.json(detail);
    }),
  );

  router.get(
    "/workspace/:uid/accounts/:accountId/legacy-moves",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const accountId = paramStr(req, "accountId").trim();
      const rows = db
        .prepare(
          `SELECT l.*, (SELECT COUNT(*) FROM invoice_lines il WHERE il.entry_id = l.id) AS line_count
           FROM ledger_entries l
           WHERE l.workspace_id = ? AND l.account_id = ?
           ORDER BY l.entry_date DESC, l.entry_number DESC`,
        )
        .all(uid, accountId) as Record<string, unknown>[];
      const moves = rows.map(mapLedgerRow);
      const invoicesCount = moves.filter((m) => m.kind === "invoice" || m.kind === "return" || (m.lineCount ?? 0) > 0).length;
      const vouchersCount = moves.length - invoicesCount;
      res.json({ moves, invoicesCount, vouchersCount });
    }),
  );

  router.get(
    "/workspace/:uid/archive-summary",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const stats = getDbStats(db, uid);
      const docTypeSummary = db
        .prepare(
          `SELECT COALESCE(doc_type, 0) AS docType, type_label AS typeLabel, COUNT(*) AS count,
                  SUM(COALESCE(raw_dain, 0)) AS totalDain, SUM(COALESCE(raw_madin, 0)) AS totalMadin,
                  SUM(CASE WHEN settled_on_receipt = 1 THEN 1 ELSE 0 END) AS cashSettledCount
           FROM ledger_entries
           WHERE workspace_id = ?
           GROUP BY COALESCE(doc_type, 0), type_label
           ORDER BY count DESC`,
        )
        .all(uid);
      const archivedDocs = db
        .prepare("SELECT * FROM archived_documents WHERE workspace_id = ? ORDER BY legacy_id DESC LIMIT 100")
        .all(uid);
      const transfers = db
        .prepare(
          `SELECT st.*, w1.name AS from_warehouse_name, w2.name AS to_warehouse_name,
                  (SELECT COUNT(*) FROM stock_transfer_lines stl WHERE stl.transfer_id = st.id) AS lines_count
           FROM stock_transfers st
           LEFT JOIN warehouses w1 ON w1.id = st.from_warehouse_id
           LEFT JOIN warehouses w2 ON w2.id = st.to_warehouse_id
           WHERE st.workspace_id = ?
           ORDER BY st.legacy_id DESC LIMIT 100`,
        )
        .all(uid);

      res.json({
        stats,
        docTypeSummary,
        archivedDocs,
        transfers,
      });
    }),
  );

  router.post(
    "/workspace/:uid/currencies",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as {
        currency?: {
          id?: number;
          name: string;
          symbol?: string;
          ratePrimary?: number;
          rateSecondary?: number;
          nameSecondary?: string;
        };
      };
      if (!body.currency?.name) throw new HttpError(400, "اسم العملة مطلوب.");
      const saved = upsertCurrencyRow(db, uid, body.currency);
      const currencies = getFullWorkspaceBundle(db, uid).currencies ?? [saved];
      res.status(body.currency.id ? 200 : 201).json({ currency: saved, currencies });
    }),
  );

  router.delete(
    "/workspace/:uid/currencies/:currencyId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const currencyId = Number(paramStr(req, "currencyId"));
      if (!Number.isFinite(currencyId) || currencyId <= 0) {
        throw new HttpError(400, "معرف العملة غير صالح.");
      }
      deleteCurrencyRow(db, uid, currencyId);
      const currencies = getFullWorkspaceBundle(db, uid).currencies ?? [];
      res.json({ ok: true, currencies });
    }),
  );

  router.post(
    "/workspace/:uid/warehouses",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as { warehouse?: Partial<WarehouseRecord> & { name: string }; existingId?: string };
      if (!body.warehouse?.name) throw new HttpError(400, "اسم المخزن مطلوب.");
      const saved = upsertWarehouseRow(db, uid, body.warehouse, body.existingId);
      res.status(body.existingId ? 200 : 201).json({ warehouse: saved });
    }),
  );

  router.post(
    "/workspace/:uid/inventory",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as { item?: Partial<InventoryItemRecord> & { name: string; warehouseId?: string } };
      if (!body.item?.name) throw new HttpError(400, "اسم الصنف مطلوب.");
      const saved = insertInventoryItemRow(db, uid, body.item);
      res.status(201).json({ item: saved });
    }),
  );

  router.post(
    "/workspace/:uid/inventory/import",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const body = (req.body ?? {}) as {
        items?: (Partial<InventoryItemRecord> & { name: string; warehouseId?: string })[];
        mode?: "upsert" | "skip";
        warehouseId?: string;
      };
      if (!Array.isArray(body.items) || body.items.length === 0) {
        throw new HttpError(400, "لا توجد أصناف صالحة للاستيراد.");
      }
      const result = importInventoryCatalogRows(db, uid, body.items, {
        mode: body.mode === "skip" ? "skip" : "upsert",
        warehouseId: typeof body.warehouseId === "string" ? body.warehouseId : undefined,
      });
      res.status(201).json(result);
    }),
  );

  router.delete(
    "/workspace/:uid/inventory/:itemId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const itemId = paramStr(req, "itemId").trim();
      deleteInventoryCatalogRow(db, uid, itemId);
      res.json({ ok: true });
    }),
  );

  router.patch(
    "/workspace/:uid/inventory/batch",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      batchUpdateInventoryItemRows(db, uid, updates);
      res.json({ ok: true, updated: updates.length });
    }),
  );

  router.patch(
    "/workspace/:uid/inventory/:itemId/catalog",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const itemId = paramStr(req, "itemId").trim();
      const body = (req.body ?? {}) as { item?: Partial<InventoryItemRecord> & { name: string } };
      if (!body.item?.name) throw new HttpError(400, "اسم الصنف مطلوب.");
      const item = updateInventoryCatalogRow(db, uid, itemId, body.item);
      res.json({ item });
    }),
  );

  router.patch(
    "/workspace/:uid/inventory/:itemId",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const itemId = paramStr(req, "itemId").trim();
      const body = (req.body ?? {}) as { item?: Partial<InventoryItemRecord> & { name: string; warehouseId: string } };
      if (!body.item?.name || !body.item?.warehouseId) throw new HttpError(400, "بيانات الصنف غير مكتملة.");
      updateInventoryItemRow(db, uid, itemId, body.item);
      res.json({ ok: true });
    }),
  );

  router.post('/workspace/:uid/erp/actions',route((req,res,db)=>{
    const uid=validWsId(paramStr(req,'uid'));res.json({bundle:executeErpAction(db,uid,req.body)});
  }));
  router.post('/workspace/:uid/cashboxes',route((req,res,db)=>{
    const uid=validWsId(paramStr(req,'uid'));
    const cashbox=saveCashboxRecord(db,uid,req.body?.payload);
    res.json({cashbox,bundle:getFullWorkspaceBundle(db,uid)});
  }));
  for (const [path,kind] of [['groups','group'],['warehouses','warehouse'],['cashboxes','cashbox']] as const) {
    router.delete(`/workspace/:uid/${path}/:id`,route((req,res,db)=>{
      const uid=validWsId(paramStr(req,'uid')),raw=paramStr(req,'id'),id=kind==='warehouse'?raw:Number(raw);
      if(!raw||(typeof id==='number'&&(!Number.isSafeInteger(id)||id<=0)))throw new HttpError(400,'معرف غير صالح.');
      deleteMasterRecord(db,uid,kind,id);res.json({ok:true,bundle:getFullWorkspaceBundle(db,uid)});
    }));
  }

  router.put(
    "/workspace/:uid/erp",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      if (!Array.isArray(req.body?.changes)) throw new HttpError(400, "استخدم تعديل السجلات المحددة؛ استبدال القوائم بالكامل غير مسموح.");
      res.json({ ok: true, erpData: saveErpRecords(db, uid, req.body.changes) });
    }),
  );

  router.post(
    "/workspace/:uid/backups",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const id = makeId("bkp");
      const name = String(req.body?.name || "نسخة احتياطية").trim().slice(0, 120) || "نسخة احتياطية";
      const exportedAtIso = String(req.body?.exportedAtIso || new Date().toISOString()).slice(0, 40);
      db.prepare(
        `INSERT INTO backups (id, workspace_id, name, accounts_count, ledger_count, warehouses_count, inventory_count, exported_at_iso, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        uid,
        name,
        Math.max(0, Math.round(Number(req.body?.accountsCount || 0))),
        Math.max(0, Math.round(Number(req.body?.ledgerCount || 0))),
        Math.max(0, Math.round(Number(req.body?.warehousesCount || 0))),
        Math.max(0, Math.round(Number(req.body?.inventoryCount || 0))),
        exportedAtIso,
        new Date().toISOString(),
      );
      res.status(201).json({ id });
    }),
  );

  router.get(
    "/workspace/:uid/export/sqlite",
    route(async (req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-export-"));
      const tmpFile = path.join(tmpDir, "nasqo-export.sqlite");
      try {
        const bytes = await exportCleanSqliteSnapshotBytes(db, tmpFile, uid);
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Type", "application/x-sqlite3");
        res.setHeader("Content-Disposition", `attachment; filename="nasqo-unified-${uid}-${stamp}.sqlite"`);
        res.send(Buffer.from(bytes));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }),
  );

  router.get(
    "/workspace/:uid/export/json",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const backupPayload = exportWorkspaceJsonBackup(db, uid);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json(backupPayload);
    }),
  );

  router.post("/workspace/:uid/restore/prepare", route((req, res, db) => {
    res.json(prepareWorkspaceRestore(db, validWsId(paramStr(req, "uid"))));
  }));
  router.get("/workspace/:uid/restore/safety/:token", route((req, res) => {
    res.type("application/json").send(readRestoreSafetyBackup(validWsId(paramStr(req, "uid")), paramStr(req, "token")));
  }));

  router.post("/workspace/:uid/accounts/import", route((req,res,db) => {
    const uid=validWsId(paramStr(req,"uid"));
    const result=importAccountCardsRows(db,uid,req.body?.accounts);
    res.json({...result,bundle:getFullWorkspaceBundle(db,uid)});
  }));

  router.post(
    "/workspace/:uid/restore/json",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const rawBody = req.body;
      const payload =
        rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) && "payload" in rawBody
          ? (rawBody as { payload: unknown }).payload
          : rawBody;
      const restored = withApprovedRestore(db, uid, req.body?.restoreToken, () => restoreUnifiedJsonBundle(db, uid, payload));
      res.json({ restored, bundle: getFullWorkspaceBundle(db, uid) });
    }),
  );

  router.post(
    "/workspace/:uid/import/smartpro-sql",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const sqlText = typeof req.body?.sqlText === "string" ? req.body.sqlText : "";
      const sourceName = typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 120) : "smartprodb.sql";
      if (!sqlText || sqlText.length < 50) throw new HttpError(400, "محتوى ملف SQL فارغ أو غير صالح.");
      const runImport = () => importSmartProSqlDump(db, sqlText, {
        workspaceId: uid,
        sourceName,
        replaceExisting: Boolean(req.body?.replaceExisting ?? true),
      });
      const report = Boolean(req.body?.replaceExisting ?? true) ? withApprovedRestore(db, uid, req.body?.restoreToken, runImport) : runImport();
      res.json({ report, bundle: getFullWorkspaceBundle(db, uid) });
    }),
  );

  router.post(
    "/workspace/:uid/import/sqlite-legacy",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const base64 = typeof req.body?.base64 === "string" ? req.body.base64 : "";
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 120) : "legacy.sqlite";
      const mode = req.body?.mode === "inspect" ? "inspect" : req.body?.mode === "restore" ? "restore" : "import";
      if (!base64) throw new HttpError(400, "محتوى ملف SQLite غير موجود.");
      const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      if (mode === "inspect") {
        const extracted = inspectAndExtractLegacySqlite(bytes);
        res.json({
          sha256: extracted.sha256,
          integrity: extracted.integrity,
          tables: Object.keys(extracted.tableCounts),
          tableCounts: extracted.tableCounts,
          totalRows: extracted.totalRows,
          evidence: extracted.evidence,
          reviewSummary: extracted.reviewSummary,
        });
        return;
      }
      const groupCategories =
        req.body?.groupCategories && typeof req.body.groupCategories === "object"
          ? (req.body.groupCategories as Record<string, AccountCategory>)
          : undefined;
      const replaceExisting =
        req.body?.replaceExisting !== undefined
          ? req.body.replaceExisting === true
          : mode === "restore";
      const runImport = () => importLegacySqliteIntoUnifiedDb(db, bytes, {
        workspaceId: uid,
        fileName,
        groupCategories,
        replaceExisting,
      });
      const result = replaceExisting ? withApprovedRestore(db, uid, req.body?.restoreToken, runImport) : runImport();
      res.json({ result, bundle: getFullWorkspaceBundle(db, uid) });
    }),
  );

  router.post(
    "/workspace/:uid/legacy/merge-master",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const accounts = Array.isArray(req.body?.accounts) ? (req.body.accounts as AccountRecord[]) : [];
      const warehouses = Array.isArray(req.body?.warehouses) ? (req.body.warehouses as WarehouseRecord[]) : [];
      const inventory = Array.isArray(req.body?.inventory) ? (req.body.inventory as InventoryItemRecord[]) : [];

      const counts = withTransaction(db, () => {
        const now = new Date().toISOString();
        let accountsAdded = 0;
        let warehousesAdded = 0;
        let inventoryAdded = 0;

        const insWh = db.prepare(
          `INSERT INTO warehouses (id, workspace_id, code_number, name, details, is_default, state, legacy_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        );
        for (const w of warehouses) {
          const r = insWh.run(w.id, uid, w.codeNumber, w.name, w.details ?? "", w.isDefault ? 1 : 0, w.legacyRef ?? null, now, now);
          if (Number(r.changes) > 0) warehousesAdded += 1;
        }

        const insAcc = db.prepare(
          `INSERT INTO accounts (
             id, workspace_id, code_number, name, category, phone, credit_limit, currency,
             is_cash_account, account_image, sort_order, settlement, document_number_required,
             message_method, send_mode, note, opening_balance, opening_direction, legacy_ref, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        );
        for (const a of accounts) {
          const r = insAcc.run(
            a.id, uid, a.codeNumber, a.name, a.category, a.phone ?? "", a.creditLimit ?? 0, a.currency ?? "ريال",
            a.isCashAccount ? 1 : 0, a.accountImage ?? "1", a.sortOrder ?? 1, a.settlement ? 1 : 0,
            a.documentNumberRequired ? 1 : 0, a.messageMethod ?? "sms", a.sendMode ?? "never", a.note ?? "",
            a.openingBalance ?? 0, a.openingDirection ?? "debit", a.legacyRef ?? null, now, now,
          );
          if (Number(r.changes) > 0) accountsAdded += 1;
        }

        const insInv = db.prepare(
          `INSERT INTO inventory_items (
             id, workspace_id, warehouse_id, name, unit, quantity, avg_cost, selling_price,
             min_threshold, sku, quantity_unverified, legacy_ref, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        );
        for (const i of inventory) {
          const r = insInv.run(
            i.id, uid, i.warehouseId, i.name, i.unit ?? "حبة", i.quantity ?? 0, i.avgCost ?? 0,
            i.sellingPrice ?? null, i.minThreshold ?? 25, i.sku ?? "", i.quantityUnverified ? 1 : 0,
            i.legacyRef ?? null, now, now,
          );
          if (Number(r.changes) > 0) inventoryAdded += 1;
        }

        writeAudit(db, uid, uid, "legacy_merge", "batch", "merge", { accountsAdded, warehousesAdded, inventoryAdded });
        return { accountsAdded, warehousesAdded, inventoryAdded };
      });
      res.json(counts);
    }),
  );

  router.post(
    "/workspace/:uid/legacy/post-entries",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      const entries = Array.isArray(req.body?.entries) ? (req.body.entries as LedgerEntryRecord[]) : [];
      const wsRow = db
        .prepare("SELECT closed_until_date FROM workspaces WHERE id = ?")
        .get(uid) as { closed_until_date?: string | null } | undefined;
      const closedUntil = wsRow?.closed_until_date?.trim() || "";
      const findAccount = db.prepare("SELECT id FROM accounts WHERE workspace_id = ? AND id = ?");

      const out = withTransaction(db, () => {
        const ins = db.prepare(
          `INSERT INTO ledger_entries (
             id, workspace_id, account_id, account_name, counterpart_account_id, counterpart_account_name,
             kind, type_label, payment, direction, amount, raw_dain, raw_madin, currency, exchange_rate, details, document_number,
             warehouse_id, warehouse_name, invoice_content, entry_number, deleted, entry_date,
             source_origin, posting_status, created_at_ms, legacy_ref
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy_sqlite', 'posted', ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        );
        let added = 0;
        let skippedDuplicates = 0;
        for (const e of entries) {
          if (!e || typeof e.id !== "string" || !e.id.trim()) {
            throw new SqliteValidationError("معرف القيد مطلوب لكل سجل مستورد.");
          }
          if (!e.accountId || !findAccount.get(uid, e.accountId)) {
            throw new SqliteValidationError(`الحساب (${String(e.accountId ?? "")}) غير موجود في مساحة العمل.`);
          }
          if (!isStrictlyFiniteNumeric(e.amount) || Number(e.amount) < 0) {
            throw new SqliteValidationError(`مبلغ القيد (${e.id}) غير صالح أو سالب.`);
          }
          const rate = e.exchangeRate ?? 1;
          if (!isStrictlyFiniteNumeric(rate) || Number(rate) <= 0) {
            throw new SqliteValidationError(`سعر الصرف للقيد (${e.id}) يجب أن يكون أكبر من صفر.`);
          }
          const entryDate = String(e.entryDate ?? "").trim();
          if (closedUntil && entryDate && entryDate <= closedUntil) {
            throw new SqliteValidationError(
              `لا يمكن ترحيل القيد (${e.id}) بتاريخ (${entryDate}) لأنه يقع ضمن فترة مالية مغلقة حتى ${closedUntil}.`,
            );
          }
          const cleanAmount = roundMoney(Number(e.amount), 2);
          const dir = e.direction === "credit" ? "credit" : "debit";
          const rawDain = dir === "debit" ? cleanAmount : 0;
          const rawMadin = dir === "credit" ? cleanAmount : 0;
          const r = ins.run(
            e.id.trim(), uid, e.accountId, String(e.accountName ?? "").slice(0, 140),
            String(e.counterpartAccountId ?? ""), String(e.counterpartAccountName ?? "").slice(0, 140),
            e.kind || "voucher", String(e.typeLabel ?? "").slice(0, 60), e.payment || "balance", dir,
            cleanAmount, rawDain, rawMadin, e.currency || "ريال", Number(rate),
            String(e.details ?? "").slice(0, 500), String(e.documentNumber ?? "").slice(0, 80),
            String(e.warehouseId ?? ""), String(e.warehouseName ?? "").slice(0, 120),
            e.invoiceContent ?? "none", Number(e.entryNumber ?? 1), e.deleted ? 1 : 0, entryDate,
            Number(e.createdAtMs ?? Date.now()), e.legacyRef ?? null,
          );
          if (Number(r.changes) > 0) added += 1;
          else skippedDuplicates += 1;
        }
        writeAudit(db, uid, uid, "legacy_post_entries", "batch", "post", { added, skippedDuplicates });
        return { added, skippedDuplicates };
      });
      res.json(out);
    }),
  );

  router.post(
    "/workspace/:uid/legacy/rollback/:prefix",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const prefix = paramStr(req, "prefix").trim();
      if (!/^[a-zA-Z0-9_-]{6,64}$/.test(prefix)) {
        throw new HttpError(400, "معرف دفعة الترحيل غير صالح.");
      }
      const like = `${prefix}_%`;
      const counts = withTransaction(db, () => {
        const ledgerRemoved = Number(db.prepare("DELETE FROM ledger_entries WHERE workspace_id = ? AND id LIKE ?").run(uid, like).changes);
        const inventoryRemoved = Number(db.prepare("DELETE FROM inventory_items WHERE workspace_id = ? AND id LIKE ?").run(uid, like).changes);
        const accountsRemoved = Number(db.prepare("DELETE FROM accounts WHERE workspace_id = ? AND id LIKE ?").run(uid, like).changes);
        const warehousesRemoved = Number(db.prepare("DELETE FROM warehouses WHERE workspace_id = ? AND id LIKE ?").run(uid, like).changes);
        writeAudit(db, uid, uid, "legacy_rollback", prefix, "rollback", {
          accountsRemoved, warehousesRemoved, inventoryRemoved, ledgerRemoved,
        });
        return { accountsRemoved, warehousesRemoved, inventoryRemoved, ledgerRemoved };
      });
      res.json(counts);
    }),
  );

  router.get(
    "/workspace/:uid/tables",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      ensureEmptyWorkspace(db, uid);
      res.json({ tables: listUnifiedTablesMeta(db, uid), stats: getDbStats(db, uid) });
    }),
  );

  router.get(
    "/workspace/:uid/tables/:table",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const table = paramStr(req, "table").trim();
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = Number(req.query.limit) || 40;
      const offset = Number(req.query.offset) || 0;
      try {
        res.json(queryUnifiedTable(db, uid, table, q, limit, offset));
      } catch (err) {
        throw new HttpError(404, err instanceof Error ? err.message : "الجدول غير موجود.");
      }
    }),
  );

  type PendingUpload = {
    uid: string;
    dir: string;
    filePath: string;
    size: number;
    createdAt: number;
  };
  const MAX_CHUNKED_UPLOAD_BYTES = 256 * 1024 * 1024;
  const UPLOAD_TTL_MS = 15 * 60_000;
  const pendingUploads = new Map<string, PendingUpload>();

  const prunePendingUploads = () => {
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const [id, item] of pendingUploads.entries()) {
      if (item.createdAt < cutoff) {
        pendingUploads.delete(id);
        fs.rmSync(item.dir, { recursive: true, force: true });
      }
    }
  };

  router.post(
    "/workspace/:uid/restore/upload/init",
    route((req, res) => {
      const uid = validWsId(paramStr(req, "uid"));
      prunePendingUploads();
      const uploadId = crypto.randomBytes(16).toString("hex");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nasqo-chunked-"));
      const filePath = path.join(dir, "payload.bin");
      fs.writeFileSync(filePath, Buffer.alloc(0));
      pendingUploads.set(uploadId, { uid, dir, filePath, size: 0, createdAt: Date.now() });
      res.status(201).json({ uploadId });
    }),
  );

  router.post(
    "/workspace/:uid/restore/upload/:uploadId/chunk",
    express.raw({ type: "application/octet-stream", limit: "16mb" }),
    route((req, res) => {
      const uid = validWsId(paramStr(req, "uid"));
      const uploadId = paramStr(req, "uploadId").trim();
      const entry = pendingUploads.get(uploadId);
      if (!entry || entry.uid !== uid) {
        throw new HttpError(404, "جلسة الرفع غير موجودة أو منتهية الصلاحية.");
      }
      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (chunk.length === 0) {
        throw new HttpError(400, "الدفعة المرسلة فارغة.");
      }
      if (entry.size + chunk.length > MAX_CHUNKED_UPLOAD_BYTES) {
        pendingUploads.delete(uploadId);
        fs.rmSync(entry.dir, { recursive: true, force: true });
        throw new HttpError(413, "حجم ملف النسخة الاحتياطية يتجاوز الحد الأقصى المسموح (256 ميجابايت).");
      }
      fs.appendFileSync(entry.filePath, chunk);
      entry.size += chunk.length;
      res.json({ ok: true, bytesReceived: entry.size });
    }),
  );

  router.post(
    "/workspace/:uid/restore/upload/:uploadId/commit",
    route((req, res, db) => {
      const uid = validWsId(paramStr(req, "uid"));
      const uploadId = paramStr(req, "uploadId").trim();
      const entry = pendingUploads.get(uploadId);
      if (!entry || entry.uid !== uid) {
        throw new HttpError(404, "جلسة الرفع غير موجودة أو منتهية الصلاحية.");
      }
      pendingUploads.delete(uploadId);
      try {
        let rawBuffer: Buffer = fs.readFileSync(entry.filePath);
        if (rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
          try {
            rawBuffer = zlib.gunzipSync(rawBuffer);
          } catch {
            throw new HttpError(400, "تعذر فك ضغط ملف النسخة المضغوط (gzip).");
          }
        }
        const kind = req.body?.kind === "sql" ? "sql" : req.body?.kind === "json" ? "json" : "sqlite";
        const fileName =
          typeof req.body?.fileName === "string" && req.body.fileName.trim()
            ? req.body.fileName.slice(0, 120)
            : "backup";

        if (kind === "sql") {
          const sqlText = rawBuffer.toString("utf8").replace(/^\uFEFF/, "");
          if (!sqlText || sqlText.length < 50) {
            throw new HttpError(400, "محتوى ملف SQL فارغ أو غير صالح.");
          }
          const runImport = () => importSmartProSqlDump(db, sqlText, {
            workspaceId: uid,
            sourceName: fileName,
            replaceExisting: Boolean(req.body?.replaceExisting ?? true),
          });
          const report = Boolean(req.body?.replaceExisting ?? true) ? withApprovedRestore(db, uid, req.body?.restoreToken, runImport) : runImport();
          res.json({ report, bundle: getFullWorkspaceBundle(db, uid) });
          return;
        }

        if (kind === "json") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawBuffer.toString("utf8").replace(/^\uFEFF/, ""));
          } catch {
            throw new HttpError(400, "تعذر تحليل ملف JSON الخاص بالنسخة الاحتياطية.");
          }
          const payload =
            parsed && typeof parsed === "object" && !Array.isArray(parsed) && "payload" in parsed
              ? (parsed as { payload: unknown }).payload
              : parsed;
          const restored = withApprovedRestore(db, uid, req.body?.restoreToken, () => restoreUnifiedJsonBundle(db, uid, payload));
          res.json({ restored, bundle: getFullWorkspaceBundle(db, uid) });
          return;
        }

        const bytes = new Uint8Array(rawBuffer);
        const mode = req.body?.mode === "inspect" ? "inspect" : req.body?.mode === "restore" ? "restore" : "import";
        if (mode === "inspect") {
          const extracted = inspectAndExtractLegacySqlite(bytes);
          res.json({
            sha256: extracted.sha256,
            integrity: extracted.integrity,
            tables: Object.keys(extracted.tableCounts),
            tableCounts: extracted.tableCounts,
            totalRows: extracted.totalRows,
            evidence: extracted.evidence,
            reviewSummary: extracted.reviewSummary,
          });
          return;
        }
        const groupCategories =
          req.body?.groupCategories && typeof req.body.groupCategories === "object"
            ? (req.body.groupCategories as Record<string, AccountCategory>)
            : undefined;
        const replaceExisting =
          req.body?.replaceExisting !== undefined
            ? req.body.replaceExisting === true
            : mode === "restore";
        const runImport = () => importLegacySqliteIntoUnifiedDb(db, bytes, {
          workspaceId: uid,
          fileName,
          groupCategories,
          replaceExisting,
        });
        const result = replaceExisting ? withApprovedRestore(db, uid, req.body?.restoreToken, runImport) : runImport();
        res.json({ result, bundle: getFullWorkspaceBundle(db, uid) });
      } finally {
        fs.rmSync(entry.dir, { recursive: true, force: true });
      }
    }),
  );

  // Always return structured JSON on Express middleware errors (e.g. PayloadTooLargeError 413, SyntaxError 400)
  // so the client never receives an Express HTML error page.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const errObj = err && typeof err === "object" ? (err as { status?: unknown; statusCode?: unknown; type?: unknown }) : {};
    const status =
      typeof errObj.status === "number"
        ? errObj.status
        : typeof errObj.statusCode === "number"
          ? errObj.statusCode
          : 500;
    if (status === 413 || errObj.type === "entity.too.large") {
      res.status(413).json({ error: "حجم الطلب يتجاوز الحد المسموح على الخادم." });
      return;
    }
    if (status === 400 && err instanceof SyntaxError) {
      res.status(400).json({ error: "تعذر قراءة بيانات الطلب: صيغة JSON غير صالحة." });
      return;
    }
    const msg = err instanceof Error && err.message ? err.message : "خطأ غير متوقع في خادم قاعدة SQLite.";
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  });

  app.use("/api/db", router);
}
