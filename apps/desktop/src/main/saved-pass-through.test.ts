// Library, workspace and module storage keep the fields a newer Tavora added, so a PC on an older Tavora (say through the
// cloud copy) saves them again as they were and loses nothing (the decision log, saved data, 2026-11-14).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLayout } from "./layout";
import { deleteFolder, emptyLibrary, renameWorkspace, sanitizeLibrary, trashWorkspace, undeleteFolder } from "./library";
import { loadLibrary, SavedData } from "./saved-data";
import { ModuleStore, PanelStateStore } from "./storage";
import { loadWorkspace, saveWorkspace, Workspaces } from "./workspace";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-pass-through-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const at = (...names: string[]) => path.join(dir, ...names);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
const put = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};

const FOLDER = "44444444-4444-4444-8444-444444444444";
const NEWER_LIBRARY = {
  version: 3,
  futureSetting: { mode: "fancy" },
  workspaces: {
    poe2: { id: "poe2", kind: "game", catalogId: "poe2", name: "Path of Exile 2", icon: { kind: "monogram", text: "PE2" }, addedAt: "2026-10-14T10:00:00.000Z", futureColor: "#ff0000" },
    "local-notes": { id: "local-notes", kind: "personal", name: "Notes", icon: { kind: "monogram", text: "N" }, addedAt: "2026-10-22T10:00:00.000Z", pinned: [1, 2] },
  },
  folders: { [FOLDER]: { id: FOLDER, name: "Souls", label: null, workspaces: ["poe2"], collapsed: true } },
  root: [{ kind: "folder", id: FOLDER }, { kind: "workspace", id: "local-notes" }],
};

describe("library.json", () => {
  it("keeps unknown fields at the top, on each workspace and on each folder, through changes and a save", async () => {
    await put(at("library.json"), NEWER_LIBRARY);
    const library = await loadLibrary(dir);
    renameWorkspace(library, "poe2", "PoE 2");
    trashWorkspace(library, "local-notes", new Date("2026-11-14T00:00:00.000Z"));
    undeleteFolder(library, deleteFolder(library, FOLDER));
    const saved = new SavedData(dir);
    saved.saveLibrary(library);
    await saved.flush();
    const written = await json(at("library.json"));
    expect(written).toMatchObject({ version: 2, futureSetting: { mode: "fancy" } });
    expect(written.workspaces.poe2).toMatchObject({ name: "PoE 2", futureColor: "#ff0000" });
    expect(written.workspaces["local-notes"]).toMatchObject({ pinned: [1, 2] });
    expect(written.folders[FOLDER]).toMatchObject({ name: "Souls", collapsed: true });
    // And the next start reads the same again.
    expect(await loadLibrary(dir)).toEqual(sanitizeLibrary(written));
  });

  it("never lets an unknown field take the place of a known one, or of the object's prototype", () => {
    const library = sanitizeLibrary(JSON.parse('{"version":2,"sort":"sideways","__proto__":{"polluted":true},"workspaces":{"poe2":{"id":"poe2","kind":"game","name":"PoE","addedAt":"2026-10-14T10:00:00.000Z","showNews":"maybe","__proto__":{"x":1}}}}'));
    expect(library.sort).toBe(emptyLibrary().sort);
    expect(library.workspaces.poe2!.showNews).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(library)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(library.workspaces.poe2)).toBe(Object.prototype);
  });

  it("drops a broken workspace as before, unknown fields and all", () => {
    const library = sanitizeLibrary({ workspaces: { bad: { id: "bad", kind: "game", futureField: 1 } } });
    expect(library.workspaces).toEqual({});
  });
});

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const SNAP = "33333333-3333-4333-8333-333333333333";
const layout = (panels: string[], extra: Record<string, unknown> = {}) => ({
  width: 1600,
  height: 900,
  direction: "row",
  ...extra,
  root: { kind: "split", size: 1600, children: panels.map((id) => ({ kind: "group", size: 1600 / panels.length, panels: [id], active: id })) },
});

describe("workspace.json", () => {
  const NEWER = {
    version: 4,
    futureTop: "kept",
    workspaces: {
      poe2: {
        futureWorkspace: { tint: 3 },
        instances: [
          { instanceId: P1, moduleId: "tavora.notes", futurePin: true },
          { instanceId: P2, moduleId: "tavora.todos" },
        ],
        layout: layout([P1, P2], { futureLayoutField: 1 }),
        snapshots: [{ id: SNAP, name: "Boss", savedAt: "2026-10-20T10:00:00.000Z", layout: layout([P1]), modules: { [P1]: "tavora.notes" }, futureSnapshot: "x" }],
      },
    },
  };

  it("keeps unknown fields at the top, on each workspace, panel and snapshot, through changes and a save", async () => {
    await put(at("workspace.json"), NEWER);
    const state = await loadWorkspace(at("workspace.json"), ["poe2"], () => true);
    const workspaces = new Workspaces(state, { save: () => undefined, newId: () => "44444444-4444-4444-8444-444444444444" });
    workspaces.closePanel("poe2", P2);
    workspaces.updateSnapshot("poe2", SNAP);
    workspaces.renameSnapshot("poe2", SNAP, "Bosses");
    await saveWorkspace(at("workspace.json"), structuredClone(state));
    const written = await json(at("workspace.json"));
    expect(written).toMatchObject({ version: 3, futureTop: "kept" });
    expect(written.workspaces.poe2.futureWorkspace).toEqual({ tint: 3 });
    expect(written.workspaces.poe2.instances).toEqual([{ instanceId: P1, moduleId: "tavora.notes", futurePin: true }]);
    expect(written.workspaces.poe2.snapshots[0]).toMatchObject({ name: "Bosses", futureSnapshot: "x" });
  });

  it("reads a layout with a field it doesn't know, rather than dropping the whole layout", async () => {
    await put(at("workspace.json"), NEWER);
    const state = await loadWorkspace(at("workspace.json"), ["poe2"], () => true);
    expect(state.workspaces.poe2!.layout).not.toBeNull();
    expect(state.workspaces.poe2!.layout).not.toHaveProperty("futureLayoutField");
  });

  it("still refuses a layout from the host UI with a field it doesn't know", () => {
    expect(parseLayout(layout([P1], { futureLayoutField: 1 }))).toBeNull();
    expect(parseLayout(layout([P1], { futureLayoutField: 1 }), true)).not.toBeNull();
  });

  it("still drops the panels of a module that is gone, and a workspace not in the library", async () => {
    await put(at("workspace.json"), { ...NEWER, workspaces: { ...NEWER.workspaces, gone: { instances: [], layout: null, snapshots: [], futureWorkspace: 1 } } });
    const state = await loadWorkspace(at("workspace.json"), ["poe2"], (id) => id === "tavora.notes");
    expect(Object.keys(state.workspaces)).toEqual(["poe2"]);
    expect(state.workspaces.poe2!.instances.map((record) => record.instanceId)).toEqual([P1]);
  });
});

describe("module storage", () => {
  it("storage.json keeps fields other than the entries through sets and deletes, outside the quota", async () => {
    const file = at("module-data", "local", "local.notes", "poe2", "storage.json");
    await put(file, { version: 2, entries: { a: 1, b: 2 }, futureIndex: { a: "x".repeat(50) } });
    const store = new ModuleStore(file, 30);
    await store.set("c", 3);
    await store.delete("a");
    expect(await json(file)).toEqual({ version: 1, futureIndex: { a: "x".repeat(50) }, entries: { b: 2, c: 3 } });
    expect(await new ModuleStore(file).keys()).toEqual(["b", "c"]);
  });

  it("panel state keeps fields other than the value; a closed panel's go with it", async () => {
    const store = new PanelStateStore(at("panel-state"));
    await put(at("panel-state", `${P1}.json`), { version: 2, value: { scroll: 1 }, futureCursor: [3, 4] });
    await store.set(P1, { scroll: 2 });
    await store.set(P1, { scroll: 3 });
    expect(await json(at("panel-state", `${P1}.json`))).toEqual({ version: 1, futureCursor: [3, 4], value: { scroll: 3 } });
    await store.remove(P1);
    await store.set(P1, { scroll: 4 });
    expect(await json(at("panel-state", `${P1}.json`))).toEqual({ version: 1, value: { scroll: 4 } });
  });
});
