import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToneReader, iconVersion } from "./icon-tone";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-tone-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A 32 x 32 bitmap of one colour (blue, green, red, alpha). */
const solid = (alpha: number) => Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? alpha : 120));

describe("createToneReader", () => {
  it("reads a file once per version, and again when the file changes", async () => {
    await writeFile(path.join(dir, "a.ico"), "x");
    let reads = 0;
    const read = createToneReader(dir, () => (reads += 1, solid(255)));
    expect(read("a.ico")).toBe("opaque");
    expect(read("a.ico")).toBe("opaque");
    expect(reads).toBe(1);
    await utimes(path.join(dir, "a.ico"), new Date(2030, 0, 1), new Date(2030, 0, 1));
    expect(read("a.ico")).toBe("opaque");
    expect(reads).toBe(2);
  });

  it("gives the plain dark backdrop for a missing file or a picture that cannot be read", async () => {
    await writeFile(path.join(dir, "broken.ico"), "x");
    const read = createToneReader(dir, () => null);
    expect(read("missing.ico")).toBe("onDark");
    expect(read("broken.ico")).toBe("onDark");
    expect(createToneReader(dir, () => { throw new Error("no"); })("broken.ico")).toBe("onDark");
  });
});

describe("iconVersion", () => {
  it("changes with the file and is 0 for a missing one", async () => {
    await writeFile(path.join(dir, "a.ico"), "x");
    const before = iconVersion(dir, "a.ico");
    await utimes(path.join(dir, "a.ico"), new Date(2031, 0, 1), new Date(2031, 0, 1));
    expect(iconVersion(dir, "a.ico")).not.toBe(before);
    expect(iconVersion(dir, "missing.ico")).toBe("0");
  });
});
