// Version numbers are given out when a pull request merges, not while it is open, so
// two pull requests never grab the same number. A pull request that players will
// notice adds a change note to apps/desktop/changes/ and leaves the version alone;
// on main, the Number workflow turns each note into the next version and its
// patch-notes entry (the decision log, 2026-10-20).
//
// A change note is a Markdown file, for example apps/desktop/changes/lost-key.md:
//
//   # Lost a publisher key?
//
//   - Press Lost it? next to it in Settings > Account.
//   - Your modules move to your newest key once Tavora checks it.
//
// It raises the patch number. A finished feature starts with `bump: minor` (or
// `bump: major`) on its own first line, and its pull request needs the
// `feature-complete` label, which only the maintainer adds.
//
// Usage:
//   node change-notes.mjs check <base sha> <true|false>   the Version check on a pull request
//   node change-notes.mjs apply                           numbers the notes on main (Number workflow)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareVersions } from "./release-guards.mjs";

export const LABEL = "feature-complete";
const BUMPS = ["patch", "minor", "major"];

/** The note in `text`, or the problems with it. `file` only names it in messages. */
export function parseChangeNote(text, file) {
  const problems = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let bump = "patch";
  let title = "";
  const notes = [];
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const bumpLine = /^bump:\s*(\S+)$/.exec(line);
    if (first && bumpLine) {
      bump = bumpLine[1];
      if (!BUMPS.includes(bump)) problems.push(`${file}: "bump: ${bump}" isn't patch, minor or major.`);
    } else if (/^# /.test(line) && !title && notes.length === 0) {
      title = line.slice(2).trim();
    } else if (/^[-*] /.test(line)) {
      notes.push(line.slice(2).trim());
    } else if (notes.length > 0) {
      // A long note may wrap onto the next lines.
      notes[notes.length - 1] += ` ${line}`;
    } else {
      problems.push(`${file}: "${line}" isn't a "# Title" or a "- note" line.`);
    }
    first = false;
  }
  if (!title) problems.push(`${file}: starts without a "# Title" line.`);
  if (notes.length === 0) problems.push(`${file}: has no "- note" lines.`);
  if (notes.some((note) => note === "")) problems.push(`${file}: has an empty note.`);
  return problems.length ? { problems } : { note: { bump, title, notes }, problems };
}

/** The version after `version` for a `bump`. */
export function nextVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * What is wrong with a pull request. Empty means fine.
 * base/head: the app versions before and after it. notes: the parsed change notes it brings.
 */
export function checkPullRequest({ base, head, rootHead, notes, featureComplete }) {
  const problems = [];
  if (head !== base || rootHead !== base) {
    problems.push(
      `The app version changes (${base} to ${head}). Leave it at ${base} and add a change note to apps/desktop/changes/ instead; main gives out the number when this merges. Move this pull request's patch-notes entry into the note too.`,
    );
  }
  const raising = notes.filter((note) => note.bump !== "patch");
  if (raising.length && !featureComplete) {
    problems.push(`A change note says "bump: ${raising[0].bump}". Work in progress raises only the patch number; only the maintainer raises the minor number, by adding the "${LABEL}" label when a feature is complete.`);
  }
  if (featureComplete && raising.length === 0) {
    problems.push(`The "${LABEL}" label is set, but no change note says "bump: minor". Add it to the note, or remove the label.`);
  }
  return problems;
}

/** A patch-notes entry as it is written in patch-notes.ts. */
export function renderEntry({ version, date, title, notes }) {
  return [
    "  {",
    `    version: ${JSON.stringify(version)},`,
    `    date: ${JSON.stringify(date)},`,
    `    title: ${JSON.stringify(title)},`,
    "    notes: [",
    ...notes.map((note) => `      ${JSON.stringify(note)},`),
    "    ],",
    "  },",
  ].join("\n");
}

const START = "export const PATCH_NOTES: readonly PatchNote[] = [\n";

/**
 * Numbers `notes` (oldest first) from `version` on. Gives back the new version, the
 * patch-notes source with their entries on top and the versions given out.
 */
export function applyNotes(version, source, notes, date) {
  const at = source.indexOf(START);
  if (at < 0) throw new Error("Can't find the PATCH_NOTES list in patch-notes.ts.");
  const entries = [];
  const versions = [];
  for (const note of notes) {
    version = nextVersion(version, note.bump);
    versions.push(version);
    entries.unshift(renderEntry({ version, date, title: note.title, notes: note.notes }));
  }
  const cut = at + START.length;
  return { version, source: source.slice(0, cut) + entries.map((entry) => `${entry}\n`).join("") + source.slice(cut), versions };
}

/** Today in Germany, where the maintainer is, as YYYY-MM-DD. */
export function today(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desktop));
const changes = path.join(desktop, "changes");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** The change-note files in apps/desktop/changes, oldest first (when git added them, then by name). */
function noteFiles() {
  if (!existsSync(changes)) return [];
  const files = readdirSync(changes).filter((name) => name.endsWith(".md") && name !== "README.md");
  const added = (name) => Number(git("log", "--diff-filter=A", "--format=%ct", "-1", "--", path.join(changes, name)) || Infinity);
  return files
    .map((name) => ({ name, at: added(name) }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name }) => name);
}

function readNotes() {
  const problems = [];
  const notes = [];
  for (const name of noteFiles()) {
    const parsed = parseChangeNote(readFileSync(path.join(changes, name), "utf8"), `apps/desktop/changes/${name}`);
    problems.push(...parsed.problems);
    if (parsed.note) notes.push({ ...parsed.note, file: name });
  }
  return { notes, problems };
}

function check(baseSha, labeled) {
  const base = JSON.parse(git("show", `${baseSha}:apps/desktop/package.json`)).version;
  const { notes, problems } = readNotes();
  problems.push(
    ...checkPullRequest({
      base,
      head: readJson(path.join(desktop, "package.json")).version,
      rootHead: readJson(path.join(repo, "package.json")).version,
      notes,
      featureComplete: labeled,
    }),
  );
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(notes.length ? `Change notes fine: ${notes.map((note) => `${note.file} (${note.bump})`).join(", ")}.` : `No change note; the version stays ${base}.`);
}

/** Writes the new version and patch notes, removes the notes and prints the commit message. */
function apply() {
  const { notes, problems } = readNotes();
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  if (notes.length === 0) return;
  const appFile = path.join(desktop, "package.json");
  const rootFile = path.join(repo, "package.json");
  const notesFile = path.join(desktop, "src", "shared", "patch-notes.ts");
  const from = readJson(appFile).version;
  const result = applyNotes(from, readFileSync(notesFile, "utf8"), notes, today());
  if (compareVersions(result.version, from) <= 0) throw new Error(`${result.version} isn't newer than ${from}.`);
  for (const file of [appFile, rootFile]) {
    // Only the version line changes, so the rest of the file keeps its formatting.
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace(/("version":\s*)"[^"]*"/, `$1"${result.version}"`));
  }
  writeFileSync(notesFile, result.source);
  for (const note of notes) rmSync(path.join(changes, note.file));
  const titles = notes.map((note, i) => `${result.versions[i]}: ${note.title}`);
  console.log(titles.length === 1 ? titles[0] : `${result.versions[0]} to ${result.version}\n\n${titles.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") check(rest[0], rest[1] === "true");
  else if (command === "apply") apply();
  else {
    console.error("Usage: node change-notes.mjs check <base sha> <true|false> | apply");
    process.exit(2);
  }
}
