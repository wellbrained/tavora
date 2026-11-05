import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { folderKey, type FolderAccess } from "@tavora/module-schema";
import type { FolderChange } from "@tavora/sdk/protocol";
import { ChosenFolders, findFolder, folderHost, FolderWatch, insidePath, isRefusedFolder, listFolder, MAX_FOLDER_LEVELS, readFolderFile, serveFolderFile, type FolderPlaces } from "./folder-access";

const replays: FolderAccess = { path: "Documents/Game", read: ["sc2replay"], names: ["lnk"] };

let root: string;
let places: FolderPlaces;
let game: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tavora-folders-"));
  const home = path.join(root, "home");
  places = { roots: { Documents: path.join(home, "Documents"), "Saved Games": path.join(home, "Saved Games") }, home, userData: path.join(home, "AppData", "Roaming", "Tavora") };
  game = path.join(places.roots.Documents, "Game");
  await mkdir(path.join(game, "Accounts", "1", "Replays"), { recursive: true });
  await writeFile(path.join(game, "Accounts", "1", "Replays", "Ladder.SC2Replay"), "replay");
  await writeFile(path.join(game, "Brain_844@2.lnk"), "C:\\Users\\someone\\Documents\\Game");
  await writeFile(path.join(game, "Variables.txt"), "secret");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("refused folders", () => {
  it("refuses drives, the user's folder and above, AppData and Tavora's data", () => {
    expect(isRefusedFolder(path.parse(root).root, places)).toBe(true);
    expect(isRefusedFolder(places.home, places)).toBe(true);
    expect(isRefusedFolder(path.dirname(places.home), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "AppData", "Local", "Discord"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.userData, "module-data"), places)).toBe(true);
    expect(isRefusedFolder(game, places)).toBe(false);
    expect(isRefusedFolder(path.join(places.home, "Downloads", "Saves"), places)).toBe(false);
  });

  it("refuses Tavora's data folder and the folders holding it when it lives outside the user's folder", () => {
    const portable = { home: places.home, userData: path.join(root, "Portable", "Tavora", "data") };
    expect(isRefusedFolder(path.join(root, "Portable"), portable)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Portable", "Tavora", "data", "grants"), portable)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Portable", "Games"), portable)).toBe(false);
  });
});

describe("listing", () => {
  it("lists only the extensions the manifest names, subfolders too, case aside", async () => {
    const { files, truncated } = await listFolder(game, replays);
    expect(truncated).toBe(false);
    expect(files.map(({ path, readable }) => ({ path, readable })).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "Accounts/1/Replays/Ladder.SC2Replay", readable: true },
      { path: "Brain_844@2.lnk", readable: false },
    ]);
    expect(files.find((file) => file.readable)?.size).toBe(6);
  });

  it(`goes ${MAX_FOLDER_LEVELS} folders deep and no deeper`, async () => {
    const deep = path.join(game, ...Array.from({ length: MAX_FOLDER_LEVELS }, (_, i) => `d${i}`));
    await mkdir(path.join(deep, "too"), { recursive: true });
    await writeFile(path.join(deep, "last.SC2Replay"), "x");
    await writeFile(path.join(deep, "too", "deeper.SC2Replay"), "x");
    const paths = (await listFolder(game, replays)).files.map((file) => file.path);
    expect(paths.some((item) => item.endsWith("/last.SC2Replay"))).toBe(true);
    expect(paths.some((item) => item.endsWith("deeper.SC2Replay"))).toBe(false);
  });

  it("never follows a link or junction out of the folder", async () => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "Stolen.SC2Replay"), "x");
    await symlink(outside, path.join(game, "Linked"), "junction");
    const paths = (await listFolder(game, replays)).files.map((file) => file.path);
    expect(paths.some((item) => item.includes("Stolen"))).toBe(false);
    await expect(readFolderFile(game, replays, "Linked/Stolen.SC2Replay", "test")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("reading", () => {
  it("reads a file of a read extension", async () => {
    expect((await readFolderFile(game, replays, "Accounts/1/Replays/Ladder.SC2Replay", "test")).toString()).toBe("replay");
  });

  it("refuses names-only files, other kinds and paths that leave the folder", async () => {
    await expect(readFolderFile(game, replays, "Brain_844@2.lnk", "test")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(readFolderFile(game, replays, "Variables.txt", "test")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    for (const bad of ["../Other/x.SC2Replay", "..\\x.SC2Replay", "C:/x.SC2Replay", "/x.SC2Replay", "a//x.SC2Replay", "", "x.SC2Replay\u0000"]) {
      await expect(readFolderFile(game, replays, bad, "test")).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    }
    expect(insidePath("Accounts/1/x.SC2Replay")).toEqual(["Accounts", "1", "x.SC2Replay"]);
  });
});

describe("the module's folders", () => {
  const host = (allowed: string[], pick?: string, refused = vi.fn()) =>
    folderHost({
      folders: () => [replays],
      allowed: () => new Set(allowed),
      chosen: new ChosenFolders(places.userData, "local", "local.game"),
      places,
      pick: async () => pick,
      refused,
      scope: "local/local.game",
    });

  it("answers nothing for a folder the user did not allow, or one the manifest doesn't name", async () => {
    await expect(host([]).list("Documents/Game")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(host([folderKey(replays)]).list("Documents/Other")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await host([]).state("Documents/Game")).toEqual({ found: false, reason: "not-granted" });
    // A grant for other extensions than the manifest asks for now is no grant.
    expect(await host([folderKey({ ...replays, read: ["txt"] })]).state("Documents/Game")).toEqual({ found: false, reason: "not-granted" });
  });

  it("finds the folder where the manifest says, or where the user showed it", async () => {
    const granted = host([folderKey(replays)]);
    expect(await granted.state("Documents/Game")).toEqual({ found: true });
    await rm(game, { recursive: true });
    expect(await granted.state("Documents/Game")).toEqual({ found: false, reason: "missing" });
    const moved = path.join(root, "D", "Games", "Game");
    await mkdir(moved, { recursive: true });
    await writeFile(path.join(moved, "Moved.SC2Replay"), "x");
    expect(await host([folderKey(replays)], moved).choose("Documents/Game")).toBe(true);
    expect((await granted.list("Documents/Game")).files.map((file) => file.path)).toEqual(["Moved.SC2Replay"]);
  });

  it("won't take a folder no module may read, and says so", async () => {
    const refused = vi.fn();
    expect(await host([folderKey(replays)], places.home, refused).choose("Documents/Game")).toBe(false);
    expect(refused).toHaveBeenCalledOnce();
    expect(await findFolder(replays, new ChosenFolders(places.userData, "local", "local.game"), places)).toBe(game);
  });

  it("serves a read over HTTP only as POST with a folder and path", async () => {
    const granted = host([folderKey(replays)]);
    const post = (body: string) => new Request("tavora-module://local.game/_folders/read", { method: "POST", body });
    const ok = await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "Accounts/1/Replays/Ladder.SC2Replay" })), granted);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("replay");
    expect((await serveFolderFile(new Request("tavora-module://local.game/_folders/read"), granted)).status).toBe(405);
    expect((await serveFolderFile(post("not json"), granted)).status).toBe(400);
    expect((await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "Brain_844@2.lnk" })), granted)).status).toBe(403);
    expect((await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "x.SC2Replay" })), host([]))).status).toBe(403);
  });
});

describe("watching", () => {
  it("tells about new files the module may see, and nothing else", { timeout: 10_000 }, async () => {
    const changes: FolderChange[] = [];
    const watcher = new FolderWatch("Documents/Game", game, replays, (change) => changes.push(change));
    if (!watcher.watching) return;
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(path.join(game, "Accounts", "1", "Replays", "New.SC2Replay"), "new");
      await writeFile(path.join(game, "Variables.txt"), "changed");
      await vi.waitFor(() => expect(changes.flatMap((change) => change.changed.map((file) => file.path))).toContain("Accounts/1/Replays/New.SC2Replay"), { timeout: 5000 });
      expect(changes.flatMap((change) => change.changed.map((file) => file.path)).some((item) => item.endsWith(".txt"))).toBe(false);
      expect(changes.some((change) => change.rescan)).toBe(false);
    } finally {
      watcher.close();
    }
  });
});
