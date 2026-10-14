import { defineConfig } from "vite";

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
  },
});
