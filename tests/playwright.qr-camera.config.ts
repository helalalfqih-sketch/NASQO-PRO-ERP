import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".", testMatch: "qr-camera.spec.ts", workers: 1, timeout: 10_000,
  outputDir: "../deliverables/drive-camera-fix/browser-artifacts",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4181", viewport: { width: 430, height: 900 }, screenshot: "only-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: "npx vite --config vite.hybrid.config.ts --host 127.0.0.1 --port 4181",
    url: "http://127.0.0.1:4181/tests/qr-camera-fixture.html", reuseExistingServer: false,
  },
});
