import { open } from "node:fs/promises";
import { MAX_STEAM_ICON_BYTES } from "./steam-icons";

/**
 * Reads the icon of a Windows program out of its own resources and returns it
 * as a ready `.ico` file, with every size the program carries (modern games
 * have a 256 px frame). Nothing is run or changed: the file is only read, a few
 * kilobytes at a time. Anything unexpected gives null, never an error.
 */

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const MAX_DIR_ENTRIES = 4096;
const MAX_FRAMES = 32;
const MAX_FRAME_BYTES = 512 * 1024;

/** Reads `length` bytes at `offset` of the program; shorter or empty at the end of the file. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

interface Section {
  rva: number;
  size: number;
  raw: number;
}

interface ResourceEntry {
  id: number | null;
  /** Offset inside the resource root, with the sub-directory flag removed. */
  offset: number;
  isDirectory: boolean;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export async function readIcoFromPe(readAt: ReadAt, index = 0): Promise<Uint8Array | null> {
  try {
    return await read(readAt, index);
  } catch {
    return null;
  }
}

async function read(readAt: ReadAt, index: number): Promise<Uint8Array | null> {
  const head = await readAt(0, 4096);
  if (head.byteLength < 0x40 || head[0] !== 0x4d || head[1] !== 0x5a) return null;
  const peOffset = view(head).getUint32(0x3c, true);
  const pe = peOffset <= 0x10000 ? await readAt(peOffset, 24 + 240 + 96 * 40) : head;
  if (pe.byteLength < 24 + 96) return null;
  const v = view(pe);
  if (v.getUint32(0, true) !== 0x00004550) return null;
  const sectionCount = v.getUint16(6, true);
  const optionalSize = v.getUint16(20, true);
  const optional = 24;
  const magic = v.getUint16(optional, true);
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
  if (directories < optional || sectionCount === 0 || sectionCount > 96 || directories + 24 > pe.byteLength) return null;
  const resourceRva = v.getUint32(directories + 16, true);
  const resourceSize = v.getUint32(directories + 20, true);
  if (resourceRva === 0 || resourceSize === 0) return null;

  const sections: Section[] = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const at = optional + optionalSize + i * 40;
    if (at + 40 > pe.byteLength) return null;
    sections.push({
      rva: v.getUint32(at + 12, true),
      size: Math.max(v.getUint32(at + 8, true), v.getUint32(at + 16, true)),
      raw: v.getUint32(at + 20, true),
    });
  }

  /** Bytes at a relative address in the loaded program. */
  const readRva = async (rva: number, length: number): Promise<Uint8Array> => {
    const section = sections.find((s) => rva >= s.rva && rva < s.rva + s.size);
    if (!section) throw new Error("outside the sections");
    const available = section.rva + section.size - rva;
    return readAt(section.raw + (rva - section.rva), Math.min(length, available));
  };

  const readDirectory = async (offset: number): Promise<ResourceEntry[]> => {
    if (offset < 0 || offset + 16 > resourceSize) throw new Error("bad directory");
    const header = await readRva(resourceRva + offset, 16);
    if (header.byteLength < 16) throw new Error("short directory");
    const count = view(header).getUint16(12, true) + view(header).getUint16(14, true);
    if (count > MAX_DIR_ENTRIES) throw new Error("too many entries");
    const table = await readRva(resourceRva + offset + 16, count * 8);
    if (table.byteLength < count * 8) throw new Error("short directory");
    const t = view(table);
    const entries: ResourceEntry[] = [];
    const named = view(header).getUint16(12, true);
    for (let i = 0; i < count; i += 1) {
      const name = t.getUint32(i * 8, true);
      const target = t.getUint32(i * 8 + 4, true);
      entries.push({
        // Entries with a text name come first; they have no number.
        id: i < named ? null : name,
        offset: target & 0x7fffffff,
        isDirectory: (target & 0x80000000) !== 0,
      });
    }
    return entries;
  };

  /** The bytes of a resource: walks type → name → language down to the data entry. */
  const readResource = async (entry: ResourceEntry): Promise<Uint8Array | null> => {
    let current = entry;
    for (let depth = 0; depth < 3 && current.isDirectory; depth += 1) {
      const next = (await readDirectory(current.offset))[0];
      if (!next) return null;
      current = next;
    }
    if (current.isDirectory || current.offset + 16 > resourceSize) return null;
    const data = await readRva(resourceRva + current.offset, 16);
    if (data.byteLength < 16) return null;
    const dataRva = view(data).getUint32(0, true);
    const size = view(data).getUint32(4, true);
    if (size === 0 || size > MAX_FRAME_BYTES) return null;
    const bytes = await readRva(dataRva, size);
    return bytes.byteLength === size ? bytes : null;
  };

  const types = await readDirectory(0);
  const groupType = types.find((e) => e.id === RT_GROUP_ICON && e.isDirectory);
  const iconType = types.find((e) => e.id === RT_ICON && e.isDirectory);
  if (!groupType || !iconType) return null;
  const groups = await readDirectory(groupType.offset);
  const frames = new Map((await readDirectory(iconType.offset)).filter((e) => e.id !== null).map((e) => [e.id!, e]));

  // A negative index names the group by its number, as the registry's `DisplayIcon` does.
  const group = index < 0 ? groups.find((e) => e.id === -index) : groups[index];
  if (!group) return null;
  const groupData = await readResource(group);
  if (!groupData || groupData.byteLength < 6) return null;
  const g = view(groupData);
  const count = g.getUint16(4, true);
  if (g.getUint16(2, true) !== 1 || count < 1 || count > MAX_FRAMES || 6 + count * 14 > groupData.byteLength) return null;

  interface Frame {
    entry: Uint8Array;
    bytes: Uint8Array;
    pixels: number;
  }
  const found: Frame[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 14;
    const frameEntry = frames.get(g.getUint16(at + 12, true));
    if (!frameEntry) continue;
    const bytes = await readResource(frameEntry);
    if (!bytes) continue;
    const width = groupData[at] || 256;
    const height = groupData[at + 1] || 256;
    found.push({ entry: groupData.slice(at, at + 12), bytes, pixels: width * height });
  }
  if (found.length === 0) return null;

  // Biggest frames go first, and the biggest are dropped if the file would be too large.
  found.sort((a, b) => b.pixels - a.pixels);
  let total = 6 + found.length * 16 + found.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  while (found.length > 1 && total > MAX_STEAM_ICON_BYTES) {
    const dropped = found.shift()!;
    total -= 16 + dropped.bytes.byteLength;
  }
  if (total > MAX_STEAM_ICON_BYTES) return null;

  const ico = new Uint8Array(total);
  const out = view(ico);
  out.setUint16(2, 1, true);
  out.setUint16(4, found.length, true);
  let offset = 6 + found.length * 16;
  found.forEach((frame, i) => {
    const at = 6 + i * 16;
    ico.set(frame.entry, at);
    out.setUint32(at + 8, frame.bytes.byteLength, true);
    out.setUint32(at + 12, offset, true);
    ico.set(frame.bytes, offset);
    offset += frame.bytes.byteLength;
  });
  return ico;
}

/** The icon of a program file on disk, or null. `index` is the number after the comma in a `DisplayIcon` value. */
export async function readIcoFromFile(file: string, index = 0): Promise<Uint8Array | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const readAt: ReadAt = async (offset, length) => {
      if (offset < 0 || offset >= size || length <= 0) return new Uint8Array(0);
      const buffer = new Uint8Array(Math.min(length, size - offset));
      const { bytesRead } = await handle!.read(buffer, 0, buffer.length, offset);
      return buffer.subarray(0, bytesRead);
    };
    return await readIcoFromPe(readAt, index);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
