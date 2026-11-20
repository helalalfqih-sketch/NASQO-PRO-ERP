import { useEffect, useState } from "react";
import {
  fetchAccountLegacyMoves,
  fetchInvoiceDetailWithLines,
} from "../firebase";
import type { LegacyInvoice } from "../legacy/analysis";
import { unifiedDetailToLegacyInvoice } from "../legacy/unifiedView";
import type { AccountRecord, LedgerEntryRecord } from "../types";
import { LegacyInvoicePreview } from "./LegacyInvoicePreview";
import { NasqoBrandLoader } from "./NasqoBrandLoader";

export function CustomerLegacyArchiveSection({ account }: { account: AccountRecord }) {
  const [moves, setMoves] = useState<LedgerEntryRecord[]>([]);
  const [invoicesCount, setInvoicesCount] = useState(0);
  const [vouchersCount, setVouchersCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<LegacyInvoice | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  useEffect(() => {
    if (!account.legacyRef && account.codeNumber <= 0) {
      setMoves([]);
      return;
    }
    let active = true;
    void fetchAccountLegacyMoves(account.ownerId, account.id)
      .then((res) => {
        if (!active) return;
        setMoves(res.moves);
        setInvoicesCount(res.invoicesCount);
        setVouchersCount(res.vouchersCount);
      })
      .catch(() => {
        if (active) setMoves([]);
      });
    return () => {
      active = false;
    };
  }, [account.id, account.ownerId, account.legacyRef, account.codeNumber]);

  if (!account.legacyRef && moves.length === 0) {
    return null;
  }
  if (moves.length === 0) {
    return null;
  }

  const openInvoiceDetail = async (entryId: string) => {
    setLoadingInvoice(true);
    try {
      const detail = await fetchInvoiceDetailWithLines(account.ownerId, entryId);
      setSelectedInvoice(unifiedDetailToLegacyInvoice(detail));
    } finally {
      setLoadingInvoice(false);
    }
  };

  return (
    <section
      data-testid="customer-legacy-archive-section"
      style={{
        margin: "8px 0 0",
        padding: "8px 11px",
        borderRadius: 10,
        border: "1px solid var(--nasqo-line)",
        background: "var(--nasqo-surface-alt)",
        fontSize: 11.5,
        color: "var(--nasqo-ink)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <strong style={{ color: "var(--nasqo-blue)" }}>
            الأرشيف وبنود الفواتير ({account.legacyRef || `#${account.codeNumber}`})
          </strong>
          <div style={{ color: "var(--nasqo-muted)", marginTop: 2, fontSize: 11 }}>
            فواتير وبنود: <b>{invoicesCount}</b> • سندات/قيود: <b>{vouchersCount}</b>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "var(--nasqo-blue)",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "5px 11px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {expanded ? "إخفاء الجدول" : `عرض الحركات (${moves.length})`}
        </button>
      </div>

      {loadingInvoice ? (
        <NasqoBrandLoader size="sm" label="جاري تحميل بنود الفاتورة..." />
      ) : null}

      {selectedInvoice ? (
        <LegacyInvoicePreview
          key={`${selectedInvoice.table}:${selectedInvoice.id}`}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          testId="customer-legacy-invoice-detail"
        />
      ) : null}

      {expanded ? (
        <div
          style={{
            marginTop: 8,
            maxHeight: 220,
            overflow: "auto",
            background: "var(--nasqo-surface)",
            borderRadius: 8,
            border: "1px solid var(--nasqo-line)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "right", color: "var(--nasqo-ink)" }}>
            <thead>
              <tr style={{ background: "var(--nasqo-surface-hover)", borderBottom: "1px solid var(--nasqo-line)", color: "var(--nasqo-ink)" }}>
                <th style={{ padding: "6px" }}>#</th>
                <th style={{ padding: "6px" }}>التاريخ</th>
                <th style={{ padding: "6px" }}>النوع</th>
                <th style={{ padding: "6px" }}>المبلغ</th>
                <th style={{ padding: "6px" }}>البيان</th>
                <th style={{ padding: "6px" }}>البنود</th>
              </tr>
            </thead>
            <tbody>
              {moves.slice(0, 80).map((m) => {
                const hasLines = (m.lineCount ?? 0) > 0 || m.kind === "invoice" || m.kind === "return";
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--nasqo-row-line)" }}>
                    <td style={{ padding: "6px", fontWeight: 700 }}>{m.entryNumber}</td>
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{m.entryDate}</td>
                    <td style={{ padding: "6px" }}>{m.typeLabel}</td>
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>
                      {m.amount.toLocaleString("en-US")} {m.currency}
                    </td>
                    <td style={{ padding: "6px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--nasqo-muted)" }}>
                      {m.details || "—"}
                    </td>
                    <td style={{ padding: "6px" }}>
                      {hasLines ? (
                        <button
                          type="button"
                          onClick={() => void openInvoiceDetail(m.id)}
                          style={{
                            background: "var(--nasqo-blue)",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 10.5,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          فتح البنود{m.lineCount ? ` (${m.lineCount})` : ""}
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
