import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
  // Extracted icons land in public/icons, outside git.
  publicDir: "../public",
  plugins: [vue(), tailwindcss()],
  resolve: { conditions: ["source"], dedupe: ["vue"] },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
    // Loaded from disk, never over a network, so one bundle is fine.
    chunkSizeWarningLimit: 1500,
  },
});
