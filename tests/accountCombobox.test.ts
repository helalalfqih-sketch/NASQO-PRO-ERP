import test from "node:test";
import assert from "node:assert/strict";
import {
  filterComboboxAccounts,
  formatAccountOptionMeta,
} from "../src/utils/accountCombobox";
import type { AccountRecord } from "../src/types";

function makeAccount(
  id: string,
  name: string,
  category: AccountRecord["category"],
  codeNumber: number,
  phone = "",
): AccountRecord {
  return {
    id,
    ownerId: "owner_1",
    name,
    category,
    codeNumber,
    phone,
    currency: "ريال",
    createdAtMs: 1,
  };
}

test("filterComboboxAccounts prioritizes preferred categories and ranks Arabic search queries", () => {
  const accounts: AccountRecord[] = [
    makeAccount("p1", "مؤسسة الأمل للمشتريات", "purchases", 1),
    makeAccount("c1", "اندكس ستور", "clients", 2, "777123456"),
    makeAccount("s1", "مبيعات النقدي", "sales", 3),
  ];

  // Sale invoice prefers sales & clients over purchases when query is empty
  const saleList = filterComboboxAccounts(accounts, "", {
    preferredCategories: ["sales", "clients", "shop"],
    maxVisible: 80,
  });
  assert.equal(saleList.totalMatches, 3);
  assert.equal(saleList.visibleOptions[0].id, "c1");
  assert.equal(saleList.visibleOptions[1].id, "s1");
  assert.equal(saleList.visibleOptions[2].id, "p1");

  // Arabic normalization & phone match
  const byName = filterComboboxAccounts(accounts, "اندكس");
  assert.equal(byName.totalMatches, 1);
  assert.equal(byName.visibleOptions[0].id, "c1");

  const byPhone = filterComboboxAccounts(accounts, "777123");
  assert.equal(byPhone.totalMatches, 1);
  assert.equal(byPhone.visibleOptions[0].id, "c1");
});

test("filterComboboxAccounts keeps selected account visible when truncated and expands with showAll", () => {
  const many: AccountRecord[] = Array.from({ length: 120 }, (_, i) =>
    makeAccount(`acc_${i + 1}`, `عميل رقم ${i + 1}`, "clients", i + 1),
  );

  const limited = filterComboboxAccounts(many, "", {
    selectedId: "acc_115",
    maxVisible: 20,
  });
  assert.equal(limited.totalMatches, 120);
  assert.equal(limited.visibleOptions.length, 20);
  assert.equal(limited.truncatedCount, 100);
  assert.equal(limited.visibleOptions[0].id, "acc_115");

  const expanded = filterComboboxAccounts(many, "", {
    selectedId: "acc_115",
    maxVisible: 20,
    showAll: true,
  });
  assert.equal(expanded.visibleOptions.length, 120);
  assert.equal(expanded.truncatedCount, 0);
});

test("formatAccountOptionMeta formats Arabic category, code number, and phone cleanly", () => {
  const acc = makeAccount("c1", "اندكس ستور", "clients", 14, "771000222");
  assert.equal(formatAccountOptionMeta(acc), "عملاء · #14 · 771000222");

  const noPhone = makeAccount("p1", "مورد عام", "purchases", 3);
  assert.equal(formatAccountOptionMeta(noPhone), "مشتريات · #3");
});
