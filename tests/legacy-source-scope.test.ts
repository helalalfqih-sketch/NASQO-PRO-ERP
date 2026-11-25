import test from "node:test";
import assert from "node:assert/strict";
import { legacyCopySourceMatches, legacyCopySourceSha } from "../src/utils/legacyRecordDraft";

test("an archive copy stays bound to its source even when replacement reuses all record IDs", () => {
  const a = "a".repeat(64), b = "b".repeat(64);
  const draft = { entryId: `legacy-copy-${a}-offers-1`, sourceSha: a };
  // Both workspaces can legitimately contain legacy-acc-1 and legacy-prod-1.
  assert.equal(legacyCopySourceSha(draft.entryId), a);
  assert.equal(legacyCopySourceMatches(draft, a), true);
  assert.equal(legacyCopySourceMatches(draft, b), false);
  assert.equal(legacyCopySourceMatches(draft, undefined), false);
  assert.equal(legacyCopySourceMatches(draft, a), true);
});

test("missing, truncated or inconsistent provenance cannot bypass archive-copy scope", () => {
  const a = "a".repeat(64), b = "b".repeat(64);
  assert.equal(legacyCopySourceMatches({ entryId: `legacy-copy-${a}-trash-1` }, a), false);
  assert.equal(legacyCopySourceMatches({ entryId: `legacy-copy-${a}-trash-1`, sourceSha: b }, b), false);
  assert.equal(legacyCopySourceMatches({ entryId: `legacy-copy-${a.slice(0, 16)}-offers-1`, sourceSha: a }, a), false);
  assert.equal(legacyCopySourceMatches({ entryId: "ordinary-local-draft" }, undefined), true);
});
