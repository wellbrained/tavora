import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The trusted host UI. Served from tavora-host://app/ with a strict CSP, so
// everything is bundled locally: no inline scripts, no remote assets.
export default defineConfig({
  root: fileURLToPath(new URL("src/renderer", import.meta.url)),
  base: "./",
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("src/renderer", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("out/renderer", import.meta.url)),
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
    // Inlined assets would need data: URLs in more places of the CSP.
    assetsInlineLimit: 0,
  },
});
