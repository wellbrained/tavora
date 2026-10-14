import { defineConfig } from "@playwright/test";

// Electron e2e tests. They need a display (use xvfb-run on Linux CI) and must
// run as a non-root user so Chromium's OS sandbox stays enabled.
export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
});
