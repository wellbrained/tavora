// Every file that holds the user's data: one a newer Tavora wrote is copied aside before this one can write over it,
// and one that can't be read is set aside (kept) before starting fresh, and the user is told (saved-versions.ts).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountKey } from "./account-key";
import { AccountFile } from "./account";
import { loadCopyState } from "./cloud-copy";
import { DiscordSecretsFile, type Encryptor } from "./discord-store";
import { DocumentStore } from "./documents";
import { ChosenFolders } from "./folder-access";
import { GameOverlayStore } from "./game-overlays";
import { GrantStore } from "./grants";
import { HotkeyStore } from "./hotkeys";
import { readOwnerRecords } from "./installer";
import { checkSavedFile, forgetSealedFile, onUnreadableFileKept, readSavedFile, setAside, unreadableFilesKept } from "./json";
import { loadLibrary, SavedData } from "./saved-data";
import { queueLocalDataMove } from "./module-data";
import { readOfficialRecords } from "./official-updates";
import { OverlayStore } from "./overlays";
import { ReadOnlyFiles } from "./read-only-files";
import { STORE_VERSIONS, SUPPORTED_VERSIONS } from "./saved-versions";
import { SealedFile } from "./sealed-file";
import { ModuleStore, PanelStateStore } from "./storage";
import { ConnectionFile } from "./connection";
import { TrafficFile } from "./traffic";
import { loadWorkspace } from "./workspace";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-saved-files-"));
  // Setting a file aside is logged on purpose; keep it out of the test output.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  onUnreadableFileKept(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const at = (...names: string[]) => path.join(dir, ...names);
const put = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};
/** The names next to `file` that are copies of it. */
const copiesOf = async (file: string) => (await readdir(path.dirname(file))).filter((name) => name.startsWith(`${path.basename(file)}.`) && !name.endsWith(".tmp")).sort();

const encryptor: Encryptor = {
  ready: async () => true,
  isAvailable: () => true,
  encrypt: async (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: async (data) => {
    const text = Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString();
    if (!text.startsWith("{") && !/^[A-Za-z0-9+/=]+$/.test(text)) throw new Error("sealed by someone else");
    return text;
  },
};

describe("readSavedFile", () => {
  it("gives null for a missing file and tells no one", async () => {
    const before = unreadableFilesKept();
    expect(await readSavedFile(at("missing.json"), { version: 1 })).toBeNull();
    expect(unreadableFilesKept()).toBe(before);
  });

  it("sets an unreadable file aside, tells the host and gives null", async () => {
    const heard = vi.fn();
    onUnreadableFileKept(heard);
    const before = unreadableFilesKept();
    for (const [name, text] of [
      ["broken.json", "{ not json"],
      ["list.json", "[1,2]"],
      ["null.json", "null"],
      ["text.json", '"text"'],
    ] as const) {
      await put(at(name), text);
      expect(await readSavedFile(at(name), { version: 1 })).toBeNull();
      const aside = await copiesOf(at(name));
      expect(aside).toHaveLength(1);
      expect(aside[0]).toMatch(/\.corrupt-\d+$/);
      expect(await readFile(at(aside[0]!), "utf8")).toBe(text);
    }
    expect(unreadableFilesKept()).toBe(before + 4);
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it("sets bookkeeping aside without telling the user", async () => {
    const before = unreadableFilesKept();
    await put(at("state.json"), "{");
    expect(await readSavedFile(at("state.json"), { version: 1, notice: false })).toBeNull();
    expect(await copiesOf(at("state.json"))).toHaveLength(1);
    expect(unreadableFilesKept()).toBe(before);
  });

  it("copies a newer Tavora's file aside, once per content, and still gives it to read", async () => {
    const file = at("data.json");
    await put(file, '{"version":3,"a":1}');
    expect(await readSavedFile(file, { version: 2 })).toEqual({ version: 3, a: 1 });
    expect(await readSavedFile(file, { version: 2 })).toEqual({ version: 3, a: 1 });
    expect(await copiesOf(file)).toEqual(["data.json.from-version-3"]);
    // The newer Tavora wrote it again: that one is kept too, and the first copy stays as it was.
    await put(file, '{"version":3,"a":2}');
    await readSavedFile(file, { version: 2 });
    expect(await copiesOf(file)).toEqual(["data.json.from-version-3", "data.json.from-version-3.2"]);
    expect(await readFile(`${file}.from-version-3`, "utf8")).toBe('{"version":3,"a":1}');
    expect(await readFile(file, "utf8")).toBe('{"version":3,"a":2}');
  });

  it("leaves a file of this version or older, or without a version, where it is", async () => {
    for (const text of ['{"version":2}', '{"version":1}', "{}", '{"version":"9"}']) {
      await put(at("data.json"), text);
      await readSavedFile(at("data.json"), { version: 2 });
    }
    expect(await copiesOf(at("data.json"))).toEqual([]);
  });

  it("reads the version from `v` when told to", async () => {
    await put(at("sealed.json"), '{"v":2,"data":"x"}');
    await readSavedFile(at("sealed.json"), { version: 1, versionKey: "v" });
    expect(await copiesOf(at("sealed.json"))).toEqual(["sealed.json.from-version-2"]);
  });

  it("throws for a file that can't be read right now, and never renames it", async () => {
    await mkdir(at("folder.json"));
    await expect(readSavedFile(at("folder.json"), { version: 1 })).rejects.toThrow();
    expect(await copiesOf(at("folder.json"))).toEqual([]);
  });

  it("checks text read elsewhere the same way", async () => {
    await put(at("ai.json"), "{");
    expect(await checkSavedFile(at("ai.json"), "{", { version: 2 })).toBeNull();
    expect((await copiesOf(at("ai.json")))[0]).toMatch(/\.corrupt-/);
  });

  it("tells the user once about a damaged file left in place, not at every read of it", async () => {
    await put(at("place.json"), "{");
    const before = unreadableFilesKept();
    expect(await readSavedFile(at("place.json"), { version: 1, leaveInPlace: true })).toBeNull();
    expect(await readSavedFile(at("place.json"), { version: 1, leaveInPlace: true })).toBeNull();
    expect(unreadableFilesKept() - before).toBe(1);
    expect(await readFile(at("place.json"), "utf8")).toBe("{");
  });
});

describe("a sealed file (sealed-file.ts)", () => {
  const open = (data: string) => {
    if (data !== "ok") throw new Error("doesn't open");
    return "opened";
  };
  const openAt = (file: string) => new SealedFile(file).open(open);

  it("opens a file of this version", async () => {
    await put(at("a.json"), '{"v":1,"data":"ok"}');
    expect(await openAt(at("a.json"))).toMatchObject({ status: "opened", value: "opened" });
    expect(await copiesOf(at("a.json"))).toEqual([]);
  });

  it("copies a newer one aside, leaving it in place", async () => {
    await put(at("a.json"), '{"v":2,"data":"new"}');
    expect(await openAt(at("a.json"))).toMatchObject({ status: "newer" });
    expect(await copiesOf(at("a.json"))).toEqual(["a.json.from-version-2"]);
    expect(await readFile(at("a.json"), "utf8")).toBe('{"v":2,"data":"new"}');
  });

  it("sets aside one that is damaged, under a name of its own each time, and tells the user", async () => {
    const before = unreadableFilesKept();
    // Set aside within the same millisecond: no copy takes another's name.
    for (const text of ["{", '{"v":1}', "[]"]) {
      await put(at("a.json"), text);
      expect(await openAt(at("a.json"))).toEqual({ status: "missing" });
    }
    const aside = (await copiesOf(at("a.json"))).filter((name) => name.includes(".corrupt-"));
    expect(aside).toHaveLength(3);
    expect((await Promise.all(aside.map((name) => readFile(at(name), "utf8")))).sort()).toEqual(['{"v":1}', "[]", "{"].sort());
    expect(unreadableFilesKept()).toBe(before + 3);
  });

  it("leaves one whose data doesn't open here where it is, for the next start, with a copy aside", async () => {
    const before = unreadableFilesKept();
    await put(at("a.json"), '{"v":1,"data":"other"}');
    expect(await openAt(at("a.json"))).toMatchObject({ status: "unopened" });
    expect(await openAt(at("a.json"))).toMatchObject({ status: "unopened" });
    expect(await readFile(at("a.json"), "utf8")).toBe('{"v":1,"data":"other"}');
    expect(await copiesOf(at("a.json"))).toEqual(["a.json.unopened"]);
    expect(unreadableFilesKept()).toBe(before);
  });

  it("forgets a sealed file together with every copy of it", async () => {
    await put(at("a.json"), '{"v":2,"data":"new"}');
    await openAt(at("a.json"));
    await put(at("a.json"), '{"v":1,"data":"other"}');
    await openAt(at("a.json"));
    await put(at("a.json"), "{");
    await openAt(at("a.json"));
    await put(at("a.json"), '{"v":1,"data":"ok"}');
    await put(at("a.json.unrelated"), "keep");
    expect((await copiesOf(at("a.json"))).length).toBe(4);
    await forgetSealedFile(at("a.json"));
    expect(await readdir(dir)).toEqual(["a.json.unrelated"]);
  });

  it("reads a missing one as missing, quietly", async () => {
    expect(await openAt(at("none.json"))).toEqual({ status: "missing" });
  });

  it("writes the version first, then the sealed data and the store's own fields", async () => {
    await new SealedFile(at("a.json")).write({ data: "ok", account: null });
    expect(await readFile(at("a.json"), "utf8")).toBe('{"v":1,"data":"ok","account":null}');
  });
});

describe("setAside", () => {
  it("never takes a name another copy has", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (const text of ["1", "2", "3"]) {
      await put(at("b.json"), text);
      await setAside(at("b.json"));
    }
    expect(await copiesOf(at("b.json"))).toEqual(["b.json.corrupt-1000", "b.json.corrupt-1000-2", "b.json.corrupt-1000-3"]);
    expect(await readFile(at("b.json.corrupt-1000"), "utf8")).toBe("1");
  });
});

/** Every file of the user's, with how its store reads it. */
const STORES: { name: string; file: () => string; version: number; versionKey?: "v"; load: () => Promise<unknown> }[] = [
  { name: "library.json", file: () => at("library.json"), version: SUPPORTED_VERSIONS["library.json"], load: () => loadLibrary(dir) },
  { name: "workspace.json", file: () => at("workspace.json"), version: SUPPORTED_VERSIONS["workspace.json"], load: () => loadWorkspace(at("workspace.json"), ["poe2"], () => true) },
  { name: "profile.json", file: () => at("profile.json"), version: SUPPORTED_VERSIONS["profile.json"], load: () => new SavedData(dir).loadProfile() },
  { name: "grants.json", file: () => at("grants.json"), version: SUPPORTED_VERSIONS["grants.json"], load: () => GrantStore.load(dir) },
  { name: "hotkeys.json", file: () => at("hotkeys.json"), version: SUPPORTED_VERSIONS["hotkeys.json"], load: () => HotkeyStore.load(dir) },
  { name: "overlays.json", file: () => at("overlays.json"), version: SUPPORTED_VERSIONS["overlays.json"], load: () => OverlayStore.load(dir) },
  { name: "game-overlays.json", file: () => at("game-overlays.json"), version: SUPPORTED_VERSIONS["game-overlays.json"], load: () => GameOverlayStore.load(dir) },
  { name: "module-owners.json", file: () => at("module-owners.json"), version: SUPPORTED_VERSIONS["module-owners.json"], load: () => readOwnerRecords(dir) },
  { name: "official-updates.json", file: () => at("official-updates.json"), version: SUPPORTED_VERSIONS["official-updates.json"], load: () => readOfficialRecords(dir) },
  { name: "connection.json", file: () => at("connection.json"), version: SUPPORTED_VERSIONS["connection.json"], load: () => new ConnectionFile(at("connection.json")).load() },
  { name: "traffic.json", file: () => at("traffic.json"), version: SUPPORTED_VERSIONS["traffic.json"], load: () => new TrafficFile(at("traffic.json")).load() },
  {
    name: "module-data-pending.json",
    file: () => at("module-data-pending.json"),
    version: SUPPORTED_VERSIONS["module-data-pending.json"],
    load: () => queueLocalDataMove(dir, "local.notes", "0123456789abcdef0123456789abcdef"),
  },
  { name: "module settings", file: () => at("module-data", "local", "local.notes", "poe2", "storage.json"), version: STORE_VERSIONS.moduleSettings, load: () => new ModuleStore(at("module-data", "local", "local.notes", "poe2", "storage.json")).keys() },
  { name: "panel state (read)", file: () => at("panel-state", "22222222-2222-4222-8222-222222222222.json"), version: STORE_VERSIONS.panelState, load: () => new PanelStateStore(at("panel-state")).get("22222222-2222-4222-8222-222222222222") },
  { name: "panel state (written)", file: () => at("panel-state", "22222222-2222-4222-8222-222222222222.json"), version: STORE_VERSIONS.panelState, load: () => new PanelStateStore(at("panel-state")).set("22222222-2222-4222-8222-222222222222", { open: true }) },
  { name: "a document", file: () => at("documents", "doc-1.json"), version: STORE_VERSIONS.document, load: () => new DocumentStore(at("documents")).list() },
  { name: "chosen folders", file: () => at("folder-access", "local", "local.game", "folders.json"), version: STORE_VERSIONS.chosenFolders, load: () => new ChosenFolders(dir, "local", "local.game").set("Documents/My Games", dir) },
  { name: "account.json", file: () => at("account.json"), version: STORE_VERSIONS.sealed, versionKey: "v", load: () => new AccountFile(at("account.json"), encryptor).load() },
  { name: "discord.json", file: () => at("discord.json"), version: STORE_VERSIONS.sealed, versionKey: "v", load: () => new DiscordSecretsFile(at("discord.json"), encryptor).load() },
  {
    name: "cloud-copy-key.json",
    file: () => at("cloud-copy-key.json"),
    version: STORE_VERSIONS.sealed,
    versionKey: "v",
    load: () => new AccountKey({ file: at("cloud-copy-key.json"), encryptor, baseUrl: "http://localhost/v1/account", fetch, token: () => null, account: () => null }).load(),
  },
];

describe("each file of the user's", () => {
  it.each(STORES)("$name: a newer Tavora's file is copied aside before anything is written", async ({ file, version, versionKey, load }) => {
    const text = JSON.stringify({ [versionKey ?? "version"]: version + 1, data: "from the future", somethingNew: { kept: true } });
    await put(file(), text);
    await load();
    expect(await readFile(`${file()}.from-version-${version + 1}`, "utf8")).toBe(text);
  });

  it.each(STORES)("$name: an unreadable file is set aside, never written over, and the user is told", async ({ file, load }) => {
    const before = unreadableFilesKept();
    await put(file(), "{ damaged");
    await load();
    const aside = (await copiesOf(file())).filter((name) => name.includes(".corrupt-"));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(file()), aside[0]!), "utf8")).toBe("{ damaged");
    expect(unreadableFilesKept()).toBe(before + 1);
  });

  it("the cloud copy's state is copied aside quietly and stays, as its being there says the copy is on", async () => {
    const before = unreadableFilesKept();
    await put(at("cloud-copy.json"), "{");
    expect((await loadCopyState(at("cloud-copy.json"))).version).toBe(0);
    expect((await loadCopyState(at("cloud-copy.json"))).version).toBe(0);
    expect(await copiesOf(at("cloud-copy.json"))).toEqual(["cloud-copy.json.corrupt"]);
    expect(await readFile(at("cloud-copy.json"), "utf8")).toBe("{");
    expect(unreadableFilesKept()).toBe(before);
    await put(at("cloud-copy.json"), '{"v":2,"version":5,"files":{}}');
    await loadCopyState(at("cloud-copy.json"));
    expect(await copiesOf(at("cloud-copy.json"))).toContain("cloud-copy.json.from-version-2");
  });

  it.each([
    ["connection.json", () => new ConnectionFile(at("connection.json")), (file: ConnectionFile) => file.save({ enabled: true, target: "1.1.1.1", outages: [], savedAt: 1 } as never)],
    ["traffic.json", () => new TrafficFile(at("traffic.json")), (file: TrafficFile) => file.save([])],
  ] as const)("%s: one that can't be read right now is never written over this run", async (name, make, save) => {
    // A folder in its place can't be read as a file.
    await mkdir(at(name));
    const store = make() as never;
    await (store as { load(): Promise<unknown> }).load();
    await rm(at(name), { recursive: true });
    (save as (file: never) => void)(store);
    await (store as { flush?(): Promise<void> }).flush?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await readdir(dir)).not.toContain(name);
  });

  it("a profile without a usable id is set aside before a new id is made", async () => {
    await put(at("profile.json"), '{"version":1,"id":"not-an-id","name":"Nik"}');
    const loaded = await new SavedData(dir).loadProfile();
    expect(loaded.saved).toBe(false);
    expect((await copiesOf(at("profile.json")))[0]).toMatch(/\.corrupt-/);
  });

  it("a workspace file that can't be read right now stops the load instead of starting empty", async () => {
    await mkdir(at("workspace.json"));
    await expect(loadWorkspace(at("workspace.json"), ["poe2"], () => true)).rejects.toThrow();
  });
});

describe("the files keep their version", () => {
  it("SavedData.keepNewerFiles copies aside every file of the data folder a newer Tavora wrote", async () => {
    for (const [name, version] of Object.entries(SUPPORTED_VERSIONS)) await put(at(name), JSON.stringify({ version: version + 1 }));
    await new SavedData(dir).keepNewerFiles();
    for (const [name, version] of Object.entries(SUPPORTED_VERSIONS)) expect(await copiesOf(at(name))).toEqual([`${name}.from-version-${version + 1}`]);
  });

  it("chosen folders: the version sits next to the folders, which Tavora 0.24 reads as before", async () => {
    const chosen = new ChosenFolders(dir, "local", "local.game");
    await chosen.set("Documents/My Games", dir);
    const saved = JSON.parse(await readFile(at("folder-access", "local", "local.game", "folders.json"), "utf8")) as Record<string, unknown>;
    expect(saved).toEqual({ version: STORE_VERSIONS.chosenFolders, "Documents/My Games": dir });
    // 0.24 keeps only string values that are absolute paths, so it skips the version and keeps every folder.
    expect(Object.entries(saved).filter(([, value]) => typeof value === "string" && path.isAbsolute(value))).toEqual([["Documents/My Games", dir]]);
    expect(await chosen.get("Documents/My Games")).toBe(dir);
    // A file 0.24 wrote, without a version, still reads.
    await put(at("folder-access", "local", "local.game", "folders.json"), JSON.stringify({ "Documents/Old": dir }));
    expect(await chosen.get("Documents/Old")).toBe(dir);
  });

  it("read-only files: every entry has the version, and nothing else is in the file, as Tavora 0.24 requires", async () => {
    const files = new ReadOnlyFiles(dir, "local", "local.game", "poe2");
    await put(at("save.txt"), "save");
    const { id } = await files.remember(at("save.txt"));
    const file = at("read-only-files", "local", "local.game", "poe2", "sources.json");
    const saved = JSON.parse(await readFile(file, "utf8")) as Record<string, Record<string, unknown>>;
    expect(Object.keys(saved)).toEqual([id]);
    expect(saved[id]).toMatchObject({ name: "save.txt", version: STORE_VERSIONS.readOnlyFiles });
    // An entry 0.24 wrote, without a version, gets one the next time the file is written.
    const old = "0123456789abcdef0123456789abcdef";
    await writeFile(file, JSON.stringify({ ...saved, [old]: { path: at("save.txt"), target: saved[id]!.target, name: "old.txt" } }));
    await files.forget(id);
    expect(JSON.parse(await readFile(file, "utf8"))[old]).toMatchObject({ name: "old.txt", version: STORE_VERSIONS.readOnlyFiles });
  });

  it("read-only files: a newer entry copies the file aside; a damaged file is set aside before the links start again", async () => {
    const files = new ReadOnlyFiles(dir, "local", "local.game", "poe2");
    const file = at("read-only-files", "local", "local.game", "poe2", "sources.json");
    const newer = JSON.stringify({ "0123456789abcdef0123456789abcdef": { path: at("save.txt"), target: at("save.txt"), name: "save.txt", version: 2 } });
    await put(file, newer);
    expect(await files.check("0123456789abcdef0123456789abcdef")).toMatchObject({ found: false });
    expect(await readFile(`${file}.from-version-2`, "utf8")).toBe(newer);
    await put(file, "{ damaged");
    // Reading alone never starts again: it only says the links can't be used.
    await expect(files.check("0123456789abcdef0123456789abcdef")).rejects.toThrow();
    expect((await copiesOf(file)).filter((name) => name.includes(".corrupt-"))).toEqual([]);
    await put(at("save.txt"), "save");
    await files.remember(at("save.txt"));
    const aside = (await copiesOf(file)).filter((name) => name.includes(".corrupt-"));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(file), aside[0]!), "utf8")).toBe("{ damaged");
  });

  it("module data waiting for the next start has a version that Tavora 0.24 skips", async () => {
    await queueLocalDataMove(dir, "local.notes", "0123456789abcdef0123456789abcdef");
    const saved = JSON.parse(await readFile(at("module-data-pending.json"), "utf8")) as Record<string, unknown>;
    expect(saved).toMatchObject({ version: SUPPORTED_VERSIONS["module-data-pending.json"], moves: [{ moduleId: "local.notes", to: "0123456789abcdef0123456789abcdef" }] });
  });

  it("the sealed files say `v`, and an account saved now opens again", async () => {
    await new AccountFile(at("account.json"), encryptor).save({ token: "t".repeat(43), email: "me@example.com", discord: null, createdAt: "2026-10-16T12:00:00.000Z" });
    expect(JSON.parse(await readFile(at("account.json"), "utf8")).v).toBe(STORE_VERSIONS.sealed);
    expect(await new AccountFile(at("account.json"), encryptor).load()).toMatchObject({ email: "me@example.com" });
  });

  it("a document written over a newer Tavora's copies it aside first", async () => {
    const store = new DocumentStore(at("documents"));
    await store.put({ id: "doc-1", title: "Mine", data: { a: 1 } });
    const newer = JSON.stringify({ version: STORE_VERSIONS.document + 1, id: "doc-1", title: "Mine", revision: 1, updatedAt: "2026-11-14T00:00:00.000Z", data: { future: true } });
    await writeFile(at("documents", "doc-1.json"), newer);
    // A new store, as at the next start: the index still lists the document.
    await new DocumentStore(at("documents")).put({ id: "doc-1", title: "Mine", data: { a: 2 } });
    expect(await readFile(at("documents", `doc-1.json.from-version-${STORE_VERSIONS.document + 1}`), "utf8")).toBe(newer);
  });
});

describe("changes from two places at once", () => {
  it("chosen folders: two set at once both land", async () => {
    const folders = new ChosenFolders(dir, "local", "local.game");
    await Promise.all([folders.set("Documents/My Games/A", at("A")), new ChosenFolders(dir, "local", "local.game").set("Documents/My Games/B", at("B"))]);
    expect(await folders.get("Documents/My Games/A")).toBe(at("A"));
    expect(await folders.get("Documents/My Games/B")).toBe(at("B"));
  });
});

describe("what a store keeps open", () => {
  it("a document deleted keeps nothing of its file, and one of the same id starts afresh", async () => {
    const store = new DocumentStore(at("documents"));
    const files = (store as unknown as { files: Map<string, unknown> }).files;
    await store.put({ id: "a", title: "A", data: 1 });
    expect(files.size).toBe(1);
    await store.delete("a");
    expect(files.size).toBe(0);
    await store.put({ id: "a", title: "A again", data: 2 });
    expect(await store.get("a")).toMatchObject({ title: "A again", revision: 1, data: 2 });
  });
});
