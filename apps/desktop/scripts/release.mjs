// `pnpm release`: publishes the Windows app's current version (patch or minor) to updates.mytavora.app.
// Run on the maintainer's PC from a clean, up-to-date main.
//
//   pnpm release              checks, has GitHub build and test it, verifies the files, uploads, tags,
//                             pushes the tag and creates the GitHub release
//   pnpm release --dry-run    the same up to and including the download check, then stops before the upload
//   pnpm release --skip-e2e   the Release build leaves out the e2e suite (only for a retry after it passed)
//   pnpm release --skip-ci-check  doesn't wait for main's Checks run (the Release build runs the same tests)
//
// Before 1.0 the by-hand checks are listed with what already covers them, not asked (asksHandChecks).
//
// The split release (decided 2026-10-30/31): GitHub Actions builds and tests with no secrets
// (.github/workflows/release-build.yml); this PC checks the files against CI's SHA-256 and GitHub's build
// attestation, then uploads them with the restricted tavora-updates key (deploy/README.md). On the server tavora-receive puts the
// installer and its blockmap first and latest.yml last, so a manifest never points at a file that is not
// there yet, and refuses a version that is not newer than the live one.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { AFTER_RELEASE, CHECKLIST, asksHandChecks, checkCi, checkDownload, checkInstalled, checkRelease, findDispatchedRun, readCiHashes, releaseFiles, releaseNotes, releaseRunTitle } from "./release-guards.mjs";
import { hello, publish } from "../../../scripts/deploy-client.mjs";

/** The version of the Tavora installed for this user (asar is off, so its package.json is a plain file), or null. */
function readInstalledVersion() {
  try {
    const file = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Tavora", "resources", "app", "package.json");
    return JSON.parse(readFileSync(file, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desktop));
const releaseDir = path.join(desktop, "release");
const dryRun = process.argv.includes("--dry-run");
const skipE2e = process.argv.includes("--skip-e2e");
if (process.argv.includes("--allow-patch")) console.log("--allow-patch is no longer needed: patch versions are released like any other.");
const skipCi = process.argv.includes("--skip-ci-check");

// The upload key is checked before anything is built: TAVORA_DEPLOY_HOST and TAVORA_UPDATES_SSH_KEY.
if (!dryRun) {
  try {
    hello("updates");
  } catch (error) {
    console.error(`${error.message}\nNothing was built or published.`);
    process.exit(1);
  }
}
const feed = "https://updates.mytavora.app";
const REPO = "wellbrained/tavora";
function fail(message) {
  console.error(message);
  process.exit(1);
}
/** Stops a Release build this run no longer needs (best effort). */
function cancelRun(id) {
  if (!id) return;
  spawnSync("gh", ["run", "cancel", id, "--repo", REPO], { stdio: "ignore" });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8", shell: false, maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stderr) console.error(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}).`);
  }
  return options.capture ? result.stdout.trim() : "";
}
const git = (...args) => run("git", args, { capture: true });
const step = (text) => console.log(`\n== ${text}`);

const version = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8")).version;
const notes = readFileSync(path.join(desktop, "src", "shared", "patch-notes.ts"), "utf8");
const noteVersions = [...notes.matchAll(/^\s*version: "(\d+\.\d+\.\d+)"/gm)].map((m) => m[1]);

step(`Checking that ${version} can be released`);
git("fetch", "origin", "--tags", "--prune", "--quiet");
const problems = checkRelease(version, {
  branch: git("branch", "--show-current"),
  dirty: git("status", "--porcelain") !== "",
  ahead: Number(git("rev-list", "--count", "origin/main..HEAD")),
  behind: Number(git("rev-list", "--count", "HEAD..origin/main")),
  tags: git("tag", "--list", "v*").split(/\r?\n/).filter(Boolean),
  noteVersions,
});
if (problems.length) {
  console.error(`\nNot releasing ${version}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("Version, branch, tags and patch notes are in order.");

// The commit that gets built, uploaded and tagged. If main moves meanwhile (another
// session pulls into this checkout), the tag must still name what was built.
const built = git("rev-parse", "HEAD");

if (skipCi) console.log("GitHub Checks not consulted on request.");
else {
  step("GitHub Checks for this commit");
  let runs;
  try {
    runs = JSON.parse(run("gh", ["run", "list", "--workflow", "Checks", "--branch", "main", "--limit", "20", "--json", "status,conclusion,headSha,createdAt"], { capture: true }));
  } catch (error) {
    console.error(`Could not ask GitHub (${error.message}). Fix gh, or use --skip-ci-check.`);
    process.exit(1);
  }
  const ci = checkCi(runs, built);
  if (ci.length) {
    for (const problem of ci) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("Checks passed on this commit.");
}

const { feed: feedFiles, all: allFiles } = releaseFiles(version);
const installer = feedFiles[0];

// CI builds and tests with no secrets (.github/workflows/release-build.yml); this PC only checks and uploads.
step("Release build on GitHub: tests, installer, install-and-start check");
// A new nonce in the run's name: the run with exactly this name is the one started here, with these inputs.
const title = releaseRunTitle(version, !skipE2e, randomBytes(8).toString("hex"));
const nonce = /\(([0-9a-f]+)\)$/.exec(title)[1];
run("gh", ["workflow", "run", "release-build.yml", "--repo", REPO, "--ref", "main", "-f", `version=${version}`, "-f", `e2e=${!skipE2e}`, "-f", `nonce=${nonce}`]);
let ciRun;
for (let attempt = 0; attempt < 30 && !ciRun; attempt++) {
  const runs = JSON.parse(run("gh", ["run", "list", "--repo", REPO, "--workflow", "release-build.yml", "--branch", "main", "--event", "workflow_dispatch", "--limit", "20", "--json", "databaseId,headSha,displayTitle,status,event"], { capture: true }));
  const found = findDispatchedRun(runs, title, built);
  if (found.problem) {
    cancelRun(String(found.run?.databaseId ?? ""));
    fail(found.problem);
  }
  if (found.run) ciRun = found.run;
  else await new Promise((resolve) => setTimeout(resolve, 4000));
}
if (!ciRun) fail(`GitHub did not list the Release build "${title}" within two minutes. Nothing was published; check the Actions tab.`);
const runId = String(ciRun.databaseId);
// From here on, stopping early (a failed check, Ctrl+C) also stops the run on GitHub.
let finished = false;
process.on("SIGINT", () => {
  if (!finished) cancelRun(runId);
  process.exit(130);
});
console.log(`https://github.com/${REPO}/actions/runs/${runId} (about 25 minutes${skipE2e ? ", without e2e" : ""})`);
try {
  run("gh", ["run", "watch", runId, "--repo", REPO, "--exit-status", "--interval", "30"]);
} catch {
  // Also reached by Ctrl+C (it stops gh run watch too): stop the run as well; a finished run stays as it is.
  cancelRun(runId);
  fail(`The Release build failed or was stopped; see the run above. Nothing was published or tagged.`);
}
finished = true;

step("Downloading and checking what CI built");
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
run("gh", ["run", "download", runId, "--repo", REPO, "-n", `tavora-release-${version}`, "-D", releaseDir]);
const downloaded = new Map();
for (const name of allFiles) {
  const file = path.join(releaseDir, name);
  if (!existsSync(file)) continue;
  const bytes = readFileSync(file);
  downloaded.set(name, { sha256: createHash("sha256").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("base64") });
}
// The log can take a moment to be ready after the run ends.
let ciLog = "";
for (let attempt = 0; attempt < 5 && !ciLog; attempt++) {
  try {
    ciLog = run("gh", ["run", "view", runId, "--repo", REPO, "--log"], { capture: true });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
}
const ciHashes = readCiHashes(ciLog);
const latestYml = existsSync(path.join(releaseDir, "latest.yml")) ? readFileSync(path.join(releaseDir, "latest.yml"), "utf8") : "";
const downloadProblems = checkDownload(version, downloaded, ciHashes, latestYml);
if (downloadProblems.length) fail(`Not releasing ${version}:\n  - ${downloadProblems.join("\n  - ")}\nNothing was published or tagged.`);
// GitHub's signed statement that exactly these bytes came from this workflow, on main, at the commit checked above.
for (const name of allFiles) {
  try {
    run("gh", ["attestation", "verify", path.join(releaseDir, name), "--repo", REPO, "--signer-workflow", `${REPO}/.github/workflows/release-build.yml`, "--source-ref", "refs/heads/main", "--source-digest", built, "--deny-self-hosted-runners"], { capture: true });
  } catch {
    fail(`${name} has no valid attestation from the Release build of ${built.slice(0, 7)}. Nothing was published or tagged.`);
  }
}
console.log(`The files match what the Release build made from ${built.slice(0, 7)} (SHA-256 and attestation), and latest.yml points at the installer.`);

if (dryRun) {
  console.log("\nDry run: stopping before the upload. Nothing was published or tagged.");
  process.exit(0);
}

step("Checks by hand");
console.log(`Installer: ${path.join(releaseDir, installer)}`);
if (!asksHandChecks(version)) {
  console.log("Not asked before 1.0, these ran automatically:");
  for (const { check, coveredBy } of CHECKLIST) console.log(`  ${check} (${coveredBy})`);
} else {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  for (const [index, item] of CHECKLIST.entries()) {
    const answer = (await ask.question(`  ${item.check} [y/N] `)).trim().toLowerCase();
    if (answer !== "y") {
      ask.close();
      console.error("Not releasing: that check did not pass. Nothing was published or tagged.");
      process.exit(1);
    }
    // The checks count only on the new build: 0.17.3 was checked on an older install.
    const problem = index === 0 ? checkInstalled(readInstalledVersion(), version) : undefined;
    if (problem) {
      ask.close();
      console.error(`Not releasing: ${problem} Nothing was published or tagged.`);
      process.exit(1);
    }
  }
  ask.close();
}

step(`Publishing ${version} to ${feed}`);
// One tar with the three files; Windows' own tar (from Git Bash, `tar` is GNU tar, which reads C:\... as a host).
const bundle = path.join(tmpdir(), `tavora-updates-${version}.tar`);
const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
try {
  run(tar, ["-cf", bundle, "-C", releaseDir, ...feedFiles]);
  publish("updates", version, bundle);
} finally {
  rmSync(bundle, { force: true });
}

// The update is live from here on; what fails now is finished by hand, and the script says how.
step("Tagging");
try {
  git("tag", "-a", `v${version}`, built, "-m", `Tavora ${version}`);
  git("push", "origin", `v${version}`);
} catch (error) {
  fail(
    `${version} is published, but tagging failed (${error.message}). Finish by hand:\n` +
      `  git tag -a v${version} ${built} -m "Tavora ${version}"   (skip if the tag exists)\n` +
      `  git push origin v${version}\n` +
      `  gh release create v${version} --repo ${REPO} --verify-tag --title "Tavora ${version} (preview build)" --notes "Windows preview build of Tavora." ${allFiles.map((name) => `"${path.join(releaseDir, name)}"`).join(" ")}`,
  );
}

// The GitHub release gets the same verified files (and the zip), with the version's patch notes.
step("GitHub release");
try {
  const { PATCH_NOTES } = await import(pathToFileURL(path.join(desktop, "src", "shared", "patch-notes.ts")).href);
  const note = PATCH_NOTES.find((entry) => entry.version === version);
  const notesFile = path.join(tmpdir(), `tavora-release-notes-${version}.md`);
  writeFileSync(notesFile, releaseNotes(note));
  run("gh", ["release", "create", `v${version}`, "--repo", REPO, "--verify-tag", "--title", `Tavora ${version} (preview build)`, "--notes-file", notesFile, ...allFiles.map((name) => path.join(releaseDir, name))]);
  rmSync(notesFile, { force: true });
} catch (error) {
  console.error(`The update is published and tagged, but the GitHub release failed (${error.message}). Create it by hand from ${releaseDir}.`);
}

console.log(`\n${AFTER_RELEASE}`);
console.log(`\nReleased ${version}. Installed apps will pick it up within about 6 hours; new installs: ${feed}/${installer}`);
