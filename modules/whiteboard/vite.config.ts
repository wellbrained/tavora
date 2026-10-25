import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The languages Tavora has. Excalidraw's other translations are left out of the bundle. */
const KEPT_LANGUAGES = /\/(?:en|de-DE)(?:-[A-Z0-9]+)?\.js$/;

/** Fonts Excalidraw would load from the internet; they are copied next to the page instead. All but the Chinese ones (13 MB). */
const SKIPPED_FONT_FOLDERS = new Set(["Xiaolai"]);

/**
 * Keeps Excalidraw small and offline: other translations become empty, and the fonts it fetches by address
 * are copied into dist/fonts (main.ts points EXCALIDRAW_ASSET_PATH there).
 */
function trimExcalidraw(): Plugin {
  return {
    name: "trim-excalidraw",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0]!.replace(/\\/g, "/");
      if (/\/@excalidraw\/excalidraw\/dist\/prod\/locales\//.test(file) && !KEPT_LANGUAGES.test(file)) return "export default {};";
      return null;
    },
    closeBundle() {
      // The package's main file is dist/prod/index.js; its fonts are next to it.
      const from = path.join(path.dirname(require.resolve("@excalidraw/excalidraw")), "fonts");
      const to = path.join(here, "dist", "fonts");
      if (!existsSync(from)) throw new Error(`Excalidraw fonts not found at ${from}`);
      for (const folder of readdirSync(from)) {
        if (SKIPPED_FONT_FOLDERS.has(folder)) continue;
        mkdirSync(path.join(to, folder), { recursive: true });
        cpSync(path.join(from, folder), path.join(to, folder), { recursive: true });
      }
    },
  };
}

// Modules ship as self-contained bundles: relative asset paths, no remote code.
export default defineConfig({
  root: "src",
  base: "./",
  plugins: [vue(), react({ include: /\.tsx$/ }), tailwindcss(), trimExcalidraw()],
  resolve: {
    // The SDK from its source, like the other official modules, so a stale packages/sdk/dist never breaks the build.
    conditions: ["source", ...defaultClientConditions],
    dedupe: ["vue"],
    alias: { "@excalidraw/mermaid-to-excalidraw": path.join(here, "stubs", "mermaid.ts") },
  },
  // React must match the JSX the plugin writes: `pnpm dev` runs this build with NODE_ENV=development (its Vite
  // server sets it), and production React has no jsxDEV, so a fixed "production" left a blank panel there.
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV === "development" ? "development" : "production") },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "chrome130",
    modulePreload: { polyfill: false },
    // Loaded from disk, never over a network, so a big bundle is fine.
    chunkSizeWarningLimit: 4000,
  },
});
