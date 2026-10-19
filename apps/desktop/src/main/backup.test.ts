import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupData, backupsDir, dayName, keepNewerFile, pruneBackups } from "./backup";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-backup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (relative: string, text: string) => {
  const file = path.join(dir, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const list = (relative = ".") => readdir(path.join(dir, relative)).then((names) => names.sort());

async function seed() {
  await write("library.json", '{"version":1,"games":{}}');
  await write("workspace.json", '{"version":2,"games":{}}');
  await write("profile.json", '{"version":1}');
  await write("module-data/tavora.notes/poe2/storage.json", '{"a":1}');
  await write("module-data/tavora.notes/poe2/documents/plan.json", '{"text":"keep me"}');
  await write("game-icons/poe2-1234abcd.png", "png");
  await write("profile/avatar.png", "png");
  await write("module-blobs/official/tavora.notes/poe2/0123456789abcdef0123456789abcdef.png", "png");
  await write("window.json", "{}");
  await write("module-data/tavora.notes/poe2/storage.json.tmp", "half written");
}

describe("backupData", () => {
  it("copies games, layouts, profile, module data and pictures into today's folder", async () => {
    await seed();
    const result = await backupData({ userData: dir, now: at(2026, 10, 15) });
    expect(result).toMatchObject({ status: "made", withPictures: true });
    const snap = path.join("backups", "2026-10-15");
    expect(await list(snap)).toEqual(["game-icons", "library.json", "module-blobs", "module-data", "profile", "profile.json", "workspace.json"]);
    expect(await readFile(path.join(dir, snap, "module-data/tavora.notes/poe2/documents/plan.json"), "utf8")).toBe('{"text":"keep me"}');
    // Disposable files and half-written temp files are left out.
    expect(await list(snap)).not.toContain("window.json");
    expect(await list(path.join(snap, "module-data/tavora.notes/poe2"))).toEqual(["documents", "storage.json"]);
  });

  it("makes one snapshot a day and never touches the original data", async () => {
    await seed();
    await backupData({ userData: dir, now: at(2026, 10, 15) });
    await write("library.json", '{"version":1,"games":{"changed":true}}');
    expect(await backupData({ userData: dir, now: at(2026, 10, 15) })).toMatchObject({ status: "exists" });
    expect(await readFile(path.join(dir, "backups/2026-10-15/library.json"), "utf8")).toBe('{"version":1,"games":{}}');
    expect(await readFile(path.join(dir, "library.json"), "utf8")).toContain("changed");
  });

  it("does nothing for a first start, before any library exists", async () => {
    expect(await backupData({ userData: dir, now: at(2026, 10, 15) })).toEqual({ status: "nothing" });
    expect(await list()).toEqual([]);
  });

  it("keeps the newest seven days and removes the rest", async () => {
    await seed();
    for (let d = 1; d <= 9; d++) await backupData({ userData: dir, now: at(2026, 10, d) });
    expect(await list("backups")).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("leaves out pictures when the data is too big, and skips entirely when even that is", async () => {
    await seed();
    await write("game-icons/big.png", "x".repeat(2000));
    const small = await backupData({ userData: dir, now: at(2026, 10, 1), maxBytes: 1000 });
    expect(small).toMatchObject({ status: "made", withPictures: false });
    expect(await list("backups/2026-10-01")).toEqual(["library.json", "module-data", "profile.json", "workspace.json"]);
    expect(await backupData({ userData: dir, now: at(2026, 10, 2), maxBytes: 10 })).toEqual({ status: "too-big" });
    expect(await list("backups")).toEqual(["2026-10-01"]);
  });

  it("backs up the pictures folder wherever it is, but only the modules' own folders in it", async () => {
    await seed();
    await write("Pictures/Tavora/official/tavora.notes/poe2/fedcba9876543210fedcba9876543210.png", "moved");
    await write("Pictures/Tavora/my holiday.jpg", "not Tavora's");
    await backupData({ userData: dir, moduleFiles: path.join(dir, "Pictures", "Tavora"), now: at(2026, 10, 15) });
    expect(await list("backups/2026-10-15/module-blobs")).toEqual(["official"]);
    expect(await readFile(path.join(dir, "backups/2026-10-15/module-blobs/official/tavora.notes/poe2/fedcba9876543210fedcba9876543210.png"), "utf8")).toBe("moved");
  });

  it("cleans up an interrupted snapshot instead of keeping a half one", async () => {
    await seed();
    await mkdir(path.join(dir, "backups", "2026-10-14.partial"), { recursive: true });
    await backupData({ userData: dir, now: at(2026, 10, 15) });
    expect(await list("backups")).toEqual(["2026-10-15"]);
  });
});

describe("pruneBackups and dayName", () => {
  it("only touches day folders and partial leftovers", async () => {
    await mkdir(path.join(dir, "keep-me"), { recursive: true });
    await mkdir(path.join(dir, "2026-10-01"));
    await mkdir(path.join(dir, "2026-10-02"));
    await mkdir(path.join(dir, "2026-10-03.partial"));
    expect(await pruneBackups(dir, 1)).toEqual(["2026-10-01", "2026-10-03.partial"]);
    expect(await list()).toEqual(["2026-10-02", "keep-me"]);
    expect(await pruneBackups(path.join(dir, "missing"), 7)).toEqual([]);
  });

  it("names the day by local date with two digits", () => {
    expect(dayName(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(backupsDir("/data")).toBe(path.join("/data", "backups"));
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
