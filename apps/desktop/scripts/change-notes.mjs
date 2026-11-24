// Version numbers are given out when a pull request merges, not while it is open, so
// two pull requests never grab the same number. A pull request that users will
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
// For Tavora Admin, where the maintainer searches the releases, each entry also
// gets the pull request it came from and a few tags. The tags come from the files
// the pull request changed (change-tags.json maps paths to tags), plus any the note
// names on a `tags: cloud-copy, recovery-key` line before its title. Users never
// see either: the app doesn't show them.
//
// Usage:
//   node change-notes.mjs check <base ref> <true|false> [head sha]   the Version check on a pull request
//   node change-notes.mjs apply                           numbers the notes on main (Number workflow)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareVersions } from "./release-guards.mjs";
import { feedNoteProblem } from "./release-notes.mjs";
import { CATALOG_VERSION } from "../src/shared/release-catalog.ts";

export const LABEL = "feature-complete";
const BUMPS = ["patch", "minor", "major"];
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The note in `text`, or the problems with it. `file` only names it in messages. */
export function parseChangeNote(text, file) {
  const problems = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let bump = "patch";
  let title = "";
  const notes = [];
  const tags = [];
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const bumpLine = /^bump:\s*(\S+)$/.exec(line);
    const tagsLine = /^tags:\s*(.*)$/.exec(line);
    if (first && bumpLine) {
      bump = bumpLine[1];
      if (!BUMPS.includes(bump)) problems.push(`${file}: "bump: ${bump}" isn't patch, minor or major.`);
    } else if (tagsLine && !title) {
      for (const tag of tagsLine[1].split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
        if (TAG.test(tag)) tags.push(tag);
        else problems.push(`${file}: the tag "${tag}" isn't lower-case words joined by hyphens.`);
      }
      continue;
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
  // Each note goes into the update feed when it is released: one it can't take would stop that release at the very end.
  for (const note of notes) {
    const problem = feedNoteProblem(note);
    if (problem) problems.push(`${file}: ${problem}.`);
  }
  return problems.length ? { problems } : { note: { bump, title, notes, tags }, problems };
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
export function checkPullRequest({ base, head, rootHead, notes, featureComplete, foldedBack = false }) {
  const problems = [];
  if (!foldedBack && (head !== base || rootHead !== base)) {
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

/** A patch-notes entry as it is written in patch-notes.ts; `prs` and `tags` only when there are some. */
export function renderEntry({ version, date, title, notes, prs = [], tags = [] }) {
  return [
    "  {",
    `    version: ${JSON.stringify(version)},`,
    `    date: ${JSON.stringify(date)},`,
    `    title: ${JSON.stringify(title)},`,
    "    notes: [",
    ...notes.map((note) => `      ${JSON.stringify(note)},`),
    "    ],",
    ...(prs.length ? ["    prs: [", ...prs.map((pr) => `      { number: ${pr.number}, title: ${JSON.stringify(pr.title)} },`), "    ],"] : []),
    ...(tags.length ? [`    tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}],`] : []),
    "  },",
  ].join("\n");
}

/** A path pattern as a test: `*` is anything but `/`, `**` is anything at all. */
function pathPattern(glob) {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

/** The tags for the files a pull request changed, from rules like { "tag": "overlays", "paths": ["apps/desktop/src/main/*overlay*"] }. */
export function tagsForFiles(files, rules) {
  const tags = new Set();
  for (const rule of rules) {
    const patterns = rule.paths.map(pathPattern);
    if (files.some((file) => patterns.some((pattern) => pattern.test(file)))) tags.add(rule.tag);
  }
  return [...tags];
}

/** A note's own tags and the ones from its files, each once, sorted. */
export const mergeTags = (...lists) => [...new Set(lists.flat())].sort();

/**
 * The pull request a merge commit brought in, from GitHub's message ("Merge pull request #391 from ...", its title
 * in the body) or a squash ("Title (#391)"). Null for anything else.
 */
export function pullRequestOf(subject, body) {
  const merged = /^Merge pull request #(\d+) /.exec(subject);
  if (merged) return { number: Number(merged[1]), title: body.split("\n").map((line) => line.trim()).find(Boolean) ?? "" };
  const squashed = /^(.*) \(#(\d+)\)$/.exec(subject);
  return squashed ? { number: Number(squashed[2]), title: squashed[1].trim() } : null;
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
    entries.unshift(renderEntry({ version, date, title: note.title, notes: note.notes, prs: note.pr ? [note.pr] : [], tags: note.tags ?? [] }));
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

/** The commits on main's own line that hold `sha`, oldest first: a squash is `sha` itself, a merge comes after it. */
function mainCommitsWith(sha, tip = "HEAD") {
  const lines = (...args) => git(...args).split("\n").filter(Boolean);
  // Every commit that contains `sha`; a branch's merge holds it only through its second parent, so --first-parent
  // alone would miss it.
  const holding = new Set([sha, ...lines("log", "--ancestry-path", "--format=%H", `${sha}..${tip}`)]);
  return lines("log", "--first-parent", "--reverse", "--format=%H", tip).filter((commit) => holding.has(commit));
}

/**
 * Where a note came from: the pull request that added it, and the files that pull request changed. It is the first
 * commit on main's own line that brought the note's file in (a merge, or a squash). Null when there is none, say
 * for a note pushed to main directly.
 */
function originOf(name) {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", path.join(changes, name));
  if (!added) return null;
  for (const sha of mainCommitsWith(added)) {
    const pr = pullRequestOf(git("log", "-1", "--format=%s", sha), git("log", "-1", "--format=%b", sha));
    if (!pr) continue;
    const files = git("diff", "--name-only", `${sha}^1`, sha).split("\n").filter(Boolean);
    return { pr, files };
  }
  return null;
}

const tagRules = () => readJson(path.join(desktop, "scripts", "change-tags.json")).tags;

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

/**
 * What a pull request brings, read from git alone (not from the checkout, which on GitHub is a merge with whatever main
 * is now): the app version where the pull request branched off `baseRef` (main's current tip) and at its head, and
 * only the change notes it adds or edits. So a main that moved on, or notes already on main that wait to be numbered
 * (a stuck Number run), never turn this pull request's check red. `git` runs a git command and gives its output.
 */
export function collectPullRequest(git, baseRef, headSha) {
  const problems = [];
  const mergeBase = git("merge-base", baseRef, headSha);
  const version = (sha, file) => JSON.parse(git("show", `${sha}:${file}`)).version;
  const notes = [];
  const dir = "apps/desktop/changes";
  // --no-renames: a file moved in here counts as added, so a renamed note can't skip the label rule.
  const changed = git("diff", "--name-only", "--no-renames", "--diff-filter=AM", mergeBase, headSha, "--", dir)
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => file.startsWith(`${dir}/`) && file !== `${dir}/README.md`)
    .sort();
  // The Number run reads only <name>.md right in changes/ (noteFiles): anything else would sit there, never numbered.
  const isNote = (file) => file.endsWith(".md") && !file.slice(dir.length + 1).includes("/");
  for (const file of changed.filter((file) => !isNote(file))) {
    problems.push(`${file}: a change note is a .md file right in ${dir}/ (like lost-key.md); this one would never be numbered.`);
  }
  const files = changed.filter(isNote);
  for (const file of files) {
    const parsed = parseChangeNote(git("show", `${headSha}:${file}`), file);
    problems.push(...parsed.problems);
    if (parsed.note) notes.push({ ...parsed.note, file: path.posix.basename(file) });
  }
  const base = version(mergeBase, "apps/desktop/package.json");
  const head = version(headSha, "apps/desktop/package.json");
  const rootHead = version(headSha, "package.json");
  // The one allowed step back: `pnpm release:fold` put notes that merged after 1.0.0 into it, so the patch notes hold
  // only the 1.0.0 entry and both package.json files return to it.
  const foldedBack =
    head === CATALOG_VERSION &&
    rootHead === CATALOG_VERSION &&
    compareVersions(base, head) > 0 &&
    [...git("show", `${headSha}:apps/desktop/src/shared/patch-notes.ts`).matchAll(/^ {4}version: "(\d+\.\d+\.\d+)"/gm)].map((match) => match[1]).join() === CATALOG_VERSION;
  return { base, head, rootHead, notes, problems, foldedBack };
}

function check(baseRef, labeled, headSha = "HEAD") {
  const { base, head, rootHead, notes, problems, foldedBack } = collectPullRequest(git, baseRef, headSha);
  problems.push(...checkPullRequest({ base, head, rootHead, notes, featureComplete: labeled, foldedBack }));
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
  const rules = tagRules();
  for (const note of notes) {
    const origin = originOf(note.file);
    note.pr = origin?.pr ?? null;
    note.tags = mergeTags(note.tags, origin ? tagsForFiles(origin.files, rules) : []);
  }
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
  if (command === "check") check(rest[0], rest[1] === "true", rest[2]);
  else if (command === "apply") apply();
  else {
    console.error("Usage: node change-notes.mjs check <base ref> <true|false> [head sha] | apply");
    process.exit(2);
  }
}
