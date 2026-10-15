// `pnpm release`: publishes a minor version of the Windows app to updates.mytavora.app.
// Run on Nik's PC from a clean, up-to-date main whose version is x.y.0.
//
//   pnpm release              checks, builds, uploads, tags and pushes the tag
//   pnpm release --dry-run    checks and builds, then stops before the upload
//   pnpm release --skip-e2e   leaves out the e2e suite (only for a retry after it passed)
//   pnpm release --allow-patch  a one-off release of a patch version (x.y.z), e.g. to try an update
//   pnpm release --skip-ci-check  releases without asking GitHub whether Checks passed (offline only)
//
// Order on the server: the installer and its blockmap first, latest.yml last, so a
// manifest never points at a file that is not there yet (deploy/tavora-updates-publish.sh).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { AFTER_RELEASE, CHECKLIST, checkCi, checkRelease } from "./release-guards.mjs";

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(path.dirname(desktop));
const releaseDir = path.join(desktop, "release");
const dryRun = process.argv.includes("--dry-run");
const skipE2e = process.argv.includes("--skip-e2e");
const allowPatch = process.argv.includes("--allow-patch");
const skipCi = process.argv.includes("--skip-ci-check");

// Same server and key as the docs and the service use.
const key = "D:\\Server\\vpn ssh-key-2026-10-05.key";
const remote = "root@100.92.36.114";
const sshOptions = ["-i", key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15"];
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
}, { allowPatch });
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

if (dryRun) {
  console.log("\nDry run: stopping before the upload. Nothing was published or tagged.");
  process.exit(0);
}

if (!dryRun) {
  step("Checks by hand");
  console.log(`Installer: ${path.join(releaseDir, installer)}`);
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  for (const item of CHECKLIST) {
    const answer = (await ask.question(`  ${item} [y/N] `)).trim().toLowerCase();
    if (answer !== "y") {
      ask.close();
      console.error("Not releasing: that check did not pass. Nothing was published or tagged.");
      process.exit(1);
    }
  }
  ask.close();
}

step(`Publishing ${version} to ${feed}`);
const incoming = "/tmp/tavora-updates-incoming";
const script = path.join(desktop, "deploy", "tavora-updates-publish.sh");
const ssh = (command) => run("ssh.exe", [...sshOptions, remote, command]);
ssh(`rm -rf ${incoming} && mkdir -p ${incoming}`);
run("scp.exe", [...sshOptions, ...files, `${remote}:${incoming}/`]);
run("scp.exe", [...sshOptions, script, `${remote}:/tmp/`]);
ssh(`bash /tmp/tavora-updates-publish.sh ${version}${allowPatch ? " allow-patch" : ""}`);

step("Tagging");
git("tag", "-a", `v${version}`, built, "-m", `Tavora ${version}`);
git("push", "origin", `v${version}`);

console.log(`\n${AFTER_RELEASE}`);
console.log(`\nReleased ${version}. Installed apps will pick it up within about 6 hours; new installs: ${feed}/${installer}`);
