// The version rule every pull request is checked against (see docs/decisions.md,
// 2026-10-16). Work in progress raises only the patch number; the minor (or
// major) number goes up only when wellbrained says a feature is complete, which he marks
// by adding the `feature-complete` label to the pull request.
//
// Usage in CI: node version-bump.mjs <base version> <head version> <true|false>

import { pathToFileURL } from "node:url";
import { compareVersions } from "./release-guards.mjs";

export const LABEL = "feature-complete";

/** What is wrong with going from `base` to `head`. Empty means fine. */
export function checkVersionBump(base, head, featureComplete) {
  const order = compareVersions(head, base);
  if (order < 0) return [`The app version goes down, from ${base} to ${head}.`];
  if (order === 0) return [];
  const [bMajor, bMinor] = base.split(".").map(Number);
  const [hMajor, hMinor, hPatch] = head.split(".").map(Number);
  if (hMajor === bMajor && hMinor === bMinor) {
    return featureComplete ? [`The "${LABEL}" label is set, but ${base} to ${head} only raises the patch number. Raise the minor number (x.y.0) or remove the label.`] : [];
  }
  const problems = [];
  if (!featureComplete) {
    problems.push(`${base} to ${head} raises the ${hMajor !== bMajor ? "major" : "minor"} number. Work in progress raises only the patch number (${base.replace(/\d+$/, (p) => String(Number(p) + 1))}); only wellbrained raises the minor number, by adding the "${LABEL}" label when a feature is complete.`);
  }
  if (hPatch !== 0) problems.push(`A new minor or major version starts at patch 0, not ${head}.`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head, label] = process.argv.slice(2);
  const problems = checkVersionBump(base, head, label === "true");
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(`Version ${base} -> ${head}: fine.`);
}
