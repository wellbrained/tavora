// `pnpm release:refresh`: signs the live update feed's second signature (tavoraSignature2) again, with a new issue time
// and an expiry 30 days later, when no release came out for a while. It changes nothing else in latest.yml (the v1
// signature, the installer, the notes stay byte for byte), so installed apps see the same version vouched for again.
// The weekly reminder says when the live statement has fewer than 10 days left (deploy/README.md, "Refresh the feed").
//
//   pnpm release:refresh            checks, signs and uploads through tavora-receive's refresh
//   pnpm release:refresh --dry-run  the same up to the signing, then stops (needs no lock, no upload key)
//   pnpm release:refresh --status   only reads the live feed: until when it is vouched for, and whether a refresh is
//                                   due (fewer than 10 days left; exit code 2 then). What the weekly reminder runs.
//
// Guarded like `pnpm release`: a clean main that matches origin/main, the RELEASE-RUNNING lock, the update key
// (TAVORA_UPDATE_KEY) pinned by both the live release and the one before it, and this PC's clock within 5 minutes of
// the server's.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hello, localTar, refresh } from "../../../scripts/deploy-client.mjs";
import { checkRefresh, clockProblem, compareVersions, feedFreshness, issuedAfterLiveProblem, refreshKeyProblem } from "./release-guards.mjs";
import { holdLock, stopOnSignals } from "./release-lock.mjs";
import { describeSigned, fetchLiveFeed, freshStatement, loadUpdateSigningKey, readLatestYml, refreshLatestYml, releasePins, sourceAtTag } from "./update-feed.mjs";
import { PINNED_UPDATE_KEYS } from "../src/main/update-keys.ts";
import { rawUpdatePublicKey } from "../src/main/update-signature.ts";
import { parsePlainVersion } from "../src/shared/plain-version.ts";

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desktop));
const dryRun = process.argv.includes("--dry-run");
const feed = "https://updates.mytavora.app";

function fail(message) {
  console.error(message);
  process.exit(1);
}
function git(...args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${result.status}): ${String(result.stderr).trim()}`);
  return result.stdout.trim();
}
const step = (text) => console.log(`\n== ${text}`);
// Ctrl+C, a closed window or a kill exits, so the exit handler frees RELEASE-RUNNING (release-lock.mjs holdLock).
stopOnSignals(() => {});

if (process.argv.includes("--status")) {
  let text = null;
  try {
    text = (await fetchLiveFeed(feed)).text;
  } catch (error) {
    fail(`Can't read ${feed}/latest.yml (${error.message}).`);
  }
  if (!text) fail(`${feed} has no latest.yml.`);
  const live = readLatestYml(text);
  const status = feedFreshness(live.signature2);
  if (status.expiresAt) console.log(`${live.version} is vouched for until ${status.expiresAt} (${status.daysLeft} days left).`);
  else console.log(`${live.version} has no second signature yet.`);
  if (status.due) console.log("Due: release, or run pnpm release:refresh.");
  process.exit(status.due ? 2 : 0);
}

// The upload key and the update key first, before anything else is asked.
if (!dryRun) {
  try {
    hello("updates");
  } catch (error) {
    fail(`${error.message}\nNothing was signed or published.`);
  }
}
const signing = loadUpdateSigningKey(process.env.TAVORA_UPDATE_KEY?.trim(), PINNED_UPDATE_KEYS);
if (signing.problem && !dryRun) fail(`Not refreshing: ${signing.problem}\nNothing was signed or published.`);
if (signing.problem) console.warn(`Dry run without signing: ${signing.problem}`);

step("Reading the live feed");
let live;
try {
  live = await fetchLiveFeed(feed);
} catch (error) {
  fail(`Can't read ${feed}/latest.yml (${error.message}). Nothing was signed or published.`);
}
if (!live.text) fail(`${feed} has no latest.yml yet: release first. Nothing was signed or published.`);
const read = readLatestYml(live.text);
const version = read.version;
console.log(`Live: ${version}${read.signature2 ? ` (second signature: ${read.signature2.split(" ").slice(0, 4).join(" ")})` : " (no second signature yet)"}`);

git("fetch", "origin", "--tags", "--prune", "--quiet");
const tags = git("tag", "--list", "v*").split(/\r?\n/).filter(Boolean);
const problems = checkRefresh(version, {
  branch: git("branch", "--show-current"),
  dirty: git("status", "--porcelain") !== "",
  ahead: Number(git("rev-list", "--count", "origin/main..HEAD")),
  behind: Number(git("rev-list", "--count", "HEAD..origin/main")),
  tags,
});
const clock = clockProblem(live.date);
if (clock) problems.push(clock);
if (problems.length) fail(`\nNot refreshing:\n  - ${problems.join("\n  - ")}\nNothing was signed or published.`);

// While it runs nothing merges into main, as during a release (CLAUDE.md > Versioning).
if (!dryRun) {
  const lock = holdLock(repo, `${version} refresh`, git("worktree", "list", "--porcelain"));
  if (lock.problem) fail(`${lock.problem}\nNothing was signed or published.`);
  if (lock.replaced) console.log(`Took over the release lock of a run that is gone (${lock.replaced}).`);
  console.log(`Release lock: ${lock.file}`);
}

// The pins that count are the apps': those of the live release, and of the release before it (its apps are offered
// the live one). Both must pin the key that signs.
// Only a release without update-keys.ts (from before signed updates) pins nothing; anything else unreadable stops.
const pinsAt = (tag) => {
  try {
    return releasePins(tag, (file) => sourceAtTag(repo, tag, file)).pins;
  } catch (error) {
    fail(`Not refreshing: ${error.message} Nothing was signed or published.`);
  }
};
const released = tags
  .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1])
  .filter((tag) => tag && parsePlainVersion(tag) !== null)
  .sort(compareVersions);
const before = released.filter((tag) => compareVersions(tag, version) < 0).at(-1) ?? null;
const livePins = pinsAt(version);
if (!livePins) fail(`${version} pins no update keys, so its apps check no signature to refresh. Nothing was signed or published.`);
const pinSets = [{ version, pins: livePins }, ...(before ? [{ version: before, pins: pinsAt(before) }] : [])];

// A dry run gets here only when the clock check passed (above). It signs in memory and shows only the fields, never
// the signature or the signed latest.yml, and writes nothing.
step(`Signing ${version} again`);
const statement = freshStatement(new Date());
const order = issuedAfterLiveProblem(read.signature2, statement);
if (order) fail(`Not refreshing: ${order} Nothing was signed or published.`);
if (signing.problem) {
  console.log(describeSigned({ version, file: "(the live installer)", sha512: "(the live SHA-512)" }, statement).map((line) => `  ${line}`).join("\n"));
  console.log(`\nDry run: this is what a refresh signs. A real one would stop: ${signing.problem}\nNothing was signed or published.`);
  process.exit(0);
}
const keyProblem = refreshKeyProblem(rawUpdatePublicKey(signing.key), pinSets);
if (keyProblem) fail(`Not refreshing: ${keyProblem} Nothing was signed or published.`);
let refreshed;
try {
  refreshed = refreshLatestYml({ latestYml: live.text, privateKey: signing.key, pinned: livePins, statement });
} catch (error) {
  fail(`Not refreshing: ${error.message}. Nothing was signed or published.`);
}
console.log(describeSigned(refreshed.update, refreshed.statement).map((line) => `  ${line}`).join("\n"));
console.log(`Signed with the ${refreshed.key} key; everything else in latest.yml stays as it is.`);
if (dryRun) {
  console.log("\nDry run: stopping before the upload. Nothing was published.");
  process.exit(0);
}

step(`Publishing the refreshed feed of ${version}`);
const dir = mkdtempSync(path.join(tmpdir(), "tavora-refresh-"));
const bundle = path.join(dir, "refresh.tar");
let failed = null;
try {
  writeFileSync(path.join(dir, "latest.yml"), refreshed.text);
  const tar = localTar();
  const packed = spawnSync(tar.command, [...tar.flags, "-cf", bundle, "-C", dir, "latest.yml"], { stdio: "inherit", env: tar.env });
  if (packed.status !== 0) throw new Error("Can't pack latest.yml. Nothing was published.");
  refresh(version, bundle);
} catch (error) {
  failed = error;
} finally {
  // The signed latest.yml goes whatever happens: fail() exits at once and would skip a finally around it.
  rmSync(dir, { recursive: true, force: true });
}
if (failed) fail(`${failed.message}\nThe live feed stays as it was.`);

const after = await fetchLiveFeed(feed).catch(() => null);
const served = after?.text ? readLatestYml(after.text).signature2 : null;
if (served !== readLatestYml(refreshed.text).signature2) {
  fail(`The server said it refreshed ${version}, but ${feed}/latest.yml doesn't show the new second signature yet. Check it by hand.`);
}
console.log(`\nRefreshed ${version}: the feed is vouched for until ${refreshed.statement.expiresAt}.`);
