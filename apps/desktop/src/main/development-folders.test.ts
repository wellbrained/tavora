import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DevelopmentFolders, type WatchFolder } from "./development-folders";
import { Installed, type InstalledModules } from "./installed-modules";
import { emptyLibrary, MAX_DEVELOPMENT_FOLDERS, type Library } from "./library";
import type { InstalledModule, ModuleProblem } from "./registry";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const VANILLA = "local.example.vanilla-module";

function module(id: string, root: string, more: Partial<InstalledModule> = {}): InstalledModule {
  return { owner: "local", root, provenance: "local", manifest: { id, name: id, version: "1.0.0", entry: "dist/index.html" }, ...more } as unknown as InstalledModule;
}

function found(modules: InstalledModule[], problems: ModuleProblem[] = []): InstalledModules {
  return { modules: new Map(modules.map((item) => [item.manifest.id, item])), blocked: new Map(), catalog: new Set(), info: new Map(), problems };
}

/** A development folder on disk holding one project with a manifest. */
async function folderWithProject(name = "map"): Promise<{ folder: string; project: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), "tavora-dev-"));
  const project = path.join(folder, name);
  await mkdir(project);
  await writeFile(path.join(project, "tavora.module.json"), JSON.stringify({ id: `local.${name}`, entry: "dist/index.html" }));
  return { folder, project };
}

interface Setup {
  library?: Library;
  modules?: InstalledModule[];
  problems?: ModuleProblem[];
  pick?: string | undefined;
  prefix?: string | null;
  openPath?: boolean;
  /** What the next look at the modules finds. */
  next?: InstalledModule[];
  /** Runs whenever a watcher is made, to change the disk while the watchers start. */
  onWatch?: () => void;
}

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const library = options.library ?? emptyLibrary();
  const installed = new Installed(found(options.modules ?? [], options.problems), (manifest) => manifest);
  const listeners = new Map<string, (name: string | null) => void>();
  const open = new Set<string>();
  const watch: WatchFolder = (dir, recursive, listener) => {
    options.onWatch?.();
    if (!existsSync(dir)) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    const key = `${dir}${recursive ? " (deep)" : ""}`;
    listeners.set(key, listener);
    open.add(key);
    return { close: () => void open.delete(key) };
  };
  const folders = new DevelopmentFolders({
    library,
    saveLibrary: () => void calls.push("library saved"),
    installed,
    dialogs: {
      pick: async (place) => (calls.push(`pick ${place}`), options.pick),
      remember: (place, picked) => void calls.push(`remember ${place} ${picked}`),
    },
    language: () => "en",
    ownPrefix: () => options.prefix ?? null,
    reload: async () => {
      calls.push("reload");
      if (options.next) installed.replace(found(options.next));
    },
    reloadViews: (moduleId) => void calls.push(`reload views ${moduleId}`),
    changed: () => void calls.push("changed"),
    gone: (gone) => void calls.push(`gone ${gone.manifest.id}`),
    openPath: options.openPath === false ? null : async (folder) => (calls.push(`open ${folder}`), ""),
    watch,
    quietMs: 1,
  });
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { folders, calls, library, installed, listeners, open, quiet };
}

describe("DevelopmentFolders", () => {
  it("lists each folder with its loaded projects and those that don't load, in order", () => {
    const library = { ...emptyLibrary(), developmentFolders: ["/dev"], collapsedDevelopmentFolders: ["/dev"] };
    const problems = [
      { folder: "b", path: "/dev/b", message: "not built", kind: "notBuilt", developmentFolder: "/dev", developmentProject: "/dev/b", about: { id: "local.b", name: "B", version: "0.2.0" } },
      { folder: "dev", path: "/dev", message: "half there", developmentFolder: "/dev" },
    ] as unknown as ModuleProblem[];
    const { folders } = setup({ library, modules: [module("local.a", "/dev/a", { developmentFolder: "/dev", developmentProject: "/dev/a" })], problems });

    expect(folders.view()).toEqual([
      {
        folder: "/dev",
        collapsed: true,
        problem: "half there",
        kind: null,
        projects: [
          { project: "/dev/a", moduleId: "local.a", problem: null, kind: null, name: null, version: null },
          { project: "/dev/b", moduleId: null, problem: "not built", kind: "notBuilt", name: "B", version: "0.2.0" },
        ],
      },
    ]);
  });

  it("reloads a project's panels once its build is quiet, and looks for modules again when its manifest changes", async () => {
    const { folder, project } = await folderWithProject();
    await mkdir(path.join(project, "dist"));
    const library = { ...emptyLibrary(), developmentFolders: [folder] };
    const { folders, calls, listeners, quiet } = setup({ library, modules: [module("local.map", project, { developmentFolder: folder, developmentProject: project })] });
    await folders.watch();

    // A burst of writes to the build is one reload.
    listeners.get(path.join(project, "dist") + " (deep)")!("index.html");
    listeners.get(path.join(project, "dist") + " (deep)")!("index.js");
    await quiet();
    // The entry is gone mid-build (no dist/index.html on disk): it looks again, so the panels wait for the next build.
    expect(calls).toEqual(["reload", "changed", "reload views local.map"]);

    calls.length = 0;
    listeners.get(project)!("tavora.module.json");
    await quiet();
    expect(calls).toEqual(["reload", "changed", "reload views local.map"]);

    // Another file of the project is no news.
    calls.length = 0;
    listeners.get(project)!("README.md");
    await quiet();
    expect(calls).toEqual([]);
  });

  it("finds a new project in a folder of projects, and watches anew on every look without leaving old watchers", async () => {
    const { folder } = await folderWithProject();
    await mkdir(path.join(folder, "next"));
    await mkdir(path.join(folder, "node_modules"));
    const library = { ...emptyLibrary(), developmentFolders: [folder, path.join(folder, "gone")] };
    const { folders, calls, listeners, open, quiet } = setup({ library });
    await folders.watch();
    // A project's folder, the folder itself and its other folders (never node_modules); a folder that is gone is skipped.
    expect([...open].sort()).toEqual([folder, path.join(folder, "map"), path.join(folder, "next")].sort());

    listeners.get(path.join(folder, "next"))!("tavora.module.json");
    await quiet();
    expect(calls).toEqual(["reload", "changed"]);

    await folders.watch();
    expect(open.size).toBe(3);
    folders.close();
    expect(open.size).toBe(0);
  });

  it("finds a project made after the first look but before the watchers started", async () => {
    const { folder } = await folderWithProject();
    const library = { ...emptyLibrary(), developmentFolders: [folder] };
    // The look is over when the first watcher is made, and nobody hears what is made until the watchers listen: on a slow disk
    // that gap is long. A project made in it has to be found anyway.
    let made = false;
    const { folders, calls, quiet } = setup({
      library,
      onWatch: () => {
        if (made) return;
        made = true;
        mkdirSync(path.join(folder, "late"));
        writeFileSync(path.join(folder, "late", "tavora.module.json"), JSON.stringify({ id: "local.late", entry: "dist/index.html" }));
      },
    });
    await folders.watch();
    await quiet();
    expect(calls).toEqual(["reload", "changed"]);
  });

  it("finds a project that gets built while the watchers start", async () => {
    const { folder, project } = await folderWithProject();
    const library = { ...emptyLibrary(), developmentFolders: [folder] };
    let built = false;
    const { folders, calls, quiet } = setup({
      library,
      onWatch: () => {
        if (built) return;
        built = true;
        mkdirSync(path.join(project, "dist"));
        writeFileSync(path.join(project, "dist", "index.html"), "<p>built</p>");
      },
    });
    await folders.watch();
    await quiet();
    expect(calls).toEqual(["reload", "changed"]);
    // Looked at again, with nothing new, it stays quiet: a project that can't load for another reason doesn't loop.
    calls.length = 0;
    await folders.watch();
    await quiet();
    expect(calls).toEqual([]);
  });

  it("adds a folder the user picks and looks for its modules; nothing when the dialog is closed", async () => {
    const closed = setup({ pick: undefined });
    expect(await closed.folders.add()).toBeUndefined();
    expect(closed.calls).toEqual(["pick development-folder"]);

    const { folders, calls, library } = setup({ pick: "/dev/mods" });
    expect(await folders.add()).toBe(path.resolve("/dev/mods"));
    expect(library.developmentFolders).toEqual([path.resolve("/dev/mods")]);
    expect(calls).toEqual(["pick development-folder", "library saved", "remember development-folder /dev/mods", "reload"]);
  });

  it("adds no folder past the limit", async () => {
    const library = { ...emptyLibrary(), developmentFolders: Array.from({ length: MAX_DEVELOPMENT_FOLDERS }, (_, index) => `/dev/${index}`) };
    const { folders } = setup({ library, pick: "/dev/more" });
    await expect(folders.add()).rejects.toMatchObject({ key: "error.tooManyDevelopmentFolders" });
  });

  it("forgets a folder; its modules that are gone now take what they had over the game with them", async () => {
    const library = { ...emptyLibrary(), developmentFolders: ["/dev", "/other"], collapsedDevelopmentFolders: ["/dev"] };
    const map = module("local.map", "/dev/map", { developmentFolder: "/dev", developmentProject: "/dev/map" });
    const keep = module("local.keep", "/other/keep", { developmentFolder: "/other", developmentProject: "/other/keep" });
    const { folders, calls } = setup({ library, modules: [map, keep], next: [keep] });

    await folders.remove("/dev");

    expect(library.developmentFolders).toEqual(["/other"]);
    expect(library.collapsedDevelopmentFolders).toEqual([]);
    expect(calls).toEqual(["library saved", "reload", "gone local.map"]);
  });

  it("copies an example into a new project in a development folder, under the developer's prefix", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "tavora-dev-"));
    const library = { ...emptyLibrary(), developmentFolders: [parent] };
    const example = module(VANILLA, path.join(repo, "examples", "vanilla-module"));
    const { folders, calls } = setup({ library, modules: [example], prefix: "wellbrained" });

    const project = await folders.copyExample(VANILLA, " Fish Log ", parent);

    expect(project).toBe(path.join(parent, "fish-log"));
    expect(JSON.parse(await readFile(path.join(project as string, "tavora.module.json"), "utf8"))).toMatchObject({ id: "wellbrained.fish-log", name: "Fish Log" });
    // The folder is one already: nothing new to save, the modules are looked for again.
    expect(calls).toEqual(["reload"]);
    expect(library.developmentFolders).toEqual([parent]);
  });

  it("adds a picked folder outside the development folders as a project of its own", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "tavora-dev-"));
    const example = module(VANILLA, path.join(repo, "examples", "vanilla-module"));
    const { folders, calls, library } = setup({ modules: [example], pick: parent });

    const project = await folders.copyExample(VANILLA, "Map", null);

    expect(project).toBe(path.join(parent, "map"));
    expect(library.developmentFolders).toEqual([project]);
    expect(calls).toEqual(["pick development-folder", `remember development-folder ${parent}`, "library saved", "reload"]);
  });

  it("copies only an example, never into a project or a folder it doesn't know, nor over a module's id", async () => {
    const { folder, project } = await folderWithProject("map");
    const library = { ...emptyLibrary(), developmentFolders: [folder, project] };
    const example = module(VANILLA, path.join(repo, "examples", "vanilla-module"));
    const taken = module("local.map", project);
    const { folders } = setup({ library, modules: [example, taken, module("local.notes", "/notes")] });

    await expect(folders.copyExample("local.notes", "Map", folder)).rejects.toMatchObject({ key: "error.copyNoExample" });
    await expect(folders.copyExample(VANILLA, "Map", "/nowhere")).rejects.toMatchObject({ key: "error.copyNoFolder" });
    await expect(folders.copyExample(VANILLA, "Other", project)).rejects.toMatchObject({ key: "error.copyIntoProject" });
    await expect(folders.copyExample(VANILLA, "Map", folder)).rejects.toMatchObject({ key: "error.copyIdTaken" });
  });

  it("opens only projects and examples it found, and none in a test run", async () => {
    const example = module(VANILLA, "/examples/vanilla");
    const problems = [{ folder: "b", path: "/dev/b", message: "not built", developmentFolder: "/dev", developmentProject: "/dev/b" }] as unknown as ModuleProblem[];
    const { folders, calls } = setup({ modules: [example, module("local.a", "/dev/a", { developmentProject: "/dev/a" })], problems });

    await folders.openProject("/dev/a");
    await folders.openProject("/dev/b");
    await folders.openProject("C:/Windows");
    await folders.openExample(VANILLA);
    await folders.openExample("local.a");
    expect(calls).toEqual(["open /dev/a", "open /dev/b", "open /examples/vanilla"]);

    const hidden = setup({ modules: [example], openPath: false });
    await hidden.folders.openExample(VANILLA);
    expect(hidden.calls).toEqual([]);
  });

  it("reloads the panels of a module the dev build rebuilt, looking for it first when it had not loaded", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tavora-built-"));
    const known = setup({ modules: [module("tavora.notes", root)] });
    await known.folders.built(root);
    expect(known.calls).toEqual(["reload views tavora.notes"]);

    const fresh = setup({ next: [module("tavora.notes", root)] });
    await fresh.folders.built(root);
    expect(fresh.calls).toEqual(["reload", "changed", "reload views tavora.notes"]);
  });
});
