import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModuleFilesFolder, type ModuleFilesFolderHost } from "./module-files-folder";

vi.mock("electron", () => ({ shell: {} }));

const PICTURE = "0123456789abcdef0123456789abcdef.png";

async function setup(chosen: string | null = null) {
  const base = await mkdtemp(path.join(tmpdir(), "tavora-pictures-"));
  const userData = path.join(base, "data");
  const old = path.join(userData, "module-blobs", "official", "tavora.notes", "poe2");
  await mkdir(old, { recursive: true });
  await writeFile(path.join(old, PICTURE), "png");
  const set = vi.fn<(folder: string | null) => void>();
  const host: ModuleFilesFolderHost = {
    userData,
    defaultFolder: path.join(base, "Pictures", "Tavora"),
    language: () => "en",
    chosenFolder: () => chosen,
    setChosenFolder: set,
    pick: async () => undefined,
    remember: () => undefined,
    notify: () => undefined,
    changed: () => undefined,
  };
  return { base, userData, host, set, folder: new ModuleFilesFolder(host) };
}

describe("ModuleFilesFolder.moveFromOldDefault", () => {
  it("moves pictures from the old folder in the app's data to Pictures\\Tavora", async () => {
    const { userData, host, set, folder } = await setup();
    await folder.moveFromOldDefault(() => undefined);
    expect(await readFile(path.join(host.defaultFolder, "official", "tavora.notes", "poe2", PICTURE), "utf8")).toBe("png");
    expect(await readdir(path.join(userData, "module-blobs"))).toEqual([]);
    expect(set).not.toHaveBeenCalled();
    expect(folder.root()).toBe(host.defaultFolder);
  });

  it("keeps using the old folder when the copy fails", async () => {
    const { base, userData, set, folder } = await setup();
    // Pictures\Tavora can't be made: a file is in the way.
    await mkdir(path.join(base, "Pictures"), { recursive: true });
    await writeFile(path.join(base, "Pictures", "Tavora"), "not a folder");
    await folder.moveFromOldDefault(() => undefined);
    expect(set).toHaveBeenCalledWith(path.join(userData, "module-blobs"));
    expect(await readdir(path.join(userData, "module-blobs", "official", "tavora.notes", "poe2"))).toEqual([PICTURE]);
  });

  it("leaves a folder the user chose alone", async () => {
    const { userData, host, set, folder } = await setup("/somewhere/Tavora");
    await folder.moveFromOldDefault(() => undefined);
    expect(set).not.toHaveBeenCalled();
    expect(await readdir(path.join(userData, "module-blobs", "official", "tavora.notes", "poe2"))).toEqual([PICTURE]);
    await expect(readdir(host.defaultFolder)).rejects.toThrow();
  });
});
