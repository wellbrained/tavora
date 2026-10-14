import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
  },
});
