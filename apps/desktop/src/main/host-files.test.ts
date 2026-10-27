import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deleteModuleData, deleteModuleDataOf, listModuleData, migrateModuleData, modulePartition, orphanedPartitions, queueLocalDataMove } from "./module-data";
import { IconError, imageType, importIcon, MAX_ICON_BYTES } from "./icons";
import { initialBounds } from "./window-state";

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
    // Saved before modules had owners.
    await mkdir(blob("tavora.notes", "poe2"), { recursive: true });
    await writeFile(blob("tavora.notes", "poe2", "a.png"), "official");
    await mkdir(blob("wellbrained.tracker", "poe2"), { recursive: true });
    await writeFile(blob("wellbrained.tracker", "poe2", "b.png"), "local");
    await migrateModuleData(userData);
    expect(await readFile(blob("official", "tavora.notes", "poe2", "a.png"), "utf8")).toBe("official");
    expect(await readFile(blob("local", "wellbrained.tracker", "poe2", "b.png"), "utf8")).toBe("local");

    // A module with only files left is listed, and its files move with Move.
    expect((await listModuleData(userData)).map((found) => `${found.owner}/${found.moduleId}`).sort()).toEqual(["local/wellbrained.tracker", "official/tavora.notes"]);
    await queueLocalDataMove(userData, "wellbrained.tracker", KEY);
    await migrateModuleData(userData);
    expect(await readFile(blob(KEY, "wellbrained.tracker", "poe2", "b.png"), "utf8")).toBe("local");
    expect(await readdir(blob("local"))).toEqual([]);

    // Delete removes them.
    await deleteModuleDataOf(userData, KEY, "wellbrained.tracker");
    expect(await readdir(blob(KEY))).toEqual([]);
  });
});
