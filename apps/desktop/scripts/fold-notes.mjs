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
 * Returns { text, folded } (folded: the versions folded away), or { problem }.
 */
export function foldText(text, entries, previous) {
  const fold = unreleased(entries, previous);
  if (fold.length < 2) return { problem: `Nothing to fold: ${fold.length ? `only ${fold[0].version} is` : "no entry is"} newer than ${previous ?? "the start"}.` };
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

export const WORDING_CHECKLIST = [
  "Give the release a title that covers it as a whole, a few words.",
  "Merge notes about the same thing into one line; the first word of a module's notes is its name (\"PDF Viewer: ...\").",
  "Drop notes that a later one replaces or undoes, and notes about something users can't see yet.",
  "Keep the most important things first; short, friendly, for users (CLAUDE.md > Writing).",
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
  const result = foldText(readFileSync(file, "utf8"), PATCH_NOTES, previous);
  if (result.problem) {
    console.error(result.problem);
    process.exit(1);
  }
  const version = PATCH_NOTES[0].version;
  if (git("branch", "--show-current") === "main") {
    git("switch", "-c", `release/notes-${version}`);
    console.log(`On the new branch release/notes-${version}.`);
  }
  writeFileSync(file, result.text);
  console.log(`Folded ${result.folded.join(", ")} into ${version} (last release: ${previous ?? "none"}) in src/shared/patch-notes.ts.`);
  console.log("\nThis is a draft. Before the pull request, go over the wording:");
  for (const item of WORDING_CHECKLIST) console.log(`  - ${item}`);
  console.log(`\nThen commit ("Fold the patch notes since ${previous ?? "the start"} into ${version}"), open the pull request (no change note) and merge it before pnpm release.`);
}
