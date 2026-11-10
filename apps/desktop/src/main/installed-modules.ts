import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { SIGNATURE_FILE, signedHash } from "@tavora/pack";
import type { OfficialUpdates } from "./official-updates";
import { applyOwners, readOwnerRecords, type OwnerRecords } from "./installer";
import { BROWSER_MODULE_ID, browserModule, describeModules, discoverModules, type InstalledModule, type ModuleInfo, type ModuleProblem, type ModuleSources } from "./registry";
import { stopBlocked, type SafetyCheck } from "./safety-lists";

export interface InstalledModulesOptions {
  userData: string;
  /** The user's own modules folder, as configured (not yet a real path). */
  userModules: string;
  sources: Omit<ModuleSources, "tavoraVersion">;
  tavoraVersion: string;
  safety: Pick<SafetyCheck, "blocked">;
  /** Tavora's own modules downloaded from the catalogue (official-updates.ts); absent or off: only the shipped copies load. */
  official?: OfficialUpdates;
}

export interface InstalledModules {
  /** Every module that loads, the Browser included. */
  modules: Map<string, InstalledModule>;
  /** Modules taken out because their zip is blocked; the installer still counts them as installed. */
  blocked: Map<string, InstalledModule>;
  /** Ids of the modules (loaded or blocked) the catalog installed and keeps up to date. */
  catalog: Set<string>;
  info: Map<string, ModuleInfo>;
  problems: ModuleProblem[];
}

/**
 * Looks for every module Tavora has: finds the packages, gives installed ones their recorded
 * owner, stops blocked zips and notes which came from the catalog. Startup and every reload run
 * this same step, so nothing they know about the modules can differ.
 */
export async function loadInstalledModules(options: InstalledModulesOptions): Promise<InstalledModules> {
  const problems: ModuleProblem[] = [];
  const { official } = options;
  if (official?.on) await official.load();
  const downloads = official?.on ? { officialUpdates: { dir: official.dir, trusted: (id: string, dir: string) => official.trusted(id, dir) } } : {};
  const modules = await discoverModules({ ...options.sources, ...downloads, tavoraVersion: options.tavoraVersion }, problems);
  if (official?.on) {
    // Copies the shipped one makes useless (or that are blocked, revoked or no longer shipped) go; their high-water mark stays.
    const shipped = new Map([...modules].flatMap(([id, module]) => (module.shippedVersion === undefined ? [] : [[id, module.shippedVersion] as const])));
    const unsure = new Set(problems.flatMap((problem) => (problem.official && problem.about?.id ? [problem.about.id] : [])));
    await official.cleanup(shipped, unsure);
  }
  const userRoot = await realpath(options.userModules).catch(() => path.resolve(options.userModules));
  const records = await readOwnerRecords(options.userData);
  applyOwners(modules, userRoot, records);
  await addSignedHashes(modules, userRoot, records);
  const blocked = stopBlocked(modules, userRoot, records, options.safety, problems);
  const catalog = new Set(
    [...blocked.values(), ...modules.values()]
      .filter((module) => {
        const record = records[path.basename(module.root)];
        return module.provenance === "local" && path.dirname(module.root) === userRoot && record?.catalog === true && record.id === module.manifest.id;
      })
      .map((module) => module.manifest.id),
  );
  modules.set(BROWSER_MODULE_ID, browserModule(options.tavoraVersion));
  const info = await describeModules(options.userModules, modules);
  return { modules, blocked, catalog, info, problems };
}

/** A signature file bigger than this is not read for its hash: a zip holds at most a few thousand files. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/**
 * Fills in `signedSha256` for records from before the installer kept it, in memory only, from the signature file the
 * installer left in the module's folder, so a block by what the signature covers stops those copies too. A file that
 * is missing or can't be read adds nothing, and the block by the zip's own hash holds whatever the file says.
 */
export async function addSignedHashes(modules: ReadonlyMap<string, InstalledModule>, userRoot: string, records: OwnerRecords): Promise<void> {
  for (const [id, module] of modules) {
    if (module.provenance !== "local" || path.dirname(module.root) !== userRoot) continue;
    const record = records[path.basename(module.root)];
    if (!record || record.id !== id || record.signedSha256) continue;
    const file = path.join(module.root, SIGNATURE_FILE);
    const size = await stat(file).then((info) => (info.isFile() ? info.size : -1), () => -1);
    if (size < 0 || size > MAX_SIGNATURE_BYTES) continue;
    const data = await readFile(file).catch(() => null);
    const hash = data ? signedHash([{ name: SIGNATURE_FILE, data }]) : null;
    if (hash) record.signedSha256 = hash;
  }
}

/**
 * The modules installed now, as one object that services hold: a reload replaces what is inside, so they never keep
 * an out-of-date map. `shown` gives a module with its texts in Tavora's language now.
 */
export class Installed {
  constructor(
    private current: InstalledModules,
    private readonly translate: (manifest: InstalledModule["manifest"]) => InstalledModule["manifest"],
  ) {}

  /** Puts what a new look at the modules found in place of the old (every reload). */
  replace(next: InstalledModules): void {
    this.current = next;
  }

  get modules(): Map<string, InstalledModule> {
    return this.current.modules;
  }
  get blocked(): Map<string, InstalledModule> {
    return this.current.blocked;
  }
  get catalog(): Set<string> {
    return this.current.catalog;
  }
  get info(): Map<string, ModuleInfo> {
    return this.current.info;
  }
  get problems(): ModuleProblem[] {
    return this.current.problems;
  }

  get(moduleId: string): InstalledModule | undefined {
    return this.current.modules.get(moduleId);
  }

  /** The module with its name, description, panel and action names in Tavora's language now; undefined when it is not installed. */
  shown(moduleId: string): InstalledModule | undefined {
    const module = this.current.modules.get(moduleId);
    return module && { ...module, manifest: this.translate(module.manifest) };
  }
}
