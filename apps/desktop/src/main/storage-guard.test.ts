import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { folderUsage, overStorageLimit } from "./storage-guard";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), "tavora-guard-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("folderUsage", () => {
  it("adds up files in nested folders", async () => {
    await mkdir(path.join(dir, "a", "b"), { recursive: true });
    await writeFile(path.join(dir, "one"), Buffer.alloc(100));
    await writeFile(path.join(dir, "a", "two"), Buffer.alloc(250));
    await writeFile(path.join(dir, "a", "b", "three"), Buffer.alloc(50));
    expect(await folderUsage(dir)).toEqual({ bytes: 400, files: 3, truncated: false });
  });

  it("treats a missing folder as empty", async () => {
    expect(await folderUsage(path.join(dir, "nope"))).toEqual({ bytes: 0, files: 0, truncated: false });
  });

  it("stops at the file limit and says so", async () => {
    for (let n = 0; n < 12; n++) await writeFile(path.join(dir, `f${n}`), "x");
    const usage = await folderUsage(dir, 5);
    expect(usage.truncated).toBe(true);
    expect(usage.files).toBe(5);
  });

  it("does not follow links out of the folder", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "tavora-outside-"));
    try {
      await writeFile(path.join(outside, "big"), Buffer.alloc(10_000));
      await symlink(outside, path.join(dir, "link"), "junction");
      expect((await folderUsage(dir)).bytes).toBe(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("overStorageLimit", () => {
  it("is false at the limit and true above it or with too many files", async () => {
    await writeFile(path.join(dir, "data"), Buffer.alloc(1000));
    expect(await overStorageLimit(dir, 1000)).toBe(false);
    expect(await overStorageLimit(dir, 999)).toBe(true);
  });
});
