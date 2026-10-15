import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deleteModuleData, orphanedPartitions } from "./gamedata";
import { IconError, imageType, importIcon, MAX_ICON_BYTES } from "./icons";
import { initialBounds } from "./window-state";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "tavora-files-"));
}

describe("deleteModuleData", () => {
  it("deletes one game's data for every module and keeps other games", async () => {
    const userData = await tempDir();
    for (const module of ["local.a", "local.b"]) {
      for (const game of ["poe2", "satisfactory"]) {
        await mkdir(path.join(userData, "module-data", module, game), { recursive: true });
        await writeFile(path.join(userData, "module-data", module, game, "storage.json"), "{}");
      }
    }
    await deleteModuleData(userData, "poe2");
    for (const module of ["local.a", "local.b"]) {
      expect(await readdir(path.join(userData, "module-data", module))).toEqual(["satisfactory"]);
    }
  });

  it("does nothing without module data and refuses unsafe ids", async () => {
    const userData = await tempDir();
    await expect(deleteModuleData(userData, "poe2")).resolves.toBeUndefined();
    await expect(deleteModuleData(userData, "../x")).rejects.toThrow();
  });
});

describe("orphanedPartitions", () => {
  it("finds module and Browser partitions of games that are gone", async () => {
    const userData = await tempDir();
    // Windows forbids colons in directory names; Electron escapes them there.
    const rawPartition = process.platform === "win32" ? [] : ["module:local.example.b@gone-game"];
    const names = [
      "module%3Alocal.example.a%40poe2",
      "module%3alocal.example.a%40gone-game",
      ...rawPartition,
      "browser%40poe2",
      "browser%40gone-game",
      // The Browser's sign-ins shared by every game belong to no game and stay.
      "browser",
      "something-else",
    ];
    for (const name of names) await mkdir(path.join(userData, "Partitions", name), { recursive: true });
    const found = await orphanedPartitions(userData, new Set(["poe2"]));
    expect(found.map((dir) => path.basename(dir)).sort()).toEqual([
      "browser%40gone-game",
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
