import { mkdir } from "node:fs/promises";
import { translate, type Language } from "../shared/i18n";
import type { FileDialogs } from "./file-dialogs";
import { LibraryError } from "./library";
import type { ModuleProblem } from "./registry";

export interface ModulesFolderOptions {
  /** The user's own modules folder, in their data folder. */
  dir: string;
  dialogs: Pick<FileDialogs, "pick" | "remember">;
  language: () => Language;
  /** Installs a module from a zip; answers with its id (module-lifecycle.ts). */
  installFile: (file: string) => Promise<string>;
  /** Opens a folder in the file manager; answers with what went wrong, or "" (Electron's shell). */
  openPath: (dir: string) => Promise<string>;
  /** The module folders that don't load now. */
  problems: () => readonly ModuleProblem[];
}

/**
 * The modules folder as Settings > Modules offers it: installing a module from a zip the user picks, opening the
 * folder, and opening a folder Settings lists as not loading. Only those folders open, so the host UI can't open any path.
 */
export class ModulesFolder {
  constructor(private readonly options: ModulesFolderOptions) {}

  /** Installs a module from a zip the user picks. Answers with the module's id, or nothing when the dialog is closed. */
  async installZip(): Promise<string | void> {
    const { dialogs } = this.options;
    const language = this.options.language();
    const file = await dialogs.pick("install-module", {
      title: translate(language, "dialog.installModule"),
      properties: ["openFile"],
      filters: [{ name: translate(language, "dialog.moduleZip"), extensions: ["zip"] }],
    });
    if (!file) return;
    const id = await this.options.installFile(file);
    dialogs.remember("install-module", file);
    return id;
  }

  /** Opens the modules folder, made first when it isn't there yet. */
  async open(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    const error = await this.options.openPath(this.options.dir);
    if (error) throw new LibraryError("error.openModulesFolder", { problem: error });
  }

  /** Opens a module folder Settings lists as not loading (not a development folder's); any other path is ignored. */
  async openProblem(dir: string): Promise<void> {
    if (!this.options.problems().some((problem) => !problem.developmentFolder && problem.path === dir)) return;
    const error = await this.options.openPath(dir);
    if (error) throw new LibraryError("error.openFolder", { problem: error });
  }
}
