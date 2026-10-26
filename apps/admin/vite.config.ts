import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The panel is served by the API under a strict content security policy: files only, nothing inline,
// so fonts are never turned into data: addresses. `pnpm --filter @tavora/admin dev` proxies the
// calls to a local API's admin port (ADMIN_PORT, 4011).
export default defineConfig({
  root: "src",
  base: "/",
  plugins: [vue(), tailwindcss()],
  resolve: { conditions: ["source"], dedupe: ["vue"] },
  server: { proxy: { "/api": "http://127.0.0.1:4011" } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1500,
  },
});
