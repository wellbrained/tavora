// What esbuild builds for the main process and the preloads. Shared by
// build.mjs (one-off builds) and dev.mjs (watch mode).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const rendererConfig = path.join(root, "vite.renderer.config.ts");

// "source" resolves workspace packages to their TypeScript sources.
const common = { bundle: true, sourcemap: true, logLevel: "warning", absWorkingDir: root, conditions: ["source"] };

export const targets = [
  {
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "out/main/index.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    // The module font is embedded in main (src/main/module-fonts.ts).
    loader: { ".woff2": "base64" },
  },
  // Sandboxed preloads can only require a few electron modules, so they are
  // bundled for the browser with everything inlined.
  ...["module", "host", "tooltip"].map((name) => ({
    ...common,
    entryPoints: [`src/preload/${name}.ts`],
    outfile: `out/preload/${name}.cjs`,
    platform: "browser",
    format: "cjs",
    target: "chrome130",
    external: ["electron"],
  })),
];
