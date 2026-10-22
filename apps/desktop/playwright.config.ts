import { defineConfig } from "@playwright/test";

// Some shells (an agent's in T3 Code) set this, and Electron would then start as plain Node instead
// of Tavora. The config loads before the workers start, so they and every app they launch go without it.
delete process.env.ELECTRON_RUN_AS_NODE;

// Electron e2e tests. They need a display (use xvfb-run on Linux CI) and must
// run as a non-root user so Chromium's OS sandbox stays enabled.
export default defineConfig({
  testDir: "test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
});
