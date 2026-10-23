import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { LOCAL_OWNER, manifestFiles, needsNewerTavora, OFFICIAL_OWNER, validateManifest, type ChangelogEntry, type ModuleManifest } from "@tavora/module-schema";
import { resolveAsset } from "./assets";
import { readModuleChangelog } from "./module-changelog";
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
  /** Loaded from this development folder, as the player added it in Settings > Development. */
  developmentFolder?: string;
  /** The module's project folder: the development folder itself, or a folder directly inside it. */
  developmentProject?: string;
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
 * The example modules that ship with Tavora as starting points for module
 * authors. Settings > Development lists them under Examples, to open or copy,
 * and the module library lists them under Development instead of next to the
 * modules players use.
 */
const EXAMPLE_MODULES = new Set([
  "local.example.vanilla-module",
  "local.example.react-module",
  "local.example.vue-module",
  "local.example.panels-module",
]);

export function isExampleModule(id: string): boolean {
  return EXAMPLE_MODULES.has(id);
}

/** A folder that looks like a module but could not be loaded, and why, in words a player can read. */
export interface ModuleProblem {
  folder: string;
  /** The folder's full path, so Settings can show it and open it. */
  path: string;
  message: string;
  /** For a development folder: its full path, so Settings shows the problem next to it. */
  developmentFolder?: string;
  /** For a project in a development folder: the project's full path. */
  developmentProject?: string;
  /** What Settings can suggest: build it first, add another folder, or the folder is gone. */
  kind?: "not-built" | "no-module" | "missing";
  /** The name and version its manifest gives, when it has them, so Settings can name the module; its id too, when it has one. */
  about?: { name: string; version: string | null; id?: string };
}

/**
 * Modules in a development folder whose manifest names them but that cannot load right now, most often because they
 * are not built or a build watcher is rebuilding them. Their panels wait for them instead of being forgotten.
 */
export function waitingDevelopmentModules(problems: readonly ModuleProblem[]): Map<string, string> {
  const waiting = new Map<string, string>();
  for (const problem of problems) if (problem.developmentFolder && problem.about?.id) waiting.set(problem.about.id, problem.about.name);
  return waiting;
}

export interface ModuleSources {
  /** Modules that ship with Tavora. Searched first, so they win over a local copy. */
  official?: string[];
  /**
   * Folders a developer added (Settings > Development): a module project, or a folder with several
   * projects directly inside it (see developmentProjects). They come before the other local
   * folders, so a project wins over an installed copy of the same module.
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
    const project = fromProject ? await developmentProjects(dir) : undefined;
    if (project === "missing") problems.push({ folder: path.basename(dir), path: dir, message: "this folder can't be found", developmentFolder: dir, kind: "missing" });
    else if (project?.length === 0) {
      problems.push({ folder: path.basename(dir), path: dir, message: "there is no tavora.module.json in this folder or in the folders directly inside it", developmentFolder: dir, kind: "no-module" });
    }
    const found = project === undefined ? await candidates(dir) : project === "missing" ? [] : project;
    for (const candidate of found) {
      const report = (message: string, kind?: ModuleProblem["kind"], about?: ModuleProblem["about"]) =>
        problems.push({
          folder: path.basename(candidate),
          path: candidate,
          message,
          ...(fromProject ? { developmentFolder: dir, developmentProject: candidate } : {}),
          ...(kind ? { kind } : {}),
          ...(about ? { about } : {}),
        });
      const installed = await loadModule(candidate, provenance, tavoraVersion, (message, kind, about) => {
        if (provenance === "local") report(message, kind, about);
      });
      if (!installed) continue;
      if (fromProject) {
        installed.developmentFolder = dir;
        installed.developmentProject = candidate;
      }
      const { id } = installed.manifest;
      const about = { name: installed.manifest.name, version: installed.manifest.version };
      if (provenance !== "official" && id.startsWith(OFFICIAL_PREFIX)) {
        console.warn(`[tavora] module id ${id} in ${candidate} is reserved for official Tavora modules; skipping it`);
        report("its id is reserved for Tavora's own modules", undefined, about);
        continue;
      }
      if (provenance !== "official" && installed.manifest.permissions.webAssembly === true) {
        console.warn(`[tavora] module ${id} in ${candidate} asks to run WebAssembly, which only Tavora's own modules may; skipping it`);
        report("permissions.webAssembly is only for Tavora's own modules", undefined, about);
        continue;
      }
      if (modules.has(id)) {
        console.warn(`[tavora] duplicate module id ${id} in ${candidate}; keeping the first one`);
        if (provenance === "local") report("another module with the same id is already loaded", undefined, about);
        continue;
      }
      modules.set(id, installed);
    }
  }
  return modules;
}

/** A folder directly inside a development folder that may be a module project: not hidden, not node_modules. */
export function mayHoldProject(name: string): boolean {
  return !name.startsWith(".") && name !== "node_modules";
}

/**
 * The module projects in a development folder: the folder itself when it has a manifest, else
 * every folder directly inside it that has one, so a developer can add the folder they keep all
 * their modules in. Never deeper, so node_modules and build output are not searched.
 * "missing" when the folder is gone.
 */
export async function developmentProjects(dir: string): Promise<string[] | "missing"> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : [];
  }
  if (entries.some((entry) => entry.isFile() && entry.name === MANIFEST)) return [dir];
  const projects: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !mayHoldProject(entry.name)) continue;
    const child = path.join(dir, entry.name);
    try {
      if ((await readdir(child, { withFileTypes: true })).some((item) => item.isFile() && item.name === MANIFEST)) projects.push(child);
    } catch {
      // Gone or unreadable: not a project.
    }
  }
  return projects.sort((a, b) => a.localeCompare(b));
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

async function loadModule(
  dir: string,
  provenance: Provenance,
  tavoraVersion: string | undefined,
  report: (message: string, kind?: ModuleProblem["kind"], about?: ModuleProblem["about"]) => void,
): Promise<InstalledModule | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[tavora] unreadable manifest in ${dir}`);
      report("its tavora.module.json cannot be read");
    }
    return undefined;
  }
  const about = aboutOf(raw);
  const problem = (message: string, kind?: ModuleProblem["kind"]) => report(message, kind, about);
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
    problem(`the entry file ${entry} is missing (is it built?)`, "not-built");
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

/** The name and version a manifest gives, even one that doesn't validate yet. */
function aboutOf(raw: unknown): ModuleProblem["about"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { name, version, id } = raw as { name?: unknown; version?: unknown; id?: unknown };
  if (typeof name !== "string" || !name.trim()) return undefined;
  return { name: name.trim().slice(0, 80), version: typeof version === "string" ? version.slice(0, 40) : null, ...(typeof id === "string" && id.length <= 200 ? { id } : {}) };
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
  /** The module's patch notes from its changelog file, as written (see module-notes.ts); empty without one. */
  changelog: ChangelogEntry[];
}

/** Where each module was found, and whether Settings may remove it. */
export async function describeModules(userModules: string, modules: Map<string, InstalledModule>): Promise<Map<string, ModuleInfo>> {
  const userRoot = await realpath(userModules).catch(() => path.resolve(userModules));
  const info = new Map<string, ModuleInfo>();
  for (const [id, module] of modules) {
    const own = module.provenance === "local" && path.dirname(module.root) === userRoot;
    const kind = module.provenance === "official" ? "official" : isExampleModule(id) ? "example" : own ? "own" : "dev";
    // A development folder is shown by its full path, so the developer can tell projects apart.
    const origin = { kind, folder: module.developmentFolder ?? path.basename(module.root) } as const;
    const icon = await moduleIconUrl(module.root, module.manifest.icon);
    const panelIcons: Record<string, string | null> = {};
    for (const type of module.manifest.panels ?? []) panelIcons[type.id] = type.icon === undefined ? icon : await moduleIconUrl(module.root, type.icon);
    const changelog = await readModuleChangelog(module.root, module.manifest.changelog, id);
    info.set(id, { origin, removable: own, icon, panelIcons, changelog });
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
