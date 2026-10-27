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
    // The Tavora window, and the layer on the Overlay page's canvas (src/main/overlay-canvas.ts).
    rollupOptions: { input: { index: fileURLToPath(new URL("src/renderer/index.html", import.meta.url)), layout: fileURLToPath(new URL("src/renderer/layout.html", import.meta.url)) } },
  },
});
