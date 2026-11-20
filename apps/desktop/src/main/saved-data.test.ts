import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary } from "./library";
import { DATA_FILES, keepNewerFile, readGrayscaleText, SavedData, WINDOW_FILE } from "./saved-data";
import { emptyWorkspaces } from "./workspace";

// Counts the writes per file, so a test can tell how many a burst of saves cost.
const writes = vi.hoisted(() => new Map<string, number>());
vi.mock("./fsutil", async (original) => {
  const actual = await original<typeof import("./fsutil")>();
  return {
    ...actual,
    writeFileAtomic: (file: string, ...rest: unknown[]) => {
      const name = path.basename(file);
      writes.set(name, (writes.get(name) ?? 0) + 1);
      return (actual.writeFileAtomic as (...args: unknown[]) => Promise<void>)(file, ...rest);
    },
  };
});

let dir: string;
beforeEach(async () => {
  writes.clear();
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

  it("keeps one waiting write per file however fast saves come, and the newest one lands", async () => {
    const saved = new SavedData(dir);
    const workspace = emptyWorkspaces(["w"]);
    const library = emptyLibrary();
    for (let call = 0; call < 1000; call++) {
      // Two titles in turn, as a page calling panel.setContent in a loop would.
      workspace.workspaces.w!.instances = [{ instanceId: "p", moduleId: "m", content: { id: "a", title: call % 2 ? "two" : "one" } }];
      saved.saveWorkspace(workspace);
      library.onlineSearch = call % 2 === 1;
      saved.saveLibrary(library);
      saved.saveWindow({ bounds: { x: call, y: 0, width: 800, height: 600 }, maximized: false });
      // Let the writes run now and then, so new saves arrive while one is on its way.
      if (call % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    await saved.flush();
    for (const name of ["workspace.json", "library.json", WINDOW_FILE]) expect(writes.get(name)).toBeLessThanOrEqual(21);
    expect(JSON.parse(await read("workspace.json")).workspaces.w.instances[0].content.title).toBe("two");
    expect(JSON.parse(await read("library.json")).onlineSearch).toBe(true);
    expect(JSON.parse(await read(WINDOW_FILE)).bounds.x).toBe(999);
  });

  it("writes a save that comes in while the same file is being written", async () => {
    const saved = new SavedData(dir);
    const library = emptyLibrary();
    saved.saveLibrary(library);
    await Promise.resolve();
    library.onlineSearch = true;
    saved.saveLibrary(library);
    await saved.flush();
    expect(JSON.parse(await read("library.json")).onlineSearch).toBe(true);
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
  it("copies a file written by a newer Tavora aside, once per content, never over a copy, and leaves the original", async () => {
    await write("library.json", '{"version":2,"games":{"future":true}}');
    const file = path.join(dir, "library.json");
    expect(await keepNewerFile(file, 1)).toBe(`${file}.from-version-2`);
    expect(await keepNewerFile(file, 1)).toBe(`${file}.from-version-2`);
    await write("library.json", '{"version":2,"games":{"changed":true}}');
    expect(await keepNewerFile(file, 1)).toBe(`${file}.from-version-2.2`);
    expect(await readFile(`${file}.from-version-2`, "utf8")).toContain("future");
    expect(await readFile(`${file}.from-version-2.2`, "utf8")).toContain("changed");
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
