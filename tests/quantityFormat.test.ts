import test from "node:test";
import assert from "node:assert/strict";
import { formatQuantity } from "../src/utils/quantityFormat";

test("stock displays all three supported fractional digits without money rounding", () => {
  assert.equal(formatQuantity(35.125), "35.125");
  assert.equal(formatQuantity(0.001), "0.001");
  assert.equal(formatQuantity(-1.125), "-1.125");
  assert.equal(formatQuantity(35), "35");
});
