import { useCallback, useEffect, useState } from "react";
import {
  fetchArchiveSummary,
  fetchHistoricalInvoicesPage,
  fetchInvoiceDetailWithLines,
  type ArchiveSummaryPayload,
} from "../firebase";
import type { LegacyInvoice } from "../legacy/analysis";
import { unifiedDetailToLegacyInvoice } from "../legacy/unifiedView";
import type { LedgerEntryRecord } from "../types";
import { LegacyInvoicePreview } from "./LegacyInvoicePreview";

type Props = {
  open: boolean;
  onClose: () => void;
  initialMode?: "moves" | "invoices";
  initialRoleFilter?: string;
  initialSearch?: string;
  workspaceId: string;
};

export function LegacyArchiveExplorerModal({
  open,
  onClose,
  initialMode = "invoices",
  initialRoleFilter = "all",
  initialSearch = "",
  workspaceId,
}: Props) {
  const [tab, setTab] = useState<"invoices" | "summary" | "transfers" | "bin">(
    initialMode === "moves" ? "summary" : "invoices",
  );
  const [roleFilter, setRoleFilter] = useState(initialRoleFilter);
  const [search, setSearch] = useState(initialSearch);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [invoices, setInvoices] = useState<LedgerEntryRecord[]>([]);
  const [summary, setSummary] = useState<ArchiveSummaryPayload | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<LegacyInvoice | null>(null);

  useEffect(() => {
    if (open) {
      setRoleFilter(initialRoleFilter);
      setSearch(initialSearch);
      setOffset(0);
      setSelectedInvoice(null);
    }
  }, [open, initialRoleFilter, initialSearch]);

  const loadPage = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError("");
    try {
      const [page, sum] = await Promise.all([
        fetchHistoricalInvoicesPage(workspaceId, { q: search, role: roleFilter, limit: 40, offset }),
        summary ? Promise.resolve(summary) : fetchArchiveSummary(workspaceId),
      ]);
      setTotal(page.total);
      setInvoices(page.invoices);
      if (!summary) setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر قراءة السجلات المحفوظة.");
    } finally {
      setLoading(false);
    }
  }, [open, workspaceId, search, roleFilter, offset, summary]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  if (!open) return null;

  const openDetail = async (entryId: string) => {
    try {
      const detail = await fetchInvoiceDetailWithLines(workspaceId, entryId);
      setSelectedInvoice(unifiedDetailToLegacyInvoice(detail));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل بنود الفاتورة.");
    }
  };

  return (
    <div className="center-modal-layer" dir="rtl" style={{ zIndex: 100000 }}>
      <button type="button" className="center-modal-backdrop" aria-label="إغلاق الفواتير التاريخية" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          zIndex: 100001,
          width: "min(97vw, 960px)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        <header style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
              سجل الفواتير والقيود الموحد
            </h2>
            {summary ? (
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                القيود والفواتير: <b>{summary.stats.ledgerCount.toLocaleString("en-US")}</b> • بنود الأصناف: <b>{summary.stats.invoiceLinesCount.toLocaleString("en-US")}</b> • التحويلات: <b>{summary.stats.transfersCount}</b> • المحذوفات المؤرشفة: <b>{summary.stats.archivedCount}</b>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} style={{ background: "#e2e8f0", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontWeight: 700 }}>
            ✕
          </button>
        </header>

        <div style={{ display: "flex", gap: 6, padding: "8px 16px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" }}>
          {[
            { id: "invoices" as const, label: `الفواتير والقيود (${total.toLocaleString("en-US")})` },
            { id: "summary" as const, label: "ملخص أنواع المستندات والمطابقة" },
            { id: "transfers" as const, label: `التحويلات المخزنية (${summary?.stats.transfersCount ?? 0})` },
            { id: "bin" as const, label: `سلة المحذوفات المؤرشفة (${summary?.stats.archivedCount ?? 0})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                background: tab === item.id ? "#0284c7" : "#ffffff",
                color: tab === item.id ? "#ffffff" : "#334155",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {error ? <p style={{ color: "#991b1b" }}>⚠️ {error}</p> : null}

          {selectedInvoice ? (
            <LegacyInvoicePreview
              key={`${selectedInvoice.table}:${selectedInvoice.id}`}
              invoice={selectedInvoice}
              onClose={() => setSelectedInvoice(null)}
            />
          ) : null}

          {tab === "invoices" ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  placeholder="بحث بالرقم، رقم المستند، اسم الحساب، الصنف أو الباركود..."
                  style={{ flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
                <select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setOffset(0);
                  }}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12, background: "#fff" }}
                >
                  <option value="all">جميع أنواع المستندات</option>
                  <option value="sale">فواتير البيع</option>
                  <option value="purchase">فواتير الشراء</option>
                  <option value="sale_return">مردود مبيعات</option>
                  <option value="purchase_return">مردود مشتريات</option>
                  <option value="voucher">السندات والقيود المالية</option>
                </select>
              </div>

              {loading ? <p style={{ textAlign: "center", color: "#0284c7" }}>جاري تحميل السجلات...</p> : null}

              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                      <th style={{ padding: "7px 8px" }}>#</th>
                      <th style={{ padding: "7px 8px" }}>التاريخ</th>
                      <th style={{ padding: "7px 8px" }}>النوع</th>
                      <th style={{ padding: "7px 8px" }}>الحساب</th>
                      <th style={{ padding: "7px 8px" }}>المبلغ</th>
                      <th style={{ padding: "7px 8px" }}>البيان</th>
                      <th style={{ padding: "7px 8px" }}>البنود</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 700 }}>{inv.entryNumber}</td>
                        <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{inv.entryDate}</td>
                        <td style={{ padding: "7px 8px" }}>{inv.typeLabel}</td>
                        <td style={{ padding: "7px 8px", fontWeight: 600 }}>{inv.accountName}</td>
                        <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                          {inv.amount.toLocaleString("en-US")} {inv.currency}
                        </td>
                        <td style={{ padding: "7px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inv.details || "—"}
                        </td>
                        <td style={{ padding: "7px 8px" }}>
                          <button
                            type="button"
                            onClick={() => void openDetail(inv.id)}
                            style={{ background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
                          >
                            فتح البنود{inv.lineCount ? ` (${inv.lineCount})` : ""}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12 }}>
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - 40))}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
                >
                  السابق
                </button>
                <span>
                  عرض {offset + 1} – {Math.min(offset + invoices.length, total)} من {total.toLocaleString("en-US")}
                </span>
                <button
                  type="button"
                  disabled={offset + invoices.length >= total}
                  onClick={() => setOffset((o) => o + 40)}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
                >
                  التالي
                </button>
              </div>
            </>
          ) : null}

          {tab === "summary" && summary ? (
            <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                    <th style={{ padding: "8px" }}>كود النوع</th>
                    <th style={{ padding: "8px" }}>التفسير المعتمد</th>
                    <th style={{ padding: "8px" }}>العدد</th>
                    <th style={{ padding: "8px" }}>عمليات نقدية متعادلة</th>
                    <th style={{ padding: "8px" }}>مجموع dain</th>
                    <th style={{ padding: "8px" }}>مجموع madin</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.docTypeSummary.map((row) => (
                    <tr key={`${row.docType}-${row.typeLabel}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{row.docType}</td>
                      <td style={{ padding: "8px" }}>{row.typeLabel}</td>
                      <td style={{ padding: "8px" }}>{Number(row.count).toLocaleString("en-US")}</td>
                      <td style={{ padding: "8px" }}>{Number(row.cashSettledCount).toLocaleString("en-US")}</td>
                      <td style={{ padding: "8px" }}>{Number(row.totalDain).toLocaleString("en-US")}</td>
                      <td style={{ padding: "8px" }}>{Number(row.totalMadin).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "transfers" && summary ? (
            <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                    <th style={{ padding: "8px" }}>#</th>
                    <th style={{ padding: "8px" }}>التاريخ</th>
                    <th style={{ padding: "8px" }}>من مخزن</th>
                    <th style={{ padding: "8px" }}>إلى مخزن</th>
                    <th style={{ padding: "8px" }}>البنود</th>
                    <th style={{ padding: "8px" }}>البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.transfers.map((tx) => (
                    <tr key={String(tx.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{String(tx.legacy_id ?? tx.id)}</td>
                      <td style={{ padding: "8px" }}>{String(tx.transfer_date || "—")}</td>
                      <td style={{ padding: "8px" }}>{String(tx.from_warehouse_name || `مخزن ${tx.raw_from_store_id ?? "?"}`)}</td>
                      <td style={{ padding: "8px" }}>{String(tx.to_warehouse_name || `مخزن ${tx.raw_to_store_id ?? "?"}`)}</td>
                      <td style={{ padding: "8px" }}>{String(tx.lines_count ?? 0)}</td>
                      <td style={{ padding: "8px" }}>{String(tx.details || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "bin" && summary ? (
            <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "right" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                    <th style={{ padding: "8px" }}>#</th>
                    <th style={{ padding: "8px" }}>التاريخ</th>
                    <th style={{ padding: "8px" }}>الحساب</th>
                    <th style={{ padding: "8px" }}>dain / madin</th>
                    <th style={{ padding: "8px" }}>البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.archivedDocs.map((doc) => (
                    <tr key={String(doc.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px", fontWeight: 700 }}>{String(doc.legacy_id ?? doc.id)}</td>
                      <td style={{ padding: "8px" }}>{String(doc.doc_date || "—")}</td>
                      <td style={{ padding: "8px" }}>{String(doc.account_name || "—")}</td>
                      <td style={{ padding: "8px" }}>{String(doc.dain ?? 0)} / {String(doc.madin ?? 0)}</td>
                      <td style={{ padding: "8px" }}>{String(doc.details || "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
