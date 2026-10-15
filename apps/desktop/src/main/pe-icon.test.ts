import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { icoFramesAgree, readIcoFromFile, readIcoFromPe, type ReadAt } from "./pe-icon";
import { isIco, MAX_STEAM_ICON_BYTES } from "./steam-icons";

const RSRC_RVA = 0x3000;
const RSRC_RAW = 0x400;

interface Frame {
  /** Width and height in pixels; 256 is stored as 0, as in real files. */
  size: number;
  bytes: Uint8Array;
}

/** A frame filled with a recognisable pattern. */
const frame = (size: number, length: number, seed: number): Frame => ({
  size,
  bytes: Uint8Array.from({ length }, (_, i) => (i * 7 + seed) % 256),
});

/** One RT_GROUP_ICON: its frames refer to RT_ICON resources by id. */
interface Group {
  id: number;
  frames: Array<{ iconId: number; size: number; length: number; bits?: number }>;
}

/** The group directory bytes (GRPICONDIR) for a group. */
function groupBytes(group: Group): Uint8Array {
  const bytes = new Uint8Array(6 + group.frames.length * 14);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, group.frames.length, true);
  group.frames.forEach((f, i) => {
    const at = 6 + i * 14;
    bytes[at] = f.size >= 256 ? 0 : f.size;
    bytes[at + 1] = f.size >= 256 ? 0 : f.size;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, f.bits ?? 32, true);
    view.setUint32(at + 8, f.length, true);
    view.setUint16(at + 12, f.iconId, true);
  });
  return bytes;
}

/** A 64-bit Windows program that holds only a resource section: icons by id, and groups. */
function buildPe(icons: Record<number, Frame>, groups: Group[]): Uint8Array {
  const resources: Array<{ type: number; id: number; data: Uint8Array }> = [
    ...Object.entries(icons).map(([id, f]) => ({ type: 3, id: Number(id), data: f.bytes })),
    ...groups.map((g) => ({ type: 14, id: g.id, data: groupBytes(g) })),
  ];
  const types = [3, 14].filter((type) => resources.some((r) => r.type === type));
  const byType = (type: number) => resources.filter((r) => r.type === type).sort((a, b) => a.id - b.id);

  // Layout: root, one directory per type, then per resource a language directory and a data entry, then the data.
  let cursor = 16 + types.length * 8;
  const typeDirAt = new Map<number, number>();
  for (const type of types) {
    typeDirAt.set(type, cursor);
    cursor += 16 + byType(type).length * 8;
  }
  const langAt = new Map<(typeof resources)[number], number>();
  const entryAt = new Map<(typeof resources)[number], number>();
  const dataAt = new Map<(typeof resources)[number], number>();
  for (const type of types) {
    for (const r of byType(type)) {
      langAt.set(r, cursor);
      entryAt.set(r, cursor + 24);
      cursor += 24 + 16;
    }
  }
  for (const type of types) {
    for (const r of byType(type)) {
      dataAt.set(r, cursor);
      cursor += Math.ceil(r.data.byteLength / 4) * 4;
    }
  }
  const rsrc = new Uint8Array(cursor);
  const rv = new DataView(rsrc.buffer);
  const directory = (at: number, entries: Array<[number, number, boolean]>) => {
    rv.setUint16(at + 14, entries.length, true);
    entries.forEach(([id, target, isDir], i) => {
      rv.setUint32(at + 16 + i * 8, id, true);
      rv.setUint32(at + 16 + i * 8 + 4, (target | (isDir ? 0x80000000 : 0)) >>> 0, true);
    });
  };
  directory(0, types.map((type) => [type, typeDirAt.get(type)!, true]));
  for (const type of types) {
    directory(typeDirAt.get(type)!, byType(type).map((r) => [r.id, langAt.get(r)!, true]));
    for (const r of byType(type)) {
      directory(langAt.get(r)!, [[0x409, entryAt.get(r)!, false]]);
      rv.setUint32(entryAt.get(r)!, RSRC_RVA + dataAt.get(r)!, true);
      rv.setUint32(entryAt.get(r)! + 4, r.data.byteLength, true);
      rsrc.set(r.data, dataAt.get(r)!);
    }
  }

  const file = new Uint8Array(RSRC_RAW + rsrc.byteLength);
  const v = new DataView(file.buffer);
  file[0] = 0x4d;
  file[1] = 0x5a;
  v.setUint32(0x3c, 0x80, true);
  v.setUint32(0x80, 0x00004550, true);
  v.setUint16(0x80 + 4, 0x8664, true);
  v.setUint16(0x80 + 6, 1, true);
  v.setUint16(0x80 + 20, 240, true);
  v.setUint16(0x80 + 24, 0x20b, true);
  v.setUint32(0x80 + 24 + 112 + 16, RSRC_RVA, true);
  v.setUint32(0x80 + 24 + 112 + 20, rsrc.byteLength, true);
  const section = 0x80 + 24 + 240;
  file.set(new TextEncoder().encode(".rsrc"), section);
  v.setUint32(section + 8, rsrc.byteLength, true);
  v.setUint32(section + 12, RSRC_RVA, true);
  v.setUint32(section + 16, rsrc.byteLength, true);
  v.setUint32(section + 20, RSRC_RAW, true);
  file.set(rsrc, RSRC_RAW);
  return file;
}

const readerOf =
  (file: Uint8Array): ReadAt =>
  async (offset, length) =>
    file.slice(Math.max(0, offset), Math.max(0, Math.min(file.byteLength, offset + length)));

/** The frames of an ICO as [pixel size, bytes]. */
function framesOf(ico: Uint8Array): Array<[number, Uint8Array]> {
  const v = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  return Array.from({ length: v.getUint16(4, true) }, (_, i) => {
    const at = 6 + i * 16;
    const size = v.getUint32(at + 8, true);
    const offset = v.getUint32(at + 12, true);
    return [ico[at] || 256, ico.slice(offset, offset + size)];
  });
}

describe("readIcoFromPe", () => {
  const small = frame(16, 300, 1);
  const big = frame(256, 900, 2);
  const mid = frame(48, 500, 3);
  const icons = { 1: small, 2: big, 3: mid, 4: frame(32, 200, 4) };
  const first: Group = {
    id: 1,
    frames: [
      { iconId: 1, size: 16, length: 300 },
      { iconId: 2, size: 256, length: 900 },
      { iconId: 3, size: 48, length: 500 },
    ],
  };
  const second: Group = { id: 7, frames: [{ iconId: 4, size: 32, length: 200 }] };

  it("builds a ready .ico from the first group, biggest frame first and every frame unchanged", async () => {
    const ico = await readIcoFromPe(readerOf(buildPe(icons, [first, second])));
    expect(ico).not.toBeNull();
    expect(isIco(ico!)).toBe(true);
    expect(framesOf(ico!)).toEqual([
      [256, big.bytes],
      [48, mid.bytes],
      [16, small.bytes],
    ]);
  });

  it("gives a PNG frame the size its picture has, and leaves out a picture over 256 px", async () => {
    /** A PNG header and filler: the signature, IHDR and a picture of the given size. */
    const png = (side: number, length: number): Frame => {
      const bytes = new Uint8Array(length);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(bytes.buffer).setUint32(16, side);
      new DataView(bytes.buffer).setUint32(20, side);
      return { size: 256, bytes };
    };
    // The group calls all three 256 px, as a real program does; one picture is 512 px and one is 128 px.
    const group: Group = {
      id: 1,
      frames: [
        { iconId: 1, size: 256, length: 100 },
        { iconId: 2, size: 256, length: 90 },
        { iconId: 3, size: 256, length: 80 },
      ],
    };
    const ico = await readIcoFromPe(readerOf(buildPe({ 1: png(256, 100), 2: png(512, 90), 3: png(128, 80) }, [group])));
    expect(framesOf(ico!).map(([size]) => size)).toEqual([256, 128]);
  });

  it("keeps only the deepest colour copy of a size", async () => {
    const group: Group = {
      id: 1,
      frames: [
        { iconId: 1, size: 48, length: 100, bits: 4 },
        { iconId: 2, size: 48, length: 200, bits: 32 },
        { iconId: 3, size: 16, length: 50, bits: 8 },
      ],
    };
    const deep = frame(48, 200, 5);
    const ico = await readIcoFromPe(readerOf(buildPe({ 1: frame(48, 100, 4), 2: deep, 3: frame(16, 50, 6) }, [group])));
    expect(framesOf(ico!).map(([size, bytes]) => [size, bytes.byteLength])).toEqual([
      [48, 200],
      [16, 50],
    ]);
  });

  it("picks a group by its place, or by its number when the index is negative", async () => {
    const pe = readerOf(buildPe(icons, [first, second]));
    expect(framesOf((await readIcoFromPe(pe, 1))!)).toEqual([[32, icons[4].bytes]]);
    expect(framesOf((await readIcoFromPe(pe, -7))!)).toEqual([[32, icons[4].bytes]]);
    expect(await readIcoFromPe(pe, 2)).toBeNull();
    expect(await readIcoFromPe(pe, -99)).toBeNull();
  });

  it("skips a frame that is missing and gives null when none is left", async () => {
    const partly: Group = { id: 1, frames: [{ iconId: 9, size: 64, length: 10 }, { iconId: 1, size: 16, length: 300 }] };
    expect(framesOf((await readIcoFromPe(readerOf(buildPe(icons, [partly]))))!)).toEqual([[16, small.bytes]]);
    const none: Group = { id: 1, frames: [{ iconId: 9, size: 64, length: 10 }] };
    expect(await readIcoFromPe(readerOf(buildPe(icons, [none])))).toBeNull();
  });

  it("drops the biggest frames when the file would be too large", async () => {
    const huge = { 1: frame(256, 400_000, 1), 2: frame(128, 400_000, 2), 3: frame(64, 400_000, 3) };
    const group: Group = { id: 1, frames: [1, 2, 3].map((n) => ({ iconId: n, size: [256, 128, 64][n - 1]!, length: 400_000 })) };
    const ico = (await readIcoFromPe(readerOf(buildPe(huge, [group]))))!;
    expect(ico.byteLength).toBeLessThanOrEqual(MAX_STEAM_ICON_BYTES);
    expect(framesOf(ico).map(([size]) => size)).toEqual([128, 64]);
  });

  it("ignores a frame bigger than half a megabyte", async () => {
    const group: Group = { id: 1, frames: [{ iconId: 1, size: 256, length: 600_000 }, { iconId: 2, size: 16, length: 300 }] };
    const ico = await readIcoFromPe(readerOf(buildPe({ 1: frame(256, 600_000, 1), 2: small }, [group])));
    expect(framesOf(ico!).map(([size]) => size)).toEqual([16]);
  });

  it("gives null for anything that is not a program with icons, and never throws", async () => {
    const pe = buildPe(icons, [first]);
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array(5000),
      new TextEncoder().encode("MZ".repeat(3000)),
      pe.slice(0, 0x100),
      pe.slice(0, RSRC_RAW + 40),
      buildPe({}, []),
    ];
    for (const bytes of cases) expect(await readIcoFromPe(readerOf(bytes))).toBeNull();

    const wrongMagic = pe.slice();
    new DataView(wrongMagic.buffer).setUint16(0x80 + 24, 0x1234, true);
    expect(await readIcoFromPe(readerOf(wrongMagic))).toBeNull();
    const noSections = pe.slice();
    new DataView(noSections.buffer).setUint16(0x80 + 6, 0, true);
    expect(await readIcoFromPe(readerOf(noSections))).toBeNull();
    const farAway = pe.slice();
    new DataView(farAway.buffer).setUint32(0x80 + 24 + 112 + 16, 0x7000_0000, true);
    expect(await readIcoFromPe(readerOf(farAway))).toBeNull();
    const failing: ReadAt = async () => {
      throw new Error("disk gone");
    };
    expect(await readIcoFromPe(failing)).toBeNull();
  });
});

describe("readIcoFromFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tavora-pe-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a program from disk", async () => {
    const big = frame(256, 900, 2);
    await writeFile(path.join(dir, "game.exe"), buildPe({ 1: big }, [{ id: 1, frames: [{ iconId: 1, size: 256, length: 900 }] }]));
    expect(framesOf((await readIcoFromFile(path.join(dir, "game.exe")))!)).toEqual([[256, big.bytes]]);
  });

  it("gives null for a missing file, a folder and a file that is not a program", async () => {
    expect(await readIcoFromFile(path.join(dir, "nothing.exe"))).toBeNull();
    expect(await readIcoFromFile(dir)).toBeNull();
    await writeFile(path.join(dir, "notes.exe"), "just text");
    expect(await readIcoFromFile(path.join(dir, "notes.exe"))).toBeNull();
  });
});

describe("icoFramesAgree", () => {
  /** An .ico with one PNG frame whose entry says `entrySize` px and whose picture is `pictureSize` px. */
  const ico = (entrySize: number, pictureSize: number): Uint8Array => {
    const bytes = new Uint8Array(6 + 16 + 30);
    const v = new DataView(bytes.buffer);
    v.setUint16(2, 1, true);
    v.setUint16(4, 1, true);
    bytes[6] = entrySize === 256 ? 0 : entrySize;
    bytes[7] = entrySize === 256 ? 0 : entrySize;
    v.setUint32(6 + 8, 30, true);
    v.setUint32(6 + 12, 22, true);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 22);
    v.setUint32(22 + 16, pictureSize);
    v.setUint32(22 + 20, pictureSize);
    return bytes;
  };

  it("is true when each PNG frame is the size its entry says, and false when one is not", () => {
    expect(icoFramesAgree(ico(256, 256))).toBe(true);
    expect(icoFramesAgree(ico(48, 48))).toBe(true);
    expect(icoFramesAgree(ico(256, 512))).toBe(false);
    expect(icoFramesAgree(new Uint8Array(3))).toBe(false);
  });
});
