import { useMemo, useState } from "react";
import { MobileScroll } from "../mobile";
import type { AccountCategory } from "../types";
import { parseAccountCards, type AccountCardImport } from "../utils/accountCsvImport";
import { parseItemsWorkbook, preferredItemsSheet, type ImportedInventoryItemInput } from "../utils/importItemsFile";
import { readImportWorkbook } from "../utils/tabularImport";
import type { RestoreReview } from "../utils/restoreApproval";

export type ImportReview = { kind: "accounts" | "items"; bytes: Uint8Array; fileName: string; defaultCurrency: string };
export function DataImportReview({ review, busy, onCancel, onConfirm }: { review: ImportReview; busy: boolean; onCancel: () => void; onConfirm: (rows: AccountCardImport[] | ImportedInventoryItemInput[]) => void | Promise<void> }) {
  const [category, setCategory] = useState<AccountCategory | "">("");
  const [sheet, setSheet] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const workbook = useMemo(() => { try { return {book:readImportWorkbook(review.bytes),error:""}; } catch(e) { return {book:null,error:e instanceof Error?e.message:"تعذر قراءة الملف"}; } }, [review.bytes]);
  const names = workbook.book?.SheetNames ?? [];
  const selectedSheet = sheet || (workbook.book ? preferredItemsSheet(workbook.book) : "");
  const parsed = useMemo(() => {
    try {
      if (!workbook.book) throw new Error(workbook.error);
      const itemResult = review.kind === "items" ? parseItemsWorkbook(workbook.book, review.defaultCurrency, {sheetName:selectedSheet}) : null;
      const rows = itemResult ? itemResult.items : parseAccountCards(review.bytes, review.defaultCurrency, category || undefined);
      const blocked = review.kind === "accounts" && (rows as AccountCardImport[]).some(r => r.openingBalance !== 0);
      return { rows, error: "", blocked, notices:itemResult?.notices ?? [] };
    } catch (e) { return { rows: [], error: e instanceof Error ? e.message : "تعذر قراءة الملف", blocked: false, notices:[] }; }
  }, [review, category, selectedSheet, workbook]);
  const labels = review.kind === "accounts" ? ["الحساب", "الهاتف", "التصنيف", "العملة", "الرصيد", "الاتجاه"] : ["الصنف", "الباركود", "الوحدة", "سعر الشراء المرجعي", "سعر البيع", "العملة"];
  return <div className="center-modal-layer data-import-review"><section className="ref-dialog-card" role="dialog" aria-modal="true" aria-label="مراجعة الاستيراد">
    <MobileScroll className="import-review-scroll"><h2>مراجعة استيراد {review.kind === "items" ? "بطاقات الأصناف" : "بطاقات الحسابات"}</h2><p>{review.fileName}</p>
    <p>إضافة البطاقات الجديدة فقط وتجاوز الموجودة. لن يُنشأ رصيد مخزون أو قيد مالي ولن تتغير الأرصدة الحالية.</p>
    <p>العملة عند غيابها من الملف: <strong>{review.defaultCurrency}</strong></p>
    {review.kind === "accounts" ? <label>التصنيف عند غيابه من الملف <select aria-label="تصنيف الحسابات المستوردة" value={category} onChange={e => { setCategory(e.target.value as AccountCategory); setConfirmed(false); }}>
      <option value="">اختر التصنيف</option>{Object.entries({purchases:"المشتريات",sales:"المبيعات",clients:"العملاء",employees:"الموظفون",transfers:"الحوالات",shop:"المحل"}).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label> :
      <label>ورقة الأصناف <select aria-label="ورقة الأصناف" value={selectedSheet} onChange={e => { setSheet(e.target.value); setConfirmed(false); }}>{names.map(n => <option key={n}>{n}</option>)}</select></label>}
    {parsed.notices.map(message => <p key={message} role="status">{message}</p>)}
    {parsed.error ? <p role="alert" className="import-review-error">{parsed.error}</p> : <><p>عدد البطاقات: {parsed.rows.length} — المعاينة تعرض أول 50 صفًا.</p>
      <div className="import-review-table"><table><thead><tr>{labels.map(l => <th key={l}>{l}</th>)}</tr></thead><tbody>{parsed.rows.slice(0,50).map((row,i) => {
        const values = review.kind === "accounts" ? [(row as AccountCardImport).name,(row as AccountCardImport).phone,({purchases:"المشتريات",sales:"المبيعات",clients:"العملاء",employees:"الموظفون",transfers:"الحوالات",shop:"المحل"}[(row as AccountCardImport).category]),(row as AccountCardImport).currency,(row as AccountCardImport).openingBalance,((row as AccountCardImport).openingDirection === "debit" ? "مدين" : "دائن")] : [row.name,(row as ImportedInventoryItemInput).sku,(row as ImportedInventoryItemInput).unit,(row as ImportedInventoryItemInput).catalogReferenceCost ?? "—",(row as ImportedInventoryItemInput).sellingPrice ?? "—",(row as ImportedInventoryItemInput).currencyCode];
        return <tr key={i}>{values.map((v,j) => <td key={j}>{String(v ?? "")}</td>)}</tr>;
      })}</tbody></table></div></>}
    {parsed.blocked ? <p role="alert" className="import-review-error">الملف يحتوي أرصدة افتتاحية. استيراد البطاقات لا يرحّلها؛ استعد الأرصدة من النسخة الأصلية أو سجّل قيدًا افتتاحيًا متوازنًا بحساب مقابل محدد. لم يُحفظ أي حساب.</p> : null}
    <label className="print-options-check-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />راجعت الصفوف والتصنيف والعملة وأوافق على إضافة البطاقات الجديدة فقط</label>
    </MobileScroll>{submitError ? <p role="alert" className="import-review-error">{submitError}</p> : null}<div className="ref-action-bar cols-2"><button className="ref-btn green" disabled={busy || !confirmed || !!parsed.error || parsed.blocked || !parsed.rows.length} onClick={() => { setSubmitError(""); void Promise.resolve().then(() => onConfirm(parsed.rows)).catch(e => setSubmitError(e instanceof Error ? e.message : "تعذر الاستيراد.")); }}>استيراد البطاقات</button><button className="ref-btn purple" disabled={busy} onClick={onCancel}>إلغاء</button></div>
  </section></div>;
}

export function RestoreReviewDialog({ review, onFinish }: { review: RestoreReview; onFinish: (approved: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  const [downloadState, setDownloadState] = useState("");
  return <div className="center-modal-layer data-import-review"><section className="ref-dialog-card" role="dialog" aria-modal="true" aria-label="تأكيد استبدال بيانات العمل">
    <MobileScroll className="import-review-scroll"><h2>مراجعة استعادة النسخة</h2><p>الملف: {review.fileName}</p>
    <p>حُفظت نسخة أمان كاملة لبياناتك الحالية قبل الاستبدال: <bdi>{review.backupFileName}</bdi></p>
    {review.downloadBackup ? <button className="ref-btn blue" disabled={downloadState === "جاري التحميل..."} onClick={() => { setDownloadState("جاري التحميل..."); void review.downloadBackup!().then(() => setDownloadState("بدأ تنزيل نسخة الأمان.")).catch(e => setDownloadState(e instanceof Error ? e.message : "تعذر تنزيل نسخة الأمان.")); }}>تنزيل نسخة الأمان</button> : null}
    {downloadState ? <p role="status">{downloadState}</p> : null}
    <p>الحسابات الحالية: {review.counts.accounts ?? 0} • الحركات: {review.counts.ledger_entries ?? 0} • القيود اليومية: {review.counts.journal_entries ?? 0}</p>
    <p>الاستعادة تستبدل بيانات المنشأة الحالية بمحتوى الملف. النسخ القديمة قد لا تتضمن كل الجداول؛ لا تعيد الاستعادة ترحيل الحركات القديمة.</p>
    <label className="print-options-check-row"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />أؤكد استبدال بيانات العمل بعد حفظ نسخة الأمان</label>
    </MobileScroll><div className="ref-action-bar cols-2"><button className="ref-btn green" disabled={!checked} onClick={() => onFinish(true)}>تأكيد الاستبدال</button><button className="ref-btn purple" onClick={() => onFinish(false)}>إلغاء</button></div>
  </section></div>;
}
