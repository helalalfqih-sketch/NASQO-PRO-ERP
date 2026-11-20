import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveBrandLoaderLabel,
  runWithBrandLoader,
  subscribeBrandLoader,
} from "../src/utils/brandLoaderBus.ts";

test("runWithBrandLoader publishes label while running and clears on completion", async () => {
  const seen: (string | null)[] = [];
  const unsub = subscribeBrandLoader((label) => seen.push(label));
  assert.equal(getActiveBrandLoaderLabel(), null);

  const result = await runWithBrandLoader("جاري تصدير النسخة الاحتياطية...", async () => {
    assert.equal(getActiveBrandLoaderLabel(), "جاري تصدير النسخة الاحتياطية...");
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(getActiveBrandLoaderLabel(), null);
  assert.deepEqual(seen, [null, "جاري تصدير النسخة الاحتياطية...", null]);
  unsub();
});

test("runWithBrandLoader preserves outermost specific label during nested operations", async () => {
  const result = await runWithBrandLoader("جاري استعادة backup.db...", async () => {
    assert.equal(getActiveBrandLoaderLabel(), "جاري استعادة backup.db...");
    return runWithBrandLoader("جاري حفظ بيانات الحساب...", async () => {
      assert.equal(getActiveBrandLoaderLabel(), "جاري استعادة backup.db...");
      return "ok";
    });
  });

  assert.equal(result, "ok");
  assert.equal(getActiveBrandLoaderLabel(), null);
});

test("runWithBrandLoader always clears state even when task throws", async () => {
  await assert.rejects(
    () =>
      runWithBrandLoader("جاري فتح واتساب...", async () => {
        assert.equal(getActiveBrandLoaderLabel(), "جاري فتح واتساب...");
        throw new Error("boom");
      }),
    /boom/,
  );

  assert.equal(getActiveBrandLoaderLabel(), null);
});
