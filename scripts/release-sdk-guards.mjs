// The rules `pnpm release:sdk` checks before it publishes anything to npm. Kept
// apart from the script so they can be tested.

const SEMVER = /^\d+\.\d+\.\d+$/;

/** The packages released to npm, each after the ones it depends on. */
export const PACKAGES = ["sdk", "module-schema", "pack", "create-module"];

/**
 * What stands in the way of the release, and which packages it publishes.
 * state: { branch, dirty, ahead, behind, packages }
 *   packages: [{ name, version, changelog, published }] in PACKAGES order;
 *   changelog is the text of its CHANGELOG.md (or null), published the versions npm already has.
 */
export function checkSdkRelease(state) {
  const problems = [];
  if (state.branch !== "main") problems.push(`Release from main, not from "${state.branch}".`);
  if (state.dirty) problems.push("There are uncommitted changes.");
  if (state.behind > 0) problems.push(`main is ${state.behind} commit(s) behind origin/main; pull first.`);
  if (state.ahead > 0) problems.push(`main is ${state.ahead} commit(s) ahead of origin/main; push (through a PR) first.`);

  const toPublish = [];
  for (const pkg of state.packages) {
    if (!SEMVER.test(pkg.version)) {
      problems.push(`${pkg.name}: the version "${pkg.version}" is not major.minor.patch.`);
      continue;
    }
    if (pkg.published.includes(pkg.version)) continue;
    if (!pkg.changelog?.split(/\r?\n/).includes(`## ${pkg.version}`)) {
      problems.push(`${pkg.name}: CHANGELOG.md has no "## ${pkg.version}" entry.`);
    }
    toPublish.push(pkg.name);
  }
  if (problems.length === 0 && toPublish.length === 0) {
    problems.push("Every package's version is already on npm; raise the version of the ones that changed first.");
  }
  return { problems, toPublish };
}
