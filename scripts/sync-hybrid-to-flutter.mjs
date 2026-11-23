import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distHybridDir = path.join(rootDir, "dist", "hybrid");
const flutterWebAssetsDir = path.join(rootDir, "flutter_app", "assets", "web");
const manifestPath = path.join(distHybridDir, "hybrid-manifest.json");

const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild || !fs.existsSync(manifestPath)) {
  console.log("[sync-flutter-hybrid] Building offline React hybrid bundle first...");
  execFileSync(process.execPath, [path.join(rootDir, "scripts", "build-hybrid.mjs")], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

if (!fs.existsSync(manifestPath)) {
  throw new Error("[sync-flutter-hybrid] Missing dist/hybrid/hybrid-manifest.json after build.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.bridgeChannel !== "NasqoHome") {
  throw new Error(
    `[sync-flutter-hybrid] Unexpected bridgeChannel "${manifest.bridgeChannel}"; expected "NasqoHome".`,
  );
}
if (manifest.mockHostStripped !== true) {
  throw new Error("[sync-flutter-hybrid] Refusing to sync bundle without mockHostStripped === true.");
}
if (manifest.offlineReady !== true || manifest.cspEnforced !== true) {
  throw new Error("[sync-flutter-hybrid] Refusing to sync bundle without offlineReady & cspEnforced.");
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("[sync-flutter-hybrid] Manifest contains no files.");
}

// Clean target directory completely so stale hashed chunks never linger inside APK assets.
fs.rmSync(flutterWebAssetsDir, { recursive: true, force: true });
fs.mkdirSync(flutterWebAssetsDir, { recursive: true });

let verifiedBytes = 0;
let copiedCount = 0;

for (const entry of manifest.files) {
  const relPath = String(entry.path || "").replace(/^\/+/, "");
  if (!relPath || relPath.includes("..")) {
    throw new Error(`[sync-flutter-hybrid] Unsafe manifest path: ${entry.path}`);
  }
  const srcFile = path.join(distHybridDir, relPath);
  const dstFile = path.join(flutterWebAssetsDir, relPath);

  if (!fs.existsSync(srcFile)) {
    throw new Error(`[sync-flutter-hybrid] Manifest file missing on disk: ${relPath}`);
  }

  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  const buf = fs.readFileSync(srcFile);
  const actualSha256 = crypto.createHash("sha256").update(buf).digest("hex");
  if (actualSha256 !== entry.sha256) {
    throw new Error(
      `[sync-flutter-hybrid] SHA-256 mismatch for ${relPath}: expected ${entry.sha256}, got ${actualSha256}`,
    );
  }

  fs.writeFileSync(dstFile, buf);
  verifiedBytes += buf.byteLength;
  copiedCount += 1;
}

// Copy manifest alongside assets so Flutter/CI can inspect bundle provenance.
fs.copyFileSync(manifestPath, path.join(flutterWebAssetsDir, "hybrid-manifest.json"));

// Final verification on destination index.html & absence of mockFlutter markers.
const syncedIndexHtml = fs.readFileSync(path.join(flutterWebAssetsDir, "index.html"), "utf8");
if (!syncedIndexHtml.includes("connect-src 'none'")) {
  throw new Error("[sync-flutter-hybrid] Destination index.html is missing strict offline CSP.");
}
if (/mockFlutter|installMockFlutterHost/i.test(syncedIndexHtml)) {
  throw new Error("[sync-flutter-hybrid] Forbidden mockFlutter marker detected in synced assets.");
}

console.log(
  `[sync-flutter-hybrid] SUCCESS: Synced & verified ${copiedCount} files (${(verifiedBytes / 1024).toFixed(1)} KB) -> flutter_app/assets/web/ (bridge=${manifest.bridgeChannel}, protocol=${manifest.protocolVersion})`,
);
