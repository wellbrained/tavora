import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

import * as fsp from "node:fs/promises";
import { FolderChecks, readFolderHeld } from "./module-folder-check";

const busy = () => Object.assign(new Error("busy"), { code: "EBUSY" });

async function folder(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-check-"));
  await mkdir(path.join(dir, "sub"));
  await writeFile(path.join(dir, "a.txt"), "a");
  return dir;
}

describe("readFolderHeld", () => {
  it("tries again while a file is held for a moment", async () => {
    const dir = await folder();
    vi.mocked(fsp.readdir).mockImplementationOnce(async () => {
      throw busy();
    });
    expect((await readFolderHeld(dir, false, [1, 1]))?.stamp).toContain("a.txt");
  });

  it("throws when the file stays held, instead of calling the folder changed", async () => {
    const dir = await folder();
    vi.mocked(fsp.readdir).mockImplementation(async () => {
      throw busy();
    });
    await expect(readFolderHeld(dir, false, [1, 1])).rejects.toMatchObject({ code: "EBUSY" });
    await expect(new FolderChecks(undefined, [1]).check(dir)).rejects.toMatchObject({ code: "EBUSY" });
    vi.mocked(fsp.readdir).mockReset();
  });

  it("answers null for a folder that is gone", async () => {
    expect(await readFolderHeld(path.join(tmpdir(), "tavora-no-such-folder"), false, [1])).toBeNull();
  });
});
