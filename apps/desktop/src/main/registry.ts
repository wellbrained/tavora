import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { resolveAsset } from "./assets";

/**
 * Who publishes a module, shown to players next to its name. Official
 * modules ship with Tavora; every other module found on disk is local.
 * Community modules arrive with the catalog (Milestone E).
 */
export type Provenance = "official" | "local";

export interface InstalledModule {
  manifest: ModuleManifest;
  /** Real path of the package root; nothing outside it is ever served. */
  root: string;
  provenance: Provenance;
}

const MANIFEST = "tavora.module.json";

/** Module ids starting with this publisher are reserved for official modules. */
export const OFFICIAL_PREFIX = "tavora.";

/**
 * Modules that ship with Tavora as starting points for module authors: the
 * UI Playground and the example modules. The module library lists them under
 * Development instead of next to the modules players use.
 */
const DEVELOPMENT_MODULES = new Set([
  "tavora.playground",
  "local.example.vanilla-module",
  "local.example.react-module",
  "local.example.vue-module",
]);

export function isDevelopmentModule(id: string): boolean {
  return DEVELOPMENT_MODULES.has(id);
}

export interface ModuleSources {
  /** Modules that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  local?: string[];
}

/**
 * Finds module packages in each directory: the directory itself if it has a
 * manifest, otherwise its direct children. Invalid packages are skipped with
 * a warning so one broken module never blocks startup. Provenance comes from
 * where a module was found, never from its manifest, so a local module
 * cannot pass itself off as official.
 */
export async function discoverModules({ official = [], local = [] }: ModuleSources): Promise<Map<string, InstalledModule>> {
  const modules = new Map<string, InstalledModule>();
  const dirs = [
    ...official.map((dir) => ({ dir, provenance: "official" as const })),
    ...local.map((dir) => ({ dir, provenance: "local" as const })),
  ];
  for (const { dir, provenance } of dirs) {
    for (const candidate of await candidates(dir)) {
      const installed = await loadModule(candidate, provenance);
      if (!installed) continue;
      const { id } = installed.manifest;
      if (provenance !== "official" && id.startsWith(OFFICIAL_PREFIX)) {
        console.warn(`[tavora] module id ${id} in ${candidate} is reserved for official Tavora modules; skipping it`);
        continue;
      }
      if (modules.has(id)) {
        console.warn(`[tavora] duplicate module id ${id} in ${candidate}; keeping the first one`);
        continue;
      }
      modules.set(id, installed);
    }
  }
  return modules;
}

async function candidates(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === MANIFEST)) return [dir];
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function loadModule(dir: string, provenance: Provenance): Promise<InstalledModule | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[tavora] unreadable manifest in ${dir}`);
    return undefined;
  }
  const result = validateManifest(raw);
  if (!result.ok) {
    console.warn(`[tavora] invalid module in ${dir}: ${result.errors.join("; ")}`);
    return undefined;
  }
  const root = await realpath(dir);
  if (!(await resolveAsset(root, `/${result.manifest.entry}`))) {
    console.warn(`[tavora] module ${result.manifest.id} has no entry file ${result.manifest.entry}; is it built?`);
    return undefined;
  }
  if (result.manifest.icon !== undefined && !(await resolveAsset(root, `/${result.manifest.icon}`))) {
    console.warn(`[tavora] module ${result.manifest.id} has no icon file ${result.manifest.icon}`);
    return undefined;
  }
  return { manifest: result.manifest, root, provenance };
}
