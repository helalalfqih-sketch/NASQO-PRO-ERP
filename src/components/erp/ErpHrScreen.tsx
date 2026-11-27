import { executeErpAction } from "../../firebase";
import { ErpRecordManager } from "./ErpRecordManager";
import { usesNativeDocumentOutput } from "../../hybrid/documentOutput";
import { useMemo, useState } from "react";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { formatAmount } from "../../accounting";
import {
  computePayrollTotals,
  type ErpWorkspaceData,
} from "../../erp";
import { MobileScroll, useKeyboard } from "../../mobile";
import type { AccountRecord, WarehouseRecord } from "../../types";
import { triggerHaptic } from "../../utils/haptics";

type HrTab = "payroll" | "leaves";

export function ErpHrScreen({
  uid,
  currency,
  accounts,
  warehouses,
  erpData,
  onUpdateErpData,
  onToast,
}: {
  uid: string;
  currency: string;
  accounts: readonly AccountRecord[];
  warehouses: readonly WarehouseRecord[];
  erpData: ErpWorkspaceData;
  onUpdateErpData: (next: ErpWorkspaceData) => Promise<boolean>;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<HrTab>("payroll");
  const [postingPayroll, setPostingPayroll] = useState(false);
  const keyboard = useKeyboard();

  const payrollTotals = useMemo(() => computePayrollTotals(erpData.employees), [erpData.employees]);
  const currentMonthKey = new Date().toISOString().slice(0, 7);

  const handlePostPayrollToGl = async () => {
    if(usesNativeDocumentOutput()){onToast("هذا الترحيل المتقدم غير مدعوم محليًا بعد؛ استخدم شاشة المستند الأصلية. لم يُرحّل أي أثر.");return;}
    keyboard.hide();
    if (payrollTotals.totalNetPayroll <= 0) {
      onToast("لا توجد رواتب مستحقة للترحيل");
      return;
    }
    setPostingPayroll(true);
    try {
      await executeErpAction(uid,{action:'postPayroll',currency,month:currentMonthKey});
      triggerHaptic("success");
      onToast(`تم ترحيل مسير الرواتب (${formatAmount(payrollTotals.totalNetPayroll)} ${currency}) للأستاذ العام`);
    } catch (e) {
      onToast(e instanceof Error?e.message:"تعذر ترحيل مسير الرواتب حاليًا");
    } finally {
      setPostingPayroll(false);
    }
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-hr-screen">
        {usesNativeDocumentOutput()?<p role="note" className="field-inline-error">حفظ السجلات الإدارية متاح محليًا. الترحيل المتقدم والاستلام والتصنيع غير متاحة هنا؛ استخدم شاشات الفاتورة والسند الأصلية.</p>:null}
        <div className="erp-segmented" role="tablist" aria-label="الموارد البشرية">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "payroll"}
            className={tab === "payroll" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("payroll");
            }}
          >
            الموظفون والرواتب
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "leaves"}
            className={tab === "leaves" ? "active" : ""}
            onClick={() => {
              triggerHaptic("light");
              setTab("leaves");
            }}
          >
            الحضور والإجازات
          </button>
        </div>

        <section className="erp-summary-strip">
          <div>
            <small>الموظفون النشطون</small>
            <strong>{payrollTotals.activeCount}</strong>
          </div>
          <div>
            <small>إجمالي مسير الشهر</small>
            <strong className="pos">
              <bdi>{formatAmount(payrollTotals.totalNetPayroll)} {currency}</bdi>
            </strong>
          </div>
        </section>

        {tab === "payroll" ? (
          <>
            <section className="erp-card">
              <div className="erp-card-head">
                <div>
                  <h3>ترحيل مسير الرواتب للمحاسبة</h3>
                  <small>
                    {erpData.lastPayrollRunMonth === currentMonthKey
                      ? `تم ترحيل مسير ${currentMonthKey}`
                      : `مسير ${currentMonthKey} جاهز للاعتماد`}
                  </small>
                </div>
                <button
                  type="button"
                  className="erp-primary-btn"
                  disabled={usesNativeDocumentOutput() || postingPayroll}
                  onClick={handlePostPayrollToGl}
                  data-testid="erp-post-payroll-btn"
                >
                  <CheckCircledIcon />
                  <span>{postingPayroll ? "جاري الترحيل..." : "ترحيل للأستاذ العام"}</span>
                </button>
              </div>
            </section>

            <ErpRecordManager uid={uid} collection="employees" erpData={erpData} currency={currency} accounts={accounts} onToast={onToast}/>
          </>
        ) : <ErpRecordManager uid={uid} collection="leaveRequests" erpData={erpData} onToast={onToast}/>}
      </main>
    </MobileScroll>
  );
}
