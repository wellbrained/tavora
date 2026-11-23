// One of the user's saved files, kept by the rules of saved-versions.ts, so no store has to follow them by hand:
// - its version is checked when it is read, and written first (or in its place) whenever it is written;
// - a file a newer Tavora wrote is copied aside (`<file>.from-version-<n>`) before this one can write over it, and is
//   then read as far as this Tavora understands it;
// - a damaged one is set aside (`<file>.corrupt-<time>`), the user is told, and the store starts from nothing;
// - one that can't be read right now (held by a virus scan) is never written over: after a read of the store's that
//   failed, every write is refused until it reads the file again;
// - the fields a newer Tavora added are written back as they were, for the kinds that keep them;
// - writes of a file run one at a time, in order, each whole or not at all (fsutil.ts writeFileAtomic); a write at
//   quit (writeNow) goes first, and no write asked before it lands after it; and none waits forever: a read or write
//   that takes too long is given up (SAVED_FILE_TURN_MS), and the next goes on.
// A store gives its file's kind (SAVED_FILES) and its own fields; it never writes the version, or the file, itself.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import path from "node:path";
import { writeFileUnlessReplaced } from "./fsutil";
import { readSavedFile, unknownFields, type SavedRecord } from "./json";
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
}

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
  // Their unknown fields are kept by the stores themselves, at every level, as they travel with the cloud copy.
  "library.json": { version: SUPPORTED_VERSIONS["library.json"], format: "indented" },
  "workspace.json": { version: SUPPORTED_VERSIONS["workspace.json"], format: "indented" },
  "profile.json": { version: SUPPORTED_VERSIONS["profile.json"], format: "indented" },
  moduleSettings: { version: STORE_VERSIONS.moduleSettings, format: "compact", keep: { known: ["entries"] } },
  panelState: { version: STORE_VERSIONS.panelState, format: "compact", keep: { known: ["owner", "value"], before: "value" } },
  document: { version: STORE_VERSIONS.document, format: "compact" },
  chosenFolders: { version: STORE_VERSIONS.chosenFolders, format: "compact" },
} as const satisfies Record<string, SavedFileKind>;

/**
 * The files of saved-versions.ts not yet read and written with SavedFile, and why. Every other one has a kind above
 * (saved-file-rules.test.ts).
 */
export const NOT_SAVED_FILES: Readonly<Record<string, string>> = {
  "ai-usage.json": "planned: moves to SavedFile in a pull request after #909, with the cloud copy's files and the sealed ones (decided 2026-11-23); until then the AI usage connector reads and writes it through its own file access (AiUsageDeps), which its tests fake, and checks it with json.ts checkSavedFile",
  sealed: "planned: moves to SavedFile in a pull request after #909, and then a sealed file that can't be read right now is never written over either (decided 2026-11-23); until then json.ts openSealedFile opens it, and gives none for such a file",
  readOnlyFiles: "the version is on each entry, as Tavora 0.24 refuses a file with anything but entries in it",
  cloudCopy: "the cloud copy's files are being changed elsewhere (#909); they move once that has landed",
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
 * How long one read or write of a file may take in its turn. One that takes longer (a disk or a virus scan that never
 * answers) is given up: its caller hears SavedFileTimeout, the next in line goes on, and what it was writing is never
 * put in place after that. So no read or write of a file waits forever.
 */
export const SAVED_FILE_TURN_MS = 30_000;

/** A read or write of a file given up after its turn took too long (SAVED_FILE_TURN_MS). */
export class SavedFileTimeout extends Error {
  constructor(file: string, ms: number) {
    super(`${path.basename(file)} wasn't read or written within ${ms} ms, so it was given up`);
    this.name = "SavedFileTimeout";
  }
}

/** A turn of a file's line: told whether it still lasts (false once it was given up). */
type Turn<T> = (live: () => boolean) => Promise<T>;

function inLine<T>(file: string, task: Turn<T>): Promise<T> {
  const key = path.resolve(file);
  const result = (lines.get(key) ?? Promise.resolve()).then(
    () =>
      new Promise<T>((resolve, reject) => {
        let live = true;
        const timer = setTimeout(() => {
          live = false;
          reject(new SavedFileTimeout(file, SAVED_FILE_TURN_MS));
        }, SAVED_FILE_TURN_MS);
        timer.unref?.();
        task(() => live).then(
          (value) => {
            if (!live) return;
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            if (!live) return;
            clearTimeout(timer);
            reject(error);
          },
        );
      }),
  );
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
    return inLine(this.file, (live) => this.readNow(live)).catch((error: unknown) => {
      // Given up: what is in it is as unknown as one that couldn't be read, so nothing is written over it.
      if (error instanceof SavedFileTimeout) {
        this.status = { kind: "held", error };
        this.kept = [];
      }
      throw error;
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
    return inLine(this.file, async (live) => {
      await this.ready(live);
      await this.writeMembers(members, asked, live);
    });
  }

  /**
   * Reads the file and writes what `change` makes of it, in one turn, so no other write of the file comes between.
   * `change` answers null to leave the file as it is. It never reads or writes this same file itself: that would wait
   * for this turn to end, which waits for it.
   */
  update<T extends SavedFields>(change: (saved: SavedRecord | null) => Fields<T> | null | Promise<Fields<T> | null>): Promise<void> {
    const asked = quitCount(this.file);
    return inLine(this.file, async (live) => {
      const fields = await change(await this.readNow(live));
      if (fields !== null && live()) await this.writeMembers(membersOf(fields, this.kind.format), asked, live);
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

  /** Resolves once every write of the file asked for so far is done (or has failed). */
  flush(): Promise<void> {
    return inLine(this.file, async () => undefined);
  }

  /** Reads the file in a turn; one given up meanwhile changes nothing of what this SavedFile knows. */
  private async readNow(live: () => boolean): Promise<SavedRecord | null> {
    let saved: SavedRecord | null;
    try {
      saved = await readSavedFile(this.file, { version: this.kind.version, ...(this.kind.versionKey ? { versionKey: this.kind.versionKey } : {}), ...(this.kind.notice === false ? { notice: false } : {}) });
    } catch (error) {
      if (!live()) throw error;
      this.status = { kind: "held", error };
      this.kept = [];
      throw error;
    }
    if (!live()) throw new SavedFileTimeout(this.file, SAVED_FILE_TURN_MS);
    this.status = { kind: "read" };
    const keep = this.kind.keep;
    this.kept = keep ? membersOf(unknownFields(saved, [this.versionKey, ...keep.known]), this.kind.format) : [];
    return saved;
  }

  /**
   * Reads the file first when this SavedFile hasn't; refuses while it couldn't be read. A read the store asked for that
   * failed holds every write until one succeeds, as what the store has may stand in for what it couldn't read. One done
   * here only for the write holds just this write: nothing the store has came from it, so the next write reads again.
   */
  private async ready(live: () => boolean): Promise<void> {
    if (this.status.kind === "unread") {
      try {
        await this.readNow(live);
      } catch (error) {
        if (!live()) throw error;
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

  /**
   * Writes, unless a write at quit came after this one was asked for (`asked`: how many there were then), or its turn
   * was given up meanwhile.
   */
  private async writeMembers(members: readonly Member[], asked: number, live: () => boolean): Promise<void> {
    const quitSince = () => quitCount(this.file) !== asked;
    const current = () => live() && !quitSince();
    if (!current()) return;
    const wrote = await writeFileUnlessReplaced(this.file, this.textOf(members), current);
    // Put in place while a write at quit was made: the newest of those goes back over it, at once (nothing can come
    // between, and Tavora can't stop in the middle of it).
    const last = quitWrites.get(path.resolve(this.file));
    if (wrote && last && quitSince() && !putNow(this.file, last.text)) console.error(`[tavora] couldn't write ${path.basename(this.file)} again as it was at quit`);
  }
}
