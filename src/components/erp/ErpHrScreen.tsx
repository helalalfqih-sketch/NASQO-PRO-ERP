import { useMemo, useState } from "react";
import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { formatAmount } from "../../accounting";
import {
  computeEmployeeNetSalary,
  computePayrollTotals,
  parsePositiveNumber,
  type ErpEmployeeProfile,
  type ErpLeaveRequest,
  type ErpWorkspaceData,
} from "../../erp";
import { createLedgerEntry, createOrUpdateAccount } from "../../firebase";
import { KeyboardInput, MobileScroll, useKeyboard } from "../../mobile";
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
  onUpdateErpData: (next: ErpWorkspaceData) => void;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<HrTab>("payroll");
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [name, setName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [department, setDepartment] = useState("المبيعات");
  const [basicSalary, setBasicSalary] = useState("5000");
  const [allowances, setAllowances] = useState("500");
  const [deductions, setDeductions] = useState("0");
  const [postingPayroll, setPostingPayroll] = useState(false);
  const keyboard = useKeyboard();

  const payrollTotals = useMemo(() => computePayrollTotals(erpData.employees), [erpData.employees]);
  const currentMonthKey = new Date().toISOString().slice(0, 7);

  const handleAddEmployee = () => {
    keyboard.hide();
    if (!name.trim()) {
      onToast("أدخل اسم الموظف أولًا");
      return;
    }
    const newEmp: ErpEmployeeProfile = {
      id: `emp_${Date.now()}`,
      name: name.trim(),
      roleTitle: roleTitle.trim() || "موظف",
      department: department.trim() || "الإدارة",
      basicSalary: parsePositiveNumber(basicSalary),
      allowances: parsePositiveNumber(allowances),
      deductions: parsePositiveNumber(deductions),
      status: "active",
      hireDate: new Date().toISOString().slice(0, 10),
      leaveBalanceDays: 21,
      attendanceToday: "present",
    };
    onUpdateErpData({
      ...erpData,
      employees: [newEmp, ...erpData.employees],
    });
    setName("");
    setRoleTitle("");
    setAddingEmployee(false);
    triggerHaptic("success");
    onToast(`تمت إضافة الموظف: ${newEmp.name}`);
  };

  const cycleAttendance = (empId: string) => {
    triggerHaptic("light");
    const order: ErpEmployeeProfile["attendanceToday"][] = ["present", "leave", "absent"];
    onUpdateErpData({
      ...erpData,
      employees: erpData.employees.map((emp) => {
        if (emp.id !== empId) return emp;
        const next = order[(order.indexOf(emp.attendanceToday) + 1) % order.length];
        return { ...emp, attendanceToday: next };
      }),
    });
  };

  const handleLeaveDecision = (leaveId: string, status: ErpLeaveRequest["status"]) => {
    triggerHaptic(status === "approved" ? "success" : "warning");
    const targetLeave = erpData.leaveRequests.find((l) => l.id === leaveId);
    onUpdateErpData({
      ...erpData,
      leaveRequests: erpData.leaveRequests.map((lv) => (lv.id === leaveId ? { ...lv, status } : lv)),
      employees:
        status === "approved" && targetLeave
          ? erpData.employees.map((emp) =>
              emp.id === targetLeave.employeeId
                ? {
                    ...emp,
                    leaveBalanceDays: Math.max(0, emp.leaveBalanceDays - targetLeave.days),
                    attendanceToday: "leave",
                  }
                : emp,
            )
          : erpData.employees,
    });
    onToast(status === "approved" ? "تم اعتماد الإجازة وخصم الرصيد" : "تم رفض طلب الإجازة");
  };

  const handlePostPayrollToGl = async () => {
    keyboard.hide();
    if (payrollTotals.totalNetPayroll <= 0) {
      onToast("لا توجد رواتب مستحقة للترحيل");
      return;
    }
    setPostingPayroll(true);
    try {
      let payrollAccount = accounts.find((a) => a.category === "employees");
      let accountId = payrollAccount?.id ?? "";
      let accountName = payrollAccount?.name ?? "رواتب الموظفين";

      if (!payrollAccount) {
        accountId = await createOrUpdateAccount(uid, {
          name: accountName,
          category: "employees",
          currency: currency as AccountRecord["currency"],
          openingBalance: 0,
          openingDirection: "credit",
          codeNumber: accounts.length + 20,
        });
      }

      const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0];
      await createLedgerEntry(uid, {
        accountId,
        accountName,
        kind: "voucher",
        typeLabel: "صرف رواتب (ERP)",
        payment: "cash",
        direction: "debit",
        amount: payrollTotals.totalNetPayroll,
        currency: currency as AccountRecord["currency"],
        exchangeRate: 1,
        details: `ترحيل مسير رواتب شهر ${currentMonthKey} لعدد ${payrollTotals.activeCount} موظفين`,
        warehouseId: defaultWh?.id ?? "wh_1",
        warehouseName: defaultWh?.name ?? "المخزن الرئيسي",
        invoiceContent: "none",
        entryDate: new Date().toISOString().slice(0, 10),
        expenseCategory: "رواتب وأجور",
      });

      onUpdateErpData({
        ...erpData,
        lastPayrollRunMonth: currentMonthKey,
      });
      triggerHaptic("success");
      onToast(`تم ترحيل مسير الرواتب (${formatAmount(payrollTotals.totalNetPayroll)} ${currency}) للأستاذ العام`);
    } catch {
      onToast("تعذر ترحيل مسير الرواتب حاليًا");
    } finally {
      setPostingPayroll(false);
    }
  };

  const attendanceLabel: Record<ErpEmployeeProfile["attendanceToday"], string> = {
    present: "حاضر",
    leave: "إجازة",
    absent: "غائب",
  };

  return (
    <MobileScroll className="app-screen erp-scroll">
      <main className="erp-page" data-testid="erp-hr-screen">
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
                  disabled={postingPayroll}
                  onClick={handlePostPayrollToGl}
                  data-testid="erp-post-payroll-btn"
                >
                  <CheckCircledIcon />
                  <span>{postingPayroll ? "جاري الترحيل..." : "ترحيل للأستاذ العام"}</span>
                </button>
              </div>
            </section>

            <section className="erp-card">
              <div className="erp-card-head">
                <h3>دليل الموظفين وكشف الرواتب</h3>
                <button
                  type="button"
                  className="erp-chip-btn"
                  onClick={() => {
                    keyboard.hide();
                    setAddingEmployee((v) => !v);
                  }}
                >
                  <PlusIcon />
                  <span>{addingEmployee ? "إغلاق" : "موظف جديد"}</span>
                </button>
              </div>

              {addingEmployee ? (
                <div className="erp-inline-form">
                  <KeyboardInput
                    placeholder="الاسم الكامل للموظف"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <div className="erp-form-row-2">
                    <KeyboardInput
                      placeholder="المسمى الوظيفي"
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                    />
                    <KeyboardInput
                      placeholder="القسم"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    />
                  </div>
                  <div className="erp-form-row-3">
                    <KeyboardInput
                      inputMode="decimal"
                      placeholder="الأساسي"
                      value={basicSalary}
                      onChange={(e) => setBasicSalary(e.target.value)}
                    />
                    <KeyboardInput
                      inputMode="decimal"
                      placeholder="البدلات"
                      value={allowances}
                      onChange={(e) => setAllowances(e.target.value)}
                    />
                    <KeyboardInput
                      inputMode="decimal"
                      placeholder="الاستقطاع"
                      value={deductions}
                      onChange={(e) => setDeductions(e.target.value)}
                    />
                  </div>
                  <button type="button" className="erp-primary-btn full" onClick={handleAddEmployee}>
                    حفظ بيانات الموظف
                  </button>
                </div>
              ) : null}

              <div className="erp-list">
                {erpData.employees.map((emp) => {
                  const net = computeEmployeeNetSalary(emp);
                  return (
                    <article key={emp.id} className="erp-row-card">
                      <div className="erp-row-main">
                        <div>
                          <strong>{emp.name}</strong>
                          <small>{emp.roleTitle} · {emp.department}</small>
                        </div>
                        <div className="erp-row-value">
                          <strong className="pos"><bdi>{formatAmount(net)}</bdi></strong>
                          <small>{currency} صافي</small>
                        </div>
                      </div>
                      <div className="erp-row-meta">
                        <span>أساسي: <bdi>{formatAmount(emp.basicSalary)}</bdi></span>
                        <span>بدلات: <bdi>{formatAmount(emp.allowances)}</bdi></span>
                        <span>رصيد الإجازات: <bdi>{emp.leaveBalanceDays}</bdi> يوم</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="erp-card">
            <div className="erp-card-head">
              <h3>الحضور اليومي للفريق</h3>
              <small>اضغط على الحالة للتبديل</small>
            </div>
            <div className="erp-list">
              {erpData.employees.map((emp) => (
                <div key={emp.id} className="erp-row-card">
                  <div className="erp-row-main">
                    <div>
                      <strong>{emp.name}</strong>
                      <small>{emp.department}</small>
                    </div>
                    <button
                      type="button"
                      className={`erp-status-btn status-${emp.attendanceToday}`}
                      onClick={() => cycleAttendance(emp.id)}
                    >
                      {attendanceLabel[emp.attendanceToday]}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="erp-card-head erp-card-head-spaced">
              <h3>طلبات الإجازات</h3>
              <small>
                {erpData.leaveRequests.length === 1
                  ? "طلب واحد"
                  : erpData.leaveRequests.length <= 10
                    ? `${erpData.leaveRequests.length} طلبات`
                    : `${erpData.leaveRequests.length} طلب`}
              </small>
            </div>
            <div className="erp-list">
              {erpData.leaveRequests.map((lv) => (
                <div key={lv.id} className="erp-row-card">
                  <div className="erp-row-main">
                    <div>
                      <strong>{lv.employeeName}</strong>
                      <small>{lv.leaveType} · {lv.days} أيام من <bdi>{lv.startDate}</bdi></small>
                    </div>
                    <span className={`erp-status-text status-${lv.status}`}>
                      {lv.status === "pending" ? "قيد المراجعة" : lv.status === "approved" ? "معتمدة" : "مرفوضة"}
                    </span>
                  </div>
                  {lv.note ? <p className="erp-row-note">{lv.note}</p> : null}
                  {lv.status === "pending" ? (
                    <div className="erp-inline-actions">
                      <button
                        type="button"
                        className="erp-primary-btn"
                        onClick={() => handleLeaveDecision(lv.id, "approved")}
                      >
                        اعتماد الإجازة
                      </button>
                      <button
                        type="button"
                        className="erp-danger-btn"
                        onClick={() => handleLeaveDecision(lv.id, "rejected")}
                      >
                        رفض
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </MobileScroll>
  );
}
