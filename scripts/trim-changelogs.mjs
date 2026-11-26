#!/usr/bin/env node
// A module's changelog.json may list 100 versions at most (CHANGELOG_LIMITS in packages/module-schema): the app, the
// packer and the catalogue refuse a longer one. The Number workflow runs this on main and cuts a long one back, oldest
// first, so a pull request that raises a built-in module always has room for its entry.
//
//   node scripts/trim-changelogs.mjs     (prints a commit message when it trimmed something, nothing otherwise)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The versions kept: under the limit by more entries than a pull request adds before main is trimmed again. */
export const KEEP = 90;

/** The file's text with only the newest `KEEP` versions (they come first), or null when it has room already. */
export function trimmed(text) {
  const entries = JSON.parse(text);
  if (!Array.isArray(entries) || entries.length <= KEEP) return null;
  const next = `${JSON.stringify(entries.slice(0, KEEP), null, 2)}\n`;
  return text.includes("\r\n") ? next.replaceAll("\n", "\r\n") : next;
}

/** Trims every `modules/<name>/changelog.json` under `root`; returns the names of those it changed. */
export function trimAll(root) {
  const done = [];
  for (const name of readdirSync(path.join(root, "modules"))) {
    const file = path.join(root, "modules", name, "changelog.json");
    if (!existsSync(file)) continue;
    const next = trimmed(readFileSync(file, "utf8"));
    if (next === null) continue;
    writeFileSync(file, next);
    done.push(name);
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const done = trimAll(process.cwd());
  if (done.length) console.log(`Trim old module patch notes: ${done.join(", ")}`);
}
