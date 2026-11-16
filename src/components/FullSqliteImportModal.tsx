import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import {
  LegacyDatabaseAdapter,
  type DistinctValueReport,
  type ImplicitRelation,
  type SchemaReport,
  type Tables,
} from "../legacy/adapter";
import {
  assertBalanced,
  billTypeEvidence,
  findDuplicates,
  planVoucherPosting,
  reviewMoves,
  ROLE_LABELS,
  suggestedRoleMapping,
  type BillTypeEvidence,
  type DirectionPolicy,
  type DocumentRole,
  type DuplicateReport,
  type MoveReview,
  type RoleMapping,
} from "../legacy/analysis";
import {
  exportFullBackupBundle,
  verifyAndStageFullBackupRestore,
  type RestoreVerification,
} from "../legacy/backup";
import {
  buildLedgerEntries,
  buildMasterData,
  diffMasterAgainstLive,
  livePrefix,
  suggestGroupCategories,
  type GroupSuggestion,
} from "../legacy/live";
import {
  addJournal,
  archiveBatchId,
  getBatch,
  getSetting,
  getSource,
  importArchive,
  listBatches,
  listJournal,
  listSources,
  openCenterDb,
  putBatch,
  putIdMap,
  putSetting,
  putSource,
  rollbackBatch,
  type BatchRecord,
  type JournalEntry,
  type SourceMeta,
} from "../legacy/store";
import { CURRENCIES, type AccountCategory, type AccountRecord, type InventoryItemRecord, type LedgerEntryRecord, type WarehouseRecord, type WorkspaceSettings } from "../types";
import {
  mergeLegacyMasterBatch,
  postLegacyLedgerBatch,
  rollbackLegacyLivePrefix,
} from "../firebase";
import { LegacyReconciliationView } from "./LegacyReconciliationView";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  liveWorkspace: WorkspaceSettings | null;
  liveAccounts: readonly AccountRecord[];
  liveWarehouses: readonly WarehouseRecord[];
  liveInventory: readonly InventoryItemRecord[];
  liveLedger: readonly LedgerEntryRecord[];
  onNotify: (message: string) => void;
};

type CenterTab = "overview" | "preview" | "mapping" | "reconciliation" | "history";

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  clients: "العملاء",
  purchases: "المشتريات والموردين",
  sales: "المبيعات",
  employees: "الموظفين",
  transfers: "التحويلات",
  shop: "المحل والأصول",
};

export function FullSqliteImportModal({
  open,
  onClose,
  workspaceId,
  liveWorkspace,
  liveAccounts,
  liveWarehouses,
  liveInventory,
  liveLedger,
  onNotify,
}: Props) {
  const [tab, setTab] = useState<CenterTab>("overview");
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Loaded SQLite file state
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [schema, setSchema] = useState<SchemaReport | null>(null);
  const [tables, setTables] = useState<Tables | null>(null);
  const [relations, setRelations] = useState<ImplicitRelation[]>([]);
  const [distincts, setDistincts] = useState<DistinctValueReport[]>([]);
  const [evidence, setEvidence] = useState<BillTypeEvidence[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const [reviews, setReviews] = useState<MoveReview[]>([]);

  // Mapping & policy settings
  const [roles, setRoles] = useState<RoleMapping>({});
  const [groupSuggestions, setGroupSuggestions] = useState<GroupSuggestion[]>([]);
  const [groupCategories, setGroupCategories] = useState<Record<string, AccountCategory>>({});
  const [policy, setPolicy] = useState<DirectionPolicy | null>(null);
  const [confirmPosting, setConfirmPosting] = useState(false);

  // Table preview state
  const [selectedTable, setSelectedTable] = useState("input_move");
  const [previewPage, setPreviewPage] = useState(0);
  const pageSize = 35;

  // IndexedDB state
  const [savedSources, setSavedSources] = useState<SourceMeta[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [restoreVerification, setRestoreVerification] = useState<RestoreVerification | null>(null);

  const refreshCenterHistory = async () => {
    try {
      const db = await openCenterDb();
      try {
        const [srcs, bts, jrn] = await Promise.all([listSources(db), listBatches(db), listJournal(db)]);
        setSavedSources(srcs);
        setBatches(bts);
        setJournal(jrn.slice(-60).reverse());
      } finally {
        db.close();
      }
    } catch {
      // ignore outside browser
    }
  };

  useEffect(() => {
    if (open) {
      void refreshCenterHistory();
    } else {
      setError("");
      setNotice("");
      setConfirmPosting(false);
      // IndexedDB is authoritative. Do not pin ~26k source rows and SQLite
      // bytes in mobile RAM for the entire lifetime of the app after closing.
      setRawBytes(null);
      setSchema(null);
      setTables(null);
      setRelations([]);
      setDistincts([]);
      setEvidence([]);
      setDuplicates(null);
      setReviews([]);
      setGroupSuggestions([]);
      setRestoreVerification(null);
    }
  }, [open]);

  const loadSqliteBytes = async (bytes: Uint8Array, fileName: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    setProgressText("جاري فتح قاعدة SQLite وفحص المخطط والعلاقات...");
    try {
      const adapter = await LegacyDatabaseAdapter.open(bytes, fileName);
      try {
        const sc = adapter.schema();
        const tbls = adapter.loadAll();
        const rels = adapter.discoverRelations(tbls, sc);
        const dist = adapter.distinctValues(tbls);
        const ev = billTypeEvidence(tbls);
        const dup = findDuplicates(tbls);
        const rev = reviewMoves(tbls).reviews;
        const grp = suggestGroupCategories(tbls);

        const defaultCats: Record<string, AccountCategory> = {};
        for (const g of grp) defaultCats[String(g.groupId)] = g.category;

        setRawBytes(bytes);
        setSchema(sc);
        setTables(tbls);
        setRelations(rels);
        setDistincts(dist);
        setEvidence(ev);
        setDuplicates(dup);
        setReviews(rev);
        // Reopening the same database must retain user-reviewed mappings.
        const centerDb = await openCenterDb();
        try {
          setRoles((await getSetting<RoleMapping>(centerDb, `roles:${sc.sha256}`)) ?? suggestedRoleMapping(ev));
          setGroupCategories((await getSetting<Record<string, AccountCategory>>(centerDb, `groups:${sc.sha256}`)) ?? defaultCats);
        } finally {
          centerDb.close();
        }
        setGroupSuggestions(grp);
        setSelectedTable(sc.tables.find((t) => t.name === "input_move")?.name ?? sc.tables[0]?.name ?? "");
        setPreviewPage(0);
        setNotice(`تم فتح قاعدة البيانات بنجاح: ${sc.tableCount} جدولًا و ${sc.totalRows.toLocaleString("en-US")} سجل (السلامة: ${sc.integrity}).`);
      } finally {
        adapter.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر قراءة ملف SQLite.");
      setSchema(null);
      setTables(null);
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadSqliteBytes(bytes, file.name);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadSqliteBytes(bytes, file.name);
  };

  const masterPreview = useMemo(() => {
    if (!tables || !schema) return null;
    const master = buildMasterData(tables, schema.sha256, workspaceId, groupCategories);
    const diff = diffMasterAgainstLive(master, {
      accounts: liveAccounts,
      warehouses: liveWarehouses,
      inventory: liveInventory,
      ledger: liveLedger,
    });
    return { master, diff };
  }, [tables, schema, workspaceId, groupCategories, liveAccounts, liveWarehouses, liveInventory, liveLedger]);

  const postingPlan = useMemo(() => {
    if (!tables || !schema) return null;
    const prefix = livePrefix(schema.sha256);
    const migratedCustomerIds = new Set<number>();
    for (const acc of liveAccounts) {
      if (acc.id.startsWith(`${prefix}_acc_`)) {
        migratedCustomerIds.add(acc.codeNumber);
      }
    }
    return planVoucherPosting(
      tables,
      policy,
      CURRENCIES,
      migratedCustomerIds.size > 0 ? migratedCustomerIds : null,
    );
  }, [tables, schema, policy, liveAccounts]);

  // Mode A: Save Exact Original Replica
  const handleSaveOriginalSource = async () => {
    if (!rawBytes || !schema || busy) return;
    setBusy(true);
    setError("");
    try {
      const db = await openCenterDb();
      try {
        const res = await putSource(db, {
          sha256: schema.sha256,
          fileName: schema.fileName,
          size: rawBytes.byteLength,
          bytes: rawBytes,
          savedAt: new Date().toISOString(),
          integrity: schema.integrity,
          tableCounts: Object.fromEntries(schema.tables.map((t) => [t.name, t.rowCount])),
          totalRows: schema.totalRows,
        });
        await addJournal(db, {
          batchId: `source:${schema.sha256}`,
          level: "info",
          message: res.existed
            ? `النسخة الأصلية (${schema.fileName}) محفوظة مسبقًا بالبصمة ${schema.sha256.slice(0, 12)}`
            : `تم حفظ النسخة الأصلية (${schema.fileName}) بايتًا ببايت (${rawBytes.byteLength} بايت)`,
        });
        setNotice(
          res.existed
            ? "النسخة الأصلية محفوظة مسبقًا في المخزن المستقل (منع التكرار)."
            : `تم حفظ النسخة الأصلية المطابقة بنجاح (${rawBytes.byteLength.toLocaleString("en-US")} بايت).`,
        );
        onNotify("تم حفظ النسخة الأصلية المطابقة بنجاح.");
      } finally {
        db.close();
      }
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ النسخة الأصلية.");
    } finally {
      setBusy(false);
    }
  };

  // Export Exact Original Replica
  const handleExportOriginalSource = async (targetSha?: string) => {
    const sha = targetSha || schema?.sha256;
    if (!sha) return;
    setBusy(true);
    setError("");
    try {
      const db = await openCenterDb();
      try {
        const src = await getSource(db, sha);
        if (!src) throw new Error("احفظ النسخة الأصلية أولًا قبل تصديرها.");
        const blob = new Blob([src.bytes as unknown as BlobPart], { type: "application/x-sqlite3" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = src.fileName.endsWith(".sqlite") || src.fileName.endsWith(".db") || src.fileName.endsWith(".back")
          ? src.fileName
          : `${src.fileName}.sqlite`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(`تم تصدير النسخة الأصلية (${src.fileName}) بالبصمة ${src.sha256.slice(0, 16)}...`);
      } finally {
        db.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تصدير النسخة الأصلية.");
    } finally {
      setBusy(false);
    }
  };

  // Mode B: Import Historical Archive (all 26,001 rows, chunked atomic)
  const handleImportHistoricalArchive = async () => {
    if (!tables || !schema || busy) return;
    setBusy(true);
    setError("");
    setProgressText("جاري أرشفة جميع السجلات التاريخية في IndexedDB...");
    try {
      const db = await openCenterDb();
      try {
        await putSetting(db, `roles:${schema.sha256}`, roles);
        await putSetting(db, `groups:${schema.sha256}`, groupCategories);
        const res = await importArchive(db, schema.sha256, tables, {
          chunkSize: 2000,
          note: schema.fileName,
          onProgress: ({ written, total }) =>
            setProgressText(`تمت أرشفة ${written.toLocaleString("en-US")} من ${total.toLocaleString("en-US")} سجلًا...`),
        });
        await putSetting(db, `activeArchive:${workspaceId}`, schema.sha256);
        setNotice(
          res.duplicate
            ? "هذا الأرشيف التاريخي مستورد مسبقًا ومكتمل (منع التكرار)."
            : `تم استيراد كامل الأرشيف التاريخي (${res.batch.total.toLocaleString("en-US")} سجلًا) دون تعديل الأستاذ العام.`,
        );
        onNotify("تم استيراد الأرشيف التاريخي الكامل بنجاح.");
      } finally {
        db.close();
      }
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل استيراد الأرشيف التاريخي.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  // Explicit one-click non-posting import. Each stage is restartable by stable source IDs.
  // A failed step leaves the original bytes and the completed archive untouched.
  const handleImportAndShow = async () => {
    if (!schema || !tables || !rawBytes || !masterPreview || busy) return;
    setBusy(true);
    setError("");
    setProgressText("1/3: حفظ الملف الأصلي واستيراد سجلات الأرشيف...");
    try {
      const db = await openCenterDb();
      try {
        await putSource(db, {
          sha256: schema.sha256,
          fileName: schema.fileName,
          size: rawBytes.byteLength,
          bytes: rawBytes,
          savedAt: new Date().toISOString(),
          integrity: schema.integrity,
          tableCounts: Object.fromEntries(schema.tables.map((t) => [t.name, t.rowCount])),
          totalRows: schema.totalRows,
        });
        await putSetting(db, `roles:${schema.sha256}`, roles);
        await putSetting(db, `groups:${schema.sha256}`, groupCategories);
        await importArchive(db, schema.sha256, tables, {
          chunkSize: 2000,
          note: schema.fileName,
          onProgress: ({ written, total }) => setProgressText(`1/3: أرشفة ${written.toLocaleString("en-US")} من ${total.toLocaleString("en-US")} سجلًا...`),
        });
        await putSetting(db, `activeArchive:${workspaceId}`, schema.sha256);
      } finally { db.close(); }

      setProgressText("2/3: إظهار الحسابات والأصناف والمخازن في شاشات نسق برو...");
      const master = masterPreview.master;
      const result = await mergeLegacyMasterBatch(workspaceId, {
        accounts: master.accounts, warehouses: master.warehouses, inventory: master.inventory,
      });

      setProgressText("3/3: توثيق المعرفات ونتيجة الاستيراد...");
      const audit = await openCenterDb();
      try {
        const batchId = `master:${schema.sha256}`;
        await putIdMap(audit, batchId, master.idMap.map((r) => ({ kind: r.kind, legacyId: r.legacyId, liveId: r.liveId })));
        await putBatch(audit, {
          batchId, kind: "master", sha256: schema.sha256, status: "complete",
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          total: master.accounts.length + master.warehouses.length + master.inventory.length,
          nextIndex: master.accounts.length + master.warehouses.length + master.inventory.length,
          tableCounts: { accounts: result.accountsAdded, warehouses: result.warehousesAdded, inventory: result.inventoryAdded },
          counts: result,
        });
        await addJournal(audit, { batchId, level: "info", message: `استيراد آمن ومتكامل: ${schema.totalRows} سجلًا تاريخيًا، ${result.accountsAdded} حسابًا، ${result.inventoryAdded} صنفًا، ${result.warehousesAdded} مخزنًا. القيود غير مرحّلة.` });
      } finally { audit.close(); }
      setNotice(`تم حفظ الأرشيف وإظهار البيانات: ${result.accountsAdded} حسابًا جديدًا، ${result.inventoryAdded} صنفًا، ${result.warehousesAdded} مخزنًا. يمكن إعادة الاستيراد دون تكرار. جميع القيود والفواتير غير مُرحّلة محاسبيًا.`);
      onNotify("تم حفظ الأرشيف وربط الحسابات والمخازن والأصناف بواجهات التطبيق.");
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إكمال الاستيراد المتكامل. يمكن إعادة المحاولة دون حذف بياناتك.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  // Save reviewed classifications independently of re-importing the same source.
  const handleSaveMappings = async () => {
    if (!schema || busy) return;
    setBusy(true);
    setError("");
    try {
      const db = await openCenterDb();
      try {
        await putSetting(db, `roles:${schema.sha256}`, roles);
        await putSetting(db, `groups:${schema.sha256}`, groupCategories);
        setNotice("حُفظت تصنيفات المستندات والحسابات في هذا المتصفح. لم يُرحَّل أي قيد مالي.");
      } finally { db.close(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حفظ التصنيفات.");
    } finally { setBusy(false); }
  };

  // Mode C1: Migrate Master Data (Customers, Stores, Products)
  const handleMigrateMasterData = async () => {
    if (!masterPreview || !schema || busy) return;
    setBusy(true);
    setError("");
    setProgressText("جاري ترحيل العملاء والمخازن والأصناف إلى وحدات نسق برو...");
    try {
      // Require a complete historical archive before publishing master records.
      const center = await openCenterDb();
      try {
        const archive = await getBatch(center, archiveBatchId(schema.sha256));
        if (!archive || archive.status !== "complete") {
          throw new Error("استورد الأرشيف التاريخي (الزر ب) أولًا، ثم أظهر العملاء والأصناف والمخازن.");
        }
      } finally { center.close(); }
      const { master } = masterPreview;
      const result = await mergeLegacyMasterBatch(workspaceId, {
        accounts: master.accounts,
        warehouses: master.warehouses,
        inventory: master.inventory,
      });

      const db = await openCenterDb();
      try {
        const batchId = `master:${schema.sha256}`;
        await putSetting(db, `activeArchive:${workspaceId}`, schema.sha256);
        await putIdMap(
          db,
          batchId,
          master.idMap.map((m) => ({ kind: m.kind, legacyId: m.legacyId, liveId: m.liveId })),
        );
        await putBatch(db, {
          batchId,
          kind: "master",
          sha256: schema.sha256,
          status: "complete",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          total: master.accounts.length + master.warehouses.length + master.inventory.length,
          nextIndex: master.accounts.length + master.warehouses.length + master.inventory.length,
          tableCounts: {
            accounts: result.accountsAdded,
            warehouses: result.warehousesAdded,
            inventory: result.inventoryAdded,
          },
          counts: result,
        });
        await addJournal(db, {
          batchId,
          level: "info",
          message: `ترحيل البيانات الأساسية: أضيف ${result.accountsAdded} حسابًا، ${result.warehousesAdded} مخزنًا، ${result.inventoryAdded} صنفًا (رصيد المخزون معلم للمطابقة).`,
        });
      } finally {
        db.close();
      }

      setNotice(
        `تم ترحيل البيانات الأساسية: +${result.accountsAdded} حساب، +${result.warehousesAdded} مخزن، +${result.inventoryAdded} صنف. (تم تمييز أرصدة الأصناف كـ «بحاجة إلى تسوية»).`,
      );
      onNotify("تم ترحيل العملاء والمخازن والأصناف إلى التطبيق.");
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل ترحيل البيانات الأساسية.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  // Mode C2: Post Verified Balanced Vouchers ONLY
  const handlePostBalancedVouchers = async () => {
    if (!postingPlan || !schema || !tables || !policy || !confirmPosting || busy) return;
    const eligibleDrafts = postingPlan.groups.filter((g) => g.status === "eligible").flatMap((g) => g.drafts);
    if (eligibleDrafts.length === 0) {
      setError("لا توجد قيود مؤهلة متوازنة للترحيل (راجع شاشة مطابقة القيود).");
      return;
    }

    setBusy(true);
    setError("");
    setProgressText("جاري التحقق النهائي من توازن القيود قبل الكتابة...");
    try {
      // Guard: debit must equal credit per group and currency
      assertBalanced(eligibleDrafts);

      const prefix = livePrefix(schema.sha256);
      const accountLiveIds = new Map<number, string>();
      const accountNames = new Map<number, string>();
      for (const acc of liveAccounts) {
        if (acc.id.startsWith(`${prefix}_acc_`)) {
          accountLiveIds.set(acc.codeNumber, acc.id);
          accountNames.set(acc.codeNumber, acc.name);
        }
      }

      const ledgerRecords = buildLedgerEntries(eligibleDrafts, schema.sha256, workspaceId, accountLiveIds, accountNames);
      const posted = await postLegacyLedgerBatch(workspaceId, ledgerRecords);

      const db = await openCenterDb();
      try {
        const batchId = `posting:${schema.sha256}`;
        await putSetting(db, `policy:${schema.sha256}`, policy);
        await putBatch(db, {
          batchId,
          kind: "posting",
          sha256: schema.sha256,
          status: "complete",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          total: ledgerRecords.length,
          nextIndex: ledgerRecords.length,
          tableCounts: { ledger: posted.added },
          counts: posted,
        });
        await addJournal(db, {
          batchId,
          level: "info",
          message: `ترحيل القيود المتوازنة فقط: ${posted.added} قيدًا (تخطي المكرر: ${posted.skippedDuplicates}). رُفض ${postingPlan.rejectedGroups} مجموعة غير متوازنة.`,
        });
      } finally {
        db.close();
      }

      setNotice(`تم ترحيل ${posted.added} قيدًا متوازنًا فقط بعد التحقق (تخطي ${posted.skippedDuplicates} مكررًا).`);
      onNotify(`تم ترحيل ${posted.added} قيدًا متوازنًا إلى اليومية.`);
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "رُفض الترحيل بسبب عدم التوازن أو نقص البيانات.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  };

  // Rollback batch
  const handleRollbackBatch = async (batch: BatchRecord) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const db = await openCenterDb();
      try {
        await rollbackBatch(db, batch.batchId);
      } finally {
        db.close();
      }
      if (batch.kind === "master" || batch.kind === "posting") {
        const removed = await rollbackLegacyLivePrefix(workspaceId, livePrefix(batch.sha256));
        setNotice(
          `تم التراجع عن الدفعة دون المساس ببيانات المستخدم: حُذف ${removed.accountsRemoved} حساب، ${removed.warehousesRemoved} مخزن، ${removed.inventoryRemoved} صنف، ${removed.ledgerRemoved} قيد.`,
        );
      } else {
        setNotice(`تم التراجع عن دفعة الأرشيف ${batch.batchId} بنجاح.`);
      }
      await refreshCenterHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التراجع عن الدفعة.");
    } finally {
      setBusy(false);
    }
  };

  // Export Audit Report
  const handleExportAuditReport = () => {
    if (!schema) return;
    const report = {
      generatedAt: new Date().toISOString(),
      schema,
      implicitRelations: relations,
      billTypeEvidence: evidence,
      duplicates,
      reconciliationSummary: reviews.length ? reviewMoves(tables ?? {}).reviews.length : 0,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nasqo-legacy-audit-${schema.sha256.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Export Full Backup Bundle
  const handleExportFullBundle = async () => {
    setBusy(true);
    setError("");
    try {
      const db = await openCenterDb();
      try {
        const bundle = await exportFullBackupBundle(
          db,
          {
            workspace: liveWorkspace,
            accounts: [...liveAccounts],
            warehouses: [...liveWarehouses],
            inventory: [...liveInventory],
            ledger: [...liveLedger],
          },
          schema?.sha256,
        );
        const blob = new Blob([JSON.stringify(bundle)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nasqo-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(`تم تصدير النسخة الاحتياطية الكاملة ببصمة ${bundle.bundleSha256.slice(0, 16)}...`);
      } finally {
        db.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تصدير النسخة الاحتياطية الكاملة.");
    } finally {
      setBusy(false);
    }
  };

  // Verify & Stage Full Backup Restore
  const handleRestoreBundleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setRestoreVerification(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = await verifyAndStageFullBackupRestore(parsed);
      setRestoreVerification(res.verification);
      if (res.verification.valid) {
        setNotice("تم فحص النسخة الاحتياطية وعزلها في قاعدة الاستعادة المستقلة بنجاح دون استبدال بياناتك الحية.");
      } else {
        setError(`فشل التحقق من النسخة الاحتياطية: ${res.verification.errors.join(" | ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر فحص ملف النسخة الاحتياطية.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const previewRows = tables?.[selectedTable] ?? [];
  const previewCols = previewRows.length
    ? Object.keys(previewRows[0]).filter((k) => k !== "__rowid__")
    : schema?.tables.find((t) => t.name === selectedTable)?.columns.map((c) => c.name) ?? [];

  return (
    <div className="center-modal-layer" dir="rtl" style={{ zIndex: 100000 }}>
      <button type="button" className="center-modal-backdrop" aria-label="إغلاق مركز الترحيل" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-center-title"
        style={{
          position: "relative",
          zIndex: 100001,
          width: "min(97vw, 980px)",
          maxHeight: "93vh",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          color: "#1e293b",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div>
            <h2 id="migration-center-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
              مركز استيراد وترحيل قواعد البيانات
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
              قراءة وتحليل SQLite الأصلية • حفظ نسخة مطابقة بايتًا ببايت • أرشيف تاريخي كامل • ترحيل محاسبي معتمد
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "#e2e8f0", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontWeight: 700 }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>
          {/* File Picker */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            style={{
              border: "2px dashed #cbd5e1",
              borderRadius: 12,
              padding: 14,
              textAlign: "center",
              background: schema ? "#f0fdf4" : "#f8fafc",
              marginBottom: 12,
            }}
          >
            <input
              type="file"
              id="legacy-center-sqlite-input"
              accept=".sqlite,.db,.back"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <label
              htmlFor="legacy-center-sqlite-input"
              style={{
                display: "inline-block",
                background: "#0284c7",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              اختر قاعدة SQLite أو .back من جهازك
            </label>
            <span style={{ marginRight: 12, fontSize: 12, color: "#64748b" }}>
              {schema
                ? `${schema.fileName} • ${schema.tableCount} جدولًا • ${schema.totalRows.toLocaleString("en-US")} سجل • السلامة: ${schema.integrity}`
                : "يُفحص التوقيع الثنائي «SQLite format 3» داخل المتصفح دون إرسال أي بيانات لخادم خارجي."}
            </span>
          </div>

          {error ? (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", fontSize: 13, marginBottom: 10, border: "1px solid #fecaca" }}>
              ⚠️ {error}
            </div>
          ) : null}
          {notice ? (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "#f0fdf4", color: "#166534", fontSize: 13, marginBottom: 10, border: "1px solid #bbf7d0" }}>
              ✅ {notice}
            </div>
          ) : null}
          {busy ? (
            <div style={{ padding: 12, textAlign: "center", color: "#0284c7", fontWeight: 600, fontSize: 13 }}>
              ⏳ {progressText || "جاري التنفيذ..."}
            </div>
          ) : null}

          {/* Action Bar for 3 Independent Modes */}
          {schema ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10, background: "#f1f5f9", borderRadius: 10, marginBottom: 12 }}>
              <button type="button" onClick={handleSaveOriginalSource} disabled={busy} style={{ background: "#0284c7", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                أ. حفظ نسخة أصلية مطابقة
              </button>
              <button type="button" onClick={() => handleExportOriginalSource()} disabled={busy} style={{ background: "#059669", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                تصدير SQLite الأصلية
              </button>
              <button type="button" onClick={handleImportHistoricalArchive} disabled={busy} style={{ background: "#0f766e", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ب. استيراد الأرشيف التاريخي ({schema.totalRows.toLocaleString("en-US")})
              </button>
              <button type="button" onClick={handleMigrateMasterData} disabled={busy} style={{ background: "#7c3aed", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ج. إظهار العملاء والأصناف والمخازن في واجهات التطبيق
              </button>
              <button type="button" onClick={handleExportAuditReport} style={{ background: "#475569", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                تصدير تقرير التدقيق
              </button>
            </div>
          ) : null}

          {schema ? (
            <p role="status" style={{ margin: "0 0 12px", color: "#475569", fontSize: 12 }}>
              لإظهار البيانات في قوائم الحسابات والمخزون: نفّذ (ب) ثم (ج). حفظ المصدر أو استيراد الأرشيف وحده لا يملأ الشاشات الحية. الفواتير والقيود تبقى تاريخية غير مُرحّلة حتى المطابقة.
            </p>
          ) : null}
          {schema ? (
            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                data-testid="legacy-import-and-show"
                onClick={handleImportAndShow}
                disabled={busy || !masterPreview}
                style={{ width: "100%", padding: "12px", border: 0, borderRadius: 9, background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}
              >
                استيراد آمن وإظهار الحسابات والأصناف والمخازن بضغطة واحدة (دون ترحيل مالي)
              </button>
            </div>
          ) : null}
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e2e8f0", marginBottom: 12, flexWrap: "wrap" }}>
            {[
              ["overview", "الجداول والعلاقات"],
              ["preview", "معاينة السجلات"],
              ["mapping", "المطابقة والترحيل المحاسبي"],
              ["reconciliation", "مطابقة القيود والفواتير"],
              ["history", `السجل والنسخ (${batches.length})`],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as CenterTab)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: tab === id ? 700 : 500,
                  color: tab === id ? "#0284c7" : "#64748b",
                  borderBottom: tab === id ? "3px solid #0284c7" : "3px solid transparent",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab 1: Overview */}
          {tab === "overview" && schema ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 8 }}>
                {schema.tables.map((t) => (
                  <div
                    key={t.name}
                    onClick={() => { setSelectedTable(t.name); setPreviewPage(0); setTab("preview"); }}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{t.columns.length} عمود • PK: {t.primaryKey.join(",") || "—"}</div>
                    </div>
                    <span style={{ background: t.rowCount ? "#e0f2fe" : "#f1f5f9", color: t.rowCount ? "#0369a1" : "#64748b", padding: "2px 7px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
                      {t.rowCount.toLocaleString("en-US")}
                    </span>
                  </div>
                ))}
              </div>

              {masterPreview ? (
                <div style={{ padding: 12, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12 }}>
                  <strong>حساب الفروقات قبل الترحيل (دون تعديل بياناتك الحالية):</strong>
                  <div style={{ marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>الحسابات: +{masterPreview.diff.accounts.add} جديد (موجود: {masterPreview.diff.accounts.alreadyPresent}، تشابه أسماء: {masterPreview.diff.accounts.nameCollisions.length})</span>
                    <span>المخازن: +{masterPreview.diff.warehouses.add} جديد</span>
                    <span>الأصناف: +{masterPreview.diff.inventory.add} جديد (أرصدة معلمة للمطابقة: {masterPreview.master.inventory.length})</span>
                  </div>
                </div>
              ) : null}

              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>خريطة العلاقات المكتشفة من البيانات ({relations.length}):</h4>
                <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "6px 8px" }}>الجدول الفرعي</th>
                        <th style={{ padding: "6px 8px" }}>الحقل</th>
                        <th style={{ padding: "6px 8px" }}>يرتبط بـ</th>
                        <th style={{ padding: "6px 8px" }}>نسبة التطابق</th>
                        <th style={{ padding: "6px 8px" }}>قيم يتيمة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relations.map((r) => (
                        <tr key={`${r.child}.${r.column}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "5px 8px", fontWeight: 600 }}>{r.child}</td>
                          <td style={{ padding: "5px 8px" }}>{r.column}</td>
                          <td style={{ padding: "5px 8px" }}>{r.parent}.{r.parentColumn}</td>
                          <td style={{ padding: "5px 8px" }}>{Math.round(r.coverage * 100)}%</td>
                          <td style={{ padding: "5px 8px", color: r.orphanRows ? "#b45309" : "#166534" }}>{r.orphanRows}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {duplicates ? (
                <div style={{ fontSize: 12, color: "#475569", background: "#fffbeb", padding: 10, borderRadius: 8, border: "1px solid #fde68a" }}>
                  <strong>فحص التكرارات:</strong> تشابه أسماء عملاء ({duplicates.customerNames.length}) • تشابه أسماء منتجات ({duplicates.productNames.length}) • تكرار باركود ({duplicates.productBarcodes.length}) • حركات متطابقة التوقيع ({duplicates.movesInSignatureGroups}). الهوية تعتمد على البصمة والمعرف الأصلي وليس الاسم فقط.
                </div>
              ) : null}

              {distincts.length ? (
                <details style={{ fontSize: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>القيم المختلفة لحقول أنواع العمليات والحالات ({distincts.length} حقول)</summary>
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                    {distincts.map((d) => (
                      <div key={`${d.table}.${d.column}`} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <strong>{d.table}.{d.column}</strong>
                        <div style={{ color: "#64748b", marginTop: 4 }}>
                          {d.values.map((v) => `${String(v.value)} (${v.count})`).join(" · ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* Tab 2: Table Preview */}
          {tab === "preview" && tables ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <select
                  value={selectedTable}
                  onChange={(e) => { setSelectedTable(e.target.value); setPreviewPage(0); }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600 }}
                >
                  {Object.keys(tables).map((name) => (
                    <option key={name} value={name}>
                      {name} ({tables[name].length.toLocaleString("en-US")})
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span>صفحة {previewPage + 1} من {Math.max(1, Math.ceil(previewRows.length / pageSize))}</span>
                  <button type="button" disabled={previewPage <= 0} onClick={() => setPreviewPage((p) => p - 1)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>السابق</button>
                  <button type="button" disabled={(previewPage + 1) * pageSize >= previewRows.length} onClick={() => setPreviewPage((p) => p + 1)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>التالي</button>
                </div>
              </div>
              <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {previewCols.map((c) => <th key={c} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(previewPage * pageSize, (previewPage + 1) * pageSize).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        {previewCols.map((c) => (
                          <td key={c} style={{ padding: "5px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r[c] === null || r[c] === undefined ? "—" : String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Tab 3: Mapping & Controlled Posting */}
          {tab === "mapping" && tables && schema ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>1. مطابقة أنواع المستندات (`bill_type`) بناءً على الأدلة الفعلية:</h4>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "6px 8px" }}>النوع</th>
                        <th style={{ padding: "6px 8px" }}>العدد</th>
                        <th style={{ padding: "6px 8px" }}>الأدلة المكتشفة</th>
                        <th style={{ padding: "6px 8px" }}>الدور المعتمد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.map((ev) => (
                        <tr key={ev.billType} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 700 }}>{ev.billType}</td>
                          <td style={{ padding: "6px 8px" }}>{ev.rows}</td>
                          <td style={{ padding: "6px 8px", color: "#475569" }}>{ev.basis.join(" ")}</td>
                          <td style={{ padding: "6px 8px" }}>
                            <select
                              value={roles[String(ev.billType)]?.role ?? ev.suggestedRole}
                              onChange={(e) =>
                                setRoles((prev) => ({
                                  ...prev,
                                  [String(ev.billType)]: { role: e.target.value as DocumentRole, confirmed: true },
                                }))
                              }
                              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                            >
                              {Object.entries(ROLE_LABELS).map(([k, lbl]) => (
                                <option key={k} value={k}>{lbl}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>2. مطابقة مجموعات الحسابات (`customers.type` ➜ `boxes`):</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {groupSuggestions.map((g) => (
                    <div key={g.groupId} style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}>
                      <div style={{ fontWeight: 700 }}>{g.groupName} ({g.accounts} حسابًا)</div>
                      <select
                        value={groupCategories[String(g.groupId)] ?? g.category}
                        onChange={(e) => setGroupCategories((prev) => ({ ...prev, [String(g.groupId)]: e.target.value as AccountCategory }))}
                        style={{ width: "100%", marginTop: 4, padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1" }}
                      >
                        {Object.entries(CATEGORY_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>{lbl}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <button type="button" onClick={handleSaveMappings} disabled={busy} style={{ alignSelf: "flex-start", padding: "8px 14px", border: 0, borderRadius: 8, background: "#0369a1", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                حفظ تصنيفات المستندات والحسابات للبحث والعرض
              </button>

              <div style={{ padding: 12, borderRadius: 10, background: "#f8fafc", border: "1px solid #cbd5e1" }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>3. سياسة التفسير المحاسبي لترحيل القيود المتوازنة فقط:</h4>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="dir-policy" checked={policy === "dain_credit"} onChange={() => setPolicy("dain_credit")} />
                    <span><b>dain = دائن (credit)</b> و <b>madin = مدين (debit)</b></span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="dir-policy" checked={policy === "dain_debit"} onChange={() => setPolicy("dain_debit")} />
                    <span><b>dain = مدين (debit)</b> و <b>madin = دائن (credit)</b></span>
                  </label>
                </div>

                {postingPlan ? (
                  <div style={{ fontSize: 12, color: "#334155", marginBottom: 10 }}>
                    مجموعات القيود المؤهلة المتوازنة: <b>{postingPlan.eligibleGroups}</b> ({postingPlan.eligibleEntries} قيدًا) • المرفوضة/غير المتوازنة: <b>{postingPlan.rejectedGroups}</b>
                    {!policy ? " — اختر السياسة أولًا لتفعيل الترحيل." : ""}
                  </div>
                ) : null}

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10 }}>
                  <input type="checkbox" checked={confirmPosting} onChange={(e) => setConfirmPosting(e.target.checked)} />
                  <span>أوافق على ترحيل القيود المتوازنة التي اجتازت قواعد المطابقة فقط إلى اليومية الحية (وتبقى بقية السجلات تاريخية معلقة).</span>
                </label>

                <button
                  type="button"
                  disabled={!policy || !confirmPosting || busy}
                  onClick={handlePostBalancedVouchers}
                  style={{
                    background: !policy || !confirmPosting ? "#94a3b8" : "#16a34a",
                    color: "#fff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: !policy || !confirmPosting ? "not-allowed" : "pointer",
                  }}
                >
                  ترحيل القيود المعتمدة المتوازنة فقط
                </button>
              </div>
            </div>
          ) : null}

          {/* Tab 4: Reconciliation & Historical Invoices */}
          {tab === "reconciliation" && tables ? (
            <LegacyReconciliationView tables={tables} evidence={evidence} roles={roles} reviews={reviews} policy={policy} />
          ) : null}
          {tab === "reconciliation" && !tables ? (
            <p style={{ fontSize: 13, color: "#64748b" }}>اختر ملف SQLite أولًا لعرض شاشة مطابقة القيود القديمة والفواتير التاريخية.</p>
          ) : null}

          {/* Tab 5: History, Backup Bundle & Rollback */}
          {tab === "history" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: 10, background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <button type="button" onClick={handleExportFullBundle} disabled={busy} style={{ background: "#0284c7", color: "#fff", border: "none", padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  تصدير نسخة احتياطية كاملة (حالي + أرشيف + SQLite + SHA-256)
                </button>
                <label style={{ background: "#475569", color: "#fff", padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  فحص واستعادة نسخة احتياطية في مساحة معزولة
                  <input type="file" accept=".json" onChange={handleRestoreBundleFile} style={{ display: "none" }} />
                </label>
              </div>

              {restoreVerification ? (
                <div style={{ padding: 10, borderRadius: 8, background: restoreVerification.valid ? "#f0fdf4" : "#fef2f2", border: "1px solid #cbd5e1", fontSize: 12 }}>
                  <strong>نتيجة التحقق من الاستعادة المعزولة:</strong> بصمة الحزمة ({String(restoreVerification.bundleShaMatch)}) • بصمة SQLite ({String(restoreVerification.sqliteShaMatch)}) • تطابق السجلات ({restoreVerification.totalArchiveRows}) • سلامة SQLite ({restoreVerification.sqliteIntegrity})
                </div>
              ) : null}

              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>النسخ الأصلية المحفوظة ({savedSources.length}):</h4>
                {savedSources.map((s) => (
                  <div key={s.sha256} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 8, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                    <div>
                      <b>{s.fileName}</b> ({s.size.toLocaleString("en-US")} بايت • {s.totalRows.toLocaleString("en-US")} سجل)
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>SHA-256: {s.sha256}</div>
                    </div>
                    <button type="button" onClick={() => handleExportOriginalSource(s.sha256)} style={{ background: "#059669", color: "#fff", border: "none", padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                      تنزيل SQLite
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>دفعات الاستيراد والترحيل ({batches.length}):</h4>
                {batches.map((b) => (
                  <div key={b.batchId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 8, border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                    <div>
                      <b>{b.batchId}</b> — الحالة: <b>{b.status}</b> • السجلات: {b.total.toLocaleString("en-US")}
                    </div>
                    {b.status !== "rolled_back" ? (
                      <button type="button" onClick={() => handleRollbackBatch(b)} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                        تراجع عن الدفعة
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>سجل المراجعة والتدقيق:</h4>
                <div style={{ maxHeight: 150, overflow: "auto", fontSize: 11, background: "#f8fafc", padding: 8, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  {journal.map((j, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>[{j.at.slice(0, 19).replace("T", " ")}]</span> {j.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
