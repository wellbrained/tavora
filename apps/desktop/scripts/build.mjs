import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { buildFilterEngine } from "./filters.mjs";
import { rendererConfig, root, targets } from "./targets.mjs";

await rm(path.join(root, "out"), { recursive: true, force: true });
await Promise.all([...targets.map((options) => build(options)), buildFilterEngine()]);

// The host UI is Vue, built by Vite.
await viteBuild({ configFile: rendererConfig, logLevel: "warn" });
