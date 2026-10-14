import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as viteBuild } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "out");

await rm(out, { recursive: true, force: true });

// "source" resolves workspace packages to their TypeScript sources.
const common = { bundle: true, sourcemap: true, logLevel: "warning", absWorkingDir: root, conditions: ["source"] };

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "out/main/index.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    loader: { ".woff2": "base64" },
  }),
  // Sandboxed preloads can only require a few electron modules, so they are
  // bundled for the browser with everything inlined.
  ...["module", "host"].map((name) =>
    build({
      ...common,
      entryPoints: [`src/preload/${name}.ts`],
      outfile: `out/preload/${name}.cjs`,
      platform: "browser",
      format: "cjs",
      target: "chrome130",
      external: ["electron"],
    }),
  ),
]);

// The host UI is Vue, built by Vite.
await viteBuild({ configFile: path.join(root, "vite.renderer.config.ts"), logLevel: "warn" });
