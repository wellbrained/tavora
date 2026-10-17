import { resolve } from "node:path";
import { defineConfig } from "vite";

// Modules ship as self-contained bundles: relative asset paths, no remote code.
// Two pages: index.html serves the Overview and Inventory panel types,
// planner.html the Build planner (see tavora.module.json).
export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, "src/index.html"), planner: resolve(import.meta.dirname, "src/planner.html") },
    },
  },
});
