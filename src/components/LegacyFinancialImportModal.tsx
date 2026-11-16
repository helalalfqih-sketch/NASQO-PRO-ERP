import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  browseStagedLegacyRows,
  findStagedLegacyArchive,
  inspectLegacyFinancialArchive,
  readStagedInvoiceLines,
  stageLegacyFinancialArchive,
  type LegacyInspection,
  type LegacyRow,
  type StagedLegacyArchive,
} from "../utils/legacyFinancialStaging";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onNotify: (message: string) => void;
};

const VISIBLE_TABLES = [
  ["input_move", "الفواتير والحركات المالية"],
  ["bill_details", "بنود الفواتير"],
  ["bill_details2", "بنود الفواتير الحرة"],
  ["customers", "العملاء والحسابات"],
  ["products", "الأصناف"],
  ["bin", "الحركات المؤرشفة"],
  ["offers", "عروض الأسعار"],
  ["store_trans", "تحويلات المخازن"],
  ["trans_details", "بنود التحويلات"],
] as const;

const FIELD_NAMES = [
  "id", "bill_id", "per_id", "bill_type", "dain", "madin",
  "prod_id", "name", "amount", "price", "total", "details",
] as const;

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return s.length > 95 ? s.slice(0, 95) + "…" : s;
}

function downloadReport(inspection: LegacyInspection) {
  const body = JSON.stringify({
    sourceSha256: inspection.sourceSha256,
    tableCounts: inspection.tableCounts,
    totalRows: inspection.totalRows,
    typeCounts: inspection.typeCounts,
    bothAmountsPositive: inspection.bothAmountsPositive,
    bothAmountsZero: inspection.bothAmountsZero,
    missingCustomerRefs: inspection.missingCustomerRefs,
    missingProductRefs: inspection.missingProductRefs,
    missingInvoiceRefs: inspection.missingInvoiceRefs,
    unregisteredCurrencyRefs: inspection.unregisteredCurrencyRefs,
    postingStatus: "review_only_not_posted",
    warnings: inspection.warnings,
  }, null, 2);
  const objectUrl = URL.createObjectURL(new Blob([body], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "nasqo-legacy-preflight-report.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** Upload the reviewed full JSON export, stage it atomically, and inspect history. */
export function LegacyFinancialImportModal({
  open, onClose, workspaceId, onNotify,
}: Props) {
  const [inspection, setInspection] = useState<LegacyInspection | null>(null);
  const [fileName, setFileName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [staged, setStaged] = useState<StagedLegacyArchive | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>("input_move");
  const [tableRows, setTableRows] = useState<LegacyRow[]>([]);
  const [invoiceLines, setInvoiceLines] = useState<{priced:LegacyRow[];freeText:LegacyRow[]} | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState("");

  const countText = useMemo(
    () => inspection ? new Intl.NumberFormat("en-US").format(inspection.totalRows) : "0",
    [inspection],
  );

  useEffect(() => {
    if (!open) {
      setConfirmed(false);
      setInvoiceLines(null);
      setSelectedInvoice("");
    }
  }, [open]);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setConfirmed(false);
    setStaged(null);
    setTableRows([]);
    setInspection(null);
    setFileName(file.name);
    if (file.size > 150 * 1024 * 1024) {
      setError("الملف أكبر من 150 ميجابايت، استخدم ملف JSON مجزأ بعد مراجعته.");
      return;
    }
    setBusy(true);
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const signature = Array.from(head).map((byte) => String.fromCharCode(byte)).join("");
      if (signature.startsWith("SQLite format 3")) {
        throw new Error("هذه نسخة SQLite خام. اختر ملف nasqo_legacy_financial_staging_v1.json الناتج من أداة التحويل، ولا تغيّر الامتداد فقط.");
      }
      const data: unknown = JSON.parse(await file.text());
      const preview = inspectLegacyFinancialArchive(data);
      setInspection(preview);
      setTableRows(preview.payload.tables.input_move?.rows.slice(0, 35) ?? []);
      const previous = await findStagedLegacyArchive(workspaceId, preview.sourceSha256);
      setStaged(previous);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر قراءة الملف.");
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!inspection || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await stageLegacyFinancialArchive(workspaceId, inspection);
      setStaged(result.meta);
      onNotify(result.alreadyImported
        ? "هذا الأرشيف مستورد سابقًا؛ لم تُكرر أي سجلات."
        : "تم حفظ كامل الأرشيف التاريخي محليًا للمراجعة، دون ترحيل الأرصدة.");
      setTableRows(await browseStagedLegacyRows(workspaceId, inspection.sourceSha256, selectedTable, 35));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر حفظ الأرشيف؛ لم تُرحّل أي بيانات حية.");
    } finally { setBusy(false); }
  };

  const switchTable = async (table: string) => {
    setSelectedTable(table);
    setSelectedInvoice("");
    setInvoiceLines(null);
    if (!inspection) return;
    if (!staged) {
      setTableRows(inspection.payload.tables[table]?.rows.slice(0, 35) ?? []);
      return;
    }
    try {
      setTableRows(await browseStagedLegacyRows(workspaceId, inspection.sourceSha256, table, 35));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر عرض الجدول."); }
  };

  const showInvoice = async (id: string) => {
    if (!inspection || !staged) return;
    setSelectedInvoice(id);
    try {
      setInvoiceLines(await readStagedInvoiceLines(workspaceId, inspection.sourceSha256, id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر قراءة بنود الفاتورة."); }
  };

  if (!open) return null;
  const columns = FIELD_NAMES.filter((field) => tableRows.some((r) => field in r)).slice(0, 9);
  return (
    <div className="center-modal-layer" dir="rtl" style={{ zIndex: 100000 }}>
      <button type="button" className="center-modal-backdrop" aria-label="إغلاق استيراد الأرشيف" onClick={onClose}/>
      <section role="dialog" aria-modal="true" aria-labelledby="legacy-import-title"
        style={{
          position:"relative", background:"var(--nasqo-surface,#fff)",
          color:"var(--nasqo-text,#16263b)", borderRadius:14,
          width:"min(96vw,880px)", maxHeight:"90vh", overflow:"auto",
          margin:"auto", padding:18, boxShadow:"0 15px 50px #0003",
        }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:8}}>
          <div>
            <h2 id="legacy-import-title" style={{margin:0,fontSize:20}}>استيراد الفواتير والقيود التاريخية</h2>
            <p style={{margin:"5px 0 10px",fontSize:13}}>
              استيراد كافة جداول SQLite إلى أرشيف IndexedDB للمراجعة، دون تغيير أرصدة النظام الحية.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="إغلاق">إغلاق ✕</button>
        </div>
        <div style={{padding:11,border:"1px solid #d8a04e",borderRadius:8,fontSize:13,marginBottom:12}}>
          <strong>تنبيه محاسبي:</strong> لا يجوز ترحيل الحركات إلى الأستاذ العام قبل اعتماد معنى
          dain/madin ورموز bill_type والعملات والحسابات المقابلة. الأرشفة الحالية لا تؤثر على المخزون أو القيود.
        </div>
        <label style={{display:"block",fontWeight:600,marginBottom:7}}>
          اختر ملف الاستخراج الكامل JSON (وليس ملف SQLite الخام)
        </label>
        <input type="file" accept=".json,.back,application/json" onChange={(e) => void chooseFile(e)}
          disabled={busy} aria-label="اختيار أرشيف محاسبي قديم" />
        {fileName ? <p style={{fontSize:12}}>الملف: {fileName}</p> : null}
        {error ? <p role="alert" style={{color:"#b42318",whiteSpace:"pre-wrap"}}>{error}</p> : null}
        {inspection ? (
          <>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}>
              <div style={{padding:10,border:"1px solid #ddd",borderRadius:7}}>السجلات: <b>{countText}</b></div>
              <div style={{padding:10,border:"1px solid #ddd",borderRadius:7}}>الحركات: <b>{inspection.tableCounts.input_move ?? 0}</b></div>
              <div style={{padding:10,border:"1px solid #ddd",borderRadius:7}}>بنود الفواتير: <b>{(inspection.tableCounts.bill_details ?? 0) + (inspection.tableCounts.bill_details2 ?? 0)}</b></div>
              <div style={{padding:10,border:"1px solid #ddd",borderRadius:7}}>الجداول: <b>{Object.keys(inspection.tableCounts).length}</b></div>
            </div>
            <div style={{fontSize:12,overflowWrap:"anywhere"}}>
              بصمة المصدر: <code>{inspection.sourceSha256}</code>
            </div>
            <h3 style={{fontSize:15}}>نتائج فحص ما قبل الاستيراد</h3>
            <ul style={{paddingInlineStart:20,fontSize:13}}>
              {inspection.warnings.map((item,idx) => <li key={idx}>{item}</li>)}
            </ul>
            <div style={{fontSize:13}}>رموز العمليات: {Object.entries(inspection.typeCounts).map(([key,n]) => key + " (" + n + ")").join("، ")}</div>
            <button type="button" onClick={() => downloadReport(inspection)}
              style={{margin:"12px 0"}}>تنزيل تقرير فحص JSON</button>
            {staged ? <p role="status" style={{color:"#18764b",fontWeight:700}}>
              الأرشيف محفوظ محليًا في {staged.importedAt.slice(0,10)} — الحالة: للمراجعة فقط، غير مُرحّل.
            </p> : (
              <div style={{display:"flex",flexDirection:"column",gap:9,margin:"12px 0"}}>
                <label style={{display:"flex",gap:8,alignItems:"start",fontSize:13}}>
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/>
                  أؤكد حفظ الأرشيف للمراجعة فقط، دون إضافة قيود أو تعديل أرصدة أو كميات.
                </label>
                <button type="button" disabled={!confirmed || busy} onClick={() => void doImport()}
                  style={{padding:12,borderRadius:8,fontWeight:700,background:"#1762a5",color:"#fff",border:0,opacity:confirmed ? 1 : .5}}>
                  {busy ? "يجري حفظ جميع السجلات..." : "استيراد الأرشيف بالكامل إلى IndexedDB"}
                </button>
              </div>
            )}
            <h3 style={{fontSize:15}}>معاينة البيانات</h3>
            <label>
              الجدول:{" "}
              <select value={selectedTable} onChange={(e) => void switchTable(e.target.value)}>
                {VISIBLE_TABLES.map(([id,title]) => <option key={id} value={id}>{title} ({inspection.tableCounts[id] ?? 0})</option>)}
              </select>
            </label>
            <div style={{overflowX:"auto",maxHeight:270,marginTop:9,border:"1px solid #ddd",borderRadius:7}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                <thead><tr>{columns.map(c => <th key={c} style={{padding:7,borderBottom:"1px solid #ccc"}}>{c}</th>)}</tr></thead>
                <tbody>{tableRows.map((r,i) => (
                  <tr key={String(r.id ?? i)} onClick={() => selectedTable === "input_move" ? void showInvoice(String(r.id ?? "")) : undefined}
                    style={{cursor:selectedTable === "input_move" && staged ? "pointer" : "default"}}>
                    {columns.map(c => <td key={c} style={{padding:6,borderBottom:"1px solid #eee",maxWidth:170}}>{renderCell(r[c])}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p style={{fontSize:12}}>تُعرض أول 35 سجلاً فقط في المعاينة. جميع السجلات تُحفظ في الأرشيف.</p>
            {selectedInvoice && invoiceLines ? (
              <div style={{padding:9,border:"1px solid #ddd",borderRadius:7}}>
                <strong>بنود الفاتورة الأصلية #{selectedInvoice}</strong>
                <p>بنود الأصناف: {invoiceLines.priced.length} · البنود الحرة: {invoiceLines.freeText.length}</p>
                <div style={{maxHeight:190,overflow:"auto",fontSize:12}}>
                  {[...invoiceLines.priced,...invoiceLines.freeText].map((line,i) => (
                    <pre key={i} style={{whiteSpace:"pre-wrap",borderBottom:"1px solid #eee"}}>{JSON.stringify(line,null,2)}</pre>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        <p style={{fontSize:12,marginTop:14}}>
          لا يرسل هذا المستورد أي بيانات إلى الإنترنت؛ يحفظ الأرشيف محليًا في قاعدة مستقلة
          ولا يحذف أو يستبدل بيانات الحسابات والفواتير الحالية.
        </p>
      </section>
    </div>
  );
}
