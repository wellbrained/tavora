import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages export their TypeScript sources under "source", so
  // tests never depend on a stale build.
  resolve: { conditions: ["source"] },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
