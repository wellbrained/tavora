/**
 * Reads from Steam's own cache file, `appcache/appinfo.vdf`, what Steam keeps
 * about each app in `appinfo.common`: the hash of the game's client icon
 * (`clienticon`; the icon itself is `<hash>.ico`) and the kind of app (`type`:
 * a game, or software such as a tool or an application). This only
 * reads: nothing in the file is run, and a damaged or unexpected file is an
 * error, never a crash or an endless loop.
 *
 * Format (versions 39 to 41): a header, then one entry per app (id, size, a
 * fixed block, binary key-values), and from version 41 a table of key names at
 * the end that the key-values refer to by number.
 */

export class AppInfoError extends Error {}

const MAGIC_HIGH = 0x075644;
const MAX_STRING = 1 << 20;
const MAX_DEPTH = 16;
const MAX_TABLE_STRINGS = 1_000_000;

type Value = string | number | KeyValues;
interface KeyValues {
  [key: string]: Value;
}

class Reader {
  private view: DataView;
  private bytes: Uint8Array;
  pos: number;
  private limit: number;

  constructor(bytes: Uint8Array, pos: number, limit: number) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
    this.limit = Math.min(limit, bytes.byteLength);
  }

  private need(count: number): void {
    if (count < 0 || this.pos + count > this.limit) throw new AppInfoError("appinfo.vdf ends unexpectedly");
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return value;
  }

  skip(count: number): void {
    this.need(count);
    this.pos += count;
  }

  /** A zero-terminated UTF-8 string. */
  cstring(): string {
    const start = this.pos;
    while (this.pos < this.limit && this.bytes[this.pos] !== 0) {
      if (this.pos - start > MAX_STRING) throw new AppInfoError("appinfo.vdf has a string that is too long");
      this.pos += 1;
    }
    if (this.pos >= this.limit) throw new AppInfoError("appinfo.vdf ends unexpectedly");
    const text = new TextDecoder().decode(this.bytes.subarray(start, this.pos));
    this.pos += 1;
    return text;
  }

  /** A zero-terminated UTF-16 string, skipped. */
  skipWideString(): void {
    for (;;) {
      this.need(2);
      const unit = this.view.getUint16(this.pos, true);
      this.pos += 2;
      if (unit === 0) return;
    }
  }
}

function readStringTable(bytes: Uint8Array, offset: number): string[] {
  const reader = new Reader(bytes, offset, bytes.byteLength);
  const count = reader.u32();
  if (count > MAX_TABLE_STRINGS) throw new AppInfoError("appinfo.vdf has too many names");
  const strings: string[] = [];
  for (let i = 0; i < count; i += 1) strings.push(reader.cstring());
  return strings;
}

function readKeyValues(reader: Reader, strings: string[] | null, depth: number): KeyValues {
  if (depth > MAX_DEPTH) throw new AppInfoError("appinfo.vdf is nested too deeply");
  const key = (): string => {
    if (strings === null) return reader.cstring();
    const index = reader.u32();
    const name = strings[index];
    if (name === undefined) throw new AppInfoError("appinfo.vdf refers to a name that is not there");
    return name;
  };
  const object: KeyValues = {};
  for (;;) {
    const type = reader.u8();
    if (type === 0x08) return object;
    const name = key();
    switch (type) {
      case 0x00:
        object[name] = readKeyValues(reader, strings, depth + 1);
        break;
      case 0x01:
        object[name] = reader.cstring();
        break;
      case 0x02:
        object[name] = reader.i32();
        break;
      case 0x03: // float
      case 0x04: // pointer
      case 0x06: // colour
        reader.skip(4);
        break;
      case 0x05:
        reader.skipWideString();
        break;
      case 0x07: // unsigned 64 bit
      case 0x0a: // signed 64 bit
        reader.skip(8);
        break;
      default:
        throw new AppInfoError("appinfo.vdf has a value of an unknown kind");
    }
  }
}

const HASH = /^[0-9a-f]{40}$/;

/**
 * The client icon hash of each wanted app that has one. An app that is not in
 * the file, or has no icon hash, is simply left out.
 */
export function readClientIcons(data: Uint8Array, wanted: ReadonlySet<number>): Map<number, string> {
  return readCommon(data, wanted, (common) => (typeof common.clienticon === "string" && HASH.test(common.clienticon) ? common.clienticon : undefined));
}

/**
 * Whether each wanted app is a game rather than software (a tool, or an application such as a wallpaper program), as
 * Steam notes it. An app that is not in the file, or whose kind can't be read, is left out.
 */
export function readSteamKinds(data: Uint8Array, wanted: ReadonlySet<number>): Map<number, boolean> {
  return readCommon(data, wanted, (common) => (typeof common.type === "string" ? common.type.toLowerCase() === "game" : undefined));
}

/** What `pick` takes from the `common` block of each wanted app; an app it takes nothing from is left out. */
function readCommon<T>(data: Uint8Array, wanted: ReadonlySet<number>, pick: (common: KeyValues) => T | undefined): Map<number, T> {
  const found = new Map<number, T>();
  if (wanted.size === 0) return found;
  if (data.byteLength < 16) throw new AppInfoError("That is not an appinfo.vdf file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0, true);
  const version = magic & 0xff;
  if (magic >>> 8 !== MAGIC_HIGH) throw new AppInfoError("That is not an appinfo.vdf file");
  if (version < 39 || version > 41) throw new AppInfoError(`appinfo.vdf version ${version} is not supported`);

  let strings: string[] | null = null;
  let limit = data.byteLength;
  let pos = 8;
  if (version >= 41) {
    const offset = Number(view.getBigUint64(8, true));
    if (!Number.isSafeInteger(offset) || offset < 16 || offset >= data.byteLength) {
      throw new AppInfoError("appinfo.vdf has no usable name table");
    }
    strings = readStringTable(data, offset);
    limit = offset;
    pos = 16;
  }
  // Before the key-values: state, update time, token, hash, change number (and, from 40, a second hash).
  const fixed = version >= 40 ? 60 : 40;

  while (pos + 8 <= limit) {
    const appid = view.getUint32(pos, true);
    if (appid === 0) break;
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size;
    if (end > limit || size < fixed) throw new AppInfoError("appinfo.vdf has an entry that does not fit");
    if (wanted.has(appid)) {
      try {
        const reader = new Reader(data, pos + 8 + fixed, end);
        // The entry is one object (named "appinfo"); its `common` child holds what Steam knows about the app.
        if (reader.u8() === 0x00) {
          if (strings === null) reader.cstring();
          else reader.u32();
          const common = readKeyValues(reader, strings, 1).common;
          const value = typeof common === "object" ? pick(common) : undefined;
          if (value !== undefined) found.set(appid, value);
        }
      } catch (error) {
        // One damaged entry only loses what was wanted of that app.
        if (!(error instanceof AppInfoError)) throw error;
      }
      if (found.size === wanted.size) break;
    }
    pos = end;
  }
  return found;
}
