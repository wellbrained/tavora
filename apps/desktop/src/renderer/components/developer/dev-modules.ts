// A developer's modules, each once: the projects in the development folders, joined by the name after the id prefix,
// so local.enshrouded (the Local copy, worked on) and wellbrained.enshrouded (the Release copy, published) are one
// module. Most developers have one copy of each; then the module is just that copy.
import type { HostViewState, ReleaseStatus } from "../../../shared/host-api";

type Module = HostViewState["modules"][number];
type DevelopmentFolderView = HostViewState["developmentFolders"][number];

/** A module from a development folder with a publishable id (not local.…), as ModuleRow tags it. */
export const isReleaseCopy = (module: Module): boolean => module.origin.kind === "dev" && !module.id.startsWith("local.");

/** One copy: the loaded module and its project folder. */
export interface DevCopy {
  module: Module;
  project: string;
}

export interface DevModule {
  /** The name after the prefix: "enshrouded". */
  key: string;
  name: string;
  local: DevCopy | null;
  release: DevCopy | null;
  /** The copy that gets published: the Release copy, else the only one. */
  publishes: DevCopy;
  /** What the catalog says about the copy that gets published; null for a local.… one or while unknown. */
  status: ReleaseStatus | null;
}

export function devModules(folders: readonly DevelopmentFolderView[], modules: readonly Module[], statuses: Record<string, ReleaseStatus> | null): DevModule[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const found = new Map<string, { local: DevCopy | null; release: DevCopy | null }>();
  for (const folder of folders) {
    for (const project of folder.projects) {
      const module = project.moduleId ? byId.get(project.moduleId) : undefined;
      if (!module) continue;
      const key = module.id.slice(module.id.indexOf(".") + 1);
      const entry = found.get(key) ?? { local: null, release: null };
      if (isReleaseCopy(module)) entry.release ??= { module, project: project.project };
      else entry.local ??= { module, project: project.project };
      found.set(key, entry);
    }
  }
  return [...found]
    .map(([key, { local, release }]) => {
      const publishes = (release ?? local)!;
      return {
        key,
        name: publishes.module.name,
        local,
        release,
        publishes,
        status: release ? (statuses?.[release.module.id] ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A module whose newest version isn't in the catalog yet. */
export const waitsForPublish = (entry: DevModule): boolean => entry.status === "new-version" || entry.status === "not-published";
