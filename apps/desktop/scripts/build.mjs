import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
  build({
    ...common,
    entryPoints: ["src/renderer/host.ts"],
    outfile: "out/renderer/host.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
  }),
]);

await mkdir(path.join(out, "renderer"), { recursive: true });
for (const file of ["index.html", "host.css"]) {
  await cp(path.join(root, "src/renderer", file), path.join(out, "renderer", file));
}
