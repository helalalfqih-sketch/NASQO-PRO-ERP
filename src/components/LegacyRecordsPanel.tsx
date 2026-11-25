import { useEffect, useRef, useState } from "react";
import { hybridBridge } from "../hybrid/bridge";
import { useHybridPresentation } from "../hybrid/presentationAdapter";
import { KeyboardInput, useKeyboard } from "../mobile";
import { useBackLayer } from "../hybrid/backCoordinator";
import type { LegacyRecord, LegacyRecordKind } from "../utils/legacyRecordDraft";

type Page = { available: boolean; sourceSha?: string; items: LegacyRecord[]; totalCount: number; nextOffset: number | null; readOnlyReview?: boolean };
const titles = { offers: "عروض الأسعار المستوردة", trash: "المحذوفات المستوردة", alerts: "التنبيهات المستوردة" };
const fieldTitles: Record<string, string> = {
  id: "الرقم الأصلي", per_id: "رقم الحساب", dain: "المدين", madin: "الدائن", cur: "رقم العملة",
  bill_type: "نوع المستند الأصلي", details: "البيان", det: "نص التنبيه", day: "اليوم", month: "الشهر", year: "السنة",
  hour: "الساعة", mint: "الدقيقة", isam: "الفترة", ndate: "التاريخ الأصلي", mdate: "موعد التنبيه", date: "التاريخ",
  name: "الاسم", type: "التصنيف الأصلي", bonus: "الكمية الإضافية", discount: "الخصم", discount_amount: "خصم الرأس",
  bill: "رقم المستند", ref: "المرجع", img: "مرجع الصورة", sender: "المرسل", recever: "المستلم", comp: "الشركة",
  bstate: "الحالة الأصلية", added: "القيمة الإضافية الأولى", added2: "القيمة الإضافية الثانية", curprice: "سعر الصرف",
  cboxid: "رقم الصندوق", pername: "اسم الحساب الأصلي", curname: "اسم العملة الأصلي", boxname: "اسم المجموعة",
  bill_id: "رقم المستند المرتبط", prod_id: "رقم الصنف", amount: "الكمية", price: "السعر", total: "الإجمالي",
  store_id: "رقم المخزن", unit: "الوحدة", unitnum: "رقم الوحدة", exdate: "تاريخ الصلاحية",
};
export function LegacyRecordsPanel({ kind, onDraft, onAccount }: {
  kind: LegacyRecordKind; onDraft?: (record: LegacyRecord) => void; onAccount?: (id: string) => void;
}) {
  const hybrid = useHybridPresentation();
  const keyboard = useKeyboard();
  const [page, setPage] = useState<Page | null>(null), [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LegacyRecord | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [showDismissed, setShowDismissed] = useState(false);
  const revision = useRef(0);
  useBackLayer(Boolean(selected), () => { keyboard.hide(); setSelected(null); return true; }, 20);
  const request = <T,>(payload: Parameters<typeof hybridBridge.invoke<"legacyArchiveAction", T>>[1]) =>
    hybridBridge.invoke<"legacyArchiveAction", T>("legacyArchiveAction", payload);
  const load = async (offset = 0) => {
    const current = ++revision.current; setBusy(true); setError("");
    try {
      const result = await request<Page>({ workspaceId: "local-erp-workspace", operation: "list", recordKind: kind, query, offset, limit: 50 });
      if (current !== revision.current) return;
      setPage((previous) => offset && previous && previous.sourceSha === result.sourceSha
        ? { ...result, items: [...previous.items, ...result.items] } : result);
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : "تعذر عرض السجلات المستوردة"); }
    finally { if (current === revision.current) setBusy(false); }
  };
  useEffect(() => {
    if (!hybrid.isHybrid) return;
    setSelected(null); setPage(null);
    void load();
    return () => { revision.current++; };
  }, [hybrid.isHybrid, kind, query]);
  if (!hybrid.isHybrid) return null;
  const detail = async (row: LegacyRecord) => {
    keyboard.hide();
    const current = ++revision.current; setBusy(true); setError("");
    try {
      const result = await request<{ record: LegacyRecord }>({ workspaceId: "local-erp-workspace", operation: "detail", recordKind: kind, recordId: row.id, sourceSha: row.sourceSha });
      if (current === revision.current) setSelected(result.record);
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : "تعذر فتح السجل"); }
    finally { if (current === revision.current) setBusy(false); }
  };
  const alertState = async (row: LegacyRecord, read: boolean, dismissed: boolean) => {
    const current = ++revision.current;
    setBusy(true); setError("");
    try {
      await request({ workspaceId: "local-erp-workspace", operation: "alertState", recordKind: "alerts", recordId: row.id, sourceSha: row.sourceSha, read, dismissed });
      if (current !== revision.current) return;
      setSelected((value) => value?.id === row.id ? { ...value, read, dismissed } : value);
      setPage((value) => value ? { ...value, items: value.items.map((item) => item.id === row.id ? { ...item, read, dismissed } : item) } : value);
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : "تعذر حفظ حالة التنبيه"); }
    finally { if (current === revision.current) setBusy(false); }
  };
  if (page?.available === false) return null;
  return <section className="legacy-records-panel" data-testid={`legacy-${kind}-panel`}>
    <h3>{titles[kind]} {page ? `(${page.totalCount})` : ""}</h3>
    <p>{kind === "trash" ? "تبقى المستندات محذوفة. فتح نسخة كمسودة لا يعيد ترحيل الأصل." : kind === "alerts" ? "تنبيهاتك القديمة داخل التطبيق؛ لا تُفعّل إشعارات الهاتف تلقائيًا." : "يمكن مراجعة العرض وفتح نسخة كمسودة محلية دون ترحيل."}</p>
    <KeyboardInput aria-label={`بحث ${titles[kind]}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو البيان أو الرقم" maxLength={100} />
    {kind === "alerts" ? <button type="button" onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? "إخفاء التنبيهات المخفية" : "عرض التنبيهات المخفية"}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">جارٍ تحميل السجلات…</p> : null}
    {!selected ? <>
      <ul>{(page?.items ?? []).filter((r) => kind !== "alerts" || showDismissed || !r.dismissed).map((row) => <li key={`${row.sourceSha}:${row.id}`}>
        <button type="button" disabled={busy} data-testid={`legacy-${kind}-record-${row.id}`} onClick={() => void detail(row)}>
          <strong>{row.accountName} · #{row.id}</strong><span>{row.entryDate || "تاريخ غير محدد"}</span>
          <span>{row.details || (kind === "alerts" ? "تنبيه مستورد" : row.amountValid === false ? "مبلغ المصدر غير صالح" : `${row.amount} ${row.currency}`)}</span>
          {kind === "alerts" ? <small>{row.dismissed ? "مخفي" : row.read ? "مقروء" : "غير مقروء"}</small> : null}
        </button>
      </li>)}</ul>
      {page?.nextOffset != null ? <button type="button" disabled={busy} data-testid={`legacy-${kind}-load-more`} onClick={() => void load(page.nextOffset!)}>عرض المزيد ({page.items.length} من {page.totalCount})</button> : null}
      {page?.totalCount === 0 ? <p>لا توجد سجلات مطابقة.</p> : null}
    </> : <article data-testid="legacy-record-detail">
      <button type="button" onClick={() => { keyboard.hide(); setSelected(null); }}>العودة إلى القائمة</button>
      <h4>{selected.accountName} · #{selected.id}</h4><p>{selected.entryDate || "تاريخ غير محدد"}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{selected.details}</p>
      {kind !== "alerts" ? <p>الإجمالي الأصلي: {selected.amountValid === false ? "غير صالح — راجع حقول المصدر" : `${selected.amount} ${selected.currency}`}</p> : null}
      {selected.draftBlockedReason ? <p role="note">{selected.draftBlockedReason}</p> : null}
      {selected.sourceReference ? <p>مرجع المصدر: {selected.sourceReference}</p> : null}
      {selected.headerDiscount ? <p>خصم الرأس المسجل: {selected.headerDiscount} {selected.currency}</p> : null}
      {selected.lines?.length ? <div className="legacy-record-lines"><table><thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>{selected.lines.map((line, i) => <tr key={`${line.lineKind}:${line.id}:${i}`}><td>{line.itemName}<small>{line.details}</small>{line.discount ? <small>خصم: {line.discount}</small> : null}{line.bonus ? <small>كمية إضافية: {line.bonus}</small> : null}{line.expiryDate ? <small>الصلاحية: {line.expiryDate}</small> : null}<details><summary>تفاصيل البند الأصلية</summary><dl>{Object.entries(line.sourceFields ?? {}).map(([key, value]) => <div key={key}><dt>{fieldTitles[key] ?? key}</dt><dd>{String(value ?? "")}</dd></div>)}</dl></details></td><td>{line.quantity} {line.unit}<small>رقم الوحدة: {line.unitNum}</small></td><td>{line.price}</td><td>{line.total}</td></tr>)}</tbody></table></div> : null}
      <details><summary>جميع حقول السجل الأصلي</summary><dl>{Object.entries(selected.fields ?? {}).map(([key, value]) => <div key={key}><dt>{fieldTitles[key] ?? key}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{String(value ?? "")}</dd></div>)}</dl></details>
      {selected.accountId && onAccount ? <button type="button" onClick={() => { keyboard.hide(); onAccount(selected.accountId); }}>فتح كشف الحساب المرتبط</button> : null}
      {kind !== "alerts" && onDraft && !page?.readOnlyReview ? <button type="button" disabled={busy} data-testid="legacy-copy-to-draft" onClick={() => { keyboard.hide(); onDraft(selected); }}>{kind === "trash" ? "فتح نسخة كمسودة دون ترحيل" : "فتح العرض كمسودة محلية"}</button> : null}
      {kind === "alerts" && !page?.readOnlyReview ? <div><button type="button" disabled={busy} data-testid="legacy-alert-read" onClick={() => void alertState(selected, !selected.read, selected.dismissed)}>{selected.read ? "تحديد كغير مقروء" : "تحديد كمقروء"}</button><button type="button" disabled={busy} data-testid="legacy-alert-dismiss" onClick={() => void alertState(selected, selected.read, !selected.dismissed)}>{selected.dismissed ? "إظهار التنبيه مجددًا" : "إخفاء التنبيه"}</button></div> : null}
    </article>}
  </section>;
}
