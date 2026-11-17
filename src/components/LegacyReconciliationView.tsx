import { useMemo, useState } from "react";
import {
  composeInvoice,
  documentContext,
  REASON_LABELS,
  ROLE_LABELS,
  summarizeReview,
  type BillTypeEvidence,
  type DirectionPolicy,
  type LegacyInvoice,
  type MoveReview,
  type MoveStatus,
  type RoleMapping,
} from "../legacy/analysis";
import type { Row, Tables } from "../legacy/adapter";
import { indexHistoricalInvoices, searchHistoricalInvoices } from "../legacy/search";
import { normalizeArabicSearch } from "../accounting";
import { LegacyInvoicePreview } from "./LegacyInvoicePreview";

type Props = {
  tables: Tables;
  evidence: BillTypeEvidence[];
  roles: RoleMapping;
  reviews: MoveReview[];
  policy: DirectionPolicy | null;
  initialMode?: "moves" | "invoices";
  initialRoleFilter?: string;
  initialSearch?: string;
  onClose?: () => void;
};

const STATUS_BADGE: Record<MoveStatus, { label: string; bg: string; color: string }> = {
  eligible: { label: "مؤهل للترحيل", bg: "#dcfce7", color: "#166534" },
  pending: { label: "معلق للمراجعة", bg: "#fef9c3", color: "#854d0e" },
  rejected: { label: "مرفوض الترحيل", bg: "#fee2e2", color: "#991b1b" },
  deleted: { label: "محذوف في المصدر", bg: "#f1f5f9", color: "#475569" },
};

export function LegacyReconciliationView({
  tables,
  evidence,
  roles,
  reviews,
  policy,
  initialMode = "moves",
  initialRoleFilter = "all",
  initialSearch = "",
  onClose,
}: Props) {
  const [mode, setMode] = useState<"moves" | "invoices">(initialMode);
  const [statusFilter, setStatusFilter] = useState<"all" | MoveStatus>("all");
  const [roleFilter, setRoleFilter] = useState<string>(initialRoleFilter);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<LegacyInvoice | null>(null);
  const pageSize = 40;

  const summary = useMemo(() => summarizeReview(reviews), [reviews]);

  const filteredMoves = useMemo(() => {
    const q = normalizeArabicSearch(search);
    return reviews.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(r.id).includes(q) ||
        normalizeArabicSearch(`${r.documentNumber} ${r.personId} ${r.personName} ${r.details} ${r.groupRef}`).includes(q)
      );
    });
  }, [reviews, statusFilter, search]);

  const allInvoices = useMemo(() => indexHistoricalInvoices(tables, roles), [tables, roles]);
  const invoiceMoves = useMemo(
    () => searchHistoricalInvoices(allInvoices, search, roleFilter),
    [allInvoices, search, roleFilter],
  );
  const unclassifiedInvoices = useMemo(
    () => allInvoices.filter((invoice) => !invoice.roleConfirmed).length,
    [allInvoices],
  );

  const openInvoice = (moveRow: Row, table: "input_move" | "bin") => {
    const id = String(moveRow.id);
    const priced = (tables[table === "bin" ? "bin_bill_details" : "bill_details"] ?? []).filter((l) => String(l.bill_id) === id);
    const free = (tables[table === "bin" ? "bin_bill_details2" : "bill_details2"] ?? []).filter((l) => String(l.bill_id) === id);
    const ctx = documentContext(tables, roles, evidence);
    setSelectedInvoice(composeInvoice(moveRow, table, priced, free, ctx));
  };

  return (
    <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header & Mode Switch */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => { setMode("moves"); setPage(0); setSelectedInvoice(null); }}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: mode === "moves" ? "#0284c7" : "#ffffff",
              color: mode === "moves" ? "#ffffff" : "#334155",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            مطابقة القيود القديمة ({summary.total})
          </button>
          <button
            type="button"
            onClick={() => { setMode("invoices"); setPage(0); setSelectedInvoice(null); }}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: mode === "invoices" ? "#0284c7" : "#ffffff",
              color: mode === "invoices" ? "#ffffff" : "#334155",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            الفواتير التاريخية ({invoiceMoves.length})
          </button>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", fontSize: 12 }}
          >
            عودة
          </button>
        ) : null}
      </div>

      {/* Read-only source invoice: source-backed fields and live detail buttons. */}
      {selectedInvoice ? (
        <LegacyInvoicePreview
          key={`${selectedInvoice.table}:${selectedInvoice.id}`}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      ) : null}

      {/* Search & Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="بحث بالرقم أو العميل أو الصنف أو الباركود (للرقم المطابق: #123)..."
          style={{ flex: "1 1 220px", padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
        />
        {mode === "moves" ? (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as "all" | MoveStatus); setPage(0); }}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
          >
            <option value="all">كل الحالات ({summary.total})</option>
            <option value="eligible">مؤهل للترحيل ({summary.byStatus.eligible})</option>
            <option value="pending">معلق ({summary.byStatus.pending})</option>
            <option value="rejected">مرفوض ({summary.byStatus.rejected})</option>
            <option value="deleted">محذوف ({summary.byStatus.deleted})</option>
          </select>
        ) : (
          <select
            aria-label="تصفية الفواتير التاريخية حسب النوع المعتمد"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
          >
            <option value="all">جميع الفواتير، بما فيها غير المصنفة</option>
            <option value="sale">مبيعات (sale)</option>
            <option value="purchase">مشتريات (purchase)</option>
            <option value="sale_return">مردود بيع</option>
            <option value="purchase_return">مردود شراء</option>
            <option value="free_sale">بيع حر البنود</option>
            <option value="free_purchase">شراء حر البنود</option>
          </select>
        )}
      </div>

      {mode === "invoices" && unclassifiedInvoices > 0 ? (
        <p role="status" style={{ margin: 0, fontSize: 12, color: "#854d0e" }}>
          {unclassifiedInvoices.toLocaleString("en-US")} مستندًا لم يُعتمد نوعه بعد. تظهر في «جميع الفواتير»؛ راجع خريطة أنواع العمليات في مركز الترحيل قبل تصفيتها كمبيعات أو مشتريات.
        </p>
      ) : null}
      {/* Table */}
      {mode === "moves" ? (
        <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#ffffff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "8px" }}>رقم الحركة</th>
                <th style={{ padding: "8px" }}>التاريخ</th>
                <th style={{ padding: "8px" }}>الحساب</th>
                <th style={{ padding: "8px" }}>النوع</th>
                <th style={{ padding: "8px" }}>dain</th>
                <th style={{ padding: "8px" }}>madin</th>
                <th style={{ padding: "8px" }}>التفسير المحاسبي</th>
                <th style={{ padding: "8px" }}>الحالة</th>
                <th style={{ padding: "8px" }}>سبب التعليق / الرفض</th>
              </tr>
            </thead>
            <tbody>
              {filteredMoves.slice(page * pageSize, (page + 1) * pageSize).map((r) => {
                const badge = STATUS_BADGE[r.status];
                const interp = !policy
                  ? "غير محدد (لم تُختر سياسة)"
                  : r.status === "eligible"
                    ? policy === "dain_credit"
                      ? (r.dain ?? 0) > 0 ? "دائن (Credit)" : "مدين (Debit)"
                      : (r.dain ?? 0) > 0 ? "مدين (Debit)" : "دائن (Credit)"
                    : "معلّق / غير مُرحّل";
                return (
                  <tr key={`${r.table}:${r.id}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{r.id}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.date ?? "غير صالح"}</td>
                    <td style={{ padding: "6px 8px" }}>{r.personName || `#${r.personId}`}</td>
                    <td style={{ padding: "6px 8px" }}>{r.billType} ({r.kind === "invoice" ? "فاتورة" : "سند"})</td>
                    <td style={{ padding: "6px 8px" }}>{r.dain ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{r.madin ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{interp}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ background: badge.bg, color: badge.color, padding: "2px 8px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap" }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", color: "#475569" }}>
                      {r.reasons.map((code) => REASON_LABELS[code]).join("؛ ") || "جاهز للترحيل"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#ffffff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "8px" }}>رقم الفاتورة</th>
                <th style={{ padding: "8px" }}>الدور</th>
                <th style={{ padding: "8px" }}>العميل / المورد</th>
                <th style={{ padding: "8px" }}>التاريخ</th>
                <th style={{ padding: "8px" }}>dain / madin</th>
                <th style={{ padding: "8px" }}>البنود</th>
                <th style={{ padding: "8px" }}>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {invoiceMoves.slice(page * pageSize, (page + 1) * pageSize).map(({ row, table, role, personName, lineCount }) => (
                <tr key={`${table}:${row.id}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 700 }}>#{String(row.id)}</td>
                  <td style={{ padding: "6px 8px" }}>{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}</td>
                  <td style={{ padding: "6px 8px" }}>{personName || `#${row.per_id}`}</td>
                  <td style={{ padding: "6px 8px" }}>{`${row.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`}</td>
                  <td style={{ padding: "6px 8px" }}>{String(row.dain)} / {String(row.madin)}</td>
                  <td style={{ padding: "6px 8px" }}>{lineCount}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      type="button"
                      onClick={() => openInvoice(row, table)}
                      style={{ background: "#0284c7", color: "#ffffff", border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      فتح البنود
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#64748b" }}>
        <span>
          الصفحة {page + 1} • الإجمالي: {mode === "moves" ? filteredMoves.length : invoiceMoves.length}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
            السابق
          </button>
          <button type="button" disabled={(page + 1) * pageSize >= (mode === "moves" ? filteredMoves.length : invoiceMoves.length)} onClick={() => setPage((p) => p + 1)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
            التالي
          </button>
        </div>
      </div>
    </div>
  );
}
