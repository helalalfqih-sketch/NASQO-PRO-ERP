import { useEffect, useState } from "react";
import type { Row } from "../legacy/adapter";
import { ROLE_LABELS, type LegacyInvoice } from "../legacy/analysis";
import {
  getActiveArchiveInfo,
  loadCustomerHistoricalMoves,
  loadSingleHistoricalInvoice,
} from "../legacy/centerService";
import type { AccountRecord } from "../types";

export function CustomerLegacyArchiveSection({ account }: { account: AccountRecord }) {
  const [sha256, setSha256] = useState<string | null>(null);
  const [moves, setMoves] = useState<Row[]>([]);
  const [invoicesCount, setInvoicesCount] = useState(0);
  const [vouchersCount, setVouchersCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<LegacyInvoice | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  useEffect(() => {
    if (!account.legacyRef) {
      setMoves([]);
      setSha256(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const info = await getActiveArchiveInfo();
        if (!info || !active) return;
        const res = await loadCustomerHistoricalMoves(info.sha256, account.codeNumber);
        if (!active) return;
        setSha256(info.sha256);
        setMoves([...res.moves].reverse());
        setInvoicesCount(res.invoicesCount);
        setVouchersCount(res.vouchersCount);
      } catch {
        // ignore if IndexedDB unavailable
      }
    })();
    return () => {
      active = false;
    };
  }, [account.id, account.legacyRef, account.codeNumber]);

  if (!account.legacyRef || (!sha256 && moves.length === 0)) {
    return null;
  }

  const openInvoiceDetail = async (moveId: number) => {
    if (!sha256) return;
    setLoadingInvoice(true);
    try {
      const inv = await loadSingleHistoricalInvoice(sha256, moveId, "input_move");
      setSelectedInvoice(inv);
    } finally {
      setLoadingInvoice(false);
    }
  };

  return (
    <section
      data-testid="customer-legacy-archive-section"
      style={{
        margin: "10px 12px",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #bae6fd",
        background: "#f0f9ff",
        fontSize: 12,
        color: "#0f172a",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <strong style={{ color: "#0369a1" }}>الأرشيف التاريخي المرتبط ({account.legacyRef})</strong>
          <div style={{ color: "#475569", marginTop: 2 }}>
            فواتير تاريخية: <b>{invoicesCount}</b> • سندات/قيود: <b>{vouchersCount}</b> (للمراجعة دون ترحيل تلقائي)
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "#0284c7",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {expanded ? "إخفاء السجل التاريخي" : `عرض الحركات (${moves.length})`}
        </button>
      </div>

      {loadingInvoice ? (
        <div style={{ marginTop: 8, color: "#0284c7", fontWeight: 600 }}>جاري تحميل بنود الفاتورة...</div>
      ) : null}

      {selectedInvoice ? (
        <div
          data-testid="customer-legacy-invoice-detail"
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 10,
            background: "#ffffff",
            border: "1px solid #0284c7",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong>
              فاتورة #{selectedInvoice.id} — {ROLE_LABELS[selectedInvoice.role]} ({selectedInvoice.date ?? "—"})
            </strong>
            <button
              type="button"
              onClick={() => setSelectedInvoice(null)}
              style={{ background: "#e2e8f0", border: "none", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
            >
              إغلاق
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
            العميل: <b>{selectedInvoice.personName}</b> • دائن: <b>{selectedInvoice.headerDain ?? "—"}</b> • مدين:{" "}
            <b>{selectedInvoice.headerMadin ?? "—"}</b> • حالة المطابقة: <b>فاتورة تاريخية غير مُرحّلة</b>
          </div>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "right" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{ padding: "4px 6px" }}>الصنف</th>
                  <th style={{ padding: "4px 6px" }}>الكمية</th>
                  <th style={{ padding: "4px 6px" }}>السعر</th>
                  <th style={{ padding: "4px 6px" }}>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoice.lines.map((line) => (
                  <tr key={line.ref} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>
                      {line.productName || line.description || `#${line.productId}`}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      {line.quantity ?? "—"} {line.unit}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{line.unitPrice ?? "—"}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 700 }}>{line.total ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div style={{ marginTop: 10, maxHeight: 240, overflow: "auto", background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "right" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                <th style={{ padding: "5px 6px" }}>#</th>
                <th style={{ padding: "5px 6px" }}>التاريخ</th>
                <th style={{ padding: "5px 6px" }}>النوع</th>
                <th style={{ padding: "5px 6px" }}>dain / madin</th>
                <th style={{ padding: "5px 6px" }}>البيان</th>
                <th style={{ padding: "5px 6px" }}>تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {moves.slice(0, 60).map((m) => {
                const bt = Number(m.bill_type);
                const dateStr = `${m.year}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`;
                return (
                  <tr key={String(m.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "5px 6px", fontWeight: 700 }}>{String(m.id)}</td>
                    <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>{dateStr}</td>
                    <td style={{ padding: "5px 6px" }}>{bt === 1 ? "سند" : `فاتورة (${bt})`}</td>
                    <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>
                      {String(m.dain)} / {String(m.madin)}
                    </td>
                    <td style={{ padding: "5px 6px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {String(m.details || "—")}
                    </td>
                    <td style={{ padding: "5px 6px" }}>
                      {bt !== 1 ? (
                        <button
                          type="button"
                          onClick={() => void openInvoiceDetail(Number(m.id))}
                          style={{
                            background: "#0284c7",
                            color: "#fff",
                            border: "none",
                            borderRadius: 5,
                            padding: "2px 8px",
                            fontSize: 10,
                            cursor: "pointer",
                          }}
                        >
                          فتح البنود
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
