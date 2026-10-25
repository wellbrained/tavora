import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./src/${name}.html`, import.meta.url));

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
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
