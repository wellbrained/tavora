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
 */
export function checkRelease(version, state) {
  const problems = [];
  const match = SEMVER.exec(version);
  if (!match) return [`The app version "${version}" is not major.minor.patch.`];
  if (match[3] !== "0") {
    problems.push(`Only minor releases are published (x.y.0); ${version} is a patch version. Raise the minor number first.`);
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
  // Players only see released versions: entries since the last release are folded into the new one.
  const unfolded = state.noteVersions.filter(
    (v) => v !== version && compareVersions(v, version) < 0 && (previous === null || compareVersions(v, previous) > 0),
  );
  if (unfolded.length) {
    problems.push(`Fold the patch-notes entries ${unfolded.join(", ")} into the ${version} entry and remove them.`);
  }
  return problems;
}