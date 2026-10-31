// The rules `pnpm release` checks before it builds or publishes anything. Kept
// apart from the script so they can be tested.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0 or 1; both must be major.minor.patch. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a)?.slice(1).map(Number);
  const pb = SEMVER.exec(b)?.slice(1).map(Number);
  if (!pa || !pb) throw new Error(`Not a version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** The newest released version among tags like v0.4.0, or null if there is none. */
export function lastReleased(tags) {
  const versions = tags.map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1]).filter(Boolean);
  return versions.sort(compareVersions).at(-1) ?? null;
}

/**
 * What stands in the way of releasing `version`. Empty means go.
 * state: { branch, dirty, ahead, behind, tags, noteVersions }
 *   noteVersions: every version in the patch notes, newest first.
 * Patch versions are released like minor ones (decided 2026-10-30); CI, e2e and the start check gate them.
 */
export function checkRelease(version, state) {
  const problems = [];
  if (!SEMVER.test(version)) return [`The app version "${version}" is not major.minor.patch.`];
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

/** The GitHub release's text: the patch-notes entry of this version. */
export function releaseNotes(note) {
  const lines = ["Windows preview build of Tavora. These are the same verified files currently published through Tavora's update service.", "", `### In ${note.version}`, ""];
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
