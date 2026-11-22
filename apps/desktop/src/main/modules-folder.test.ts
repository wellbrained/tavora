import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModulesFolder } from "./modules-folder";
import type { ModuleProblem } from "./registry";

interface Setup {
  pick?: string | undefined;
  /** What opening a folder answers with ("" when it opened). */
  opened?: string;
  problems?: ModuleProblem[];
}

async function setup(options: Setup = {}) {
  const calls: string[] = [];
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "tavora-modules-folder-")), "modules");
  const folder = new ModulesFolder({
    dir,
    dialogs: {
      pick: async (place, picked) => (calls.push(`pick ${place} ${picked.filters?.[0]?.extensions.join(",")}`), options.pick),
      remember: (place, picked) => void calls.push(`remember ${place} ${picked}`),
    },
    language: () => "en",
    installFile: async (file) => (calls.push(`install ${file}`), "acme.map"),
    openPath: async (folder) => (calls.push(`open ${folder}`), options.opened ?? ""),
    problems: () => options.problems ?? [],
  });
  return { folder, calls, dir };
}

describe("ModulesFolder", () => {
  it("installs a zip the user picks and remembers where it was; nothing when the dialog is closed", async () => {
    const closed = await setup({ pick: undefined });
    expect(await closed.folder.installZip()).toBeUndefined();
    expect(closed.calls).toEqual(["pick install-module zip"]);

    const picked = await setup({ pick: "/downloads/map.zip" });
    expect(await picked.folder.installZip()).toBe("acme.map");
    expect(picked.calls).toEqual(["pick install-module zip", "install /downloads/map.zip", "remember install-module /downloads/map.zip"]);
  });

  it("opens the modules folder, made first when it isn't there, and says when it can't", async () => {
    const { folder, calls, dir } = await setup();
    await folder.open();
    expect(existsSync(dir)).toBe(true);
    expect(calls).toEqual([`open ${dir}`]);
    const failing = await setup({ opened: "no file manager" });
    await expect(failing.folder.open()).rejects.toMatchObject({ key: "error.openModulesFolder" });
  });

  it("opens only a folder Settings lists as not loading, never a development folder's or any other path", async () => {
    const problems = [
      { folder: "broken", path: "/modules/broken", message: "no manifest" },
      { folder: "project", path: "/dev/project", message: "no manifest", developmentFolder: "/dev" },
    ];
    const { folder, calls } = await setup({ problems });
    await folder.openProblem("/modules/broken");
    await folder.openProblem("/dev/project");
    await folder.openProblem("C:/Windows");
    expect(calls).toEqual(["open /modules/broken"]);
    const failing = await setup({ problems, opened: "gone" });
    await expect(failing.folder.openProblem("/modules/broken")).rejects.toMatchObject({ key: "error.openFolder" });
  });
});
