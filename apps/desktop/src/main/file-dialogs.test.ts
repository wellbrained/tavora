import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { translate, type Language } from "../shared/i18n";
import { HostError } from "./errors";
import { FileDialogs } from "./file-dialogs";
import type { Library } from "./library";
import { UserError } from "./messages";

/** File dialogs over a temp folder, with the system's dialogs answered by `answer` (a path, or null for closing it). */
async function setup(language: Language = "en") {
  const base = await mkdtemp(path.join(tmpdir(), "tavora-dialogs-"));
  const library: Pick<Library, "dialogFolders" | "moduleFolders"> = { dialogFolders: {}, moduleFolders: {} };
  const saveLibrary = vi.fn();
  const asked: { open: OpenDialogOptions[]; save: SaveDialogOptions[] } = { open: [], save: [] };
  let answer: string | null = null;
  const dialogs = new FileDialogs({
    dialogs: {
      open: async (options) => (asked.open.push(options), answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] }),
      save: async (options) => (asked.save.push(options), answer === null ? { canceled: true, filePath: "" } : { canceled: false, filePath: answer }),
    },
    library,
    saveLibrary,
    language: () => language,
    documents: () => path.join(base, "Documents", "Tavora"),
    pictures: () => path.join(base, "Pictures", "Tavora"),
  });
  return { base, library, saveLibrary, asked, dialogs, answer: (next: string | null) => (answer = next) };
}

describe("FileDialogs.pick", () => {
  it("opens where the user last picked from while that folder is there, and remembers only when told", async () => {
    const { base, library, saveLibrary, asked, dialogs, answer } = await setup();
    const zips = path.join(base, "zips");
    await mkdir(zips);
    answer(path.join(zips, "a.zip"));
    expect(await dialogs.pick("install-module", { properties: ["openFile"] })).toBe(path.join(zips, "a.zip"));
    expect(asked.open[0]).toEqual({ properties: ["openFile"] });
    expect(library.dialogFolders).toEqual({});

    dialogs.remember("install-module", path.join(zips, "a.zip"));
    expect(library.dialogFolders["install-module"]).toBe(zips);
    expect(saveLibrary).toHaveBeenCalledTimes(1);
    await dialogs.pick("install-module", {});
    expect(asked.open[1]).toEqual({ defaultPath: zips });

    // Gone (an unplugged drive): the system's dialog picks where it opens.
    library.dialogFolders["install-module"] = path.join(base, "gone");
    await dialogs.pick("install-module", {});
    expect(asked.open[2]).toEqual({});
  });

  it("answers nothing when the dialog was closed", async () => {
    const { dialogs } = await setup();
    expect(await dialogs.pick("cloud-copy", { properties: ["openDirectory"] })).toBeUndefined();
  });

  it("remembers a picked folder's parent", async () => {
    const { base, library, dialogs } = await setup();
    dialogs.remember("cloud-copy", path.join(base, "Sync", "Tavora"));
    expect(library.dialogFolders["cloud-copy"]).toBe(path.join(base, "Sync"));
  });
});

describe("FileDialogs.forModule", () => {
  it("saves a picture in Pictures\\Tavora at first, with a free name, and opens next time where it was saved", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    const pictures = path.join(base, "Pictures", "Tavora");
    await mkdir(pictures, { recursive: true });
    await writeFile(path.join(pictures, "Map.png"), "old");
    const files = dialogs.forModule("official:tavora.notes");
    answer(path.join(pictures, "Map (2)"));
    expect(await files.savePicture(Buffer.from("png"), "Map")).toBe("Map (2).png");
    expect(asked.save[0]).toMatchObject({
      title: "Save picture",
      defaultPath: path.join(pictures, "Map (2).png"),
      filters: [{ name: "PNG picture", extensions: ["png"] }],
      properties: ["showOverwriteConfirmation"],
    });
    expect(await readFile(path.join(pictures, "Map (2).png"), "utf8")).toBe("png");
    expect(library.dialogFolders["save-picture"]).toBe(pictures);
    // Pictures are one place for every module, never a module's file folder.
    expect(library.moduleFolders).toEqual({});
  });

  it("never replaces a file the dialog did not ask about", async () => {
    const { base, library, dialogs, answer } = await setup();
    const folder = path.join(base, "Documents", "Tavora");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "Build.json"), "mine");
    answer(path.join(folder, "Build"));
    const saving = dialogs.forModule("local:poe2").saveJson(Buffer.from("{}"), "Build");
    await expect(saving).rejects.toThrow(HostError);
    await expect(saving).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(path.join(folder, "Build.json"), "utf8")).toBe("mine");
    expect(library.moduleFolders).toEqual({});

    // Chosen with its extension, the dialog asked about it: it is replaced.
    answer(path.join(folder, "Build.JSON"));
    expect(await dialogs.forModule("local:poe2").saveJson(Buffer.from("{}"), "Build")).toBe("Build.JSON");
  });

  it("replaces a chosen file in one step, leaving no temp file", async () => {
    const { base, dialogs, answer } = await setup();
    const folder = path.join(base, "Documents", "Tavora");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "Build.json"), "old");
    answer(path.join(folder, "Build.json"));
    await dialogs.forModule("local:poe2").saveJson(Buffer.from('{"new":1}'), "Build");
    expect(await readFile(path.join(folder, "Build.json"), "utf8")).toBe('{"new":1}');
    expect((await readdir(folder)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps each module's folder apart, under its owner and id, and falls back to Documents\\Tavora when it is gone", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    const exports = path.join(base, "exports");
    await mkdir(exports);
    answer(path.join(exports, "list.csv"));
    expect(await dialogs.forModule("official:tavora.todos").saveFile(Buffer.from("a,b"), "list", "csv")).toBe("list.csv");
    expect(asked.save[0]).toMatchObject({ title: "Save file", filters: [{ name: "CSV files", extensions: ["csv"] }] });
    expect(library.moduleFolders).toEqual({ "official:tavora.todos": exports });

    answer(null);
    await dialogs.forModule("official:tavora.todos").openJson();
    expect(asked.open[0]?.defaultPath).toBe(exports);
    await dialogs.forModule("someone:tavora.todos").openJson();
    const documents = path.join(base, "Documents", "Tavora");
    expect(asked.open[1]?.defaultPath).toBe(documents);
    expect(existsSync(documents)).toBe(true);
  });

  it("opens JSON, remembering the folder once the file was read", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    await writeFile(path.join(base, "plan.json"), '{"a":1}');
    answer(path.join(base, "plan.json"));
    expect(await dialogs.forModule("local:plan").openJson()).toEqual({ fileName: "plan.json", text: '{"a":1}' });
    expect(asked.open[0]).toMatchObject({ title: "Open file", filters: [{ name: "JSON files", extensions: ["json"] }], properties: ["openFile"] });
    expect(library.moduleFolders["local:plan"]).toBe(base);

    answer(path.join(base, "missing.json"));
    await expect(dialogs.forModule("local:other").openJson()).rejects.toThrow();
    expect(library.moduleFolders["local:other"]).toBeUndefined();
  });

  it("opens only the kinds asked for, even when the user shows all files", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    await writeFile(path.join(base, "sheet.xlsx"), "xlsx");
    answer(path.join(base, "sheet.xlsx"));
    await expect(dialogs.forModule("local:t").openFile(["csv"])).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(asked.open[0]?.filters).toEqual([{ name: "CSV files", extensions: ["csv"] }]);
    expect(library.moduleFolders).toEqual({});
    const opened = await dialogs.forModule("local:t").openFile(["csv", "xlsx"]);
    expect(opened).toMatchObject({ fileName: "sheet.xlsx", kind: "xlsx" });
    expect(opened?.bytes.toString()).toBe("xlsx");
    expect(library.moduleFolders["local:t"]).toBe(base);
  });

  it("answers null and remembers nothing when the user closes the dialog", async () => {
    const { library, saveLibrary, dialogs } = await setup();
    const files = dialogs.forModule("local:t");
    expect(await files.savePicture(Buffer.from("png"), "Map")).toBeNull();
    expect(await files.saveJson(Buffer.from("{}"), "Map")).toBeNull();
    expect(await files.openJson()).toBeNull();
    expect(await files.saveFile(Buffer.from(""), "Map", "xlsx")).toBeNull();
    expect(await files.openFile(["csv"])).toBeNull();
    expect(library).toEqual({ dialogFolders: {}, moduleFolders: {} });
    expect(saveLibrary).not.toHaveBeenCalled();
  });

  it("speaks the user's language", async () => {
    const { dialogs, asked } = await setup("de");
    await dialogs.forModule("local:t").savePicture(Buffer.from("png"), "Map");
    await dialogs.forModule("local:t").saveFile(Buffer.from(""), "Map", "xlsx");
    await dialogs.forModule("local:t").openFile(["csv", "xlsx"]);
    expect(asked.save[0]).toMatchObject({ title: "Bild speichern", filters: [{ name: "PNG-Bild", extensions: ["png"] }] });
    expect(asked.save[1]).toMatchObject({ title: "Datei speichern", filters: [{ name: "Excel-Dateien", extensions: ["xlsx"] }] });
    expect(asked.open[0]).toMatchObject({ title: "Datei öffnen", filters: [{ name: "CSV-Dateien", extensions: ["csv"] }, { name: "Excel-Dateien", extensions: ["xlsx"] }] });
  });
});

describe("FileDialogs for Tavora's own files", () => {
  it("saves a module zip under a free name, and a taken name with the extension added is the user's to change", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    const documents = path.join(base, "Documents", "Tavora");
    answer(path.join(documents, "tavora.notes-1.0.0"));
    expect(await dialogs.saveOwn("module-zip", { kind: "zip", name: "tavora.notes-1.0.0", data: Buffer.from("zip") })).toBe("tavora.notes-1.0.0.zip");
    expect(asked.save[0]).toMatchObject({ title: "Save module as zip", defaultPath: path.join(documents, "tavora.notes-1.0.0.zip"), filters: [{ name: "Zip files", extensions: ["zip"] }] });
    expect(library.dialogFolders["module-zip"]).toBe(documents);

    await expect(dialogs.saveOwn("module-zip", { kind: "zip", name: "tavora.notes-1.0.0", data: Buffer.from("zip") })).rejects.toThrow(UserError);
    expect(asked.save[1]?.defaultPath).toBe(path.join(documents, "tavora.notes-1.0.0 (2).zip"));
  });

  it("saves a key file and answers nothing when the dialog was closed", async () => {
    const { base, dialogs, asked, answer } = await setup();
    answer(path.join(base, "publisher-key-abcd1234"));
    expect(await dialogs.saveOwn("publisher-key", { kind: "pem", name: "publisher-key-abcd1234", data: "PEM" })).toBe("publisher-key-abcd1234.pem");
    expect(asked.save[0]).toMatchObject({ title: "Save key file", filters: [{ name: "Key files", extensions: ["pem"] }] });
    expect(await readFile(path.join(base, "publisher-key-abcd1234.pem"), "utf8")).toBe("PEM");
    answer(null);
    expect(await dialogs.saveOwn("publisher-key", { kind: "pem", name: "k", data: "PEM" })).toBeUndefined();
  });

  it("opens a key file where the last one was, and remembers its folder only once it was used", async () => {
    const { base, library, asked, dialogs, answer } = await setup();
    const keys = path.join(base, "keys");
    answer(path.join(keys, "bad.pem"));
    await expect(dialogs.openKeyFile(async () => Promise.reject(new UserError("developerKeys.error.notKey")))).rejects.toThrow(UserError);
    expect(asked.open[0]).toMatchObject({
      title: "Open key file",
      defaultPath: path.join(base, "Documents", "Tavora"),
      properties: ["openFile"],
      filters: [
        { name: "Key files", extensions: ["pem", "key"] },
        { name: "*", extensions: ["*"] },
      ],
    });
    expect(library.dialogFolders["publisher-key"]).toBeUndefined();

    const used = vi.fn(async () => undefined);
    answer(path.join(keys, "good.pem"));
    await dialogs.openKeyFile(used);
    expect(used).toHaveBeenCalledWith(path.join(keys, "good.pem"));
    expect(library.dialogFolders["publisher-key"]).toBe(keys);

    answer(null);
    await dialogs.openKeyFile(used);
    expect(used).toHaveBeenCalledTimes(1);
  });
});

describe("a module's pickers (files.pickReadOnly, folders.choose)", () => {
  /** File dialogs whose open dialog answers `paths` (null: closed), noting what it was asked. */
  function pickers(language: Language, paths: string[] | null) {
    const asked: OpenDialogOptions[] = [];
    const dialogs = new FileDialogs({
      dialogs: {
        open: async (options) => (asked.push(options), paths === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: paths }),
        save: async () => ({ canceled: true, filePath: "" }),
      },
      library: { dialogFolders: {}, moduleFolders: {} },
      saveLibrary: () => undefined,
      language: () => language,
      documents: () => "/nowhere",
      pictures: () => "/nowhere",
    });
    return { dialogs, asked };
  }

  it("links files with a dialog named for the module, where it was told to start, one file unless several are asked for", async () => {
    const one = pickers("en", ["/saves/a.sav", "/saves/b.sav"]);
    expect(await one.dialogs.pickReadOnly("Planner", { extensions: ["sav"], multiple: false, start: "/saves" })).toEqual(["/saves/a.sav"]);
    expect(one.asked).toEqual([{ defaultPath: "/saves", title: "Link a file to Planner", buttonLabel: "Link file", properties: ["openFile"], filters: [{ name: "Choose a file", extensions: ["sav"] }] }]);

    const several = pickers("de", ["/saves/a.sav", "/saves/b.sav"]);
    expect(await several.dialogs.pickReadOnly("Planer", { extensions: ["sav", "json"], multiple: true })).toEqual(["/saves/a.sav", "/saves/b.sav"]);
    expect(several.asked).toEqual([{ title: "Datei mit Planer verknüpfen", buttonLabel: "Datei verknüpfen", properties: ["openFile", "multiSelections"], filters: [{ name: "Datei auswählen", extensions: ["sav", "json"] }] }]);

    expect(await pickers("en", null).dialogs.pickReadOnly("Planner", { extensions: ["sav"], multiple: true })).toEqual([]);
  });

  it("chooses a module's folder with a dialog that names the module and the folder, starting where it was told", async () => {
    const { dialogs, asked } = pickers("en", ["/home/me/Documents/My Game"]);
    expect(await dialogs.pickFolder("Planner", "Documents/My Game", "/home/me/Documents")).toBe("/home/me/Documents/My Game");
    expect(await dialogs.pickFolder("Planner", "Documents/My Game", undefined)).toBe("/home/me/Documents/My Game");
    const title = translate("en", "dialog.chooseFolder", { name: "Planner", folder: ["Documents", "My Game"].join(path.sep) });
    expect(asked).toEqual([
      { defaultPath: "/home/me/Documents", title, properties: ["openDirectory"] },
      { title, properties: ["openDirectory"] },
    ]);
    expect(await pickers("en", null).dialogs.pickFolder("Planner", "Documents/My Game", undefined)).toBeUndefined();
  });
});
