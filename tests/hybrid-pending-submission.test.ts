import assert from "node:assert/strict";
import { afterEach, beforeEach, it, mock } from "node:test";
import { hybridBridge } from "../src/hybrid/bridge";
import { HYBRID_PROTOCOL_VERSION, type HybridRequestEnvelope } from "../src/hybrid/contracts";
import { createHybridHomeFixtureSnapshot } from "../src/hybrid/homeFixture";
import { PendingSubmissionStore, type ReceiptStorage } from "../src/hybrid/pendingSubmission";
import { applyHybridSnapshot, createLedgerEntry, LOCAL_WORKSPACE_UID, UncertainWriteError } from "../src/hybrid/serviceAdapter";
import type { LedgerEntryRecord } from "../src/types";

class MemoryStorage implements ReceiptStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

let storage: MemoryStorage;
const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    // Avoid the purely cosmetic minimum duration in this synthetic test.
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
  };
  const snapshot = createHybridHomeFixtureSnapshot();
  snapshot.ledger = [];
  applyHybridSnapshot(snapshot);
});

afterEach(() => {
  mock.restoreAll();
  hybridBridge.resetForTesting();
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

function reply(req: HybridRequestEnvelope, data: unknown) {
  hybridBridge.handleInbound({
    protocolVersion: HYBRID_PROTOCOL_VERSION,
    kind: "response", requestId: req.requestId, ok: true, data,
  });
}

it("a recreated store retains a pending ID without storing financial payload", () => {
  new PendingSubmissionStore(storage).mark("workspace_one", "invoice_one");
  const recreated = new PendingSubmissionStore(storage);
  assert.equal(recreated.has("workspace_one", "invoice_one"), true);
  assert.equal(recreated.has("workspace_two", "invoice_one"), false);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]), {
    version: 1, workspaceId: "workspace_one", documentId: "invoice_one",
  });
  recreated.confirm("workspace_one", "invoice_one");
  assert.equal(recreated.has("workspace_one", "invoice_one"), false);
});

it("lost acknowledgement, recreated bridge and explicit Save recover by reads only", async () => {
  const snapshot = createHybridHomeFixtureSnapshot();
  snapshot.ledger = [];
  const document = {
    ...createHybridHomeFixtureSnapshot().ledger[0],
    id: "synthetic_lost_ack_invoice", amount: 100, lines: [],
  } as LedgerEntryRecord;
  let posts = 0;
  let journals = 0;
  let stockMovements = 0;
  let reads = 0;
  const transport = {
    postMessage(raw: string) {
      const req = JSON.parse(raw) as HybridRequestEnvelope;
      if (req.action === "createLedgerEntry") {
        assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), true);
        posts += 1;
        journals += 1;
        stockMovements += 1;
        snapshot.ledger.push(document);
        // SQLite committed, but this response is deliberately lost.
      } else if (req.action === "getSnapshot") {
        reads += 1;
        queueMicrotask(() => reply(req, snapshot));
      }
    },
  };
  hybridBridge.setTransportForTesting(transport);
  const invoke = hybridBridge.invoke.bind(hybridBridge);
  mock.method(hybridBridge, "invoke", (action, payload, options) =>
    invoke(action, payload, { ...options, timeoutMs: 10 }));
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, document), UncertainWriteError);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), true);

  // Lose bridge RAM and cached UI data, preserving only the durable store and
  // the synthetic database. Startup itself must not replay the pending save.
  hybridBridge.resetForTesting();
  hybridBridge.setTransportForTesting(transport);
  const stale = createHybridHomeFixtureSnapshot();
  stale.ledger = [];
  applyHybridSnapshot(stale);
  assert.equal(posts, 1);
  const recovered = await createLedgerEntry(LOCAL_WORKSPACE_UID, document);
  assert.equal(recovered, document.id);
  assert.equal(reads, 1);
  assert.equal(posts, 1);
  assert.equal(journals, 1);
  assert.equal(stockMovements, 1);
  assert.equal(snapshot.ledger.length, 1);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), false);
  // Closing a stale draft after recovery cannot create another document.
  assert.equal(await createLedgerEntry(LOCAL_WORKSPACE_UID, document), document.id);
  assert.equal(posts, 1);
});

it("an absent receipt after timeout blocks resending but not an unrelated document", async () => {
  const pending = { id: "synthetic_missing", accountId: "account_one", accountName: "Synthetic" };
  new PendingSubmissionStore(storage).mark(LOCAL_WORKSPACE_UID, pending.id);
  const snapshot = createHybridHomeFixtureSnapshot();
  snapshot.ledger = [];
  const actions: string[] = [];
  hybridBridge.setTransportForTesting({
    postMessage(raw) {
      const req = JSON.parse(raw) as HybridRequestEnvelope;
      actions.push(req.action);
      if (req.action === "getSnapshot") queueMicrotask(() => reply(req, snapshot));
      else if (req.action === "createLedgerEntry") {
        const payload = (req.payload as { payload: LedgerEntryRecord }).payload;
        queueMicrotask(() => reply(req, { entry: { ...payload, id: payload.id } }));
      }
    },
  });
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, pending), (err: unknown) =>
    err instanceof UncertainWriteError && err.verificationStatus === "synced");
  assert.deepEqual(actions, ["getSnapshot"]);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, pending.id), true);
  await createLedgerEntry(LOCAL_WORKSPACE_UID, { ...pending, id: "synthetic_unrelated" });
  assert.deepEqual(actions, ["getSnapshot", "createLedgerEntry"]);
});

it("storage quota denial prevents sending a financial request", async () => {
  storage.setItem = () => { throw new Error("quota"); };
  let posts = 0;
  hybridBridge.setTransportForTesting({ postMessage() { posts += 1; } });
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, {
    id: "synthetic_storage_denied", accountId: "account_one", accountName: "Synthetic",
  }), UncertainWriteError);
  assert.equal(posts, 0);
});

it("a different workspace cannot confirm a saved document with the same ID", async () => {
  const document = { id: "synthetic_workspace_collision", accountId: "account_one", accountName: "Synthetic" };
  new PendingSubmissionStore(storage).mark(LOCAL_WORKSPACE_UID, document.id);
  const foreign = createHybridHomeFixtureSnapshot();
  foreign.workspaceId = "different_workspace";
  foreign.workspace!.id = "different_workspace";
  foreign.ledger = [{ ...foreign.ledger[0], id: document.id }];
  const actions: string[] = [];
  hybridBridge.setTransportForTesting({ postMessage(raw) {
    const req = JSON.parse(raw) as HybridRequestEnvelope;
    actions.push(req.action);
    queueMicrotask(() => reply(req, foreign));
  } });
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, document), UncertainWriteError);
  assert.deepEqual(actions, ["getSnapshot"]);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), true);
});

it("a malformed success acknowledgement preserves the pending marker", async () => {
  const document = { id: "synthetic_bad_receipt", accountId: "account_one", accountName: "Synthetic" };
  hybridBridge.setTransportForTesting({ postMessage(raw) {
    const req = JSON.parse(raw) as HybridRequestEnvelope;
    queueMicrotask(() => reply(req, { entry: { id: "unexpected_document" } }));
  } });
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, document), UncertainWriteError);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), true);
});

it("acknowledged validation rejection permits correcting the same draft", async () => {
  const document = { id: "synthetic_invalid", accountId: "account_one", accountName: "Synthetic" };
  hybridBridge.setTransportForTesting({
    postMessage(raw) {
      const req = JSON.parse(raw) as HybridRequestEnvelope;
      queueMicrotask(() => hybridBridge.handleInbound({
        protocolVersion: HYBRID_PROTOCOL_VERSION, kind: "response", requestId: req.requestId,
        ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid synthetic amount" },
      }));
    },
  });
  await assert.rejects(createLedgerEntry(LOCAL_WORKSPACE_UID, document), /Invalid synthetic amount/);
  assert.equal(new PendingSubmissionStore(storage).has(LOCAL_WORKSPACE_UID, document.id), false);
});
