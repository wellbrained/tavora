// One of the user's saved files, kept by the rules of saved-versions.ts, so no store has to follow them by hand:
// - its version is checked when it is read, and written first (or in its place) whenever it is written;
// - a file a newer Tavora wrote is copied aside (`<file>.from-version-<n>`) before this one can write over it, and is
//   then read as far as this Tavora understands it;
// - a damaged one is set aside (`<file>.corrupt-<time>`), the user is told, and the store starts from nothing; so is one
//   its kind can't use at all (`valid`). A kind whose file means something by being there (the cloud copy's) leaves it
//   in place instead, with a copy aside (`<file>.corrupt`), and its store reads it with look(), which says it is damaged;
// - one that can't be read right now (held by a virus scan) is never written over: after a read of the store's that
//   failed, every write is refused until it reads the file again;
// - the fields a newer Tavora added are written back as they were, for the kinds that keep them;
// - writes of a file run one at a time, in order, each whole or not at all (fsutil.ts writeFileAtomic), each at once
//   and flushed to the disk before it is in place: none is put off or joined with another, so a store that writes one
//   before a step that depends on it can rely on that; a write at quit (writeNow) goes first, and no write asked before
//   it lands after it.
// A store gives its file's kind (SAVED_FILES) and its own fields; it never writes the version, or the file, itself.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DamagedFile, type Looked } from "./file-look";
import { writeFileUnlessReplaced } from "./fsutil";
import { checkSavedFile, keepDamagedCopy, setAside, unknownFields, type SavedFileRules, type SavedRecord } from "./json";
import { STORE_VERSIONS, SUPPORTED_VERSIONS } from "./saved-versions";

/** How a kind of saved file is written: indented with a newline at the end, indented without one, or on one line. */
export type SavedFormat = "lines" | "indented" | "compact";

/** One kind of the user's saved files: its version, and how it is read and written. */
export interface SavedFileKind {
  /** The newest format of the file this Tavora understands, and the one it writes. */
  readonly version: number;
  /** The field the version is in: "version", or "v" in the sealed files. */
  readonly versionKey?: "version" | "v";
  /** Tell the user when the file is set aside. Off for bookkeeping they would never miss; on by default. */
  readonly notice?: boolean;
  readonly format: SavedFormat;
  /**
   * The fields this Tavora knows at the top of the file. Given, every other one (a newer Tavora's) is written back as
   * it was: after the version, or before `before` when that field is written. Left out, a write holds only what the
   * store gives.
   */
  readonly keep?: { readonly known: readonly string[]; readonly before?: string };
  /**
   * Whether a file read is one of this kind at all. One that isn't is damaged: set aside like a file that isn't JSON,
   * and read as missing. Left out, every JSON object is.
   */
  readonly valid?: (saved: SavedRecord) => boolean;
  /**
   * A damaged one stays where it is, with a copy aside (`<file>.corrupt`, once per content), instead of being set aside:
   * for a file whose being there means something (the cloud copy's own files say it is on, or that a swap began). Its
   * store reads it with look(), which tells a damaged one from a missing one.
   */
  readonly leaveInPlace?: boolean;
}

/**
 * A sealed file (`{ "v": 1, "data": … }`): its data sealed with the system's key store, or one a newer Tavora wrote,
 * which is copied aside and read as far as this Tavora understands it (sealed-file.ts).
 */
const isSealed = (saved: SavedRecord) => (typeof saved.v === "number" && saved.v > STORE_VERSIONS.sealed) || (saved.v === STORE_VERSIONS.sealed && typeof saved.data === "string");

/** A note of the parts this PC saw unused (copy-folder.ts), or one a newer Tavora wrote. */
const isUnusedNote = (saved: SavedRecord) =>
  (typeof saved.v === "number" && saved.v > STORE_VERSIONS.copyUnused) || (saved.v === STORE_VERSIONS.copyUnused && typeof saved.folder === "string" && typeof saved.last === "number" && typeof saved.waited === "object" && saved.waited !== null);

/**
 * Every kind of the user's saved files, by its name in saved-versions.ts and with the version from there. A new kind of
 * file is added there and here; its store reads and writes it with SavedFile only (saved-file-rules.test.ts checks it).
 */
export const SAVED_FILES = {
  "grants.json": { version: SUPPORTED_VERSIONS["grants.json"], format: "lines" },
  "hotkeys.json": { version: SUPPORTED_VERSIONS["hotkeys.json"], format: "lines" },
  "overlays.json": { version: SUPPORTED_VERSIONS["overlays.json"], format: "lines" },
  "module-owners.json": { version: SUPPORTED_VERSIONS["module-owners.json"], format: "lines" },
  "official-updates.json": { version: SUPPORTED_VERSIONS["official-updates.json"], format: "lines" },
  "connection.json": { version: SUPPORTED_VERSIONS["connection.json"], format: "lines" },
  "traffic.json": { version: SUPPORTED_VERSIONS["traffic.json"], format: "lines" },
  "module-data-pending.json": { version: SUPPORTED_VERSIONS["module-data-pending.json"], format: "lines" },
  "game-overlays.json": { version: SUPPORTED_VERSIONS["game-overlays.json"], format: "lines" },
  "ai-usage.json": { version: SUPPORTED_VERSIONS["ai-usage.json"], format: "indented" },
  // Their unknown fields are kept by the stores themselves, at every level, as they travel with the cloud copy.
  "library.json": { version: SUPPORTED_VERSIONS["library.json"], format: "indented" },
  "workspace.json": { version: SUPPORTED_VERSIONS["workspace.json"], format: "indented" },
  "profile.json": { version: SUPPORTED_VERSIONS["profile.json"], format: "indented" },
  moduleSettings: { version: STORE_VERSIONS.moduleSettings, format: "compact", keep: { known: ["entries"] } },
  panelState: { version: STORE_VERSIONS.panelState, format: "compact", keep: { known: ["owner", "value"], before: "value" } },
  document: { version: STORE_VERSIONS.document, format: "compact" },
  chosenFolders: { version: STORE_VERSIONS.chosenFolders, format: "compact" },
  // account.json, account-key.json (and account-key.<account>.json, and the older cloud-copy-key.json), discord.json:
  // read and written by sealed-file.ts. The fields next to the sealed data (the key's `account`) are the store's own.
  sealed: { version: STORE_VERSIONS.sealed, versionKey: "v", format: "compact", valid: isSealed },
  // The cloud copy's own files, read and written by copy-files.ts. One that is there says something (the copy is on, a
  // swap began), so a damaged one stays, with a copy aside, and reads as damaged. Bookkeeping the user never sees, so
  // they aren't told, except of where the copy is kept: with that damaged, the copy is off for the run.
  cloudCopy: { version: STORE_VERSIONS.cloudCopy, versionKey: "v", notice: false, format: "compact", leaveInPlace: true },
  copyPlace: { version: STORE_VERSIONS.copyPlace, versionKey: "v", format: "compact", leaveInPlace: true },
  copyStatus: { version: STORE_VERSIONS.copyStatus, versionKey: "v", notice: false, format: "compact", leaveInPlace: true },
  copyList: { version: STORE_VERSIONS.copyList, versionKey: "v", notice: false, format: "compact", leaveInPlace: true },
  incomingLists: { version: STORE_VERSIONS.incomingLists, versionKey: "v", notice: false, format: "compact", leaveInPlace: true },
  // Only how long parts have waited: a damaged one is set aside, and every part counts from now.
  copyUnused: { version: STORE_VERSIONS.copyUnused, versionKey: "v", notice: false, format: "compact", valid: isUnusedNote },
} as const satisfies Record<string, SavedFileKind>;

/**
 * The files of saved-versions.ts not yet read and written with SavedFile, and why. Every other one has a kind above
 * (saved-file-rules.test.ts).
 */
export const NOT_SAVED_FILES: Readonly<Record<string, string>> = {
  readOnlyFiles: "the version is on each entry, as Tavora 0.24 refuses a file with anything but entries in it",
};

/** A write refused because the file couldn't be read: it may hold what the store never saw. */
export class SavedFileHeld extends Error {
  constructor(file: string, cause: unknown) {
    super(`${path.basename(file)} couldn't be read, so it isn't written over`, { cause });
    this.name = "SavedFileHeld";
  }
}

/** JSON already serialized, written as it is. Only in a file of the compact format, at its top level. */
export class RawJson {
  constructor(readonly text: string) {}
}

/**
 * What a store writes: its own fields at the top of the file, without the version. A record, never a list (a list would
 * be written as a record of its indexes), so no field of its is called `length`.
 */
export type SavedFields = object;

/** Fields that aren't a list: with T a list, `length` is a number, and no number is never. */
type Fields<T extends SavedFields> = T & { readonly length?: never };

/** The writes and reads of each file, by its path, one at a time and in order, whichever SavedFile asks. */
const lines = new Map<string, Promise<void>>();

/**
 * How long a turn of a file's line may take before the log says so, once. It still goes on: the turn after it waits,
 * so the order stays, and nothing else changes.
 */
export const SLOW_TURN_MS = 30_000;

function inLine<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(file);
  const result = (lines.get(key) ?? Promise.resolve()).then(() => {
    const slow = setTimeout(() => console.warn(`[tavora] ${file} still being saved after ${SLOW_TURN_MS / 1000} s`), SLOW_TURN_MS);
    slow.unref?.();
    return task().finally(() => clearTimeout(slow));
  });
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  lines.set(key, tail);
  void tail.then(() => {
    if (lines.get(key) === tail) lines.delete(key);
  });
  return result;
}

/**
 * The writes at quit (writeNow) of each file, by its path: how many so far, and the text of the last. A write asked
 * before the last of them never lands after it.
 */
const quitWrites = new Map<string, { count: number; text: string }>();

const quitCount = (file: string) => quitWrites.get(path.resolve(file))?.count ?? 0;

/**
 * Writes a file at once, whole: to `<file>.now`, flushed to the disk, then renamed over the file, so a power cut leaves
 * the old file or the new one. For the moment Tavora quits. Whether it was written; a `<file>.now` a crash left behind
 * goes at the next start (fsutil.ts sweepWriteLeftovers).
 */
function putNow(file: string, text: string): boolean {
  const now = `${file}.now`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const handle = openSync(now, "w");
    try {
      writeSync(handle, text);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(now, file);
    return true;
  } catch {
    return false;
  }
}

/** A top-level member as it is written: its name and its value's text. */
type Member = readonly [name: string, text: string];

/** What a read found: the record (and its bytes), nothing, or a damaged file, set aside or (left in place) copied aside. */
type Found = { status: "saved"; saved: SavedRecord; bytes: Buffer } | { status: "missing" } | { status: "damaged" };

/** The members of `fields` written in `format`, taken now, so a store may change its own objects right after. */
function membersOf(fields: SavedFields, format: SavedFormat): Member[] {
  if (Array.isArray(fields)) throw new Error("A saved file holds a record, not a list");
  const members: Member[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof RawJson) {
      if (format !== "compact") throw new Error("RawJson is only written in a compact file");
      members.push([name, value.text]);
      continue;
    }
    const text = format === "compact" ? JSON.stringify(value) : (JSON.stringify(value, null, 2) as string | undefined)?.replace(/\n/g, "\n  ");
    if (text !== undefined) members.push([name, text]);
  }
  return members;
}

/** The text of a file of these members, the same as JSON.stringify of the object they make. */
function textOf(members: readonly Member[], format: SavedFormat): string {
  if (format === "compact") return `{${members.map(([name, text]) => `${JSON.stringify(name)}:${text}`).join(",")}}`;
  const body = members.length === 0 ? "{}" : `{\n${members.map(([name, text]) => `  ${JSON.stringify(name)}: ${text}`).join(",\n")}\n}`;
  return format === "lines" ? `${body}\n` : body;
}

/**
 * One of the user's saved files. read() gives what it holds, by the rules above; write() and update() write it, one
 * at a time with every other write of the same file, after reading it first when this SavedFile hasn't. Each store
 * keeps one SavedFile per file it keeps open, so what it read decides what it may write.
 */
export class SavedFile {
  /** What the last read found: nothing yet, the file read (or missing), or a file that couldn't be read. */
  private status: { kind: "unread" } | { kind: "read" } | { kind: "held"; error: unknown } = { kind: "unread" };
  /** The fields of the last read a newer Tavora added, to write back (kinds that keep them). */
  private kept: Member[] = [];

  constructor(
    readonly file: string,
    readonly kind: SavedFileKind,
  ) {}

  /**
   * What the file holds. Missing gives null. A damaged one is set aside, the user is told, and it gives null. One a newer
   * Tavora wrote is copied aside first, then given as it is, to be read as far as this Tavora understands it. One that
   * can't be read right now throws, and nothing is written to it until a read succeeds.
   */
  read(): Promise<SavedRecord | null> {
    return inLine(this.file, async () => {
      const found = await this.readNow();
      return found.status === "saved" ? found.saved : null;
    });
  }

  /**
   * What the file holds, told the way file-look.ts tells it: present, missing, or held, which is a file that can't be
   * read right now or a damaged one (DamagedFile). `parse` gives the store's value of the record, or null when it can't
   * use it, which counts as damaged too. A damaged one is set aside as read() does, so for a kind left in place it stays,
   * with a copy aside; one a newer Tavora wrote is copied aside first, then parsed. Never throws.
   */
  look<T>(parse: (saved: SavedRecord) => T | null): Promise<Looked<T>> {
    return inLine(this.file, async (): Promise<Looked<T>> => {
      let found: Found;
      try {
        found = await this.readNow();
      } catch (error) {
        return { status: "held", error };
      }
      const gone: Looked<T> = this.kind.leaveInPlace ? { status: "held", error: new DamagedFile(`${this.file} is damaged`) } : { status: "missing" };
      if (found.status === "missing") return { status: "missing" };
      if (found.status === "damaged") return gone;
      const value = parse(found.saved);
      if (value !== null) return { status: "present", value };
      // A newer Tavora's is kept aside already, as it was.
      if (!this.isNewer(found.saved)) {
        try {
          await this.putAside(found.bytes);
        } catch (error) {
          this.status = { kind: "held", error };
          return { status: "held", error };
        }
      }
      return gone;
    });
  }

  /**
   * Writes the store's fields, with the version, after every write of the file asked for before. When this SavedFile
   * hasn't read the file yet, it reads it first, so a newer Tavora's file is copied aside before it is written over.
   * Refused (SavedFileHeld) while the file couldn't be read. The fields are taken as they are now.
   */
  write<T extends SavedFields>(fields: Fields<T>): Promise<void> {
    let members: Member[];
    try {
      members = membersOf(fields, this.kind.format);
    } catch (error) {
      return Promise.reject(error);
    }
    const asked = quitCount(this.file);
    return inLine(this.file, async () => {
      await this.ready();
      await this.writeMembers(members, asked);
    });
  }

  /**
   * Reads the file and writes what `change` makes of it, in one turn, so no other write of the file comes between.
   * `change` answers null to leave the file as it is. It never reads or writes this same file itself: that would wait
   * for this turn to end, which waits for it.
   */
  update<T extends SavedFields>(change: (saved: SavedRecord | null) => Fields<T> | null | Promise<Fields<T> | null>): Promise<void> {
    const asked = quitCount(this.file);
    return inLine(this.file, async () => {
      const found = await this.readNow();
      const fields = await change(found.status === "saved" ? found.saved : null);
      if (fields !== null) await this.writeMembers(membersOf(fields, this.kind.format), asked);
    });
  }

  /**
   * Writes now, without waiting, for the moment Tavora quits. Only after a read that succeeded; false when it didn't
   * write (or the write failed). Once written, it takes the place of every write asked for before it: one still waiting
   * is dropped, one being written is not put in place, and one whose file went in place meanwhile is written over with
   * the newest of these texts again, at once. One that failed takes the place of nothing.
   */
  writeNow<T extends SavedFields>(fields: Fields<T>): boolean {
    if (this.status.kind !== "read") return false;
    let text: string;
    try {
      text = this.textOf(membersOf(fields, this.kind.format));
    } catch {
      return false;
    }
    if (!putNow(this.file, text)) return false;
    quitWrites.set(path.resolve(this.file), { count: quitCount(this.file) + 1, text });
    return true;
  }

  /**
   * Removes the file, after every write of it asked for before, and only as a write may: after reading it first when
   * this SavedFile hasn't (so a newer Tavora's is copied aside), and refused (SavedFileHeld) while it couldn't be read.
   * A write at quit made since it was asked for stays.
   */
  remove(): Promise<void> {
    const asked = quitCount(this.file);
    return inLine(this.file, async () => {
      await this.ready();
      if (quitCount(this.file) === asked) await rm(this.file, { force: true });
    });
  }

  /** Resolves once every write of the file asked for so far is done (or has failed). */
  flush(): Promise<void> {
    return inLine(this.file, async () => undefined);
  }

  private async readNow(): Promise<Found> {
    let found: Found;
    try {
      found = await this.find();
    } catch (error) {
      this.status = { kind: "held", error };
      this.kept = [];
      throw error;
    }
    this.status = { kind: "read" };
    const keep = this.kind.keep;
    this.kept = keep && found.status === "saved" ? membersOf(unknownFields(found.saved, [this.versionKey, ...keep.known]), this.kind.format) : [];
    return found;
  }

  /** Reads the file by the rules: one its kind can't use is put aside like one that isn't JSON. */
  private async find(): Promise<Found> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
      throw error;
    }
    const saved = await checkSavedFile(this.file, bytes, this.rules);
    if (saved === null) return { status: "damaged" };
    if (this.kind.valid && !this.kind.valid(saved)) {
      await this.putAside(bytes);
      return { status: "damaged" };
    }
    return { status: "saved", saved, bytes };
  }

  private get rules(): SavedFileRules {
    return { version: this.kind.version, ...(this.kind.versionKey ? { versionKey: this.kind.versionKey } : {}), ...(this.kind.notice === false ? { notice: false } : {}), ...(this.kind.leaveInPlace ? { leaveInPlace: true } : {}) };
  }

  /** A file that can't be used: set aside, or, for a kind left in place, copied aside. */
  private async putAside(bytes: Buffer): Promise<void> {
    if (this.kind.leaveInPlace) await keepDamagedCopy(this.file, bytes, this.kind.notice !== false);
    else await setAside(this.file, this.kind.notice !== false);
  }

  private isNewer(saved: SavedRecord): boolean {
    const version = saved[this.versionKey];
    return typeof version === "number" && version > this.kind.version;
  }

  /**
   * Reads the file first when this SavedFile hasn't; refuses while it couldn't be read. A read the store asked for that
   * failed holds every write until one succeeds, as what the store has may stand in for what it couldn't read. One done
   * here only for the write holds just this write: nothing the store has came from it, so the next write reads again.
   */
  private async ready(): Promise<void> {
    if (this.status.kind === "unread") {
      try {
        await this.readNow();
      } catch (error) {
        this.status = { kind: "unread" };
        throw new SavedFileHeld(this.file, error);
      }
    }
    if (this.status.kind === "held") throw new SavedFileHeld(this.file, this.status.error);
  }

  private get versionKey(): string {
    return this.kind.versionKey ?? "version";
  }

  /** The file's text: the version first (or where the store put it), the kept fields, then the store's fields. */
  private textOf(members: readonly Member[]): string {
    const { format, version } = this.kind;
    const versioned: Member = [this.versionKey, JSON.stringify(version)];
    const own = members.some(([name]) => name === this.versionKey) ? members.map((member) => (member[0] === this.versionKey ? versioned : member)) : [versioned, ...members];
    const names = new Set(own.map(([name]) => name));
    const kept = this.kept.filter(([name]) => !names.has(name));
    const before = this.kind.keep?.before;
    const beforeAt = before === undefined ? -1 : own.findIndex(([name]) => name === before);
    const at = beforeAt >= 0 ? beforeAt : own.findIndex(([name]) => name === this.versionKey) + 1;
    return textOf([...own.slice(0, at), ...kept, ...own.slice(at)], format);
  }

  /** Writes, unless a write at quit came after this one was asked for (`asked`: how many there were then). */
  private async writeMembers(members: readonly Member[], asked: number): Promise<void> {
    const current = () => quitCount(this.file) === asked;
    if (!current()) return;
    const wrote = await writeFileUnlessReplaced(this.file, this.textOf(members), current);
    // Put in place while a write at quit was made: the newest of those goes back over it, at once (nothing can come
    // between, and Tavora can't stop in the middle of it).
    const last = quitWrites.get(path.resolve(this.file));
    if (wrote && last && !current() && !putNow(this.file, last.text)) console.error(`[tavora] couldn't write ${path.basename(this.file)} again as it was at quit`);
  }
}
