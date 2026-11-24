// The rules `pnpm release` checks before it builds or publishes anything. Kept
// apart from the script so they can be tested.

import { comparePlainVersions, parsePlainVersion } from "../src/shared/plain-version.ts";
import { feedNoteProblem } from "./release-notes.mjs";
import { readSignature2 } from "../src/main/update-signature.ts";

/** -1, 0 or 1; both must be major.minor.patch (the same strict reader the app's update check uses). Throws on anything else. */
export function compareVersions(a, b) {
  const order = comparePlainVersions(a, b);
  if (order === null) throw new Error(`Not a version: ${parsePlainVersion(a) === null ? a : b}`);
  return order;
}

/** The newest released version among tags like v0.4.0, or null if there is none. */
export function lastReleased(tags) {
  // A stray tag that isn't a plain version (v01.2.3) is skipped, not a reason to stop the release.
  const versions = tags.map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1]).filter((version) => version && parsePlainVersion(version) !== null);
  return versions.sort(compareVersions).at(-1) ?? null;
}

/**
 * What stands in the way of releasing `version`. Empty means go.
 * state: { branch, dirty, ahead, behind, tags, noteVersions, notes? }
 *   noteVersions: every version in the patch notes, newest first.
 *   notes: the notes of this version's entry, which go into the update feed: one it can't take would stop the release
 *   only at the upload, after the build and the hand checks.
 * Patch versions are released like minor ones (decided 2026-10-30); CI, e2e and the start check gate them.
 */
export function checkRelease(version, state) {
  const problems = [];
  if (parsePlainVersion(version) === null) return [`The app version "${version}" is not major.minor.patch.`];
  if (state.branch !== "main") problems.push(`Release from main, not from "${state.branch}".`);
  if (state.dirty) problems.push("There are uncommitted changes.");
  if (state.behind > 0) problems.push(`main is ${state.behind} commit(s) behind origin/main; pull first.`);
  if (state.ahead > 0) problems.push(`main is ${state.ahead} commit(s) ahead of origin/main; push (through a PR) first.`);
  if (state.tags.includes(`v${version}`)) problems.push(`Version ${version} is already released (tag v${version} exists).`);

  const previous = lastReleased(state.tags);
  if (previous && compareVersions(version, previous) <= 0) {
    problems.push(`Version ${version} is not newer than the last release ${previous}.`);
  }
  if (state.noteVersions[0] !== version) {
    problems.push(`The newest patch-notes entry is ${state.noteVersions[0] ?? "missing"}; it must be ${version}.`);
  }
  // Users only see released versions: entries since the last release are folded into the new one.
  const unfolded = state.noteVersions.filter(
    (v) => v !== version && compareVersions(v, version) < 0 && (previous === null || compareVersions(v, previous) > 0),
  );
  for (const note of state.notes ?? []) {
    const problem = feedNoteProblem(note);
    if (problem) problems.push(`Patch note ${problem}.`);
  }
  if (unfolded.length) {
    problems.push(`Fold the patch-notes entries ${unfolded.join(", ")} into the ${version} entry: pnpm release:fold, go over the wording, merge it as a pull request.`);
  }
  return problems;
}

/**
 * What the GitHub "Checks" runs say about `sha`. Empty means the newest one finished green.
 * runs: [{ status, conclusion, headSha, createdAt }] as `gh run list --json` gives them.
 */
export function checkCi(runs, sha) {
  const mine = runs.filter((run) => run.headSha === sha).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (mine.length === 0) return [`GitHub has no Checks run for ${sha.slice(0, 7)} yet; wait for it to start.`];
  const latest = mine[0];
  if (latest.status !== "completed") return [`The Checks run for ${sha.slice(0, 7)} is still ${latest.status}; wait for it to finish.`];
  if (latest.conclusion !== "success") return [`The Checks run for ${sha.slice(0, 7)} ended with "${latest.conclusion}"; fix main first.`];
  return [];
}

/** Why the installed Tavora can't stand for `version` in the by-hand checks, or undefined. */
export function checkInstalled(installed, version) {
  if (!installed) return `Tavora is not installed for this user; run Tavora-Setup-${version}.exe from the release folder first.`;
  if (installed !== version) return `the installed Tavora is ${installed}, not ${version}; run Tavora-Setup-${version}.exe from the release folder and check again.`;
  return undefined;
}

/** The files a release consists of: the three the update feed serves, and the zip for the GitHub release. */
export function releaseFiles(version) {
  const installer = `Tavora-Setup-${version}.exe`;
  return { feed: [installer, `${installer}.blockmap`, "latest.yml"], all: [installer, `${installer}.blockmap`, "latest.yml", `Tavora-${version}-win.zip`] };
}

/**
 * The name the Release build gives its run (run-name in release-build.yml). The nonce is new for every
 * `pnpm release`, so the run with this name is the one it started, with these inputs, and no other.
 */
export function releaseRunTitle(version, e2e, nonce) {
  return `Release build ${version} e2e=${e2e} (${nonce})`;
}

/**
 * The jobs to look at in a failed Release build, from `gh run view --json jobs`: a line for the console, or "" when
 * none failed (it was stopped). One failed e2e shard cancels the others (fail-fast, see release-build.yml).
 */
export function failedJobsHint(jobs) {
  const failed = jobs.filter((job) => job.conclusion === "failure" || job.conclusion === "timed_out").map((job) => job.name);
  if (!failed.length) return "";
  const cancelled = jobs.filter((job) => job.conclusion === "cancelled").length;
  const stopped = cancelled === 1 ? "The cancelled job was" : `The ${cancelled} cancelled jobs were`;
  return `Failed: ${failed.join(", ")}.${cancelled ? ` ${stopped} stopped because of that; a test shown as failed there was cut off, not broken.` : ""}`;
}

/**
 * The Release build run `pnpm release` just started, from `gh run list --json databaseId,headSha,displayTitle,event`.
 * Returns { run } or { wait: true } while GitHub hasn't listed it yet, or { problem } when it builds another commit.
 */
export function findDispatchedRun(runs, title, sha) {
  const run = runs.find((candidate) => candidate.event === "workflow_dispatch" && candidate.displayTitle === title);
  if (!run) return { wait: true };
  if (run.headSha !== sha) {
    return { run, problem: `The Release build runs on ${run.headSha.slice(0, 7)}, not ${sha.slice(0, 7)}: main moved. Nothing was published; pull and start again.` };
  }
  return { run };
}

/**
 * The "RELEASE-SHA256 <hash>  <file>" lines the Release build's package job printed, as a Map of file name to hash.
 * Lines from other jobs (the e2e shards) don't count; a file printed with two different hashes maps to null.
 */
export function readCiHashes(log) {
  const hashes = new Map();
  for (const line of String(log).split(/\r?\n/)) {
    if (!line.startsWith("package\t")) continue;
    const match = /RELEASE-SHA256 ([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)\s*$/.exec(line);
    if (!match) continue;
    const [, hash, name] = match;
    hashes.set(name, hashes.has(name) && hashes.get(name) !== hash ? null : hash);
  }
  return hashes;
}

/**
 * What is wrong with the downloaded files. Empty means they are the ones CI built and printed.
 * downloaded: Map of file name to { sha256 (hex), sha512 (base64) }, missing files left out.
 */
export function checkDownload(version, downloaded, ciHashes, latestYml) {
  const problems = [];
  const { all } = releaseFiles(version);
  const installer = all[0];
  for (const name of all) {
    const file = downloaded.get(name);
    if (!file) problems.push(`${name} is missing from the download.`);
    else if (!ciHashes.has(name)) problems.push(`The Release build printed no SHA-256 for ${name}.`);
    else if (ciHashes.get(name) === null) problems.push(`The Release build printed two different SHA-256 for ${name}.`);
    else if (ciHashes.get(name) !== file.sha256) problems.push(`${name} is not the file the Release build made (its SHA-256 differs).`);
  }
  const lines = String(latestYml).split(/\r?\n/);
  if (!lines.includes(`version: ${version}`)) problems.push(`latest.yml does not say version ${version}.`);
  // electron-updater reads files[0] (url and sha512); path and the top-level sha512 are the older fields.
  if (!lines.includes(`path: ${installer}`) || !lines.includes(`  - url: ${installer}`)) problems.push(`latest.yml does not point at ${installer}.`);
  const sha512 = downloaded.get(installer)?.sha512;
  if (sha512 && (!lines.includes(`sha512: ${sha512}`) || !lines.includes(`    sha512: ${sha512}`))) problems.push("latest.yml's sha512 is not the installer's.");
  return problems;
}

/** Whether a version is a preview build: everything before 1.0.0, the first public release. */
const isPreview = (version) => compareVersions(version, "1.0.0") < 0;

/** The GitHub release's title: "(preview build)" only before 1.0.0. */
export function releaseTitle(version) {
  return isPreview(version) ? `Tavora ${version} (preview build)` : `Tavora ${version}`;
}

/** The GitHub release's text: the patch-notes entry of this version. */
export function releaseNotes(note) {
  const intro = isPreview(note.version) ? "Windows preview build of Tavora." : "Tavora for Windows.";
  const lines = [`${intro} These are the same verified files currently published through Tavora's update service.`, "", `### In ${note.version}`, ""];
  for (const line of note.notes) lines.push(`- ${line}`);
  return lines.join("\n");
}

/** The by-hand checks before an installer goes out, asked one by one, each with what already checks it automatically. */
export const CHECKLIST = [
  { check: "The installed build starts (run the new installer from the release folder).", coveredBy: "the Release build installed this very installer and started it" },
  { check: "A game can be added and removed.", coveredBy: "e2e: library.spec" },
  { check: "A module opens in a game.", coveredBy: "e2e: workspace.spec, official-modules.spec" },
  { check: "Settings opens.", coveredBy: "e2e: search.spec, nested-dialogs.spec" },
];

/** Before 1.0 the by-hand checks are only listed, not asked: what covers each one ran before. From 1.0.0 on they are asked again. */
export function asksHandChecks(version) {
  return compareVersions(version, "1.0.0") >= 0;
}

/** Said after the upload: it can only be checked once the new version is public. */
export const AFTER_RELEASE =
  "Last check, now that it is public: on an installed previous version, wait for or trigger the update and see that it installs this version.";

/** How far this PC's clock may be from the update server's before it signs a feed statement (its issue time). */
export const CLOCK_LEEWAY_MS = 5 * 60 * 1000;

/**
 * Why this PC's clock can't date a feed statement, or null: the update server's `Date` header (`serverDate`, as sent)
 * must be within CLOCK_LEEWAY_MS of `now`. A statement dated ahead would hold back every later one; one dated behind
 * would look old to apps at once. No header is a problem too: then nothing says the clock is right.
 */
export function clockProblem(serverDate, now = new Date()) {
  const server = Date.parse(serverDate ?? "");
  if (Number.isNaN(server)) return "The update server sent no time to check this PC's clock against.";
  const off = now.getTime() - server;
  if (Math.abs(off) <= CLOCK_LEEWAY_MS) return null;
  const minutes = Math.round(Math.abs(off) / 60000);
  return `This PC's clock is ${minutes} minutes ${off > 0 ? "ahead of" : "behind"} the update server's. Set the clock right (Windows: Settings > Time > Sync now) and try again.`;
}

/**
 * Why a new feed statement can't follow the live feed's, or null: it must be issued later than the live second
 * signature (`live`, the live latest.yml's tavoraSignature2 value, or null when it has none), as the server checks too.
 */
export function issuedAfterLiveProblem(live, statement) {
  if (!live) return null;
  const read = readSignature2(live);
  if (!read.ok) return `Can't read the live latest.yml's second signature (${read.reason}).`;
  const issued = read.statement.issuedAt;
  if (Date.parse(statement.issuedAt) > Date.parse(issued)) return null;
  return `The live feed's second signature is issued ${issued}, not before this one (${statement.issuedAt}). Is this PC's clock behind?`;
}

/**
 * Why `pnpm release:refresh` can't sign the live feed again, or an empty list: like a release it runs from a clean
 * main that matches origin/main, and the live feed must be the version the newest release tag names (anything else
 * means the feed isn't what this checkout released).
 */
export function checkRefresh(liveVersion, state) {
  const problems = [];
  if (state.branch !== "main") problems.push(`Refresh from main, not from "${state.branch}".`);
  if (state.dirty) problems.push("There are uncommitted changes.");
  if (state.behind > 0) problems.push(`main is ${state.behind} commit(s) behind origin/main; pull first.`);
  if (state.ahead > 0) problems.push(`main is ${state.ahead} commit(s) ahead of origin/main; push (through a PR) first.`);
  const last = lastReleased(state.tags);
  if (!liveVersion) problems.push("The live feed names no version.");
  else if (liveVersion !== last) problems.push(`The live feed is ${liveVersion}, but the newest release tag is ${last ?? "missing"}. Find out why before you sign it again.`);
  return problems;
}

/**
 * Why `signingPublicKey` can't sign the live feed again, or null. The apps that read the refreshed statement pin
 * either the live release's keys (they run it and look for something newer) or the release before it (they are
 * offered it), so the key must be one both pin (`pinSets`: the pins of those two tags, null for a tag from before
 * signed updates).
 */
export function refreshKeyProblem(signingPublicKey, pinSets) {
  for (const { version, pins } of pinSets) {
    if (!pins) continue;
    if (signingPublicKey !== pins.release && signingPublicKey !== pins.backup) {
      return `The update key here is not one ${version} pins (release ${pins.release}, backup ${pins.backup}), so its apps would not take the new statement.`;
    }
  }
  return null;
}

/** A refresh is due when the live statement has fewer days left than this (the weekly reminder's threshold). */
export const REFRESH_DUE_DAYS = 10;

/**
 * What the weekly reminder says about the live feed (`signature2`: its tavoraSignature2 value, or null): until when it
 * is vouched for, how many whole days are left, and whether a release or `pnpm release:refresh` is due.
 */
export function feedFreshness(signature2, now = new Date()) {
  const read = readSignature2(signature2);
  if (!read.ok) return { expiresAt: null, daysLeft: null, due: true };
  const { expiresAt } = read.statement;
  const daysLeft = Math.floor((Date.parse(expiresAt) - now.getTime()) / 86_400_000);
  return { expiresAt, daysLeft, due: daysLeft < REFRESH_DUE_DAYS };
}
