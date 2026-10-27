import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { BlobStore } from "./blobs";
import { copyStoredFiles, defaultFilesRoot, FILES_FOLDER_NAME, filesTarget, listStoredFiles, removeStoredFiles } from "./module-files";

const ID = (letter: string) => letter.repeat(32);
let base: string;
let userData: string;
let root: string;

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
    await put(root, path.join("official", "tavora.notes"), "poe2", "notes.txt", "not ours");
    await put(root, path.join("official", "tavora.notes"), "poe2", `${ID("c")}.tmp`, "half");
    await put(root, path.join("local", "Not A Module!"), "poe2", `${ID("d")}.png`, "wrong folder");
    await put(root, path.join("someone", "tavora.notes"), "poe2", `${ID("e")}.png`, "not an owner");
    const files = await listStoredFiles(root);
    expect(files.map((file) => file.name).sort()).toEqual([`${ID("a")}.png`, `${ID("b")}.webp`]);
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
