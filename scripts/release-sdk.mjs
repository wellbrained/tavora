// `pnpm release:sdk`: publishes the module developer packages to npm (@tavora/sdk,
// @tavora/module-schema, @tavora/pack, @tavora/create-module). Run by hand on the
// maintainer's PC from a clean, up-to-date main; it never runs in CI.
//
//   pnpm release:sdk            checks, tests, builds, packs and publishes what is new
//   pnpm release:sdk --dry-run  the same, but npm only shows what it would publish
//
// A package is published when its version is not on npm yet, so raise the version
// (and add its changelog entry) of each package that changed. npm asks for the
// second factor of the account that owns the @tavora organisation; log in once
// first with `npm login` (or `pnpm dlx npm@11 login` without npm installed).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSdkRelease, PACKAGES } from "./release-sdk-guards.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dryRun = process.argv.includes("--dry-run");
const windows = process.platform === "win32";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8", shell: windows, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stderr) console.error(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}).`);
  }
  return options.capture ? result.stdout.trim() : "";
}
const git = (...args) => run("git", args, { capture: true, shell: false });
const pnpm = (args, options) => run("pnpm", args, options);
const step = (text) => console.log(`\n== ${text}`);

/** The versions npm has of `name`; none for a package that was never published. */
async function publishedVersions(name) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`npm answered ${response.status} for ${name}.`);
  return Object.keys((await response.json()).versions ?? {});
}

/** pnpm 10 publishes through npm; without npm on PATH, a pinned npm runs through pnpm dlx. */
function npm(args, options) {
  const found = spawnSync(windows ? "where" : "which", ["npm"], { stdio: "ignore" }).status === 0;
  return found ? run("npm", args, options) : pnpm(["dlx", "npm@11", ...args], options);
}

step("Checking what can be released");
git("fetch", "origin", "--prune", "--quiet");
const packages = [];
for (const dir of PACKAGES) {
  const folder = path.join(repo, "packages", dir);
  const { name, version } = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
  let changelog = null;
  try {
    changelog = readFileSync(path.join(folder, "CHANGELOG.md"), "utf8");
  } catch {}
  packages.push({ dir, name, version, changelog, published: await publishedVersions(name) });
}
const { problems, toPublish } = checkSdkRelease({
  branch: git("branch", "--show-current"),
  dirty: git("status", "--porcelain") !== "",
  ahead: Number(git("rev-list", "--count", "origin/main..HEAD")),
  behind: Number(git("rev-list", "--count", "HEAD..origin/main")),
  packages,
});
if (problems.length) {
  console.error("\nNot releasing:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const releasing = packages.filter((pkg) => toPublish.includes(pkg.name));
console.log(releasing.map((pkg) => `  ${pkg.name} ${pkg.version}`).join("\n"));

step("Typecheck and tests");
pnpm(["typecheck"]);
pnpm(["test"]);

step("Building the packages");
pnpm(["-r", "--filter", "./packages/*", "build"]);

// pnpm pack turns workspace: ranges into real versions and applies publishConfig.
const out = mkdtempSync(path.join(tmpdir(), "tavora-release-sdk-"));
try {
  for (const pkg of releasing) {
    step(`${dryRun ? "Trying" : "Publishing"} ${pkg.name} ${pkg.version}`);
    const before = new Set(readdirSync(out));
    pnpm(["pack", "--pack-destination", out], { cwd: path.join(repo, "packages", pkg.dir) });
    const tarball = readdirSync(out).find((file) => !before.has(file));
    npm(["publish", path.join(out, tarball), "--access", "public", ...(dryRun ? ["--dry-run"] : [])]);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(dryRun ? "\nDry run done; nothing was published." : `\nPublished ${releasing.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}.`);
