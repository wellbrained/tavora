import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLDER_ROOTS, folderKey, type FolderAccess } from "@tavora/module-schema";
import type { FolderChange } from "@tavora/sdk/protocol";
import { FOLDER_ROOT_NAMES } from "../shared/folder-keys";
import { ChosenFolders, findFolder, folderHost, FolderWatch, insidePath, isRefusedFolder, listFolder, MAX_FOLDER_LEVELS, readFolderFile, revealTarget, serveFolderFile, type FolderPlaces } from "./folder-access";

const replays: FolderAccess = { path: "Documents/Game", read: ["sc2replay"], names: ["lnk"] };

let root: string;
let places: FolderPlaces;
let game: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tavora-folders-"));
  const home = path.join(root, "Users", "me");
  places = {
    roots: { Documents: path.join(home, "Documents"), "Saved Games": path.join(home, "Saved Games"), "AppData/LocalLow": path.join(home, "AppData", "LocalLow") },
    home,
    userData: path.join(home, "AppData", "Roaming", "Tavora"),
    known: [path.join(home, "Desktop"), path.join(home, "Downloads"), path.join(home, "OneDrive")],
    closed: [path.join(root, "ProgramData"), path.join(root, "Windows")],
  };
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

  it("refuses more than a manifest could name: the known folders themselves, dot-folders, other users, closed places, network paths", () => {
    expect(isRefusedFolder(places.roots.Documents, places)).toBe(true);
    expect(isRefusedFolder(places.roots["Saved Games"], places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "Desktop"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "OneDrive"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, ".ssh"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, ".docker", "contexts"), places)).toBe(true);
    expect(isRefusedFolder(path.join(path.dirname(places.home), "someone", "Documents", "Game"), places)).toBe(true);
    expect(isRefusedFolder(path.join(root, "ProgramData", "Game"), places)).toBe(true);
    if (process.platform === "win32") expect(isRefusedFolder("\\\\localhost\\c$\\Users\\me\\Documents\\Game", places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "OneDrive", "Documents", "Game"), places)).toBe(false);
  });

  it("refuses Tavora's data folder and the folders holding it when it lives outside the user's folder", () => {
    const portable = { home: places.home, userData: path.join(root, "Portable", "Tavora", "data") };
    expect(isRefusedFolder(path.join(root, "Portable", "Tavora"), portable)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Portable"), portable)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Portable", "Tavora", "data", "grants"), portable)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Portable", "Games"), portable)).toBe(false);
  });

  it("refuses Tavora's own save folders, anything in them and the folders holding them", () => {
    const tavora = path.join(places.roots.Documents, "Tavora");
    const copy = path.join(root, "Backups", "Copy");
    const own = { ...places, own: [tavora, path.join(places.home, "Pictures", "Tavora"), copy] };
    // Documents\Tavora holds exported key files and every module's saved files.
    expect(isRefusedFolder(tavora, own)).toBe(true);
    expect(isRefusedFolder(path.join(tavora, "Saves"), own)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "Pictures", "Tavora", "module"), own)).toBe(true);
    // One outside the user's folder, such as the cloud copy's, and the folder holding it.
    expect(isRefusedFolder(copy, own)).toBe(true);
    expect(isRefusedFolder(path.join(root, "Backups"), own)).toBe(true);
    // A game's folder next to them stays fine.
    expect(isRefusedFolder(game, own)).toBe(false);
    expect(isRefusedFolder(path.join(places.roots.Documents, "Tavora Game"), own)).toBe(false);
    expect(isRefusedFolder(path.join(root, "Games"), own)).toBe(false);
  });

  it("ignores a drive given as one of Tavora's own folders", () => {
    expect(isRefusedFolder(game, { ...places, own: [path.parse(root).root] })).toBe(false);
  });

  it("refuses Documents\\Tavora made after it was first looked at, behind a junction", async () => {
    // The real Documents is elsewhere, reached through a junction; Documents\Tavora isn't there yet.
    const real = path.join(root, "Elsewhere", "Documents");
    await mkdir(real, { recursive: true });
    const linked = path.join(root, "Linked");
    await symlink(path.join(root, "Elsewhere"), linked, "junction");
    const own = { ...places, own: [path.join(linked, "Documents", "Tavora")] };
    expect(isRefusedFolder(path.join(real, "Game"), own)).toBe(false);
    await mkdir(path.join(real, "Tavora"));
    expect(isRefusedFolder(realpathSync.native(path.join(linked, "Documents", "Tavora")), own)).toBe(true);
  });

  it("finds no folder for a manifest path into Documents\\Tavora, and refuses it when picked", async () => {
    const tavora = path.join(places.roots.Documents, "Tavora");
    await mkdir(tavora, { recursive: true });
    await writeFile(path.join(tavora, "publisher-key-1234abcd.pem"), "-----BEGIN PRIVATE KEY-----");
    const own = { ...places, own: [tavora] };
    const keys: FolderAccess = { path: "Documents/Tavora", read: ["pem"] };
    const chosen = new ChosenFolders(places.userData, "local", "local.game");
    expect(await findFolder(keys, chosen, own)).toBeNull();
    // Shown by the user for another manifest path: refused all the same.
    await chosen.set(replays.path, tavora);
    expect(await findFolder(replays, chosen, own)).toBeNull();
  });
});

describe("AppData\\LocalLow", () => {
  const settings: FolderAccess = { path: "AppData/LocalLow/SadSocket/9Kings", read: ["json"] };
  const lowOf = (...names: string[]) => path.join(places.roots["AppData/LocalLow"], ...names);
  const chosen = () => new ChosenFolders(places.userData, "local", "local.game");

  it("is a root the host UI knows too", () => {
    expect(FOLDER_ROOT_NAMES).toEqual(FOLDER_ROOTS);
  });

  it("takes a game's folder in LocalLow, never LocalLow itself, a whole company, a system folder or the rest of AppData", () => {
    expect(isRefusedFolder(lowOf("SadSocket", "9Kings"), places)).toBe(false);
    expect(isRefusedFolder(lowOf("SadSocket", "9Kings", "Saves"), places)).toBe(false);
    expect(isRefusedFolder(lowOf(), places)).toBe(true);
    expect(isRefusedFolder(lowOf("SadSocket"), places)).toBe(true);
    for (const vendor of ["Microsoft", "microsoft", "Sun", "Oracle", "Adobe", "Google", "Mozilla", "Intel", "NVIDIA", "Apple", "Temp"]) {
      expect(isRefusedFolder(lowOf(vendor, "Anything"), places)).toBe(true);
    }
    expect(isRefusedFolder(path.join(places.home, "AppData"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "AppData", "Local", "SadSocket", "9Kings"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "AppData", "Roaming", "SadSocket", "9Kings"), places)).toBe(true);
    expect(isRefusedFolder(path.join(places.home, "AppData", "LocalLowish", "SadSocket", "9Kings"), places)).toBe(true);
  });

  it("finds, lists and reads a game's folder in LocalLow", async () => {
    await mkdir(lowOf("SadSocket", "9Kings"), { recursive: true });
    await writeFile(lowOf("SadSocket", "9Kings", "9KingsSettings.json"), "{}");
    expect(await findFolder(settings, chosen(), places)).toBe(realpathSync.native(lowOf("SadSocket", "9Kings")));
    const granted = folderHost({
      folders: () => [settings],
      allowed: () => new Set([folderKey(settings)]),
      chosen: chosen(),
      places: () => places,
      pick: async () => undefined,
      refused: vi.fn(),
      scope: "local/local.game",
    });
    expect((await granted.list(settings.path)).files.map((file) => file.path)).toEqual(["9KingsSettings.json"]);
    expect((await granted.read(settings.path, "9KingsSettings.json")).toString()).toBe("{}");
  });

  it("never reaches Local or Roaming through a junction in LocalLow, at the game or the company", async () => {
    const discord = path.join(places.home, "AppData", "Roaming", "discord", "Local Storage");
    const local = path.join(places.home, "AppData", "Local", "Google", "Chrome");
    await mkdir(discord, { recursive: true });
    await mkdir(local, { recursive: true });
    await writeFile(path.join(discord, "settings.json"), "{\"token\":\"secret\"}");
    await mkdir(lowOf("SadSocket"), { recursive: true });
    await symlink(discord, lowOf("SadSocket", "9Kings"), "junction");
    expect(await findFolder(settings, chosen(), places)).toBeNull();
    // The company folder itself a junction into Local.
    await symlink(path.dirname(local), lowOf("Evil"), "junction");
    expect(await findFolder({ path: "AppData/LocalLow/Evil/Chrome", read: ["json"] }, chosen(), places)).toBeNull();
    // Picked by the user: refused all the same, and the module is never told where it led.
    const refused = vi.fn();
    const granted = folderHost({
      folders: () => [settings],
      allowed: () => new Set([folderKey(settings)]),
      chosen: chosen(),
      places: () => places,
      pick: async () => lowOf("Evil", "Chrome"),
      refused,
      scope: "local/local.game",
    });
    expect(await granted.choose(settings.path)).toBe(false);
    expect(refused).toHaveBeenCalledOnce();
    await expect(granted.read(settings.path, "settings.json")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never reaches Local through LocalLow when LocalLow itself is a junction there", async () => {
    const local = path.join(places.home, "AppData", "Local");
    await mkdir(path.join(local, "SadSocket", "9Kings"), { recursive: true });
    await symlink(local, lowOf(), "junction");
    expect(await findFolder(settings, chosen(), places)).toBeNull();
  });

  it("keeps the system folders shut when LocalLow lives elsewhere through a junction", async () => {
    const elsewhere = path.join(root, "D", "LocalLow");
    await mkdir(path.join(elsewhere, "SadSocket", "9Kings"), { recursive: true });
    await mkdir(path.join(elsewhere, "Microsoft", "CryptnetUrlCache"), { recursive: true });
    await mkdir(path.join(places.home, "AppData"), { recursive: true });
    await symlink(elsewhere, lowOf(), "junction");
    expect(await findFolder(settings, chosen(), places)).toBe(realpathSync.native(path.join(elsewhere, "SadSocket", "9Kings")));
    expect(isRefusedFolder(realpathSync.native(path.join(elsewhere, "Microsoft", "CryptnetUrlCache")), places)).toBe(true);
    expect(isRefusedFolder(realpathSync.native(path.join(elsewhere, "SadSocket")), places)).toBe(true);
  });

  it("refuses a system folder in LocalLow even for an entry no manifest could hold, or when the user picks it", async () => {
    const crypt = lowOf("Microsoft", "CryptnetUrlCache");
    await mkdir(crypt, { recursive: true });
    expect(await findFolder({ path: "AppData/LocalLow/Microsoft/CryptnetUrlCache", read: ["dat"] }, chosen(), places)).toBeNull();
    await chosen().set(settings.path, crypt);
    expect(await findFolder(settings, chosen(), places)).toBeNull();
  });
});

describe("key files", () => {
  it("never reads a key or certificate file, even when the manifest asks to: it is only a name", async () => {
    await writeFile(path.join(game, "publisher-key-1234abcd.pem"), "-----BEGIN PRIVATE KEY-----");
    const keys: FolderAccess = { path: "Documents/Game", read: ["pem", "key", "pfx", "txt"] };
    const listing = await listFolder(game, keys);
    expect(listing.files.find((file) => file.path === "publisher-key-1234abcd.pem")?.readable).toBe(false);
    expect(listing.files.find((file) => file.path === "Variables.txt")?.readable).toBe(true);
    await expect(readFolderFile(game, keys, "publisher-key-1234abcd.pem", "test")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
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
    // The same answer as a file that isn't there, so a link can't tell what lies behind it.
    await expect(readFolderFile(game, replays, "Linked/Stolen.SC2Replay", "test")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("names", () => {
  it("lists and reads files with long names", async () => {
    const long = `${"Ladder game on a map with a very long name, ".repeat(3)}.SC2Replay`;
    await writeFile(path.join(game, long), "long");
    expect((await listFolder(game, replays)).files.map((file) => file.path)).toContain(long);
    expect((await readFolderFile(game, replays, long, "test")).toString()).toBe("long");
  });

  it("never reads another file through a Windows short name", async () => {
    if (process.platform !== "win32") return;
    const secret = path.join(game, "passwords.txtbackup");
    await writeFile(secret, "secret");
    let short = "";
    try {
      const line = execSync(`for %I in ("${secret}") do @echo %~sI`, { encoding: "utf8", shell: "cmd.exe" });
      short = path.basename(line.trim());
    } catch {
      return;
    }
    // Short names are off on this drive: nothing to try.
    if (!short || short.toLowerCase() === "passwords.txtbackup") return;
    const text = { path: "Documents/Game", read: ["txt"] };
    await expect(readFolderFile(game, text, short, "test")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(readFolderFile(game, text, "missing.txt", "test")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("hard links", () => {
  it("doesn't read a file that has another name somewhere else", async () => {
    const outside = path.join(root, "outside.SC2Replay");
    await writeFile(outside, "outside");
    try {
      await link(outside, path.join(game, "hl.SC2Replay"));
    } catch {
      return;
    }
    await expect(readFolderFile(game, replays, "hl.SC2Replay", "test")).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
      places: () => places,
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
    expect(await host([folderKey(replays)], places.roots.Documents).choose("Documents/Game")).toBe(false);
    await mkdir(moved, { recursive: true });
    await writeFile(path.join(moved, "Moved.SC2Replay"), "x");
    expect(await host([folderKey(replays)], moved).choose("Documents/Game")).toBe(true);
    expect((await granted.list("Documents/Game")).files.map((file) => file.path)).toEqual(["Moved.SC2Replay"]);
  });

  it("lists a folder once at a time, giving calls made meanwhile the same answer", async () => {
    const granted = host([folderKey(replays)]);
    const [a, b] = await Promise.all([granted.list("Documents/Game"), granted.list("Documents/Game")]);
    expect(a).toEqual(b);
    expect(a.files).toHaveLength(2);
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
    expect((await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "x".repeat(9000) })), granted)).status).toBe(400);
    expect((await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "Brain_844@2.lnk" })), granted)).status).toBe(403);
    expect((await serveFolderFile(post(JSON.stringify({ folder: "Documents/Game", path: "x.SC2Replay" })), host([]))).status).toBe(403);
  });
});

describe("showing a file in its folder", () => {
  const real = (...parts: string[]) => realpathSync.native(path.join(game, ...parts));

  it("shows a file of a read or a names extension, as it really is", async () => {
    expect(await revealTarget(realpathSync.native(game), replays, "Accounts/1/Replays/Ladder.SC2Replay")).toEqual({ path: real("Accounts", "1", "Replays", "Ladder.SC2Replay"), kind: "file" });
    expect(await revealTarget(realpathSync.native(game), replays, "Brain_844@2.lnk")).toEqual({ path: real("Brain_844@2.lnk"), kind: "file" });
  });

  // Windows paths don't care about case; the real name is shown, not the case the module wrote.
  it.skipIf(process.platform !== "win32")("shows the file's real name when the module wrote another case", async () => {
    expect(await revealTarget(realpathSync.native(game), replays, "accounts/1/replays/LADDER.sc2replay")).toEqual({ path: real("Accounts", "1", "Replays", "Ladder.SC2Replay"), kind: "file" });
  });

  it("shows nothing for a kind the listing leaves out", async () => {
    await expect(revealTarget(game, replays, "Variables.txt")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(revealTarget(game, replays, "Accounts")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("refuses paths that can't be inside the folder", async () => {
    const bad = [
      "../Other/x.SC2Replay", "..\\x.SC2Replay", "Accounts/../../x.SC2Replay", "C:/x.SC2Replay", "C:x.SC2Replay", "/x.SC2Replay", "\\\\server\\share\\x.SC2Replay",
      "a//x.SC2Replay", "", "x.SC2Replay\u0000", "Ladder.SC2Replay:stream", "Ladder.SC2Replay::$DATA", "Ladder.SC2Replay.", "Ladder.SC2Replay ", "CON/x.SC2Replay", "x".repeat(2700), 42, null, undefined,
    ];
    for (const item of bad) await expect(revealTarget(game, replays, item), String(item)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("shows the folder a file was in when it is gone, the granted folder for one at the top", async () => {
    expect(await revealTarget(realpathSync.native(game), replays, "Accounts/1/Replays/Gone.SC2Replay")).toEqual({ path: real("Accounts", "1", "Replays"), kind: "folder" });
    expect(await revealTarget(realpathSync.native(game), replays, "Gone.SC2Replay")).toEqual({ path: realpathSync.native(game), kind: "folder" });
  });

  it("answers null, not an error, when even its folder is gone, so the answer doesn't tell which subfolders exist", async () => {
    const base = realpathSync.native(game);
    expect(await revealTarget(base, replays, "Nowhere/Gone.SC2Replay")).toBeNull();
    expect(await revealTarget(base, replays, "Accounts/9/Replays/Gone.SC2Replay")).toBeNull();
    // A subfolder that is there shows it, one that is not shows nothing: neither is an error.
    expect(await revealTarget(base, replays, "Accounts/1/Gone.SC2Replay")).toEqual({ path: real("Accounts", "1"), kind: "folder" });
  });

  it("doesn't show a folder that only carries a file's name", async () => {
    await mkdir(path.join(game, "Folder.SC2Replay"));
    expect(await revealTarget(realpathSync.native(game), replays, "Folder.SC2Replay")).toEqual({ path: realpathSync.native(game), kind: "folder" });
  });

  it("never leads out through a junction, for the file or for the folder it was in", async () => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "Stolen.SC2Replay"), "x");
    await symlink(outside, path.join(game, "Linked"), "junction");
    const base = realpathSync.native(game);
    expect(await revealTarget(base, replays, "Linked/Stolen.SC2Replay")).toBeNull();
    expect(await revealTarget(base, replays, "Linked/Gone.SC2Replay")).toBeNull();
    // A junction with a file's name isn't a file inside the folder: the granted folder is shown, never where it leads.
    await symlink(outside, path.join(game, "Named.SC2Replay"), "junction");
    await expect(revealTarget(base, replays, "Named.SC2Replay")).resolves.toEqual({ path: base, kind: "folder" });
  });

  it("never leads out through a link to a file", async (context) => {
    const outside = path.join(root, "outside.SC2Replay");
    await writeFile(outside, "outside");
    try {
      await symlink(outside, path.join(game, "Shortcut.SC2Replay"), "file");
    } catch {
      // Links to files need a right this account may not have.
      context.skip("this account can't make a link to a file");
    }
    const base = realpathSync.native(game);
    const target = await revealTarget(base, replays, "Shortcut.SC2Replay");
    expect(target).toEqual({ path: base, kind: "folder" });
  });

  it.skipIf(process.platform !== "win32")("never shows another file through a Windows short name", async (context) => {
    const secret = path.join(game, "passwords.txtbackup");
    await writeFile(secret, "secret");
    let short = "";
    try {
      const line = execSync(`for %I in ("${secret}") do @echo %~sI`, { encoding: "utf8", shell: "cmd.exe" });
      short = path.basename(line.trim());
    } catch {
      context.skip("can't ask Windows for a short name");
    }
    if (!short || short.toLowerCase() === "passwords.txtbackup") context.skip("short names are off on this drive");
    const text = { path: "Documents/Game", read: ["txt"] };
    // Not the file the short name stands for: the folder it is in.
    expect(await revealTarget(realpathSync.native(game), text, short)).toEqual({ path: realpathSync.native(game), kind: "folder" });
  });

  describe("for the module", () => {
    let granted: Set<string>;
    const host = () =>
      folderHost({
        folders: () => [replays],
        allowed: () => granted,
        chosen: new ChosenFolders(places.userData, "local", "local.game"),
        places: () => places,
        pick: async () => undefined,
        refused: vi.fn(),
        scope: "local/local.game",
      });
    beforeEach(() => {
      granted = new Set([folderKey(replays)]);
    });

    it("answers nothing for a folder the user did not allow, or one the manifest doesn't name", async () => {
      granted.clear();
      await expect(host().reveal("Documents/Game", "Brain_844@2.lnk")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      granted.add(folderKey(replays));
      await expect(host().reveal("Documents/Other", "Brain_844@2.lnk")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(host().reveal(undefined, "Brain_844@2.lnk")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // A grant for other extensions than the manifest asks for now is no grant.
      granted = new Set([folderKey({ ...replays, read: ["txt"] })]);
      await expect(host().reveal("Documents/Game", "Brain_844@2.lnk")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("shows a file of the granted folder, and says so when the folder isn't there", async () => {
      expect(await host().reveal("Documents/Game", "Accounts/1/Replays/Ladder.SC2Replay")).toEqual({ path: real("Accounts", "1", "Replays", "Ladder.SC2Replay"), kind: "file" });
      await rm(game, { recursive: true });
      await expect(host().reveal("Documents/Game", "Accounts/1/Replays/Ladder.SC2Replay")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("shows nothing once the grant is taken back while it looks", async () => {
      const asking = host().reveal("Documents/Game", "Accounts/1/Replays/Ladder.SC2Replay");
      granted.clear();
      await expect(asking).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("looks in the folder the user showed Tavora, not where the manifest says", async () => {
      const moved = path.join(root, "D", "Games", "Game");
      await mkdir(moved, { recursive: true });
      await writeFile(path.join(moved, "Moved.SC2Replay"), "x");
      const chosen = new ChosenFolders(places.userData, "local", "local.game");
      await chosen.set("Documents/Game", realpathSync.native(moved));
      const target = await host().reveal("Documents/Game", "Moved.SC2Replay");
      expect(target).toEqual({ path: path.join(realpathSync.native(moved), "Moved.SC2Replay"), kind: "file" });
    });
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
