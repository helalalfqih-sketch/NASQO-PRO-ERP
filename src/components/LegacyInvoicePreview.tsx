import { useMemo, useState } from "react";
import { normalizeArabicSearch } from "../accounting";
import { ROLE_LABELS, type LegacyInvoice, type InvoiceLine } from "../legacy/analysis";
import { historicalInvoiceDisplayTotals } from "../legacy/invoiceView";
import { runWithBrandLoader } from "../utils/brandLoaderBus";
import "./LegacyInvoicePreview.css";

function amount(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "غير متوفر"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function buildInvoiceText(invoice: LegacyInvoice): string {
  const totals = historicalInvoiceDisplayTotals(invoice);
  const headings = [
    "نسقو برو – نسخة قراءة لمستند محفوظ",
    `رقم الحركة الأصلي: ${invoice.id}`,
    `رقم المستند في المصدر: ${invoice.documentNumber || "غير مسجل"}`,
    `التاريخ: ${invoice.date ?? "غير مسجل"}`,
    `نوع المستند: ${invoice.roleConfirmed ? ROLE_LABELS[invoice.role] : "غير معتمد"}`,
    `الحالة: ${invoice.deleted ? "محذوف في المصدر" : "تاريخي غير مرحل"}`,
    `العميل أو المورد: ${invoice.personName || "غير مسجل"}`,
    `العملة: ${invoice.currencyName || "غير محددة"}`,
    `مجموعة الحساب: ${invoice.sourceBoxName || "غير مسجلة"}`,
    `المخازن: ${invoice.warehouseNames.join("، ") || "غير مسجلة"}`,
    `البيان: ${invoice.details || "—"}`,
    "بنود المستند:",
  ];
  const rows = invoice.lines.map((line, i) => [
    String(i + 1), line.productName || line.description || `صنف #${line.productId ?? "—"}`,
    line.unit, amount(line.quantity), amount(line.unitPrice),
    amount(line.discount), amount(line.total),
  ].join(" | "));
  return [...headings, ...rows, `عدد البنود: ${totals.lineCount}`,
    `عدد القطع: ${amount(totals.pieces)}`,
    `مجموع البنود: ${amount(totals.lineTotal)}`,
    `مجموع الرأس المطابق: ${amount(totals.verifiedHeaderTotal)}`,
    "نسخة تاريخية للقراءة فقط، دون ترحيل إلى الأستاذ العام.",
  ].join("\n");
}

type Props = { invoice: LegacyInvoice; onClose: () => void; testId?: string };

/** Visual parity with the source system's dark invoice page, but without editable
 * cash/payment/posting controls whose semantics cannot be verified in SQLite. */
export function LegacyInvoicePreview({ invoice, onClose, testId = "legacy-invoice-detail" }: Props) {
  const [itemSearch, setItemSearch] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const totals = useMemo(() => historicalInvoiceDisplayTotals(invoice), [invoice]);
  const filteredLines = useMemo(() => {
    const q = normalizeArabicSearch(itemSearch.trim());
    if (!q) return invoice.lines;
    return invoice.lines.filter((line) => normalizeArabicSearch([
      line.productName, line.description, line.unit, line.productId ?? "", line.id,
    ].join(" ")).includes(q));
  }, [invoice.lines, itemSearch]);
  const selectedLine: InvoiceLine | undefined = invoice.lines.find((line) => line.ref === selectedRef);

  const saveReadonlyCopy = () => {
    void runWithBrandLoader(
      "جاري تصدير نسخة المستند...",
      () => {
        const blob = new Blob(["\uFEFF", buildInvoiceText(invoice)], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `nasqo-historical-${invoice.table}-${invoice.id}.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("تم تجهيز نسخة قراءة من المستند على جهازك، دون إنشاء قيد مالي.");
      },
      { minDurationMs: 420 },
    );
  };

  return (
    <section className="legacy-invoice-preview" data-testid={testId} aria-label={`تفاصيل الفاتورة التاريخية رقم ${invoice.id}`} dir="rtl">
      <div className="legacy-invoice-toolbar">
        <div>
          <strong>#{invoice.id}</strong>
          <span>{invoice.date ?? "تاريخ غير مسجل"}{invoice.sourceTime ? ` · ${invoice.sourceTime}` : ""}</span>
        </div>
        <div className="legacy-invoice-toolbar-actions">
          <button type="button" onClick={saveReadonlyCopy} aria-label="حفظ نسخة قراءة من الفاتورة">حفظ نسخة <span aria-hidden="true">▣</span></button>
          <button type="button" onClick={onClose} aria-label="إغلاق التفاصيل">✕</button>
        </div>
      </div>

      <header className="legacy-invoice-banner">
        <strong>
          {invoice.roleConfirmed && invoice.role !== "unknown"
            ? ROLE_LABELS[invoice.role]
            : "فاتورة تاريخية — نوع غير معتمد"}
        </strong>
        <span>رقم المستند: {invoice.documentNumber || `#${invoice.id}`}</span>
        <small>{invoice.deleted ? "محذوفة في المصدر" : "فاتورة تاريخية غير مُرحّلة للأستاذ العام • للقراءة فقط"}</small>
      </header>

      <div className="legacy-invoice-info">
        <div className="legacy-invoice-field">
          <span>مرجع الحساب في المصدر</span>
          <strong>{invoice.sourceBoxName || "غير مسجل"}</strong>
        </div>
        <div className="legacy-invoice-flags" aria-label="نوع الحركة وطريقة الدفع">
          <span>نوع الحركة: <b>{invoice.roleConfirmed ? ROLE_LABELS[invoice.role] : `غير معتمد (${invoice.billType})`}</b></span>
          <span>الدفع: <b>نقدي / آجل غير محدد بالمصدر</b></span>
        </div>
        <div className="legacy-invoice-field">
          <span>العميل / المورد</span>
          <strong>{invoice.personName || (invoice.personId !== null ? `#${invoice.personId}` : "غير مسجل")}</strong>
        </div>
        <div className="legacy-invoice-field">
          <span>المخزن</span>
          <strong>{invoice.warehouseNames.join("، ") || "غير محدد في البنود"}</strong>
        </div>
        {invoice.details ? <div className="legacy-invoice-note"><span>الملاحظات</span><b>{invoice.details}</b></div> : null}
      </div>

      <div className="legacy-invoice-search-row">
        <label htmlFor={`legacy-invoice-line-search-${invoice.table}-${invoice.id}`}>بحث في أصناف الفاتورة</label>
        <input
          id={`legacy-invoice-line-search-${invoice.table}-${invoice.id}`}
          type="search"
          value={itemSearch}
          onChange={(event) => setItemSearch(event.target.value)}
          placeholder="اسم الصنف أو البيان أو رقم الصنف..."
          aria-label="البحث داخل بنود الفاتورة"
        />
        <small>{filteredLines.length} من {totals.lineCount} بندًا</small>
      </div>

      <div className="legacy-invoice-items-scroll">
        <table className="legacy-invoice-items">
          <thead>
            <tr>
              <th>اسم الصنف</th>
              <th>الوحدة</th>
              <th>العدد</th>
              <th>السعر</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {filteredLines.map((line) => (
              <tr key={line.ref} className={line.ref === selectedRef ? "selected" : undefined}>
                <td>
                  <button type="button" aria-label={`تفاصيل بند ${line.productName || line.description || line.id}`}
                    onClick={() => setSelectedRef(line.ref === selectedRef ? null : line.ref)}>
                    {line.productName || line.description || `صنف #${line.productId ?? "—"}`}
                  </button>
                </td>
                <td>{line.unit || "—"}</td>
                <td className="numeric">{amount(line.quantity)}</td>
                <td className="numeric">{amount(line.unitPrice)}</td>
                <td className="numeric">{amount(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredLines.length === 0 ? <p className="legacy-invoice-no-results">لا توجد بنود مطابقة للبحث.</p> : null}
      </div>

      {selectedLine ? (
        <div className="legacy-invoice-selected-item" data-testid="legacy-invoice-line-info">
          <strong>تفاصيل البند الأصلي #{selectedLine.id}</strong>
          <span>الصنف: {selectedLine.productName || selectedLine.description || "غير مسمى"}</span>
          <span>الخصم المسجل في البند: {amount(selectedLine.discount)}</span>
          <span>مرجع المخزن: {selectedLine.storeId ?? "غير مسجل"} · نوع البند: {selectedLine.kind === "free" ? "حر" : "مرتبط بصنف"}</span>
        </div>
      ) : null}

      <div className="legacy-invoice-totals" aria-label="ملخص الفاتورة التاريخية">
        <div><span>عدد القطع</span><strong>{amount(totals.pieces)}</strong></div>
        <div><span>عدد البنود</span><strong>{totals.lineCount}</strong></div>
        <div><span>مجموع البنود</span><strong>{amount(totals.lineTotal)} <small>{invoice.currencyName}</small></strong></div>
        <div><span>خصم الرأس المسجل</span><strong>{amount(invoice.headerDiscount)}</strong></div>
        <div><span>الضريبة / النقل</span><strong>غير متوفر بالمصدر</strong></div>
        <div><span>صافي الفاتورة المؤكد</span><strong>{amount(totals.verifiedHeaderTotal)}</strong></div>
        <div><span>دائن / مدين الرأس</span><strong>{amount(invoice.headerDain)} / {amount(invoice.headerMadin)}</strong></div>
        <div><span>الربح</span><strong>غير قابل للتحقق</strong></div>
      </div>
      {invoice.match === "mismatch" ? <p className="legacy-invoice-warning" role="status">مجموع البنود لا يطابق رأس الفاتورة بحسب الأدلة المتاحة؛ يلزم مراجعة المصدر قبل أي اعتماد مالي.</p> : null}
      {notice ? <p className="legacy-invoice-notice" role="status">{notice}</p> : null}
      <div className="legacy-invoice-bottom-actions">
        <button type="button" onClick={onClose}>العودة إلى القائمة</button>
        <span>لا يمكن تعديل أو ترحيل هذا الأرشيف من شاشة العرض.</span>
      </div>
    </section>
  );
}
