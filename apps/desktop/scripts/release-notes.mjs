// What is new in this version, for the update feed: `pnpm build` writes out/release-notes.md from the
// version's patch-notes entry, and electron-builder puts it into latest.yml (build.releaseInfo in
// package.json). An installed Tavora reads it from there, so its update marker can show the changes
// before the new version is downloaded (src/main/updates.ts).
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The notes of `version` as a Markdown list, one change per line; empty when patch-notes has no entry for it. */
export function releaseNotesFor(entries, version) {
  const entry = entries.find((candidate) => candidate.version === version);
  return entry ? entry.notes.map((note) => `- ${note.replace(/\s*\n\s*/g, " ")}`).join("\n") + "\n" : "";
}

/** Writes out/release-notes.md for the version in package.json. */
export async function writeReleaseNotes(root) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const { PATCH_NOTES } = await import(pathToFileURL(path.join(root, "src", "shared", "patch-notes.ts")).href);
  await writeFile(path.join(root, "out", "release-notes.md"), releaseNotesFor(PATCH_NOTES, version));
}
