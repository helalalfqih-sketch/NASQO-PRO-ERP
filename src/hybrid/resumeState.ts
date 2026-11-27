import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// UI recovery only. This store must never contain bridge requests or replay writes.
// Android's app-private WebView DOM storage survives both WebView and process death.
const PREFIX = "nasqo-ui-resume-v1:";
const MAX_BYTES = 512_000;
const MAX_DEPTH = 16;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Envelope = { version: 1; workspaceId: string; slot: string; value: unknown };

function storage(): StoragePort | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

function key(workspaceId: string, slot: string): string {
  return `${PREFIX}${encodeURIComponent(workspaceId)}:${encodeURIComponent(slot)}`;
}

function validName(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_BYTES;
  if (Array.isArray(value)) return value.length <= 5_000 && value.every((entry) => safeJson(entry, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([name, entry]) =>
    !["__proto__", "constructor", "prototype"].includes(name) && safeJson(entry, depth + 1));
}

export function readUiState<T>(
  workspaceId: string,
  slot: string,
  fallback: T,
  validate?: (value: unknown) => boolean,
): T {
  if (!validName(workspaceId) || !validName(slot)) return fallback;
  try {
    const raw = storage()?.getItem(key(workspaceId, slot));
    if (!raw || raw.length > MAX_BYTES) return fallback;
    const envelope = JSON.parse(raw) as Envelope;
    if (!envelope || envelope.version !== 1 || envelope.workspaceId !== workspaceId || envelope.slot !== slot ||
        !safeJson(envelope.value) || (validate && !validate(envelope.value))) return fallback;
    return envelope.value as T;
  } catch { return fallback; }
}

/** A false return is a real persistence failure: callers must not claim a draft was saved. */
export function writeUiState(workspaceId: string, slot: string, value: unknown): boolean {
  if (!validName(workspaceId) || !validName(slot)) return false;
  try {
    // JSON serialization strips optional undefined object properties, but rejects cycles.
    const raw = JSON.stringify({ version: 1, workspaceId, slot, value } satisfies Envelope);
    if (raw.length > MAX_BYTES) return false;
    const normalized = JSON.parse(raw) as Envelope;
    if (!safeJson(normalized.value)) return false;
    const target = storage();
    if (!target) return false;
    target.setItem(key(workspaceId, slot), raw);
    return target.getItem(key(workspaceId, slot)) === raw;
  } catch { return false; }
}

export function removeUiState(workspaceId: string, slot: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.removeItem(key(workspaceId, slot));
    return true;
  } catch { return false; }
}

/** Restore only a contiguous stack whose records have been checked against a fresh workspace. */
export function readValidatedRoutes(workspaceId: string, resolve: (id: string) => boolean): string[] {
  const saved = readUiState<unknown>(workspaceId, "flow-stack", []);
  if (!Array.isArray(saved) || saved[0] !== "dashboard" || saved.length > 24) return [];
  const result: string[] = [];
  for (const id of saved) {
    if (typeof id !== "string" || id.length > 256 || result.includes(id) || !resolve(id)) break;
    result.push(id);
  }
  return result;
}

/** Local state with immediate committed snapshots; lifecycle hooks are an additional flush, not the sole save. */
export function usePersistentUiState<T>(
  workspaceId: string,
  slot: string,
  initial: T | (() => T),
  enabled = true,
  validate?: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(initial);
  const makeInitial = () => typeof initialRef.current === "function"
    ? (initialRef.current as () => T)() : initialRef.current;
  const [state, setState] = useState<T>(() => enabled
    ? readUiState(workspaceId, slot, makeInitial(), validate) : makeInitial());
  const latest = useRef(state);
  const scope = useRef({ workspaceId, slot, enabled });
  useLayoutEffect(() => {
    const prior = scope.current;
    scope.current = { workspaceId, slot, enabled };
    if (prior.workspaceId !== workspaceId || prior.slot !== slot || prior.enabled !== enabled) {
      const next = enabled ? readUiState(workspaceId, slot, makeInitial(), validate) : makeInitial();
      latest.current = next;
      setState(next);
      return;
    }
    latest.current = state;
    if (enabled) writeUiState(workspaceId, slot, state);
  }, [workspaceId, slot, enabled, state]);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const flush = () => writeUiState(workspaceId, slot, latest.current);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("nasqo:checkpoint", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("nasqo:checkpoint", flush);
    };
  }, [workspaceId, slot, enabled]);
  return [state, setState];
}
