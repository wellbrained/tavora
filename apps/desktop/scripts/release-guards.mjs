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
 * options.allowPatch: a one-off release of a patch version (x.y.z), e.g. to try an update.
 */
export function checkRelease(version, state, options = {}) {
  const problems = [];
  const match = SEMVER.exec(version);
  if (!match) return [`The app version "${version}" is not major.minor.patch.`];
  if (match[3] !== "0" && !options.allowPatch) {
    problems.push(`Only minor releases are published (x.y.0); ${version} is a patch version. Raise the minor number first (or use --allow-patch for a one-off).`);
  }
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
    problems.push(`Fold the patch-notes entries ${unfolded.join(", ")} into the ${version} entry and remove them.`);
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

/** The by-hand checks before an installer goes out, asked one by one, each with what already checks it automatically. */
export const CHECKLIST = [
  { check: "The installed build starts (run the new installer from the release folder).", coveredBy: "CI installs it and starts it (packaged-start), and the start check above" },
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
