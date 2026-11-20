import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { keepNewerCopy, readJsonOrSetAside, readSavedFile, setAside } from "./json";
import { sanitizeLibrary, type Library } from "./library";
import { isProfileId, sanitizeProfile, type Profile } from "./profile";
import { SUPPORTED_VERSIONS } from "./saved-versions";
import type { WindowState } from "./window-state";
import { loadWorkspace, saveWorkspace, type WorkspaceState } from "./workspace";

// The files the host keeps in the data folder: the library, the workspaces, the profile and the
// window. This module is the only one that knows their names. It reads them, writes them one after
// another, and says which are the user's own (backed up and in the cloud copy) and which library
// settings belong to this PC. Every file's version is in saved-versions.ts, with the rules for raising one.

export const LIBRARY_FILE = "library.json";
export const WORKSPACE_FILE = "workspace.json";
export const PROFILE_FILE = "profile.json";
/** Where the window was; this PC's own, so it is neither backed up nor copied. */
export const WINDOW_FILE = "window.json";

/** The user's own data files: backed up every day and part of the cloud copy. */
export const DATA_FILES = [LIBRARY_FILE, WORKSPACE_FILE, PROFILE_FILE] as const;

export { SUPPORTED_VERSIONS } from "./saved-versions";

/** Library settings that belong to this PC; a cloud copy from another PC never replaces them. */
export const PC_SETTINGS = ["moduleFilesFolder", "developmentFolders", "collapsedDevelopmentFolders", "dialogFolders", "moduleFolders", "steamProfile", "installId", "askedModules", "pc"] as const satisfies readonly (keyof Library)[];

export function libraryFile(userData: string): string {
  return path.join(userData, LIBRARY_FILE);
}

/** Whether there is any saved library yet, so anything to back up. */
export async function hasLibrary(userData: string): Promise<boolean> {
  return stat(libraryFile(userData)).then(
    () => true,
    () => false,
  );
}

/** The saved library, cleaned up; a missing file gives an empty one, and an unreadable one is set aside first. */
export async function loadLibrary(userData: string): Promise<Library> {
  return sanitizeLibrary(await readSavedFile(libraryFile(userData), { version: SUPPORTED_VERSIONS[LIBRARY_FILE] }));
}

/**
 * Whether the saved library asks for grayscale text. Read before the app is ready, when Chromium
 * still takes the switch, so it is a plain sync read that never sets a broken file aside.
 */
export function readGrayscaleText(userData: string): boolean {
  try {
    const saved: unknown = JSON.parse(readFileSync(libraryFile(userData), "utf8"));
    return (saved as { grayscaleText?: unknown } | null)?.grayscaleText === true;
  } catch {
    return false;
  }
}

/**
 * A file written by a newer Tavora (its `version` is above what this one
 * understands) is copied aside before this version can overwrite it, so
 * going back to an older Tavora never loses what the newer one saved.
 * Returns the copy's path, or null when nothing was needed. Missing and
 * unreadable files are left to the code that reads them.
 */
export async function keepNewerFile(file: string, supportedVersion: number): Promise<string | null> {
  let bytes: Buffer;
  let version: unknown;
  try {
    bytes = await readFile(file);
    version = (JSON.parse(bytes.toString("utf8")) as { version?: unknown } | null)?.version;
  } catch {
    return null;
  }
  if (typeof version !== "number" || !(version > supportedVersion)) return null;
  return keepNewerCopy(file, version, bytes);
}

/**
 * Reads and writes the data files in `userData`. Writes run one after another in the order they were
 * asked for, each with the data as it was then; a failed write is logged and the next one runs.
 * A file waits for at most one write: a newer save while one still waits takes its place, at the end of
 * the line, so a fast caller can't grow the queue and the order stays that of the newest saves.
 * Profile saves are the exception: each is written, as its caller learns whether it landed.
 */
export class SavedData {
  private saving: Promise<void> = Promise.resolve();
  /** Writes that haven't started, in the order they run, by file (or by profile save). */
  private readonly waiting = new Map<string, { write: () => Promise<void>; what: string }>();
  private draining = false;
  private profileSaves = 0;

  constructor(private readonly userData: string) {}

  /**
   * Copies aside every file in the data folder a newer Tavora wrote, before anything here (a move of old names
   * included) can overwrite it. One that can't be copied now is tried again by the store that reads it.
   */
  async keepNewerFiles(): Promise<void> {
    for (const [name, version] of Object.entries(SUPPORTED_VERSIONS)) {
      await keepNewerFile(path.join(this.userData, name), version).catch(() => null);
    }
  }

  loadLibrary(): Promise<Library> {
    return loadLibrary(this.userData);
  }

  /** The panels and layouts of the workspaces in the library (Trash included), with only panels of installed modules. */
  loadWorkspace(workspaceIds: readonly string[], isInstalled: (moduleId: string) => boolean): Promise<WorkspaceState> {
    return loadWorkspace(this.file(WORKSPACE_FILE), workspaceIds, isInstalled);
  }

  /**
   * The profile, and whether there was one. One without a usable id is set aside like an unreadable one, before a
   * new id is made: the id never changes, so the old one is kept.
   */
  async loadProfile(): Promise<{ profile: Profile; saved: boolean }> {
    const file = this.file(PROFILE_FILE);
    let saved = await readSavedFile(file, { version: SUPPORTED_VERSIONS[PROFILE_FILE] });
    if (saved !== null && !isProfileId(saved.id)) {
      await setAside(file, true);
      saved = null;
    }
    return { profile: sanitizeProfile(saved), saved: saved !== null };
  }

  loadWindow(): Promise<WindowState | null> {
    return readJsonOrSetAside<WindowState>(this.file(WINDOW_FILE));
  }

  saveLibrary(library: Library): void {
    const body = JSON.stringify(library, null, 2);
    this.enqueue(() => writeFileAtomic(this.file(LIBRARY_FILE), body), "library");
  }

  /** Queues the write like the others, and also tells the caller whether it landed. */
  saveProfile(profile: Profile): Promise<void> {
    const body = JSON.stringify(profile, null, 2);
    return new Promise((resolve, reject) => {
      const write = () => writeFileAtomic(this.file(PROFILE_FILE), body).then(resolve, (error: unknown) => {
        reject(error);
        throw error;
      });
      this.enqueue(write, "profile", `profile:${++this.profileSaves}`);
    });
  }

  /** Writes this workspace state as it is when the write runs: the caller hands over a copy it won't change (Workspaces.save makes one). */
  saveWorkspace(workspace: WorkspaceState): void {
    this.enqueue(() => saveWorkspace(this.file(WORKSPACE_FILE), workspace), "workspace");
  }

  saveWindow(state: WindowState): void {
    const body = JSON.stringify(state);
    this.enqueue(() => writeFileAtomic(this.file(WINDOW_FILE), body), "window");
  }

  /** Resolves once pending writes, each file's newest data included, are on disk. */
  flush(): Promise<void> {
    return this.saving;
  }

  private file(name: string): string {
    return path.join(this.userData, name);
  }

  private enqueue(write: () => Promise<void>, what: string, slot = what): void {
    // A write still waiting for this file is replaced, and the new one goes to the end of the line.
    this.waiting.delete(slot);
    this.waiting.set(slot, { write, what });
    if (this.draining) return;
    this.draining = true;
    this.saving = this.drain();
  }

  /** Runs the waiting writes one after another until none is left, including those that come in meanwhile. */
  private async drain(): Promise<void> {
    // Saves asked for in this same moment come in first, so a burst of them is one write per file.
    await Promise.resolve();
    try {
      for (let next = this.waiting.entries().next(); !next.done; next = this.waiting.entries().next()) {
        const [slot, { write, what }] = next.value;
        this.waiting.delete(slot);
        await write().catch((error: unknown) => console.error(`[tavora] could not save ${what}`, error));
      }
    } finally {
      this.draining = false;
    }
  }
}
