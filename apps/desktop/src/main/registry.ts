import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { LOCAL_OWNER, manifestFiles, needsNewerTavora, OFFICIAL_OWNER, validateManifest, type ModuleManifest } from "@tavora/module-schema";
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
  /** Loaded from this development folder, as the player added it in Settings > Modules. */
  developmentFolder?: string;
}

export const MANIFEST = "tavora.module.json";

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
  "local.example.panels-module",
]);

export function isDevelopmentModule(id: string): boolean {
  return DEVELOPMENT_MODULES.has(id);
}

/** A folder that looks like a module but could not be loaded, and why, in words a player can read. */
export interface ModuleProblem {
  folder: string;
  message: string;
  /** For a development folder: its full path, so Settings shows the problem next to it. */
  developmentFolder?: string;
}

export interface ModuleSources {
  /** Modules that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  /**
   * Module project folders a developer added (Settings > Modules). Each is one module, never a
   * folder of modules; they come before the other local folders, so a project wins over an
   * installed copy of the same module.
   */
  development?: string[];
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
  { official = [], development = [], local = [], tavoraVersion }: ModuleSources,
  problems: ModuleProblem[] = [],
): Promise<Map<string, InstalledModule>> {
  const modules = new Map<string, InstalledModule>();
  const dirs = [
    ...official.map((dir) => ({ dir, provenance: "official" as const, development: false })),
    ...development.map((dir) => ({ dir, provenance: "local" as const, development: true })),
    ...local.map((dir) => ({ dir, provenance: "local" as const, development: false })),
  ];
  for (const { dir, provenance, development: fromProject } of dirs) {
    const project = fromProject ? await projectCandidate(dir) : undefined;
    if (project === "missing") problems.push({ folder: path.basename(dir), message: "this folder can't be found", developmentFolder: dir });
    else if (project?.length === 0) problems.push({ folder: path.basename(dir), message: "there is no tavora.module.json in this folder", developmentFolder: dir });
    const found = project === undefined ? await candidates(dir) : project === "missing" ? [] : project;
    for (const candidate of found) {
      const report = (message: string) => problems.push({ folder: path.basename(candidate), message, ...(fromProject ? { developmentFolder: dir } : {}) });
      const installed = await loadModule(candidate, provenance, tavoraVersion, (message) => {
        if (provenance === "local") report(message);
      });
      if (!installed) continue;
      if (fromProject) installed.developmentFolder = dir;
      const { id } = installed.manifest;
      if (provenance !== "official" && id.startsWith(OFFICIAL_PREFIX)) {
        console.warn(`[tavora] module id ${id} in ${candidate} is reserved for official Tavora modules; skipping it`);
        report("its id is reserved for Tavora's own modules");
        continue;
      }
      if (provenance !== "official" && installed.manifest.permissions.webAssembly === true) {
        console.warn(`[tavora] module ${id} in ${candidate} asks to run WebAssembly, which only Tavora's own modules may; skipping it`);
        report("permissions.webAssembly is only for Tavora's own modules");
        continue;
      }
      if (modules.has(id)) {
        console.warn(`[tavora] duplicate module id ${id} in ${candidate}; keeping the first one`);
        if (provenance === "local") report("another module with the same id is already loaded");
        continue;
      }
      modules.set(id, installed);
    }
  }
  return modules;
}

/** A development folder is one module: the folder itself when it has a manifest, else nothing ("missing" when the folder is gone). */
async function projectCandidate(dir: string): Promise<string[] | "missing"> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name === MANIFEST) ? [dir] : [];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : [];
  }
}

/**
 * The folder a module's build goes into: the first folder of its manifest's entry, such as `dist`
 * for `dist/index.html`. Undefined when the entry sits in the project folder itself or outside it.
 */
export function buildFolderName(entry: string): string | undefined {
  const [first, ...rest] = path.normalize(entry).split(path.sep);
  return first && rest.length > 0 && first !== ".." ? first : undefined;
}

/** The entry a development folder's manifest names, even when the manifest does not validate yet. */
export async function projectEntry(dir: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
    const entry = typeof raw === "object" && raw !== null ? (raw as { entry?: unknown }).entry : undefined;
    return typeof entry === "string" ? entry : undefined;
  } catch {
    return undefined;
  }
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
  const { entries, icons } = manifestFiles(result.manifest);
  for (const entry of entries) {
    if (await resolveAsset(root, `/${entry}`)) continue;
    console.warn(`[tavora] module ${result.manifest.id} has no entry file ${entry}; is it built?`);
    problem(`the entry file ${entry} is missing (is it built?)`);
    return undefined;
  }
  for (const icon of icons) {
    if (await resolveAsset(root, `/${icon}`)) continue;
    console.warn(`[tavora] module ${result.manifest.id} has no icon file ${icon}`);
    problem(`the icon file ${icon} is missing`);
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
  /** Each panel type's icon (its own, else the module's) as a data address, or null. */
  panelIcons: Record<string, string | null>;
}

/** Where each module was found, and whether Settings may remove it. */
export async function describeModules(userModules: string, modules: Map<string, InstalledModule>): Promise<Map<string, ModuleInfo>> {
  const userRoot = await realpath(userModules).catch(() => path.resolve(userModules));
  const info = new Map<string, ModuleInfo>();
  for (const [id, module] of modules) {
    const own = module.provenance === "local" && path.dirname(module.root) === userRoot;
    const kind = module.provenance === "official" ? "official" : isDevelopmentModule(id) ? "example" : own ? "own" : "dev";
    // A development folder is shown by its full path, so the developer can tell projects apart.
    const origin = { kind, folder: module.developmentFolder ?? path.basename(module.root) } as const;
    const icon = await moduleIconUrl(module.root, module.manifest.icon);
    const panelIcons: Record<string, string | null> = {};
    for (const type of module.manifest.panels ?? []) panelIcons[type.id] = type.icon === undefined ? icon : await moduleIconUrl(module.root, type.icon);
    info.set(id, { origin, removable: own, icon, panelIcons });
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
