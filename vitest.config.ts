import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Lets a test mount a kit component (*.vue); put `// @vitest-environment jsdom` on top of that test file.
  // The app's public files ("/brand/...", served as they are in the app) are empty modules here.
  plugins: [
    vue(),
    {
      name: "public-files",
      enforce: "pre",
      resolveId: (id) => (id.startsWith("/brand/") ? "virtual:public-file" : undefined),
      load: (id) => (id === "virtual:public-file" ? "export default ''" : undefined),
    },
  ],
  // Workspace packages export their TypeScript sources under "source", so
  // tests never depend on a stale build. Tests run in Node, which resolves
  // through the ssr settings, so the condition is set there too.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    // reka-ui (mounted by the kit component tests) pulls in a package whose "source" export is TypeScript; let vite
    // compile those instead of Node loading them as they are.
    server: { deps: { inline: ["reka-ui", /@internationalized/] } },
    // Every run gets its own temp folder, removed when the run ends (scripts/test-temp.ts).
    // No real disk flush in tests (scripts/vitest-no-fsync.ts).
    setupFiles: ["scripts/vitest-no-fsync.ts"],
    globalSetup: ["scripts/vitest-global-setup.ts"],
    // Windows CI runners are several times slower at files and processes than Linux ones: the default 5 s made sound
    // tests time out there only (unit (windows) in ci.yml). Locally and on Linux the default stays.
    ...(process.env.CI && process.platform === "win32" ? { testTimeout: 20_000, hookTimeout: 20_000 } : {}),
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/scripts/**/*.test.ts", "modules/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
