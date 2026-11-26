import { eligibleCashbox, resolveCashbox } from "../utils/documentReferences";
import { useEffect, useMemo, useState, useRef } from "react";
import { KeyboardInput, useKeyboard } from "../mobile";
import {
  computeAccountSummary,
  formatAmount,
  limitSelectAccounts,
  maxNumericField,
  parseArabicNumber,
} from "../accounting";
import { createLedgerEntry } from "../firebase";
import {
  CURRENCIES,
  type AccountRecord,
  type WorkspaceSettings,
  type CashboxRecord,
  type CurrencyCode,
  type LedgerEntryRecord,
} from "../types";
import { triggerHaptic } from "../utils/haptics";
import { AccountSelectCombobox } from "./AccountSelectCombobox";
import { OutlinedAmountField } from "./OutlinedAmountField";

interface TransferModalProps {
  open: boolean;
  uid: string;
  workspace?: WorkspaceSettings | null;
  accounts: readonly AccountRecord[];
  cashboxes?: readonly CashboxRecord[];
  currencyOptions?: readonly string[];
  ledger: readonly LedgerEntryRecord[];
  defaultAccountId?: string;
  onClose: () => void;
  onCreateAccount: () => void;
  onManageAccount?:(select:(id:string)=>void)=>void;
  onManageCashbox?:(select:(id:number)=>void,currency:string)=>void;
  onNotify: (msg: string) => void;
  onSendWhatsApp: (account: AccountRecord | undefined, message: string) => void;
  onGenerateImage: (data: {
    title: string;
    subtitle: string;
    rows: [string, string][];
  }) => void;
  onCreateLedgerEntry?: (
    entry: Omit<LedgerEntryRecord, "id" | "ownerId" | "createdAtMs">,
  ) => Promise<unknown>;
}

export function TransferModal({
  open,
  uid, workspace,
  accounts,
  cashboxes: sqliteCashboxes = [],
  currencyOptions = CURRENCIES,
  ledger,
  defaultAccountId,
  onClose,
  onCreateAccount,onManageAccount,onManageCashbox,
  onNotify,
  onSendWhatsApp,
  onGenerateImage,
  onCreateLedgerEntry,
}: TransferModalProps) {
  const keyboard = useKeyboard();
  const [closeAfterSave, setCloseAfterSave] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState(defaultAccountId ?? workspace?.referenceDefaults?.accountId ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(workspace?.defaultCurrency ?? "ريال");
  const [commission, setCommission] = useState("");
  const [commissionCurrency, setCommissionCurrency] = useState<CurrencyCode>(workspace?.defaultCurrency ?? "ريال");
  const [senderName, setSenderName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [transferCompany, setTransferCompany] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [details, setDetails] = useState("");
  const [cashboxId, setCashboxId] = useState("");
  const [sqliteCashboxId, setSqliteCashboxId] = useState<number | undefined>(() => resolveCashbox(workspace?.referenceDefaults,sqliteCashboxes,currency,accounts.find(a=>a.id===selectedAccountId)));
  const [direction, setDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [saving, setSaving] = useState(false);

  const cashboxes = useMemo(
    () => (open ? accounts.filter((a) => a.isCashAccount || a.category === "shop") : []),
    [accounts, open],
  );

  const opened=useRef(false),manualBox=useRef(false),defaults=useRef(workspace?.referenceDefaults);
  useEffect(()=>{
    if(!open){opened.current=false;return;}
    if(opened.current)return;
    opened.current=true;defaults.current=workspace?.referenceDefaults;manualBox.current=false;
    const id=defaultAccountId??workspace?.referenceDefaults?.accountId??"",account=accounts.find(a=>a.id===id);
    const c=account?.currency??workspace?.defaultCurrency??"ريال";
    setSelectedAccountId(id);setCurrency(c);setCashboxId("");
    setSqliteCashboxId(resolveCashbox(defaults.current,sqliteCashboxes,c,account));
  },[open,defaultAccountId,workspace,accounts,sqliteCashboxes]);
  const chooseBox=(id:number|undefined)=>{manualBox.current=true;setSqliteCashboxId(id);};
  const chooseAccount=(id:string)=>{setSelectedAccountId(id);if(!manualBox.current)setSqliteCashboxId(resolveCashbox(defaults.current,sqliteCashboxes,currency,accounts.find(a=>a.id===id)));};
  const chooseCurrency=(c:CurrencyCode)=>{setCurrency(c);setSqliteCashboxId(manualBox.current?eligibleCashbox(sqliteCashboxes,sqliteCashboxId,c):resolveCashbox(defaults.current,sqliteCashboxes,c,accounts.find(a=>a.id===selectedAccountId)));};
  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId);

  const activeSummary = useMemo(
    () => (open && activeAccount ? computeAccountSummary(activeAccount, ledger) : null),
    [activeAccount, ledger, open],
  );

  const selectCashboxOpts = useMemo(
    () => limitSelectAccounts(cashboxes.length ? cashboxes : accounts, cashboxId, 150),
    [accounts, cashboxId, cashboxes],
  );

  if (!open) return null;

  const now = new Date();
  const dayLabel = now.toLocaleDateString("ar-SA", { weekday: "long" });
  const stampLabel = `${now.toLocaleDateString("en-GB")} ${now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} ${dayLabel}`;

  const parsedAmount = parseArabicNumber(amount);
  const parsedCommission = parseArabicNumber(commission);

  const composeDetailsText = () => {
    const parts: string[] = [];
    parts.push(direction === "outgoing" ? "حوالة صادرة" : "حوالة واردة");
    if (senderName.trim()) parts.push(`المرسل: ${senderName.trim()}`);
    if (recipientName.trim()) parts.push(`المستلم: ${recipientName.trim()}`);
    if (transferCompany.trim()) parts.push(`الشركة: ${transferCompany.trim()}`);
    if (parsedCommission > 0) parts.push(`العمولة: ${formatAmount(parsedCommission)} ${commissionCurrency}`);
    if (details.trim()) parts.push(details.trim());
    return parts.join(" | ");
  };

  const resetFormFields = () => {
    setAmount("");
    setCommission("");
    setSenderName("");
    setRecipientName("");
    setTransferCompany("");
    setTransferNumber("");
    setDetails("");
  };

  const submitTransfer = async (andAction?: "whatsapp" | "image") => {
    keyboard.hide();
    if (!activeAccount || parsedAmount <= 0) {
      triggerHaptic("warning");
      onNotify("أدخل مبلغ الحوالة واختر الحساب أولًا");
      return;
    }
    if(!eligibleCashbox(sqliteCashboxes,sqliteCashboxId,currency)){onNotify("اختر صندوقًا نقديًا من عملة الحوالة قبل الحفظ.");return;}
    const cashboxAcc = accounts.find((a) => a.id === cashboxId);
    if (cashboxAcc && cashboxAcc.id === activeAccount.id && accounts.length > 1) {
      triggerHaptic("warning");
      onNotify("لا يمكن أن يكون حساب الحوالة وحساب الصندوق المقابل هما نفس الحساب");
      return;
    }
    setSaving(true);
    try {
      const nextNum = maxNumericField(ledger, (e) => e.entryNumber, 1000) + 1;
      const composedDetails = composeDetailsText();
      const payload: Omit<LedgerEntryRecord, "id" | "ownerId" | "createdAtMs"> = {
        accountId: activeAccount.id,
        accountName: activeAccount.name,
        counterpartAccountId: cashboxAcc && cashboxAcc.id !== activeAccount.id ? cashboxAcc.id : "",
        counterpartAccountName: cashboxAcc && cashboxAcc.id !== activeAccount.id ? cashboxAcc.name : "الصندوق",
        ...(sqliteCashboxId ? { cashboxId: sqliteCashboxId } : {}),
        kind: "transfer",
        typeLabel: direction === "outgoing" ? "حوالة صادرة" : "حوالة واردة",
        payment: "cash",
        direction: direction === "outgoing" ? "debit" : "credit",
        amount: parsedAmount,
        currency,
        exchangeRate: 1,
        details: composedDetails,
        documentNumber: transferNumber.trim() || String(nextNum),
        warehouseId: "",
        warehouseName: "",
        invoiceContent: "none",
        entryNumber: nextNum,
        deleted: false,
        entryDate: now.toISOString().slice(0, 10),
      };
      if (onCreateLedgerEntry) {
        await onCreateLedgerEntry(payload);
      } else {
        await createLedgerEntry(uid, payload);
      }
      triggerHaptic("success");
      onNotify(`تم حفظ الحوالة رقم #${nextNum} بنجاح`);

      if (andAction === "whatsapp") {
        const msg = `إشعار حوالة (${direction === "outgoing" ? "صادرة" : "واردة"}) #${nextNum}\nالحساب: ${activeAccount.name}\nالمبلغ: ${formatAmount(parsedAmount)} ${currency}${parsedCommission > 0 ? `\nالعمولة: ${formatAmount(parsedCommission)} ${commissionCurrency}` : ""}${senderName.trim() ? `\nالمرسل: ${senderName.trim()}` : ""}${recipientName.trim() ? `\nالمستلم: ${recipientName.trim()}` : ""}${transferCompany.trim() ? `\nالشركة: ${transferCompany.trim()}` : ""}${transferNumber.trim() ? `\nرقم الحوالة: ${transferNumber.trim()}` : ""}`;
        onSendWhatsApp(activeAccount, msg);
      } else if (andAction === "image") {
        onGenerateImage({
          title: `سند حوالة ${direction === "outgoing" ? "صادرة" : "واردة"} #${nextNum}`,
          subtitle: activeAccount.name,
          rows: [
            ["التاريخ", stampLabel],
            ["المبلغ", `${formatAmount(parsedAmount)} ${currency}`],
            ["العمولة", `${formatAmount(parsedCommission)} ${commissionCurrency}`],
            ["المرسل", senderName.trim() || "—"],
            ["المستلم", recipientName.trim() || "—"],
            ["شركة التحويل", transferCompany.trim() || "—"],
            ["رقم الحوالة", transferNumber.trim() || `#${nextNum}`],
            ["الصندوق", cashboxAcc?.name ?? "الصندوق"],
          ],
        });
      }

      if (closeAfterSave) {
        onClose();
      } else {
        resetFormFields();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="transfer-modal">
      <button
        type="button"
        className="center-modal-backdrop"
        onClick={() => {
          keyboard.hide();
          onClose();
        }}
        aria-label="إغلاق الحوالة"
      />
      <section
        className="ref-dialog-card transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
      >
        <div className="transfer-modal-head">
          <h2 id="transfer-modal-title">إضافة حوالة جديدة</h2>
          <label className="transfer-close-check">
            <span>الإغلاق بعد الحفظ</span>
            <input
              type="checkbox"
              checked={closeAfterSave}
              onChange={(e) => setCloseAfterSave(e.target.checked)}
            />
          </label>
        </div>

        <div className="transfer-stamp-row">
          <span className="transfer-stamp-badge">
            <bdi>{stampLabel}</bdi>
          </span>
        </div>

        <AccountSelectCombobox
          accounts={accounts}
          value={activeAccount?.id ?? ""}
          onChange={chooseAccount}
          preferredCategories={["transfers", "clients", "shop"]}
          placeholder="اختر حساب الحوالة"
          searchPlaceholder="ابحث عن حساب للحوالة..."
          ariaLabel="اختر حساب الحوالة"
          searchAriaLabel="بحث عن حساب للحوالة"
          triggerTestId="transfer-account-trigger"
          searchTestId="transfer-account-search"
          listTestId="transfer-account-list"
          onAddAccount={()=>onManageAccount?onManageAccount(chooseAccount):onCreateAccount()}
          addAccountAriaLabel="إضافة حساب جديد"
          compact
        />



        <div className="transfer-balance-strip">
          <span>الرصيد</span>
          <strong dir="ltr">
            {activeSummary ? formatAmount(activeSummary.netBalance) : "0"}
          </strong>
        </div>

        <div className="transfer-amount-commission-stack">
          <OutlinedAmountField
            label="المبلغ"
            ariaLabel="مبلغ الحوالة"
            testId="transfer-amount-input"
            currency={currency}
            value={amount}
            onChange={(next) => setAmount(next)}
            currencySlot={
              <select
                aria-label="عملة الحوالة"
                value={currency}
                onChange={(e) => chooseCurrency(e.target.value as CurrencyCode)}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            }
          />
          <OutlinedAmountField
            label="العمولة"
            ariaLabel="عمولة الحوالة"
            currency={commissionCurrency}
            value={commission}
            compact
            onChange={(next) => setCommission(next)}
            currencySlot={
              <select
                aria-label="عملة العمولة"
                value={commissionCurrency}
                onChange={(e) => setCommissionCurrency(e.target.value as CurrencyCode)}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            }
          />
        </div>

        <div className="transfer-grid-2">
          <KeyboardInput
            aria-label="اسم المرسل"
            placeholder="اسم المرسل"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
          />
          <KeyboardInput
            aria-label="اسم المستلم"
            placeholder="اسم المستلم"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
          />
          <KeyboardInput
            aria-label="شركة التحويل"
            placeholder="شركة التحويل"
            value={transferCompany}
            onChange={(e) => setTransferCompany(e.target.value)}
          />
          <KeyboardInput
            aria-label="رقم الحوالة"
            placeholder="رقم الحوالة"
            value={transferNumber}
            onChange={(e) => setTransferNumber(e.target.value)}
          />
        </div>

        <div className="transfer-details-row">
          <KeyboardInput
            aria-label="تفاصيل الحوالة"
            placeholder="التفاصيل"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>

        <label className="transfer-cashbox-row">
          <span>حساب الصندوق</span>
          <select
            aria-label="حساب الصندوق للحوالة"
            value={cashboxId}
            onChange={(e) => setCashboxId(e.target.value)}
          >
            {selectCashboxOpts.options.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
            {selectCashboxOpts.truncatedCount > 0 ? (
              <option value="" disabled>
                — يتم عرض أول {selectCashboxOpts.options.length} حساب —
              </option>
            ) : null}
          </select>
        </label>

        {onManageCashbox?<button type="button" onClick={()=>{keyboard.hide();onManageCashbox(chooseBox,currency);}}>+ إدارة صندوق الحوالة</button>:null}
        {sqliteCashboxes.length > 0 ? (
          <label className="transfer-cashbox-row">
            <span>صندوق النقدية</span>
            <select
              aria-label="صندوق النقدية للحوالة"
              value={sqliteCashboxId ?? ""}
              onChange={(e) => chooseBox(e.target.value?Number(e.target.value):undefined)}
            >
              <option value="">غير محدد</option>
              {sqliteCashboxes.filter(b=>eligibleCashbox(sqliteCashboxes,b.id,currency)!==undefined).map((cb) => (
                <option key={cb.id} value={cb.id}>
                  {cb.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="transfer-direction-row" role="radiogroup" aria-label="اتجاه الحوالة">
          <label>
            <input
              type="radio"
              name="transfer-dir"
              checked={direction === "outgoing"}
              onChange={() => setDirection("outgoing")}
            />
            <span>صادرة</span>
          </label>
          <label>
            <input
              type="radio"
              name="transfer-dir"
              checked={direction === "incoming"}
              onChange={() => setDirection("incoming")}
            />
            <span>واردة</span>
          </label>
        </div>

        <div className="ref-action-bar cols-4">
          <button
            type="button"
            className="ref-btn blue"
            disabled={saving}
            onClick={() => void submitTransfer()}
            data-testid="transfer-save-btn"
          >
            {saving ? "..." : "حفظ"}
          </button>
          <button
            type="button"
            className="ref-btn green"
            disabled={saving}
            onClick={() => void submitTransfer("whatsapp")}
          >
            إرسال
          </button>
          <button
            type="button"
            className="ref-btn blue"
            disabled={saving}
            onClick={() => void submitTransfer("image")}
          >
            صورة
          </button>
          <button
            type="button"
            className="ref-btn purple"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
          >
            إغلاق
          </button>
        </div>
      </section>
    </div>
  );
}
