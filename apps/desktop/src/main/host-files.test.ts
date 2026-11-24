import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deleteModuleData, deleteModuleDataOf, listModuleData, migrateModuleData, modulePartition, orphanedPartitions, holdLeftovers, partitionsOf, partitionWorkspace, queueLocalDataMove, SWEEP_HOLD_FILE } from "./module-data";
import { IconError, imageType, importIcon, MAX_ICON_BYTES } from "./icons";
import { initialBounds } from "./window-state";

// writeFileAtomic flushes every file to the disk (fsync). That is the point in the app, but on a busy CI disk one flush
// takes seconds, and these tests write several files each. They check what is kept, not that a power cut is survived
// so the flush is skipped here.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      handle.sync = async () => undefined;
      return handle;
    }) as typeof actual.open,
  };
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "tavora-files-"));
}

describe("deleteModuleData", () => {
  it("deletes one workspace's data for every module of every owner and keeps other workspaces", async () => {
    const userData = await tempDir();
    const modules = ["local/local.a", "local/local.b", "official/tavora.notes", "0123456789abcdef0123456789abcdef/local.a"];
    for (const module of modules) {
      for (const game of ["poe2", "satisfactory"]) {
        await mkdir(path.join(userData, "module-data", module, game), { recursive: true });
        await writeFile(path.join(userData, "module-data", module, game, "storage.json"), "{}");
      }
    }
    await deleteModuleData(userData, "poe2");
    for (const module of modules) {
      expect(await readdir(path.join(userData, "module-data", module))).toEqual(["satisfactory"]);
    }
  });

  it("deletes the files modules keep for the workspace too", async () => {
    const userData = await tempDir();
    for (const game of ["poe2", "satisfactory"]) {
      await mkdir(path.join(userData, "module-blobs", "local", "local.a", game), { recursive: true });
      await writeFile(path.join(userData, "module-blobs", "local", "local.a", game, "0".repeat(32) + ".png"), "x");
    }
    await deleteModuleData(userData, "poe2");
    expect(await readdir(path.join(userData, "module-blobs", "local", "local.a"))).toEqual(["satisfactory"]);
    // A folder moved elsewhere is cleaned the same way.
    const elsewhere = await tempDir();
    await mkdir(path.join(elsewhere, "local", "local.a", "poe2"), { recursive: true });
    await deleteModuleData(userData, "poe2", elsewhere);
    expect(await readdir(path.join(elsewhere, "local", "local.a"))).toEqual([]);
  });

  it("leaves the user's own folders in the files folder alone, also ones named like the workspace", async () => {
    const userData = await tempDir();
    const blob = "0".repeat(32) + ".png";
    // The user's own pictures, saved next to Tavora's (Pictures\Tavora). Each in a folder of its own, as Windows names
    // are case-insensitive and some of these would be one folder there.
    const own = [
      ["Screenshots", "2025", "Valheim"],
      ["Screenshots", "2025", "valheim"],
      ["Builds", "valheim"],
      // An owner and a module id, but in another case: not a folder Tavora made.
      ["Local", "local.a", "valheim"],
      ["local", "Local.A", "valheim"],
      ["local", "local.a", "Valheim"],
    ];
    for (const segments of own) {
      const pictures = await tempDir();
      await mkdir(path.join(pictures, ...segments), { recursive: true });
      await writeFile(path.join(pictures, ...segments, "base.png"), "mine");
      // Tavora's own folder for the workspace goes.
      await mkdir(path.join(pictures, "official", "tavora.notes", "valheim"), { recursive: true });
      await writeFile(path.join(pictures, "official", "tavora.notes", "valheim", blob), "x");
      await deleteModuleData(userData, "valheim", pictures);
      expect(existsSync(path.join(pictures, ...segments, "base.png"))).toBe(true);
      expect(await readdir(path.join(pictures, "official", "tavora.notes"))).toEqual([]);
    }
  });

  it("never follows a link or junction out of the files folder", async () => {
    const userData = await tempDir();
    const pictures = await tempDir();
    const outside = await tempDir();
    await mkdir(path.join(outside, "valheim"), { recursive: true });
    await writeFile(path.join(outside, "valheim", "0".repeat(32) + ".png"), "mine");
    await mkdir(path.join(pictures, "local"), { recursive: true });
    await symlink(outside, path.join(pictures, "local", "local.a"), "junction");
    await deleteModuleData(userData, "valheim", pictures);
    expect(existsSync(path.join(outside, "valheim", "0".repeat(32) + ".png"))).toBe(true);
  });

  it("sends Tavora's folder for the workspace to the Recycle Bin, and deletes only its own files when that can't be done", async () => {
    const userData = await tempDir();
    const pictures = await tempDir();
    const blob = "0".repeat(32) + ".png";
    const dir = path.join(pictures, "official", "tavora.notes", "valheim");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, blob), "x");
    const trashed: string[] = [];
    await deleteModuleData(userData, "valheim", pictures, async (folder) => {
      trashed.push(folder);
      await rm(folder, { recursive: true });
    });
    expect(trashed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);

    // No Recycle Bin: Tavora's files go, and what the user put in there with them stays.
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, blob), "x");
    await writeFile(path.join(dir, "my notes.txt"), "mine");
    await deleteModuleData(userData, "valheim", pictures, async () => {
      throw new Error("no recycle bin");
    });
    expect(await readdir(dir)).toEqual(["my notes.txt"]);
  });

  it("does nothing without module data and refuses unsafe ids", async () => {
    const userData = await tempDir();
    await expect(deleteModuleData(userData, "poe2")).resolves.toBeUndefined();
    await expect(deleteModuleData(userData, "../x")).rejects.toThrow();
  });
});

describe("orphanedPartitions", () => {
  it("finds module and Browser partitions of workspaces that are gone", async () => {
    const userData = await tempDir();
    // Windows forbids colons in directory names; Electron escapes them there.
    const rawPartition = process.platform === "win32" ? [] : ["module:local.example.b@gone-game"];
    const names = [
      "module%3Alocal.example.a%40poe2",
      "module%3alocal.example.a%40gone-game",
      "module%3Alocal%3Alocal.example.a@poe2",
      "module%3Alocal%3Alocal.example.a@gone-game",
      ...rawPartition,
      "browser%40poe2",
      "browser%40gone-game",
      // The Browser's sign-ins shared by every workspace belong to no workspace and stay.
      "browser",
      "something-else",
    ];
    for (const name of names) await mkdir(path.join(userData, "Partitions", name), { recursive: true });
    const found = await orphanedPartitions(userData, new Set(["poe2"]));
    expect(found.map((dir) => path.basename(dir)).sort()).toEqual([
      "browser%40gone-game",
      "module%3Alocal%3Alocal.example.a@gone-game",
      "module%3alocal.example.a%40gone-game",
      ...rawPartition,
    ]);
    expect(await orphanedPartitions(await tempDir(), new Set())).toEqual([]);
  });
});

describe("partitionsOf", () => {
  it("finds only the partitions of the workspaces named", async () => {
    const userData = await tempDir();
    for (const name of ["module%3Alocal%3Alocal.example.a@poe2", "browser%40poe2", "browser%40kept", "module%3Alocal%3Alocal.example.a@kept", "browser"]) {
      await mkdir(path.join(userData, "Partitions", name), { recursive: true });
    }
    expect((await partitionsOf(userData, ["poe2"])).map((dir) => path.basename(dir)).sort()).toEqual(["browser%40poe2", "module%3Alocal%3Alocal.example.a@poe2"]);
    expect(await partitionsOf(userData, [])).toEqual([]);
  });
});

describe("holdLeftovers", () => {
  const set = (...ids: string[]) => new Set(ids);
  const leftovers = (workspaces: string[], panels: string[] = []) => ({ workspaces: set(...workspaces), panels: set(...panels) });
  const held = async (userData: string) => (await readdir(userData)).includes(SWEEP_HOLD_FILE);

  it("keeps nothing when the files were read and nothing was held", async () => {
    const userData = await tempDir();
    expect(await holdLeftovers(userData, true, leftovers(["gone"], ["p1"]))).toEqual(leftovers([]));
    expect(await held(userData)).toBe(false);
  });

  it("keeps what a lost library or workspace file may have listed, at later starts too, and sweeps the rest", async () => {
    const userData = await tempDir();
    // A fresh install: nothing left over, nothing held.
    expect(await holdLeftovers(userData, false, leftovers([]))).toEqual(leftovers([]));
    expect(await held(userData)).toBe(false);
    // The library was set aside: everything left over is kept.
    expect(await holdLeftovers(userData, false, leftovers(["old-a", "old-b"], ["p1", "p2"]))).toEqual(leftovers(["old-a", "old-b"], ["p1", "p2"]));
    expect(await held(userData)).toBe(true);
    // The next start reads its new library: the held ones stay kept, a workspace deleted since is swept.
    expect(await holdLeftovers(userData, true, leftovers(["old-a", "old-b", "deleted-since"], ["p1", "p2", "p3"]))).toEqual(leftovers(["old-a", "old-b"], ["p1", "p2"]));
    // The user brought the library back: none is left over, so the hold goes.
    expect(await holdLeftovers(userData, true, leftovers([]))).toEqual(leftovers([]));
    expect(await held(userData)).toBe(false);
    expect(await holdLeftovers(userData, true, leftovers(["gone"]))).toEqual(leftovers([]));
  });

  it("sets a damaged hold file aside, keeps everything this start and clears the fresh hold later", async () => {
    const userData = await tempDir();
    await writeFile(path.join(userData, SWEEP_HOLD_FILE), "{not json");
    expect(await holdLeftovers(userData, true, leftovers(["a"], ["p"]))).toEqual(leftovers(["a"], ["p"]));
    expect((await readdir(userData)).some((name) => name.startsWith(`${SWEEP_HOLD_FILE}.corrupt-`))).toBe(true);
    expect(JSON.parse(await readFile(path.join(userData, SWEEP_HOLD_FILE), "utf8"))).toMatchObject({ version: 1, workspaces: ["a"], panels: ["p"] });
    expect(await holdLeftovers(userData, true, leftovers([]))).toEqual(leftovers([]));
    expect(await held(userData)).toBe(false);
  });

  it("copies a newer Tavora's hold file aside and keeps everything this start", async () => {
    const userData = await tempDir();
    await writeFile(path.join(userData, SWEEP_HOLD_FILE), JSON.stringify({ version: 2, workspaces: [], panels: [] }));
    expect(await holdLeftovers(userData, true, leftovers(["a"]))).toEqual(leftovers(["a"]));
    expect((await readdir(userData)).some((name) => name.startsWith(`${SWEEP_HOLD_FILE}.from-version-2`))).toBe(true);
  });

  it("reads a partition's workspace", () => {
    expect(partitionWorkspace(path.join("x", "browser%40poe2"))).toBe("poe2");
    expect(partitionWorkspace("module%3Alocal%3Alocal.example.a@Poe2")).toBe("poe2");
    expect(partitionWorkspace("browser")).toBeNull();
  });
});

describe("icons", () => {
  it("recognises images by content", () => {
    expect(imageType(PNG)).toBe("png");
    expect(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(imageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });

  it("copies a valid image under a fresh name and refuses anything else", async () => {
    const dir = await tempDir();
    const source = path.join(dir, "picked.PNG");
    await writeFile(source, PNG);
    const file = await importIcon(path.join(dir, "icons"), "poe2", source);
    expect(file).toMatch(/^poe2-[0-9a-f]{8}\.png$/);
    expect(new Uint8Array(await readFile(path.join(dir, "icons", file)))).toEqual(PNG);

    const fake = path.join(dir, "fake.png");
    await writeFile(fake, "<svg/>");
    await expect(importIcon(dir, "poe2", fake)).rejects.toThrow(IconError);
    const big = path.join(dir, "big.png");
    await writeFile(big, new Uint8Array(MAX_ICON_BYTES + 1));
    await expect(importIcon(dir, "poe2", big)).rejects.toThrow("2 MB");
  });
});

describe("initialBounds", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };

  it("reuses saved bounds on a connected display", () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1200, height: 900 }, maximized: true };
    expect(initialBounds(saved, [primary, second], primary)).toEqual(saved);
  });

  it("centres on the primary display when the saved display is gone", () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1200, height: 900 }, maximized: false };
    expect(initialBounds(saved, [primary], primary)).toEqual({
      bounds: { x: 320, y: 120, width: 1280, height: 800 },
      maximized: false,
    });
  });

  it("ignores broken or tiny saved bounds", () => {
    const small = { x: 0, y: 0, width: 1024, height: 600 };
    expect(initialBounds(null, [small], small).bounds).toEqual({ x: 0, y: 0, width: 1024, height: 600 });
    expect(initialBounds({ bounds: { x: 0, y: 0, width: 10, height: 10 } }, [primary], primary).bounds.width).toBe(1280);
    expect(initialBounds({ bounds: { x: "a" } }, [primary], primary).bounds.width).toBe(1280);
  });
});

describe("migrateModuleData", () => {
  it("moves data and browser storage keyed by id alone under its owner", async () => {
    const userData = await tempDir();
    for (const id of ["tavora.notes", "local.me.tracker"]) {
      await mkdir(path.join(userData, "module-data", id, "poe2"), { recursive: true });
      await writeFile(path.join(userData, "module-data", id, "poe2", "storage.json"), id);
      await mkdir(path.join(userData, "Partitions", `module%3A${id}@poe2`, "Local Storage"), { recursive: true });
    }
    await mkdir(path.join(userData, "Partitions", "browser@poe2"), { recursive: true });

    await migrateModuleData(userData);

    expect((await readdir(path.join(userData, "module-data"))).sort()).toEqual(["local", "official"]);
    expect(await readFile(path.join(userData, "module-data", "official", "tavora.notes", "poe2", "storage.json"), "utf8")).toBe("tavora.notes");
    expect(await readFile(path.join(userData, "module-data", "local", "local.me.tracker", "poe2", "storage.json"), "utf8")).toBe("local.me.tracker");
    // The names Electron gives these partitions on disk (checked against Electron 44).
    expect((await readdir(path.join(userData, "Partitions"))).sort()).toEqual([
      "browser@poe2",
      "module%3Alocal%3Alocal.me.tracker@poe2",
      "module%3Aofficial%3Atavora.notes@poe2",
    ]);
    expect(modulePartition("local", "local.me.tracker", "poe2")).toBe("persist:module:local:local.me.tracker@poe2");

    // A second start finds nothing left to move.
    await migrateModuleData(userData);
    expect((await readdir(path.join(userData, "module-data"))).sort()).toEqual(["local", "official"]);
  });

  it("never overwrites data already under an owner", async () => {
    const userData = await tempDir();
    await mkdir(path.join(userData, "module-data", "local.me.tracker", "poe2"), { recursive: true });
    await mkdir(path.join(userData, "module-data", "local", "local.me.tracker", "poe2"), { recursive: true });
    await writeFile(path.join(userData, "module-data", "local", "local.me.tracker", "poe2", "storage.json"), "new");
    const lines: string[] = [];
    await migrateModuleData(userData, (line) => lines.push(line));
    expect(await readFile(path.join(userData, "module-data", "local", "local.me.tracker", "poe2", "storage.json"), "utf8")).toBe("new");
    expect(await readdir(path.join(userData, "module-data", "local.me.tracker"))).toEqual(["poe2"]);
    expect(lines).toHaveLength(1);
  });

  it("moves only Tavora's own folders in the files folder, never the user's", async () => {
    const userData = await tempDir();
    const pictures = await tempDir();
    const blob = "0".repeat(32) + ".png";
    // The user's folders whose names look like module ids.
    await mkdir(path.join(pictures, "game.shots", "valheim"), { recursive: true });
    await writeFile(path.join(pictures, "game.shots", "valheim", "base.png"), "mine");
    await mkdir(path.join(pictures, "v1.2"), { recursive: true });
    await writeFile(path.join(pictures, "v1.2", blob), "mine");
    await mkdir(path.join(pictures, "empty.one"), { recursive: true });
    const outside = await tempDir();
    await mkdir(path.join(outside, "valheim"), { recursive: true });
    await writeFile(path.join(outside, "valheim", blob), "mine");
    await symlink(outside, path.join(pictures, "linked.one"), "junction");
    // Files a module saved before modules had owners.
    await mkdir(path.join(pictures, "local.me.tracker", "valheim"), { recursive: true });
    await writeFile(path.join(pictures, "local.me.tracker", "valheim", blob), "x");

    await migrateModuleData(userData, () => undefined, pictures);

    expect((await readdir(pictures)).sort()).toEqual(["empty.one", "game.shots", "linked.one", "local", "v1.2"]);
    expect(await readdir(path.join(pictures, "local"))).toEqual(["local.me.tracker"]);
    expect(await readFile(path.join(pictures, "game.shots", "valheim", "base.png"), "utf8")).toBe("mine");
  });

  it("does nothing on a fresh data folder", async () => {
    await expect(migrateModuleData(await tempDir())).resolves.toBeUndefined();
  });
});

describe("leftover module data", () => {
  const KEY = "0123456789abcdef0123456789abcdef";

  async function seed(userData: string, owner: string, id: string, game: string, body: string) {
    await mkdir(path.join(userData, "module-data", owner, id, game), { recursive: true });
    await writeFile(path.join(userData, "module-data", owner, id, game, "storage.json"), body);
    await mkdir(path.join(userData, "Partitions", `module%3A${owner}%3A${id}@${game}`), { recursive: true });
  }

  it("moves queued local data only through real folders with exactly those names, never a link or a folder named in another case", async () => {
    const userData = await tempDir();
    const outside = await tempDir();
    await mkdir(path.join(outside, "poe2"), { recursive: true });
    await writeFile(path.join(outside, "poe2", "storage.json"), "not ours");
    // The module's folder is a junction to somewhere else, and a game folder inside another module is one too.
    await mkdir(path.join(userData, "module-data", "local"), { recursive: true });
    await symlink(outside, path.join(userData, "module-data", "local", "wellbrained.tracker"), "junction");
    await mkdir(path.join(userData, "module-data", "local", "wellbrained.other"), { recursive: true });
    await symlink(path.join(outside, "poe2"), path.join(userData, "module-data", "local", "wellbrained.other", "poe2"), "junction");
    // A folder that only matches in another case (Windows treats it as the same folder).
    const cased = await tempDir();
    await mkdir(path.join(cased, "module-data", "Local", "wellbrained.cased", "poe2"), { recursive: true });
    for (const id of ["wellbrained.tracker", "wellbrained.other"]) await queueLocalDataMove(userData, id, KEY);
    await queueLocalDataMove(cased, "wellbrained.cased", KEY);

    await migrateModuleData(userData);
    await migrateModuleData(cased);

    const moved = (id: string, root = userData) => existsSync(path.join(root, "module-data", KEY, id));
    expect([moved("wellbrained.tracker"), moved("wellbrained.other"), moved("wellbrained.cased", cased)]).toEqual([false, false, false]);
    expect(await readFile(path.join(outside, "poe2", "storage.json"), "utf8")).toBe("not ours");
    expect(existsSync(path.join(userData, "module-data", "local", "wellbrained.other", "poe2"))).toBe(true);
  });

  it("lists what each owner's modules saved", async () => {
    const userData = await tempDir();
    await seed(userData, "local", "wellbrained.tracker", "poe2", "l");
    await seed(userData, KEY, "wellbrained.tracker", "poe2", "k");
    const found = await listModuleData(userData);
    expect(found.sort((a, b) => a.owner.localeCompare(b.owner))).toEqual([
      { owner: KEY, moduleId: "wellbrained.tracker" },
      { owner: "local", moduleId: "wellbrained.tracker" },
    ]);
  });

  it("deletes one owner's data now and its browser storage at the next start", async () => {
    const userData = await tempDir();
    await seed(userData, "local", "wellbrained.tracker", "poe2", "l");
    await seed(userData, KEY, "wellbrained.tracker", "poe2", "k");
    expect(await deleteModuleDataOf(userData, "local", "wellbrained.tracker")).toEqual([modulePartition("local", "wellbrained.tracker", "poe2")]);
    expect(await listModuleData(userData)).toEqual([{ owner: KEY, moduleId: "wellbrained.tracker" }]);
    await migrateModuleData(userData);
    expect(await readdir(path.join(userData, "Partitions"))).toEqual([`module%3A${KEY}%3Awellbrained.tracker@poe2`]);
    await expect(deleteModuleDataOf(userData, "..", "wellbrained.tracker")).rejects.toThrow();
  });

  it("deletes a module's files from the files folder only through folders Tavora made, to the Recycle Bin when it can", async () => {
    const userData = await tempDir();
    const pictures = await tempDir();
    const blob = "0".repeat(32) + ".png";
    // Linked to a folder of the user's: left alone.
    const outside = await tempDir();
    await mkdir(path.join(outside, "local.a", "valheim"), { recursive: true });
    await writeFile(path.join(outside, "local.a", "valheim", blob), "mine");
    await symlink(outside, path.join(pictures, "local"), "junction");
    await deleteModuleDataOf(userData, "local", "local.a", pictures);
    expect(existsSync(path.join(outside, "local.a", "valheim", blob))).toBe(true);

    // Tavora's own folder goes to the Recycle Bin; without one, only Tavora's files go.
    const dir = path.join(pictures, "official", "tavora.notes");
    await mkdir(path.join(dir, "valheim"), { recursive: true });
    await writeFile(path.join(dir, "valheim", blob), "x");
    const trashed: string[] = [];
    await deleteModuleDataOf(userData, "official", "tavora.notes", pictures, async (folder) => {
      trashed.push(folder);
      await rm(folder, { recursive: true });
    });
    expect(trashed).toEqual([dir]);
    await mkdir(path.join(dir, "valheim"), { recursive: true });
    await mkdir(path.join(dir, "_app"), { recursive: true });
    await writeFile(path.join(dir, "valheim", blob), "x");
    await writeFile(path.join(dir, "_app", blob), "x");
    await writeFile(path.join(dir, "valheim", "mine.png"), "mine");
    await deleteModuleDataOf(userData, "official", "tavora.notes", pictures);
    expect(await readdir(dir)).toEqual(["valheim"]);
    expect(await readdir(path.join(dir, "valheim"))).toEqual(["mine.png"]);
  });

  it("moves local data to the signed owner at the next start, keeping a workspace the signed module already has", async () => {
    const userData = await tempDir();
    await seed(userData, "local", "wellbrained.tracker", "poe2", "local poe2");
    await seed(userData, "local", "wellbrained.tracker", "satisfactory", "local satisfactory");
    await seed(userData, KEY, "wellbrained.tracker", "satisfactory", "signed satisfactory");
    // The settings shared by every workspace (storage.app) move like a workspace's.
    for (const [folder, body] of [["_app", "local app"], ["not a game", "stays"]] as const) {
      await mkdir(path.join(userData, "module-data", "local", "wellbrained.tracker", folder), { recursive: true });
      await writeFile(path.join(userData, "module-data", "local", "wellbrained.tracker", folder, "storage.json"), body);
    }
    await queueLocalDataMove(userData, "wellbrained.tracker", KEY);
    await expect(queueLocalDataMove(userData, "wellbrained.tracker", "local")).rejects.toThrow();
    await migrateModuleData(userData);

    const read = (owner: string, game: string) => readFile(path.join(userData, "module-data", owner, "wellbrained.tracker", game, "storage.json"), "utf8");
    expect(await read(KEY, "poe2")).toBe("local poe2");
    expect(await read(KEY, "satisfactory")).toBe("signed satisfactory");
    expect(await read("local", "satisfactory")).toBe("local satisfactory");
    expect(await read(KEY, "_app")).toBe("local app");
    expect(await read("local", "not a game")).toBe("stays");
    expect((await readdir(path.join(userData, "Partitions"))).sort()).toEqual([
      `module%3A${KEY}%3Awellbrained.tracker@poe2`,
      `module%3A${KEY}%3Awellbrained.tracker@satisfactory`,
      "module%3Alocal%3Awellbrained.tracker@satisfactory",
    ]);
    // Done once: the queue is empty afterwards.
    expect(await readdir(userData)).not.toContain("module-data-pending.json");
  });
  it("treats a module's files (pictures) like its other data", async () => {
    const userData = await tempDir();
    const blob = (...parts: string[]) => path.join(userData, "module-blobs", ...parts);
    // Named as the host names stored files (blobs.ts).
    const a = "a".repeat(32) + ".png";
    const b = "b".repeat(32) + ".png";
    // Saved before modules had owners.
    await mkdir(blob("tavora.notes", "poe2"), { recursive: true });
    await writeFile(blob("tavora.notes", "poe2", a), "official");
    await mkdir(blob("wellbrained.tracker", "poe2"), { recursive: true });
    await writeFile(blob("wellbrained.tracker", "poe2", b), "local");
    await migrateModuleData(userData);
    expect(await readFile(blob("official", "tavora.notes", "poe2", a), "utf8")).toBe("official");
    expect(await readFile(blob("local", "wellbrained.tracker", "poe2", b), "utf8")).toBe("local");

    // A module with only files left is listed, and its files move with Move.
    expect((await listModuleData(userData)).map((found) => `${found.owner}/${found.moduleId}`).sort()).toEqual(["local/wellbrained.tracker", "official/tavora.notes"]);
    await queueLocalDataMove(userData, "wellbrained.tracker", KEY);
    await migrateModuleData(userData);
    expect(await readFile(blob(KEY, "wellbrained.tracker", "poe2", b), "utf8")).toBe("local");
    expect(await readdir(blob("local"))).toEqual([]);

    // Delete removes them.
    await deleteModuleDataOf(userData, KEY, "wellbrained.tracker");
    expect(await readdir(blob(KEY))).toEqual([]);
  });
});
