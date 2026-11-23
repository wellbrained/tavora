import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from "electron";
import type { FileKind } from "@tavora/sdk/protocol";
import { translate, type Language } from "../shared/i18n";
import { HostError } from "./errors";
import { readJsonText } from "./json-file-http";
import type { DialogPlace, Library } from "./library";
import { UserError } from "./messages";
import { freeFileName } from "./picture-save-http";
import { kindOfName, readTableFile } from "./table-file-http";

/**
 * The system's file dialogs, opening where the user last picked from (file-dialogs.ts). Every one opens in a folder
 * Tavora remembers while that folder is still there, else in Documents\Tavora (Pictures\Tavora for pictures), and
 * remembers the folder of what was picked in the library.
 *
 * The save dialogs suggest a free name, add the extension when the user left it out and never replace a file the
 * dialog did not ask about (CLAUDE.md "Save as image", "Save and open files").
 */

/** The system's dialogs, as Electron's `dialog` gives them for Tavora's window. */
export interface SystemDialogs {
  open(options: OpenDialogOptions): Promise<Pick<OpenDialogReturnValue, "canceled" | "filePaths">>;
  save(options: SaveDialogOptions): Promise<Pick<SaveDialogReturnValue, "canceled" | "filePath">>;
}

export interface FileDialogsOptions {
  dialogs: SystemDialogs;
  /** Where the folders are remembered; saved with `saveLibrary` after each change. */
  library: Pick<Library, "dialogFolders" | "moduleFolders">;
  saveLibrary: () => void;
  language: () => Language;
  /** Documents\Tavora and Pictures\Tavora; made when a dialog first opens there. */
  documents: () => string;
  pictures: () => string;
}

/** What a module's panel saves and opens through (pictures.save, files.saveJson / openJson / save / open). */
export interface ModuleFileDialogs {
  /** Answers with the name the picture was saved under, or null when the user closed the dialog. */
  savePicture(png: Buffer, name: string): Promise<string | null>;
  saveJson(data: Buffer, name: string): Promise<string | null>;
  /** The chosen file's name and text (at most 8 MiB), or null when the user closed the dialog. */
  openJson(): Promise<{ fileName: string; text: string } | null>;
  /** A .csv or .xlsx; only that extension can be chosen. The data was checked already. */
  saveFile(data: Buffer, name: string, kind: FileKind): Promise<string | null>;
  /** Offers only `kinds`; a file of another kind picked through "all files" is refused. */
  openFile(kinds: FileKind[]): Promise<{ fileName: string; kind: FileKind; bytes: Buffer } | null>;
}

/** What a module's panel links files through (files.pickReadOnly), once its gate let the call through (panel-session.ts). */
export interface LinkFileRequest {
  extensions: string[];
  multiple: boolean;
  /** Where the dialog opens: next to a linked file, or where the game keeps its files; left out, the system's choice. */
  start?: string;
}

/** Every dialog a module's panel opens: the saves and opens of ModuleFileDialogs, and linking files (FileDialogs.pickReadOnly). */
export interface PanelFileDialogs extends ModuleFileDialogs {
  /** The chosen paths (one unless `multiple`), empty when the user closed the dialog. */
  pickReadOnly(request: LinkFileRequest): Promise<string[]>;
}

type SaveKind = "png" | "json" | FileKind | "zip" | "pem";

/** Each save dialog's words, and who asked: a module's page hears a conflict as a HostError, the host UI as a UserError. */
const SAVES: Record<SaveKind, { title: [string, string]; filter: [string, string]; ownFile: boolean; mode?: number }> = {
  png: { title: ["Save picture", "Bild speichern"], filter: ["PNG picture", "PNG-Bild"], ownFile: false },
  json: { title: ["Save file", "Datei speichern"], filter: ["JSON files", "JSON-Dateien"], ownFile: false },
  csv: { title: ["Save file", "Datei speichern"], filter: ["CSV files", "CSV-Dateien"], ownFile: false },
  xlsx: { title: ["Save file", "Datei speichern"], filter: ["Excel files", "Excel-Dateien"], ownFile: false },
  zip: { title: ["Save module as zip", "Modul als ZIP speichern"], filter: ["Zip files", "ZIP-Dateien"], ownFile: true },
  // A key file is readable by the user only.
  pem: { title: ["Save key file", "Schlüsseldatei speichern"], filter: ["Key files", "Schlüsseldateien"], ownFile: true, mode: 0o600 },
};

/** A remembered folder: one of Tavora's own dialogs, or a module's file dialogs (kept under owner:id). */
type Memory = { place: DialogPlace } | { module: string };

export class FileDialogs {
  constructor(private readonly options: FileDialogsOptions) {}

  /**
   * The system's open dialog, opening in the folder the user last picked from in this `place` while that folder is
   * still there. Answers with what was picked, or nothing when cancelled; the caller remembers it (`remember`) only
   * once it worked, so a zip that failed to install is not where it opens next.
   */
  async pick(place: DialogPlace, options: OpenDialogOptions): Promise<string | undefined> {
    const folder = this.options.library.dialogFolders[place];
    const picked = await this.options.dialogs.open({ ...options, ...(folder && existsSync(folder) ? { defaultPath: folder } : {}) });
    const file = picked.filePaths[0];
    return picked.canceled || !file ? undefined : file;
  }

  /** The dialog for `place` opens next time in the folder `picked` is in (for a picked folder, its parent), and the library is saved. */
  remember(place: DialogPlace, picked: string): void {
    this.rememberIn({ place }, picked);
  }

  /** Saves one of Tavora's own files (a module zip, a key file). Answers with its name, or nothing when the user closed the dialog. */
  async saveOwn(place: "module-zip" | "publisher-key", file: { kind: "zip" | "pem"; name: string; data: Buffer | string }): Promise<string | undefined> {
    return (await this.save({ place }, file.kind, file.name, file.data)) ?? undefined;
  }

  /**
   * Opens a key file from where the user last picked one: `use` gets the picked file, and the folder is remembered
   * once it worked. Nothing happens when the user closed the dialog.
   */
  async openKeyFile(use: (file: string) => Promise<void>): Promise<void> {
    const german = this.german();
    const picked = await this.options.dialogs.open({
      title: german ? "Schlüsseldatei öffnen" : "Open key file",
      defaultPath: await this.folderOf({ place: "publisher-key" }),
      properties: ["openFile"],
      filters: [
        { name: german ? "Schlüsseldateien" : "Key files", extensions: ["pem", "key"] },
        { name: "*", extensions: ["*"] },
      ],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return;
    await use(file);
    this.remember("publisher-key", file);
  }

  /** The dialogs of one module's panels, its folder kept under `key` (owner:id, so another publisher's module with the same id starts fresh). */
  forModule(key: string): ModuleFileDialogs {
    const memory: Memory = { module: key };
    return {
      // Pictures are kept in one place for every module.
      savePicture: (png, name) => this.save({ place: "save-picture" }, "png", name, png),
      saveJson: (data, name) => this.save(memory, "json", name, data),
      openJson: async () => {
        const file = await this.openIn(memory, [{ name: this.german() ? "JSON-Dateien" : "JSON files", extensions: ["json"] }]);
        if (!file) return null;
        const text = await readJsonText(file);
        this.rememberIn(memory, file);
        return { fileName: path.basename(file), text };
      },
      saveFile: (data, name, kind) => this.save(memory, kind, name, data),
      openFile: async (kinds) => {
        const file = await this.openIn(
          memory,
          kinds.map((kind) => ({ name: this.label(kind), extensions: [kind] })),
        );
        if (!file) return null;
        // The dialog's filter can be set to all files by the user; only these extensions go on.
        const kind = kindOfName(file);
        if (!kind || !kinds.includes(kind)) throw new HostError("INVALID_PARAMS", "only a .csv or .xlsx file can be opened");
        const bytes = await readTableFile(file);
        this.rememberIn(memory, file);
        return { fileName: path.basename(file), kind, bytes };
      },
    };
  }

  /**
   * The open dialog that links files to a module (files.pickReadOnly), named for the module: the chosen paths (one
   * unless `multiple`), empty when the user closed it. Nothing is remembered here: the panel's session keeps the links.
   */
  async pickReadOnly(name: string, request: LinkFileRequest): Promise<string[]> {
    const german = this.german();
    const picked = await this.options.dialogs.open({
      ...(request.start ? { defaultPath: request.start } : {}),
      title: german ? `Datei mit ${name} verknüpfen` : `Link a file to ${name}`,
      buttonLabel: german ? "Datei verknüpfen" : "Link file",
      properties: request.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: [{ name: german ? "Datei auswählen" : "Choose a file", extensions: request.extensions }],
    });
    return picked.canceled ? [] : request.multiple ? picked.filePaths : picked.filePaths.slice(0, 1);
  }

  /**
   * The folder dialog for one of a module's folders (folders.choose; `folder` as permissions.folders names it, such as
   * Documents/My Game), starting in `start`: the chosen folder, or undefined when the user closed it.
   */
  async pickFolder(name: string, folder: string, start: string | undefined): Promise<string | undefined> {
    const picked = await this.options.dialogs.open({
      ...(start ? { defaultPath: start } : {}),
      title: translate(this.options.language(), "dialog.chooseFolder", { name, folder: folder.split("/").join(path.sep) }),
      properties: ["openDirectory"],
    });
    return picked.canceled ? undefined : picked.filePaths[0];
  }

  private german(): boolean {
    return this.options.language().startsWith("de");
  }

  private label(kind: SaveKind): string {
    return SAVES[kind].filter[this.german() ? 1 : 0];
  }

  /** Where a dialog opens: the remembered folder while it is still there, else Pictures\Tavora for pictures and Documents\Tavora for the rest (made when needed). */
  private async folderOf(memory: Memory): Promise<string> {
    const last = "place" in memory ? this.options.library.dialogFolders[memory.place] : this.options.library.moduleFolders[memory.module];
    const folder = last && existsSync(last) ? last : "place" in memory && memory.place === "save-picture" ? this.options.pictures() : this.options.documents();
    await mkdir(folder, { recursive: true });
    return folder;
  }

  private rememberIn(memory: Memory, picked: string): void {
    const folder = path.dirname(path.resolve(picked));
    if ("place" in memory) this.options.library.dialogFolders[memory.place] = folder;
    else this.options.library.moduleFolders[memory.module] = folder;
    this.options.saveLibrary();
  }

  /** The save dialog with `name` suggested (numbered when taken). Answers with the name the file was saved under, or null when the user closed the dialog. */
  private async save(memory: Memory, kind: SaveKind, name: string, data: Buffer | string): Promise<string | null> {
    const folder = await this.folderOf(memory);
    const words = SAVES[kind];
    const picked = await this.options.dialogs.save({
      title: words.title[this.german() ? 1 : 0],
      defaultPath: path.join(folder, freeFileName(name, (fileName) => existsSync(path.join(folder, fileName)), kind)),
      filters: [{ name: this.label(kind), extensions: [kind] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (picked.canceled || !picked.filePath) return null;
    const chosen = path.resolve(picked.filePath);
    const file = chosen.toLowerCase().endsWith(`.${kind}`) ? chosen : `${chosen}.${kind}`;
    // The dialog asked before replacing the file the user chose; with the extension added, it was never asked about.
    try {
      await writeFile(file, data, { flag: file === chosen ? "w" : "wx", ...(words.mode === undefined ? {} : { mode: words.mode }) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (words.ownFile) throw new UserError("error.file.taken", { name: path.basename(file) });
      throw new HostError("CONFLICT", `${path.basename(file)} already exists`);
    }
    this.rememberIn(memory, file);
    return path.basename(file);
  }

  /** The open dialog for a module's file in its folder; the folder is remembered by the caller once the file was read. */
  private async openIn(memory: Memory, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    const folder = await this.folderOf(memory);
    const picked = await this.options.dialogs.open({ title: this.german() ? "Datei öffnen" : "Open file", defaultPath: folder, filters, properties: ["openFile"] });
    const file = picked.filePaths[0];
    return picked.canceled || !file ? null : file;
  }
}
