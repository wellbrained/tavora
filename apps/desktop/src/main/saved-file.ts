// One of the user's saved files, kept by the rules of saved-versions.ts, so no store has to follow them by hand:
// - its version is checked when it is read, and written first (or in its place) whenever it is written;
// - a file a newer Tavora wrote is copied aside (`<file>.from-version-<n>`) before this one can write over it, and is
//   then read as far as this Tavora understands it;
// - a damaged one is set aside (`<file>.corrupt-<time>`), the user is told, and the store starts from nothing;
// - one that can't be read right now (held by a virus scan) is never written over: until the store reads it again,
//   every write is refused;
// - the fields a newer Tavora added are written back as they were, for the kinds that keep them;
// - writes of a file run one at a time, in order, each whole or not at all (fsutil.ts writeFileAtomic).
// A store gives its file's kind (SAVED_FILES) and its own fields; it never writes the version, or the file, itself.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { readSavedFile, unknownFields, type SavedRecord } from "./json";
import { SUPPORTED_VERSIONS } from "./saved-versions";

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
} as const satisfies Record<string, SavedFileKind>;

/**
 * The files of saved-versions.ts not yet read and written with SavedFile, and why. Every other one has a kind above
 * (saved-file-rules.test.ts).
 */
export const NOT_SAVED_FILES: Readonly<Record<string, string>> = {
  "library.json": "moves to SavedFile in the next pull request",
  "workspace.json": "moves to SavedFile in the next pull request",
  "profile.json": "moves to SavedFile in the next pull request",
  "game-overlays.json": "moves to SavedFile in the next pull request",
  "ai-usage.json": "moves to SavedFile in the next pull request",
  moduleSettings: "moves to SavedFile in the next pull request",
  panelState: "moves to SavedFile in the next pull request",
  document: "moves to SavedFile in the next pull request",
  chosenFolders: "moves to SavedFile in the next pull request",
  sealed: "moves to SavedFile in the next pull request",
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

/** What a store writes: its own fields at the top of the file, without the version. */
export type SavedFields = Readonly<Record<string, unknown>>;

/** The writes and reads of each file, by its path, one at a time and in order, whichever SavedFile asks. */
const lines = new Map<string, Promise<void>>();

function inLine<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(file);
  const result = (lines.get(key) ?? Promise.resolve()).then(task);
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

/** A top-level member as it is written: its name and its value's text. */
type Member = readonly [name: string, text: string];

/** The members of `fields` written in `format`, taken now, so a store may change its own objects right after. */
function membersOf(fields: SavedFields, format: SavedFormat): Member[] {
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
    return inLine(this.file, () => this.readNow());
  }

  /**
   * Writes the store's fields, with the version, after every write of the file asked for before. When this SavedFile
   * hasn't read the file yet, it reads it first, so a newer Tavora's file is copied aside before it is written over.
   * Refused (SavedFileHeld) while the file couldn't be read. The fields are taken as they are now.
   */
  write(fields: SavedFields): Promise<void> {
    const members = membersOf(fields, this.kind.format);
    return inLine(this.file, async () => {
      await this.ready();
      await this.writeMembers(members);
    });
  }

  /**
   * Reads the file and writes what `change` makes of it, in one turn, so no other write of the file comes between.
   * `change` answers null to leave the file as it is. It never reads or writes this same file itself: that would wait
   * for this turn to end, which waits for it.
   */
  update(change: (saved: SavedRecord | null) => SavedFields | null | Promise<SavedFields | null>): Promise<void> {
    return inLine(this.file, async () => {
      const fields = await change(await this.readNow());
      if (fields !== null) await this.writeMembers(membersOf(fields, this.kind.format));
    });
  }

  /**
   * Writes now, without waiting, for the moment Tavora quits. Only after a read that succeeded; false when it didn't
   * write (or the write failed).
   */
  writeNow(fields: SavedFields): boolean {
    if (this.status.kind !== "read") return false;
    const now = `${this.file}.now`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(now, this.textOf(membersOf(fields, this.kind.format)));
      renameSync(now, this.file);
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves once every write of the file asked for so far is done (or has failed). */
  flush(): Promise<void> {
    return inLine(this.file, async () => undefined);
  }

  private async readNow(): Promise<SavedRecord | null> {
    let saved: SavedRecord | null;
    try {
      saved = await readSavedFile(this.file, { version: this.kind.version, ...(this.kind.versionKey ? { versionKey: this.kind.versionKey } : {}), ...(this.kind.notice === false ? { notice: false } : {}) });
    } catch (error) {
      this.status = { kind: "held", error };
      this.kept = [];
      throw error;
    }
    this.status = { kind: "read" };
    const keep = this.kind.keep;
    this.kept = keep ? membersOf(unknownFields(saved, [this.versionKey, ...keep.known]), this.kind.format) : [];
    return saved;
  }

  /** Reads the file first when this SavedFile hasn't; refuses while it couldn't be read. */
  private async ready(): Promise<void> {
    if (this.status.kind === "unread") await this.readNow().catch(() => undefined);
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

  private async writeMembers(members: readonly Member[]): Promise<void> {
    await writeFileAtomic(this.file, this.textOf(members));
  }
}
