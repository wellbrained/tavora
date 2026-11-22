import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OnlineSearchResult } from "../shared/host-api";
import { gridTemplate } from "../shared/layout-templates";
import { Installed } from "./installed-modules";
import { addWorkspace, emptyLibrary, isLive, trashWorkspace, type Library } from "./library";
import { PendingQuestions } from "./pending-questions";
import type { InstalledModule } from "./registry";
import { UndoShelf } from "./undo-shelf";
import { emptyWorkspaces, Workspaces, type InstanceRecord } from "./workspace";
import { STARTER_MODULES, WorkspaceLibrary } from "./workspace-library";

function module(id: string): InstalledModule {
  return { owner: "official", root: `/modules/${id}`, provenance: "official", manifest: { id, name: id, version: "1.0.0", entry: "index.html", games: [] } } as unknown as InstalledModule;
}

interface Setup {
  library?: Library;
  /** The installed modules; Notes and To-Dos by default. */
  modules?: InstalledModule[];
  /** Modules that don't work in any workspace. */
  unfit?: string[];
  pick?: string | undefined;
  found?: OnlineSearchResult;
  /** The workspace open now, as the library's last one; Home when none. */
  open?: string;
}

async function setup(options: Setup = {}) {
  const calls: string[] = [];
  const synced = { count: 0 };
  const library = options.library ?? emptyLibrary();
  const workspaces = new Workspaces(emptyWorkspaces(Object.keys(library.workspaces)), { save: () => undefined });
  const modules = options.modules ?? STARTER_MODULES.map(module);
  const installed = new Installed({ modules: new Map(modules.map((item) => [item.manifest.id, item])), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] }, (manifest) => manifest);
  const userData = await mkdtemp(path.join(tmpdir(), "tavora-workspaces-"));
  const undos = new UndoShelf();
  const questions = new PendingQuestions();
  // As in host.ts: the workspace shown is the library's last one, while the workspace screen is up.
  const screen = { on: options.open ? "workspace" : "home" };
  const shown = () => (screen.on === "workspace" ? library.lastWorkspaceId : null);
  if (options.open) library.lastWorkspaceId = options.open;
  const shelf = new WorkspaceLibrary({
    library,
    saveLibrary: () => void calls.push("library saved"),
    workspaces,
    installed,
    fits: (item) => !(options.unfit ?? []).includes(item.manifest.id),
    undos,
    userData,
    language: () => "en",
    lookUp: async (query) => (calls.push(`look up ${query}`), options.found ?? { status: "ok", games: [] }),
    icons: {
      lookSoon: () => void calls.push("icons soon"),
      forget: async (workspace) => void calls.push(`forget icon ${workspace.id}`),
      importImage: async (workspaceId, source) => (calls.push(`import ${source} for ${workspaceId}`), "picture.png"),
      choose: async (workspaceId, choice) => void calls.push(`choose ${choice.kind} for ${workspaceId}`),
    },
    dialogs: {
      pick: async (place) => (calls.push(`pick ${place}`), options.pick),
      remember: (place, picked) => void calls.push(`remember ${place} ${picked}`),
    },
    gameListed: (workspaceId) => void calls.push(`listed ${workspaceId}`),
    overlaysChanged: () => void synced.count++,
    screen: {
      shown,
      onHome: () => screen.on === "home",
      // As host.ts's showScreen: the workspace shown at this moment is left, with its questions and views.
      goHome: () => {
        const leaving = shown();
        if (leaving !== null) questions.cancel({ workspace: leaving });
        calls.push(`home from ${leaving}`, "views closed");
        screen.on = "home";
      },
      open: (workspaceId) => {
        calls.push(`open ${workspaceId}`);
        screen.on = "workspace";
        library.lastWorkspaceId = workspaceId;
      },
    },
    views: {
      start: (record, welcome) => void calls.push(`start ${record.moduleId}${welcome ? "" : " quietly"}`),
      close: (instanceId) => void calls.push(`close ${instanceId}`),
      drop: (instanceId) => void calls.push(`drop ${instanceId}`),
    },
    panelState: { remove: async (instanceId) => void calls.push(`state gone ${instanceId}`) },
    files: { noteWorkspaceDeleted: async (name, deleteFiles) => (calls.push(`files of ${name}`), deleteFiles(path.join(userData, "files"))) },
    forgotten: (workspaceId) => void calls.push(`forgotten ${workspaceId}`),
    clearSession: async (partition) => void calls.push(`clear ${partition}`),
  });
  return { shelf, calls, synced, library, workspaces, undos, userData, screen, questions };
}

const valheim = { online: { id: "valheim", name: "Valheim" } };

describe("WorkspaceLibrary", () => {
  it("adds a game with Notes and To-Dos side by side, looks for its icon and tells the rail", async () => {
    const { shelf, calls, workspaces } = await setup();
    expect(await shelf.add(valheim)).toBe("valheim");
    expect(workspaces.panels("valheim").map((record) => record.moduleId)).toEqual([...STARTER_MODULES]);
    expect(calls).toEqual(["library saved", "icons soon", "listed valheim"]);
  });

  it("starts a game only with the starter modules that work there, and a personal workspace empty", async () => {
    const { shelf, workspaces } = await setup({ unfit: ["tavora.todos"] });
    await shelf.add(valheim);
    expect(workspaces.panels("valheim").map((record) => record.moduleId)).toEqual(["tavora.notes"]);
    const id = (await shelf.add({ personal: "Work" })) as string;
    expect(workspaces.panels(id)).toEqual([]);
  });

  it("answers a game the user has as it is, and brings one in Trash back with its panels", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, calls, workspaces } = await setup({ library });
    expect(await shelf.add(valheim)).toEqual({ ok: true, id: "valheim", existing: true });
    // Nothing was learned, so nothing is saved and the rail has nothing new.
    expect(calls).toEqual([]);

    trashWorkspace(library, "valheim", new Date());
    expect(await shelf.add(valheim)).toEqual({ ok: true, id: "valheim", restored: true });
    expect(isLive(library, "valheim")).toBe(true);
    // It comes back as it was: no starter panels are added.
    expect(workspaces.panels("valheim")).toEqual([]);
    expect(calls).toEqual(["library saved", "icons soon", "listed valheim"]);
  });

  it("looks a game known by its Steam id up online only while online features are on", async () => {
    const found: OnlineSearchResult = { status: "ok", games: [{ id: "valheim", name: "Valheim", steamAppId: 892970 }] };
    const on = await setup({ found });
    expect(await on.shelf.add({ name: "valheim", steamAppId: 892970 })).toBe("valheim");
    expect(on.calls[0]).toBe("look up valheim");

    const library = { ...emptyLibrary(), onlineSearch: false };
    const off = await setup({ library, found });
    const id = await off.shelf.add({ name: "valheim", steamAppId: 892970 });
    expect(id).not.toBe("valheim");
    expect(off.calls.some((call) => call.startsWith("look up"))).toBe(false);
  });

  it("imports the Steam games not in the library yet, and saves even when none are new", async () => {
    const { shelf, calls, library } = await setup();
    expect(shelf.importSteam([{ appid: 892970, name: "Valheim", id: "valheim" }])).toEqual({ ok: true, added: 1 });
    expect(Object.keys(library.workspaces)).toEqual(["valheim"]);
    expect(calls).toEqual(["library saved", "icons soon"]);
    calls.length = 0;
    expect(shelf.importSteam([{ appid: 892970, name: "Valheim", id: "valheim" }])).toEqual({ ok: true, added: 0 });
    expect(calls).toEqual(["library saved"]);
  });

  it("moves workspaces to Trash; Undo puts them back in their places, and the offer is gone after", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    addWorkspace(library, { online: { id: "satisfactory", name: "Satisfactory" } }, new Date());
    const { shelf, calls, undos } = await setup({ library });
    const token = shelf.trash(["valheim", "gone"], false);
    expect(isLive(library, "valheim")).toBe(false);
    expect(calls).toEqual(["library saved"]);

    await undos.undo(token);
    expect(library.root.map((item) => item.id)).toEqual(["valheim", "satisfactory"]);
    expect(calls).toEqual(["library saved", "library saved"]);
    await expect(undos.undo(token)).rejects.toMatchObject({ key: "error.undoGone" });
    // Strict: every one must be there.
    calls.length = 0;
    expect(() => shelf.trash(["gone"], true)).toThrow();
    expect(calls).toEqual([]);
  });

  it("trashes an open workspace in a bulk list once: one trip Home", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    addWorkspace(library, { online: { id: "satisfactory", name: "Satisfactory" } }, new Date());
    const { shelf, calls } = await setup({ library, open: "valheim" });
    shelf.trash(["valheim", "satisfactory"], false);
    expect(calls.filter((call) => call.startsWith("home from"))).toEqual(["home from valheim"]);
    expect(isLive(library, "valheim") || isLive(library, "satisfactory")).toBe(false);
  });

  it("trashes a workspace named twice once, so nothing is left half done", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, calls, undos } = await setup({ library });
    for (const strict of [true, false]) {
      const token = shelf.trash(["valheim", "valheim"], strict);
      expect(isLive(library, "valheim")).toBe(false);
      await undos.undo(token);
      expect(isLive(library, "valheim")).toBe(true);
    }
    expect(calls).toEqual(["library saved", "library saved", "library saved", "library saved"]);
  });

  it("looks at the overlay panels again when workspaces go to Trash, when Undo puts them back, and when they are restored", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, synced, undos } = await setup({ library });
    const token = shelf.trash(["valheim"], true);
    expect(synced.count).toBe(1);
    await undos.undo(token);
    expect(synced.count).toBe(2);
    shelf.trash(["valheim"], true);
    shelf.restore(["valheim"], true);
    expect(synced.count).toBe(4);
  });

  it("leaves the open workspace for Home before trashing it: its questions end, its views close, and Undo opens it again", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, calls, undos, questions } = await setup({ library, open: "valheim" });
    const link = questions.ask("link", { workspace: "valheim" }, { url: "https://example.com" });
    const token = shelf.trash(["valheim"], true);
    expect(questions.peek("link")).toBeUndefined();
    expect(await link.answer).toBe("cancel");
    expect(library.lastWorkspaceId).toBeNull();
    expect(calls).toEqual(["home from valheim", "views closed", "library saved"]);
    await undos.undo(token);
    expect(library.lastWorkspaceId).toBe("valheim");
    expect(calls).toEqual(["home from valheim", "views closed", "library saved", "library saved", "open valheim"]);
  });

  it("stays on a workspace that wasn't trashed, and Undo doesn't switch to the one that comes back", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    addWorkspace(library, { online: { id: "satisfactory", name: "Satisfactory" } }, new Date());
    const { shelf, calls, undos } = await setup({ library, open: "satisfactory" });
    const token = shelf.trash(["valheim"], true);
    expect(calls).toEqual(["library saved"]);
    await undos.undo(token);
    expect(library.lastWorkspaceId).toBe("satisfactory");
    expect(calls).toEqual(["library saved", "library saved"]);
  });

  it("restores from Trash and tells the rail; strict refuses one that isn't there, else it is skipped", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    trashWorkspace(library, "valheim", new Date());
    const { shelf, calls } = await setup({ library });
    shelf.restore(["valheim", "missing"], false);
    expect(isLive(library, "valheim")).toBe(true);
    expect(calls).toEqual(["listed valheim"]);
    expect(() => shelf.restore(["valheim"], true)).toThrow(expect.objectContaining({ key: "error.workspace.notInTrash" }));
  });

  it("deletes a workspace for good with its panels, their state, its files, its icon and only its own browser sessions", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    addWorkspace(library, { online: { id: "satisfactory", name: "Satisfactory" } }, new Date());
    trashWorkspace(library, "valheim", new Date());
    const { shelf, calls, workspaces, userData } = await setup({ library });
    const record: InstanceRecord = { instanceId: "notes-1", moduleId: "tavora.notes" };
    workspaces.start("valheim", [record]);
    const files = path.join(userData, "files", "official", "tavora.notes", "valheim");
    await mkdir(files, { recursive: true });
    await writeFile(path.join(files, "picture.png"), "");
    for (const dir of ["module%3Aofficial%3Atavora.notes@valheim", "browser@satisfactory"]) await mkdir(path.join(userData, "Partitions", dir), { recursive: true });

    await shelf.delete(["valheim"], true);

    expect(library.workspaces.valheim).toBeUndefined();
    expect(workspaces.panels("valheim")).toEqual([]);
    expect(calls).toEqual([
      "library saved",
      "drop notes-1",
      "state gone notes-1",
      "forgotten valheim",
      "files of Valheim",
      "forget icon valheim",
      "clear persist:module:official:tavora.notes@valheim",
    ]);
    expect(existsSync(files)).toBe(false);
    // Not in Trash: strict refuses it, else it is skipped.
    await expect(shelf.delete(["satisfactory"], true)).rejects.toMatchObject({ key: "error.workspace.notInTrash" });
    calls.length = 0;
    await shelf.delete(["satisfactory"], false);
    expect(library.workspaces.satisfactory).toBeDefined();
    expect(calls).toEqual(["library saved"]);
  });

  it("deletes the data of a workspace whose time in Trash ran out", async () => {
    const { shelf, calls, userData } = await setup();
    await mkdir(path.join(userData, "Partitions", "browser@valheim"), { recursive: true });
    await shelf.deleteData({ ...emptyLibrary().workspaces, id: "valheim", name: "Valheim" } as never);
    expect(calls).toEqual(["forgotten valheim", "files of Valheim", "forget icon valheim", "clear persist:browser@valheim"]);
  });

  it("puts a picture the user picks on a workspace's icon; nothing when the dialog is closed", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const closed = await setup({ library, pick: undefined });
    await closed.shelf.chooseImage("valheim");
    expect(closed.calls).toEqual(["pick workspace-image"]);

    const picked = await setup({ library, pick: "/pictures/viking.png" });
    await picked.shelf.chooseImage("valheim");
    expect(picked.calls).toEqual(["pick workspace-image", "import /pictures/viking.png for valheim", "remember workspace-image /pictures/viking.png", "choose image for valheim"]);
    await expect(picked.shelf.chooseImage("gone")).rejects.toMatchObject({ key: "error.workspaceGone" });
  });

  it("applies a snapshot: panels it doesn't have close, new ones start with one welcome at most", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, calls, workspaces } = await setup({ library });
    workspaces.openPanel("valheim", { instanceId: "map", moduleId: "local.map" });
    workspaces.applyTemplate("valheim", gridTemplate(1, 1));
    const snapshot = workspaces.saveSnapshot("valheim", "Map");
    workspaces.closePanel("valheim", "map");
    workspaces.openPanel("valheim", { instanceId: "notes", moduleId: "tavora.notes" });
    workspaces.openPanel("valheim", { instanceId: "todos", moduleId: "tavora.todos" });
    workspaces.applyTemplate("valheim", gridTemplate(2, 1));
    const both = workspaces.saveSnapshot("valheim", "Both");

    shelf.applySnapshot("valheim", snapshot);
    expect(calls).toEqual(["close notes", "close todos", "start local.map"]);
    calls.length = 0;
    shelf.applySnapshot("valheim", both);
    // The map panel the first snapshot opened has an id of its own.
    expect(calls).toEqual([expect.stringMatching(/^close /), "start tavora.notes quietly", "start tavora.todos"]);
  });

  it("deletes a snapshot; Undo puts it back where it was", async () => {
    const library = emptyLibrary();
    addWorkspace(library, valheim, new Date());
    const { shelf, workspaces, undos } = await setup({ library });
    workspaces.openPanel("valheim", { instanceId: "notes", moduleId: "tavora.notes" });
    workspaces.applyTemplate("valheim", gridTemplate(1, 1));
    const first = workspaces.saveSnapshot("valheim", "First");
    workspaces.saveSnapshot("valheim", "Second");
    const token = shelf.deleteSnapshot("valheim", first);
    expect(workspaces.workspace("valheim").snapshots.map((item) => item.name)).toEqual(["Second"]);
    await undos.undo(token);
    expect(workspaces.workspace("valheim").snapshots.map((item) => item.name)).toEqual(["First", "Second"]);
  });
});
