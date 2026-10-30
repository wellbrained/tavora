import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { moduleConfig } from "@tavora/pack/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * pdf.js reads these by address while it works, so they are copied next to the page (dist/pdfjs) instead of being
 * fetched from anywhere else: the character maps and standard fonts some PDFs rely on, and the plain-JavaScript
 * decoders used because the module does not use WebAssembly.
 */
function copyPdfjsData(): Plugin {
  return {
    name: "copy-pdfjs-data",
    closeBundle() {
      const root = path.dirname(path.dirname(require.resolve("pdfjs-dist/package.json")));
      const base = path.join(root, "pdfjs-dist");
      const to = path.join(here, "dist", "pdfjs");
      for (const folder of ["cmaps", "standard_fonts"]) {
        if (!existsSync(path.join(base, folder))) throw new Error(`pdfjs-dist/${folder} not found`);
        cpSync(path.join(base, folder), path.join(to, folder), { recursive: true });
      }
      mkdirSync(path.join(to, "wasm"), { recursive: true });
      for (const file of ["jbig2_nowasm_fallback.js", "openjpeg_nowasm_fallback.js"]) cpSync(path.join(base, "wasm", file), path.join(to, "wasm", file));
    },
  };
}

// Loaded from disk, never over a network, so one bundle is fine.
export default defineConfig(
  moduleConfig({ root: here, plugins: [vue(), tailwindcss(), copyPdfjsData()], notices: { "pdfjs-dist": "pdfjs-dist" }, chunkSizeWarningLimit: 2500 }),
);
