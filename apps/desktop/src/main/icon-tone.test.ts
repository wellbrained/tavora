import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToneReader, ICON_VERSION_MS, iconVersion, iconVersions } from "./icon-tone";

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

  it("goes by a version it is given, without asking the disk", async () => {
    await writeFile(path.join(dir, "a.ico"), "x");
    let reads = 0;
    const read = createToneReader(dir, () => (reads += 1, solid(255)));
    expect(read("a.ico", "5")).toBe("opaque");
    await rm(path.join(dir, "a.ico"));
    expect(read("a.ico", "5")).toBe("opaque");
    expect(reads).toBe(1);
    expect(read("a.ico", "0")).toBe("onDark");
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

describe("iconVersions", () => {
  const later = new Date(2031, 0, 1);

  it("asks the disk at most once per file in a while", async () => {
    await writeFile(path.join(dir, "a.ico"), "x");
    let now = 1000;
    const versions = iconVersions(dir, () => now);
    const first = versions.of("a.ico");
    await utimes(path.join(dir, "a.ico"), later, later);
    now += ICON_VERSION_MS - 1;
    expect(versions.of("a.ico")).toBe(first);
    now += 1;
    expect(versions.of("a.ico")).not.toBe(first);
  });

  it("sees a file written just now once it is told to forget", async () => {
    await writeFile(path.join(dir, "a.ico"), "x");
    const versions = iconVersions(dir, () => 1000);
    const first = versions.of("a.ico");
    await utimes(path.join(dir, "a.ico"), later, later);
    versions.forget();
    expect(versions.of("a.ico")).not.toBe(first);
  });
});
