// `pnpm release:sdk`: publishes the module developer packages to npm (@tavora/sdk,
// @tavora/module-schema, @tavora/pack, @tavora/create-module), from a clean, up-to-date main.
// Usually through the "Release SDK packages" workflow (.github/workflows/release-sdk.yml): started by
// hand, approved by the maintainer in the `npm` environment, published with npm trusted publishing (no
// token, with provenance). It still runs on the maintainer's PC the same way.
//
//   pnpm release:sdk            checks, tests, builds, packs and publishes what is new
//   pnpm release:sdk --dry-run  the same, but npm only shows what it would publish
//   pnpm release:sdk --pack-to <folder>
//                               the same checks, but leaves the packages in <folder> (named 1-…, 2-… in
//                               publishing order) instead of publishing; the workflow's publish job uploads them
//
// A package is published when its version is not on npm yet, so raise the version
// (and add its changelog entry) of each package that changed. npm asks for the
// second factor of the account that owns the @tavora organisation on a PC; log in
// first with `npm login` (or `pnpm dlx npm@11 login` without npm installed). The login
// expires after a while, and npm then answers a publish with "404 Not Found".
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSdkRelease, PACKAGES } from "./release-sdk-guards.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dryRun = process.argv.includes("--dry-run");
const packAt = process.argv.indexOf("--pack-to");
/** Where --pack-to leaves the packages; null to publish them here. */
const packTo = packAt === -1 ? null : path.resolve(process.argv[packAt + 1] ?? "");
if (packTo !== null && !process.argv[packAt + 1]) throw new Error("--pack-to needs a folder.");
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
    step(`${packTo ? "Packing" : dryRun ? "Trying" : "Publishing"} ${pkg.name} ${pkg.version}`);
    const before = new Set(readdirSync(out));
    pnpm(["pack", "--pack-destination", out], { cwd: path.join(repo, "packages", pkg.dir) });
    const tarball = readdirSync(out).find((file) => !before.has(file));
    if (packTo) {
      mkdirSync(packTo, { recursive: true });
      copyFileSync(path.join(out, tarball), path.join(packTo, `${releasing.indexOf(pkg) + 1}-${tarball}`));
      continue;
    }
    npm(["publish", path.join(out, tarball), "--access", "public", ...(dryRun ? ["--dry-run"] : [])]);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(packTo ? `\nPacked in ${packTo}; nothing was published.` : dryRun ? "\nDry run done; nothing was published." : `\nPublished ${releasing.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}.`);
