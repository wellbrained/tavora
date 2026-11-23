import { existsSync, watch as watchFs } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { HostViewState } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { copyExample, slugOf } from "./example-copy";
import type { FileDialogs } from "./file-dialogs";
import type { Installed } from "./installed-modules";
import { cleanDevelopmentFolders, LibraryError, MAX_DEVELOPMENT_FOLDERS, moveDevelopmentFolder, setDevelopmentFolderCollapsed, type Library } from "./library";
import { buildFolderName, developmentProjects, isExampleModule, MANIFEST, mayHoldProject, projectEntry, type InstalledModule } from "./registry";

/** How long a development folder's build must be quiet before its panels reload. */
export const DEVELOPMENT_RELOAD_MS = 300;

/** Folders watched in one development folder for a new project, at most. */
const MAX_DEVELOPMENT_SUBFOLDERS = 100;

/** One folder being watched. */
export interface FolderWatch {
  close(): void;
}

/**
 * Watches one folder, deeper too when `recursive`; `listener` hears the name of what changed, or null when the system
 * doesn't say. Throws like fs.watch when the folder can't be watched (ENOENT: it is not there).
 */
export type WatchFolder = (dir: string, recursive: boolean, listener: (name: string | null) => void) => FolderWatch;

/** The system's watcher (fs.watch); it closes itself on an error and never keeps Tavora running. */
export const watchFolder: WatchFolder = (dir, recursive, listener) => {
  const watcher = watchFs(dir, { recursive, persistent: false }, (_event, name) => listener(name?.toString() ?? null));
  watcher.on("error", () => watcher.close());
  return watcher;
};

export interface DevelopmentFoldersOptions {
  library: Library;
  saveLibrary: () => void;
  installed: Installed;
  dialogs: Pick<FileDialogs, "pick" | "remember">;
  language: () => Language;
  /** The developer's own module id prefix, when the account holds one (module-publish.ts ownPrefix). */
  ownPrefix: () => string | null;
  /** Looks for modules again (module-panels.ts reload). */
  reload: () => Promise<unknown>;
  /** A module's open panels load its new build (module-panels.ts reloadViews). */
  reloadViews: (moduleId: string) => void;
  /** Something the host UI shows changed. */
  changed: () => void;
  /** A module of a development folder the user took away is gone: what it had over the game goes with it. */
  gone: (module: InstalledModule) => void;
  /** Opens a folder in the file manager and answers with a problem, or "" when it opened; null when none may open (test runs). */
  openPath: ((folder: string) => Promise<string>) | null;
  /** How folders are watched; the system's by default. */
  watch?: WatchFolder;
  /** How long a build must be quiet before its panels reload; DEVELOPMENT_RELOAD_MS by default. */
  quietMs?: number;
}

/** The watchers of one development folder or project, and its pending reload. */
interface Watched {
  watchers: FolderWatch[];
  timer: ReturnType<typeof setTimeout> | undefined;
  rediscover: boolean;
}

/**
 * Settings > Development: the folders the user loads module projects from, watched so a build reloads its panels by
 * itself, and the examples that ship with Tavora, copied into a new project. Only projects and examples Tavora found can
 * be opened, so the host UI can't open any path.
 */
export class DevelopmentFolders {
  private readonly watched = new Map<string, Watched>();

  constructor(private readonly options: DevelopmentFoldersOptions) {}

  /** What Settings > Development lists: each folder, whether it is collapsed, its problem and its projects, loaded or not. */
  view(): HostViewState["developmentFolders"] {
    const { library, installed } = this.options;
    return library.developmentFolders.map((folder) => {
      const own = installed.problems.find((item) => item.developmentFolder === folder && !item.developmentProject);
      const projects = new Map<string, HostViewState["developmentFolders"][number]["projects"][number]>();
      for (const module of installed.modules.values()) {
        if (module.developmentFolder === folder && module.developmentProject) {
          projects.set(module.developmentProject, { project: module.developmentProject, moduleId: module.manifest.id, problem: null, kind: null, name: null, version: null });
        }
      }
      for (const item of installed.problems) {
        if (item.developmentFolder !== folder || !item.developmentProject || projects.has(item.developmentProject)) continue;
        projects.set(item.developmentProject, {
          project: item.developmentProject,
          moduleId: null,
          problem: item.message,
          kind: item.kind ?? null,
          ...(item.values ? { values: item.values } : {}),
          name: item.about?.name ?? null,
          version: item.about?.version ?? null,
        });
      }
      return {
        folder,
        collapsed: library.collapsedDevelopmentFolders.includes(folder),
        problem: own?.message ?? null,
        kind: own?.kind ?? null,
        ...(own?.values ? { values: own.values } : {}),
        projects: [...projects.values()].sort((a, b) => a.project.localeCompare(b.project)),
      };
    });
  }

  /**
   * Watches each module project in the development folders, whether or not its module loaded. Only the project folder
   * itself and its build folder are watched, never node_modules or .git. A change to the build reloads the module's open
   * panels; a change to the manifest, the build folder appearing or being replaced, or any change while the module did
   * not load looks for modules again, so a project added before its first build or a broken manifest that was fixed
   * loads by itself. A development folder that holds projects is watched too, with each folder directly in it, so a new
   * project made there later is found. Changes come in bursts while a build writes, so it waits for a quiet moment.
   */
  async watch(): Promise<void> {
    // Read everything first, so two calls at once cannot leave watchers of the older one behind.
    const builtAlready = (root: string, entry: string | undefined) => entry !== undefined && existsSync(path.join(root, entry));
    const look = async (folder: string) => {
      const found = await developmentProjects(folder);
      const projects = found === "missing" ? [] : found;
      const holder = !(projects.length === 1 && projects[0] === folder);
      let others: string[] = [];
      if (holder) {
        try {
          others = (await readdir(folder, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && mayHoldProject(entry.name))
            .map((entry) => path.join(folder, entry.name))
            .filter((dir) => !projects.includes(dir))
            .slice(0, MAX_DEVELOPMENT_SUBFOLDERS);
        } catch {
          // Gone: Settings says so, and there is nothing to watch.
        }
      }
      return { folder, holder, others, projects };
    };
    const folders = await Promise.all(
      this.options.library.developmentFolders.map(async (folder) => {
        const seen = await look(folder);
        return {
          ...seen,
          projects: await Promise.all(
            seen.projects.map(async (project) => {
              const module = [...this.options.installed.modules.values()].find((item) => item.developmentProject === project);
              const entry = module?.manifest.entry ?? (await projectEntry(project));
              return { project, module, entry, built: builtAlready(module?.root ?? project, entry) };
            }),
          ),
        };
      }),
    );
    this.close();
    const watcher = this.options.watch ?? watchFolder;
    const quietMs = this.options.quietMs ?? DEVELOPMENT_RELOAD_MS;
    const watched = (key: string) => {
      const state: Watched = { watchers: [], timer: undefined, rediscover: false };
      const changed = (rediscover: boolean) => {
        state.rediscover ||= rediscover;
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = undefined;
          const again = state.rediscover;
          state.rediscover = false;
          void this.changed(key, again).catch((error: unknown) => console.error("[tavora] reloading a development module failed", error));
        }, quietMs);
      };
      const watchOne = (dir: string, recursive: boolean, listener: (name: string | null) => void) => {
        try {
          state.watchers.push(watcher(dir, recursive, listener));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[tavora] cannot watch the development folder ${dir}`, error);
        }
      };
      this.watched.set(key, state);
      return { changed, watchOne };
    };
    const lookAgain = new Map<string, () => void | Promise<void>>();
    for (const { folder, holder, others, projects } of folders) {
      if (holder) {
        // A project appearing in the folder, or a manifest in one of its folders, is a new module.
        const { changed, watchOne } = watched(folder);
        lookAgain.set(folder, () => changed(true));
        watchOne(folder, false, () => changed(true));
        for (const dir of others) {
          watchOne(dir, false, (name) => {
            if (name === null || name === MANIFEST) changed(true);
          });
        }
      }
      for (const { project, module, entry, built: wasBuilt } of projects) {
        const { changed, watchOne } = watched(project);
        // A project that wasn't built at the look and is now: its build came while the watchers started.
        if (!module) lookAgain.set(project, async () => ((await projectEntry(project).then((now) => builtAlready(project, now))) && !wasBuilt ? changed(true) : undefined));
        const root = module?.root ?? project;
        const built = entry === undefined ? undefined : buildFolderName(entry);
        watchOne(root, false, (name) => {
          if (!module || name === null || name === MANIFEST || name === built) changed(true);
          else if (built === undefined) changed(false);
        });
        // A rebuild that empties the build folder takes the entry away: look again, so the panels wait for the next build.
        if (built !== undefined) watchOne(path.join(root, built), true, () => changed(!module || !existsSync(path.join(root, entry!))));
      }
    }
    // What was made or built between the look above and the watchers starting just now was heard by nobody, and a look follows
    // every reload, so a project made or finished right after one (on a slow disk the look takes long) would stay as it was.
    // Look once more now that the watchers listen: anything that differs is news.
    const shape = (seen: { holder: boolean; others: string[]; projects: readonly (string | { project: string })[] }) =>
      JSON.stringify([seen.holder, seen.others, seen.projects.map((item) => (typeof item === "string" ? item : item.project))]);
    await Promise.all([
      ...folders.map(async (before) => {
        if (!before.holder) return;
        const now = await look(before.folder);
        if (shape(now) !== shape(before)) lookAgain.get(before.folder)?.();
      }),
      ...folders.flatMap((before) => before.projects.map((item) => lookAgain.get(item.project)?.())),
    ]);
  }

  /** Stops watching every folder, and drops the reloads still waiting for a quiet moment. */
  close(): void {
    for (const { watchers, timer } of this.watched.values()) {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    }
    this.watched.clear();
  }

  /** The user picks a module project folder, or a folder of them; Tavora loads the modules from it from now on. Answers with the folder, or nothing when cancelled. */
  async add(): Promise<string | void> {
    const { library, dialogs } = this.options;
    const folder = await dialogs.pick("development-folder", { title: translate(this.options.language(), "dialog.developmentFolder"), properties: ["openDirectory"] });
    if (!folder) return;
    if (library.developmentFolders.length >= MAX_DEVELOPMENT_FOLDERS) throw new LibraryError("error.tooManyDevelopmentFolders");
    library.developmentFolders = cleanDevelopmentFolders([...library.developmentFolders, folder]);
    this.options.saveLibrary();
    dialogs.remember("development-folder", folder);
    await this.options.reload();
    return path.resolve(folder);
  }

  /** Forgets a development folder; its modules' panels close like a removed module's, and their data stays. */
  async remove(folder: string): Promise<void> {
    const { library, installed } = this.options;
    library.developmentFolders = library.developmentFolders.filter((item) => folderKey(item) !== folderKey(folder));
    setDevelopmentFolderCollapsed(library, folder, false);
    this.options.saveLibrary();
    const projects = [...installed.modules.values()].filter((module) => module.developmentProject !== undefined);
    await this.options.reload();
    // A module of that folder that is gone now takes its game overlays with it, as a removed module does.
    for (const module of projects) if (installed.get(module.manifest.id)?.developmentProject !== module.developmentProject) this.options.gone(module);
  }

  /** Puts a development folder at another place in the list. */
  move(folder: string, index: number): void {
    moveDevelopmentFolder(this.options.library, folder, index);
    this.options.saveLibrary();
  }

  collapse(folder: string, collapsed: boolean): void {
    setDevelopmentFolderCollapsed(this.options.library, folder, collapsed);
    this.options.saveLibrary();
  }

  /**
   * Copies an example that ships with Tavora into a new project, named after the module, in a development folder that
   * holds projects or in a folder the user picks (`folder` null). A picked folder outside the development folders gets
   * the new project added as one. Answers with the new project, or nothing when cancelled.
   */
  async copyExample(moduleId: string, name: string, folder: string | null): Promise<string | void> {
    const { library, installed, dialogs } = this.options;
    const example = installed.get(moduleId);
    if (!example || !isExampleModule(moduleId)) throw new LibraryError("error.copyNoExample");
    let parent: string | undefined;
    if (folder !== null) {
      parent = this.folderOf(folder);
      if (!parent) throw new LibraryError("error.copyNoFolder");
    } else {
      parent = await dialogs.pick("development-folder", { title: translate(this.options.language(), "dialog.copyExample"), properties: ["openDirectory", "createDirectory"] });
      if (!parent) return;
      dialogs.remember("development-folder", parent);
    }
    if (!existsSync(parent)) throw new LibraryError("error.copyNoFolder");
    // A project can't hold another one: Tavora only looks for projects directly inside a folder without a manifest.
    if (existsSync(path.join(parent, MANIFEST))) throw new LibraryError("error.copyIntoProject", { folder: path.basename(parent) });
    const known = this.folderOf(parent) !== undefined;
    if (!known && library.developmentFolders.length >= MAX_DEVELOPMENT_FOLDERS) throw new LibraryError("error.tooManyDevelopmentFolders");
    const slug = slugOf(name);
    const id = `${this.options.ownPrefix() ?? "local"}.${slug}`;
    if (installed.modules.has(id)) throw new LibraryError("error.copyIdTaken", { id });
    const project = path.join(path.resolve(parent), slug);
    await copyExample(example.root, project, { id, name: name.trim() });
    if (!known) {
      library.developmentFolders = cleanDevelopmentFolders([...library.developmentFolders, project]);
      this.options.saveLibrary();
    }
    await this.options.reload();
    return project;
  }

  /** Opens a module project of a development folder in the file manager; only those, so the host UI cannot open any path. */
  async openProject(project: string): Promise<void> {
    const { installed, openPath } = this.options;
    const known = [...installed.modules.values()].some((module) => module.developmentProject === project) || installed.problems.some((problem) => problem.developmentProject === project);
    if (!known || !openPath) return;
    const error = await openPath(project);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }

  /** Opens the folder of an example that ships with Tavora, to look at its sources; only an example's. */
  async openExample(moduleId: string): Promise<void> {
    const example = this.options.installed.get(moduleId);
    if (!example || !isExampleModule(moduleId) || !this.options.openPath) return;
    const error = await this.options.openPath(example.root);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }

  /**
   * `pnpm dev` rebuilt a module in the repo (modules/, examples/): its open panels load the new build, the way a
   * development folder's do, instead of Tavora restarting. A module that had not loaded is looked for again.
   */
  async built(dir: string): Promise<void> {
    const real = await realpath(dir).catch(() => dir);
    const same = (root: string) => path.relative(root, real) === "";
    const find = () => [...this.options.installed.modules.values()].find((item) => same(item.root));
    let module = find();
    if (!module) {
      await this.options.reload();
      this.options.changed();
      module = find();
    }
    if (module) this.options.reloadViews(module.manifest.id);
  }

  /** A development project's files changed: its module's panels load the new build, after looking for modules again when asked. */
  private async changed(project: string, rediscover: boolean): Promise<void> {
    if (rediscover) {
      await this.options.reload();
      this.options.changed();
    }
    const moduleId = [...this.options.installed.modules.values()].find((item) => item.developmentProject === project)?.manifest.id;
    if (moduleId !== undefined) this.options.reloadViews(moduleId);
  }

  /** The development folder the user added that is `folder`, as it is kept in the library. */
  private folderOf(folder: string): string | undefined {
    return this.options.library.developmentFolders.find((item) => folderKey(item) === folderKey(folder));
  }
}

/** A folder as it compares: Windows doesn't tell upper and lower case apart. */
function folderKey(value: string): string {
  return process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
}
