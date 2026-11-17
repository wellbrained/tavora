import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { buildFilterEngine } from "./filters.mjs";
import { assertBundled, writeLicences } from "./licences.mjs";
import { writeReleaseNotes } from "./release-notes.mjs";
import { rendererConfig, root, targets } from "./targets.mjs";

await rm(path.join(root, "out"), { recursive: true, force: true });
// metafile: every file that went into a bundle, for the licence check below.
const [main, ...preloads] = (await Promise.all([...targets.map((options) => build({ ...options, metafile: true })), buildFilterEngine()])).slice(0, targets.length);
const bundled = { "the main process": Object.keys(main.metafile.inputs).map((file) => path.resolve(root, file)) };
bundled["the preloads and the system-info worker"] = preloads.flatMap((result) => Object.keys(result.metafile.inputs).map((file) => path.resolve(root, file)));

// The host UI is Vue, built by Vite.
const rendererOutput = [await viteBuild({ configFile: rendererConfig, logLevel: "warn" })].flat();
bundled["the host UI"] = rendererOutput.flatMap((result) => ("output" in result ? result.output : [])).flatMap((file) => (file.type === "chunk" ? Object.keys(file.modules) : []));

// The third-party notices of everything that ships (scripts/licences.mjs): fails the build for a package without an
// allowed licence. The app reads out/licences/licences.json; THIRD_PARTY_NOTICES.txt is copied next to the exe.
// Then what the bundles really contain is checked against it: a package that got in some way the walk through
// package.json misses fails the build too.
const { entries } = writeLicences();
assertBundled(bundled, entries);

// What is new in this version, for the update feed (scripts/release-notes.mjs).
await writeReleaseNotes(root);
