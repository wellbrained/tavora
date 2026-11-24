import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BlobStore } from "./blobs";
import { copyStoredFiles, defaultFilesRoot, FILES_FOLDER_NAME, filesTarget, listStoredFiles, removeStoredFiles } from "./module-files";

const ID = (letter: string) => letter.repeat(32);
let base: string;
let userData: string;
let root: string;
/** A folder link: a junction on Windows (no rights needed, and what a user would make there), a symlink elsewhere. */
const link = (to: string, at: string) => symlink(to, at, process.platform === "win32" ? "junction" : "dir");

async function put(rootDir: string, module: string, game: string, name: string, text: string) {
  const file = path.join(rootDir, module, game, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "tavora-files-move-"));
  userData = path.join(base, "userData");
  root = defaultFilesRoot(userData);
  await mkdir(userData, { recursive: true });
});

describe("filesTarget", () => {
  it("puts the files in a folder of their own inside the place the user picked", async () => {
    const picked = path.join(base, "D-drive");
    await mkdir(picked);
    const target = await filesTarget(picked, root, userData);
    expect(target).toEqual({ root: path.join(picked, FILES_FOLDER_NAME) });
    expect((await stat(path.join(picked, FILES_FOLDER_NAME))).isDirectory()).toBe(true);
  });

  it("uses the folder itself when the user picks one that already has that name", async () => {
    const picked = path.join(base, FILES_FOLDER_NAME);
    await mkdir(picked);
    expect(await filesTarget(picked, root, userData)).toEqual({ root: picked });
  });

  it("refuses the folder it is already in, and folders inside it or around it", async () => {
    await mkdir(root, { recursive: true });
    expect(await filesTarget(path.dirname(root), root, userData)).toEqual({ problem: "inside-data" });
    expect(await filesTarget(root, root, userData)).toEqual({ problem: "nested" });
    const custom = path.join(base, "elsewhere", FILES_FOLDER_NAME);
    await mkdir(custom, { recursive: true });
    expect(await filesTarget(custom, custom, userData)).toEqual({ problem: "same" });
    expect(await filesTarget(path.join(custom, "sub"), custom, userData)).toEqual({ problem: "nested" });
    expect(await filesTarget(path.dirname(custom), custom, userData)).toEqual({ problem: "same" });
  });

  it("refuses a folder inside the one in use even when its name starts with two dots", async () => {
    const custom = path.join(base, "elsewhere", FILES_FOLDER_NAME);
    await mkdir(path.join(custom, "..notes"), { recursive: true });
    expect(await filesTarget(path.join(custom, "..notes"), custom, userData)).toEqual({ problem: "nested" });
  });

  it("refuses a link onto the folder in use, above it or into it, like the folder itself", async () => {
    const custom = path.join(base, "elsewhere", FILES_FOLDER_NAME);
    await mkdir(path.join(custom, "official"), { recursive: true });
    // Named like the files folder, so it is used as it is: it is the folder in use.
    await mkdir(path.join(base, "other"));
    await link(custom, path.join(base, "other", FILES_FOLDER_NAME));
    expect(await filesTarget(path.join(base, "other", FILES_FOLDER_NAME), custom, userData)).toEqual({ problem: "same" });
    // Onto the folder above: the files folder in it is the one in use.
    await link(path.dirname(custom), path.join(base, "up"));
    expect(await filesTarget(path.join(base, "up"), custom, userData)).toEqual({ problem: "same" });
    // Into the folder in use.
    await link(path.join(custom, "official"), path.join(base, "inner"));
    expect(await filesTarget(path.join(base, "inner"), custom, userData)).toEqual({ problem: "nested" });
    expect(await readdir(path.join(custom, "official"))).toEqual([]);
  });

  it("refuses a link into Tavora's own data folder", async () => {
    await mkdir(path.join(userData, "module-data"), { recursive: true });
    await link(path.join(userData, "module-data"), path.join(base, "data-link"));
    expect(await filesTarget(path.join(base, "data-link"), path.join(base, "elsewhere", FILES_FOLDER_NAME), userData)).toEqual({ problem: "inside-data" });
  });

  it("refuses places inside Tavora's own data folder", async () => {
    const inData = path.join(userData, "module-data");
    await mkdir(inData, { recursive: true });
    expect(await filesTarget(inData, path.join(base, "elsewhere", FILES_FOLDER_NAME), userData)).toEqual({ problem: "inside-data" });
  });
});

describe("moving the files", () => {
  it("lists only the pictures the host stores", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("b")}.webp`, "two");
    await put(root, path.join("official", "tavora.notes"), "_app", `${ID("f")}.ogg`, "every workspace");
    await put(root, path.join("official", "tavora.notes"), "_other", `${ID("9")}.ogg`, "not a workspace");
    await put(root, path.join("official", "tavora.notes"), "poe2", "notes.txt", "not ours");
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("c")}.tmp`, "half");
    await put(root, path.join("local", "Not A Module!"), "poe2", `${ID("d")}.png`, "wrong folder");
    await put(root, path.join("someone", "tavora.notes"), "poe2", `${ID("e")}.png`, "not an owner");
    const files = await listStoredFiles(root);
    expect(files.map((file) => file.name).sort()).toEqual([`${ID("a")}.png`, `${ID("b")}.webp`, `${ID("f")}.ogg`].sort());
    expect(await listStoredFiles(path.join(base, "missing"))).toEqual([]);
  });

  it("copies every file, checks the copies, and keeps the old ones until they are removed", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    await put(root, path.join("official", "tavora.notes"), "satisfactory", `${ID("b")}.jpg`, "two!");
    const to = path.join(base, "new", FILES_FOLDER_NAME);
    const files = await listStoredFiles(root);
    await copyStoredFiles(root, to, files);
    expect(await readFile(path.join(to, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`), "utf8")).toBe("one");
    expect(await readFile(path.join(to, path.join("official", "tavora.notes"), "satisfactory", `${ID("b")}.jpg`), "utf8")).toBe("two!");
    expect(await readFile(path.join(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`), "utf8")).toBe("one");
    expect(await listStoredFiles(to)).toHaveLength(2);

    await removeStoredFiles(root, files);
    expect(await readdir(root)).toEqual([]);
  });

  it("can be run again after being cut off, and leaves no half copies", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("b")}.png`, "two");
    const to = path.join(base, "new");
    const files = await listStoredFiles(root);
    await copyStoredFiles(root, to, files.slice(0, 1));
    await put(to, path.join("official", "tavora.notes"), "poe2", `${files[1]!.name}.part`, "cut off");
    await copyStoredFiles(root, to, files);
    expect(await listStoredFiles(to)).toHaveLength(2);
  });

  it("refuses to copy through a link in the new folder that leads back into the old one", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    const to = path.join(base, "new", FILES_FOLDER_NAME);
    await mkdir(path.join(to, "official"), { recursive: true });
    await link(path.join(root, "official", "tavora.notes"), path.join(to, "official", "tavora.notes"));
    const files = await listStoredFiles(root);
    await expect(copyStoredFiles(root, to, files)).rejects.toThrow(/leads back/);
    expect(await readFile(path.join(root, "official", "tavora.notes", "poe2", `${ID("a")}.png`), "utf8")).toBe("one");
  });

  it("refuses a link to a single file in the new folder, which would be the original", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    const original = path.join(root, "official", "tavora.notes", "poe2", `${ID("a")}.png`);
    const to = path.join(base, "new", FILES_FOLDER_NAME);
    const linked = path.join(to, "official", "tavora.notes", "poe2", `${ID("a")}.png`);
    await mkdir(path.dirname(linked), { recursive: true });
    // A file symlink needs Developer Mode or admin rights on Windows; without them nobody could plant one either.
    if (!(await symlink(original, linked, "file").then(() => true, () => false))) return;
    const files = await listStoredFiles(root);
    await expect(copyStoredFiles(root, to, files)).rejects.toThrow(/no plain file/);
    expect(await readFile(original, "utf8")).toBe("one");
  });

  it("replaces a .part left in the new folder instead of writing through it", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    const elsewhere = path.join(base, "elsewhere.txt");
    await writeFile(elsewhere, "keep");
    const to = path.join(base, "new", FILES_FOLDER_NAME);
    const part = path.join(to, "official", "tavora.notes", "poe2", `${ID("a")}.png.part`);
    await mkdir(path.dirname(part), { recursive: true });
    if (!(await symlink(elsewhere, part, "file").then(() => true, () => false))) return;
    await copyStoredFiles(root, to, await listStoredFiles(root));
    expect(await readFile(path.join(to, "official", "tavora.notes", "poe2", `${ID("a")}.png`), "utf8")).toBe("one");
    expect(await readFile(elsewhere, "utf8")).toBe("keep");
  });

  it("stops with an error when a file cannot be copied, leaving the old files alone", async () => {
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("a")}.png`, "one");
    const files = await listStoredFiles(root);
    await expect(copyStoredFiles(path.join(base, "gone"), path.join(base, "new"), files)).rejects.toThrow();
    expect(await listStoredFiles(root)).toHaveLength(1);
  });
});

describe("a store while its files are being moved", () => {
  it("takes nothing new, and works again afterwards", async () => {
    let moving = true;
    const store = new BlobStore(() => path.join(root, path.join("official", "tavora.notes"), "poe2"), undefined, () => moving);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    async function* body() {
      yield png;
    }
    await expect(store.put(body())).rejects.toMatchObject({ code: "INTERNAL" });
    moving = false;
    await expect(store.put(body())).resolves.toMatchObject({ type: "image/png" });
  });
});
