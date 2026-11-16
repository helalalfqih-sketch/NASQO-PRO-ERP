import { useEffect, useState } from "react";
import { getActiveArchiveInfo, loadArchiveContextData } from "../legacy/centerService";
import type { BillTypeEvidence, MoveReview, RoleMapping } from "../legacy/analysis";
import type { Tables } from "../legacy/adapter";
import { getSetting, openCenterDb } from "../legacy/store";
import type { DirectionPolicy } from "../legacy/analysis";
import { LegacyReconciliationView } from "./LegacyReconciliationView";

type Props = {
  open: boolean;
  onClose: () => void;
  initialMode?: "moves" | "invoices";
  initialRoleFilter?: string;
};

export function LegacyArchiveExplorerModal({
  open,
  onClose,
  initialMode = "invoices",
  initialRoleFilter = "all",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<{
    tables: Tables;
    evidence: BillTypeEvidence[];
    roles: RoleMapping;
    reviews: MoveReview[];
    policy: DirectionPolicy | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const info = await getActiveArchiveInfo();
        if (!info) {
          if (active) setData(null);
          return;
        }
        const ctx = await loadArchiveContextData(info.sha256);
        let policy: DirectionPolicy | null = null;
        try {
          const db = await openCenterDb();
          try {
            policy = await getSetting<DirectionPolicy>(db, `policy:${info.sha256}`);
          } finally {
            db.close();
          }
        } catch {
          // ignore
        }
        if (active) setData({ ...ctx, policy });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "تعذر تحميل الأرشيف التاريخي.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

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
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
            الفواتير التاريخية ومطابقة القيود القديمة
          </h2>
          <button type="button" onClick={onClose} style={{ background: "#e2e8f0", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontWeight: 700 }}>
            ✕
          </button>
        </header>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {loading ? <p style={{ textAlign: "center", color: "#0284c7" }}>جاري تحميل الأرشيف التاريخي من IndexedDB...</p> : null}
          {error ? <p style={{ color: "#991b1b" }}>⚠️ {error}</p> : null}
          {!loading && !error && !data ? (
            <p style={{ color: "#64748b", fontSize: 13 }}>
              لا يوجد أرشيف تاريخي مستورد بعد. افتح «مركز استيراد وترحيل قواعد البيانات» من الإعدادات أو القائمة الجانبية لاستيراد ملف SQLite أولًا.
            </p>
          ) : null}
          {!loading && data ? (
            <LegacyReconciliationView
              tables={data.tables}
              evidence={data.evidence}
              roles={data.roles}
              reviews={data.reviews}
              policy={data.policy}
              initialMode={initialMode}
              initialRoleFilter={initialRoleFilter}
              onClose={onClose}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
