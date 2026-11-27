import type { ErpWorkspaceData } from "../erp";
import type {
  AccountRecord,
  InventoryItemRecord,
  LedgerEntryRecord,
  WarehouseRecord,
} from "../types";

export interface NasqoBackupPayload {
  name?: string;
  format?: string;
  version?: number;
  emptyBackup?: boolean;
  exportedAt?: string;
  workspace?: { companyName?: string; baseCurrency?: string; defaultCurrency?: string };
  currencies?: Record<string, unknown>[];
  accountGroups?: Record<string, unknown>[];
  cashboxes?: Record<string, unknown>[];
  warehouses?: Partial<WarehouseRecord>[];
  accounts?: Partial<AccountRecord>[];
  ledger?: Partial<LedgerEntryRecord>[];
  inventory?: Partial<InventoryItemRecord>[];
  stockTransfers?: Record<string, unknown>[];
  priceOffers?: Record<string, unknown>[];
  erpData?: Partial<ErpWorkspaceData>;
}

const KNOWN_BACKUP_FORMATS = new Set([
  "nasqo-unified-sqlite-export-v2",
  "nasqo-unified-sqlite-export-v1",
  "nasqo-pro-erp-backup",
]);

export function validateJsonBackupCandidate(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "ملف JSON يجب أن يمثل نسخة احتياطية كاملة من نظام نسقو برو وليس مصفوفة أو قيمة مفردة.";
  }
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    return "ملف JSON فارغ {} لا يطابق بنية نسخة نسقو برو الاحتياطية — لم يتم تعديل البيانات.";
  }
  if (obj.format === "nasqo-android-backup-v1") {
    return "هذه نسخة تشغيلية من تطبيق Android. استعدها من إعدادات النسخ الاحتياطي في التطبيق؛ استعادتها في نسخة الويب غير مدعومة بعد. لم تتغير البيانات.";
  }
  if (obj.format !== undefined) {
    if (typeof obj.format !== "string" || !KNOWN_BACKUP_FORMATS.has(obj.format)) {
      return `صيغة النسخة (${String(obj.format)}) غير مدعومة في نسقو برو.`;
    }
  }
  if (obj.version !== undefined) {
    if (typeof obj.version !== "number" || !Number.isInteger(obj.version) || obj.version < 1 || obj.version > 2) {
      return "إصدار ملف النسخة الاحتياطية غير مدعوم.";
    }
  }
  if (obj.emptyBackup !== undefined && typeof obj.emptyBackup !== "boolean") {
    return "علامة النسخة الفارغة (emptyBackup) غير صالحة.";
  }
  const hasKnownFormat = typeof obj.format === "string" && KNOWN_BACKUP_FORMATS.has(obj.format);
  if (obj.emptyBackup === true && !hasKnownFormat) {
    return "وسم النسخة الفارغة يتطلب توقيع صيغة نسقو برو المعتمد.";
  }

  for (const key of [
    "currencies",
    "accountGroups",
    "cashboxes",
    "warehouses",
    "accounts",
    "inventory",
    "ledger",
    "stockTransfers",
    "priceOffers",
  ]) {
    if (obj[key] !== undefined && !Array.isArray(obj[key])) {
      return `الحقل «${key}» في النسخة الاحتياطية غير صالح (يجب أن يكون مصفوفة).`;
    }
  }
  if (obj.workspace !== undefined && (!obj.workspace || typeof obj.workspace !== "object" || Array.isArray(obj.workspace))) {
    return "بيانات مساحة العمل (workspace) في النسخة غير صالحة.";
  }
  if (!hasKnownFormat) {
    const ws = obj.workspace as Record<string, unknown> | undefined;
    const hasCompany = Boolean(ws && typeof ws.companyName === "string" && ws.companyName.trim().length > 0);
    const hasCore = Array.isArray(obj.accounts) && Array.isArray(obj.warehouses) && (Array.isArray(obj.ledger) || Array.isArray(obj.inventory));
    if (!hasCompany || !hasCore) {
      return "ملف JSON لا يحمل علامة أو هيكل نسخة نسقو برو الاحتياطية المعتمدة.";
    }
  } else if (obj.emptyBackup !== true) {
    const hasAnyCollection =
      Array.isArray(obj.accounts) ||
      Array.isArray(obj.warehouses) ||
      Array.isArray(obj.inventory) ||
      Array.isArray(obj.ledger);
    if (!hasAnyCollection || !obj.workspace) {
      return "نسخة JSON ناقصة ولا تحتوي على الجداول الأساسية المطلوبة.";
    }
  }
  return null;
}

export type BackupInspectionResult =
  | { kind: "json"; fileName: string; payload: NasqoBackupPayload }
  | { kind: "invalid-json"; fileName: string; reason: string }
  | { kind: "sqlite"; fileName: string }
  | { kind: "sql"; fileName: string; sqlText: string }
  | { kind: "encrypted"; fileName: string }
  | { kind: "zip"; fileName: string }
  | { kind: "unknown"; fileName: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatNasqoBackupFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `backup_${y}.${m}.${d}_${hh}.${mm}.${ss}.back`;
}

export function buildLocalBackupDownloadName(rawName: string): string {
  const cleaned = String(rawName || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();
  const base = cleaned || formatNasqoBackupFilename();
  if (/\.(back|json)$/i.test(base)) return base;
  return `${base}.back`;
}

export function inspectBackupBytes(
  bytes: Uint8Array,
  fileName: string = "backup.back",
): BackupInspectionResult {
  if (bytes.length >= 15) {
    const header = String.fromCharCode(...bytes.slice(0, 15));
    if (header === "SQLite format 3") {
      return { kind: "sqlite", fileName };
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const jsonMatch = text.match(/\{[\s\S]*"(?:accounts|ledger|warehouses|inventory)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        if (!validateJsonBackupCandidate(parsed)) {
          return { kind: "json", fileName, payload: parsed as NasqoBackupPayload };
        }
      } catch {
        // Fall through to zip notice when compressed
      }
    }
    return { kind: "zip", fileName };
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
    if (decoded.startsWith("{") || decoded.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded) as unknown;
      } catch {
        return {
          kind: "invalid-json",
          fileName,
          reason: "تعذر تحليل ملف JSON: صياغة النص غير مكتملة أو معطوبة.",
        };
      }
      const validationError = validateJsonBackupCandidate(parsed);
      if (validationError) {
        return { kind: "invalid-json", fileName, reason: validationError };
      }
      return { kind: "json", fileName, payload: parsed as NasqoBackupPayload };
    }
    if (
      fileName.toLowerCase().endsWith(".sql") ||
      /\b(CREATE\s+TABLE|INSERT\s+INTO)\b/i.test(decoded.slice(0, 8000))
    ) {
      return { kind: "sql", fileName, sqlText: decoded };
    }
    if (
      fileName.toLowerCase().endsWith(".enc") ||
      (/^[A-Za-z0-9+/=]{64,}$/.test(decoded.replace(/\s+/g, "").slice(0, 256)) && !decoded.startsWith("{"))
    ) {
      return { kind: "encrypted", fileName };
    }
  } catch {
    // Non-JSON binary or malformed content
  }

  return { kind: "unknown", fileName };
}

export function extractBackupCollections(payload: NasqoBackupPayload) {
  const warehouses = Array.isArray(payload.warehouses) ? payload.warehouses : [];
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const ledger = Array.isArray(payload.ledger) ? payload.ledger : [];
  const inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  const erpData =
    payload.erpData && typeof payload.erpData === "object" ? payload.erpData : undefined;

  return {
    warehouses,
    accounts,
    ledger,
    inventory,
    erpData,
    totalRecords:
      warehouses.length + accounts.length + ledger.length + inventory.length,
  };
}
