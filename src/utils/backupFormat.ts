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
  exportedAt?: string;
  workspace?: { companyName?: string; baseCurrency?: string };
  warehouses?: Partial<WarehouseRecord>[];
  accounts?: Partial<AccountRecord>[];
  ledger?: Partial<LedgerEntryRecord>[];
  inventory?: Partial<InventoryItemRecord>[];
  erpData?: Partial<ErpWorkspaceData>;
}

export type BackupInspectionResult =
  | { kind: "json"; fileName: string; payload: NasqoBackupPayload }
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
        const parsed = JSON.parse(jsonMatch[0]) as NasqoBackupPayload;
        if (parsed && typeof parsed === "object") {
          return { kind: "json", fileName, payload: parsed };
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
      const parsed = JSON.parse(decoded) as unknown;
      if (Array.isArray(parsed)) {
        return {
          kind: "json",
          fileName,
          payload: { accounts: parsed as Partial<AccountRecord>[] },
        };
      }
      if (parsed && typeof parsed === "object") {
        return { kind: "json", fileName, payload: parsed as NasqoBackupPayload };
      }
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
