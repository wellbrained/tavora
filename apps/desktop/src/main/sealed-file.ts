// A sealed file (`{ "v": 1, "data": … }`, the data sealed with the system's key store: the sign-in, the account's keys,
// Discord's sign-in), kept by SavedFile's rules (saved-file.ts), and by one more of its own (decided 2026-11-23, "a
// saved file that can't be read is never written over"):
// - one that can't be read right now (a virus scan or a sync app holds it, the user profile is locked) is never written
//   over or removed: a write reads it again first, and is refused while that fails, and the user is told. A store whose
//   file always holds less than what it writes (a sign-in, written when the user signs in) may move it aside instead
//   (`<file>.held-<time>`, kept), so the user is never stuck with it; only one that can't even be moved is refused;
// - a damaged one is set aside, and reads as missing; one a newer Tavora wrote is copied aside;
// - one whose data doesn't open here (sealed by another Windows user, a key store locked for now, or the store refuses
//   it) stays where it is, so the next start can try again, and a copy goes aside (`<file>.unopened`).
// The bytes are the same as before: `{"v":1,"data":…}`, then the store's own fields next to the sealed data.
import { rename, stat } from "node:fs/promises";
import path from "node:path";
import { keepCopy } from "./fsutil";
import { forgetSealedFile, type SavedRecord } from "./json";
import { SAVED_FILES, SavedFile, SavedFileHeld } from "./saved-file";

/** What a sealed file held when it was read. */
export type SealedRead<T> =
  /** Not there (or damaged, and set aside). */
  | { status: "missing" }
  | { status: "opened"; value: T; saved: SavedRecord }
  /** Couldn't be read right now: nothing is written over it until a read succeeds. */
  | { status: "held"; error: unknown }
  /** A newer Tavora's: copied aside. */
  | { status: "newer"; saved: SavedRecord }
  /** Its data doesn't open here: it stays, with a copy aside. */
  | { status: "unopened"; saved: SavedRecord };

/** The sealed files whose write was refused this run, as they couldn't be read, and who hears of each new one. */
const heldFiles = new Set<string>();
let heldListener: (() => void) | null = null;

/** How many sealed files couldn't be written this run, as they couldn't be read: the host UI says so. */
export function sealedFilesHeld(): number {
  return heldFiles.size;
}

/** Hears of every sealed file from now on whose write is refused because it can't be read. */
export function onSealedFileHeld(listener: (() => void) | null): void {
  heldListener = listener;
}

function tellHeld(file: string): void {
  const key = path.resolve(file);
  console.error(`[tavora] ${path.basename(file)} can't be read right now, so it isn't written over`);
  if (heldFiles.has(key)) return;
  heldFiles.add(key);
  heldListener?.();
}

/** One sealed file. Each store keeps one per file it keeps open, so a read of its that failed holds its writes. */
export class SealedFile {
  private readonly saved: SavedFile;
  /** The last read of the store's failed: nothing is written or removed until one succeeds. */
  private held = false;

  /**
   * `moveHeldAside`: a write or a removal that finds the file still can't be read moves it aside, as it is, and goes on.
   * Only for a file whose store always writes what is newest (a sign-in): never for a key, which would be lost to it.
   */
  constructor(
    readonly file: string,
    private readonly options: { readonly moveHeldAside?: boolean } = {},
  ) {
    this.saved = new SavedFile(file, SAVED_FILES.sealed);
  }

  /** Reads the file and opens its data with `open`, which also gets the whole record. Never throws. */
  async open<T>(open: (data: string, saved: SavedRecord) => T | Promise<T>): Promise<SealedRead<T>> {
    let saved: SavedRecord | null;
    try {
      saved = await this.saved.read();
    } catch (error) {
      this.held = true;
      return { status: "held", error };
    }
    this.held = false;
    if (saved === null) return { status: "missing" };
    // SAVED_FILES.sealed reads only this version with its data, or a newer one.
    if (saved.v !== SAVED_FILES.sealed.version) return { status: "newer", saved };
    try {
      return { status: "opened", value: await open(saved.data as string, saved), saved };
    } catch {
      await keepCopy(path.dirname(this.file), `${path.basename(this.file)}.unopened`, Buffer.from(JSON.stringify(saved))).catch(() => undefined);
      return { status: "unopened", saved };
    }
  }

  /**
   * Writes the sealed data and the store's fields next to it (the version comes first). After a read that failed, the
   * file is read again first: refused (SavedFileHeld), and the user told, while it still can't be read.
   */
  async write(fields: { readonly data: string } & Record<string, unknown>): Promise<void> {
    try {
      await this.saved.write(fields);
    } catch (error) {
      if (!(error instanceof SavedFileHeld)) throw error;
      await this.readAgain(error);
      await this.saved.write(fields);
    }
    this.held = false;
  }

  /**
   * Removes the file and every copy of it set aside (signing out). Refused like a write while it can't be read; or, with
   * `moveHeldAside`, it is moved aside then (and kept), and so is one that can't be removed.
   */
  async forget(): Promise<void> {
    if (this.held) await this.readAgain();
    await this.saved.flush();
    try {
      await forgetSealedFile(this.file);
    } catch (error) {
      if (!this.options.moveHeldAside) throw error;
      await this.moveAside();
      await forgetSealedFile(this.file);
    }
  }

  /**
   * Reads the file again, after a read that failed. While it still fails: with `moveHeldAside` it is moved aside, else
   * SavedFileHeld is thrown and the user told.
   */
  private async readAgain(refused?: SavedFileHeld): Promise<void> {
    try {
      await this.saved.read();
    } catch (error) {
      if (!this.options.moveHeldAside) {
        this.held = true;
        tellHeld(this.file);
        throw refused ?? new SavedFileHeld(this.file, error);
      }
      await this.moveAside();
      // Gone from its place now: read as missing, so the store's write goes on.
      await this.saved.read();
    }
    this.held = false;
  }

  /** Moves the file aside, as it is, to `<file>.held-<time>` (never onto a file there); throws SavedFileHeld when it can't. */
  private async moveAside(): Promise<void> {
    const stamp = `${this.file}.held-${Date.now()}`;
    try {
      for (let n = 1; ; n++) {
        const target = n === 1 ? stamp : `${stamp}-${n}`;
        const taken = await stat(target).then(
          () => true,
          (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
        );
        if (taken) continue;
        await rename(this.file, target);
        console.error(`[tavora] ${path.basename(this.file)} couldn't be read, so it was kept as ${path.basename(target)}`);
        return;
      }
    } catch (error) {
      this.held = true;
      tellHeld(this.file);
      throw new SavedFileHeld(this.file, error);
    }
  }
}
