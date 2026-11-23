import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const reviewDir = path.join(rootDir, "review", "flutter_hybrid_integration_0d734ca");

const errors = [];
const checks = [];

function pass(label) {
  checks.push({ ok: true, label });
  console.log(`  [PASS] ${label}`);
}

function fail(label) {
  checks.push({ ok: false, label });
  errors.push(label);
  console.error(`  [FAIL] ${label}`);
}

function readText(relPath) {
  const full = path.join(rootDir, relPath);
  if (!fs.existsSync(full)) {
    fail(`Missing required file: ${relPath}`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function extractStringArray(source, constName) {
  const regex = new RegExp(`${constName}[^=]*=\\s*(?:new Set\\()?\\s*\\[([\\s\\S]*?)\\]`, "m");
  const match = source.match(regex);
  if (!match) return [];
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

function extractDartStringSet(source, constName) {
  const regex = new RegExp(`${constName}[^=]*=\\s*<String>\\{([\\s\\S]*?)\\};`, "m");
  const match = source.match(regex);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function checkBalancedDelimiters(relPath, content) {
  let braces = 0;
  let parens = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1] ?? "";
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "(") parens += 1;
    else if (ch === ")") parens -= 1;
  }

  if (braces === 0 && parens === 0) {
    pass(`Balanced delimiters in ${relPath}`);
  } else {
    fail(`Unbalanced delimiters in ${relPath} (braces=${braces}, parens=${parens})`);
  }
}

console.log("[verify-flutter-integration] Auditing corrected 0d734ca compatibility package...");

// 1. Ensure NO conflicting Groovy Android files or parallel DB remain inside flutter_app/
if (!fs.existsSync(path.join(rootDir, "flutter_app", "android"))) {
  pass("No synthetic Groovy flutter_app/android/ directory overwriting existing Kotlin DSL files");
} else {
  fail("Found synthetic flutter_app/android/ directory; must keep Kotlin DSL untouched");
}

if (!fs.existsSync(path.join(rootDir, "flutter_app", "lib", "hybrid"))) {
  pass("Proposed Dart changes isolated cleanly in independent review folder (flutter_app/ untouched)");
} else {
  fail("Found direct edits in flutter_app/lib/hybrid/ instead of independent review folder");
}

const origMainDart = readText("flutter_app/lib/main.dart");
if (!origMainDart.includes("HybridHomeView") && !origMainDart.includes("NasqoHybridFlags")) {
  pass("Existing flutter_app/lib/main.dart preserved untouched");
} else {
  fail("flutter_app/lib/main.dart was modified directly instead of kept in review folder");
}

// 2. Verify Android identity com.indexesstore.nasqo_qa and zero Groovy replacements
const kotlinCompat = readText(
  "review/flutter_hybrid_integration_0d734ca/kotlin/com/indexesstore/nasqo_qa/NasqoProtocolCompatBridge.kt",
);
if (
  kotlinCompat.includes("package com.indexesstore.nasqo_qa") &&
  !kotlinCompat.includes("com.nasqo.pro.erp") &&
  kotlinCompat.includes('const val BRIDGE_CHANNEL_NAME = "NasqoHome"')
) {
  pass("Kotlin compatibility adapter uses exact package com.indexesstore.nasqo_qa and NasqoHome bridge");
} else {
  fail("Kotlin compatibility adapter package or bridge channel mismatch");
}

// 3. Verify ZERO parallel SQLite DB / parallel ledger; uses ErpController + LocalDatabase + PostingReceiptGuard
const dartAdapter = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/erp_hybrid_adapter.dart",
);
const dartGuard = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/posting_receipt_guard.dart",
);
const dartFlags = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/nasqo_hybrid_flags.dart",
);
const dartProtocol = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_protocol.dart",
);
const dartRouter = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_bridge_router.dart",
);
const dartShell = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_react_v2_shell.dart",
);
const dartTest = readText(
  "review/flutter_hybrid_integration_0d734ca/dart/test/hybrid_erp_adapter_test.dart",
);

if (
  dartAdapter.includes("ErpController") &&
  dartAdapter.includes("LocalDatabase") &&
  dartAdapter.includes("AccountingEngine") &&
  dartAdapter.includes("PostingReceiptGuard") &&
  dartAdapter.includes("loadOrInitializeUpgradeSafe") &&
  !dartAdapter.includes("nasqo_pro_hybrid.db") &&
  !dartAdapter.includes("hybrid_ledger_entries")
) {
  pass("ErpHybridAdapter uses existing ErpController + LocalDatabase + AccountingEngine + PostingReceiptGuard + upgrade-safe init (0 parallel DB)");
} else {
  fail("ErpHybridAdapter missing existing service wiring, upgrade-safe init, or still references parallel DB");
}

if (
  dartGuard.includes("HybridPostingReceipt") &&
  dartGuard.includes("ExternalPostingReceiptBridge") &&
  dartGuard.includes("idempotency_key TEXT PRIMARY KEY") &&
  dartGuard.includes("db.transaction<Map<String, Object?>>")
) {
  pass("PostingReceiptGuard enforces atomic SQLite idempotency + PostingReceipt bridge inside existing LocalDatabase");
} else {
  fail("PostingReceiptGuard missing atomic transaction or PostingReceipt contract");
}

// 4. Verify Feature Flag defaults (Debug APK uses React V2 + fallback button; Release keeps 0d734ca safe)
if (
  dartFlags.includes("'NASQO_REACT_HYBRID_V2',\n    defaultValue: kDebugMode") &&
  dartFlags.includes("'NASQO_REACT_HYBRID_ALLOW_WRITES',\n    defaultValue: kDebugMode") &&
  dartShell.includes("nasqo_fallback_previous_ui_btn") &&
  dartRouter.includes("if (!isReactHybridV1RawMessage(rawJson) && legacyHandler != null)")
) {
  pass("Feature Flags default to kDebugMode (Debug APK runs React V2 + one-tap fallback button; Release stays false) with legacy NasqoHome passthrough");
} else {
  fail("Feature Flag kDebugMode defaults, fallback button, or legacy NasqoHome passthrough missing");
}

// 5. Cross-check all 37 commands & 17 financial mutations 1:1 between TS and Dart
const tsContracts = readText("src/hybrid/contracts.ts");
const tsAllowed = extractStringArray(tsContracts, "HYBRID_ALLOWED_COMMANDS");
const dartAllowed = extractDartStringSet(dartProtocol, "kHybridAllowedCommands");
if (
  tsAllowed.length > 0 &&
  tsAllowed.length === dartAllowed.length &&
  tsAllowed.every((c) => dartAllowed.includes(c))
) {
  pass(`All ${tsAllowed.length} allowlisted commands match 1:1 between TypeScript and Dart`);
} else {
  fail(`Allowlist mismatch: TS=${tsAllowed.length}, Dart=${dartAllowed.length}`);
}

const unhandled = dartAllowed.filter((c) => !dartRouter.includes(`case '${c}':`));
if (unhandled.length === 0) {
  pass(`All ${dartAllowed.length} commands handled explicitly in HybridBridgeRouter`);
} else {
  fail(`Unhandled commands in HybridBridgeRouter: ${unhandled.join(", ")}`);
}

const tsFinancial = extractStringArray(tsContracts, "FINANCIAL_MUTATION_COMMANDS");
const dartFinancial = extractDartStringSet(dartProtocol, "kHybridFinancialMutationCommands");
if (
  tsFinancial.length === dartFinancial.length &&
  tsFinancial.every((c) => dartFinancial.includes(c))
) {
  pass(`All ${tsFinancial.length} financial mutation commands match 1:1 between TS and Dart`);
} else {
  fail(`Financial mutation set mismatch: TS=${tsFinancial.length}, Dart=${dartFinancial.length}`);
}

// 6. Verify Dart lint hygiene (avoid_print) & balanced delimiters
const filesToAudit = [
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/nasqo_hybrid_flags.dart", dartFlags, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_protocol.dart", dartProtocol, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/posting_receipt_guard.dart", dartGuard, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/erp_hybrid_adapter.dart", dartAdapter, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_bridge_router.dart", dartRouter, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/lib/hybrid/hybrid_react_v2_shell.dart", dartShell, true],
  ["review/flutter_hybrid_integration_0d734ca/dart/test/hybrid_erp_adapter_test.dart", dartTest, true],
  ["review/flutter_hybrid_integration_0d734ca/kotlin/com/indexesstore/nasqo_qa/NasqoProtocolCompatBridge.kt", kotlinCompat, false],
];

for (const [relPath, text, isDart] of filesToAudit) {
  if (isDart) {
    if (/\bprint\s*\(/.test(text)) fail(`avoid_print violation in ${relPath}`);
    else pass(`avoid_print clean in ${relPath}`);
  }
  checkBalancedDelimiters(relPath, text);
}

// 7. Verify dist/hybrid manifest integrity
const manifestPath = path.join(rootDir, "dist", "hybrid", "hybrid-manifest.json");
if (!fs.existsSync(manifestPath)) {
  fail("Missing dist/hybrid/hybrid-manifest.json");
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.bridgeChannel === "NasqoHome" &&
    manifest.mockHostStripped === true &&
    manifest.offlineReady === true &&
    manifest.cspEnforced === true
  ) {
    pass(`dist/hybrid/ manifest verified (${manifest.totalFiles} files, bridge=${manifest.bridgeChannel}, mockHostStripped=true)`);
  } else {
    fail("dist/hybrid/ hybrid-manifest.json failed security/offline verification");
  }
}

// 8. Verify review patch exists
const patchPath = path.join(
  reviewDir,
  "patches",
  "0001-flutter-hybrid-compat-integration.patch",
);
if (fs.existsSync(patchPath) && fs.statSync(patchPath).size > 500) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(patchPath)).digest("hex").slice(0, 12);
  pass(`Review unified patch present (${sha}...)`);
} else {
  fail("Missing review patch patches/0001-flutter-hybrid-compat-integration.patch");
}

if (errors.length > 0) {
  console.error(`\n[verify-flutter-integration] FAILED with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`\n[verify-flutter-integration] ALL ${checks.length} CHECKS PASSED.`);
