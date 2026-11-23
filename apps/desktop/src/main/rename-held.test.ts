import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameHeld } from "./rename-held";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-rename-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renameHeld", () => {
  it("renames, and says so", async () => {
    await writeFile(path.join(dir, "a"), "new");
    expect(await renameHeld(path.join(dir, "a"), path.join(dir, "b"))).toBe(true);
    expect(await readFile(path.join(dir, "b"), "utf8")).toBe("new");
  });

  it("makes no try once the rename is no longer wanted", async () => {
    await writeFile(path.join(dir, "a"), "new");
    await writeFile(path.join(dir, "b"), "newer");
    expect(await renameHeld(path.join(dir, "a"), path.join(dir, "b"), undefined, () => false)).toBe(false);
    expect((await readdir(dir)).sort()).toEqual(["a", "b"]);
    expect(await readFile(path.join(dir, "b"), "utf8")).toBe("newer");
  });
});
