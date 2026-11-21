// `pnpm release:fold`: folds the patch-notes entries since the last release into the newest one, so users see one
// entry per release (decided 2026-10-31, CoreHub #420). It writes a draft: the newest entry's version, date and
// title, every note of the folded entries (newest first), every pull request and every tag. The wording still gets
// a pass by hand or by an agent before the pull request; the checklist it prints says what to look at.
//
// `pnpm release` runs from a clean main, and main only takes pull requests, so the fold is its own pull request,
// merged before the release starts. On main this makes the branch release/notes-<version> first.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareVersions, lastReleased } from "./release-guards.mjs";

/** The entries newer than `previous` (all of them when there is no release yet); entries are newest first. */
export function unreleased(entries, previous) {
  return entries.filter((entry) => previous === null || compareVersions(entry.version, previous) > 0);
}

/** One entry from `entries` (newest first): the newest's version, date and title, everything else of all of them. */
export function foldEntries(entries) {
  const [newest] = entries;
  const prs = new Map();
  for (const entry of entries) for (const pr of entry.prs ?? []) if (!prs.has(pr.number)) prs.set(pr.number, pr);
  const tags = [...new Set(entries.flatMap((entry) => entry.tags ?? []))].sort();
  const folded = { version: newest.version, date: newest.date, title: newest.title, notes: entries.flatMap((entry) => entry.notes) };
  if (prs.size) folded.prs = [...prs.values()].sort((a, b) => b.number - a.number);
  if (tags.length) folded.tags = tags;
  return folded;
}

/** An entry written the way patch-notes.ts writes them. */
export function formatEntry(entry, eol = "\n") {
  const q = (text) => JSON.stringify(text);
  const lines = ["  {", `    version: ${q(entry.version)},`, `    date: ${q(entry.date)},`, `    title: ${q(entry.title)},`, "    notes: ["];
  for (const note of entry.notes) lines.push(`      ${q(note)},`);
  lines.push("    ],");
  if (entry.prs?.length) {
    lines.push("    prs: [");
    for (const pr of entry.prs) lines.push(`      { number: ${pr.number}, title: ${q(pr.title)} },`);
    lines.push("    ],");
  }
  if (entry.tags?.length) lines.push(`    tags: [${entry.tags.map(q).join(", ")}],`);
  lines.push("  },");
  return lines.join(eol) + eol;
}

/**
 * patch-notes.ts with the entries since `previous` folded into one. `entries` is PATCH_NOTES as the file exports it.
 * Returns { text, folded } (folded: the versions folded away), { nothing } when there is nothing to fold (the normal
 * case right after a release; not an error), or { problem }.
 */
export function foldText(text, entries, previous, catalogVersion) {
  const fold = unreleased(entries, previous);
  // The release that has the catalog (1.0.0): every earlier entry is dropped, not folded, and the entry keeps only
  // its own notes; the app shows the catalog in their place (src/shared/release-catalog.ts).
  if (catalogVersion && fold.some((entry) => entry.version === catalogVersion)) {
    const result = catalogText(text, entries, catalogVersion);
    // Run again after the fold was merged: the file is already as it should be.
    return result.text === text ? { nothing: `Nothing to fold: ${catalogVersion} is the only entry.` } : result;
  }
  if (fold.length < 2) return { nothing: `Nothing to fold: ${fold.length ? `only ${fold[0].version} is` : "no entry is"} newer than ${previous ?? "the start"}.` };
  if (entries.slice(0, fold.length).some((entry, i) => entry !== fold[i])) return { problem: "The patch-notes entries are not newest first; sort them before folding." };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Only the folded entries and the one after them need this layout; older ones are never touched.
  const touched = Math.min(fold.length + 1, entries.length);
  const starts = [...text.matchAll(/^ {2}\{\r?\n {4}version: "(\d+\.\d+\.\d+)"/gm)];
  if (starts.length < touched || starts.slice(0, touched).some((match, i) => match[1] !== entries[i].version)) {
    return { problem: "patch-notes.ts is not laid out as expected (each entry starting with `  {` and then its version line)." };
  }
  const from = starts[0].index;
  const to = fold.length < starts.length ? starts[fold.length].index : text.lastIndexOf("];");
  return { text: text.slice(0, from) + formatEntry(foldEntries(fold), eol) + text.slice(to), folded: fold.slice(1).map((entry) => entry.version) };
}

/**
 * patch-notes.ts for the catalog release: only the `catalogVersion` entry stays. It keeps its own notes (they go into
 * latest.yml and the GitHub release) and every pull request and tag of the dropped entries, so Tavora Admin can still
 * search them. A note that merged after 1.0.0 was numbered (entries newer than it) goes into it too: its lines come after
 * the entry's own, and `setVersion` says the app version goes back to `catalogVersion`, so 1.0.0 stays the first public
 * release. The wording pass before the pull request covers those lines.
 */
function catalogText(text, entries, catalogVersion) {
  const at = entries.findIndex((entry) => entry.version === catalogVersion);
  const starts = [...text.matchAll(/^ {2}\{\r?\n {4}version: "(\d+\.\d+\.\d+)"/gm)];
  // Only the entries up to the catalog one are read from the text; the rest is cut off whatever its layout.
  if (at < 0 || starts.length <= at || starts.slice(0, at + 1).some((match, i) => match[1] !== entries[i].version) || text.lastIndexOf("];") < starts[at].index) {
    return { problem: "patch-notes.ts is not laid out as expected (each entry starting with `  {` and then its version line)." };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const catalog = entries[at];
  const later = entries.slice(0, at).reverse();
  const entry = { ...foldEntries(entries), version: catalog.version, date: catalog.date, title: catalog.title, notes: [...catalog.notes, ...later.flatMap((e) => e.notes)] };
  const result = { text: text.slice(0, starts[0].index) + formatEntry(entry, eol) + text.slice(text.lastIndexOf("];")), folded: entries.filter((e) => e !== catalog).map((e) => e.version) };
  return at > 0 ? { ...result, setVersion: catalogVersion } : result;
}

export const CATALOG_CHECKLIST = [
  `Every entry before the release was dropped; the entry keeps only its own notes. They are the release's text in latest.yml, on GitHub and in the Discord #announcements post, so keep them to a few friendly lines, what players notice first.`,
  "Settings > Patch notes shows the catalog from src/shared/release-catalog.ts in this entry's place: check that it still matches what the app has.",
];

export const WORDING_CHECKLIST = [
  "Give the release a title that covers it as a whole, a few words.",
  "Merge notes about the same thing into one line; the first word of a module's notes is its name (\"PDF Viewer: ...\").",
  "Drop notes that a later one replaces or undoes, and notes about something users can't see yet.",
  "Keep the most important things first; short, friendly, for users (CLAUDE.md > Writing).",
  "These notes are also the release post in the Discord #announcements, read by players who may not know Tavora yet: lead with what they notice while playing; put things only module makers or security-minded readers need last, in as few lines as possible.",
  "Leave prs and tags as they are: every pull request and tag of the folded entries stays.",
];

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const file = path.join(desktop, "src", "shared", "patch-notes.ts");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: desktop, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  git("fetch", "origin", "--tags", "--quiet");
  const previous = lastReleased(git("tag", "--list", "v*").split(/\r?\n/).filter(Boolean));
  const { PATCH_NOTES } = await import(pathToFileURL(file).href);
  const { CATALOG_VERSION } = await import(pathToFileURL(path.join(desktop, "src", "shared", "release-catalog.ts")).href);
  const result = foldText(readFileSync(file, "utf8"), PATCH_NOTES, previous, CATALOG_VERSION);
  if (result.nothing) {
    console.log(result.nothing);
    process.exit(0);
  }
  if (result.problem) {
    console.error(result.problem);
    process.exit(1);
  }
  const version = result.setVersion ?? PATCH_NOTES[0].version;
  if (git("branch", "--show-current") === "main") {
    git("switch", "-c", `release/notes-${version}`);
    console.log(`On the new branch release/notes-${version}.`);
  }
  writeFileSync(file, result.text);
  if (result.setVersion) {
    // The entries newer than 1.0.0 went into it, so the app goes back to its version (only the version line changes).
    for (const pkg of [path.join(desktop, "package.json"), path.join(path.dirname(path.dirname(desktop)), "package.json")]) {
      writeFileSync(pkg, readFileSync(pkg, "utf8").replace(/("version":\s*)"[^"]*"/, `$1"${result.setVersion}"`));
    }
    console.log(`Entries newer than ${result.setVersion} were folded into it, and both package.json files are back at ${result.setVersion}.`);
  }
  console.log(`Folded ${result.folded.join(", ")} into ${version} (last release: ${previous ?? "none"}) in src/shared/patch-notes.ts.`);
  const catalog = version === CATALOG_VERSION;
  console.log(catalog ? "\nThis is the release with the catalog. Before the pull request, check:" : "\nThis is a draft. Before the pull request, go over the wording:");
  for (const item of catalog ? CATALOG_CHECKLIST : WORDING_CHECKLIST) console.log(`  - ${item}`);
  console.log(`\nThen commit ("Fold the patch notes since ${previous ?? "the start"} into ${version}"), open the pull request (no change note) and merge it before pnpm release.`);
}
