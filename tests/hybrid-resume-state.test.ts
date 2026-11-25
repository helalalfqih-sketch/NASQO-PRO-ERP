import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readUiState, writeUiState, removeUiState, readValidatedRoutes } from "../src/hybrid/resumeState";

let values: Map<string, string>;
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } } });
});
afterEach(() => {
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("fresh reads recover search, filters, scroll and draft identity without a memory cache", () => {
  const saved = { search: "synthetic supplier", filters: { currency: "YER", period: "all" }, scroll: 431,
    draft: { entryId: "synthetic-inv-1", status: "editing", quantity: "2" } };
  assert.equal(writeUiState("workspace-A", "supplier-state", saved), true);
  saved.draft.quantity = "999";
  const restored = readUiState<typeof saved | null>("workspace-A", "supplier-state", null);
  assert.equal(restored?.draft.quantity, "2");
  assert.equal(restored?.scroll, 431);
  assert.equal(readUiState("workspace-B", "supplier-state", null), null);
  assert.equal(readUiState("workspace-A", "other-screen", null), null);
});

test("a missing/deleted record truncates restoration before its dependent routes", () => {
  writeUiState("w", "flow-stack", ["dashboard", "accounts-purchases-all", "supplier-deleted", "daily-journal"]);
  const allowed = new Set(["dashboard", "accounts-purchases-all", "daily-journal"]);
  assert.deepEqual(readValidatedRoutes("w", (id) => allowed.has(id)), ["dashboard", "accounts-purchases-all"]);
  assert.deepEqual(readValidatedRoutes("other", () => true), []);
  writeUiState("w", "flow-stack", ["supplier-existing"]);
  assert.deepEqual(readValidatedRoutes("w", () => true), []);
});

test("corrupt/version-mismatched or cross-workspace envelopes fall back safely", () => {
  writeUiState("w", "slot", { query: "safe" });
  const key = [...values.keys()][0];
  for (const raw of ["{broken", "null", JSON.stringify({ version: 2, workspaceId: "w", slot: "slot", value: 1 }),
    JSON.stringify({ version: 1, workspaceId: "another", slot: "slot", value: 1 }),
    '{"version":1,"workspaceId":"w","slot":"slot","value":{"__proto__":{"unsafe":true}}}']) {
    values.set(key, raw);
    assert.equal(readUiState("w", "slot", "fallback"), "fallback");
  }
});

test("schema checks reject malformed UI fields and storage failure never claims success", () => {
  writeUiState("w", "scroll", "bad");
  assert.equal(readUiState("w", "scroll", 0, (v) => typeof v === "number" && v >= 0), 0);
  assert.equal(writeUiState("w", "huge", "x".repeat(512_001)), false);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.equal(writeUiState("w", "cycle", cycle), false);
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(writeUiState("w", "draft", { entryId: "synthetic" }), false);
});

test("discard removes only the selected UI draft, without touching records or other workspaces", () => {
  writeUiState("w", "invoice-draft", { entryId: "one" });
  writeUiState("other", "invoice-draft", { entryId: "two" });
  values.set("synthetic-ledger", "unchanged");
  assert.equal(removeUiState("w", "invoice-draft"), true);
  assert.equal(readUiState("w", "invoice-draft", null), null);
  assert.deepEqual(readUiState("other", "invoice-draft", null), { entryId: "two" });
  assert.equal(values.get("synthetic-ledger"), "unchanged");
});
