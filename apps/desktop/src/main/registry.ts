import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateManifest, type ModuleManifest } from "@tavora/module-schema";
import { resolveAsset } from "./assets";

export interface InstalledModule {
  manifest: ModuleManifest;
  /** Real path of the package root; nothing outside it is ever served. */
  root: string;
}

const MANIFEST = "tavora.module.json";

/**
 * Finds module packages in each directory: the directory itself if it has a
 * manifest, otherwise its direct children. Invalid packages are skipped with
 * a warning so one broken module never blocks startup.
 */
export async function discoverModules(dirs: string[]): Promise<Map<string, InstalledModule>> {
  const modules = new Map<string, InstalledModule>();
  for (const dir of dirs) {
    for (const candidate of await candidates(dir)) {
      const installed = await loadModule(candidate);
      if (!installed) continue;
      const { id } = installed.manifest;
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

async function loadModule(dir: string): Promise<InstalledModule | undefined> {
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
  return { manifest: result.manifest, root };
}
