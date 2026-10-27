// The folder where modules keep their pictures, as the host manages it: where it is, whether it is
// there, choosing another place and moving everything over. The copying itself is in module-files.ts.

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { shell, type OpenDialogOptions } from "electron";
import type { Language } from "../shared/i18n";
import { translate } from "../shared/i18n";
import { LibraryError } from "./library";
import { copyStoredFiles, defaultFilesRoot, filesTarget, listStoredFiles, removeStoredFiles } from "./module-files";

/** What the folder needs from the host around it. */
export interface ModuleFilesFolderHost {
  userData: string;
  /** Where the pictures go unless the player chose another folder: Pictures\Tavora. */
  defaultFolder: string;
  language(): Language;
  /** The folder the player chose, or null for the default one. */
  chosenFolder(): string | null;
  /** Remembers the chosen folder (null for the default) and saves the library. */
  setChosenFolder(folder: string | null): void;
  /** The system's open dialog, in the folder last picked from; what was picked, or nothing when cancelled. */
  pick(options: OpenDialogOptions): Promise<string | undefined>;
  /** Opens the dialog next to `picked` from now on. */
  remember(picked: string): void;
  /** Shows the player a message. */
  notify(message: string): void;
  /** Tells the host UI that something here changed. */
  changed(): void;
}

export class ModuleFilesFolder {
  /** The pictures are being copied to another folder. */
  moving = false;
  /** The folder was there when last looked at. */
  available = true;

  constructor(private readonly host: ModuleFilesFolderHost) {}

  /** Where modules keep their pictures: the folder the player chose, or the default one. */
  root(): string {
    return this.host.chosenFolder() ?? this.host.defaultFolder;
  }

  get custom(): boolean {
    return this.host.chosenFolder() !== null;
  }

  /** Whether the folder is there; the default one appears with the first picture, so only a chosen one can be missing. */
  private async isThere(): Promise<boolean> {
    return !this.custom || (await stat(this.root()).then((info) => info.isDirectory(), () => false));
  }

  /** Looks whether the folder is there, and tells the player when a folder they chose is gone. */
  async check(): Promise<void> {
    this.available = await this.isThere();
    if (!this.available) this.host.notify(translate(this.host.language(), "notice.moduleFilesMissing", { folder: this.root() }));
    this.host.changed();
  }

  /** The player picks a place in the system dialog. */
  async change(): Promise<void> {
    const folder = await this.host.pick({
      title: translate(this.host.language(), "dialog.chooseModuleFiles"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (!folder) return;
    const target = await filesTarget(folder, this.root(), this.host.userData, this.host.defaultFolder);
    if ("problem" in target) {
      const key = { same: "error.moduleFilesSame", nested: "error.moduleFilesNested", "inside-data": "error.moduleFilesInsideData", "not-writable": "error.moduleFilesNotWritable" } as const;
      throw new LibraryError(key[target.problem]);
    }
    await this.move(target.root);
    this.host.remember(folder);
  }

  /** Back to the default folder. */
  reset(): Promise<void> {
    return this.move(this.host.defaultFolder);
  }

  /**
   * Pictures still in the old default folder, inside the app's data, move to the default folder. Runs at start
   * before any module opens. If copying fails, the old folder stays in use as if the player had chosen it.
   */
  async moveFromOldDefault(log: (line: string) => void): Promise<void> {
    const old = defaultFilesRoot(this.host.userData);
    if (this.custom || path.resolve(old) === path.resolve(this.host.defaultFolder)) return;
    const files = await listStoredFiles(old);
    if (!files.length) return;
    try {
      await copyStoredFiles(old, this.host.defaultFolder, files);
    } catch (error) {
      log(`pictures stay in ${old}: ${error instanceof Error ? error.message : String(error)}`);
      this.host.setChosenFolder(path.resolve(old));
      return;
    }
    await removeStoredFiles(old, files);
    log(`${files.length} pictures moved to ${this.host.defaultFolder}`);
  }

  /**
   * Copies every picture to `target`, checks the copies, switches to the new folder, and only then removes the old
   * files. If anything fails the old folder and the setting stay as they were. New pictures wait while it runs.
   */
  private async move(target: string): Promise<void> {
    if (this.moving) throw new LibraryError("error.moduleFilesBusy");
    const from = this.root();
    if (path.resolve(from) === path.resolve(target)) return;
    this.moving = true;
    this.host.changed();
    try {
      const files = await listStoredFiles(from);
      try {
        await copyStoredFiles(from, target, files);
      } catch (error) {
        throw new LibraryError("error.moduleFilesFailed", { problem: error instanceof Error ? error.message : String(error) });
      }
      this.host.setChosenFolder(path.resolve(target) === path.resolve(this.host.defaultFolder) ? null : path.resolve(target));
      this.available = true;
      this.host.notify(translate(this.host.language(), "notice.moduleFilesMoved", { count: files.length, folder: target }));
      await removeStoredFiles(from, files);
    } finally {
      this.moving = false;
      this.host.changed();
    }
  }

  /** Opens the folder in the system's file manager. */
  async open(): Promise<void> {
    const root = this.root();
    if (!this.custom) await mkdir(root, { recursive: true });
    const error = await shell.openPath(root);
    if (error) throw new LibraryError("error.openModuleFiles", { problem: error });
  }

  /** Called with a workspace that is being deleted: tells the player where its pictures may remain when the folder they chose is gone. */
  async noteWorkspaceDeleted(workspaceName: string, deleteFiles: (root: string) => Promise<void>): Promise<void> {
    const root = this.root();
    const gone = !(await this.isThere());
    await deleteFiles(root);
    if (gone) this.host.notify(translate(this.host.language(), "notice.moduleFilesLeft", { name: workspaceName, folder: root }));
  }
}
