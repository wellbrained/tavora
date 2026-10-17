import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { LOCAL_OWNER, needsNewerTavora, OFFICIAL_OWNER, validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { resolveAsset } from "./assets";
import { moduleIconUrl } from "./module-icon";

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
  /**
   * Who owns the module's data and browser storage: `official`, `local`, or
   * a publisher key's fingerprint (isOwnerId). Data is keyed by owner and id,
   * so a module that only claims another's id never sees its data (S5).
   */
  owner: string;
  /** Part of the host (the Browser), not a package on disk. */
  builtIn?: true;
}

const MANIFEST = "tavora.module.json";

/** Module ids starting with this publisher are reserved for official modules. */
export const OFFICIAL_PREFIX = "tavora.";

/** The id the Browser is listed under in the module library; reserved like every `tavora.` id. */
export const BROWSER_MODULE_ID = "tavora.browser";

/** The official Discord module (modules/discord), which Tavora moves the built-in panel's settings to. */
export const DISCORD_MODULE_ID = "tavora.discord";

/** The official AI Usage module (modules/ai-usage), which Tavora moves the built-in panel's settings to. */
export const AI_USAGE_MODULE_ID = "tavora.ai-usage";

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

/** A folder that looks like a module but could not be loaded, and why, in words a player can read. */
export interface ModuleProblem {
  folder: string;
  message: string;
}

export interface ModuleSources {
  /** Modules that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  local?: string[];
  /** This Tavora's version; a module whose `minTavora` is newer is not loaded. */
  tavoraVersion?: string;
}

/**
 * Finds module packages in each directory: the directory itself if it has a
 * manifest, otherwise its direct children. Invalid packages are skipped with
 * a warning so one broken module never blocks startup. Provenance comes from
 * where a module was found, never from its manifest, so a local module
 * cannot pass itself off as official.
 */
export async function discoverModules(
  { official = [], local = [], tavoraVersion }: ModuleSources,
  problems: ModuleProblem[] = [],
): Promise<Map<string, InstalledModule>> {
  const modules = new Map<string, InstalledModule>();
  const dirs = [
    ...official.map((dir) => ({ dir, provenance: "official" as const })),
    ...local.map((dir) => ({ dir, provenance: "local" as const })),
  ];
  for (const { dir, provenance } of dirs) {
    for (const candidate of await candidates(dir)) {
      const installed = await loadModule(candidate, provenance, tavoraVersion, (message) => {
        if (provenance === "local") problems.push({ folder: path.basename(candidate), message });
      });
      if (!installed) continue;
      const { id } = installed.manifest;
      if (provenance !== "official" && id.startsWith(OFFICIAL_PREFIX)) {
        console.warn(`[tavora] module id ${id} in ${candidate} is reserved for official Tavora modules; skipping it`);
        problems.push({ folder: path.basename(candidate), message: "its id is reserved for Tavora's own modules" });
        continue;
      }
      if (provenance !== "official" && installed.manifest.permissions.webAssembly === true) {
        console.warn(`[tavora] module ${id} in ${candidate} asks to run WebAssembly, which only Tavora's own modules may; skipping it`);
        problems.push({ folder: path.basename(candidate), message: "permissions.webAssembly is only for Tavora's own modules" });
        continue;
      }
      if (modules.has(id)) {
        console.warn(`[tavora] duplicate module id ${id} in ${candidate}; keeping the first one`);
        if (provenance === "local") problems.push({ folder: path.basename(candidate), message: "another module with the same id is already loaded" });
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

async function loadModule(dir: string, provenance: Provenance, tavoraVersion: string | undefined, problem: (message: string) => void): Promise<InstalledModule | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[tavora] unreadable manifest in ${dir}`);
      problem("its tavora.module.json cannot be read");
    }
    return undefined;
  }
  const result = validateManifest(raw);
  if (!result.ok) {
    console.warn(`[tavora] invalid module in ${dir}: ${result.errors.join("; ")}`);
    problem(result.errors.slice(0, 2).join("; "));
    return undefined;
  }
  if (tavoraVersion !== undefined && needsNewerTavora(result.manifest, tavoraVersion)) {
    console.warn(`[tavora] module ${result.manifest.id} needs Tavora ${result.manifest.minTavora}; this is ${tavoraVersion}`);
    problem(`it needs Tavora ${result.manifest.minTavora} or newer (this is ${tavoraVersion})`);
    return undefined;
  }
  const root = await realpath(dir);
  if (!(await resolveAsset(root, `/${result.manifest.entry}`))) {
    console.warn(`[tavora] module ${result.manifest.id} has no entry file ${result.manifest.entry}; is it built?`);
    problem(`the entry file ${result.manifest.entry} is missing (is it built?)`);
    return undefined;
  }
  if (result.manifest.icon !== undefined && !(await resolveAsset(root, `/${result.manifest.icon}`))) {
    console.warn(`[tavora] module ${result.manifest.id} has no icon file ${result.manifest.icon}`);
    problem(`the icon file ${result.manifest.icon} is missing`);
    return undefined;
  }
  return { manifest: result.manifest, root, provenance, owner: provenance === "official" ? OFFICIAL_OWNER : LOCAL_OWNER };
}

export interface ModuleInfo {
  /** Where the module was found, without a full path; the host UI words it. */
  origin: { kind: "official" | "example" | "own" | "dev"; folder: string };
  /** Only a direct child of the player's own modules folder can be removed from Settings. */
  removable: boolean;
  /** The manifest icon as a data address, or null (see module-icon.ts). */
  icon: string | null;
}

/** Where each module was found, and whether Settings may remove it. */
export async function describeModules(userModules: string, modules: Map<string, InstalledModule>): Promise<Map<string, ModuleInfo>> {
  const userRoot = await realpath(userModules).catch(() => path.resolve(userModules));
  const info = new Map<string, ModuleInfo>();
  for (const [id, module] of modules) {
    const own = module.provenance === "local" && path.dirname(module.root) === userRoot;
    const kind = module.provenance === "official" ? "official" : isDevelopmentModule(id) ? "example" : own ? "own" : "dev";
    const origin = { kind, folder: path.basename(module.root) } as const;
    info.set(id, { origin, removable: own, icon: await moduleIconUrl(module.root, module.manifest.icon) });
  }
  return info;
}

/**
 * The Browser is built into the host, not a module package
 * (the Browser security notes), but it is listed, docked and saved in layouts
 * like an official module. It has no files, so `root` is empty and nothing
 * is ever served for it.
 */
export function browserModule(version: string): InstalledModule {
  return {
    manifest: {
      id: BROWSER_MODULE_ID,
      name: "Browser",
      description: "Wikis, maps, guides and videos next to your game. Ads blocked, no downloads.",
      version,
      apiVersion: "1",
      entry: "",
      games: [],
      // The minimum height includes the toolbar the host draws above the page.
      viewport: { minWidth: 360, minHeight: 280, preferredWidth: 900, preferredHeight: 700 },
      permissions: { network: [] },
    },
    root: "",
    provenance: "official",
    owner: OFFICIAL_OWNER,
    builtIn: true,
  };
}
