import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildFlutterBundlePayload, getFlutterFileName } from "../src/utils/flutterExport";

const EXPECTED_FLUTTER_FILES = [
  "pubspec.yaml",
  "analysis_options.yaml",
  "README.md",
  "lib/main.dart",
  "lib/models/erp_models.dart",
  "lib/services/accounting_engine.dart",
  "lib/services/local_database.dart",
  "lib/state/erp_controller.dart",
  "lib/screens/dashboard_screen.dart",
  "lib/screens/erp_hub_screen.dart",
  "lib/screens/pos_crm_screen.dart",
  "lib/screens/invoice_form_sheet.dart",
  "lib/screens/customer_list_sheet.dart",
  "lib/screens/finance_screen.dart",
  "lib/screens/hr_screen.dart",
  "lib/screens/procurement_screen.dart",
  "lib/screens/manufacturing_screen.dart",
  "test/accounting_engine_test.dart",
];

function hasBalancedBraces(source: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

test("all converted Flutter project files exist and Dart files have balanced braces", () => {
  const root = path.resolve(process.cwd(), "flutter_app");
  for (const rel of EXPECTED_FLUTTER_FILES) {
    const fullPath = path.join(root, rel);
    assert.equal(existsSync(fullPath), true, `Missing Flutter file: ${rel}`);
    const content = readFileSync(fullPath, "utf8");
    assert.ok(content.trim().length > 40, `Empty Flutter file: ${rel}`);
    if (rel.endsWith(".dart")) {
      assert.equal(hasBalancedBraces(content), true, `Unbalanced braces in ${rel}`);
    }
  }
});

test("buildFlutterBundlePayload and getFlutterFileName produce valid bundle metadata", () => {
  assert.equal(getFlutterFileName("lib/screens/invoice_form_sheet.dart"), "invoice_form_sheet.dart");
  const bundle = buildFlutterBundlePayload([
    { path: "pubspec.yaml", label: "pubspec.yaml", language: "yaml", content: "name: nasqo_pro_erp" },
    { path: "lib/main.dart", label: "main.dart", language: "dart", content: "void main() {}" },
  ]);
  assert.equal(bundle.projectName, "nasqo_pro_erp");
  assert.equal(bundle.fileCount, 2);
  assert.equal(bundle.files[1].path, "lib/main.dart");
});
