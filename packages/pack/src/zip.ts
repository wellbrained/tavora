// A small zip writer and a strict zip reader for module packages. The reader
// is the installer's first line (the threat model, "Rules for a future zip
// installer"): it refuses links, unsafe names, encryption and zip64, and caps
// sizes and compression before anything is unpacked.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipLimits {
  maxArchiveBytes: number;
  maxUnpackedBytes: number;
  maxFiles: number;
  maxRatio: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  /** The zip file itself. */
  maxArchiveBytes: 50 * 1024 * 1024,
  /** All files unpacked together. */
  maxUnpackedBytes: 200 * 1024 * 1024,
  maxFiles: 2_000,
  /** Unpacked size over packed size, checked once a package unpacks to more than 1 MiB. */
  maxRatio: 100,
};

export class ZipError extends Error {}

export interface ZipFile {
  /** Path inside the package, with "/" between folders. */
  name: string;
  data: Buffer;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;
// 1980-01-01 00:00, so the same files always give the same zip.
const DOS_DATE = (1 << 5) | 1;

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * A path a package may contain: relative, "/" only, no "." or ".." parts, no
 * drive letters or other colons, no control characters, and no part Windows
 * cannot create (reserved device names, a trailing dot or space).
 */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 256) return false;
  if (name.startsWith("/") || name.includes("\\") || name.includes(":") || /[\u0000-\u001f\u007f<>"|?*]/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !RESERVED.test(part) && !/[. ]$/.test(part));
}

export function writeZip(files: readonly ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!isSafeEntryName(file.name)) throw new ZipError(`unsafe file name: ${file.name}`);
    const name = Buffer.from(file.name, "utf8");
    const packed = deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4); // made by: MS-DOS, so no Unix modes are claimed
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Reads every file of a package zip into memory, or throws a ZipError saying
 * why the zip is refused. Folder entries are skipped; anything that is not a
 * plain file is refused.
 */
export function readZip(zip: Buffer, limits: Readonly<ZipLimits> = ZIP_LIMITS): ZipFile[] {
  if (zip.length > limits.maxArchiveBytes) throw new ZipError("the zip is too big");
  const endAt = findEnd(zip);
  const count = zip.readUInt16LE(endAt + 10);
  const size = zip.readUInt32LE(endAt + 12);
  const start = zip.readUInt32LE(endAt + 16);
  if (zip.readUInt16LE(endAt + 4) !== 0 || zip.readUInt16LE(endAt + 6) !== 0 || zip.readUInt16LE(endAt + 8) !== count) {
    throw new ZipError("split zips are not supported");
  }
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new ZipError("zip64 is not supported");
  if (start + size > endAt) throw new ZipError("the zip is damaged");
  if (count > limits.maxFiles) throw new ZipError("the zip has too many files");

  const files: ZipFile[] = [];
  const seen = new Set<string>();
  let unpacked = 0;
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > endAt || zip.readUInt32LE(at) !== CENTRAL) throw new ZipError("the zip is damaged");
    const madeBy = zip.readUInt16LE(at + 4) >> 8;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packedSize = zip.readUInt32LE(at + 20);
    const plainSize = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const external = zip.readUInt32LE(at + 38);
    const localAt = zip.readUInt32LE(at + 42);
    const raw = zip.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (at > endAt) throw new ZipError("the zip is damaged");

    const name = new TextDecoder("utf-8", { fatal: false }).decode(raw);
    if (flags & 0x0001) throw new ZipError("encrypted zips are not supported");
    // Unix zips keep the file type in the top bits: only plain files (and folders) are allowed.
    const type = madeBy === 3 ? (external >>> 16) & 0o170000 : 0;
    const isFolder = name.endsWith("/");
    if (type !== 0 && type !== (isFolder ? 0o040000 : 0o100000)) throw new ZipError(`${name} is a link or special file`);
    if (isFolder) {
      if (!isSafeEntryName(name.slice(0, -1))) throw new ZipError(`unsafe path: ${name}`);
      continue;
    }
    if (!isSafeEntryName(name)) throw new ZipError(`unsafe path: ${name}`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new ZipError(`${name} is in the zip twice`);
    seen.add(folded);
    if (method !== 0 && method !== 8) throw new ZipError(`${name} uses a compression zips for Tavora do not support`);
    if (packedSize === 0xffffffff || plainSize === 0xffffffff) throw new ZipError("zip64 is not supported");
    unpacked += plainSize;
    if (unpacked > limits.maxUnpackedBytes) throw new ZipError("the module is too big unpacked");

    if (localAt + 30 > start || zip.readUInt32LE(localAt) !== LOCAL) throw new ZipError("the zip is damaged");
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    if (!zip.subarray(localAt + 30, localAt + 30 + zip.readUInt16LE(localAt + 26)).equals(raw)) throw new ZipError("the zip is damaged");
    if (dataAt + packedSize > start) throw new ZipError("the zip is damaged");
    const packed = zip.subarray(dataAt, dataAt + packedSize);
    let data: Buffer;
    if (method === 0) {
      if (packedSize !== plainSize) throw new ZipError("the zip is damaged");
      data = Buffer.from(packed);
    } else {
      try {
        data = inflateRawSync(packed, { maxOutputLength: Math.max(plainSize, 1) });
      } catch {
        throw new ZipError(`${name} cannot be unpacked`);
      }
    }
    if (data.length !== plainSize || crc32(data) !== crc) throw new ZipError(`${name} is damaged`);
    files.push({ name, data });
  }
  if (unpacked > 1024 * 1024 && unpacked > zip.length * limits.maxRatio) throw new ZipError("the zip unpacks to far more than its size");
  return files;
}

function findEnd(zip: Buffer): number {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === END && at + 22 + zip.readUInt16LE(at + 20) === zip.length) return at;
  }
  throw new ZipError("this is not a zip file");
}
