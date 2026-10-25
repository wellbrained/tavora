import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages export their TypeScript sources under "source", so
  // tests never depend on a stale build. Tests run in Node, which resolves
  // through the ssr settings, so the condition is set there too.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    // Every run gets its own temp folder, removed when the run ends (scripts/test-temp.ts).
    globalSetup: ["scripts/vitest-global-setup.ts"],
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/scripts/**/*.test.ts", "modules/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
