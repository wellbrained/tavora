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

/** The longest note the update feed keeps in its plain form; electron-builder folds a line of about 8000 characters. */
export const MAX_FEED_NOTE = 4000;
// What js-yaml (electron-builder writes latest.yml with it) keeps as it is in a `|` block: printable characters only.
// A tab, a non-breaking space, U+0085, U+2028, U+2029, a byte-order mark or a control character makes it quote the whole
// text instead, and the update server takes the notes only as a plain block (deploy/server/tavora-update-signature).
const FEED_UNSAFE = /[^\x20-\x7e\xa1-\u2027\u202a-\ud7ff\ue000-\ufefe\uff00-\ufffd\u{10000}-\u{10ffff}]/u;

/** Why a patch note can't go into the update feed as it is, or null: it would stop the release when it is published. */
export function feedNoteProblem(note) {
  const line = `- ${String(note).replace(/\s*\n\s*/g, " ")}`;
  const start = line.length > 42 ? `${line.slice(2, 42)}…` : line.slice(2);
  const bad = FEED_UNSAFE.exec(line);
  if (bad) {
    const code = bad[0].codePointAt(0);
    const what = code === 0x09 ? "a tab" : code === 0xa0 ? "a non-breaking space" : `an invisible character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`;
    return `"${start}" has ${what}; write a plain space instead, or the update feed won't take this version`;
  }
  if (line.length > MAX_FEED_NOTE) return `"${start}" is ${line.length} characters long; keep a note under ${MAX_FEED_NOTE} so the update feed takes it`;
  return null;
}

/** Writes out/release-notes.md for the version in package.json. */
export async function writeReleaseNotes(root) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const { PATCH_NOTES } = await import(pathToFileURL(path.join(root, "src", "shared", "patch-notes.ts")).href);
  await writeFile(path.join(root, "out", "release-notes.md"), releaseNotesFor(PATCH_NOTES, version));
}
