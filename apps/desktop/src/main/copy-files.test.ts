// The cloud copy's own files are never written over while they can't be read (copy-files.ts): a write after a read that
// was held reads the file again first, goes on once that works, and is held (HeldError) while it doesn't.
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCopy, copyRoots, EMPTY_STATE, lookCopyState, removeCopyState, saveCopyState } from "./cloud-copy";
import { lookSwapStatus, writeSwapStatus } from "./cloud-copy-swap";
import { newCopyKey } from "./copy-crypto";
import { FolderStorage } from "./copy-folder";
import { HeldError } from "./file-look";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-copy-files-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const STATE = { version: 3, pictures: true, files: {} };

describe("the cloud copy's own files", () => {
  it("a state that couldn't be read is read again before it is written, and written once that works", async () => {
    const file = path.join(dir, "cloud-copy.json");
    await mkdir(file);
    expect((await lookCopyState(file)).status).toBe("held");
    // Still held: nothing is written, and the cloud copy holds it as any held read.
    await expect(saveCopyState(file, STATE)).rejects.toBeInstanceOf(HeldError);
    await expect(removeCopyState(file)).rejects.toBeInstanceOf(HeldError);
    // Readable again, and another Tavora wrote it meanwhile: a newer one is copied aside before it is written over.
    await rm(file, { recursive: true });
    await writeFile(file, '{"v":2,"version":9,"files":{}}');
    await saveCopyState(file, STATE);
    expect(await readFile(file, "utf8")).toBe('{"v":1,"version":3,"pictures":true,"files":{}}');
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe('{"v":2,"version":9,"files":{}}');
  });

  it("a status that couldn't be read isn't removed until it can be", async () => {
    const file = path.join(dir, "cloud-copy-status.json");
    await mkdir(file);
    expect((await lookSwapStatus(file, path.join(dir, "backups"))).status).toBe("held");
    await expect(writeSwapStatus(file, { phase: "idle" })).rejects.toBeInstanceOf(HeldError);
    await rm(file, { recursive: true });
    await writeFile(file, '{"v":1,"phase":"chosen"}');
    await writeSwapStatus(file, { phase: "idle" });
    expect(await readdir(dir)).toEqual([]);
  });

  // A folder the user may not change: its files can't be removed (on Windows and as root they can, so not there).
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a state the system won't let go of is held, not a crash", async () => {
    const file = path.join(dir, "locked", "cloud-copy.json");
    await mkdir(path.dirname(file));
    await saveCopyState(file, STATE);
    await chmod(path.dirname(file), 0o500);
    try {
      await expect(removeCopyState(file)).rejects.toBeInstanceOf(HeldError);
    } finally {
      await chmod(path.dirname(file), 0o700);
    }
    expect(await readFile(file, "utf8")).toBe('{"v":1,"version":3,"pictures":true,"files":{}}');
  });

  // A file only its owner may not read (as a virus scan holds one): readable on Windows and as root, so not there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("the note of the parts seen unused isn't written over while it can't be read, and every part counts from now", async () => {
    const unusedFile = path.join(dir, "cloud-copy-unused.json");
    const folder = path.join(dir, "OneDrive");
    await mkdir(folder);
    const note = JSON.stringify({ v: 1, folder, last: 1, waited: { "ab/cd": 5 } });
    await writeFile(unusedFile, note);
    await chmod(unusedFile, 0o000);
    await mkdir(path.join(dir, "data"));
    const storage = new FolderStorage(folder, { unusedFile });
    const roots = copyRoots(path.join(dir, "data"), path.join(dir, "Pictures"));
    const key = newCopyKey();
    let state = EMPTY_STATE;
    for (const text of ["one", "two"]) {
      await writeFile(path.join(dir, "data", "library.json"), text);
      const up = await new CloudCopy(storage).upload(key, roots, state);
      expect(up.status).toBe("uploaded");
      if (up.status === "uploaded") state = up.state;
    }
    await chmod(unusedFile, 0o600);
    expect(await readFile(unusedFile, "utf8")).toBe(note);
  });
});
