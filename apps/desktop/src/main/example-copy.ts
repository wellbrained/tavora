import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateManifest } from "@tavora/module-schema";
import sdkPackage from "@tavora/sdk/package.json" with { type: "json" };
import { MANIFEST } from "./registry";
import { UserError } from "./messages";

// Make a copy (decided 2026-10-21, "Dev modules and project folders"): an example that ships with Tavora
// becomes the developer's own project. Tavora copies the example's sources (never node_modules or a
// build) into a new folder named after the module, and rewrites what only works inside the Tavora
// repository: the module gets its own id, name and version 0.1.0, the SDK comes from npm instead of the
// workspace, and the TypeScript settings no longer point at the repository's shared ones. Everything else
// stays as the example has it, so the copy builds the same way with `npm install` and `npm run dev`.

/** Where the copy's manifest finds its schema, as projects made with `npm create @tavora/module` do. */
const SCHEMA_URL = "https://docs.mytavora.app/schema/tavora.module.schema.json";
/** The TypeScript a copy installs for its typecheck script, as `npm create @tavora/module` does. */
const TYPESCRIPT_RANGE = "^5.9.3";
/** Node's types, for a copy whose build config imports from Node (in the repository, they come from the workspace). */
const NODE_TYPES_RANGE = "^22.20.5";
/** Folders and files of an example that are never copied: installs, builds, and hidden ones. */
const SKIPPED = new Set(["node_modules", "dist"]);
/** Most files and bytes copied from one example; the examples are far smaller. */
const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * The repository's tsconfig.base.json without what only the repository uses (its "source" condition and
 * declaration output). A copy has these in its own tsconfig.json; example-copy.test.ts keeps them the same.
 */
export const BASE_COMPILER_OPTIONS = {
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "Bundler",
  lib: ["ES2022", "DOM"],
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  skipLibCheck: true,
};

/** The SDK version range a copy depends on: the SDK that ships with this Tavora, or newer. */
export const SDK_RANGE = `^${sdkPackage.version}`;

/** A folder and package name from a module name, and the part of its id after the prefix: lowercase letters, digits and dashes. */
export function slugOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "my-module";
}

export interface ExampleCopy {
  id: string;
  name: string;
}

/**
 * Copies the example in `source` into the new folder `target`, as the module `copy`. The folder must not
 * exist yet; when anything goes wrong, nothing of it is left behind.
 */
export async function copyExample(source: string, target: string, copy: ExampleCopy): Promise<void> {
  const files = await exampleFiles(source);
  const config = files.includes("vite.config.ts") ? await readFile(path.join(source, "vite.config.ts"), "utf8") : "";
  const context: Context = { ...copy, nodeTypes: /from\s+["']node:/.test(config) };
  try {
    await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UserError("error.copyExists", { folder: path.basename(target) });
    throw error;
  }
  try {
    for (const file of files) {
      const to = path.join(target, file);
      await mkdir(path.dirname(to), { recursive: true });
      const rewrite = REWRITES[file];
      if (rewrite) await writeFile(to, rewrite(await readFile(path.join(source, file), "utf8"), context));
      else await copyFile(path.join(source, file), to);
    }
    if (!files.includes(".gitignore")) await writeFile(path.join(target, ".gitignore"), "node_modules/\ndist/\n");
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

/** The example's files to copy, relative to it, with `/` between folders. */
async function exampleFiles(source: string): Promise<string[]> {
  const files: string[] = [];
  let bytes = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) {
        bytes += (await stat(path.join(dir, entry.name))).size;
        files.push(relative);
        if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new UserError("error.copyTooBig");
      }
    }
  };
  await walk(source, "");
  if (!files.includes(MANIFEST)) throw new UserError("error.copyNoExample");
  return files.sort();
}

type Json = Record<string, unknown>;

interface Context extends ExampleCopy {
  /** The build config imports from Node, so the typecheck needs Node's types. */
  nodeTypes: boolean;
}

function parse(text: string, file: string): Json {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  } catch {
    // Said below.
  }
  throw new UserError("publish.error.badFile", { file });
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The files a copy changes, each from the example's text to the copy's. */
const REWRITES: Record<string, (text: string, copy: Context) => string> = {
  [MANIFEST]: (text, copy) => {
    const manifest = { ...parse(text, MANIFEST), $schema: SCHEMA_URL, id: copy.id, name: copy.name, version: "0.1.0" };
    if (!validateManifest(manifest).ok) throw new UserError("publish.error.badId");
    // $schema first, as in a new project.
    const { $schema, ...rest } = manifest;
    return json({ $schema, ...rest });
  },
  "package.json": (text, copy) => {
    const pkg = parse(text, "package.json");
    const dependencies = fromNpm(pkg.dependencies);
    const devDependencies = fromNpm(pkg.devDependencies);
    const scripts = { ...(pkg.scripts as Record<string, string> | undefined) };
    // The hint for a project that isn't built says `npm run dev`.
    scripts.dev ??= "vite build --watch";
    const typecheck = Object.values(scripts).some((script) => /\b(vue-)?tsc\b/.test(script));
    if (typecheck && !dependencies.typescript) devDependencies.typescript ??= TYPESCRIPT_RANGE;
    if (typecheck && copy.nodeTypes && !dependencies["@types/node"]) devDependencies["@types/node"] ??= NODE_TYPES_RANGE;
    return json({ ...pkg, name: slugOf(copy.name), version: "0.1.0", scripts, dependencies, devDependencies: sorted(devDependencies) });
  },
  "tsconfig.json": (text) => {
    const config = parse(text, "tsconfig.json");
    if (typeof config.extends !== "string" || !config.extends.startsWith("../")) return text;
    const { extends: _repository, compilerOptions, ...rest } = config;
    return json({ compilerOptions: { ...BASE_COMPILER_OPTIONS, ...(compilerOptions as Json | undefined) }, ...rest });
  },
};

/** Dependencies with the Tavora workspace's own packages taken from npm instead; only the SDK is on npm. */
function fromNpm(value: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries((value ?? {}) as Record<string, string>)) {
    if (!range.startsWith("workspace:")) dependencies[name] = range;
    else if (name === "@tavora/sdk") dependencies[name] = SDK_RANGE;
    else throw new UserError("error.copyWorkspace", { name });
  }
  return dependencies;
}

const sorted = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
