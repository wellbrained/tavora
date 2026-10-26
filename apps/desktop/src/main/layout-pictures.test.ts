import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LayoutPictures, MAX_PICTURE_BYTES, MAX_PICTURE_WIDTH, captureSize, isPng, pictureName, sourceForHandle } from "./layout-pictures";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-layout-pictures-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("pretend this is the rest of a picture")]);

describe("pictureName", () => {
  it("is one safe file name per game, whatever the game's id looks like", () => {
    expect(pictureName("poe2")).toMatch(/^[0-9a-f]{24}\.png$/);
    expect(pictureName("poe2")).toBe(pictureName("poe2"));
    expect(pictureName("poe2")).not.toBe(pictureName("elden"));
    expect(pictureName("../../etc/passwd")).toMatch(/^[0-9a-f]{24}\.png$/);
    expect(pictureName("$all")).toMatch(/^[0-9a-f]{24}\.png$/);
  });
});

describe("isPng", () => {
  it("knows a PNG by its first bytes", () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(Buffer.from("GIF89a....."))).toBe(false);
    expect(isPng(Buffer.alloc(0))).toBe(false);
    expect(isPng(PNG.subarray(0, 8))).toBe(false);
  });
});

describe("LayoutPictures", () => {
  it("keeps one picture per game, with an address that changes when the picture does", async () => {
    const pictures = new LayoutPictures(path.join(dir, "overlay-pictures"));
    expect(await pictures.address("poe2")).toBeNull();
    expect(await pictures.has("poe2")).toBe(false);
    expect(await pictures.save("poe2", PNG)).toBe("saved");
    const first = await pictures.address("poe2");
    expect(first).toMatch(new RegExp(`^overlay-pictures/${pictureName("poe2")}\\?v=\\d+$`));
    expect(await pictures.read("poe2")).toEqual(PNG);
    expect(await pictures.address("elden")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await pictures.save("poe2", Buffer.concat([PNG, Buffer.from("more")]))).toBe("saved");
    expect(await pictures.address("poe2")).not.toBe(first);
    expect((await readdir(path.join(dir, "overlay-pictures"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses what is not a PNG and what is too big, and keeps the old picture then", async () => {
    const pictures = new LayoutPictures(dir);
    await pictures.save("poe2", PNG);
    expect(await pictures.save("poe2", Buffer.from("not a picture at all"))).toBe("not-a-picture");
    expect(await pictures.save("poe2", Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES)]))).toBe("too-big");
    expect(await pictures.read("poe2")).toEqual(PNG);
  });

  it("removes a picture, and says whether there was one", async () => {
    const pictures = new LayoutPictures(dir);
    await pictures.save("poe2", PNG);
    expect(await pictures.remove("poe2")).toBe(true);
    expect(await pictures.remove("poe2")).toBe(false);
    expect(await pictures.has("poe2")).toBe(false);
    await expect(readFile(pictures.file("poe2"))).rejects.toThrow();
  });

  it("keeps a game id that looks like a path inside its folder", async () => {
    const pictures = new LayoutPictures(path.join(dir, "inside"));
    await pictures.save("../../outside", PNG);
    expect(path.dirname(pictures.file("../../outside"))).toBe(path.join(dir, "inside"));
    expect(await readdir(path.join(dir, "inside"))).toHaveLength(1);
  });
});

describe("sourceForHandle", () => {
  const sources = [
    { id: "screen:0:0", name: "Entire screen" },
    { id: "window:131416:0", name: "Elden Ring" },
    { id: "window:99:0", name: "Elden Ring" },
    { id: "window:1314160:0", name: "Other" },
  ];

  it("finds the window the handle names, never one by its title", () => {
    expect(sourceForHandle(sources, "131416")).toBe(sources[1]);
    expect(sourceForHandle(sources, "99")).toBe(sources[2]);
    // 13141 is the start of two handles, not a handle of its own.
    expect(sourceForHandle(sources, "13141")).toBeUndefined();
    expect(sourceForHandle(sources, "7")).toBeUndefined();
  });

  it("refuses a handle that isn't a number", () => {
    expect(sourceForHandle(sources, "Elden Ring")).toBeUndefined();
    expect(sourceForHandle(sources, "")).toBeUndefined();
    expect(sourceForHandle(sources, "1:0:window")).toBeUndefined();
  });
});

describe("captureSize", () => {
  it("asks for the window's pixels, no wider than a 4K picture", () => {
    expect(captureSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(captureSize(5120, 1440)).toEqual({ width: MAX_PICTURE_WIDTH, height: 1080 });
    expect(captureSize(0, 0)).toEqual({ width: 1920, height: 1080 });
    expect(captureSize(Number.NaN, 100)).toEqual({ width: 1920, height: 1080 });
  });
});
