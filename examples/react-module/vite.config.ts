import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
  },
});
