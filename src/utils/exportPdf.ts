import { formatQuantity } from "./quantityFormat";
import { jsPDF } from "jspdf";
import { outputNativeDocument, usesNativeDocumentOutput } from "../hybrid/documentOutput";
import { formatAmount, type DashboardSummary } from "../accounting";
import type { CurrencyCode, LedgerEntryRecord } from "../types";

export interface DashboardPdfPayload {
  companyName: string;
  defaultCurrency: CurrencyCode;
  periodLabel: string;
  summary: DashboardSummary;
}

export interface InvoicePdfSummaryLine {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  metadata?: string[];
}

export interface InvoicePdfSummaryData {
  entryId: string;
  entryNumber: number;
  documentNumber: string;
  companyName: string;
  title: string;
  accountName: string;
  counterpartName: string;
  warehouseName: string;
  entryDate: string;
  dueDate?: string;
  paymentLabel: string;
  directionLabel: string;
  statusLabel: string;
  currency: string;
  exchangeRate: number;
  amount: number;
  notes?: string;
  sourceReference?: string;
  headerDiscount?: number;
  formattedAmount: string;
  vatLine?: string;
  lines: InvoicePdfSummaryLine[];
  footerNote?: string;
  generatedAtIso: string;
}

const PAYMENT_LABELS: Record<LedgerEntryRecord["payment"], string> = {
  cash: "نقدي",
  credit: "آجل",
  balance: "رصيد افتتاحي",
};

export function buildInvoicePdfSummaryData(
  entry: LedgerEntryRecord,
  options?: { companyName?: string; footerNote?: string; generatedAt?: Date },
): InvoicePdfSummaryData {
  const rawLines = entry.details
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let vatLine: string | undefined;
  const itemLines: InvoicePdfSummaryLine[] = [];

  for (const raw of rawLines) {
    if (raw.startsWith("ضريبة القيمة المضافة")) {
      vatLine = raw;
      continue;
    }
    const pipeMatch = raw.match(/^(.+?)\s*\|\s*([0-9.,٠-٩]+)(?:\s+([^\s×x*]+))?\s*[×x*]\s*([0-9.,٠-٩]+)$/i);
    if (pipeMatch) {
      const desc = pipeMatch[1].trim();
      const qtyStr = pipeMatch[2].trim();
      const unitStr = (pipeMatch[3] ?? "وحدة").trim();
      const priceStr = pipeMatch[4].trim();
      const qtyNum = Number(qtyStr.replace(/,/g, ""));
      const priceNum = Number(priceStr.replace(/,/g, ""));
      const computedTotal =
        Number.isFinite(qtyNum) && Number.isFinite(priceNum)
          ? formatAmount(qtyNum * priceNum)
          : priceStr;
      itemLines.push({
        description: desc,
        unit: unitStr,
        quantity: qtyStr,
        unitPrice: priceStr,
        lineTotal: computedTotal,
      });
    } else {
      itemLines.push({
        description: raw,
        unit: itemLines.length === 0 ? "عملية" : "بند",
        quantity: "1",
        unitPrice: itemLines.length === 0 ? formatAmount(entry.amount) : "—",
        lineTotal: itemLines.length === 0 ? formatAmount(entry.amount) : "—",
      });
    }
  }

  if (entry.lines?.length) {
    itemLines.splice(0,itemLines.length,...entry.lines.map(line=>({
      description:line.itemName || line.details || "بند",
      unit:line.unit || "حبة",
      quantity:formatQuantity(line.quantity),
      unitPrice:formatAmount(line.price),
      lineTotal:formatAmount(line.total),
      metadata:[
        line.details && line.details !== line.itemName ? `البيان: ${line.details}` : "",
        line.discount ? `خصم البند المسجل: ${formatAmount(line.discount)}` : "",
        line.bonus ? `الكمية المجانية: ${formatAmount(line.bonus)}` : "",
        line.expiryDate ? `تاريخ الصلاحية: ${line.expiryDate}` : "",
      ].filter(Boolean),
    })));
  }
  if (typeof entry.taxAmount==="number"&&entry.taxAmount>0) vatLine="الضريبة: "+formatAmount(entry.taxAmount)+" "+entry.currency;
  if (itemLines.length === 0) {
    itemLines.push({
      description: entry.typeLabel,
      unit: "عملية",
      quantity: "1",
      unitPrice: formatAmount(entry.amount),
      lineTotal: formatAmount(entry.amount),
    });
  }

  return {
    entryId: entry.id,
    entryNumber: entry.entryNumber,
    documentNumber: entry.documentNumber || `#${entry.entryNumber}`,
    companyName: options?.companyName?.trim() || "نسقو برو",
    title: entry.typeLabel,
    accountName: entry.accountName,
    counterpartName: entry.counterpartAccountName || "—",
    warehouseName: entry.warehouseName || (entry.invoiceContent === "free" ? "—" : "المخزن الرئيسي"),
    entryDate: entry.entryDate,
    dueDate: entry.dueDate,
    paymentLabel: PAYMENT_LABELS[entry.payment] ?? entry.payment,
    directionLabel: entry.direction === "debit" ? "مدين (عليه)" : "دائن (له)",
    statusLabel: entry.deleted ? "ملغى" : entry.postingStatus==="draft" ? "مسودة" : entry.postingStatus==="historical_unposted" ? "تاريخي غير مرحّل" : entry.postingStatus==="reversed" ? "معكوس" : "معتمد",
    currency: entry.currency,
    exchangeRate: entry.exchangeRate || 1,
    amount: entry.amount,
    notes: entry.details,
    sourceReference: entry.sourceReference,
    headerDiscount: entry.headerDiscount,
    formattedAmount: formatAmount(entry.amount),
    vatLine,
    lines: itemLines,
    footerNote: options?.footerNote?.trim() || undefined,
    generatedAtIso: (options?.generatedAt ?? new Date()).toISOString(),
  };
}

function drawSummaryCanvas(payload: DashboardPdfPayload): HTMLCanvasElement {
  const width = 1240;
  const rowsCount = Math.max(payload.summary.recentInvoices.length, 1) + Math.max(payload.summary.lowStockItems.length, 1);
  const height = Math.max(1754, 720 + rowsCount * 66);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Header band
  ctx.fillStyle = "#0b5ca8";
  ctx.fillRect(0, 0, width, 150);

  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 38px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(payload.companyName || "نسقو برو", width - 64, 68);

  ctx.font = '22px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillStyle = "#dbeafe";
  ctx.fillText(`التقرير المالي وتنبيهات المخزون · ${payload.periodLabel}`, width - 64, 112);

  ctx.textAlign = "left";
  ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(new Date().toLocaleDateString("en-GB"), 64, 112);

  // Summary KPI Strip
  const cardY = 190;
  const cardGap = 24;
  const cardW = (width - 128 - cardGap * 2) / 3;
  const kpis = [
    {
      label: "إجمالي المبيعات",
      value: `${formatAmount(payload.summary.totalSales)} ${payload.defaultCurrency}`,
      sub: `${payload.summary.salesInvoiceCount} فاتورة مبيعات`,
    },
    {
      label: "إجمالي الفواتير",
      value: `${payload.summary.totalInvoicesCount} فاتورة`,
      sub: `${formatAmount(payload.summary.totalInvoicesVolume)} ${payload.defaultCurrency}`,
    },
    {
      label: "أصناف تحت الحد الأدنى",
      value: `${payload.summary.lowStockItems.length} أصناف`,
      sub: `من أصل ${payload.summary.totalInventoryItems} صنف`,
    },
  ];

  kpis.forEach((kpi, index) => {
    const x = width - 64 - cardW * (index + 1) - cardGap * index;
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.fillRect(x, cardY, cardW, 140);
    ctx.strokeRect(x, cardY, cardW, 140);

    ctx.textAlign = "right";
    ctx.fillStyle = "#475569";
    ctx.font = '600 20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(kpi.label, x + cardW - 22, cardY + 42);

    ctx.fillStyle = "#0f172a";
    ctx.font = 'bold 30px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(kpi.value, x + cardW - 22, cardY + 88);

    ctx.fillStyle = "#64748b";
    ctx.font = '18px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(kpi.sub, x + cardW - 22, cardY + 120);
  });

  // Low-Stock Section
  let cursorY = 385;
  ctx.textAlign = "right";
  ctx.fillStyle = "#07365d";
  ctx.font = 'bold 28px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("قائمة الأصناف المنخفضة (أقل من الحد الأدنى)", width - 64, cursorY);
  cursorY += 24;

  // Table header
  ctx.fillStyle = "#eef4fb";
  ctx.fillRect(64, cursorY, width - 128, 48);
  ctx.fillStyle = "#0f172a";
  ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("الصنف", width - 84, cursorY + 32);
  ctx.fillText("المخزن", width - 450, cursorY + 32);
  ctx.fillText("الكمية الحالية", width - 730, cursorY + 32);
  ctx.fillText("الحد الأدنى", width - 930, cursorY + 32);
  ctx.fillText("النقص", 170, cursorY + 32);
  cursorY += 56;

  if (payload.summary.lowStockItems.length === 0) {
    ctx.fillStyle = "#475569";
    ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText("جميع الأصناف ضمن الحد الآمن للمخزون.", width - 84, cursorY + 26);
    cursorY += 54;
  } else {
    for (const item of payload.summary.lowStockItems) {
      ctx.fillStyle = "#0f172a";
      ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(item.name.slice(0, 34), width - 84, cursorY + 28);
      ctx.fillStyle = "#475569";
      ctx.fillText(item.warehouseName.slice(0, 22), width - 450, cursorY + 28);
      ctx.fillStyle = item.severity === "critical" ? "#dc2626" : "#b45309";
      ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(`${formatAmount(item.quantity)} ${item.unit}`, width - 730, cursorY + 28);
      ctx.fillStyle = "#334155";
      ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(`${formatAmount(item.effectiveThreshold)}`, width - 930, cursorY + 28);
      ctx.fillStyle = "#dc2626";
      ctx.fillText(`-${formatAmount(item.shortage)}`, 170, cursorY + 28);

      cursorY += 46;
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(64, cursorY);
      ctx.lineTo(width - 64, cursorY);
      ctx.stroke();
      cursorY += 8;
    }
  }

  // Recent Invoices Section
  cursorY += 36;
  ctx.textAlign = "right";
  ctx.fillStyle = "#07365d";
  ctx.font = 'bold 28px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("أحدث الفواتير المسجلة", width - 64, cursorY);
  cursorY += 24;

  ctx.fillStyle = "#eef4fb";
  ctx.fillRect(64, cursorY, width - 128, 48);
  ctx.fillStyle = "#0f172a";
  ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("رقم الفاتورة", width - 84, cursorY + 32);
  ctx.fillText("الحساب", width - 250, cursorY + 32);
  ctx.fillText("النوع", width - 640, cursorY + 32);
  ctx.fillText("التاريخ", width - 860, cursorY + 32);
  ctx.fillText("المبلغ", 170, cursorY + 32);
  cursorY += 56;

  if (payload.summary.recentInvoices.length === 0) {
    ctx.fillStyle = "#475569";
    ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText("لا توجد فواتير مسجلة ضمن الفترة.", width - 84, cursorY + 26);
  } else {
    for (const inv of payload.summary.recentInvoices) {
      ctx.fillStyle = "#0f172a";
      ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(`#${inv.entryNumber}`, width - 84, cursorY + 28);
      ctx.fillText(inv.accountName.slice(0, 28), width - 250, cursorY + 28);
      ctx.fillStyle = "#475569";
      ctx.fillText(inv.typeLabel, width - 640, cursorY + 28);
      ctx.fillText(inv.entryDate, width - 860, cursorY + 28);
      ctx.fillStyle = "#07365d";
      ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(`${formatAmount(inv.amount)} ${inv.currency}`, 170, cursorY + 28);

      cursorY += 46;
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(64, cursorY);
      ctx.lineTo(width - 64, cursorY);
      ctx.stroke();
      cursorY += 8;
    }
  }

  return canvas;
}

function drawInvoiceSummaryCanvas(summary: InvoicePdfSummaryData): HTMLCanvasElement {
  const width = 1240;
  const rowsHeight = Math.max(summary.lines.length, 1) * 60;
  const height = Math.max(1754, 960 + rowsHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Top Header Banner
  ctx.fillStyle = "#0b5ca8";
  ctx.fillRect(0, 0, width, 168);

  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 40px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(summary.companyName, width - 64, 72);

  ctx.font = '24px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillStyle = "#dbeafe";
  ctx.fillText("ملخص الفاتورة القابل للطباعة · نظام نسقو برو", width - 64, 120);

  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 28px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("NASQO PRO", 64, 70);
  ctx.fillStyle = "#fbbf24";
  ctx.font = 'bold 22px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(`#${summary.entryNumber}`, 64, 118);

  // Invoice Title Strip
  ctx.direction = "rtl";
  ctx.fillStyle = "#f1f6fc";
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 2;
  ctx.fillRect(64, 198, width - 128, 76);
  ctx.strokeRect(64, 198, width - 128, 76);

  ctx.textAlign = "right";
  ctx.fillStyle = "#07365d";
  ctx.font = 'bold 30px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(summary.title, width - 92, 246);

  ctx.textAlign = "left";
  ctx.fillStyle = summary.statusLabel === "ملغى" ? "#dc2626" : "#15803d";
  ctx.font = 'bold 22px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(`الحالة: ${summary.statusLabel}`, 92, 246);

  // Metadata 2-Column Grid
  const metaY = 300;
  const metaGap = 24;
  const boxW = (width - 128 - metaGap) / 2;
  const metaBoxes = [
    [
      { label: "العميل / الحساب", value: summary.accountName },
      { label: "الحساب المقابل", value: summary.counterpartName },
      { label: "المستودع", value: summary.warehouseName },
    ],
    [
      { label: "تاريخ الفاتورة", value: summary.entryDate },
      { label: "رقم المستند / المرجع", value: summary.documentNumber },
      { label: "طريقة الدفع / التوجيه", value: `${summary.paymentLabel} · ${summary.directionLabel}` },
    ],
  ];

  metaBoxes.forEach((rows, colIdx) => {
    const x = width - 64 - boxW * (colIdx + 1) - metaGap * colIdx;
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.fillRect(x, metaY, boxW, 188);
    ctx.strokeRect(x, metaY, boxW, 188);

    rows.forEach((row, rowIdx) => {
      const y = metaY + 46 + rowIdx * 54;
      ctx.textAlign = "right";
      ctx.fillStyle = "#64748b";
      ctx.font = '600 18px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(`${row.label}:`, x + boxW - 22, y);

      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText(row.value.slice(0, 32), x + 22, y);
    });
  });

  // Items Table
  let cursorY = 530;
  ctx.textAlign = "right";
  ctx.fillStyle = "#07365d";
  ctx.font = 'bold 26px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("بنود وتفاصيل الفاتورة", width - 64, cursorY);
  cursorY += 22;

  ctx.fillStyle = "#0b5ca8";
  ctx.fillRect(64, cursorY, width - 128, 54);
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 21px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("الصنف / البيان", width - 86, cursorY + 35);
  ctx.fillText("الوحدة", width - 590, cursorY + 35);
  ctx.fillText("الكمية", width - 740, cursorY + 35);
  ctx.fillText("السعر", width - 900, cursorY + 35);
  ctx.textAlign = "left";
  ctx.fillText("الإجمالي", 86, cursorY + 35);
  cursorY += 54;

  summary.lines.forEach((line, idx) => {
    const rowH = 56;
    ctx.fillStyle = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
    ctx.fillRect(64, cursorY, width - 128, rowH);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(64, cursorY, width - 128, rowH);

    ctx.textAlign = "right";
    ctx.fillStyle = "#0f172a";
    ctx.font = '600 20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(line.description.slice(0, 44), width - 86, cursorY + 36);
    ctx.fillStyle = "#475569";
    ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(line.unit.slice(0, 12), width - 590, cursorY + 36);
    ctx.fillStyle = "#b91c1c";
    ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(line.quantity, width - 740, cursorY + 36);
    ctx.fillStyle = "#1e293b";
    ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(line.unitPrice, width - 900, cursorY + 36);
    ctx.textAlign = "left";
    ctx.fillStyle = "#0b5ca8";
    ctx.font = 'bold 21px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(line.lineTotal, 86, cursorY + 36);

    cursorY += rowH;
  });

  // Totals Card
  cursorY += 34;
  const totalBoxH = summary.vatLine ? 196 : 152;
  ctx.fillStyle = "#eef6ff";
  ctx.strokeStyle = "#0b5ca8";
  ctx.lineWidth = 2;
  ctx.fillRect(64, cursorY, width - 128, totalBoxH);
  ctx.strokeRect(64, cursorY, width - 128, totalBoxH);

  let ty = cursorY + 46;
  if (summary.vatLine) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#334155";
    ctx.font = '600 21px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(summary.vatLine, width - 92, ty);
    ty += 46;
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#07365d";
  ctx.font = 'bold 28px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText("الإجمالي النهائي للفاتورة", width - 92, ty);

  ctx.textAlign = "left";
  ctx.fillStyle = "#0b5ca8";
  ctx.font = 'bold 34px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(`${summary.formattedAmount} ${summary.currency}`, 92, ty);

  ty += 46;
  ctx.textAlign = "right";
  ctx.fillStyle = "#475569";
  ctx.font = '19px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(
    `سعر الصرف: ${summary.exchangeRate}${summary.dueDate ? ` · تاريخ الاستحقاق: ${summary.dueDate}` : ""}`,
    width - 92,
    ty,
  );

  if (summary.footerNote) {
    cursorY += totalBoxH + 28;
    ctx.fillStyle = "#fff7ed";
    ctx.strokeStyle = "#fed7aa";
    ctx.lineWidth = 1.5;
    ctx.fillRect(64, cursorY, width - 128, 56);
    ctx.strokeRect(64, cursorY, width - 128, 56);
    ctx.textAlign = "center";
    ctx.fillStyle = "#9a3412";
    ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(summary.footerNote.slice(0, 90), width / 2, cursorY + 36);
  }

  // Page Footer
  const stamp = summary.generatedAtIso.slice(0, 16).replace("T", " ");
  ctx.fillStyle = "#64748b";
  ctx.font = '18px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(`صادر عن قاعدة بيانات ${summary.companyName}`, width - 64, height - 48);
  ctx.textAlign = "left";
  ctx.fillText(`Generated: ${stamp} · Page 1`, 64, height - 48);

  return canvas;
}

/** Complete source details accompany the compact first-page summary. Stored
 * totals are displayed verbatim; metadata discounts are never subtracted. */
export function invoiceSourceDetailBlocks(summary: InvoicePdfSummaryData): string[] {
  return [
    `الشركة: ${summary.companyName}`,
    `المستند: ${summary.title} · ${summary.entryNumber}`,
    `رقم المستند: ${summary.documentNumber}`,
    `الحساب: ${summary.accountName}`,
    `الحساب المقابل: ${summary.counterpartName}`,
    `المخزن: ${summary.warehouseName}`,
    `التاريخ: ${summary.entryDate}`,
    ...(summary.sourceReference ? [`المرجع: ${summary.sourceReference}`] : []),
    ...(summary.headerDiscount != null && summary.headerDiscount !== 0
      ? [`خصم الفاتورة المسجل: ${formatAmount(summary.headerDiscount)} ${summary.currency}`] : []),
    `إجمالي المستند الأصلي: ${summary.formattedAmount} ${summary.currency}`,
    ...(summary.notes ? [`البيان الكامل:\n${summary.notes}`] : []),
    ...summary.lines.flatMap((line, index) => [
      `البند ${index + 1}: ${line.description}`,
      `الوحدة: ${line.unit} · الكمية: ${line.quantity} · السعر: ${line.unitPrice} · الإجمالي: ${line.lineTotal}`,
      ...(line.metadata ?? []),
    ]),
    ...(summary.footerNote ? [summary.footerNote] : []),
  ];
}

/** Fixed-height pages; neither source text nor unusually long words are cut. */
export function paginateInvoiceSourceDetails(
  summary: InvoicePdfSummaryData,
  measure: (text: string) => number,
  width = 1112,
  linesPerPage = 48,
): string[][] {
  const lines: string[] = [];
  for (const block of invoiceSourceDetailBlocks(summary)) {
    for (const paragraph of block.split(/\r\n|\r|\n/)) {
      let line = "";
      for (const character of Array.from(paragraph)) {
        if (line && measure(line + character) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
      lines.push(line);
    }
    lines.push("");
  }
  const pages: string[][] = [];
  const size = Math.max(1, Math.floor(linesPerPage));
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size));
  return pages;
}

function appendInvoiceSourcePages(pdf: jsPDF, summary: InvoicePdfSummaryData): void {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز تفاصيل الفاتورة كاملة.");
  ctx.font = '22px "Segoe UI", Tahoma, Arial, sans-serif';
  const pages = paginateInvoiceSourceDetails(summary, (text) => ctx.measureText(text).width);
  pages.forEach((lines, index) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#07365d";
    ctx.font = 'bold 30px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(`تفاصيل المستند ${summary.entryNumber}`, 1176, 80);
    ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText("الأرقام والخصومات كما حُفظت، دون إعادة احتساب الإجمالي", 1176, 120);
    ctx.fillStyle = "#0f172a";
    ctx.font = '22px "Segoe UI", Tahoma, Arial, sans-serif';
    lines.forEach((line, row) => ctx.fillText(line, 1176, 185 + row * 28));
    ctx.fillStyle = "#64748b";
    ctx.font = '18px "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.fillText(`تفاصيل محفوظة · صفحة ${index + 1} من ${pages.length}`, 1176, 1700);
    pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0,
      pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "FAST");
  });
}

function createInvoiceSummaryPdfDoc(summary: InvoicePdfSummaryData): { pdf: jsPDF; filename: string } {
  const canvas = drawInvoiceSummaryCanvas(summary);
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const renderedHeight = (canvas.height * pageWidth) / canvas.width;
  const fitHeight = Math.min(renderedHeight, pageHeight);
  pdf.addImage(imgData, "PNG", 0, 0, pageWidth, fitHeight, undefined, "FAST");
  appendInvoiceSourcePages(pdf, summary);

  const safeDate = (summary.entryDate || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  const filename = `nasqo-invoice-${summary.entryNumber}-${safeDate}.pdf`;
  return { pdf, filename };
}

export async function buildInvoiceSummaryPdfBytes(
  summary: InvoicePdfSummaryData,
): Promise<{ bytes: Uint8Array; filename: string; mimeType: string }> {
  const { pdf, filename } = createInvoiceSummaryPdfDoc(summary);
  const buffer = pdf.output("arraybuffer");
  return {
    bytes: new Uint8Array(buffer),
    filename,
    mimeType: "application/pdf",
  };
}

export async function generateInvoiceSummaryPdf(
  summary: InvoicePdfSummaryData,
  mode: "download" | "share" = "download",
): Promise<{ result: "downloaded" | "shared" | "cancelled"; filename: string }> {
  const { pdf, filename } = createInvoiceSummaryPdfDoc(summary);
  if(usesNativeDocumentOutput()){
    const ok=await outputNativeDocument(new Uint8Array(pdf.output("arraybuffer")),filename,"application/pdf",mode==="share"?"share":"save");
    return {result:ok?(mode==="share"?"shared":"downloaded"):"cancelled",filename};
  }

  if (mode === "share" && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const blob = pdf.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${summary.title} #${summary.entryNumber}`,
          text: `${summary.accountName} — ${summary.formattedAmount} ${summary.currency}`,
          files: [file],
        });
        return { result: "shared", filename };
      }
    } catch {
      // Fallback to direct download below
    }
  }

  pdf.save(filename);
  return { result: "downloaded", filename };
}

export async function generatePrintableInvoicePdfFromDatabase(
  uid: string,
  entryId: string,
  options?: {
    companyName?: string;
    footerNote?: string;
    mode?: "download" | "share";
    fallbackEntry?: LedgerEntryRecord;
  },
): Promise<{
  entry: LedgerEntryRecord;
  summary: InvoicePdfSummaryData;
  result: "downloaded" | "shared" | "cancelled";
  filename: string;
}> {
  const { fetchInvoiceDetailWithLines } = await import("../firebase");
  const detail = await fetchInvoiceDetailWithLines(uid, entryId).catch(()=>null);
  const dbEntry = detail ? {...detail.entry,lines:detail.lines.map(l=>({...l,inventoryItemId:l.inventoryItemId??undefined}))} : null;
  const resolvedEntry = dbEntry ?? options?.fallbackEntry ?? null;
  if (!resolvedEntry) {
    throw new Error("Invoice not found in database");
  }
  if(usesNativeDocumentOutput()&&
      ((resolvedEntry.invoiceContent==="items"&&!resolvedEntry.lines?.length)||
       (resolvedEntry.lineCount??0)>(resolvedEntry.lines?.length??0)))
    throw new Error("تفاصيل الأصناف غير متاحة؛ لم يُنشأ مستند ناقص.");
  const summary = buildInvoicePdfSummaryData(resolvedEntry, {
    companyName: options?.companyName,
    footerNote: options?.footerNote,
  });
  const exported = await generateInvoiceSummaryPdf(summary, options?.mode ?? "download");
  return {
    entry: resolvedEntry,
    summary,
    result: exported.result,
    filename: exported.filename,
  };
}

export async function exportDashboardSummaryPdf(
  payload: DashboardPdfPayload,
  mode: "download" | "share" = "download",
): Promise<"downloaded" | "shared" | "cancelled"> {
  const canvas = drawSummaryCanvas(payload);
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const renderedHeight = (canvas.height * pageWidth) / canvas.width;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const fitHeight = Math.min(renderedHeight, pageHeight);
  pdf.addImage(imgData, "PNG", 0, 0, pageWidth, fitHeight, undefined, "FAST");

  const filename = `nasqo-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
  if(usesNativeDocumentOutput()){
    const ok=await outputNativeDocument(new Uint8Array(pdf.output("arraybuffer")),filename,"application/pdf",mode==="share"?"share":"save");
    return ok?(mode==="share"?"shared":"downloaded"):"cancelled";
  }

  if (mode === "share" && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const blob = pdf.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `التقرير المالي - ${payload.companyName}`,
          text: `إجمالي المبيعات: ${formatAmount(payload.summary.totalSales)} ${payload.defaultCurrency} | نواقص المخزون: ${payload.summary.lowStockItems.length}`,
          files: [file],
        });
        return "shared";
      }
    } catch {
      // Fallback to direct download below
    }
  }

  pdf.save(filename);
  return "downloaded";
}
