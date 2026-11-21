// What keeps local saves safe when something goes wrong: a lost library, a write that fails, a folder that can't be
// read, an update cut off, a reinstall, and going back to an older Tavora.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlobStore, BlobWrites } from "./blobs";
import { writeFileAtomic } from "./fsutil";
import { renameHeld } from "./rename-held";
import { Inbox } from "./inbox";
import { recoverInstalls } from "./installer";
import { emptyLibrary, libraryToSave, sanitizeLibrary } from "./library";
import { cancelPartitionDeletes, deleteModuleDataOf, migrateModuleData, modulePartition, partitionDirName } from "./module-data";
import { ModuleStore } from "./storage";
import { loadWorkspace, saveWorkspace, Workspaces } from "./workspace";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-local-saves-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const at = (...names: string[]) => path.join(dir, ...names);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
const put = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};
const exists = (file: string) => stat(file).then(() => true, () => false);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0]);

describe("atomic writes", () => {
  it("leaves no temp file and writes the whole body", async () => {
    await writeFileAtomic(at("a.json"), "whole");
    expect(await readFile(at("a.json"), "utf8")).toBe("whole");
    expect(await readdir(dir)).toEqual(["a.json"]);
  });

  it.runIf(process.platform === "win32")("tries a rename again while the target is held", async () => {
    await put(at("from"), "new");
    await put(at("to"), "old");
    const fs = await import("node:fs/promises");
    // Holding a file open for writing without sharing isn't possible from Node, so the first try is refused by a read-only target.
    await fs.chmod(at("to"), 0o444);
    const freed = setTimeout(() => void fs.chmod(at("to"), 0o666), 5);
    await renameHeld(at("from"), at("to"), [30, 60, 120]);
    clearTimeout(freed);
    expect(await readFile(at("to"), "utf8")).toBe("new");
  });
});

describe("a settings write that fails", () => {
  it("changes nothing in memory, for set and for delete", async () => {
    const store = new ModuleStore(at("store", "storage.json"));
    await store.set("kept", 1);
    const failing = vi.spyOn(store as unknown as { persist: () => Promise<void> }, "persist").mockRejectedValue(new Error("disk full"));
    await expect(store.set("kept", 2)).rejects.toThrow("disk full");
    await expect(store.set("new", 3)).rejects.toThrow("disk full");
    await expect(store.delete("kept")).rejects.toThrow("disk full");
    failing.mockRestore();
    expect(await store.get("kept")).toBe(1);
    expect(await store.get("new")).toBeNull();
    expect(await store.keys()).toEqual(["kept"]);
  });
});

describe("a lost library", () => {
  const panel = "11111111-1111-4111-8111-111111111111";
  const saved = { version: 3, workspaces: { "elden-ring": { instances: [{ instanceId: panel, moduleId: "tavora.notes" }], layout: null, snapshots: [] } } };

  it("keeps the layouts it doesn't list when a workspace is added, and they come back with the library", async () => {
    await put(at("workspace.json"), JSON.stringify(saved));
    const state = await loadWorkspace(at("workspace.json"), [], () => true);
    expect(state.workspaces).toEqual({});
    const workspaces = new Workspaces(state, { save: (next) => void saveWorkspace(at("workspace.json"), next) });
    workspaces.addWorkspaces(["local-new"]);
    await vi.waitFor(async () => expect(Object.keys((await json(at("workspace.json"))).workspaces).sort()).toEqual(["elden-ring", "local-new"]));
    expect((await json(at("workspace.json"))).unlisted).toBeUndefined();

    const back = await loadWorkspace(at("workspace.json"), ["elden-ring", "local-new"], () => true);
    expect(back.workspaces["elden-ring"]!.instances).toMatchObject([{ instanceId: panel }]);
  });

  it("gives a workspace added back its panels", async () => {
    await put(at("workspace.json"), JSON.stringify(saved));
    const workspaces = new Workspaces(await loadWorkspace(at("workspace.json"), [], () => true), { save: () => undefined, isInstalled: () => true });
    workspaces.addWorkspaces(["elden-ring"]);
    expect(workspaces.panels("elden-ring")).toMatchObject([{ instanceId: panel }]);
  });

  it("lets a workspace deleted for good go", async () => {
    await put(at("workspace.json"), JSON.stringify(saved));
    const state = await loadWorkspace(at("workspace.json"), [], () => true);
    let written: Parameters<typeof saveWorkspace>[1] | undefined;
    new Workspaces(state, { save: (next) => void (written = next) }).forgetWorkspace("elden-ring");
    await saveWorkspace(at("workspace.json"), written!);
    expect((await json(at("workspace.json"))).workspaces).toEqual({});
  });
});

describe("a module installed again", () => {
  const owner = "0123456789abcdef0123456789abcdef";
  const moduleId = "wellbrained.dice";
  const partition = modulePartition(owner, moduleId, "elden-ring");
  const folder = () => at("Partitions", partitionDirName(partition));

  it("keeps what it saved when the delete was called off at install", async () => {
    await put(path.join(folder(), "data"), "new data");
    await deleteModuleDataOf(dir, owner, moduleId);
    await cancelPartitionDeletes(dir, owner, moduleId);
    await migrateModuleData(dir);
    expect(await exists(path.join(folder(), "data"))).toBe(true);
    expect(await exists(at("module-data-pending.json"))).toBe(false);
  });

  it("keeps it when the module came back another way", async () => {
    await put(path.join(folder(), "data"), "new data");
    await deleteModuleDataOf(dir, owner, moduleId);
    await migrateModuleData(dir, undefined, undefined, (who, id) => who === owner && id === moduleId);
    expect(await exists(path.join(folder(), "data"))).toBe(true);
  });

  it("still deletes the storage of a module that stays gone", async () => {
    await put(path.join(folder(), "data"), "old data");
    await deleteModuleDataOf(dir, owner, moduleId);
    await migrateModuleData(dir);
    expect(await exists(folder())).toBe(false);
  });

  it("calls off only that module's deletes", async () => {
    const other = modulePartition(owner, "wellbrained.other", "elden-ring");
    await put(path.join(folder(), "data"), "x");
    await put(path.join(at("Partitions", partitionDirName(other)), "data"), "x");
    await deleteModuleDataOf(dir, owner, moduleId);
    await deleteModuleDataOf(dir, owner, "wellbrained.other");
    await cancelPartitionDeletes(dir, owner, moduleId);
    expect((await json(at("module-data-pending.json"))).deletePartitions).toEqual([other]);
  });
});

describe("a module update that was cut off", () => {
  const manifest = (id: string, version: string) => JSON.stringify({ id, version });

  it("puts the previous copy back when nothing took its place", async () => {
    await put(at("module-staging", "old-1", "tavora.module.json"), manifest("wellbrained.dice", "1.0.0"));
    await mkdir(at("modules"));
    await recoverInstalls({ userData: dir, userModules: at("modules"), officialDir: at("official-updates"), log: () => undefined });
    expect((await json(at("modules", "wellbrained.dice", "tavora.module.json"))).version).toBe("1.0.0");
    expect(await readdir(at("module-staging"))).toEqual([]);
  });

  it("removes what is left of the previous copy when the new one is in place", async () => {
    await put(at("module-staging", "old-1", "tavora.module.json"), manifest("wellbrained.dice", "1.0.0"));
    await put(at("modules", "wellbrained.dice", "tavora.module.json"), manifest("wellbrained.dice", "2.0.0"));
    await recoverInstalls({ userData: dir, userModules: at("modules"), officialDir: at("official-updates"), log: () => undefined });
    expect((await json(at("modules", "wellbrained.dice", "tavora.module.json"))).version).toBe("2.0.0");
    expect(await readdir(at("module-staging"))).toEqual([]);
  });

  it("leaves a folder alone that isn't a module, and clears half-unpacked installs", async () => {
    await put(at("module-staging", "old-1", "note.txt"), "?");
    await put(at("module-staging", "install-1", "half"), "?");
    await recoverInstalls({ userData: dir, userModules: at("modules"), officialDir: at("official-updates"), log: () => undefined });
    expect(await readdir(at("module-staging"))).toEqual(["old-1"]);
  });
});

describe("a picture saved while the folder moves", () => {
  async function* slowly(release: Promise<void>) {
    yield PNG;
    await release;
    yield PNG;
  }

  it("is waited for, so it is in the list the move makes", async () => {
    const writes = new BlobWrites();
    const store = new BlobStore(() => at("blobs"), undefined, () => false, "workspace", writes);
    let finish: () => void = () => undefined;
    const release = new Promise<void>((resolve) => (finish = resolve));
    const saving = store.put(slowly(release));
    let idle = false;
    const waited = writes.idle(5_000).then((done) => {
      idle = done;
      return done;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle).toBe(false);
    finish();
    await saving;
    expect(await waited).toBe(true);
    expect((await readdir(at("blobs"))).filter((name) => name.endsWith(".png"))).toHaveLength(1);
  });

  it("gives up waiting for a stalled stream and says so", async () => {
    const writes = new BlobWrites();
    const ended = writes.begin();
    expect(await writes.idle(5)).toBe(false);
    ended();
    expect(await writes.idle(5)).toBe(true);
  });

  it("is refused when it only got its turn after the move began", async () => {
    let locked = false;
    const store = new BlobStore(() => at("blobs"), undefined, () => locked);
    let finish: () => void = () => undefined;
    const first = store.put(slowly(new Promise<void>((resolve) => (finish = resolve))));
    await vi.waitFor(async () => expect((await readdir(at("blobs")).catch(() => [])).length).toBe(1));
    const second = store.put((async function* () {
      yield PNG;
    })());
    const refused = expect(second).rejects.toThrow(/being moved/);
    locked = true;
    finish();
    await first;
    await refused;
  });
});

describe("the inbox", () => {
  it("reads again after a refresh that came in during a read", async () => {
    let lists = 0;
    let free: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (free = resolve));
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/v1/conversations")) {
        const number = ++lists;
        if (number === 1) await gate;
        return new Response(JSON.stringify({ conversations: [], inbox: { developer: number > 1 } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const inbox = new Inbox({ baseUrl: "http://tavora.test", token: () => "token", fetch: fetchMock as unknown as typeof fetch, file: at("inbox.json"), onChange: () => undefined, language: () => "en", isDeveloper: () => false } as never);
    const first = inbox.refresh();
    const second = inbox.refresh(true);
    free();
    await Promise.all([first, second]);
    expect(lists).toBe(2);
    expect(inbox.view().developer).toBe(true);
  });
});

describe("going back to an older Tavora", () => {
  /** What 0.24.108 keeps of a library when it saves: its own rules for these two, every field it doesn't know as it was. */
  const olderSave = (saved: Record<string, unknown>) => {
    const next = { ...saved };
    next.radius = Number.isInteger(saved.radius) && (saved.radius as number) >= 4 && (saved.radius as number) <= 12 ? saved.radius : null;
    if (typeof saved.font !== "string" || saved.font === "inter") delete next.font;
    return next;
  };
  const roundTrip = (library: ReturnType<typeof emptyLibrary>) => sanitizeLibrary(olderSave(JSON.parse(JSON.stringify(libraryToSave(library)))));

  it.each([0, 3, 13, 16])("keeps a corner radius of %i through its saves", (radius) => {
    expect(roundTrip({ ...emptyLibrary(), radius }).radius).toBe(radius);
  });

  it("shows the nearest radius it can read meanwhile", () => {
    expect(libraryToSave({ ...emptyLibrary(), radius: 2 })).toMatchObject({ radius: 4, cornerRadius: 2 });
    expect(libraryToSave({ ...emptyLibrary(), radius: 15 })).toMatchObject({ radius: 12, cornerRadius: 15 });
  });

  it("lets a reset on the older Tavora stick, for the radius and for Inter", () => {
    const written = olderSave(JSON.parse(JSON.stringify(libraryToSave({ ...emptyLibrary(), radius: 2, font: "inter" }))) as Record<string, unknown>);
    const reset: Record<string, unknown> = { ...written, radius: null };
    delete reset.font;
    const library = sanitizeLibrary(reset);
    expect(library.radius).toBeNull();
    expect(library.font).toBeUndefined();
  });

  it("keeps a radius it can read in the old field, with no second one", () => {
    const saved = libraryToSave({ ...emptyLibrary(), radius: 8 });
    expect(saved).toMatchObject({ radius: 8 });
    expect(saved).not.toHaveProperty("cornerRadius");
    expect(roundTrip({ ...emptyLibrary(), radius: 8 }).radius).toBe(8);
  });

  it("keeps an explicit Inter, and leaves other fonts as they were", () => {
    expect(roundTrip({ ...emptyLibrary(), font: "inter" }).font).toBe("inter");
    expect(libraryToSave({ ...emptyLibrary(), font: "allo" })).toMatchObject({ font: "allo" });
    expect(roundTrip({ ...emptyLibrary(), font: "allo" }).font).toBe("allo");
    expect(roundTrip(emptyLibrary()).font).toBeUndefined();
  });

  it("lets a radius or font picked on the older Tavora win", () => {
    const written = JSON.parse(JSON.stringify(libraryToSave({ ...emptyLibrary(), radius: 2, font: "inter" }))) as Record<string, unknown>;
    expect(sanitizeLibrary({ ...olderSave(written), radius: 9, font: "rubik" })).toMatchObject({ radius: 9, font: "rubik" });
  });

  it("still reads files written with the value in the old field", () => {
    expect(sanitizeLibrary({ ...libraryToSave(emptyLibrary()), radius: 2, font: "inter" })).toMatchObject({ radius: 2, font: "inter" });
  });

  it("doesn't carry the extra fields along in memory", () => {
    const library = sanitizeLibrary(libraryToSave({ ...emptyLibrary(), radius: 2, font: "inter" }));
    expect(library).not.toHaveProperty("cornerRadius");
    expect(library).not.toHaveProperty("interfaceFont");
    expect(libraryToSave({ ...library, radius: 6, font: "allo" })).not.toHaveProperty("cornerRadius");
  });
});
