import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const reviewDir = path.join(rootDir, "review", "flutter_hybrid_integration_0d734ca");
const patchOutPath = path.join(
  reviewDir,
  "patches",
  "0001-flutter-hybrid-compat-integration.patch",
);
const deliverablesDir = path.join(rootDir, "deliverables");
const archiveName = "nasqo-flutter-hybrid-integration-0d734ca-review.zip";
const archivePath = path.join(deliverablesDir, archiveName);
const archiveShaPath = `${archivePath}.sha256`;

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildAddedFileUnifiedDiff(targetRepoPath, absSourcePath) {
  const content = fs.readFileSync(absSourcePath, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const header = [
    `diff --git a/${targetRepoPath} b/${targetRepoPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${targetRepoPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ];
  return [...header, ...lines.map((l) => `+${l}`), ""].join("\n");
}

// 1. Generate clean reviewable unified patch mapping review files -> target paths on 0d734ca
fs.mkdirSync(path.dirname(patchOutPath), { recursive: true });

const patchEntries = [
  {
    target: "flutter_app/android/app/src/main/kotlin/com/indexesstore/nasqo_qa/NasqoProtocolCompatBridge.kt",
    source: path.join(reviewDir, "kotlin", "com", "indexesstore", "nasqo_qa", "NasqoProtocolCompatBridge.kt"),
  },
  {
    target: "flutter_app/lib/hybrid/nasqo_hybrid_flags.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "nasqo_hybrid_flags.dart"),
  },
  {
    target: "flutter_app/lib/hybrid/hybrid_protocol.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "hybrid_protocol.dart"),
  },
  {
    target: "flutter_app/lib/hybrid/posting_receipt_guard.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "posting_receipt_guard.dart"),
  },
  {
    target: "flutter_app/lib/hybrid/erp_hybrid_adapter.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "erp_hybrid_adapter.dart"),
  },
  {
    target: "flutter_app/lib/hybrid/hybrid_bridge_router.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "hybrid_bridge_router.dart"),
  },
  {
    target: "flutter_app/lib/hybrid/hybrid_react_v2_shell.dart",
    source: path.join(reviewDir, "dart", "lib", "hybrid", "hybrid_react_v2_shell.dart"),
  },
  {
    target: "flutter_app/test/hybrid_erp_adapter_test.dart",
    source: path.join(reviewDir, "dart", "test", "hybrid_erp_adapter_test.dart"),
  },
  {
    target: ".github/workflows/flutter-hybrid-ci.yml",
    source: path.join(reviewDir, "ci", "flutter-hybrid-ci.yml"),
  },
];

const patchHeader = [
  "# NASQO PRO Flutter Hybrid Offline Compatibility Patch (Target: integration/hybrid-seven-20261121 @ 0d734ca2ce1716de8f7005f8339f395fbd396da6)",
  "#",
  "# Guarantees:",
  "# - Preserves Android applicationId/package: com.indexesstore.nasqo_qa",
  "# - Does NOT modify or replace any *.gradle.kts, signingConfigs, updater, MainActivity.kt, or HybridHomeView.kt",
  "# - Does NOT overwrite flutter_app/lib/main.dart (manual 5-line wrap with HybridReactV2FeatureGate documented in README)",
  "# - Does NOT create a parallel SQLite DB or parallel ledger (operates directly on ErpController + LocalDatabase + PostingReceiptGuard)",
  "# - Feature Flags: kDebugMode default (Debug APK runs current React UI by default + one-tap fallback button; Release keeps 0d734ca default)",
  "# - Upgrade-safe initialization: clean empty DB on first launch, preserves 100% of existing rows across APK upgrades",
  "#",
  "# Manual non-destructive review hooks required in existing 0d734ca files (NOT overwritten by this patch):",
  "#   1. flutter_app/pubspec.yaml: ensure crypto: ^3.0.3, dev_dependencies sqflite_common_ffi, assets: assets/web/ & assets/web/assets/",
  "#   2. flutter_app/android/app/src/main/kotlin/com/indexesstore/nasqo_qa/HybridHomeView.kt: call NasqoProtocolCompatBridge.resolveEntryUrl(...) when creationParams['useReactHybridV2'] == true",
  "#   3. flutter_app/lib/main.dart (or existing hybrid screen entry): wrap existing hybrid view with HybridReactV2FeatureGate",
  "",
].join("\n");

const patchBody = patchEntries
  .map((e) => buildAddedFileUnifiedDiff(e.target, e.source))
  .join("\n");

fs.writeFileSync(patchOutPath, `${patchHeader}${patchBody}`, "utf8");
console.log(`[package-review] Generated unified patch -> ${path.relative(rootDir, patchOutPath)}`);

// 2. Stage clean bundle inside temporary staging dir, write SHA256SUMS & HANDOFF_MANIFEST, and create ZIP
const stageDir = path.join(rootDir, ".tmp_flutter_review_stage");
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) {
    throw new Error(`[package-review] Missing required source: ${src}`);
  }
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

copyRecursive(reviewDir, path.join(stageDir, "review", "flutter_hybrid_integration_0d734ca"));
copyRecursive(path.join(rootDir, "dist", "hybrid"), path.join(stageDir, "dist", "hybrid"));
copyRecursive(
  path.join(rootDir, "scripts", "sync-hybrid-to-flutter.mjs"),
  path.join(stageDir, "scripts", "sync-hybrid-to-flutter.mjs"),
);
copyRecursive(
  path.join(rootDir, "scripts", "verify-flutter-integration.mjs"),
  path.join(stageDir, "scripts", "verify-flutter-integration.mjs"),
);
if (fs.existsSync(path.join(rootDir, "qa", "hybrid_home", "home-verification-report.json"))) {
  copyRecursive(
    path.join(rootDir, "qa", "hybrid_home", "home-verification-report.json"),
    path.join(stageDir, "qa", "hybrid_home", "home-verification-report.json"),
  );
}
if (fs.existsSync(path.join(rootDir, "qa", "hybrid_offline"))) {
  copyRecursive(
    path.join(rootDir, "qa", "hybrid_offline"),
    path.join(stageDir, "qa", "hybrid_offline"),
  );
}
if (fs.existsSync(path.join(deliverablesDir, "logs"))) {
  copyRecursive(path.join(deliverablesDir, "logs"), path.join(stageDir, "logs"));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const stagedFiles = walk(stageDir).sort();
const checksumLines = [];
const manifestFiles = [];
for (const abs of stagedFiles) {
  const rel = path.relative(stageDir, abs).split(path.sep).join("/");
  const sha = sha256File(abs);
  const bytes = fs.statSync(abs).size;
  checksumLines.push(`${sha}  ${rel}`);
  manifestFiles.push({ path: rel, bytes, sha256: sha });
}

const handoffManifest = {
  package: archiveName,
  webReferenceSource: "https://nasqo-pro-erp-1.ai.studio/ (exact current AI Studio React source)",
  targetRepository: "helalalfqih-sketch/nasqo-pro-mobile",
  targetBranch: "integration/hybrid-seven-20261121",
  referenceCommitSha: "0d734ca2ce1716de8f7005f8339f395fbd396da6",
  androidApplicationId: "com.indexesstore.nasqo_qa",
  gradleDslPreserved: "kotlin-dsl (*.gradle.kts untouched)",
  databaseArchitecture: "Single existing LocalDatabase + ErpController + PostingReceiptGuard (clean empty fresh install, upgrade-safe preservation, zero parallel DB)",
  defaultUiBehavior: "Debug APK runs current React UI by default with one-tap fallback button to 0d734ca (kDebugMode); Release stays 0d734ca safe (false)",
  offlineGuarantee: "100% offline bundle (0 /api/* calls, 0 ai.studio calls, local SQLite SmartPro adapter, local Arabic expense categorizer, CSP connect-src 'none')",
  integrationStatus: "PENDING_REAL_ANDROID_AND_FLUTTER_SDK_VERIFICATION",
  generatedAtIso: new Date().toISOString(),
  totalFiles: manifestFiles.length + 2,
  files: manifestFiles,
};

fs.writeFileSync(
  path.join(stageDir, "HANDOFF_MANIFEST.json"),
  JSON.stringify(handoffManifest, null, 2) + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(stageDir, "SHA256SUMS.txt"),
  checksumLines.join("\n") + "\n",
  "utf8",
);

fs.mkdirSync(deliverablesDir, { recursive: true });
fs.rmSync(archivePath, { force: true });

// Use Python's built-in zipfile module for deterministic, portable ZIP archive creation
execFileSync(
  "python3",
  [
    "-c",
    `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, src).replace(os.sep, "/")
            zf.write(full, rel)
with zipfile.ZipFile(dst, "r") as zf:
    bad = zf.testzip()
    if bad is not None:
        raise RuntimeError(f"Corrupt zip entry: {bad}")
    print(f"[package-review] Verified ZIP integrity: {len(zf.namelist())} entries")
`,
    stageDir,
    archivePath,
  ],
  { stdio: "inherit" },
);

fs.rmSync(stageDir, { recursive: true, force: true });

const archiveSha = sha256File(archivePath);
const archiveSize = fs.statSync(archivePath).size;
fs.writeFileSync(archiveShaPath, `${archiveSha}  ${archiveName}\n`, "utf8");

console.log(
  `[package-review] SUCCESS: ${archiveName} (${(archiveSize / 1024).toFixed(1)} KB, SHA-256: ${archiveSha})`,
);
