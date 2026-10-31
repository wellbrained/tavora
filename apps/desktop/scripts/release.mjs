// `pnpm release`: publishes the Windows app's current version (patch or minor) to updates.mytavora.app.
// Run on the maintainer's PC from a clean, up-to-date main.
//
//   pnpm release              checks, builds, uploads, tags and pushes the tag
//   pnpm release --dry-run    checks and builds, then stops before the upload
//   pnpm release --skip-e2e   leaves out the e2e suite (only for a retry after it passed)
//   pnpm release --skip-ci-check  releases without asking GitHub whether Checks passed (offline only)
//
// Before 1.0 the by-hand checks are listed with what already covers them, not asked (asksHandChecks).
//
// Uploads with the restricted tavora-updates key (deploy/README.md). On the server tavora-receive puts the
// installer and its blockmap first and latest.yml last, so a manifest never points at a file that is not
// there yet, and refuses a version that is not newer than the live one.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { AFTER_RELEASE, CHECKLIST, asksHandChecks, checkCi, checkInstalled, checkRelease } from "./release-guards.mjs";
import { checkStart } from "./start-check.mjs";
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

// Some shells (an agent's in T3 Code) set this, and every Electron started below would then run as
// plain Node: the e2e suite and the packaged start check would fail. The child processes inherit it.
delete process.env.ELECTRON_RUN_AS_NODE;

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stderr) console.error(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}).`);
  }
  return options.capture ? result.stdout.trim() : "";
}
const git = (...args) => run("git", args, { capture: true });
const pnpm = (...args) => run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, { shell: process.platform === "win32" });
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

step("Typecheck and unit tests");
pnpm("typecheck");
pnpm("test");
if (skipE2e) console.log("e2e skipped on request.");
else {
  step("e2e tests");
  pnpm("build");
  pnpm("test:e2e");
}

step("Building the installer");
pnpm("build");
rmSync(releaseDir, { recursive: true, force: true });
pnpm("--filter", "@tavora/desktop", "package", "--win", "--publish", "never");

if (git("rev-parse", "HEAD") !== built) throw new Error("HEAD moved while building (a pull in this checkout?). Nothing was published; start again.");

const installer = `Tavora-Setup-${version}.exe`;
const files = [installer, `${installer}.blockmap`, "latest.yml"].map((name) => path.join(releaseDir, name));
for (const file of files) if (!existsSync(file)) throw new Error(`The build did not produce ${path.basename(file)}.`);
if (!new RegExp(`^version: ${version.replaceAll(".", "\\.")}$`, "m").test(readFileSync(files[2], "utf8"))) {
  throw new Error(`latest.yml does not say version ${version}.`);
}
console.log(`Built ${installer} and its update files.`);

// The installed app's full start is checked on CI (Checks, packaged-start); this catches a
// build that quits at once. Next to a running Tavora it can only get as far as the handover.
step("Starting the packaged build");
const started = await checkStart(path.join(releaseDir, "win-unpacked", "Tavora.exe"), { allowHandover: true });
console.log(started === "window" ? "It started and showed its window." : "It handed over to a Tavora that is already running (the window check ran on CI).");

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
  run(tar, ["-cf", bundle, "-C", releaseDir, ...files.map((file) => path.basename(file))]);
  publish("updates", version, bundle);
} finally {
  rmSync(bundle, { force: true });
}

step("Tagging");
git("tag", "-a", `v${version}`, built, "-m", `Tavora ${version}`);
git("push", "origin", `v${version}`);

console.log(`\n${AFTER_RELEASE}`);
console.log(`\nReleased ${version}. Installed apps will pick it up within about 6 hours; new installs: ${feed}/${installer}`);
