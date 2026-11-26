import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// No application HTTP server/database; Vite serves an isolated synthetic fixture.
export default defineConfig({
  testDir: ".",
  testMatch: /hybrid-(back-resume|viewport)\.spec\.ts/,
  workers: 1,
  timeout: 20_000,
  outputDir: "../deliverables/batch1/browser-artifacts",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 430, height: 900 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: "npx vite --config vite.hybrid.config.ts --host 127.0.0.1 --port 4179",
    url: "http://127.0.0.1:4179/tests/hybrid-back-fixture.html",
    reuseExistingServer: false,
  },
});
