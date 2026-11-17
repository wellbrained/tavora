import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { buildFilterEngine } from "./filters.mjs";
import { writeLicences } from "./licences.mjs";
import { writeReleaseNotes } from "./release-notes.mjs";
import { rendererConfig, root, targets } from "./targets.mjs";

await rm(path.join(root, "out"), { recursive: true, force: true });
await Promise.all([...targets.map((options) => build(options)), buildFilterEngine()]);

// The host UI is Vue, built by Vite.
await viteBuild({ configFile: rendererConfig, logLevel: "warn" });

// The third-party notices of everything that ships (scripts/licences.mjs): fails the build for a package without an
// allowed licence. The app reads out/licences/licences.json; THIRD_PARTY_NOTICES.txt is copied next to the exe.
writeLicences();

// What is new in this version, for the update feed (scripts/release-notes.mjs).
await writeReleaseNotes(root);
