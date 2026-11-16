import { useMemo, useState } from "react";
import { CheckCircledIcon, CopyIcon, DownloadIcon, RocketIcon } from "@radix-ui/react-icons";
import { useKeyboard } from "../../mobile";
import {
  buildFlutterBundlePayload,
  getFlutterFileName,
  type FlutterProjectFile,
} from "../../utils/flutterExport";
import { triggerHaptic } from "../../utils/haptics";

import pubspecYaml from "../../../flutter_app/pubspec.yaml?raw";
import readmeMd from "../../../flutter_app/README.md?raw";
import mainDart from "../../../flutter_app/lib/main.dart?raw";
import modelsDart from "../../../flutter_app/lib/models/erp_models.dart?raw";
import engineDart from "../../../flutter_app/lib/services/accounting_engine.dart?raw";
import localDbDart from "../../../flutter_app/lib/services/local_database.dart?raw";
import controllerDart from "../../../flutter_app/lib/state/erp_controller.dart?raw";
import dashboardDart from "../../../flutter_app/lib/screens/dashboard_screen.dart?raw";
import erpHubDart from "../../../flutter_app/lib/screens/erp_hub_screen.dart?raw";
import posCrmDart from "../../../flutter_app/lib/screens/pos_crm_screen.dart?raw";
import invoiceFormDart from "../../../flutter_app/lib/screens/invoice_form_sheet.dart?raw";
import customerListDart from "../../../flutter_app/lib/screens/customer_list_sheet.dart?raw";
import financeDart from "../../../flutter_app/lib/screens/finance_screen.dart?raw";
import hrDart from "../../../flutter_app/lib/screens/hr_screen.dart?raw";
import procurementDart from "../../../flutter_app/lib/screens/procurement_screen.dart?raw";
import manufacturingDart from "../../../flutter_app/lib/screens/manufacturing_screen.dart?raw";
import testDart from "../../../flutter_app/test/accounting_engine_test.dart?raw";

const FLUTTER_FILES: readonly FlutterProjectFile[] = [
  { path: "pubspec.yaml", label: "pubspec.yaml", language: "yaml", content: pubspecYaml },
  { path: "lib/main.dart", label: "main.dart", language: "dart", content: mainDart },
  { path: "lib/models/erp_models.dart", label: "erp_models.dart", language: "dart", content: modelsDart },
  { path: "lib/services/accounting_engine.dart", label: "accounting_engine.dart", language: "dart", content: engineDart },
  { path: "lib/services/local_database.dart", label: "local_database.dart", language: "dart", content: localDbDart },
  { path: "lib/state/erp_controller.dart", label: "erp_controller.dart", language: "dart", content: controllerDart },
  { path: "lib/screens/dashboard_screen.dart", label: "dashboard_screen.dart", language: "dart", content: dashboardDart },
  { path: "lib/screens/erp_hub_screen.dart", label: "erp_hub_screen.dart", language: "dart", content: erpHubDart },
  { path: "lib/screens/pos_crm_screen.dart", label: "pos_crm_screen.dart", language: "dart", content: posCrmDart },
  { path: "lib/screens/invoice_form_sheet.dart", label: "invoice_form_sheet.dart", language: "dart", content: invoiceFormDart },
  { path: "lib/screens/customer_list_sheet.dart", label: "customer_list_sheet.dart", language: "dart", content: customerListDart },
  { path: "lib/screens/finance_screen.dart", label: "finance_screen.dart", language: "dart", content: financeDart },
  { path: "lib/screens/hr_screen.dart", label: "hr_screen.dart", language: "dart", content: hrDart },
  { path: "lib/screens/procurement_screen.dart", label: "procurement_screen.dart", language: "dart", content: procurementDart },
  { path: "lib/screens/manufacturing_screen.dart", label: "manufacturing_screen.dart", language: "dart", content: manufacturingDart },
  { path: "test/accounting_engine_test.dart", label: "accounting_engine_test.dart", language: "dart", content: testDart },
  { path: "README.md", label: "README.md", language: "markdown", content: readmeMd },
];

function triggerDownload(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FlutterExportModal({
  open,
  onClose,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const keyboard = useKeyboard();
  const [selectedPath, setSelectedPath] = useState(FLUTTER_FILES[1].path);

  const activeFile = useMemo(
    () => FLUTTER_FILES.find((f) => f.path === selectedPath) ?? FLUTTER_FILES[0],
    [selectedPath],
  );

  if (!open) return null;

  const handleCopyFile = async () => {
    triggerHaptic("light");
    try {
      await navigator.clipboard?.writeText(activeFile.content);
      onToast(`تم نسخ محتوى ${activeFile.path}`);
    } catch {
      onToast("تعذر النسخ التلقائي — استخدم زر التنزيل");
    }
  };

  const handleDownloadSingleFile = () => {
    triggerHaptic("success");
    triggerDownload(
      getFlutterFileName(activeFile.path),
      activeFile.content,
      "text/plain;charset=utf-8",
    );
    onToast(`تم تنزيل ${getFlutterFileName(activeFile.path)}`);
  };

  const handleDownloadFullProject = () => {
    triggerHaptic("success");
    const bundle = buildFlutterBundlePayload(FLUTTER_FILES);
    triggerDownload(
      "nasqo_pro_erp_flutter_project.json",
      JSON.stringify(bundle, null, 2),
      "application/json;charset=utf-8",
    );
    onToast(`تم تنزيل حزمة مشروع Flutter كاملة (${FLUTTER_FILES.length} ملفًا)`);
  };

  return (
    <div className="center-modal-layer" data-testid="flutter-export-modal">
      <button
        type="button"
        className="center-modal-backdrop"
        onClick={() => {
          keyboard.hide();
          onClose();
        }}
        aria-label="إغلاق مشروع Flutter"
      />
      <section
        className="ref-dialog-card transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flutter-export-title"
        style={{
          maxWidth: "460px",
          maxHeight: "calc(100% - 24px)",
          overflowY: "auto",
          padding: "10px",
          gap: "6px",
        }}
      >
        <div className="transfer-modal-head" style={{ marginBottom: "2px" }}>
          <h2 id="flutter-export-title" style={{ fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
            <RocketIcon />
            <span>مشروع Flutter المحوّل (Dart 3)</span>
          </h2>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ background: "transparent", color: "var(--nasqo-blue)", fontWeight: "bold", fontSize: "14px" }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "var(--nasqo-brand-tint)",
            color: "var(--nasqo-ink)",
            border: "1px solid var(--nasqo-line)",
            borderRadius: "8px",
            padding: "8px",
            fontSize: "11px",
            lineHeight: 1.45,
          }}
        >
          تم تحويل التطبيق بالكامل إلى <strong>{FLUTTER_FILES.length} ملف Flutter/Dart</strong> داخل
          المجلد <code dir="ltr">flutter_app/</code> مع دعم RTL والمحاسبة وInvoiceForm وCustomerList.
        </div>

        <label className="erp-field" style={{ gap: "4px" }}>
          <span style={{ fontSize: "11px" }}>تصفح ملفات المشروع المحوّل</span>
          <select
            aria-label="اختر ملف Flutter"
            value={activeFile.path}
            onChange={(e) => setSelectedPath(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid var(--nasqo-line)",
              background: "var(--nasqo-surface)",
              color: "var(--nasqo-ink)",
              fontSize: "12px",
              direction: "ltr",
              textAlign: "left",
            }}
          >
            {FLUTTER_FILES.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path}
              </option>
            ))}
          </select>
        </label>

        <pre
          dir="ltr"
          style={{
            margin: 0,
            maxHeight: "200px",
            overflow: "auto",
            padding: "8px",
            borderRadius: "8px",
            background: "#0f172a",
            color: "#e2e8f0",
            fontSize: "10px",
            lineHeight: 1.45,
            textAlign: "left",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <code>{activeFile.content}</code>
        </pre>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          <button
            type="button"
            className="erp-secondary-btn"
            onClick={() => void handleCopyFile()}
            style={{ minHeight: "34px", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <CopyIcon />
            <span>نسخ الملف</span>
          </button>
          <button
            type="button"
            className="erp-secondary-btn"
            onClick={handleDownloadSingleFile}
            style={{ minHeight: "34px", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <DownloadIcon />
            <span>تنزيل {activeFile.label}</span>
          </button>
        </div>

        <div className="ref-action-bar cols-2" style={{ marginTop: "4px" }}>
          <button
            type="button"
            className="ref-btn blue"
            onClick={handleDownloadFullProject}
            data-testid="flutter-download-bundle-btn"
            style={{ minHeight: "36px", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <CheckCircledIcon />
            <span>تنزيل حزمة Flutter كاملة</span>
          </button>
          <button
            type="button"
            className="ref-btn purple"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ minHeight: "36px", fontSize: "11px" }}
          >
            إغلاق
          </button>
        </div>
      </section>
    </div>
  );
}
