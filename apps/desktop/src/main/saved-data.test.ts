import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary } from "./library";
import { DATA_FILES, keepNewerFile, readGrayscaleText, SavedData, WINDOW_FILE } from "./saved-data";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-saved-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (relative: string, text: string) => {
  const file = path.join(dir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};
const read = (relative: string) => readFile(path.join(dir, relative), "utf8");
const list = () => readdir(dir).then((names) => names.sort());

describe("SavedData", () => {
  it("writes the library as it was when asked, in order", async () => {
    const saved = new SavedData(dir);
    const library = emptyLibrary();
    library.onlineSearch = true;
    saved.saveLibrary(library);
    library.onlineSearch = false;
    await saved.flush();
    expect(JSON.parse(await read("library.json")).onlineSearch).toBe(true);
    saved.saveLibrary(library);
    await saved.flush();
    expect(JSON.parse(await read("library.json")).onlineSearch).toBe(false);
    expect((await saved.loadLibrary()).onlineSearch).toBe(false);
  });

  it("says whether there was a profile, and keeps going after a failed write", async () => {
    // The failed write is reported to the log on purpose; keep it out of the test output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved = new SavedData(dir);
    const first = await saved.loadProfile();
    expect(first.saved).toBe(false);
    await mkdir(path.join(dir, "profile.json"));
    await expect(saved.saveProfile(first.profile)).rejects.toThrow();
    saved.saveWindow({ bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: false });
    await saved.flush();
    expect(JSON.parse(await read(WINDOW_FILE)).bounds.width).toBe(800);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not save profile"), expect.any(Error));
    logged.mockRestore();
    await rm(path.join(dir, "profile.json"), { recursive: true });
    await saved.saveProfile(first.profile);
    expect((await saved.loadProfile()).saved).toBe(true);
  });

  it("copies aside every data file a newer Tavora wrote", async () => {
    await write("library.json", '{"version":99}');
    await write("grants.json", '{"version":99}');
    await write("workspace.json", '{"version":2}');
    await new SavedData(dir).keepNewerFiles();
    expect(await list()).toEqual(["grants.json", "grants.json.from-version-99", "library.json", "library.json.from-version-99", "workspace.json"]);
  });

  it("keeps the window out of the user's own data", () => {
    expect(DATA_FILES).not.toContain(WINDOW_FILE);
  });
});

describe("readGrayscaleText", () => {
  it("reads the setting, and gives false for a missing or broken library", async () => {
    expect(readGrayscaleText(dir)).toBe(false);
    await write("library.json", "not json");
    expect(readGrayscaleText(dir)).toBe(false);
    await write("library.json", '{"grayscaleText":true}');
    expect(readGrayscaleText(dir)).toBe(true);
    expect(await list()).toEqual(["library.json"]);
  });
});

describe("keepNewerFile", () => {
  it("copies a file written by a newer Tavora aside, once, and leaves the original", async () => {
    await write("library.json", '{"version":2,"games":{"future":true}}');
    const file = path.join(dir, "library.json");
    expect(await keepNewerFile(file, 1)).toBe(`${file}.from-version-2`);
    await write("library.json", '{"version":2,"games":{"changed":true}}');
    await keepNewerFile(file, 1);
    expect(await readFile(`${file}.from-version-2`, "utf8")).toContain("future");
    expect(await readFile(file, "utf8")).toContain("changed");
  });

  it("does nothing for files this version understands, missing files and broken ones", async () => {
    await write("library.json", '{"version":1}');
    await write("workspace.json", "not json");
    await write("other.json", '{"games":{}}');
    expect(await keepNewerFile(path.join(dir, "library.json"), 1)).toBeNull();
    expect(await keepNewerFile(path.join(dir, "workspace.json"), 2)).toBeNull();
    expect(await keepNewerFile(path.join(dir, "other.json"), 1)).toBeNull();
    expect(await keepNewerFile(path.join(dir, "missing.json"), 1)).toBeNull();
    expect(await list()).toEqual(["library.json", "other.json", "workspace.json"]);
  });
});
