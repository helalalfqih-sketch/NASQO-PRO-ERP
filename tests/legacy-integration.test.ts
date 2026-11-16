import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { LegacyDatabaseAdapter } from "../src/legacy/adapter";
import {
  assertBalanced,
  billTypeEvidence,
  composeInvoice,
  documentContext,
  findDuplicates,
  planVoucherPosting,
  reviewMoves,
  suggestedRoleMapping,
  summarizeReview,
} from "../src/legacy/analysis";
import { buildLedgerEntries, buildMasterData, diffMasterAgainstLive } from "../src/legacy/live";
import {
  archiveBatchId,
  countTable,
  getSource,
  importArchive,
  openCenterDb,
  putSource,
  rollbackBatch,
  rowsByFk,
  getRow,
} from "../src/legacy/store";
import { exportFullBackupBundle, verifyAndStageFullBackupRestore } from "../src/legacy/backup";

const SQLITE_PATH = "backup_2026.11.08_03.49.26.back";

test("Section 11: Full SQLite integration, multi-line invoices, balanced posting guard, IndexedDB persistence, backup & SHA-256 verification", async () => {
  const originalBytes = new Uint8Array(fs.readFileSync(SQLITE_PATH));
  const expectedSha = crypto.createHash("sha256").update(originalBytes).digest("hex");

  // 1. Open original SQLite database
  const adapter = await LegacyDatabaseAdapter.open(originalBytes, "nasqo_exact_original.sqlite");
  const schema = adapter.schema();
  const tables = adapter.loadAll();
  const relations = adapter.discoverRelations(tables, schema);
  adapter.close();

  // 2 & 3. Verify 22 tables & 26,001 rows
  assert.equal(schema.integrity, "ok");
  assert.equal(schema.tableCount, 22);
  assert.equal(schema.totalRows, 26001);
  assert.equal(tables.customers.length, 125);
  assert.equal(tables.products.length, 1402);
  assert.equal(tables.stores.length, 5);
  assert.equal(tables.input_move.length, 8703);
  assert.equal(tables.bill_details.length, 13536);
  assert.ok(relations.some((r) => r.child === "bill_details" && r.parent === "products"));

  // Evidence & roles
  const evidence = billTypeEvidence(tables);
  const roles = suggestedRoleMapping(evidence);
  assert.ok(evidence.length >= 7);

  // 4, 5 & 6. Open a multi-line historical invoice with product names & customer name
  const moveWithMultiLines = tables.input_move.find((m) => {
    const count = tables.bill_details.filter((d) => String(d.bill_id) === String(m.id)).length;
    return count >= 2;
  });
  assert.ok(moveWithMultiLines, "Expected at least one multi-line invoice in original DB");

  const pricedLines = tables.bill_details.filter((d) => String(d.bill_id) === String(moveWithMultiLines.id));
  const ctx = documentContext(tables, roles, evidence);
  const invoice = composeInvoice(moveWithMultiLines, "input_move", pricedLines, [], ctx);
  assert.ok(invoice.lines.length >= 2);
  assert.ok(invoice.personName.length > 0, "Customer name must be resolved");
  assert.ok(invoice.lines.every((l) => l.productName.length > 0), "Product names on invoice lines must be resolved");
  assert.equal(invoice.postingStatus, "historical_unposted");

  // 7 & 8. Conflicting financial fields & unbalanced voucher posting rejection
  const { reviews } = reviewMoves(tables);
  const revSummary = summarizeReview(reviews);
  assert.equal(revSummary.byReason.invoice_needs_counter_account, 5312);
  assert.equal(revSummary.byReason.both_sides_zero, 6);
  assert.equal(revSummary.byReason.unregistered_currency, 1);
  assert.ok((revSummary.byReason.voucher_no_pair ?? 0) > 2900);

  // Policy must be explicitly chosen
  const noPolicyPlan = planVoucherPosting(tables, null, ["ريال"], null);
  assert.ok(noPolicyPlan.blockers.includes("policy_not_selected"));

  // Unbalanced group (ref=20260106075808523) is rejected
  const plan = planVoucherPosting(tables, "dain_credit", ["ريال"], null);
  assert.equal(plan.eligibleGroups, 6);
  assert.equal(plan.eligibleEntries, 12);
  assert.equal(plan.rejectedGroups, 2);

  assert.throws(() =>
    assertBalanced([
      {
        moveId: 1,
        accountLegacyId: 1,
        counterAccountLegacyId: 2,
        direction: "debit",
        amount: 500,
        currencyName: "ريال",
        date: "2026-01-01",
        details: "",
        documentNumber: "1",
        groupRef: "unbal",
      },
      {
        moveId: 2,
        accountLegacyId: 2,
        counterAccountLegacyId: 1,
        direction: "credit",
        amount: 400,
        currencyName: "ريال",
        date: "2026-01-01",
        details: "",
        documentNumber: "2",
        groupRef: "unbal",
      },
    ]),
  );

  // 9, 10, 11, 12, 13. IndexedDB storage, duplicate prevention, reload persistence, backup & SHA-256 match
  const idbFactory = new IDBFactory();
  const db1 = await openCenterDb("test_center_db", idbFactory);
  const srcRes1 = await putSource(db1, {
    sha256: expectedSha,
    fileName: "nasqo_exact_original.sqlite",
    size: originalBytes.byteLength,
    bytes: originalBytes,
    savedAt: new Date().toISOString(),
    integrity: "ok",
    tableCounts: Object.fromEntries(schema.tables.map((t) => [t.name, t.rowCount])),
    totalRows: schema.totalRows,
  });
  assert.equal(srcRes1.existed, false);

  // Duplicate source save prevented
  const srcRes2 = await putSource(db1, {
    sha256: expectedSha,
    fileName: "nasqo_exact_original.sqlite",
    size: originalBytes.byteLength,
    bytes: originalBytes,
    savedAt: new Date().toISOString(),
    integrity: "ok",
    tableCounts: Object.fromEntries(schema.tables.map((t) => [t.name, t.rowCount])),
    totalRows: schema.totalRows,
  });
  assert.equal(srcRes2.existed, true);

  // Atomic chunked archive import
  const imp1 = await importArchive(db1, expectedSha, tables, { chunkSize: 5000 });
  assert.equal(imp1.duplicate, false);
  assert.equal(imp1.batch.status, "complete");
  assert.equal(imp1.batch.total, 26001);

  // Re-import prevented
  const imp2 = await importArchive(db1, expectedSha, tables, { chunkSize: 5000 });
  assert.equal(imp2.duplicate, true);
  db1.close();

  // Simulate app reload: open a new DB connection & read invoice + source back
  const db2 = await openCenterDb("test_center_db", idbFactory);
  const bid = archiveBatchId(expectedSha);
  assert.equal(await countTable(db2, bid, "input_move"), 8703);
  assert.equal(await countTable(db2, bid, "bill_details"), 13536);

  const reloadedMove = await getRow(db2, bid, "input_move", Number(moveWithMultiLines.id));
  const reloadedLines = await rowsByFk(db2, bid, "bill_details", Number(moveWithMultiLines.id));
  assert.ok(reloadedMove);
  assert.equal(reloadedLines.length, pricedLines.length);

  const reloadedSrc = await getSource(db2, expectedSha);
  assert.ok(reloadedSrc);
  assert.equal(Buffer.compare(Buffer.from(originalBytes), Buffer.from(reloadedSrc.bytes)), 0);

  // Build master data & check diff against existing user data (existing user data untouched)
  const existingUserAccount = { id: "user_acc_1", name: "حساب مستخدم حالي" };
  const master = buildMasterData(tables, expectedSha, "local-erp-workspace", {});
  assert.equal(master.accounts.length, 125);
  assert.equal(master.warehouses.length, 5);
  assert.equal(master.inventory.length, 1402);
  assert.ok(master.inventory.every((i) => i.quantityUnverified === true));

  const diff1 = diffMasterAgainstLive(master, {
    accounts: [existingUserAccount],
    warehouses: [],
    inventory: [],
    ledger: [],
  });
  assert.equal(diff1.accounts.add, 125);
  assert.equal(diff1.accounts.alreadyPresent, 0);

  // Re-diff after migration confirms 0 new additions (no duplicates)
  const diff2 = diffMasterAgainstLive(master, {
    accounts: [existingUserAccount, ...master.accounts],
    warehouses: master.warehouses,
    inventory: master.inventory,
    ledger: [],
  });
  assert.equal(diff2.accounts.add, 0);
  assert.equal(diff2.accounts.alreadyPresent, 125);

  // Build balanced ledger entries
  const accMap = new Map(master.accounts.map((a) => [a.codeNumber, a.id]));
  const nameMap = new Map(master.accounts.map((a) => [a.codeNumber, a.name]));
  const eligibleDrafts = plan.groups.filter((g) => g.status === "eligible").flatMap((g) => g.drafts);
  const liveLedgerEntries = buildLedgerEntries(eligibleDrafts, expectedSha, "local-erp-workspace", accMap, nameMap);
  assert.equal(liveLedgerEntries.length, 12);

  // Full backup export + isolated restore + SHA-256 verification
  const bundle = await exportFullBackupBundle(
    db2,
    {
      workspace: null,
      accounts: [existingUserAccount as never, ...master.accounts],
      warehouses: master.warehouses,
      inventory: master.inventory,
      ledger: liveLedgerEntries,
    },
    expectedSha,
  );
  db2.close();

  const restoreResult = await verifyAndStageFullBackupRestore(bundle, "test_restore_staging_db", idbFactory);
  assert.equal(restoreResult.verification.valid, true);
  assert.equal(restoreResult.verification.bundleShaMatch, true);
  assert.equal(restoreResult.verification.sqliteShaMatch, true);
  assert.equal(restoreResult.verification.tableCountMatch, true);
  assert.equal(restoreResult.verification.rowCountMatch, true);
  assert.equal(restoreResult.verification.totalArchiveRows, 26001);

  // Verify duplicates report
  const dup = findDuplicates(tables);
  assert.equal(dup.customerNames.length, 0);
  assert.equal(dup.productBarcodes.length, 0);

  // Rollback archive batch check
  const db3 = await openCenterDb("test_center_db", idbFactory);
  const rb = await rollbackBatch(db3, bid);
  assert.equal(rb.removedRecords, 26001);
  assert.equal(await countTable(db3, bid, "input_move"), 0);
  db3.close();
});
