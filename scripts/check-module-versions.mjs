#!/usr/bin/env node
// A built-in module (modules/<name>, id tavora.*) that a pull request changes must raise its version in tavora.module.json:
// built-in modules update from the catalogue without an app release, so their version is what tells two copies apart.
// The kit (modules/shared) is bundled into every one of them, so a kit change asks for a raise of each.
// Tests and Markdown don't end up in a build and don't count.
//
//   node scripts/check-module-versions.mjs <base> [head]     (CI: origin/main and the pull request's head)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Files that don't change what a module ships. */
export const ignored = (file) => /\.test\.[cm]?[jt]sx?$/.test(file) || /(^|\/)__snapshots__\//.test(file) || file.endsWith(".md");

/** The built-in modules whose shipped files changed: `modules/<name>/...`, and all of them for a kit change. */
export function touchedModules(files, modules) {
  const touched = new Set();
  for (const file of files) {
    if (ignored(file)) continue;
    const [top, name] = file.split("/");
    if (top !== "modules" || !name || !file.slice(`modules/${name}`.length).startsWith("/")) continue;
    if (name === "shared") modules.forEach((module) => touched.add(module));
    else if (modules.includes(name)) touched.add(name);
  }
  return [...touched].sort();
}

const parts = (version) => version.split(/[.+-]/).slice(0, 3).map(Number);

/** Whether `next` is a higher x.y.z than `before`. */
export function raised(before, next) {
  const [a, b] = [parts(before), parts(next)];
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return b[index] > a[index];
  return false;
}

/** What is wrong, one line per module: `versionAt(module, "base" | "head")` reads a manifest's version (null when it isn't there). */
export function problems(files, modules, versionAt) {
  const out = [];
  for (const module of touchedModules(files, modules)) {
    const before = versionAt(module, "base");
    const next = versionAt(module, "head");
    // A new module, or one that is gone, has nothing to compare.
    if (before === null || next === null) continue;
    if (!raised(before, next)) out.push(`modules/${module}: files changed, but its version is still ${next} (raise it in modules/${module}/tavora.module.json and add a changelog line).`);
  }
  return out;
}

function main() {
  const [base = "origin/main", head = "HEAD"] = process.argv.slice(2);
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const from = git("merge-base", base, head).trim();
  const files = git("diff", "--name-only", from, head).split("\n").filter(Boolean);
  const show = (ref, path) => {
    try {
      return git("show", `${ref}:${path}`);
    } catch {
      return null;
    }
  };
  const modules = git("ls-tree", "--name-only", `${head}:modules`)
    .split("\n")
    .filter((name) => name && name !== "shared" && JSON.parse(show(head, `modules/${name}/tavora.module.json`) ?? "{}").id?.startsWith("tavora."));
  const versionAt = (module, side) => {
    const text = show(side === "base" ? from : head, `modules/${module}/tavora.module.json`);
    return text === null ? null : (JSON.parse(text).version ?? null);
  };
  const found = problems(files, modules, versionAt);
  if (found.length) {
    console.error(`Built-in modules changed without a version raise (CLAUDE.md, "Built-in modules"):\n${found.map((line) => `- ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Module versions: ${touchedModules(files, modules).length} changed module(s), each raised.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
