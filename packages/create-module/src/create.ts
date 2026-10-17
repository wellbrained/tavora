import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isGameId, isModuleId } from "@tavora/module-schema";
import { VERSIONS } from "./versions.ts";

// Makes a new module project from a template: the shared files (manifest, README, styles,
// .gitignore) and the template's own (package.json, build config, page and code). Only the
// placeholders listed here are filled in; anything else in braces (such as Vue's own {{ }}) is
// left as it is.

export const TEMPLATES = ["vanilla", "vue", "react"] as const;
export type Template = (typeof TEMPLATES)[number];

export interface ModuleOptions {
  /** The project folder to make; it must not exist yet, or be empty. */
  dir: string;
  /** The module id, publisher.module-name. */
  id: string;
  /** The name players see. */
  name: string;
  template: Template;
  /** The game the module is made for (its id, such as poe2), or none for any game. */
  game?: string;
  /** The package manager the commands in the README use. */
  packageManager?: "npm" | "pnpm" | "yarn";
}

export class CreateError extends Error {}

/** The templates folder, next to dist/ (built) and src/ (in Tavora's repository). */
const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

/** A folder name as a lowercase slug: letters, digits and dashes, starting with a letter. */
export function slugOf(folder: string): string {
  const slug = path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug.slice(0, 60) : `module-${slug}`.replace(/-+$/, "").slice(0, 60);
}

/** What the starter offers when nothing was given: a name and an id from the folder's name. */
export function defaultsFor(folder: string): { id: string; name: string } {
  const slug = slugOf(folder);
  const name = slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
  return { id: `my.${slug}`, name: name || "My Module" };
}

/** Why an id cannot be used, or null. */
export function idProblem(id: string): string | null {
  if (!isModuleId(id)) return "an id looks like publisher.module-name: 2 to 5 parts of lowercase letters, digits and dashes, separated by dots, each starting with a letter";
  if (id.startsWith("tavora.")) return "ids starting with tavora. are Tavora's own";
  return null;
}

/** Why a name cannot be used, or null. */
export function nameProblem(name: string): string | null {
  return name.trim() === "" || name.length > 80 ? "a name is 1 to 80 characters" : null;
}

const run = (manager: ModuleOptions["packageManager"]) => (manager === "pnpm" ? "pnpm" : manager === "yarn" ? "yarn" : "npm run");
const exec = (manager: ModuleOptions["packageManager"]) => (manager === "pnpm" ? "pnpm exec" : manager === "yarn" ? "yarn" : "npx");
const install = (manager: ModuleOptions["packageManager"]) => (manager === "yarn" ? "yarn" : `${manager} install`);

/** Placeholders that are already JSON, standing outside quotes, so they are put in as they are. */
const RAW = new Set(["games"]);

/** Fills the placeholders of one file, escaped for where they stand. */
function fill(text: string, file: string, values: Record<string, string>): string {
  const escape = file.endsWith(".json")
    ? (value: string) => JSON.stringify(value).slice(1, -1)
    : file.endsWith(".html")
      ? (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      : (value: string) => value;
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? (RAW.has(key) ? values[key]! : escape(values[key]!)) : match));
}

async function files(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...(await files(root, relative)));
    else found.push(relative);
  }
  return found;
}

/** Makes the project and answers with the files it wrote, relative to `dir`. */
export async function createModule(options: ModuleOptions): Promise<string[]> {
  const problem = idProblem(options.id) ?? nameProblem(options.name);
  if (problem) throw new CreateError(problem);
  if (!TEMPLATES.includes(options.template)) throw new CreateError(`the template is one of ${TEMPLATES.join(", ")}`);
  if (options.game !== undefined && !isGameId(options.game)) throw new CreateError("a game id is lowercase letters, digits and dashes, such as poe2");
  const dir = path.resolve(options.dir);
  const existing = await readdir(dir).catch(() => null);
  if (existing && existing.length > 0) throw new CreateError(`${dir} is not empty`);

  const values: Record<string, string> = {
    id: options.id,
    name: options.name.trim(),
    description: `${options.name.trim()}, a Tavora module.`,
    games: JSON.stringify(options.game === undefined ? [] : [options.game]),
    package: slugOf(dir),
    sdkVersion: VERSIONS.sdk,
    packVersion: VERSIONS.pack,
    minTavora: VERSIONS.minTavora,
    run: run(options.packageManager),
    exec: exec(options.packageManager),
    install: install(options.packageManager),
  };
  const written: string[] = [];
  for (const source of ["shared", options.template]) {
    const root = path.join(TEMPLATES_DIR, source);
    for (const file of await files(root)) {
      // npm drops .gitignore from published packages, so it travels as gitignore.
      const target = file === "gitignore" ? ".gitignore" : file;
      const text = await readFile(path.join(root, file), "utf8");
      await mkdir(path.dirname(path.join(dir, target)), { recursive: true });
      await writeFile(path.join(dir, target), fill(text, target, values));
      written.push(target.split(path.sep).join("/"));
    }
  }
  return written.sort();
}
