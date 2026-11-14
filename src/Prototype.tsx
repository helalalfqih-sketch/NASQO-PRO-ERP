import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  ActivityLogIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BackpackIcon,
  BellIcon,
  CameraIcon,
  CardStackIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  Cross2Icon,
  CubeIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FilePlusIcon,
  FileTextIcon,
  GearIcon,
  GlobeIcon,
  HamburgerMenuIcon,
  HomeIcon,
  InfoCircledIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MixIcon,
  MixerHorizontalIcon,
  MobileIcon,
  PaperPlaneIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ReaderIcon,
  ReloadIcon,
  RulerHorizontalIcon,
  RulerSquareIcon,
  Share1Icon,
  SpeakerLoudIcon,
  SwitchIcon,
  TableIcon,
  TrashIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import {
  FlowStack,
  KeyboardInput,
  MobileScroll,
  BottomSheet,
  useKeyboard,
  useScreenPortal,
  type FlowControls,
  type FlowScreen,
} from "./mobile";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DashboardScreen } from "./components/DashboardScreen";
import {
  accountMatchesQuery,
  buildCsvContent,
  computeAccountSummary,
  computeCategoryTotals,
  computeDashboardSummary,
  computeInventorySummary,
  computeStatementRows,
  formatAmount,
  normalizeArabicSearch,
  parseArabicNumber,
} from "./accounting";
import {
  auth,
  createInventoryItem,
  createLedgerEntry,
  createOrUpdateAccount,
  ensureWorkspaceSeeded,
  permanentlyDeleteLedger,
  saveWarehouse,
  saveWorkspaceSettings,
  setLedgerDeleted,
  signInWithGoogle,
  signOutUser,
  subscribeWorkspace,
  updateLedgerEntry,
} from "./firebase";
import {
  CURRENCIES,
  type AccountCategory,
  type AccountRecord,
  type CurrencyCode,
  type InventoryItemRecord,
  type LedgerEntryRecord,
  type WarehouseRecord,
  type WorkspaceSettings,
} from "./types";

type IconComponent = ComponentType<{ className?: string }>;
type SheetKind = "add-operation" | "filters" | "export" | "notifications" | null;
type OverlayKind =
  | "account-picker"
  | "transaction"
  | "account-create-compact"
  | "account-create-extended"
  | "invoice"
  | "trash"
  | "settings"
  | "inventory-add"
  | null;
type AccountCreateMode = "compact" | "extended";
type ExportKind = "statement" | "inventory" | "purchases";
type InvoiceIntent = "invoice" | "return" | "quote" | "order";
type DrawerTarget =
  | "dashboard"
  | "purchases"
  | "settings"
  | "whatsapp"
  | "shop"
  | "warehouses"
  | "inventory-report"
  | "quotes"
  | "orders"
  | "accounts"
  | "currency"
  | "trash"
  | "daily-journal"
  | "analytics-dashboard";

type LiveWorkspaceState = {
  uid: string;
  userEmail: string;
  workspace: WorkspaceSettings | null;
  accounts: AccountRecord[];
  ledger: LedgerEntryRecord[];
  warehouses: WarehouseRecord[];
  inventory: InventoryItemRecord[];
  syncing: boolean;
  flowRef: MutableRefObject<FlowControls | null>;
  openDrawer: () => void;
  openSheet: (kind: Exclude<SheetKind, null>) => void;
  openAccountPicker: () => void;
  openAccountEdit: (account?: AccountRecord) => void;
  openTransaction: (account?: AccountRecord, editingEntry?: LedgerEntryRecord) => void;
  openAccountCreate: (mode?: AccountCreateMode, defaultCategory?: AccountCategory) => void;
  openInvoice: (defaultCategory?: AccountCategory) => void;
  openVendorInvoice: (account: AccountRecord, intent?: InvoiceIntent) => void;
  openDashboardMenu: () => void;
  openExportMenu: (kind?: ExportKind, account?: AccountRecord) => void;
  openInventoryAdd: () => void;
  openSettings: () => void;
  openTrash: () => void;
  showToast: (message: string) => void;
  triggerJsonBackup: () => void;
  triggerJsonRestore: () => void;
  triggerCsvImport: () => void;
  handleSignOut: () => void;
};

const WorkspaceContext = createContext<LiveWorkspaceState | null>(null);

function useWorkspace(): LiveWorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside WorkspaceContext.Provider");
  }
  return ctx;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrCopyText(title: string, text: string, showToast: (msg: string) => void) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return;
    }
  } catch {
    // Fallback to clipboard below when user cancels or share fails
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showToast("تم نسخ الملخص إلى الحافظة للمشاركة");
      return;
    }
  } catch {
    // Ignore clipboard error in restricted frames
  }
  showToast("تم تجهيز نص الملخص للمشاركة");
}

function categoryTitle(category: AccountCategory): string {
  const map: Record<AccountCategory, string> = {
    purchases: "المشتريات",
    sales: "المبيعات",
    clients: "العملاء",
    employees: "الموظفين",
    transfers: "الحوالات",
    shop: "المحل",
  };
  return map[category];
}

export default function Prototype() {
  return (
    <ErrorBoundary>
      <NasqoProductionShell />
    </ErrorBoundary>
  );
}

function NasqoProductionShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        try {
          await ensureWorkspaceSeeded(nextUser.uid, nextUser.displayName);
        } catch (err) {
          console.error("Failed initializing workspace:", err);
        } finally {
          setWorkspaceReady(true);
        }
      } else {
        setWorkspaceReady(false);
      }
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(
        msg.includes("popup-closed")
          ? "تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية."
          : "تعذر إتمام تسجيل الدخول عبر Google. تأكد من السماح للنوافذ المنبثقة وحاول مجددًا.",
      );
    } finally {
      setAuthBusy(false);
    }
  };

  if (!authReady || (user && !workspaceReady)) {
    return (
      <div className="nasqo-app" dir="rtl">
        <div className="auth-gate-shell">
          <header className="app-header dashboard-header">
            <div className="header-brand">
              <span className="brand-mark" aria-hidden="true">
                <CubeIcon />
              </span>
              <span className="header-copy">
                <strong>نسقو برو</strong>
              </span>
            </div>
          </header>
          <main className="auth-gate-main">
            <section className="auth-card">
              <span className="drawer-hero-mark">
                <CubeIcon />
              </span>
              <h1>جاري تحميل مساحة العمل السحابية...</h1>
              <p>يتم التحقق من الجلسة ومزامنة الحسابات والسندات.</p>
            </section>
          </main>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="nasqo-app" dir="rtl">
        <div className="auth-gate-shell">
          <header className="app-header dashboard-header">
            <div className="header-brand">
              <span className="brand-mark" aria-hidden="true">
                <CubeIcon />
              </span>
              <span className="header-copy">
                <strong>نسقو برو</strong>
                <small>إدارة الأعمال والحسابات</small>
              </span>
            </div>
          </header>
          <main className="auth-gate-main">
            <section className="auth-card">
              <span className="drawer-hero-mark">
                <CubeIcon />
              </span>
              <h1>نسقو برو — نظام الأعمال السحابي</h1>
              <p>
                سجّل الدخول بحساب Google للوصول إلى حسابات الموردين والعملاء، الفواتير، السندات، والمخازن
                مع حفظ ومزامنة فورية على السحابة.
              </p>
              {authError ? (
                <p className="auth-error" role="alert">
                  {authError}
                </p>
              ) : null}
              <button
                className="auth-google-btn"
                onClick={handleSignIn}
                disabled={authBusy}
                data-testid="google-signin-button"
              >
                <LockClosedIcon />
                <span>{authBusy ? "جاري تسجيل الدخول..." : "تسجيل الدخول بحساب Google"}</span>
              </button>
            </section>
          </main>
        </div>
      </div>
    );
  }

  return <AuthenticatedWorkspace user={user} />;
}

function AuthenticatedWorkspace({ user }: { user: User }) {
  const [workspace, setWorkspace] = useState<WorkspaceSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [ledger, setLedger] = useState<LedgerEntryRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItemRecord[]>([]);
  const [syncFlags, setSyncFlags] = useState({ accounts: false, ledger: false, inventory: false });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [overlay, setOverlay] = useState<OverlayKind>(null);
  const [pickerMode, setPickerMode] = useState<"statement" | "edit">("statement");
  const [editingAccount, setEditingAccount] = useState<AccountRecord | undefined>();
  const [accountCreateCategory, setAccountCreateCategory] = useState<AccountCategory>("purchases");
  const [transactionTarget, setTransactionTarget] = useState<{
    account?: AccountRecord;
    editingEntry?: LedgerEntryRecord;
  }>({});
  const [exportState, setExportState] = useState<{
    open: boolean;
    kind: ExportKind;
    account?: AccountRecord;
  }>({ open: false, kind: "statement" });
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [invoiceSeed, setInvoiceSeed] = useState<{
    account?: AccountRecord;
    intent: InvoiceIntent;
    revision: number;
  }>({ intent: "invoice", revision: 0 });
  const returnOverlay = useRef<OverlayKind>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const flowRef = useRef<FlowControls | null>(null);
  const keyboard = useKeyboard();
  const jsonRestoreInputRef = useRef<HTMLInputElement>(null);
  const csvImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = subscribeWorkspace(user.uid, {
      onWorkspace: setWorkspace,
      onAccounts: (list) => {
        setAccounts(list);
        setSyncFlags((prev) => (prev.accounts ? prev : { ...prev, accounts: true }));
      },
      onLedger: (list) => {
        setLedger(list);
        setSyncFlags((prev) => (prev.ledger ? prev : { ...prev, ledger: true }));
      },
      onWarehouses: setWarehouses,
      onInventory: (list) => {
        setInventory(list);
        setSyncFlags((prev) => (prev.inventory ? prev : { ...prev, inventory: true }));
      },
    });
    return unsub;
  }, [user.uid]);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const dismissKeyboard = useCallback(() => {
    keyboard.hide();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  }, [keyboard]);

  const openSheet = useCallback((kind: Exclude<SheetKind, null>) => {
    dismissKeyboard();
    setSheet(kind);
  }, [dismissKeyboard]);

  const openDrawer = useCallback(() => {
    dismissKeyboard();
    setDrawerOpen(true);
  }, [dismissKeyboard]);

  const openAccountPicker = useCallback(() => {
    dismissKeyboard();
    setExportState((s) => ({ ...s, open: false }));
    setPickerMode("statement");
    setOverlay("account-picker");
  }, [dismissKeyboard]);

  const openAccountEdit = useCallback(
    (account?: AccountRecord) => {
      dismissKeyboard();
      if (account) {
        setEditingAccount(account);
        setOverlay("account-create-compact");
        return;
      }
      setPickerMode("edit");
      setOverlay("account-picker");
    },
    [dismissKeyboard],
  );

  const openTransaction = useCallback(
    (account?: AccountRecord, editingEntry?: LedgerEntryRecord) => {
      dismissKeyboard();
      setTransactionTarget({ account: account ?? accounts[0], editingEntry });
      setOverlay("transaction");
    },
    [accounts, dismissKeyboard],
  );

  const openAccountCreate = useCallback(
    (mode: AccountCreateMode = "compact", defaultCategory: AccountCategory = "purchases") => {
      dismissKeyboard();
      setEditingAccount(undefined);
      setAccountCreateCategory(defaultCategory);
      setOverlay(mode === "extended" ? "account-create-extended" : "account-create-compact");
    },
    [dismissKeyboard],
  );

  const openInvoice = useCallback(() => {
    dismissKeyboard();
    setInvoiceSeed((value) => ({ account: accounts[0], intent: "invoice", revision: value.revision + 1 }));
    setOverlay("invoice");
  }, [accounts, dismissKeyboard]);

  const openVendorInvoice = useCallback(
    (account: AccountRecord, intent: InvoiceIntent = "invoice") => {
      dismissKeyboard();
      setInvoiceSeed((value) => ({ account, intent, revision: value.revision + 1 }));
      setOverlay("invoice");
    },
    [dismissKeyboard],
  );

  const openDashboardMenu = useCallback(() => {
    dismissKeyboard();
    setDashboardMenuOpen((value) => !value);
  }, [dismissKeyboard]);

  const closeOverlay = useCallback(() => {
    dismissKeyboard();
    setOverlay(returnOverlay.current);
    returnOverlay.current = null;
  }, [dismissKeyboard]);

  const openExportMenu = useCallback(
    (kind: ExportKind = "statement", account?: AccountRecord) => {
      dismissKeyboard();
      setExportState((s) => ({ open: !s.open, kind, account }));
    },
    [dismissKeyboard],
  );

  const triggerJsonBackup = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      workspace,
      accounts,
      ledger,
      warehouses,
      inventory,
    };
    downloadFile(
      `nasqo-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
    showToast("تم تنزيل ملف النسخة الاحتياطية بنجاح");
  }, [accounts, inventory, ledger, showToast, warehouses, workspace]);

  const triggerJsonRestore = useCallback(() => {
    jsonRestoreInputRef.current?.click();
  }, []);

  const triggerCsvImport = useCallback(() => {
    csvImportInputRef.current?.click();
  }, []);

  const handleJsonFileRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { accounts?: Partial<AccountRecord>[]; warehouses?: Partial<WarehouseRecord>[] };
      let added = 0;
      if (Array.isArray(parsed.accounts)) {
        for (const acc of parsed.accounts) {
          if (acc && typeof acc.name === "string" && acc.name.trim()) {
            await createOrUpdateAccount(user.uid, { ...acc, name: acc.name });
            added += 1;
          }
        }
      }
      showToast(`تم استيراد ${added} حساب من النسخة الاحتياطية`);
    } catch {
      showToast("تعذر قراءة ملف النسخة الاحتياطية — تأكد من صيغة JSON");
    }
  };

  const handleCsvAccountImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let imported = 0;
      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        const name = cols[0];
        if (!name) continue;
        const phone = cols[1] ?? "";
        const openingBalance = parseArabicNumber(cols[2] ?? "0");
        await createOrUpdateAccount(user.uid, {
          name,
          phone,
          openingBalance,
          openingDirection: "credit",
          category: "purchases",
          codeNumber: accounts.length + imported + 10,
        });
        imported += 1;
      }
      showToast(`تم استيراد ${imported} حساب من ملف CSV`);
    } catch {
      showToast("تعذر استيراد ملف الحسابات");
    }
  };

  const handleSignOut = useCallback(async () => {
    setDrawerOpen(false);
    await signOutUser();
  }, []);

  const syncing = !(syncFlags.accounts && syncFlags.ledger && syncFlags.inventory);

  const ctx = useMemo<LiveWorkspaceState>(
    () => ({
      uid: user.uid,
      userEmail: user.email ?? "",
      workspace,
      accounts,
      ledger,
      warehouses,
      inventory,
      syncing,
      flowRef,
      openDrawer,
      openSheet,
      openAccountPicker,
      openAccountEdit,
      openTransaction,
      openAccountCreate,
      openInvoice,
      openVendorInvoice,
      openDashboardMenu,
      openExportMenu,
      openInventoryAdd: () => setOverlay("inventory-add"),
      openSettings: () => setOverlay("settings"),
      openTrash: () => setOverlay("trash"),
      showToast,
      triggerJsonBackup,
      triggerJsonRestore,
      triggerCsvImport,
      handleSignOut,
    }),
    [
      accounts,
      handleSignOut,
      inventory,
      ledger,
      openAccountCreate,
      openAccountEdit,
      openAccountPicker,
      openDashboardMenu,
      openDrawer,
      openExportMenu,
      openInvoice,
      openSheet,
      openTransaction,
      openVendorInvoice,
      showToast,
      syncing,
      triggerCsvImport,
      triggerJsonBackup,
      triggerJsonRestore,
      user.email,
      user.uid,
      warehouses,
      workspace,
    ],
  );

  const initial = useMemo(() => dashboardScreen(), []);

  const navigateFromDrawer = (target: DrawerTarget) => {
    setDrawerOpen(false);
    if (target === "accounts") {
      openAccountPicker();
      return;
    }
    if (target === "currency") {
      flowRef.current?.push(currencyScreen(accounts[0]?.id));
      return;
    }
    if (target === "quotes" || target === "orders") {
      if (accounts[0]) {
        openVendorInvoice(accounts[0], target === "quotes" ? "quote" : "order");
      }
      return;
    }
    if (target === "warehouses") {
      flowRef.current?.push(warehousesScreen());
      return;
    }
    if (target === "inventory-report") {
      flowRef.current?.push(inventoryReportScreen());
      return;
    }
    if (target === "shop") {
      flowRef.current?.push(shopScreen());
      return;
    }
    if (target === "purchases") {
      flowRef.current?.push(purchasesScreen("purchases"));
      return;
    }
    if (target === "whatsapp") {
      flowRef.current?.push(whatsappSettingsScreen());
      return;
    }
    if (target === "daily-journal") {
      flowRef.current?.push(dailyJournalScreen());
      return;
    }
    if (target === "analytics-dashboard") {
      flowRef.current?.push(analyticsDashboardScreen());
      return;
    }
    if (target === "trash") {
      setOverlay("trash");
      return;
    }
    if (target === "settings") {
      setOverlay("settings");
      return;
    }
  };

  const handleExportAction = (kind: ExportKind, action: "pdf-print" | "pdf-share" | "excel" | "excel-share" | "balance" | "import") => {
    setExportState((s) => ({ ...s, open: false }));
    if (action === "import") {
      triggerCsvImport();
      return;
    }
    if (action === "pdf-print" || action === "balance") {
      window.print();
      return;
    }
    if (action === "excel" || action === "excel-share") {
      if (kind === "inventory") {
        const csv = buildCsvContent(
          ["الصنف", "الوحدة", "الكمية", "متوسط التكلفة"],
          inventory.map((i) => [i.name, i.unit, i.quantity, i.avgCost]),
        );
        downloadFile("inventory-report.csv", csv, "text/csv;charset=utf-8");
        showToast("تم تصدير تقرير المخزون بصيغة CSV");
      } else if (kind === "purchases") {
        const csv = buildCsvContent(
          ["الحساب", "الهاتف", "سقف المديونية", "عليه", "له", "الرصيد"],
          accounts
            .filter((a) => a.category === "purchases")
            .map((a) => {
              const s = computeAccountSummary(a, ledger);
              return [a.name, a.phone, a.creditLimit, s.debitTotal, s.creditTotal, s.netBalance];
            }),
        );
        downloadFile("purchases-accounts.csv", csv, "text/csv;charset=utf-8");
        showToast("تم تصدير حسابات المشتريات بصيغة CSV");
      } else {
        const targetAcc = exportState.account ?? accounts[0];
        const statement = targetAcc ? computeStatementRows(targetAcc, ledger) : null;
        const csv = buildCsvContent(
          ["الرقم", "التاريخ", "النوع", "المبلغ", "البيان", "الرصيد"],
          (statement?.rows ?? []).map((r) => [r.entryNumber, r.entryDate, r.typeLabel, r.amount, r.details, r.runningBalance]),
        );
        downloadFile(`statement-${targetAcc?.codeNumber ?? "all"}.csv`, csv, "text/csv;charset=utf-8");
        showToast("تم تصدير كشف الحساب بصيغة CSV");
      }
      return;
    }
    if (action === "pdf-share") {
      const targetAcc = exportState.account ?? accounts[0];
      const summary = targetAcc ? computeAccountSummary(targetAcc, ledger) : null;
      const text = targetAcc
        ? `كشف حساب: ${targetAcc.name} | الرصيد: ${formatAmount(summary?.netBalance ?? 0)} ${targetAcc.currency}`
        : `تقرير ${workspace?.companyName ?? "نسقو برو"}`;
      void shareOrCopyText("كشف حساب - نسقو برو", text, showToast);
    }
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div className="nasqo-app" dir="rtl">
        <FlowStack initial={initial} />
        <AppDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onNavigate={navigateFromDrawer}
          onNotify={showToast}
        />
        <DashboardAddMenu open={dashboardMenuOpen} onClose={() => setDashboardMenuOpen(false)} />
        <ExportSideMenu
          open={exportState.open}
          kind={exportState.kind}
          onClose={() => setExportState((s) => ({ ...s, open: false }))}
          onSelectAction={(action) => handleExportAction(exportState.kind, action)}
        />
        <InvoiceModal
          key={invoiceSeed.revision}
          initialAccount={invoiceSeed.account}
          intent={invoiceSeed.intent}
          open={overlay === "invoice"}
          onClose={closeOverlay}
          onAddAccount={() => {
            returnOverlay.current = "invoice";
            openAccountCreate("extended");
          }}
        />
        <AccountPickerModal
          open={overlay === "account-picker"}
          title={pickerMode === "edit" ? "تعديل بيانات حساب" : "كشف حساب"}
          onClose={() => setOverlay(null)}
          onAddAccount={() => openAccountCreate("compact")}
          onConfirm={(account) => {
            if (pickerMode === "edit") {
              setEditingAccount(account);
              setOverlay("account-create-compact");
            } else {
              setOverlay(null);
              flowRef.current?.push(supplierScreen(account.id));
            }
          }}
        />
        <TransactionModal
          open={overlay === "transaction"}
          initialAccount={transactionTarget.account}
          editingEntry={transactionTarget.editingEntry}
          onClose={() => setOverlay(null)}
        />
        <AccountCreateModal
          key={editingAccount?.id ?? `new-${accountCreateCategory}-${overlay}`}
          initialAccount={editingAccount}
          defaultCategory={accountCreateCategory}
          mode="compact"
          open={overlay === "account-create-compact"}
          onClose={() => setOverlay(null)}
        />
        <AccountCreateModal
          key={`ext-${accountCreateCategory}-${overlay}`}
          defaultCategory={accountCreateCategory}
          mode="extended"
          open={overlay === "account-create-extended"}
          onClose={closeOverlay}
        />
        <TrashModal open={overlay === "trash"} onClose={() => setOverlay(null)} />
        <WorkspaceSettingsModal open={overlay === "settings"} onClose={() => setOverlay(null)} />
        <InventoryItemModal open={overlay === "inventory-add"} onClose={() => setOverlay(null)} />

        <input
          ref={jsonRestoreInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={handleJsonFileRestore}
        />
        <input
          ref={csvImportInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={handleCsvAccountImport}
        />

        <BottomSheet
          open={sheet !== null}
          onOpenChange={(open) => !open && setSheet(null)}
          title={sheetTitle(sheet)}
          description={sheetDescription(sheet)}
          snap={0.6}
        >
          <SheetContent kind={sheet} setKind={setSheet} />
        </BottomSheet>

        {toast ? (
          <div className="app-toast" role="status" aria-live="polite">
            <CheckCircledIcon />
            <span>{toast}</span>
          </div>
        ) : null}
      </div>
    </WorkspaceContext.Provider>
  );
}

function dashboardScreen(): FlowScreen {
  return {
    id: "dashboard",
    headerHeight: 50,
    header: () => <DashboardHeader />,
    footerHeight: 28,
    footer: () => <BottomNav />,
    render: (flow) => <DashboardPage flow={flow} />,
  };
}

function DashboardHeader() {
  const ctx = useWorkspace();
  const alertCount = ctx.accounts.filter((a) => {
    const s = computeAccountSummary(a, ctx.ledger);
    return a.creditLimit > 0 && s.netBalance > a.creditLimit;
  }).length;
  return (
    <AppHeader
      className="dashboard-header"
      title={ctx.workspace?.companyName || "نسقو برو"}
      subtitle=""
      onMenu={ctx.openDrawer}
      actions={[
        { label: "بحث", icon: MagnifyingGlassIcon, onClick: ctx.openAccountPicker },
        {
          label: "التنبيهات",
          icon: BellIcon,
          badge: alertCount > 0 ? String(alertCount) : undefined,
          onClick: () => ctx.openSheet("notifications"),
        },
        {
          label: "مزامنة",
          icon: ReloadIcon,
          onClick: () => ctx.showToast("متصل بالسحابة — البيانات محدّثة لحظيًا"),
        },
        { label: "إضافة", icon: PlusIcon, onClick: ctx.openDashboardMenu },
      ]}
    />
  );
}

function purchasesScreen(category: AccountCategory = "purchases"): FlowScreen {
  return {
    id: `accounts-${category}`,
    headerHeight: 58,
    header: (flow) => <PurchasesHeader flow={flow} category={category} />,
    footerHeight: 54,
    footer: () => <CategoryFinancialFooter category={category} />,
    render: (flow) => <PurchasesPage flow={flow} category={category} />,
  };
}

function PurchasesHeader({ flow, category }: { flow: FlowControls; category: AccountCategory }) {
  const ctx = useWorkspace();
  return (
    <AppHeader
      title={categoryTitle(category)}
      subtitle=""
      onBack={flow.pop}
      actions={[
        { label: "تصفية", icon: MixerHorizontalIcon, onClick: () => ctx.openSheet("filters") },
        { label: "تصدير المشتريات", icon: DownloadIcon, onClick: () => ctx.openExportMenu("purchases") },
        { label: "بحث", icon: MagnifyingGlassIcon, onClick: ctx.openAccountPicker },
      ]}
    />
  );
}

function CategoryFinancialFooter({ category }: { category: AccountCategory }) {
  const ctx = useWorkspace();
  const catAccounts = ctx.accounts.filter((a) => a.category === category);
  let debit = 0;
  let credit = 0;
  for (const acc of catAccounts) {
    const s = computeAccountSummary(acc, ctx.ledger);
    debit += s.debitTotal;
    credit += s.creditTotal;
  }
  const balance = Math.abs(credit - debit);
  return (
    <FinancialFooter
      debit={formatAmount(debit)}
      credit={formatAmount(credit)}
      balance={formatAmount(balance)}
      onPrimary={() => ctx.openAccountCreate("extended", category)}
      onMenu={() => ctx.openExportMenu("purchases")}
    />
  );
}

function supplierScreen(accountId: string): FlowScreen {
  const cashMenuControl: MutableRefObject<(() => void) | null> = { current: null };
  const cashSearchControl: MutableRefObject<(() => void) | null> = { current: null };
  return {
    id: `supplier-${accountId}`,
    headerHeight: 58,
    header: (flow) => (
      <SupplierHeader
        flow={flow}
        accountId={accountId}
        onSearch={() => cashSearchControl.current?.()}
      />
    ),
    footerHeight: 54,
    footer: () => (
      <SupplierFooter
        accountId={accountId}
        onCashMenu={() => cashMenuControl.current?.()}
      />
    ),
    render: (flow) => {
      return (
        <SupplierScreenRouter
          flow={flow}
          accountId={accountId}
          menuControl={cashMenuControl}
          searchControl={cashSearchControl}
        />
      );
    },
  };
}

function SupplierHeader({
  flow,
  accountId,
  onSearch,
}: {
  flow: FlowControls;
  accountId: string;
  onSearch: () => void;
}) {
  const ctx = useWorkspace();
  const account = ctx.accounts.find((a) => a.id === accountId) ?? ctx.accounts[0];
  const isCashAccount = Boolean(account?.isCashAccount);
  return (
    <AppHeader
      title={isCashAccount ? `مشتريات ${account.name}` : account?.name || "كشف الحساب"}
      subtitle={isCashAccount ? "" : "كشف حساب"}
      className={isCashAccount ? "cash-statement-header" : ""}
      onBack={flow.pop}
      actions={[
        { label: "تصفية", icon: MixerHorizontalIcon, onClick: () => ctx.openSheet("filters") },
        { label: "تصدير", icon: DownloadIcon, onClick: () => ctx.openExportMenu("statement", account) },
        { label: "بحث", icon: MagnifyingGlassIcon, onClick: onSearch },
      ]}
    />
  );
}

function SupplierFooter({
  accountId,
  onCashMenu,
}: {
  accountId: string;
  onCashMenu: () => void;
}) {
  const ctx = useWorkspace();
  const account = ctx.accounts.find((a) => a.id === accountId) ?? ctx.accounts[0];
  if (!account) return null;
  const statement = computeStatementRows(account, ctx.ledger, { showPreviousBalance: true });
  if (account.isCashAccount) {
    return <CashStatementFooter account={account} statement={statement} onMenu={onCashMenu} />;
  }
  return (
    <FinancialFooter
      debit={formatAmount(statement.debitTotal)}
      credit={formatAmount(statement.creditTotal)}
      balance={formatAmount(statement.netBalance)}
      compact
      onPrimary={() => ctx.flowRef.current?.push(simpleEntryScreen(account.id))}
      onMenu={() => ctx.openExportMenu("statement", account)}
    />
  );
}

function SupplierScreenRouter({
  flow,
  accountId,
  menuControl,
  searchControl,
}: {
  flow: FlowControls;
  accountId: string;
  menuControl: MutableRefObject<(() => void) | null>;
  searchControl: MutableRefObject<(() => void) | null>;
}) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const account = ctx.accounts.find((a) => a.id === accountId) ?? ctx.accounts[0];
  if (!account) {
    return (
      <MobileScroll className="app-screen">
        <p className="cash-empty">لم يُعثر على هذا الحساب.</p>
      </MobileScroll>
    );
  }
  return account.isCashAccount ? (
    <CashSupplierPage account={account} menuControl={menuControl} searchControl={searchControl} />
  ) : (
    <SupplierPage account={account} searchControl={searchControl} />
  );
}

function shopScreen(): FlowScreen {
  return {
    id: "shop",
    headerHeight: 58,
    header: (flow) => <ShopHeader flow={flow} />,
    footerHeight: 54,
    footer: () => <ShopFooter />,
    render: (flow) => <ShopPage flow={flow} />,
  };
}

function ShopHeader({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  return (
    <AppHeader
      title="المحل"
      subtitle=""
      onBack={flow.pop}
      actions={[
        { label: "تصفية", icon: MixerHorizontalIcon, onClick: () => ctx.openSheet("filters") },
        { label: "تصدير", icon: DownloadIcon, onClick: () => ctx.openExportMenu("purchases") },
        { label: "بحث", icon: MagnifyingGlassIcon, onClick: ctx.openAccountPicker },
      ]}
    />
  );
}

function ShopFooter() {
  const ctx = useWorkspace();
  const shopAccounts = ctx.accounts.filter((a) => a.category === "shop");
  let debit = 0;
  let credit = 0;
  for (const a of shopAccounts) {
    const s = computeAccountSummary(a, ctx.ledger);
    debit += s.debitTotal;
    credit += s.creditTotal;
  }
  const balance = Math.abs(credit - debit);
  return (
    <div className="shop-totals">
      <button aria-label="إضافة حساب من شريط الرصيد" onClick={() => ctx.openAccountCreate("extended", "shop")}>
        <PlusIcon />
      </button>
      <span>
        عليه: {formatAmount(debit)} · له: {formatAmount(credit)} · الرصيد: {formatAmount(balance)}
      </span>
      <HamburgerMenuIcon />
    </div>
  );
}

function ShopPage({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [period, setPeriod] = useState("الكل");
  const [sort, setSort] = useState("تنازلي");
  const shopAccounts = ctx.accounts.filter((a) => a.category === "shop");
  const ordered = sort === "تصاعدي" ? [...shopAccounts].reverse() : shopAccounts;

  return (
    <>
      <MobileScroll className="app-screen">
        <main className="shop-page page-with-footer" data-testid="shop-screen">
          <section className="shop-filters">
            <div className="reference-radio-row">
              {["يومي", "شهري", "الكل", "سنوي"].map((item) => (
                <label key={item}>
                  <input type="radio" name="shop-period" checked={period === item} onChange={() => setPeriod(item)} />
                  {item}
                </label>
              ))}
            </div>
            <div className="shop-sort">
              <select aria-label="ترتيب الحسابات">
                <option>ترتيب حسب التاريخ</option>
                <option>ترتيب حسب الاسم</option>
              </select>
              <div>
                {["تصاعدي", "تنازلي"].map((item) => (
                  <label key={item}>
                    <input type="radio" name="shop-sort" checked={sort === item} onChange={() => setSort(item)} />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            <div className="shop-currency">
              <span>العملة</span>
              <select aria-label="عملة حسابات المحل">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <label>
                <input type="checkbox" />
                حسب العملة
              </label>
            </div>
            <div className="reference-date-strip">
              <ArrowRightIcon />
              <span>
                من <b>1/1/2026</b>
              </span>
              <span>
                إلى <b>{new Date().toLocaleDateString("en-GB")}</b>
              </span>
              <ArrowLeftIcon />
            </div>
          </section>
          {ordered.map((acc) => {
            const s = computeAccountSummary(acc, ctx.ledger);
            return (
              <article className="shop-account-card" key={acc.id}>
                <button
                  className="warehouse-icon"
                  aria-label={`عرض ${acc.name}`}
                  onClick={() => flow.push(supplierScreen(acc.id))}
                >
                  <MobileIcon />
                </button>
                <strong>{acc.name}</strong>
                <span>{formatAmount(s.netBalance)}</span>
                <button aria-label={`إضافة سند لـ ${acc.name}`} onClick={() => ctx.openTransaction(acc)}>
                  <PlusIcon />
                </button>
              </article>
            );
          })}
        </main>
      </MobileScroll>
      <button
        className="fab fixed-fab"
        aria-label="إنشاء حساب بالمحل"
        onClick={() => ctx.openAccountCreate("extended", "shop")}
      >
        <PlusIcon />
      </button>
    </>
  );
}

function warehousesScreen(): FlowScreen {
  const searchControl: MutableRefObject<(() => void) | null> = { current: null };
  return {
    id: "warehouses",
    headerHeight: 58,
    header: (flow) => (
      <AppHeader
        title="المخازن"
        subtitle=""
        onBack={flow.pop}
        actions={[{ label: "بحث في المخازن", icon: MagnifyingGlassIcon, onClick: () => searchControl.current?.() }]}
      />
    ),
    footerHeight: 26,
    footer: () => <div className="warehouse-bottom-strip" />,
    render: (flow) => <WarehousesPage flow={flow} searchControl={searchControl} />,
  };
}

function WarehousesPage({
  flow,
  searchControl,
}: {
  flow: FlowControls;
  searchControl: MutableRefObject<(() => void) | null>;
}) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [editing, setEditing] = useState<WarehouseRecord | "new" | null>(null);
  const keyboard = useKeyboard();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  searchControl.current = () => {
    keyboard.hide();
    setSearchOpen((value) => !value);
    setSearch("");
  };
  const open = (warehouse: WarehouseRecord | "new") => {
    keyboard.hide();
    setEditing(warehouse);
  };
  const close = () => {
    keyboard.hide();
    setEditing(null);
  };

  return (
    <>
      <MobileScroll className="warehouse-scroll">
        <main className="warehouse-page page-with-footer" data-testid="warehouses-screen">
          {searchOpen ? (
            <KeyboardInput
              className="warehouse-search"
              aria-label="اسم المخزن للبحث"
              placeholder="ابحث عن المخزن"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          {ctx.warehouses
            .filter((warehouse) => normalizeArabicSearch(warehouse.name).includes(normalizeArabicSearch(search)))
            .map((warehouse) => (
              <article className="warehouse-card" key={warehouse.id}>
                <button
                  className="warehouse-icon"
                  aria-label={`فتح ${warehouse.name}`}
                  onClick={() => flow.push(inventoryReportScreen(warehouse.id))}
                >
                  <CubeIcon />
                </button>
                <strong>
                  {warehouse.name}
                  {warehouse.isDefault ? " (افتراضي)" : ""}
                </strong>
                <b>{warehouse.codeNumber}</b>
                <div className="warehouse-card-actions">
                  <button aria-label={`تعديل ${warehouse.name}`} onClick={() => open(warehouse)}>
                    <Pencil1Icon />
                  </button>
                  <button
                    aria-label={`تقرير حركة ${warehouse.name}`}
                    onClick={() => flow.push(inventoryReportScreen(warehouse.id))}
                  >
                    <ReaderIcon />
                  </button>
                </div>
              </article>
            ))}
        </main>
      </MobileScroll>
      <button className="fab warehouse-fab" aria-label="إضافة مخزن" onClick={() => open("new")}>
        <PlusIcon />
      </button>
      {editing !== null ? (
        <WarehouseModal
          key={editing === "new" ? "new" : editing.id}
          warehouse={editing === "new" ? undefined : editing}
          onClose={close}
          onNotify={ctx.showToast}
          onSave={async (value) => {
            await saveWarehouse(
              ctx.uid,
              {
                ...value,
                codeNumber: editing === "new" ? Math.max(0, ...ctx.warehouses.map((w) => w.codeNumber)) + 1 : editing.codeNumber,
              },
              ctx.warehouses,
              editing === "new" ? undefined : editing.id,
            );
            close();
            ctx.showToast("تم حفظ المخزن في قاعدة البيانات");
          }}
        />
      ) : null}
    </>
  );
}

function WarehouseModal({
  warehouse,
  onClose,
  onSave,
  onNotify,
}: {
  warehouse?: WarehouseRecord;
  onClose: () => void;
  onSave: (value: { name: string; details: string; isDefault: boolean }) => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const { screenRef } = useScreenPortal();
  const [name, setName] = useState(warehouse?.name ?? "");
  const [details, setDetails] = useState(warehouse?.details ?? "");
  const [isDefault, setIsDefault] = useState(warehouse?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const target = screenRef.current?.querySelector(".nasqo-app");
  if (!target) return null;

  const submit = async () => {
    if (!name.trim()) {
      setError(true);
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), details, isDefault });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="center-modal-layer" data-testid="warehouse-modal">
      <button className="center-modal-backdrop" aria-label="إغلاق المخزن" onClick={onClose} />
      <section className="warehouse-modal" role="dialog" aria-modal="true" aria-labelledby="warehouse-title">
        <h2 id="warehouse-title">{warehouse ? "تعديل المخزن" : "مخزن جديد"}</h2>
        <KeyboardInput
          aria-label="اسم المخزن"
          placeholder="أدخل الاسم"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(false);
          }}
          aria-invalid={error}
        />
        <KeyboardInput
          aria-label="تفاصيل المخزن"
          placeholder="تفاصيل"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
        <label className="warehouse-default">
          <span>اعتماد هذا المخزن كافتراضي</span>
          <input
            className="nasqo-switch"
            type="checkbox"
            role="switch"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            أدخل اسم المخزن أولًا
          </p>
        ) : null}
        <div className="form-modal-actions">
          <button className="cancel" onClick={onClose}>
            إلغاء
          </button>
          <button className="form-help" onClick={() => onNotify("أدخل اسم المخزن وتفاصيله ثم اختر حفظ")}>
            <VideoIcon />
            شرح
          </button>
          <button className="save" disabled={saving} onClick={submit}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </section>
    </div>,
    target,
  );
}

function inventoryReportScreen(warehouseId?: string): FlowScreen {
  return {
    id: `inventory-report-${warehouseId ?? "all"}`,
    headerHeight: 58,
    header: (flow) => <InventoryHeader flow={flow} />,
    footerHeight: 70,
    footer: () => <InventoryFooter initialWarehouseId={warehouseId} />,
    render: (flow) => <InventoryReportPage flow={flow} initialWarehouseId={warehouseId} />,
  };
}

function InventoryHeader({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  return (
    <AppHeader
      title="تقرير حركة المخزون"
      subtitle=""
      onBack={flow.pop}
      actions={[
        { label: "إضافة صنف", icon: PlusIcon, onClick: ctx.openInventoryAdd },
        { label: "تصدير", icon: DownloadIcon, onClick: () => ctx.openExportMenu("inventory") },
      ]}
    />
  );
}

function InventoryFooter({ initialWarehouseId }: { initialWarehouseId?: string }) {
  const ctx = useWorkspace();
  const summary = computeInventorySummary(ctx.inventory, initialWarehouseId);
  return (
    <div className="inventory-totals">
      <div>
        عدد الأصناف: <b>{summary.items.length}</b>
      </div>
      <div>
        إجمالي الكمية: <b>{formatAmount(summary.totalQuantity)}</b>　 القيمة:{" "}
        <b>{formatAmount(summary.totalValue)}</b>
      </div>
    </div>
  );
}

function InventoryReportPage({
  flow,
  initialWarehouseId,
}: {
  flow: FlowControls;
  initialWarehouseId?: string;
}) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [period, setPeriod] = useState("الكل");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(initialWarehouseId ?? "");
  const summary = computeInventorySummary(ctx.inventory, selectedWarehouseId || undefined);

  return (
    <MobileScroll className="inventory-report-scroll">
      <main className="inventory-report-page" data-testid="inventory-report-screen">
        <section className="inventory-filters">
          <label className="inventory-select">
            <span>المخزن</span>
            <select
              aria-label="المخزن"
              value={selectedWarehouseId}
              onChange={(event) => setSelectedWarehouseId(event.target.value)}
            >
              <option value="">جميع المخازن</option>
              {ctx.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="reference-radio-row">
            {["يومي", "شهري", "الكل"].map((item) => (
              <label key={item}>
                <input
                  type="radio"
                  name="inventory-period"
                  checked={period === item}
                  onChange={() => setPeriod(item)}
                />
                {item}
              </label>
            ))}
          </div>
          <select className="profit-select" aria-label="حساب الأرباح حسب">
            <option>حساب الأرباح حسب: متوسط سعر الشراء</option>
            <option>حساب الأرباح حسب: آخر سعر شراء</option>
          </select>
          <div className="reference-date-strip">
            <ArrowRightIcon />
            <span>
              من <b>1/1/2026</b>
            </span>
            <span>
              إلى <b>{new Date().toLocaleDateString("en-GB")}</b>
            </span>
            <ArrowLeftIcon />
          </div>
        </section>
        <table className="inventory-table">
          <thead>
            <tr>
              <th scope="col">الصنف</th>
              <th scope="col">الوحدة</th>
              <th scope="col">الكمية / التكلفة</th>
            </tr>
          </thead>
          <tbody>
            {summary.items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.unit}</td>
                <td>
                  {formatAmount(item.quantity)} ({formatAmount(item.avgCost)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </MobileScroll>
  );
}

function analyticsDashboardScreen(): FlowScreen {
  return {
    id: "analytics-dashboard",
    headerHeight: 58,
    header: (flow) => <SimpleAppHeader title="لوحة المبيعات والمخزون" onBack={flow.pop} />,
    render: (flow) => <AnalyticsDashboardPage flow={flow} />,
  };
}

function AnalyticsDashboardPage({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  return (
    <DashboardScreen
      companyName={ctx.workspace?.companyName || "نسقو برو"}
      defaultCurrency={ctx.workspace?.defaultCurrency || "ريال"}
      accounts={ctx.accounts}
      ledger={ctx.ledger}
      warehouses={ctx.warehouses}
      inventory={ctx.inventory}
      loading={ctx.syncing}
      onOpenSales={() => flow.push(purchasesScreen("sales"))}
      onCreateInvoice={ctx.openInvoice}
      onPreviewInvoice={(entryId) => flow.push(cashInvoicePreviewScreen(entryId))}
      onAddInventoryItem={ctx.openInventoryAdd}
      onOpenInventoryReport={() => flow.push(inventoryReportScreen())}
      onOpenDailyJournal={() => flow.push(dailyJournalScreen())}
    />
  );
}

function dailyJournalScreen(): FlowScreen {
  return {
    id: "daily-journal",
    headerHeight: 58,
    header: (flow) => <SimpleAppHeader title="الحركة اليومية" onBack={flow.pop} />,
    render: (flow) => <DailyJournalPage flow={flow} />,
  };
}

function DailyJournalPage({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const activeEntries = useMemo(
    () =>
      ctx.ledger
        .filter((e) => !e.deleted)
        .sort((a, b) => b.createdAtMs - a.createdAtMs || b.entryNumber - a.entryNumber),
    [ctx.ledger],
  );
  return (
    <MobileScroll className="app-screen">
      <main className="purchases-page page-with-footer" data-testid="daily-journal-screen">
        <div className="list-heading">
          <div>
            <strong>سجل القيود والعمليات</strong>
            <span>جميع الحركات المحفوظة في قاعدة البيانات</span>
          </div>
          <span className="result-count">{activeEntries.length}</span>
        </div>
        {activeEntries.length === 0 ? (
          <p className="cash-empty">لا توجد حركات مسجلة بعد.</p>
        ) : (
          <section className="transactions-list">
            {activeEntries.map((item) => (
              <article key={item.id} className="transaction-card">
                <div className="transaction-grid">
                  <span className={`transaction-type ${item.direction}`}>{item.typeLabel}</span>
                  <strong className={`transaction-amount ${item.direction}`}>
                    {formatAmount(item.amount)} {item.currency}
                  </strong>
                  <span className="transaction-detail">
                    <b>
                      {item.accountName}
                      {item.details ? ` · ${item.details}` : ""}
                    </b>
                    <time>{item.entryDate}</time>
                    <em>#{item.entryNumber}</em>
                  </span>
                  <span className="transaction-balance">{item.warehouseName || "—"}</span>
                </div>
                <div className="transaction-actions">
                  <button
                    aria-label={`تعديل #${item.entryNumber}`}
                    onClick={() => {
                      const acc = ctx.accounts.find((a) => a.id === item.accountId);
                      ctx.openTransaction(acc, item);
                    }}
                  >
                    <Pencil1Icon />
                  </button>
                  <button
                    aria-label={`معاينة فاتورة #${item.entryNumber}`}
                    onClick={() => flow.push(cashInvoicePreviewScreen(item.id))}
                  >
                    <FileTextIcon />
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </MobileScroll>
  );
}

function InvoiceModal({
  open,
  initialAccount,
  intent,
  onClose,
  onAddAccount,
}: {
  open: boolean;
  initialAccount?: AccountRecord;
  intent: InvoiceIntent;
  onClose: () => void;
  onAddAccount: () => void;
}) {
  const ctx = useWorkspace();
  const [content, setContent] = useState<"items" | "free">("items");
  const [payment, setPayment] = useState<"cash" | "credit">(initialAccount?.isCashAccount ? "cash" : "credit");
  const [kind, setKind] = useState<"purchase" | "sale">(initialAccount?.category === "sales" ? "sale" : "purchase");
  const [isReturn, setReturn] = useState(intent === "return");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("ريال");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [warehouseId, setWarehouseId] = useState(
    ctx.warehouses.find((w) => w.isDefault)?.id ?? ctx.warehouses[0]?.id ?? "",
  );
  const [accountId, setAccountId] = useState(initialAccount?.id ?? ctx.accounts[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const now = useMemo(
    () => new Intl.DateTimeFormat("ar", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date()),
    [],
  );

  if (!open) return null;

  const selectedAccount = ctx.accounts.find((a) => a.id === accountId) ?? ctx.accounts[0];
  const selectedWarehouse = ctx.warehouses.find((w) => w.id === warehouseId);

  const handleSave = async () => {
    if (!selectedAccount) {
      ctx.showToast("أضف حسابًا أولًا قبل إنشاء الفاتورة");
      return;
    }
    const parsedAmount = parseArabicNumber(amount);
    if (parsedAmount <= 0) {
      ctx.showToast("أدخل مبلغ الفاتورة أكبر من صفر");
      return;
    }
    setSaving(true);
    try {
      const nextNum = Math.max(1000, ...ctx.ledger.map((e) => e.entryNumber)) + 1;
      const entryKind =
        intent === "quote" ? "quote" : intent === "order" ? "order" : isReturn ? "return" : "invoice";
      const typeLabel =
        intent === "quote"
          ? "عرض سعر"
          : intent === "order"
            ? "طلبية جديدة"
            : isReturn
              ? "مردود"
              : payment === "cash"
                ? "ف.ش.نقدي"
                : "فاتورة آجلة";
      const direction: "debit" | "credit" =
        kind === "purchase" ? (isReturn ? "debit" : "credit") : isReturn ? "credit" : "debit";

      await createLedgerEntry(ctx.uid, {
        accountId: selectedAccount.id,
        accountName: selectedAccount.name,
        kind: entryKind,
        typeLabel,
        payment,
        direction,
        amount: parsedAmount,
        currency,
        exchangeRate: parseArabicNumber(exchangeRate) || 1,
        details: note || typeLabel,
        documentNumber: String(nextNum),
        warehouseId: selectedWarehouse?.id ?? "",
        warehouseName: selectedWarehouse?.name ?? "",
        invoiceContent: content,
        entryNumber: nextNum,
        deleted: false,
        entryDate: new Date().toISOString().slice(0, 10),
      });
      onClose();
      ctx.showToast(`تم حفظ ${typeLabel} رقم #${nextNum} في قاعدة البيانات`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="invoice-modal">
      <button className="center-modal-backdrop" aria-label="إغلاق الفاتورة" onClick={onClose} />
      <section className="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
        <h2 id="invoice-title">
          {intent === "quote"
            ? "عرض سعر"
            : intent === "order"
              ? "طلبية جديدة"
              : isReturn
                ? "مردود جديد"
                : "فاتورة جديدة"}
        </h2>
        <div className="invoice-top-row">
          <time>
            {now}
            <br />
            {new Date().toLocaleDateString("en-GB")}
          </time>
          <button
            aria-label="إعدادات الفاتورة"
            onClick={() => ctx.showToast("حدد نوع الفاتورة وطريقة الدفع والمبلغ ثم اضغط عمل فاتورة")}
          >
            <GearIcon />
          </button>
        </div>
        <div className="invoice-radio-bar">
          <div>
            {(
              [
                ["items", "أصناف"],
                ["free", "حرة"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="invoice-content"
                  checked={content === value}
                  onChange={() => setContent(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <div>
            {(
              [
                ["cash", "نقدي"],
                ["credit", "آجل"],
              ] as const
            ).map(([value, label]) => (
              <label className={value === "cash" ? "green" : "red"} key={value}>
                <input
                  type="radio"
                  name="invoice-payment"
                  checked={payment === value}
                  onChange={() => setPayment(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="invoice-radio-bar invoice-kind-bar">
          <label className="green">
            <input
              type="radio"
              name="invoice-kind"
              checked={kind === "purchase"}
              onChange={() => setKind("purchase")}
            />
            فاتورة شراء
          </label>
          <label className="red">
            <input
              type="radio"
              name="invoice-kind"
              checked={kind === "sale"}
              onChange={() => setKind("sale")}
            />
            فاتورة بيع
          </label>
          <button aria-pressed={isReturn} onClick={() => setReturn((value) => !value)}>
            {isReturn ? "فاتورة جديدة" : "مردود جديد"}
          </button>
        </div>
        <div className="invoice-search">
          <KeyboardInput
            aria-label="البحث عن حساب الفاتورة"
            placeholder="ابحث عن الاسم هنا"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button aria-label="مسح بحث الفاتورة" onClick={() => setSearch("")}>
            <Cross2Icon />
          </button>
        </div>
        <span className="invoice-helper">أو حدد الحساب من هنا</span>
        <div className="invoice-account">
          <button aria-label="إضافة حساب للفاتورة" onClick={onAddAccount}>
            <PlusIcon />
          </button>
          <select
            aria-label="حساب الفاتورة"
            value={selectedAccount?.id ?? ""}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {ctx.accounts
              .filter((v) => !search || accountMatchesQuery(v, search) || v.id === accountId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </div>
        <div className="invoice-currency">
          <label>
            <span>العملة</span>
            <select
              aria-label="عملة الفاتورة"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span>سعر الصرف</span>
            <KeyboardInput
              aria-label="سعر صرف الفاتورة"
              inputMode="decimal"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
            />
          </label>
        </div>
        <div className="invoice-search">
          <KeyboardInput
            aria-label="إجمالي مبلغ الفاتورة"
            inputMode="decimal"
            placeholder="أدخل إجمالي المبلغ"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <label className="invoice-warehouse">
          <span>المخزن</span>
          <select
            aria-label="مخزن الفاتورة"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {ctx.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <div className="invoice-note">
          <button aria-label="صورة بيان الفاتورة" onClick={() => ctx.showToast("أدخل تفاصيل الأصناف في البيان أدناه")}>
            <CameraIcon />
          </button>
          <KeyboardInput
            aria-label="بيان الفاتورة"
            placeholder="اكتب البيان أو تفاصيل الأصناف"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button aria-label="بيان الفاتورة صوتيًا" onClick={() => ctx.showToast("الإملاء متاح عبر لوحة مفاتيح النظام")}>
            <SpeakerLoudIcon />
          </button>
        </div>
        <div className="form-modal-actions">
          <button className="cancel" onClick={onClose}>
            إلغاء
          </button>
          <button className="form-help" onClick={() => ctx.showToast("اختر الحساب والمخزن وأدخل المبلغ ثم اضغط عمل فاتورة")}>
            <VideoIcon />
            شرح
          </button>
          <button className="save" disabled={saving} onClick={handleSave}>
            {saving ? "جاري الحفظ..." : "عمل فاتورة"}
          </button>
        </div>
      </section>
    </div>
  );
}

function currencyScreen(accountId?: string): FlowScreen {
  return {
    id: `currency-exchange-${accountId ?? "default"}`,
    headerHeight: 58,
    header: (flow) => <SimpleAppHeader title="صرف عملات" onBack={flow.pop} />,
    render: (flow) => <CurrencyPage flow={flow} initialAccountId={accountId} />,
  };
}

function simpleEntryScreen(toAccountId?: string): FlowScreen {
  return {
    id: `simple-entry-${toAccountId ?? "default"}`,
    headerHeight: 58,
    header: (flow) => (
      <div className="simple-entry-header">
        <SimpleAppHeader title="قيد بسيط" onBack={flow.pop} />
      </div>
    ),
    render: (flow) => <SimpleEntryPage flow={flow} initialToAccountId={toAccountId} />,
  };
}

function whatsappSettingsScreen(): FlowScreen {
  return {
    id: "whatsapp-settings",
    headerHeight: 0,
    render: (flow) => <WhatsAppSettingsPage flow={flow} />,
  };
}

function AppHeader({
  title,
  subtitle,
  onBack,
  onMenu,
  actions,
  className = "",
}: {
  title: string;
  subtitle: string;
  onBack?: () => void;
  onMenu?: () => void;
  className?: string;
  actions: { label: string; icon: IconComponent; badge?: string; onClick: () => void }[];
}) {
  return (
    <div className={`app-header ${className}`}>
      <button
        className="header-icon header-leading"
        onClick={onBack ?? onMenu}
        aria-label={onBack ? "رجوع" : "فتح القائمة"}
      >
        {onBack ? <ArrowRightIcon /> : <HamburgerMenuIcon />}
      </button>
      <div className="header-brand">
        <span className="brand-mark" aria-hidden="true">
          <CubeIcon />
        </span>
        <span className="header-copy">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </div>
      <div className="header-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            className="header-icon"
            onClick={action.onClick}
            aria-label={action.label}
          >
            <action.icon />
            {action.badge ? <span className="notification-badge">{action.badge}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function SimpleAppHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="app-header simple-app-header">
      <button className="header-icon" onClick={onBack} aria-label="رجوع">
        <ArrowRightIcon />
      </button>
      <strong>{title}</strong>
    </div>
  );
}

function TransferArrowsIcon() {
  return (
    <span className="transfer-arrows-icon" aria-hidden="true">
      <ArrowRightIcon />
      <ArrowLeftIcon />
    </span>
  );
}

function DashboardPage({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const totals = useMemo(() => computeCategoryTotals(ctx.accounts, ctx.ledger), [ctx.accounts, ctx.ledger]);
  const liveSummary = useMemo(
    () =>
      computeDashboardSummary(ctx.accounts, ctx.ledger, ctx.warehouses, ctx.inventory, {
        lowStockThreshold: 25,
        recentInvoicesLimit: 3,
      }),
    [ctx.accounts, ctx.inventory, ctx.ledger, ctx.warehouses],
  );

  const quickActions: { label: string; icon: IconComponent; action: () => void; accent?: boolean }[] = [
    { label: "سند جديد", icon: FilePlusIcon, action: () => ctx.openTransaction() },
    { label: "حوالة جديدة", icon: PaperPlaneIcon, action: () => flow.push(simpleEntryScreen()) },
    { label: "كشف حساب", icon: ReaderIcon, action: ctx.openAccountPicker },
    { label: "قيد بسيط", icon: MixIcon, action: () => flow.push(simpleEntryScreen()), accent: true },
    { label: "الحركة اليومية", icon: ActivityLogIcon, action: () => flow.push(dailyJournalScreen()), accent: true },
    {
      label: "صناديق النقدية",
      icon: BackpackIcon,
      action: () => {
        const cashAcc = ctx.accounts.find((a) => a.isCashAccount);
        if (cashAcc) flow.push(supplierScreen(cashAcc.id));
        else flow.push(purchasesScreen("purchases"));
      },
      accent: true,
    },
    { label: "فاتورة جديدة", icon: FileTextIcon, action: ctx.openInvoice },
    { label: "صرف عملات", icon: ReloadIcon, action: () => flow.push(currencyScreen()) },
    { label: "البحث السريع", icon: MagnifyingGlassIcon, action: () => flow.push(purchasesScreen("purchases")) },
  ];

  const formatMetric = (signed: number) => {
    if (Math.abs(signed) < 0.005) return "0";
    return signed < 0 ? `−${formatAmount(Math.abs(signed))}` : formatAmount(signed);
  };

  const toneOf = (signed: number): "credit" | "debit" => (signed >= 0 ? "credit" : "debit");

  const metrics: {
    label: string;
    value?: string;
    icon: IconComponent;
    tone?: "credit" | "debit";
    action: () => void;
  }[] = [
    {
      label: "المبيعات",
      value: formatMetric(totals.sales.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.sales.netSigned),
      action: () => flow.push(purchasesScreen("sales")),
    },
    {
      label: "المشتريات",
      value: formatMetric(totals.purchases.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.purchases.netSigned),
      action: () => flow.push(purchasesScreen("purchases")),
    },
    {
      label: "العملاء",
      value: formatMetric(totals.clients.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.clients.netSigned),
      action: () => flow.push(purchasesScreen("clients")),
    },
    {
      label: "الموظفين",
      value: formatMetric(totals.employees.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.employees.netSigned),
      action: () => flow.push(purchasesScreen("employees")),
    },
    {
      label: "الحوالات",
      value: formatMetric(totals.transfers.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.transfers.netSigned),
      action: () => flow.push(purchasesScreen("transfers")),
    },
    {
      label: "المحل",
      value: formatMetric(totals.shop.netSigned),
      icon: PersonIcon,
      tone: toneOf(totals.shop.netSigned),
      action: () => flow.push(shopScreen()),
    },
    { label: "المخازن والأصناف", icon: RulerHorizontalIcon, action: () => flow.push(inventoryReportScreen()) },
    { label: "حساب جديد", icon: RulerSquareIcon, action: () => ctx.openAccountCreate("extended") },
  ];

  return (
    <>
      <MobileScroll className="app-screen dashboard-scroll">
        <main className="dashboard-page page-with-footer" data-testid="dashboard-screen">
          <button
            type="button"
            className="home-summary-banner"
            onClick={() => flow.push(analyticsDashboardScreen())}
            data-testid="open-analytics-dashboard-btn"
          >
            <div className="home-summary-head">
              <strong>لوحة المبيعات والفواتير والمخزون</strong>
              <span className="home-summary-cta">
                فتح اللوحة <ArrowLeftIcon />
              </span>
            </div>
            <div className="home-summary-metrics">
              <span>
                المبيعات: <b>{formatAmount(liveSummary.totalSales)}</b>
              </span>
              <span>
                الفواتير: <b>{liveSummary.totalInvoicesCount}</b>
              </span>
              <span className={liveSummary.lowStockItems.length > 0 ? "alert" : ""}>
                نواقص المخزون: <b>{liveSummary.lowStockItems.length}</b>
              </span>
            </div>
          </button>
          <section className="section-block quick-section">
            <div className="quick-grid">
              {quickActions.map((item) => (
                <button
                  key={item.label}
                  className={item.accent ? "quick-action accent" : "quick-action"}
                  onClick={item.action}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="section-block metrics-section">
            <div className="metrics-grid">
              {metrics.map((metric) => (
                <button
                  key={metric.label}
                  className={`metric-card ${metric.tone ?? "measurement"}`}
                  onClick={metric.action}
                >
                  <span className="metric-icon">
                    <metric.icon />
                  </span>
                  <span className="metric-copy">
                    <small>{metric.label}</small>
                    {metric.value ? <strong>{metric.value}</strong> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </main>
      </MobileScroll>
      <button className="fab dashboard-fab" onClick={() => ctx.openSheet("add-operation")} aria-label="إضافة عملية">
        <PlusIcon />
      </button>
    </>
  );
}

function PurchasesPage({ flow, category }: { flow: FlowControls; category: AccountCategory }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [period, setPeriod] = useState("الكل");
  const [sortDirection, setSortDirection] = useState("تنازلي");
  const [sortBy, setSortBy] = useState("date");
  const [currencyFilter, setCurrencyFilter] = useState("ريال");
  const [byCurrency, setByCurrency] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [operationVendor, setOperationVendor] = useState<AccountRecord | null>(null);
  const keyboard = useKeyboard();
  const { screenRef } = useScreenPortal();
  const periods = ["يومي", "شهري", "الكل", "سنوي"];

  const createActions: { label: string; action: () => void }[] = [
    { label: "حساب جديد", action: () => ctx.openAccountCreate("extended", category) },
    { label: "سند جديد", action: () => ctx.openTransaction() },
    { label: "فاتورة جديدة", action: ctx.openInvoice },
    { label: "قيد بسيط", action: () => flow.push(simpleEntryScreen()) },
    { label: "صرف عملات", action: () => flow.push(currencyScreen()) },
    {
      label: "عرض سعر",
      action: () => ctx.accounts[0] && ctx.openVendorInvoice(ctx.accounts[0], "quote"),
    },
    {
      label: "طلبية جديدة",
      action: () => ctx.accounts[0] && ctx.openVendorInvoice(ctx.accounts[0], "order"),
    },
  ];
  const runCreateAction = (action: () => void) => {
    keyboard.hide();
    setCreateMenuOpen(false);
    action();
  };
  const openVendorMenu = (vendor: AccountRecord) => {
    keyboard.hide();
    setCreateMenuOpen(false);
    setOperationVendor(vendor);
  };
  const contextActions = operationVendor
    ? [
        { label: "فاتورة جديدة", action: () => ctx.openVendorInvoice(operationVendor) },
        { label: "مردود جديد", action: () => ctx.openVendorInvoice(operationVendor, "return") },
        { label: "سند جديد", action: () => ctx.openTransaction(operationVendor) },
        { label: "قيد بسيط", action: () => flow.push(simpleEntryScreen(operationVendor.id)) },
        { label: "صرف عملات", action: () => flow.push(currencyScreen(operationVendor.id)) },
        { label: "عرض سعر", action: () => ctx.openVendorInvoice(operationVendor, "quote") },
        { label: "طلبية جديدة", action: () => ctx.openVendorInvoice(operationVendor, "order") },
      ]
    : [];

  const portal = screenRef.current?.querySelector(".nasqo-app");
  const categoryAccounts = ctx.accounts.filter(
    (a) => a.category === category && (!byCurrency || a.currency === currencyFilter),
  );
  const orderedVendors =
    sortBy === "name"
      ? [...categoryAccounts].sort((a, b) => a.name.localeCompare(b.name, "ar"))
      : [...categoryAccounts];
  const visibleVendors = sortDirection === "تنازلي" ? orderedVendors : orderedVendors.reverse();

  return (
    <div className="purchases-layout">
      <section className="purchases-filter-panel" data-testid="purchases-filter-panel">
        <div className="purchases-periods" role="group" aria-label="الفترة">
          {periods.map((item) => (
            <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>
              <span className="period-radio-mark" />
              {item}
            </button>
          ))}
        </div>
        <div className="purchases-sort-row">
          <select
            aria-label="ترتيب المشتريات"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="date">ترتيب حسب التاريخ</option>
            <option value="name">ترتيب حسب الاسم</option>
          </select>
          <div>
            {["تصاعدي", "تنازلي"].map((item) => (
              <button
                key={item}
                aria-pressed={sortDirection === item}
                onClick={() => setSortDirection(item)}
              >
                <span className="period-radio-mark" />
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="purchases-currency-row">
          <span>العملة</span>
          <select
            aria-label="عملة المشتريات"
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={byCurrency}
              onChange={(event) => setByCurrency(event.target.checked)}
            />
            حسب العملة
          </label>
        </div>
        <div className="reference-date-strip">
          <button aria-label="تاريخ بداية المشتريات" onClick={() => ctx.openSheet("filters")}>
            <ArrowRightIcon />
          </button>
          <span>
            من <b>1/1/2026</b>
          </span>
          <span>
            إلى <b>{new Date().toLocaleDateString("en-GB")}</b>
          </span>
          <button aria-label="تاريخ نهاية المشتريات" onClick={() => ctx.openSheet("filters")}>
            <ArrowLeftIcon />
          </button>
        </div>
      </section>
      <MobileScroll className="app-screen purchases-list-scroll">
        <main className="purchases-page page-with-footer" data-testid="purchases-screen">
          {visibleVendors.length === 0 ? (
            <p className="cash-empty">لا توجد حسابات في هذا القسم حتى الآن — اضغط + لإضافة حساب.</p>
          ) : (
            <section className="vendor-list">
              {visibleVendors.map((vendor) => {
                const summary = computeAccountSummary(
                  vendor,
                  ctx.ledger,
                  byCurrency ? currencyFilter : undefined,
                );
                return (
                  <article key={vendor.id} className="vendor-card" data-vendor-id={vendor.codeNumber}>
                    <button
                      className="vendor-call"
                      aria-label={`اتصال بـ ${vendor.name}`}
                      onClick={() => {
                        if (vendor.phone) {
                          window.location.href = `tel:${vendor.phone.replace(/\s+/g, "")}`;
                        } else {
                          ctx.showToast("لا يوجد رقم هاتف مسجل لهذا الحساب");
                        }
                      }}
                    >
                      <MobileIcon />
                    </button>
                    <button
                      className="vendor-open"
                      onClick={() => flow.push(supplierScreen(vendor.id))}
                      aria-label={`فتح كشف ${vendor.name}`}
                    >
                      <span className="vendor-main">
                        <strong>{vendor.name}</strong>
                        <small>سقف المديونية: {formatAmount(vendor.creditLimit)}</small>
                        {vendor.phone ? (
                          <em className={vendor.isCashAccount ? "cash-vendor-phone" : undefined}>
                            {vendor.phone}
                          </em>
                        ) : null}
                      </span>
                      <span className={`vendor-balance ${summary.tone}`}>
                        <strong>
                          {formatAmount(summary.netBalance)}
                          {summary.tone === "credit" ? "-" : ""}
                        </strong>
                      </span>
                    </button>
                    <span className="vendor-actions" role="group" aria-label={`إجراءات ${vendor.name}`}>
                      <button
                        aria-label={`تعديل ${vendor.name}`}
                        onClick={() => ctx.openAccountEdit(vendor)}
                      >
                        <Pencil1Icon />
                      </button>
                      <button
                        aria-label={`رسالة إلى ${vendor.name}`}
                        onClick={() =>
                          void shareOrCopyText(
                            vendor.name,
                            `رصيد ${vendor.name}: ${formatAmount(summary.netBalance)} ${vendor.currency}`,
                            ctx.showToast,
                          )
                        }
                      >
                        <ChatBubbleIcon />
                      </button>
                      <button
                        className="vendor-operation-add"
                        aria-label={`عمليات ${vendor.name}`}
                        onClick={() => openVendorMenu(vendor)}
                      >
                        <PlusIcon />
                      </button>
                      <button
                        className="vendor-count"
                        aria-label={`عرض حركات ${vendor.name}`}
                        onClick={() => flow.push(supplierScreen(vendor.id))}
                      >
                        {summary.entryCount}
                      </button>
                      <span className="vendor-code">{vendor.codeNumber}</span>
                    </span>
                  </article>
                );
              })}
            </section>
          )}
        </main>
      </MobileScroll>
      {createMenuOpen ? (
        <div className="purchase-create-menu" data-testid="purchase-create-menu" role="menu" aria-label="قائمة إنشاء عملية">
          {createActions.map((item) => (
            <button key={item.label} role="menuitem" onClick={() => runCreateAction(item.action)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        className="fab fixed-fab"
        onClick={() => {
          keyboard.hide();
          setCreateMenuOpen((open) => !open);
        }}
        aria-label="إضافة مورد أو عملية"
        aria-expanded={createMenuOpen}
      >
        <PlusIcon />
      </button>
      {operationVendor && portal
        ? createPortal(
            <div className="vendor-menu-layer" data-testid="vendor-operations-menu">
              <button
                className="context-menu-backdrop"
                aria-label="إغلاق عمليات المورد"
                onClick={() => setOperationVendor(null)}
              />
              <aside className="vendor-operations-menu" role="menu" aria-label={`عمليات ${operationVendor.name}`}>
                {contextActions.map((item) => (
                  <button
                    role="menuitem"
                    key={item.label}
                    onClick={() => {
                      setOperationVendor(null);
                      item.action();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </aside>
            </div>,
            portal,
          )
        : null}
    </div>
  );
}

function SupplierPage({
  account,
  searchControl,
}: {
  account: AccountRecord;
  searchControl: MutableRefObject<(() => void) | null>;
}) {
  const ctx = useWorkspace();
  const keyboard = useKeyboard();
  const [period, setPeriod] = useState("الكل");
  const [currency, setCurrency] = useState("الكل");
  const [showPreviousBalance, setShowPreviousBalance] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const periods = ["يومي", "شهري", "الكل"];

  searchControl.current = () => {
    keyboard.hide();
    setSearchOpen((v) => !v);
    setQuery("");
  };

  const statement = useMemo(
    () =>
      computeStatementRows(account, ctx.ledger, {
        currency,
        searchQuery: query,
        showPreviousBalance,
      }),
    [account, ctx.ledger, currency, query, showPreviousBalance],
  );

  return (
    <>
      <MobileScroll className="app-screen">
        <main className="supplier-page page-with-footer" data-testid="supplier-screen">
          <section className="supplier-summary">
            <span className="vendor-avatar summary-avatar" aria-hidden="true">
              {account.name.charAt(0)}
            </span>
            <div className="summary-copy">
              <span>صافي الرصيد الحالي</span>
              <strong>
                {formatAmount(statement.netBalance)} {account.currency}
              </strong>
              <small>سقف المديونية: {formatAmount(account.creditLimit)} {account.currency}</small>
            </div>
            <button onClick={() => ctx.openExportMenu("statement", account)}>
              <DownloadIcon />
              <span>تصدير</span>
            </button>
          </section>
          <section className="statement-controls">
            <select
              className="select-box currency-select"
              aria-label="عملة كشف الحساب"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="الكل">جميع العملات</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="statement-options">
              <div className="period-tabs compact" role="group" aria-label="فترة كشف الحساب">
                {periods.map((item) => (
                  <button
                    key={item}
                    className={period === item ? "selected" : ""}
                    aria-pressed={period === item}
                    onClick={() => setPeriod(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label className="previous-balance">
                <input
                  type="checkbox"
                  checked={showPreviousBalance}
                  onChange={(event) => setShowPreviousBalance(event.target.checked)}
                />{" "}
                رصيد سابق
              </label>
            </div>
            {searchOpen ? (
              <div className="invoice-search">
                <KeyboardInput
                  aria-label="البحث في حركات الحساب"
                  placeholder="ابحث بالبيان أو الرقم أو المبلغ"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button aria-label="مسح البحث" onClick={() => setQuery("")}>
                  <Cross2Icon />
                </button>
              </div>
            ) : null}
            <div className="statement-date">
              <button aria-label="الفترة التالية" onClick={() => ctx.openSheet("filters")}>
                <ArrowRightIcon />
              </button>
              <span>
                الرصيد الافتتاحي: <strong>{formatAmount(account.openingBalance)}</strong>
              </span>
              <span>
                الحركات: <strong>{statement.rows.length}</strong>
              </span>
              <button aria-label="الفترة السابقة" onClick={() => ctx.openSheet("filters")}>
                <ChevronLeftIcon />
              </button>
            </div>
          </section>
          <div className="table-heading">
            <span>النوع</span>
            <span>المبلغ</span>
            <span>التفاصيل</span>
            <span>الرصيد</span>
          </div>
          {statement.rows.length === 0 ? (
            <p className="cash-empty">لا توجد حركات مسجلة لهذا الحساب.</p>
          ) : (
            <section className="transactions-list">
              {statement.rows.map((item) => (
                <article key={item.id} className="transaction-card">
                  <div className="transaction-grid">
                    <span className={`transaction-type ${item.direction}`}>{item.typeLabel}</span>
                    <strong className={`transaction-amount ${item.direction}`}>
                      {formatAmount(item.amount)}
                    </strong>
                    <span className="transaction-detail">
                      <b>{item.details || item.typeLabel}</b>
                      <time>{item.entryDate}</time>
                      <em>#{item.entryNumber}</em>
                    </span>
                    <span className="transaction-balance">{formatAmount(item.runningBalance)}</span>
                  </div>
                  <div className="transaction-actions">
                    <button
                      aria-label={`تعديل #${item.entryNumber}`}
                      onClick={() => ctx.openTransaction(account, item)}
                    >
                      <Pencil1Icon />
                    </button>
                    <button
                      aria-label={`ملف PDF للعملية #${item.entryNumber}`}
                      onClick={() => ctx.flowRef.current?.push(cashInvoicePreviewScreen(item.id))}
                    >
                      <FileTextIcon />
                    </button>
                    <button
                      aria-label={`مشاركة #${item.entryNumber}`}
                      onClick={() =>
                        void shareOrCopyText(
                          `${item.typeLabel} #${item.entryNumber}`,
                          `${account.name} | ${item.typeLabel}: ${formatAmount(item.amount)} ${item.currency} | ${item.details}`,
                          ctx.showToast,
                        )
                      }
                    >
                      <Share1Icon />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </main>
      </MobileScroll>
      <button className="fab" onClick={() => ctx.openTransaction(account)} aria-label="إضافة سند">
        <PlusIcon />
      </button>
    </>
  );
}

const cashCurrencyOptions = ["ريال", "عملة 2", "دولار", "جميع العملات بدون مصارفة", "مصارفة الكل بعملة ريال"] as const;
const cashSearchOptions = [
  "الكل",
  "الرقم",
  "البيان",
  "رقم المستند",
  "اسم المرسل",
  "اسم المستلم",
  "اسم الشركة",
  "المبلغ عليه",
  "المبلغ له",
] as const;
type CashSearchMode = (typeof cashSearchOptions)[number];

function CashStatementFooter({
  account,
  statement,
  onMenu,
}: {
  account: AccountRecord;
  statement: ReturnType<typeof computeStatementRows>;
  onMenu: () => void;
}) {
  const ctx = useWorkspace();
  return (
    <div className="cash-statement-footer" data-testid="cash-statement-footer">
      <button
        aria-label="تحويل الرصيد"
        onClick={() => ctx.flowRef.current?.push(simpleEntryScreen(account.id))}
      >
        <TransferArrowsIcon />
      </button>
      <div>
        <span>
          عليه: <bdi>{formatAmount(statement.debitTotal)}</bdi>
        </span>
        <span>
          له: <bdi>{formatAmount(statement.creditTotal)}</bdi>
        </span>
        <span>
          الرصيد عليه: <bdi className="cash-statement-total-balance">{formatAmount(statement.netBalance)}</bdi>
        </span>
      </div>
      <button aria-label="خيارات الرصيد" onClick={onMenu}>
        <HamburgerMenuIcon />
      </button>
    </div>
  );
}

function CashSupplierPage({
  account,
  menuControl,
  searchControl,
}: {
  account: AccountRecord;
  menuControl: MutableRefObject<(() => void) | null>;
  searchControl: MutableRefObject<(() => void) | null>;
}) {
  const ctx = useWorkspace();
  const [period, setPeriod] = useState("الكل");
  const [currency, setCurrency] = useState("ريال");
  const [showPreviousBalance, setShowPreviousBalance] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<CashSearchMode>("الكل");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLElement>(null);
  const keyboard = useKeyboard();
  const { screenRef } = useScreenPortal();

  menuControl.current = () => {
    keyboard.hide();
    setCurrencyOpen(false);
    setSearchMenuOpen(false);
    setOperationsOpen((open) => !open);
  };
  searchControl.current = () => {
    keyboard.hide();
    setCurrencyOpen(false);
    setOperationsOpen(false);
    setSearchMenuOpen((open) => !open);
  };
  useEffect(() => {
    listRef.current?.closest(".mobile-scroll")?.scrollTo({ top: 0 });
  }, [query, currency, searchMode]);

  const statement = useMemo(
    () =>
      computeStatementRows(account, ctx.ledger, {
        currency,
        searchQuery: query,
        searchMode,
        showPreviousBalance,
      }),
    [account, ctx.ledger, currency, query, searchMode, showPreviousBalance],
  );

  const searchPortal = screenRef.current?.querySelector(".nasqo-app");
  const startDate = period === "شهري" ? "1/12/2025" : period === "سنوي" ? "1/1/2025" : "7/11/2025";

  return (
    <div
      className={`cash-statement-layout${searchOpen ? " cash-search-active" : ""}`}
      data-testid="cash-statement-screen"
    >
      <section className="cash-statement-filters" data-testid="cash-statement-filters">
        <div className="cash-statement-currency">
          <span>العملة</span>
          <button
            aria-label="عملة كشف المشتريات النقدية"
            data-testid="cash-currency-trigger"
            aria-haspopup="listbox"
            aria-expanded={currencyOpen}
            className={currency.length > 10 ? "long-label" : ""}
            onClick={() => {
              keyboard.hide();
              setSearchMenuOpen(false);
              setOperationsOpen(false);
              setCurrencyOpen((open) => !open);
            }}
          >
            <span>{currency}</span>
            <ChevronDownIcon />
          </button>
        </div>
        <div className="cash-statement-options" role="group" aria-label="فترة كشف المشتريات النقدية">
          {["شهري", "الكل"].map((item) => (
            <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>
              <span className="period-radio-mark" />
              {item}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={showPreviousBalance}
              onChange={(event) => setShowPreviousBalance(event.target.checked)}
            />
            رصيد سابق
          </label>
          <button aria-pressed={period === "سنوي"} onClick={() => setPeriod("سنوي")}>
            <span className="period-radio-mark" />
            سنوي
          </button>
          <button
            className="cash-statement-filter-button"
            aria-label="تصفية كشف المشتريات النقدية"
            onClick={() => ctx.openSheet("filters")}
          >
            <MixerHorizontalIcon />
          </button>
        </div>
        <div className="cash-statement-date-strip">
          <button aria-label="بداية فترة المشتريات النقدية" onClick={() => ctx.openSheet("filters")}>
            <ArrowRightIcon />
          </button>
          <span>
            من <bdi>{startDate}</bdi>
          </span>
          <span>
            إلى <bdi>{new Date().toLocaleDateString("en-GB")}</bdi>
          </span>
          <button aria-label="نهاية فترة المشتريات النقدية" onClick={() => ctx.openSheet("filters")}>
            <ArrowLeftIcon />
          </button>
        </div>
      </section>
      {searchOpen ? (
        <div className="cash-search-form">
          <label>
            <span>البحث بواسطة {searchMode}</span>
            <KeyboardInput
              data-testid="cash-search-input"
              aria-label={`البحث بواسطة ${searchMode}`}
              placeholder="اكتب للبحث في الحركات"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={() => keyboard.hide()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  keyboard.hide();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <button
            data-testid="cash-search-clear"
            aria-label="مسح بحث الحركات"
            onClick={() => {
              keyboard.hide();
              setQuery("");
            }}
          >
            <Cross2Icon />
          </button>
          <button
            data-testid="cash-search-close"
            onClick={() => {
              keyboard.hide();
              setSearchOpen(false);
              setQuery("");
              setSearchMode("الكل");
            }}
          >
            إغلاق
          </button>
        </div>
      ) : null}
      <div className="cash-statement-table-heading">
        <span>النوع</span>
        <span>المبلغ</span>
        <span>التفاصيل</span>
        <span>الرصيد</span>
      </div>
      <MobileScroll className="cash-statement-scroll">
        <main ref={listRef} data-testid="supplier-screen" className="cash-statement-list">
          {statement.rows.length === 0 ? (
            <p className="cash-empty" role="status">
              لا توجد حركات تطابق البحث أو العملة المحددة.
            </p>
          ) : null}
          {showPreviousBalance ? (
            <div className="cash-statement-previous" role="status">
              <span>رصيد سابق</span>
              <bdi>{formatAmount(account.openingBalance)}</bdi>
            </div>
          ) : null}
          {statement.rows.map((item) => (
            <article
              className="cash-statement-row"
              key={item.id}
              data-transaction-id={item.entryNumber}
            >
              <div className="cash-statement-row-main">
                <span className="cash-statement-type">{item.typeLabel}</span>
                <strong className="cash-statement-amount">{formatAmount(item.amount)}</strong>
                <div className="cash-statement-detail">
                  {item.details.split("\n").map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </div>
                <bdi className="cash-statement-balance">{formatAmount(item.runningBalance)}</bdi>
              </div>
              <div className="cash-statement-row-bottom">
                <time dateTime={item.entryDate}>{item.entryDate}</time>
                <span className="cash-statement-id">{item.entryNumber}</span>
                <div className="cash-statement-actions">
                  <button
                    aria-label={`تعديل #${item.entryNumber}`}
                    onClick={() => ctx.openTransaction(account, item)}
                  >
                    <Pencil1Icon />
                  </button>
                  <button
                    className="cash-statement-pdf"
                    aria-label={`ملف PDF للعملية #${item.entryNumber}`}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      ctx.flowRef.current?.push(cashInvoicePreviewScreen(item.id));
                    }}
                  >
                    <FileTextIcon />
                  </button>
                  <button
                    aria-label={`مشاركة #${item.entryNumber}`}
                    onClick={() =>
                      void shareOrCopyText(
                        `فاتورة #${item.entryNumber}`,
                        `${account.name} | ${item.typeLabel}: ${formatAmount(item.amount)} | ${item.details}`,
                        ctx.showToast,
                      )
                    }
                  >
                    <Share1Icon />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </main>
      </MobileScroll>
      <button className="fab cash-statement-fab" aria-label="إضافة سند" onClick={() => ctx.openTransaction(account)}>
        <PlusIcon />
      </button>
      {currencyOpen ? (
        <div className="cash-currency-layer">
          <button
            className="context-menu-backdrop"
            aria-label="إغلاق قائمة العملات"
            onClick={() => setCurrencyOpen(false)}
          />
          <div className="cash-currency-menu" data-testid="cash-currency-menu" role="listbox" aria-label="عملات الكشف">
            {cashCurrencyOptions.map((option) => (
              <button
                role="option"
                aria-selected={currency === option}
                key={option}
                onClick={() => {
                  setCurrency(option);
                  setCurrencyOpen(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {searchMenuOpen && searchPortal
        ? createPortal(
            <div className="cash-search-menu-layer">
              <button
                className="context-menu-backdrop"
                aria-label="إغلاق خيارات البحث"
                onClick={() => setSearchMenuOpen(false)}
              />
              <aside className="cash-search-menu" data-testid="cash-search-menu" role="menu" aria-label="خيارات البحث في الحركات">
                {cashSearchOptions.map((mode) => (
                  <button
                    role="menuitem"
                    key={mode}
                    onClick={() => {
                      setSearchMode(mode);
                      setQuery("");
                      setSearchOpen(true);
                      setSearchMenuOpen(false);
                    }}
                  >
                    البحث بواسطة {mode}
                  </button>
                ))}
              </aside>
            </div>,
            searchPortal,
          )
        : null}
      {operationsOpen ? <CashOperationsMenu account={account} onClose={() => setOperationsOpen(false)} /> : null}
    </div>
  );
}

function CashOperationsMenu({ account, onClose }: { account: AccountRecord; onClose: () => void }) {
  const ctx = useWorkspace();
  const { screenRef } = useScreenPortal();
  const target = screenRef.current?.querySelector(".nasqo-app");
  if (!target) return null;
  const actions = [
    { label: "فاتورة جديدة", action: () => ctx.openVendorInvoice(account) },
    { label: "مردود جديد", action: () => ctx.openVendorInvoice(account, "return") },
    { label: "سند جديد", action: () => ctx.openTransaction(account) },
    { label: "صرف عملات", action: () => ctx.flowRef.current?.push(currencyScreen(account.id)) },
    { label: "عرض سعر", action: () => ctx.openVendorInvoice(account, "quote") },
    { label: "طلبية جديدة", action: () => ctx.openVendorInvoice(account, "order") },
  ];
  return createPortal(
    <div className="vendor-menu-layer">
      <button className="context-menu-backdrop" aria-label="إغلاق عمليات المشتريات النقدية" onClick={onClose} />
      <aside className="vendor-operations-menu cash-operations-menu" data-testid="cash-operations-menu" role="menu" aria-label="عمليات الحساب">
        {actions.map((item) => (
          <button
            role="menuitem"
            key={item.label}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            {item.label}
          </button>
        ))}
      </aside>
    </div>,
    target,
  );
}

function SimpleEntryPage({
  flow,
  initialToAccountId,
}: {
  flow: FlowControls;
  initialToAccountId?: string;
}) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const keyboard = useKeyboard();
  const [fromAccountId, setFromAccountId] = useState(ctx.accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(
    initialToAccountId ?? ctx.accounts[1]?.id ?? ctx.accounts[0]?.id ?? "",
  );
  const [fromSearch, setFromSearch] = useState("");
  const [toSearch, setToSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("ريال");
  const [note, setNote] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const fromAcc = ctx.accounts.find((a) => a.id === fromAccountId);
  const toAcc = ctx.accounts.find((a) => a.id === toAccountId);
  const fromSummary = fromAcc ? computeAccountSummary(fromAcc, ctx.ledger) : null;
  const toSummary = toAcc ? computeAccountSummary(toAcc, ctx.ledger) : null;

  const fromOptions = ctx.accounts.filter((a) => accountMatchesQuery(a, fromSearch));
  const toOptions = ctx.accounts.filter((a) => accountMatchesQuery(a, toSearch));

  const swapAccounts = () => {
    keyboard.hide();
    setError("");
    setFromAccountId(toAccountId);
    setToAccountId(fromAccountId);
    setFromSearch(toSearch);
    setToSearch(fromSearch);
  };

  const saveEntry = async () => {
    keyboard.hide();
    const numericAmount = parseArabicNumber(amount);
    if (!fromAcc || !toAcc) {
      setError("اختر حساب المصدر وحساب الوجهة أولًا.");
      return;
    }
    if (fromAcc.id === toAcc.id) {
      setError("اختر حسابين مختلفين للقيد.");
      return;
    }
    if (numericAmount <= 0) {
      setError("أدخل مبلغًا أكبر من صفر.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextNum = Math.max(1000, ...ctx.ledger.map((e) => e.entryNumber)) + 1;
      await createLedgerEntry(ctx.uid, {
        accountId: toAcc.id,
        accountName: toAcc.name,
        counterpartAccountId: fromAcc.id,
        counterpartAccountName: fromAcc.name,
        kind: "simple-entry",
        typeLabel: "قيد بسيط",
        payment: "balance",
        direction: "credit",
        amount: numericAmount,
        currency,
        exchangeRate: 1,
        details: note || `تحويل من ${fromAcc.name} إلى ${toAcc.name}`,
        documentNumber,
        entryNumber: nextNum,
        deleted: false,
        entryDate: new Date().toISOString().slice(0, 10),
      });
      ctx.showToast(`تم حفظ القيد البسيط رقم #${nextNum} بنجاح`);
      flow.pop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileScroll className="app-screen simple-entry-scroll">
      <main className="simple-entry-page" data-testid="simple-entry-screen">
        <time className="simple-entry-time" dateTime={now.toISOString()}>
          <span>{now.toLocaleDateString("ar-SA", { weekday: "long" })}</span>{" "}
          <bdi>
            {now.toLocaleDateString("en-GB")} {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </bdi>
        </time>
        <section className="simple-entry-account-group">
          <div className="simple-entry-search from-search">
            <KeyboardInput
              data-testid="simple-entry-from-search"
              aria-label="البحث عن حساب المصدر"
              placeholder="من حساب (ابحث عن الاسم هنا)"
              value={fromSearch}
              onChange={(event) => {
                setFromSearch(event.target.value);
                setError("");
              }}
            />
            <button
              className="simple-entry-clear"
              data-testid="simple-entry-from-clear"
              aria-label="مسح حساب المصدر"
              onClick={() => {
                setFromSearch("");
                setFromAccountId("");
              }}
            >
              <Cross2Icon />
            </button>
          </div>
          <label className="simple-entry-account-label" htmlFor="simple-entry-from-account">
            أو حدد الحساب من هنا
          </label>
          <select
            id="simple-entry-from-account"
            data-testid="simple-entry-from-account"
            className="simple-entry-account-select"
            aria-label="حساب المصدر"
            value={fromAccountId}
            onChange={(event) => {
              setFromAccountId(event.target.value);
              setFromSearch("");
              setError("");
            }}
          >
            <option value="">{fromOptions.length ? "اختر الحساب" : "لا توجد حسابات مطابقة"}</option>
            {fromOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <div className="simple-entry-balance">
            الرصيد: <bdi>{formatAmount(fromSummary?.netBalance ?? 0)}</bdi>
          </div>
        </section>
        <section className="simple-entry-account-group">
          <div className="simple-entry-search to-search">
            <button
              className="simple-entry-swap"
              data-testid="simple-entry-swap"
              aria-label="تبديل حساب المصدر والوجهة"
              onClick={swapAccounts}
            >
              <TransferArrowsIcon />
            </button>
            <label>
              <span>إلى حساب (ابحث عن الاسم هنا)</span>
              <KeyboardInput
                data-testid="simple-entry-to-search"
                aria-label="البحث عن حساب الوجهة"
                placeholder={toAcc?.name || "ابحث عن الاسم هنا"}
                value={toSearch}
                onChange={(event) => {
                  setToSearch(event.target.value);
                  setError("");
                }}
              />
            </label>
            <button
              className="simple-entry-clear"
              data-testid="simple-entry-to-clear"
              aria-label="مسح حساب الوجهة"
              onClick={() => {
                setToSearch("");
                setToAccountId("");
              }}
            >
              <Cross2Icon />
            </button>
          </div>
          <label className="simple-entry-account-label" htmlFor="simple-entry-to-account">
            أو حدد الحساب من هنا
          </label>
          <select
            id="simple-entry-to-account"
            data-testid="simple-entry-to-account"
            className="simple-entry-account-select"
            aria-label="حساب الوجهة"
            value={toAccountId}
            onChange={(event) => {
              setToAccountId(event.target.value);
              setToSearch("");
              setError("");
            }}
          >
            <option value="">{toOptions.length ? "اختر الحساب" : "لا توجد حسابات مطابقة"}</option>
            {toOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <div className="simple-entry-balance">
            الرصيد: <bdi>{formatAmount(toSummary?.netBalance ?? 0)}</bdi>
          </div>
        </section>
        <div className="simple-entry-amount-row">
          <button
            className="simple-entry-demo-icon"
            aria-label="آلة حاسبة للمبلغ"
            onClick={() => ctx.showToast("أدخل المبلغ مباشرة في الحقل")}
          >
            <TableIcon />
          </button>
          <label className="simple-entry-amount-field">
            <span>أدخل المبلغ</span>
            <KeyboardInput
              data-testid="simple-entry-amount"
              aria-label="مبلغ القيد"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError("");
              }}
            />
          </label>
          <button
            className="simple-entry-demo-icon voice"
            aria-label="إدخال مبلغ القيد صوتيًا"
            onClick={() => ctx.showToast("استخدم لوحة المفاتيح الصوتية للجهاز")}
          >
            <SpeakerLoudIcon />
          </button>
          <select
            className="simple-entry-currency"
            aria-label="عملة القيد"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="simple-entry-amount-caption">
          {amount ? `${formatAmount(parseArabicNumber(amount))} ${currency}` : `صفر ${currency}`}
        </div>
        <div className="simple-entry-note-row">
          <button
            className="simple-entry-demo-icon"
            aria-label="صورة بيان القيد"
            onClick={() => ctx.showToast("أدخل تفاصيل المستند في خانة رقم المستند")}
          >
            <CameraIcon />
          </button>
          <KeyboardInput
            data-testid="simple-entry-note"
            aria-label="بيان القيد"
            placeholder="اكتب البيان"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            className="simple-entry-demo-icon voice"
            aria-label="إدخال بيان القيد صوتيًا"
            onClick={() => ctx.showToast("استخدم لوحة المفاتيح الصوتية للجهاز")}
          >
            <SpeakerLoudIcon />
          </button>
        </div>
        <KeyboardInput
          className="simple-entry-document"
          data-testid="simple-entry-document"
          aria-label="رقم مستند القيد"
          placeholder="رقم المستند"
          value={documentNumber}
          onChange={(event) => setDocumentNumber(event.target.value)}
        />
        {error ? (
          <p className="simple-entry-feedback error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="simple-entry-actions">
          <button className="save" data-testid="simple-entry-save" disabled={saving} onClick={saveEntry}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
          <button className="cancel" data-testid="simple-entry-cancel" onClick={flow.pop}>
            إلغاء
          </button>
        </div>
      </main>
    </MobileScroll>
  );
}

function CurrencyPage({ flow, initialAccountId }: { flow: FlowControls; initialAccountId?: string }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [search, setSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId ?? ctx.accounts[0]?.id ?? "");
  const [fromCurrency, setFromCurrency] = useState<CurrencyCode>("دولار");
  const [toCurrency, setToCurrency] = useState<CurrencyCode>("ريال");
  const [rate, setRate] = useState("530");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [settlement, setSettlement] = useState<"account" | "cash">("account");
  const [saving, setSaving] = useState(false);

  const selectedAccount = ctx.accounts.find((a) => a.id === selectedAccountId) ?? ctx.accounts[0];
  const parsedAmount = parseArabicNumber(amount);
  const parsedRate = Math.max(0.0001, parseArabicNumber(rate) || 1);
  const converted = parsedAmount * parsedRate;

  const saveExchange = async () => {
    if (!selectedAccount || parsedAmount <= 0) {
      ctx.showToast("أدخل المبلغ واختر الحساب أولًا");
      return;
    }
    setSaving(true);
    try {
      const nextNum = Math.max(1000, ...ctx.ledger.map((e) => e.entryNumber)) + 1;
      await createLedgerEntry(ctx.uid, {
        accountId: selectedAccount.id,
        accountName: selectedAccount.name,
        kind: "currency",
        typeLabel: mode === "buy" ? "صرف شراء" : "صرف بيع",
        payment: settlement === "cash" ? "cash" : "balance",
        direction: mode === "buy" ? "credit" : "debit",
        amount: converted,
        currency: toCurrency,
        exchangeRate: parsedRate,
        details: note || `صرف ${formatAmount(parsedAmount)} ${fromCurrency} بسعر ${parsedRate} -> ${toCurrency}`,
        entryNumber: nextNum,
        deleted: false,
        entryDate: new Date().toISOString().slice(0, 10),
      });
      ctx.showToast(`تم حفظ عملية الصرف رقم #${nextNum}`);
      flow.pop();
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileScroll className="app-screen currency-page-scroll">
      <main className="currency-page" data-testid="currency-screen">
        <time className="currency-time">
          اليوم · {new Intl.DateTimeFormat("ar-SA", { hour: "2-digit", minute: "2-digit" }).format(new Date())}
        </time>
        <section className="currency-workspace">
          <div className="currency-search-field">
            <button aria-label="مسح البحث" onClick={() => setSearch("")}>
              <Cross2Icon />
            </button>
            <label htmlFor="currency-search">
              <span>ابحث عن الاسم هنا</span>
              <KeyboardInput
                id="currency-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث عن الاسم هنا"
              />
            </label>
          </div>
          <p className="currency-helper">أو حدد الحساب من هنا</p>
          <div className="currency-account-row">
            <button
              className="currency-account-add"
              data-testid="currency-account-add"
              aria-label="إضافة حساب للصرف"
              onClick={() => ctx.openAccountCreate("extended")}
            >
              <PlusIcon />
            </button>
            <select
              className="currency-account-select"
              aria-label="الحساب"
              value={selectedAccount?.id ?? ""}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {ctx.accounts
                .filter((a) => !search || accountMatchesQuery(a, search) || a.id === selectedAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="exchange-rate-card">
            <span>
              <small>من</small>
              <select
                aria-label="من عملة"
                value={fromCurrency}
                onChange={(e) => setFromCurrency(e.target.value as CurrencyCode)}
                style={{ border: 0, background: "transparent", fontWeight: 700 }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </span>
            <span className="rate-value">
              <small>سعر الصرف</small>
              <KeyboardInput
                aria-label="سعر الصرف"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                style={{ width: 64, textAlign: "center", border: 0, borderBottom: "1px solid #075da8" }}
              />
            </span>
          </div>
          <div className="currency-entry">
            <TableIcon />
            <label htmlFor="currency-amount">
              <span>أدخل المبلغ</span>
              <KeyboardInput
                id="currency-amount"
                data-testid="currency-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
              />
            </label>
            <button aria-label="مسح" onClick={() => setAmount("")}>
              <Cross2Icon />
            </button>
            <em>
              {formatAmount(parsedAmount)} {fromCurrency}
            </em>
          </div>
          <div className="exchange-rate-card">
            <span>
              <small>إلى</small>
              <select
                aria-label="إلى عملة"
                value={toCurrency}
                onChange={(e) => setToCurrency(e.target.value as CurrencyCode)}
                style={{ border: 0, background: "transparent", fontWeight: 700 }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </span>
            <span className="rate-value">
              <small>سعر الصرف</small>
              <strong>{parsedRate}</strong>
            </span>
          </div>
          <div className="currency-result">
            <small>المبلغ المقابل</small>
            <strong>{formatAmount(converted)}</strong>
            <em>{toCurrency}</em>
          </div>
          <div className="currency-entry note-entry">
            <CameraIcon />
            <label htmlFor="currency-note">
              <KeyboardInput
                id="currency-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="اكتب البيان"
              />
            </label>
            <button aria-label="مسح البيان" onClick={() => setNote("")}>
              <Cross2Icon />
            </button>
          </div>
          <div className="inline-radio-group" aria-label="نوع صرف العملات">
            <label className={mode === "buy" ? "selected green" : "green"}>
              <input type="radio" name="currency-mode" checked={mode === "buy"} onChange={() => setMode("buy")} /> شراء
            </label>
            <label className={mode === "sell" ? "selected red" : "red"}>
              <input type="radio" name="currency-mode" checked={mode === "sell"} onChange={() => setMode("sell")} /> بيع
            </label>
          </div>
          <div className="inline-radio-group settlement-group" aria-label="طريقة المصادقة">
            <label className={settlement === "account" ? "selected" : ""}>
              <input
                type="radio"
                name="settlement"
                checked={settlement === "account"}
                onChange={() => setSettlement("account")}
              />{" "}
              مصادقة في حساب عميل
            </label>
            <label className={settlement === "cash" ? "selected" : ""}>
              <input
                type="radio"
                name="settlement"
                checked={settlement === "cash"}
                onChange={() => setSettlement("cash")}
              />{" "}
              مصادقة نقدية في الصندوق
            </label>
          </div>
          <div className="form-modal-actions currency-actions">
            <button className="cancel" onClick={flow.pop}>
              إلغاء
            </button>
            <button className="form-help" onClick={() => ctx.showToast("أدخل المبلغ وسعر الصرف وحدد العملتين ثم اضغط حفظ")}>
              <VideoIcon /> شرح
            </button>
            <button className="save" data-testid="currency-save" disabled={saving} onClick={saveExchange}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
          </div>
        </section>
      </main>
    </MobileScroll>
  );
}

function WhatsAppSettingsPage({ flow }: { flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const [provider, setProvider] = useState<"nasqo" | "external">(ctx.workspace?.whatsappProvider ?? "nasqo");
  const [instantEnabled, setInstantEnabled] = useState(ctx.workspace?.whatsappInstantEnabled ?? false);
  const [phone, setPhone] = useState(ctx.workspace?.whatsappPhone ?? "");
  const [saving, setSaving] = useState(false);

  const saveSettings = async () => {
    if (!ctx.workspace) return;
    setSaving(true);
    try {
      await saveWorkspaceSettings(ctx.uid, {
        ...ctx.workspace,
        whatsappProvider: provider,
        whatsappInstantEnabled: instantEnabled,
        whatsappPhone: phone,
      });
      ctx.showToast("تم حفظ إعدادات إشعارات الواتساب بنجاح");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileScroll className="whatsapp-settings-scroll">
      <main className="whatsapp-settings-page" data-testid="whatsapp-settings-screen">
        <button className="whatsapp-back" aria-label="رجوع" onClick={flow.pop}>
          <ArrowLeftIcon />
        </button>
        <section className="whatsapp-brand">
          <span>
            <MobileIcon />
          </span>
          <strong>{ctx.workspace?.companyName || "نسقو برو"}</strong>
          <small>إدارة إشعارات واتساب</small>
        </section>
        <section className="whatsapp-settings-card">
          <h2>
            <ChatBubbleIcon /> إعدادات إشعارات الواتساب
          </h2>
          <div className="provider-choice" role="group" aria-label="مزود خدمة واتساب">
            <button aria-pressed={provider === "external"} onClick={() => setProvider("external")}>
              <span className="radio-dot" /> خدمة خارجية
            </button>
            <button aria-pressed={provider === "nasqo"} onClick={() => setProvider("nasqo")}>
              <span className="radio-dot" /> نسقو برو
            </button>
          </div>
          <label className="settings-toggle">
            <span>تفعيل نظام الرسائل الفورية عبر الواتساب</span>
            <input
              type="checkbox"
              checked={instantEnabled}
              onChange={(event) => setInstantEnabled(event.target.checked)}
            />
          </label>
          <label className="settings-input" htmlFor="whatsapp-phone">
            <PersonIcon />
            <KeyboardInput
              id="whatsapp-phone"
              data-testid="whatsapp-phone"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="أدخل رقم الهاتف التجاري"
            />
            {!phone ? <ExclamationTriangleIcon className="warning-icon" /> : null}
          </label>
          <button
            className="whatsapp-save"
            data-testid="whatsapp-save"
            disabled={saving}
            onClick={saveSettings}
          >
            {saving ? "جاري الحفظ..." : "حفظ إعدادات الواتساب"}
          </button>
          <div className="account-info">
            <h3>
              <InfoCircledIcon /> معلومات الحساب
            </h3>
            <p>
              <span>الحساب السحابي:</span>
              <strong>{ctx.userEmail || "مرتبط"}</strong>
            </p>
            <p>
              <span>رقم الواتساب المسجل:</span>
              <strong>{phone || "غير محدد"}</strong>
            </p>
            <p>
              <span>إرسال الإشعارات:</span>
              <strong>{instantEnabled ? "مفعل" : "متوقف"}</strong>
            </p>
          </div>
        </section>
      </main>
    </MobileScroll>
  );
}

function BottomNav() {
  const ctx = useWorkspace();
  return (
    <nav className="dashboard-footer" aria-label="روابط نسقو">
      <div>
        <button aria-label="الإعدادات" onClick={ctx.openSettings}>
          <GlobeIcon />
        </button>
        <button aria-label="واتساب" onClick={() => ctx.flowRef.current?.push(whatsappSettingsScreen())}>
          <ChatBubbleIcon />
        </button>
      </div>
      <span>
        رقم الإصدار: <bdi>1.0.0</bdi>
      </span>
      <div>
        <button aria-label="التقارير" onClick={() => ctx.flowRef.current?.push(inventoryReportScreen())}>
          <VideoIcon />
        </button>
        <button aria-label="الحركة اليومية" onClick={() => ctx.flowRef.current?.push(dailyJournalScreen())}>
          <PaperPlaneIcon />
        </button>
      </div>
    </nav>
  );
}

function FinancialFooter({
  debit,
  credit,
  balance,
  compact = false,
  onPrimary,
  onMenu,
}: {
  debit: string;
  credit: string;
  balance: string;
  compact?: boolean;
  onPrimary: () => void;
  onMenu: () => void;
}) {
  return (
    <div className={compact ? "financial-footer compact with-balance" : "financial-footer with-balance"}>
      <button
        className="footer-primary-action"
        aria-label={compact ? "تحويل الرصيد" : "إضافة عملية"}
        onClick={onPrimary}
      >
        {compact ? <SwitchIcon /> : <PlusIcon />}
      </button>
      <div>
        <span>عليه</span>
        <strong>{debit}</strong>
      </div>
      <div>
        <span>له</span>
        <strong>{credit}</strong>
      </div>
      <div>
        <span>الرصيد</span>
        <strong>{balance}</strong>
      </div>
      <button className="footer-menu" aria-label="خيارات الرصيد" onClick={onMenu}>
        <HamburgerMenuIcon />
      </button>
    </div>
  );
}

function AppDrawer({
  open,
  onClose,
  onNavigate,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (target: DrawerTarget) => void;
  onNotify: (message: string) => void;
}) {
  const ctx = useWorkspace();
  const sections: {
    title?: string;
    items: { label: string; ariaLabel?: string; icon: IconComponent; target?: DrawerTarget; action?: () => void }[];
  }[] = [
    {
      items: [
        { label: "الرئيسية", icon: HomeIcon, target: "dashboard" },
        { label: "لوحة المبيعات والمخزون", icon: CardStackIcon, target: "analytics-dashboard" },
        { label: "الحركة اليومية", icon: ActivityLogIcon, target: "daily-journal" },
        { label: "الرسائل الفورية واتساب", icon: MobileIcon, target: "whatsapp" },
        { label: "تقارير المخزون", icon: ReaderIcon, target: "inventory-report" },
        { label: "عروض الأسعار", icon: FileTextIcon, target: "quotes" },
        { label: "الطلبيات", icon: FilePlusIcon, target: "orders" },
        { label: "سلة المحذوفات", icon: TrashIcon, target: "trash" },
        { label: "الإعدادات", icon: GearIcon, target: "settings" },
      ],
    },
    {
      title: "المخازن",
      items: [
        { label: "المخازن", icon: CubeIcon, target: "warehouses" },
        { label: "الأصناف والمخزون", icon: BackpackIcon, target: "inventory-report" },
        { label: "إضافة صنف للمخزن", icon: PlusIcon, action: () => { onClose(); ctx.openInventoryAdd(); } },
      ],
    },
    {
      title: "الحسابات",
      items: [
        { label: "دليل الحسابات", icon: ReaderIcon, target: "accounts" },
        { label: "العملات والصرف", icon: CardStackIcon, target: "currency" },
        { label: "استيراد الحسابات من CSV", icon: TableIcon, action: () => { onClose(); ctx.triggerCsvImport(); } },
      ],
    },
    {
      title: "النسخ الاحتياطي",
      items: [
        { label: "تنزيل نسخة احتياطية (JSON)", icon: ArchiveIcon, action: () => { onClose(); ctx.triggerJsonBackup(); } },
        { label: "استعادة نسخة احتياطية", icon: UploadIconShim, action: () => { onClose(); ctx.triggerJsonRestore(); } },
      ],
    },
    {
      title: "الحساب والجلسة",
      items: [
        { label: `الحساب: ${ctx.userEmail || "مستخدم مسجل"}`, icon: PersonIcon, action: () => { onClose(); ctx.openSettings(); } },
        { label: "تسجيل الخروج", icon: LockClosedIcon, action: ctx.handleSignOut },
      ],
    },
  ];

  return (
    <div className={open ? "drawer-layer open" : "drawer-layer"} aria-hidden={!open}>
      <button className="drawer-backdrop" onClick={onClose} aria-label="إغلاق القائمة" />
      <button className="drawer-toolbar-close" onClick={onClose} aria-label="إغلاق">
        <ArrowRightIcon />
      </button>
      <aside className="app-drawer" aria-label="قائمة نسقو">
        {open ? (
          <MobileScroll className="drawer-scroll">
            <div className="drawer-brand-hero">
              <span className="drawer-hero-mark">
                <CubeIcon />
              </span>
              <strong>{ctx.workspace?.companyName || "نسقو برو"}</strong>
              <small>{ctx.userEmail || "نظام إدارة الأعمال السحابي"}</small>
            </div>
            <div className="drawer-sections">
              {sections.map((section, index) => (
                <section key={section.title ?? index}>
                  {section.title ? <h3>{section.title}</h3> : null}
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      aria-label={item.ariaLabel}
                      onClick={() => {
                        if (item.action) {
                          item.action();
                        } else if (item.target) {
                          onNavigate(item.target);
                        } else {
                          onClose();
                          onNotify(item.label);
                        }
                      }}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </MobileScroll>
        ) : null}
      </aside>
    </div>
  );
}

function UploadIconShim() {
  return <DownloadIcon style={{ transform: "rotate(180deg)" }} />;
}

function DashboardAddMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useWorkspace();
  if (!open) return null;
  const actions = [
    { label: "إضافة حساب جديد", action: () => ctx.openAccountCreate("extended") },
    { label: "تعديل بيانات حساب", action: () => ctx.openAccountEdit() },
    { label: "سند جديد", action: () => ctx.openTransaction() },
    { label: "فاتورة جديدة", action: () => ctx.openInvoice() },
    { label: "إضافة مردود جديد", action: () => ctx.accounts[0] && ctx.openVendorInvoice(ctx.accounts[0], "return") },
    { label: "إضافة عرض سعر", action: () => ctx.accounts[0] && ctx.openVendorInvoice(ctx.accounts[0], "quote") },
    { label: "إضافة طلبية", action: () => ctx.accounts[0] && ctx.openVendorInvoice(ctx.accounts[0], "order") },
    { label: "قيد بسيط", action: () => ctx.flowRef.current?.push(simpleEntryScreen()) },
    { label: "إضافة صنف للمخزن", action: ctx.openInventoryAdd },
  ];
  return (
    <div className="dashboard-add-layer" data-testid="dashboard-add-menu">
      <button className="context-menu-backdrop" aria-label="إغلاق قائمة الإضافة" onClick={onClose} />
      <aside className="dashboard-add-menu" role="menu" aria-label="إضافة وإدارة الحسابات">
        {actions.map((item) => (
          <button
            role="menuitem"
            key={item.label}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            {item.label}
          </button>
        ))}
      </aside>
    </div>
  );
}

function ExportSideMenu({
  open,
  kind = "statement",
  onClose,
  onSelectAction,
}: {
  open: boolean;
  kind?: ExportKind;
  onClose: () => void;
  onSelectAction: (action: "pdf-print" | "pdf-share" | "excel" | "excel-share" | "balance" | "import") => void;
}) {
  const items: {
    key: "pdf-print" | "pdf-share" | "excel" | "excel-share" | "balance" | "import";
    label: string;
    icon: IconComponent;
    tone: string;
  }[] = [
    { key: "pdf-print", label: "طباعة / حفظ PDF", icon: FileTextIcon, tone: "pdf" },
    { key: "pdf-share", label: "مشاركة ملخص الرصيد", icon: Share1Icon, tone: "share" },
    { key: "excel", label: "تصدير إلى ملف CSV / Excel", icon: TableIcon, tone: "excel" },
    { key: "balance", label: "طباعة مصادقة الرصيد", icon: CardStackIcon, tone: "balance" },
  ];
  if (!open) return null;
  const visibleItems =
    kind === "purchases"
      ? [
          ...items.slice(0, 3),
          { key: "import" as const, label: "استيراد الحسابات من CSV", icon: TableIcon, tone: "excel" },
        ]
      : kind === "inventory"
        ? items.slice(0, 3)
        : items;

  return (
    <div className="export-menu-layer" data-testid="export-menu">
      <button className="export-menu-backdrop" onClick={onClose} aria-label="إغلاق قائمة التصدير" />
      <aside
        className={`export-side-menu ${kind === "inventory" ? "inventory-export-menu" : kind === "purchases" ? "purchases-export-menu" : ""}`}
        aria-label="خيارات التصدير"
      >
        {visibleItems.map((item) => (
          <button key={item.label} onClick={() => onSelectAction(item.key)}>
            <item.icon className={item.tone} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>
    </div>
  );
}

function AccountPickerModal({
  open,
  title = "كشف حساب",
  onClose,
  onAddAccount,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onAddAccount: () => void;
  onConfirm: (account: AccountRecord) => void;
}) {
  const ctx = useWorkspace();
  const [selectedId, setSelectedId] = useState(ctx.accounts[0]?.id ?? "");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const keyboard = useKeyboard();
  const close = () => {
    keyboard.hide();
    setOptionsOpen(false);
    setSearch("");
    onClose();
  };
  if (!open) return null;
  const selected = ctx.accounts.find((a) => a.id === selectedId) ?? ctx.accounts[0];
  const filteredAccounts = ctx.accounts.filter((a) => accountMatchesQuery(a, search));

  return (
    <div className="center-modal-layer" data-testid="account-picker-modal">
      <button className="center-modal-backdrop" onClick={close} aria-label="إغلاق اختيار الحساب" />
      <section className="account-picker-modal" role="dialog" aria-modal="true" aria-labelledby="account-picker-title">
        <h2 id="account-picker-title">{title}</h2>
        <label className="account-picker-search reference-search" htmlFor="account-picker-search">
          <span>ابحث عن الاسم هنا</span>
          <KeyboardInput
            id="account-picker-search"
            aria-label="البحث عن الحساب"
            data-testid="account-picker-search-input"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOptionsOpen(true);
            }}
          />
        </label>
        <p>أو حدد الحساب من هنا</p>
        <div className="account-select-row">
          <button
            className="account-add"
            onClick={() => {
              keyboard.hide();
              setOptionsOpen(false);
              onAddAccount();
            }}
            aria-label="إضافة حساب"
          >
            <PlusIcon />
          </button>
          <button
            className="account-select"
            onClick={() => {
              keyboard.hide();
              setOptionsOpen((value) => !value);
            }}
            aria-label="اختيار حساب لكشف الحساب"
            aria-expanded={optionsOpen}
          >
            <span>{selected?.name || "لا توجد حسابات"}</span>
            <ChevronDownIcon />
          </button>
        </div>
        {optionsOpen ? (
          <div className="account-options" role="listbox" aria-label="الحسابات">
            {filteredAccounts.length ? (
              filteredAccounts.map((acc) => (
                <button
                  key={acc.id}
                  role="option"
                  aria-selected={acc.id === selected?.id}
                  onClick={() => {
                    keyboard.hide();
                    setSelectedId(acc.id);
                    setSearch("");
                    setOptionsOpen(false);
                  }}
                >
                  {acc.name}
                </button>
              ))
            ) : (
              <p className="account-search-empty" role="status">
                لا توجد حسابات بهذا الاسم
              </p>
            )}
          </div>
        ) : null}
        <div className="account-picker-actions">
          <button className="cancel" onClick={close}>
            إلغاء
          </button>
          <button
            className="confirm"
            onClick={() => {
              if (!selected) return;
              keyboard.hide();
              setOptionsOpen(false);
              setSearch("");
              onConfirm(selected);
            }}
          >
            موافق
          </button>
        </div>
      </section>
    </div>
  );
}

function TransactionModal({
  open,
  initialAccount,
  editingEntry,
  onClose,
}: {
  open: boolean;
  initialAccount?: AccountRecord;
  editingEntry?: LedgerEntryRecord;
  onClose: () => void;
}) {
  const ctx = useWorkspace();
  const [accountId, setAccountId] = useState(
    editingEntry?.accountId ?? initialAccount?.id ?? ctx.accounts[0]?.id ?? "",
  );
  const [amount, setAmount] = useState(editingEntry ? String(editingEntry.amount) : "");
  const [note, setNote] = useState(editingEntry?.details ?? "");
  const [payment, setPayment] = useState<"cash" | "balance">(
    editingEntry?.payment === "balance" ? "balance" : "cash",
  );
  const [direction, setDirection] = useState<"debit" | "credit">(editingEntry?.direction ?? "debit");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAccountId(editingEntry?.accountId ?? initialAccount?.id ?? ctx.accounts[0]?.id ?? "");
      setAmount(editingEntry ? String(editingEntry.amount) : "");
      setNote(editingEntry?.details ?? "");
      setPayment(editingEntry?.payment === "balance" ? "balance" : "cash");
      setDirection(editingEntry?.direction ?? "debit");
    }
  }, [ctx.accounts, editingEntry, initialAccount, open]);

  if (!open) return null;

  const selectedAccount = ctx.accounts.find((a) => a.id === accountId) ?? initialAccount ?? ctx.accounts[0];
  const summary = selectedAccount ? computeAccountSummary(selectedAccount, ctx.ledger) : null;
  const currentTime = new Intl.DateTimeFormat("ar-SA", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const save = async () => {
    if (!selectedAccount) {
      ctx.showToast("اختر حسابًا أولًا");
      return;
    }
    const parsedAmount = parseArabicNumber(amount);
    if (parsedAmount <= 0) {
      ctx.showToast("أدخل مبلغًا أكبر من صفر");
      return;
    }
    setSaving(true);
    try {
      const nextNum =
        editingEntry?.entryNumber ?? Math.max(1000, ...ctx.ledger.map((e) => e.entryNumber)) + 1;
      const typeLabel = direction === "credit" ? "له (سند)" : "عليه (سند)";
      if (editingEntry) {
        await updateLedgerEntry(ctx.uid, editingEntry.id, {
          ...editingEntry,
          accountId: selectedAccount.id,
          accountName: selectedAccount.name,
          payment,
          direction,
          typeLabel,
          amount: parsedAmount,
          details: note || typeLabel,
        });
        ctx.showToast(`تم تعديل السند #${editingEntry.entryNumber}`);
      } else {
        await createLedgerEntry(ctx.uid, {
          accountId: selectedAccount.id,
          accountName: selectedAccount.name,
          kind: "voucher",
          typeLabel,
          payment,
          direction,
          amount: parsedAmount,
          currency: selectedAccount.currency,
          exchangeRate: 1,
          details: note || typeLabel,
          entryNumber: nextNum,
          deleted: false,
          entryDate: new Date().toISOString().slice(0, 10),
        });
        ctx.showToast(`تم حفظ السند رقم #${nextNum} بنجاح`);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const moveToTrash = async () => {
    if (!editingEntry) return;
    setSaving(true);
    try {
      await setLedgerDeleted(ctx.uid, editingEntry.id, true);
      ctx.showToast(`تم نقل العملية #${editingEntry.entryNumber} إلى سلة المحذوفات`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="transaction-modal">
      <button className="center-modal-backdrop" onClick={onClose} aria-label="إغلاق السند" />
      <section className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title">
        <h2 id="transaction-modal-title">
          {editingEntry ? `تعديل سند #${editingEntry.entryNumber}` : `سند جديد - ${selectedAccount?.name ?? ""}`}
        </h2>
        <div className="transaction-source-row">
          <time>{currentTime}</time>
          <select
            className="transaction-fund"
            aria-label="حساب السند"
            value={selectedAccount?.id ?? ""}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {ctx.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {editingEntry ? (
            <button
              className="transaction-settings"
              aria-label="حذف السند إلى السلة"
              onClick={moveToTrash}
              title="نقل إلى سلة المحذوفات"
            >
              <TrashIcon />
            </button>
          ) : (
            <button
              className="transaction-settings"
              aria-label="إعدادات السند"
              onClick={() => ctx.showToast("حدد اتجاه السند (له / عليه) والمبلغ ثم احفظ")}
            >
              <GearIcon />
            </button>
          )}
        </div>
        <strong className="transaction-balance-strip">
          الرصيد الحالي: {formatAmount(summary?.netBalance ?? 0)}{" "}
          {summary?.tone === "credit" ? "(له)" : summary?.tone === "debit" ? "(عليه)" : ""}
        </strong>
        <div className="transaction-input amount-input">
          <TableIcon />
          <label htmlFor="new-transaction-amount">
            <span>أدخل المبلغ</span>
            <KeyboardInput
              id="new-transaction-amount"
              data-testid="transaction-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </label>
          <button aria-label="مسح المبلغ" onClick={() => setAmount("")}>
            <Cross2Icon />
          </button>
          <em>
            {amount ? `${formatAmount(parseArabicNumber(amount))} ${selectedAccount?.currency ?? "ريال"}` : "صفر ريال"}
          </em>
        </div>
        <div className="transaction-input">
          <CameraIcon />
          <label htmlFor="new-transaction-note">
            <KeyboardInput
              id="new-transaction-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="اكتب البيان"
            />
          </label>
          <button aria-label="مسح البيان" onClick={() => setNote("")}>
            <Cross2Icon />
          </button>
        </div>
        <div className="transaction-radio-row" aria-label="طريقة السداد">
          <label>
            <input
              type="radio"
              name="transaction-payment"
              checked={payment === "cash"}
              onChange={() => setPayment("cash")}
            />{" "}
            نقدية
          </label>
          <label>
            <input
              type="radio"
              name="transaction-payment"
              checked={payment === "balance"}
              onChange={() => setPayment("balance")}
            />{" "}
            أرصدة
          </label>
        </div>
        <div className="transaction-radio-row direction-row" aria-label="اتجاه السند">
          <label className="credit">
            <input
              type="radio"
              name="transaction-direction"
              checked={direction === "credit"}
              onChange={() => setDirection("credit")}
            />{" "}
            له
          </label>
          <label className="debit">
            <input
              type="radio"
              name="transaction-direction"
              checked={direction === "debit"}
              onChange={() => setDirection("debit")}
            />{" "}
            عليه
          </label>
        </div>
        <div className="form-modal-actions">
          <button className="cancel" onClick={onClose}>
            إلغاء
          </button>
          <button className="form-help" onClick={() => ctx.showToast("يحفظ السند مباشرة في حساب المورد/العميل")}>
            <VideoIcon /> شرح
          </button>
          <button className="save" disabled={saving} onClick={save}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountCreateModal({
  mode,
  open,
  initialAccount,
  defaultCategory = "purchases",
  onClose,
}: {
  mode: AccountCreateMode;
  open: boolean;
  initialAccount?: AccountRecord;
  defaultCategory?: AccountCategory;
  onClose: () => void;
}) {
  const ctx = useWorkspace();
  const [name, setName] = useState(initialAccount?.name ?? "");
  const [category, setCategory] = useState<AccountCategory>(initialAccount?.category ?? defaultCategory);
  const [phone, setPhone] = useState(initialAccount?.phone ?? "");
  const [note, setNote] = useState(initialAccount?.note ?? "");
  const [debtLimit, setDebtLimit] = useState(Boolean(initialAccount?.creditLimit));
  const [openingBalance, setOpeningBalance] = useState(Boolean(initialAccount?.openingBalance));
  const [openingAmount, setOpeningAmount] = useState(
    initialAccount?.openingBalance ? String(initialAccount.openingBalance) : "",
  );
  const [openingDirection, setOpeningDirection] = useState<"debit" | "credit">(
    initialAccount?.openingDirection ?? "debit",
  );
  const [debtAmount, setDebtAmount] = useState(
    initialAccount?.creditLimit ? String(initialAccount.creditLimit) : "",
  );
  const [settlement, setSettlement] = useState(initialAccount?.settlement ?? false);
  const [documentNumber, setDocumentNumber] = useState(initialAccount?.documentNumberRequired ?? false);
  const [accountImage, setAccountImage] = useState<"1" | "2" | "3">(initialAccount?.accountImage ?? "1");
  const [accountCurrency, setAccountCurrency] = useState<CurrencyCode>(initialAccount?.currency ?? "ريال");
  const [sortOrder, setSortOrder] = useState(String(initialAccount?.sortOrder ?? ctx.accounts.length + 1));
  const [messageMethod, setMessageMethod] = useState<"sms" | "whatsapp">(initialAccount?.messageMethod ?? "sms");
  const [sendMode, setSendMode] = useState<"auto" | "confirm" | "never">(initialAccount?.sendMode ?? "never");
  const [saving, setSaving] = useState(false);
  const keyboard = useKeyboard();
  const close = () => {
    keyboard.hide();
    onClose();
  };
  if (!open) return null;
  const testId = mode === "compact" ? "account-form-compact" : "account-form-extended";

  const submitAccount = async () => {
    keyboard.hide();
    if (!name.trim()) {
      ctx.showToast("أدخل اسم الحساب أولًا");
      return;
    }
    setSaving(true);
    try {
      const nextCode =
        initialAccount?.codeNumber ?? Math.max(0, ...ctx.accounts.map((a) => a.codeNumber)) + 1;
      await createOrUpdateAccount(
        ctx.uid,
        {
          name: name.trim(),
          category,
          phone,
          creditLimit: debtLimit ? parseArabicNumber(debtAmount) : initialAccount?.creditLimit ?? 1000000,
          currency: accountCurrency,
          isCashAccount: initialAccount?.isCashAccount ?? false,
          accountImage,
          sortOrder: parseArabicNumber(sortOrder) || 1,
          settlement,
          documentNumberRequired: documentNumber,
          messageMethod,
          sendMode,
          note,
          openingBalance: openingBalance ? parseArabicNumber(openingAmount) : 0,
          openingDirection,
          codeNumber: nextCode,
        },
        initialAccount?.id,
      );
      ctx.showToast(initialAccount ? "تم تحديث بيانات الحساب" : "تم إنشاء الحساب وحفظه في السحابة");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid={testId}>
      <button className="center-modal-backdrop" onClick={close} aria-label="إغلاق إضافة الحساب" />
      <section
        className={`account-form-modal ${mode}${mode === "extended" && openingBalance ? " has-opening-balance" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
      >
        <h2 id={`${testId}-title`}>{initialAccount ? "تعديل بيانات حساب" : "إضافة حساب جديد"}</h2>
        {mode === "compact" ? (
          <>
            <label className="underlined-form-field" htmlFor="compact-account-name">
              <KeyboardInput
                id="compact-account-name"
                aria-label="اسم الحساب الجديد"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="أدخل الاسم"
              />
            </label>
            <span className="form-section-label">التصنيف والصورة</span>
            <label className="account-image-row">
              <span className="account-avatar">
                {accountImage === "1" ? <PersonIcon /> : accountImage === "2" ? <HomeIcon /> : <CubeIcon />}
              </span>
              <select
                aria-label="تصنيف الحساب"
                value={category}
                onChange={(e) => setCategory(e.target.value as AccountCategory)}
              >
                <option value="purchases">المشتريات</option>
                <option value="sales">المبيعات</option>
                <option value="clients">العملاء</option>
                <option value="employees">الموظفين</option>
                <option value="transfers">الحوالات</option>
                <option value="shop">المحل</option>
              </select>
              <ChevronDownIcon />
            </label>
            <div className="account-check-row">
              <label>
                <input
                  type="checkbox"
                  checked={settlement}
                  onChange={(event) => setSettlement(event.target.checked)}
                />{" "}
                قيد تسوية
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={documentNumber}
                  onChange={(event) => setDocumentNumber(event.target.checked)}
                />{" "}
                رقم المستند
              </label>
            </div>
            <span className="form-section-label">حدد العملة الافتراضية للحساب</span>
            <div className="account-currency-row compact-currency-row">
              <div className="compact-currency-selector">
                <button
                  className="currency-plus"
                  aria-label="تبديل الصورة"
                  onClick={() => setAccountImage((v) => (v === "1" ? "2" : v === "2" ? "3" : "1"))}
                >
                  <PlusIcon />
                </button>
                <select
                  aria-label="العملة الافتراضية"
                  value={accountCurrency}
                  onChange={(event) => setAccountCurrency(event.target.value as CurrencyCode)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <label htmlFor="account-order">
                <span>الترتيب</span>
                <KeyboardInput
                  id="account-order"
                  aria-label="ترتيب الحساب"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="icon-underlined-field" htmlFor="extended-account-name">
              <PersonIcon />
              <KeyboardInput
                id="extended-account-name"
                aria-label="اسم الحساب"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="أدخل الاسم"
              />
            </label>
            <label className="icon-underlined-field" htmlFor="extended-account-phone">
              <MobileIcon />
              <KeyboardInput
                id="extended-account-phone"
                aria-label="رقم هاتف الحساب"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="أدخل رقم الهاتف"
              />
            </label>
            <label className="wide-toggle">
              <span>تصنيف الحساب:</span>
              <select
                aria-label="تصنيف الحساب الموسع"
                value={category}
                onChange={(e) => setCategory(e.target.value as AccountCategory)}
                style={{ border: "1px solid #b9d1e6", borderRadius: 5, padding: "2px 8px" }}
              >
                <option value="purchases">المشتريات</option>
                <option value="sales">المبيعات</option>
                <option value="clients">العملاء</option>
                <option value="employees">الموظفين</option>
                <option value="transfers">الحوالات</option>
                <option value="shop">المحل</option>
              </select>
            </label>
            <label className="wide-toggle">
              <span>إضافة سقف مديونية للحساب</span>
              <input
                className="account-form-switch"
                role="switch"
                type="checkbox"
                checked={debtLimit}
                onChange={(event) => {
                  keyboard.hide();
                  setDebtLimit(event.target.checked);
                }}
              />
            </label>
            {debtLimit ? (
              <label className="underlined-form-field account-debt-field">
                <KeyboardInput
                  aria-label="سقف المديونية"
                  inputMode="decimal"
                  value={debtAmount}
                  onChange={(event) => setDebtAmount(event.target.value)}
                  placeholder="أدخل سقف المديونية"
                />
              </label>
            ) : null}
            <label className="icon-underlined-field" htmlFor="extended-account-note">
              <ChatBubbleIcon />
              <KeyboardInput
                id="extended-account-note"
                aria-label="ملاحظة الحساب"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="اكتب ملاحظة"
              />
            </label>
            <fieldset className="account-radio-box">
              <legend>طريقة إرسال الرسائل</legend>
              <label>
                <input
                  type="radio"
                  name="message-method"
                  checked={messageMethod === "sms"}
                  onChange={() => setMessageMethod("sms")}
                />{" "}
                SMS
              </label>
              <label>
                <input
                  type="radio"
                  name="message-method"
                  checked={messageMethod === "whatsapp"}
                  onChange={() => setMessageMethod("whatsapp")}
                />{" "}
                واتساب
              </label>
            </fieldset>
            <fieldset className="account-radio-box three">
              <legend>إرسال الرسائل</legend>
              <label>
                <input
                  type="radio"
                  name="send-mode"
                  checked={sendMode === "auto"}
                  onChange={() => setSendMode("auto")}
                />{" "}
                تلقائي
              </label>
              <label>
                <input
                  type="radio"
                  name="send-mode"
                  checked={sendMode === "confirm"}
                  onChange={() => setSendMode("confirm")}
                />{" "}
                بعد التأكيد
              </label>
              <label>
                <input
                  type="radio"
                  name="send-mode"
                  checked={sendMode === "never"}
                  onChange={() => setSendMode("never")}
                />{" "}
                لا ترسل
              </label>
            </fieldset>
            <label className="wide-toggle">
              <span>إضافة رصيد افتتاحي أو رصيد سابق</span>
              <input
                className="account-form-switch"
                role="switch"
                type="checkbox"
                data-testid="opening-balance-toggle"
                aria-controls="opening-balance-fields"
                aria-expanded={openingBalance}
                checked={openingBalance}
                onChange={(event) => {
                  keyboard.hide();
                  setOpeningBalance(event.target.checked);
                }}
              />
            </label>
            {openingBalance ? (
              <div className="account-opening-fields" id="opening-balance-fields" data-testid="opening-balance-fields">
                <div className="account-opening-amount-row">
                  <KeyboardInput
                    aria-label="مبلغ الرصيد الافتتاحي"
                    data-testid="opening-balance-amount"
                    inputMode="decimal"
                    value={openingAmount}
                    onChange={(event) => setOpeningAmount(event.target.value)}
                    placeholder="أدخل المبلغ"
                  />
                  <select
                    aria-label="عملة الرصيد الافتتاحي"
                    value={accountCurrency}
                    onChange={(event) => setAccountCurrency(event.target.value as CurrencyCode)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="transaction-radio-row direction-row" role="group" aria-label="اتجاه الرصيد الافتتاحي">
                  <label className="credit">
                    <input
                      type="radio"
                      name="opening-balance-direction"
                      checked={openingDirection === "credit"}
                      onChange={() => setOpeningDirection("credit")}
                    />{" "}
                    له
                  </label>
                  <label className="debit">
                    <input
                      type="radio"
                      name="opening-balance-direction"
                      checked={openingDirection === "debit"}
                      onChange={() => setOpeningDirection("debit")}
                    />{" "}
                    عليه
                  </label>
                </div>
              </div>
            ) : null}
          </>
        )}
        <div className="form-modal-actions">
          <button className="cancel" onClick={close}>
            إلغاء
          </button>
          <button className="form-help" onClick={() => ctx.showToast("املأ اسم الحساب واختر التصنيف ثم احفظ")}>
            <VideoIcon /> شرح
          </button>
          <button className="save" disabled={saving} onClick={submitAccount}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </section>
    </div>
  );
}

function TrashModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useWorkspace();
  if (!open) return null;
  const deletedEntries = ctx.ledger.filter((e) => e.deleted);

  return (
    <div className="center-modal-layer" data-testid="trash-modal">
      <button className="center-modal-backdrop" onClick={onClose} aria-label="إغلاق سلة المحذوفات" />
      <section className="warehouse-modal" role="dialog" aria-modal="true" aria-labelledby="trash-title">
        <h2 id="trash-title">سلة المحذوفات ({deletedEntries.length})</h2>
        {deletedEntries.length === 0 ? (
          <p className="cash-empty">سلة المحذوفات فارغة.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto" }}>
            {deletedEntries.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  border: "1px solid #d5e0eb",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div>
                  <strong>
                    #{item.entryNumber} · {item.accountName}
                  </strong>
                  <div style={{ color: "#566a7b" }}>
                    {formatAmount(item.amount)} {item.currency}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={async () => {
                      await setLedgerDeleted(ctx.uid, item.id, false);
                      ctx.showToast("تمت استعادة العملية");
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 5,
                      background: "#075da8",
                      color: "#fff",
                      fontSize: 11,
                    }}
                  >
                    استعادة
                  </button>
                  <button
                    onClick={async () => {
                      await permanentlyDeleteLedger(ctx.uid, item.id);
                      ctx.showToast("تم الحذف النهائي");
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 5,
                      background: "#c91b08",
                      color: "#fff",
                      fontSize: 11,
                    }}
                  >
                    حذف نهائي
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="form-modal-actions" style={{ gridTemplateColumns: "1fr" }}>
          <button className="cancel" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkspaceSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useWorkspace();
  const [companyName, setCompanyName] = useState(ctx.workspace?.companyName ?? "نسقو برو");
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(
    ctx.workspace?.defaultCurrency ?? "ريال",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && ctx.workspace) {
      setCompanyName(ctx.workspace.companyName);
      setDefaultCurrency(ctx.workspace.defaultCurrency);
    }
  }, [ctx.workspace, open]);

  if (!open) return null;

  const save = async () => {
    if (!ctx.workspace || !companyName.trim()) return;
    setSaving(true);
    try {
      await saveWorkspaceSettings(ctx.uid, {
        ...ctx.workspace,
        companyName: companyName.trim(),
        defaultCurrency,
      });
      ctx.showToast("تم حفظ إعدادات المنشأة بنجاح");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="settings-modal">
      <button className="center-modal-backdrop" onClick={onClose} aria-label="إغلاق الإعدادات" />
      <section className="warehouse-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">إعدادات المنشأة والسحابة</h2>
        <KeyboardInput
          aria-label="اسم المنشأة"
          placeholder="اسم المنشأة أو النشاط التجاري"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <select
          aria-label="العملة الافتراضية"
          value={defaultCurrency}
          onChange={(e) => setDefaultCurrency(e.target.value as CurrencyCode)}
          style={{
            height: 36,
            border: "1px solid #b9d1e6",
            borderRadius: 6,
            padding: "0 10px",
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={ctx.triggerJsonBackup}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              background: "#edf5fc",
              color: "#075da8",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            تنزيل نسخة احتياطية
          </button>
          <button
            onClick={ctx.triggerJsonRestore}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              background: "#edf5fc",
              color: "#075da8",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            استعادة نسخة
          </button>
        </div>
        <div className="form-modal-actions">
          <button className="cancel" onClick={onClose}>
            إلغاء
          </button>
          <button className="cancel" onClick={ctx.handleSignOut} style={{ borderColor: "#c91b08", color: "#c91b08" }}>
            تسجيل الخروج
          </button>
          <button className="save" disabled={saving} onClick={save}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </section>
    </div>
  );
}

function InventoryItemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useWorkspace();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("حبة");
  const [quantity, setQuantity] = useState("1");
  const [avgCost, setAvgCost] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    ctx.warehouses.find((w) => w.isDefault)?.id ?? ctx.warehouses[0]?.id ?? "",
  );
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || !warehouseId) {
      ctx.showToast("أدخل اسم الصنف والمخزن أولًا");
      return;
    }
    setSaving(true);
    try {
      await createInventoryItem(ctx.uid, {
        name: name.trim(),
        unit: unit.trim() || "حبة",
        quantity: parseArabicNumber(quantity),
        avgCost: parseArabicNumber(avgCost),
        warehouseId,
      });
      ctx.showToast("تمت إضافة الصنف إلى المخزن");
      setName("");
      setAvgCost("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="inventory-item-modal">
      <button className="center-modal-backdrop" onClick={onClose} aria-label="إغلاق" />
      <section className="warehouse-modal" role="dialog" aria-modal="true" aria-labelledby="inv-add-title">
        <h2 id="inv-add-title">إضافة صنف مخزني</h2>
        <KeyboardInput
          aria-label="اسم الصنف"
          placeholder="اسم الصنف"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <KeyboardInput
            aria-label="الوحدة"
            placeholder="الوحدة (حبة / كرتون)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <KeyboardInput
            aria-label="الكمية"
            inputMode="decimal"
            placeholder="الكمية"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <KeyboardInput
          aria-label="متوسط التكلفة"
          inputMode="decimal"
          placeholder="متوسط التكلفة"
          value={avgCost}
          onChange={(e) => setAvgCost(e.target.value)}
        />
        <select
          aria-label="المخزن المستهدف"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          style={{ height: 36, border: "1px solid #b9d1e6", borderRadius: 6, padding: "0 10px" }}
        >
          {ctx.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <div className="form-modal-actions" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <button className="cancel" onClick={onClose}>
            إلغاء
          </button>
          <button className="save" disabled={saving} onClick={save}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SheetContent({
  kind,
  setKind,
}: {
  kind: SheetKind;
  setKind: (kind: SheetKind) => void;
}) {
  const ctx = useWorkspace();
  if (kind === "add-operation") {
    const actions: { label: string; caption: string; icon: IconComponent; action: () => void }[] = [
      { label: "فاتورة جديدة", caption: "مبيعات أو مشتريات", icon: FilePlusIcon, action: ctx.openInvoice },
      { label: "حساب جديد", caption: "عميل أو مورد", icon: PersonIcon, action: () => ctx.openAccountCreate("extended") },
      { label: "سند جديد", caption: "قبض أو صرف", icon: ReaderIcon, action: () => ctx.openTransaction() },
      { label: "صرف عملات", caption: "شراء أو بيع", icon: ReloadIcon, action: () => ctx.flowRef.current?.push(currencyScreen()) },
    ];
    return (
      <div className="sheet-action-list">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => {
              setKind(null);
              action.action();
            }}
          >
            <span>
              <action.icon />
            </span>
            <div>
              <strong>{action.label}</strong>
              <small>{action.caption}</small>
            </div>
            <ChevronLeftIcon />
          </button>
        ))}
      </div>
    );
  }
  if (kind === "notifications") {
    const overLimit = ctx.accounts.filter((a) => {
      const s = computeAccountSummary(a, ctx.ledger);
      return a.creditLimit > 0 && s.netBalance > a.creditLimit;
    });
    return (
      <div className="filter-sheet">
        {overLimit.length === 0 ? (
          <p className="cash-empty">جميع الحسابات ضمن سقف المديونية المحدد.</p>
        ) : (
          overLimit.map((acc) => {
            const s = computeAccountSummary(acc, ctx.ledger);
            return (
              <div
                key={acc.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#fde7e7",
                  color: "#a13434",
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                <strong>تجاوز سقف المديونية: {acc.name}</strong>
                <div>
                  الرصيد: {formatAmount(s.netBalance)} / السقف: {formatAmount(acc.creditLimit)}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }
  if (kind === "filters") {
    return (
      <div className="filter-sheet">
        <span className="sheet-label">العمليات النشطة: {ctx.ledger.filter((e) => !e.deleted).length}</span>
        <button
          className="primary full"
          onClick={() => {
            setKind(null);
            ctx.showToast("تم تحديث العرض حسب عوامل التصفية");
          }}
        >
          تطبيق التصفية
        </button>
      </div>
    );
  }
  if (kind === "export") {
    return (
      <div className="sheet-action-list">
        <button
          onClick={() => {
            setKind(null);
            window.print();
          }}
        >
          <span>
            <FileTextIcon />
          </span>
          <div>
            <strong>طباعة / حفظ PDF</strong>
            <small>مستند جاهز للطباعة</small>
          </div>
          <ChevronLeftIcon />
        </button>
      </div>
    );
  }
  return null;
}

function sheetTitle(kind: SheetKind) {
  return (
    ({
      "add-operation": "إضافة عملية",
      filters: "التصفية والترتيب",
      export: "تصدير كشف الحساب",
      notifications: "تنبيهات الحدود والأرصدة",
    }) as Record<Exclude<SheetKind, null>, string>
  )[kind as Exclude<SheetKind, null>] ?? "";
}

function sheetDescription(kind: SheetKind) {
  if (kind === "add-operation") return "اختر نوع العملية التي تريد تسجيلها في النظام";
  if (kind === "export") return "طباعة وتصدير التقارير المالية";
  return undefined;
}

function cashInvoicePreviewScreen(entryId: string): FlowScreen {
  return {
    id: `invoice-preview-${entryId}`,
    headerHeight: 58,
    header: (flow) => <SimpleAppHeader title="معاينة الفاتورة" onBack={flow.pop} />,
    render: (flow) => <CashInvoicePreviewPage entryId={entryId} flow={flow} />,
  };
}

function CashInvoicePreviewPage({ entryId, flow }: { entryId: string; flow: FlowControls }) {
  const ctx = useWorkspace();
  ctx.flowRef.current = flow;
  const entry = ctx.ledger.find((e) => e.id === entryId || String(e.entryNumber) === entryId);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(373);
  const [zoom, setZoom] = useState<number | null>(null);
  const [generatedAt] = useState(() => new Date());
  const fitScale = Math.min(viewportWidth / 1280, 1);
  const scale = zoom ?? fitScale;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  }, [scale]);

  const moveDocument = (direction: -1 | 1) =>
    viewportRef.current?.scrollBy({ left: direction * 240, behavior: "smooth" });

  if (!entry) {
    return (
      <MobileScroll className="app-screen">
        <p className="cash-invoice-unavailable">لم يُعثر على المستند المطلوب.</p>
      </MobileScroll>
    );
  }

  return (
    <main className="cash-invoice-preview" data-testid="cash-invoice-screen">
      <div className="cash-invoice-controls" role="group" aria-label="تكبير الفاتورة">
        <button
          data-testid="cash-invoice-zoom-in"
          aria-label="تكبير الفاتورة"
          disabled={scale >= 1.5}
          onClick={() => setZoom(Math.min(1.5, Math.ceil((scale + 0.01) * 4) / 4))}
        >
          +
        </button>
        <output data-testid="cash-invoice-zoom-value" aria-live="polite">
          {Math.round(scale * 100)}%
        </output>
        <button
          data-testid="cash-invoice-zoom-out"
          aria-label="تصغير الفاتورة"
          disabled={scale <= fitScale}
          onClick={() => setZoom(Math.max(fitScale, Math.floor((scale - 0.01) * 4) / 4))}
        >
          −
        </button>
        <button className="cash-invoice-fit" data-testid="cash-invoice-reset" onClick={() => setZoom(null)}>
          ملاءمة العرض
        </button>
        <button className="cash-invoice-actual" data-testid="cash-invoice-actual-size" onClick={() => setZoom(1)}>
          100%
        </button>
        <button className="cash-invoice-actual" onClick={() => window.print()} aria-label="طباعة الفاتورة">
          طباعة PDF
        </button>
      </div>
      <div className="cash-invoice-reader-hint">
        {scale > fitScale ? (
          <>
            <button aria-label="تحريك الفاتورة إلى اليمين" onClick={() => moveDocument(1)}>
              <ArrowRightIcon />
            </button>
            <span>مرّر لقراءة بقية المستند</span>
            <button aria-label="تحريك الفاتورة إلى اليسار" onClick={() => moveDocument(-1)}>
              <ArrowLeftIcon />
            </button>
          </>
        ) : (
          <span>
            مستند رقم {entry.entryNumber} · كبّر لقراءة التفاصيل أو اضغط طباعة PDF
          </span>
        )}
      </div>
      <MobileScroll className="cash-invoice-scroll">
        <div className="cash-invoice-horizontal" ref={viewportRef} data-testid="cash-invoice-pan" tabIndex={0} aria-label="عرض مستند الفاتورة">
          <div className="cash-invoice-sheet-space" style={{ width: 1280 * scale, height: 908 * scale }}>
            <CashInvoiceDocument
              companyName={ctx.workspace?.companyName || "نسقو برو"}
              entry={entry}
              generatedAt={generatedAt}
              scale={scale}
            />
          </div>
        </div>
      </MobileScroll>
    </main>
  );
}

function CashInvoiceDocument({
  companyName,
  entry,
  generatedAt,
  scale,
}: {
  companyName: string;
  entry: LedgerEntryRecord;
  generatedAt: Date;
  scale: number;
}) {
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, "0")}-${String(
    generatedAt.getDate(),
  ).padStart(2, "0")} ${String(generatedAt.getHours()).padStart(2, "0")}:${String(
    generatedAt.getMinutes(),
  ).padStart(2, "0")}`;

  const lines = entry.details
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <article
      className="cash-invoice-document"
      data-testid="cash-invoice-document"
      dir="rtl"
      aria-label={`مستند رقم ${entry.entryNumber}`}
      style={{ transform: `scale(${scale})` }}
    >
      <div className="cash-invoice-merchant arabic">
        <span>{companyName}</span>
        <span>إدارة الحسابات والفواتير</span>
      </div>
      <div className="cash-invoice-merchant english" lang="en" dir="ltr">
        <span>NASQO PRO</span>
        <span>Business Accounting</span>
      </div>
      <h1>{entry.typeLabel}</h1>
      <div className="cash-invoice-demo-banner">
        مستند محاسبي صادر من {companyName}
      </div>
      <div className="cash-invoice-divider" />
      <p className="cash-invoice-date">
        التاريخ : <bdi>{entry.entryDate}</bdi>
      </p>
      <p className="cash-invoice-number">
        رقم <bdi>{entry.entryNumber}</bdi>
      </p>
      <p className="cash-invoice-recipient">الأخ / {entry.accountName}</p>
      <p className="cash-invoice-salutation">المحترم</p>
      <p className="cash-invoice-description">البيان /</p>
      <table className="cash-invoice-table" aria-label="بنود المستند">
        <colgroup>
          <col style={{ width: 538 }} />
          <col style={{ width: 151 }} />
          <col style={{ width: 129 }} />
          <col style={{ width: 172 }} />
          <col style={{ width: 194 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">الصنف / البيان</th>
            <th scope="col">الوحدة</th>
            <th scope="col">الكمية</th>
            <th scope="col">السعر</th>
            <th scope="col">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {lines.length > 1 ? (
            lines.map((line, idx) => (
              <tr key={idx}>
                <td>{line}</td>
                <td>بند</td>
                <td className="red">1</td>
                <td>{idx === 0 ? formatAmount(entry.amount) : "—"}</td>
                <td className="blue">{idx === 0 ? formatAmount(entry.amount) : "—"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td>{lines[0] || entry.typeLabel}</td>
              <td>عملية</td>
              <td className="red">1</td>
              <td>{formatAmount(entry.amount)}</td>
              <td className="blue">{formatAmount(entry.amount)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="cash-invoice-summary">
        <div>
          <strong>العملة</strong>
          <bdi data-testid="cash-invoice-quantity-total">{entry.currency}</bdi>
        </div>
        <div>
          <strong>الإجمالي</strong>
          <bdi className="blue" data-testid="cash-invoice-grand-total">
            {formatAmount(entry.amount)}
          </bdi>
        </div>
      </div>
      <p className="cash-invoice-total-words">
        صافي المبلغ: {formatAmount(entry.amount)} {entry.currency}
      </p>
      <footer className="cash-invoice-document-footer">
        <time dateTime={generatedAt.toISOString()}>{stamp}</time>
        <span lang="en" dir="ltr">
          page 1
        </span>
      </footer>
    </article>
  );
}
