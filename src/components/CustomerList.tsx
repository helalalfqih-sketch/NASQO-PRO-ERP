import { useMemo, useState } from "react";
import { PlusIcon, PersonIcon, CheckCircledIcon } from "@radix-ui/react-icons";
import { createOrUpdateAccount } from "../firebase";
import { KeyboardInput, useKeyboard } from "../mobile";
import type { AccountRecord, CurrencyCode } from "../types";
import { triggerHaptic } from "../utils/haptics";

interface CustomerListProps {
  open: boolean;
  uid: string;
  accounts: readonly AccountRecord[];
  currency: CurrencyCode;
  onClose: () => void;
  onSelectCustomer?: (account: AccountRecord) => void;
  onToast: (msg: string) => void;
}

export function CustomerList({
  open,
  uid,
  accounts,
  currency,
  onClose,
  onSelectCustomer,
  onToast,
}: CustomerListProps) {
  const keyboard = useKeyboard();
  const [search, setSearch] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const clients = useMemo(() => {
    const list = accounts.filter(
      (a) => a.category === "clients" || a.category === "sales" || a.category === "purchases",
    );
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.phone && a.phone.includes(q)),
    );
  }, [accounts, search]);

  if (!open) return null;

  const handleCreateClient = async () => {
    keyboard.hide();
    const trimmedName = newName.trim();
    if (!trimmedName) {
      onToast("أدخل اسم العميل أولًا");
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateAccount(uid, {
        name: trimmedName,
        phone: newPhone.trim(),
        category: "clients",
        currency,
        creditLimit: 50000,
        isCashAccount: false,
        accountImage: "1",
        sortOrder: accounts.length + 1,
        settlement: false,
        documentNumberRequired: false,
        messageMethod: "whatsapp",
        sendMode: "confirm",
        note: newNote.trim(),
        openingBalance: 0,
        openingDirection: "credit",
        codeNumber: accounts.length + 100,
      });

      triggerHaptic("success");
      onToast(`تمت إضافة العميل (${trimmedName}) بنجاح`);
      setNewName("");
      setNewPhone("");
      setNewNote("");
      setAddingNew(false);
    } catch {
      onToast("حدث خطأ أثناء حفظ العميل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="center-modal-layer" data-testid="customer-list-modal">
      <button
        type="button"
        className="center-modal-backdrop"
        onClick={() => {
          keyboard.hide();
          onClose();
        }}
        aria-label="إغلاق إدارة العملاء"
      />
      <section
        className="ref-dialog-card transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-list-title"
        style={{ maxWidth: "440px", padding: "10px", gap: "6px" }}
      >
        <div className="transfer-modal-head" style={{ marginBottom: "2px" }}>
          <h2 id="customer-list-title" style={{ fontSize: "15px" }}>إدارة العملاء</h2>
          <button
            type="button"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ background: "transparent", color: "var(--nasqo-blue)", fontWeight: "bold", fontSize: "14px" }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: "6px" }}>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <KeyboardInput
                placeholder="ابحث عن عميل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="erp-primary-btn"
              onClick={() => {
                keyboard.hide();
                setAddingNew((v) => !v);
              }}
              style={{ display: "flex", alignItems: "center", gap: "3px", padding: "6px 10px", fontSize: "11px", minHeight: "34px" }}
            >
              <PlusIcon />
              <span>{addingNew ? "إلغاء" : "جديد"}</span>
            </button>
          </div>

          {addingNew ? (
            <div className="erp-card" style={{ padding: "8px", background: "#f8fbff", display: "grid", gap: "6px" }}>
              <strong style={{ fontSize: "12px" }}>إضافة عميل جديد</strong>
              <KeyboardInput
                placeholder="اسم العميل"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <KeyboardInput
                inputMode="tel"
                placeholder="رقم الجوال"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <button
                type="button"
                className="erp-primary-btn full"
                disabled={saving}
                onClick={() => void handleCreateClient()}
                style={{ minHeight: "34px", fontSize: "11px" }}
              >
                {saving ? "جاري الحفظ..." : "حفظ العميل"}
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ maxHeight: "220px", overflowY: "auto", display: "grid", gap: "4px", margin: "4px 0" }}>
          {clients.map((client) => (
            <div
              key={client.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                <span
                  style={{
                    width: "28px",
                    height: "28px",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    background: "var(--nasqo-blue)",
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  <PersonIcon />
                </span>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: "12px", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {client.name}
                  </strong>
                  <small style={{ fontSize: "10px", color: "#666" }}>
                    {client.phone ? client.phone : "بدون جوال"}
                  </small>
                </div>
              </div>
              {onSelectCustomer ? (
                <button
                  type="button"
                  className="erp-primary-btn"
                  onClick={() => {
                    keyboard.hide();
                    onSelectCustomer(client);
                    onClose();
                  }}
                  style={{ padding: "4px 8px", fontSize: "10px", minHeight: "28px", flexShrink: 0 }}
                >
                  <CheckCircledIcon />
                  <span>اختيار</span>
                </button>
              ) : null}
            </div>
          ))}
          {clients.length === 0 ? (
            <p style={{ textAlign: "center", color: "#888", fontSize: "11px", padding: "10px" }}>
              لا توجد عملاء
            </p>
          ) : null}
        </div>

        <div className="ref-action-bar cols-1" style={{ marginTop: "4px" }}>
          <button
            type="button"
            className="ref-btn purple"
            onClick={() => {
              keyboard.hide();
              onClose();
            }}
            style={{ minHeight: "34px", fontSize: "11px" }}
          >
            إغلاق
          </button>
        </div>
      </section>
    </div>
  );
}
