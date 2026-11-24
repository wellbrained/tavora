// The sealed files (the sign-in, Discord's sign-in, the account's keys) by the rule decided 2026-11-23, "a saved file
// that can't be read is never written over": one that can't be read for a moment (EBUSY, EPERM: a virus scan, a sync
// app) or for good (its rights changed) is never written over or removed, and no new key is made in its place; the
// user is never stuck with one either (a sign-in moves it aside, a key asks for the recovery key or starts over). One
// truly missing is made as before; a damaged one is set aside; a newer Tavora's is copied aside.
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountFile, type SavedAccount } from "./account";
import { AccountKey } from "./account-key";
import { DiscordSecretsFile, type Encryptor } from "./discord-store";
import { SavedFileHeld } from "./saved-file";
import { onSealedFileHeld, sealedFilesHeld } from "./sealed-file";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile), rename: vi.fn(real.rename), rm: vi.fn(real.rm), stat: vi.fn(real.stat) };
});

const realReadFile = vi.mocked(readFile).getMockImplementation()!;
const realRename = vi.mocked(rename).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
const realRm = vi.mocked(rm).getMockImplementation()!;
const readText = async (file: string) => String(await realReadFile(file, "utf8"));
/** The files that can't be read right now, and with which error. */
const busy = new Map<string, string>();
/** The files that can't be moved (renamed away) right now. */
const stuck = new Set<string>();
/** The files that can't be looked at (stat) right now. */
const unseen = new Set<string>();
/** Which files can't be removed right now. */
let unremovable: (file: string) => boolean = () => false;
/** Reads of a file that wait until its gate opens. */
const gated = new Map<string, Promise<void>>();

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-sealed-held-"));
  busy.clear();
  stuck.clear();
  unseen.clear();
  gated.clear();
  const error = (code: string) => Object.assign(new Error(`${code}: busy`), { code });
  vi.mocked(readFile).mockImplementation((async (file: string, options: never) => {
    const key = path.resolve(String(file));
    await gated.get(key);
    const code = busy.get(key);
    // Held where it is: once moved away, the place reads as missing, as on a real disk.
    if (code && (await realStat(key).then(() => true, () => false))) throw error(code);
    return realReadFile(file, options);
  }) as never);
  vi.mocked(rename).mockImplementation((async (from: string, to: string) => {
    if (stuck.has(path.resolve(String(from)))) throw error("EBUSY");
    return realRename(from, to);
  }) as never);
  unremovable = () => false;
  vi.mocked(rm).mockImplementation((async (file: string, options: never) => {
    const key = path.resolve(String(file));
    if (unremovable(key) && (await realStat(key).then(() => true, () => false))) throw error("EBUSY");
    return realRm(file, options);
  }) as never);
  vi.mocked(stat).mockImplementation((async (file: string, options: never) => {
    if (unseen.has(path.resolve(String(file)))) throw error("EPERM");
    return realStat(file, options);
  }) as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  busy.clear();
  stuck.clear();
  unseen.clear();
  gated.clear();
  unremovable = () => false;
  onSealedFileHeld(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const at = (name: string) => path.join(dir, name);
const hold = (name: string, code = "EBUSY") => busy.set(path.resolve(at(name)), code);
const free = (name: string) => busy.delete(path.resolve(at(name)));
/** Every file in the folder and what it holds, the times in names hidden. */
async function files(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) found[name.replace(/\.(corrupt|held)-\d+/, ".$1-<time>")] = await readText(at(name));
  return found;
}

const seal = (text: string) => Buffer.from(`sealed:${text}`).toString("base64");
const encryptor: Encryptor = {
  ready: async () => true,
  isAvailable: () => true,
  encrypt: async (text) => Buffer.from(`sealed:${text}`),
  decrypt: async (data) => {
    const text = data.toString();
    if (!text.startsWith("sealed:")) throw new Error("sealed by another user");
    return text.slice("sealed:".length);
  },
};
/** A sealed file whose data another Windows user sealed: it reads, but doesn't open here. */
const OTHER_USER = JSON.stringify({ v: 1, data: Buffer.from("someone else's").toString("base64") });

const ACCOUNT: SavedAccount = { token: "t".repeat(24), email: "nik@example.com", discord: null, createdAt: "2026-11-01T00:00:00.000Z" };
const OLD_ACCOUNT: SavedAccount = { ...ACCOUNT, token: "o".repeat(24), email: "old@example.com" };
const TOKEN = { accessToken: "a", refreshToken: "r", expiresAt: 1 };
const OLD_TOKEN = { accessToken: "x", refreshToken: "y", expiresAt: 2 };

/** A store of a sealed sign-in, opened once and then saved with, as at a start of Tavora. */
interface Store {
  file: string;
  /** What Tavora wrote for the user before. */
  before: string;
  /** What the store reads when signed out. */
  signedOut: unknown;
  load(): Promise<unknown>;
  /** Signs in: writes the sign-in. */
  save(): Promise<unknown>;
  /** Signs out: removes the file. */
  forget(): Promise<unknown>;
}

function store(file: string): Store {
  if (file === "account.json") {
    const account = new AccountFile(at(file), encryptor);
    return {
      file,
      before: JSON.stringify({ v: 1, data: seal(JSON.stringify(OLD_ACCOUNT)) }),
      signedOut: null,
      load: () => account.load(),
      save: () => account.save(ACCOUNT),
      forget: () => account.save(null),
    };
  }
  const discord = new DiscordSecretsFile(at(file), encryptor);
  return {
    file,
    before: JSON.stringify({ v: 1, data: seal(JSON.stringify({ token: OLD_TOKEN, last: null, games: {} })) }),
    signedOut: { token: null, last: null, games: {} },
    load: () => discord.load(),
    save: () => discord.save({ token: TOKEN, last: null, games: {} }),
    forget: () => discord.save({ token: null }),
  };
}

describe.each(["account.json", "discord.json"])("%s", (name) => {
  for (const code of ["EBUSY", "EPERM"]) {
    it(`${code} on read: read as signed out; signing in moves it aside, kept, never written over`, async () => {
      const opened = store(name);
      await writeFile(at(name), opened.before);
      hold(name, code);
      expect(await opened.load()).toEqual(opened.signedOut);
      await opened.save();
      const found = await files();
      expect(found[`${name}.held-<time>`]).toBe(opened.before);
      expect(Object.keys(found)).toEqual([name, `${name}.held-<time>`]);
      expect(found[name]).not.toBe(opened.before);
    });

    it(`${code} on read: signing out moves it aside, so it never signs in again by itself, and the copy goes as far as it can`, async () => {
      const opened = store(name);
      await writeFile(at(name), opened.before);
      hold(name, code);
      await opened.load();
      // Removing the copy fails too: it stays, for the next sign-out.
      unremovable = (file) => path.basename(file).startsWith(`${name}.held-`);
      await opened.forget();
      expect(await files()).toEqual({ [`${name}.held-<time>`]: opened.before });
      unremovable = () => false;
      await opened.forget();
      expect(await files()).toEqual({});
    });

    it(`${code} on read, and it can't be moved either: nothing is written or removed, and the user is told`, async () => {
      const opened = store(name);
      await writeFile(at(name), opened.before);
      hold(name, code);
      stuck.add(path.resolve(at(name)));
      const told = vi.fn();
      onSealedFileHeld(told);
      const before = sealedFilesHeld();
      await opened.load();
      await expect(opened.save()).rejects.toBeInstanceOf(SavedFileHeld);
      await expect(opened.forget()).rejects.toBeInstanceOf(SavedFileHeld);
      expect(await files()).toEqual({ [name]: opened.before });
      expect(sealedFilesHeld()).toBe(before + 1);
      expect(told).toHaveBeenCalledTimes(1);
      // Readable again: the next save reads it first, and then writes in its place.
      free(name);
      await opened.save();
      expect(Object.keys(await files())).toEqual([name]);
      expect(await readText(at(name))).not.toBe(opened.before);
    });
  }

  it("a sign-in moved aside goes at the next sign-out", async () => {
    const opened = store(name);
    await writeFile(at(name), opened.before);
    hold(name);
    await opened.load();
    await opened.save();
    expect(Object.keys(await files())).toEqual([name, `${name}.held-<time>`]);
    free(name);
    await opened.forget();
    expect(await files()).toEqual({});
  });

  it("read, but it can't be removed at sign-out: it moves aside instead, and goes from there", async () => {
    const opened = store(name);
    await writeFile(at(name), opened.before);
    await opened.load();
    unremovable = (file) => file === path.resolve(at(name));
    await opened.forget();
    expect(await files()).toEqual({});
  });

  it("truly missing: made as before", async () => {
    const opened = store(name);
    await opened.load();
    await opened.save();
    expect(Object.keys(await files())).toEqual([name]);
    expect(JSON.parse(await readText(at(name)))).toMatchObject({ v: 1, data: expect.any(String) });
  });

  it("damaged: set aside, and a new one made", async () => {
    await writeFile(at(name), '{"v":1}');
    const opened = store(name);
    await opened.load();
    await opened.save();
    expect(Object.keys(await files())).toEqual([name, `${name}.corrupt-<time>`]);
    expect((await files())[`${name}.corrupt-<time>`]).toBe('{"v":1}');
  });

  it("from a newer Tavora: copied aside before it is written", async () => {
    const newer = JSON.stringify({ v: 2, data: "sealed anew", more: true });
    await writeFile(at(name), newer);
    const opened = store(name);
    await opened.load();
    await opened.save();
    expect((await files())[`${name}.from-version-2`]).toBe(newer);
  });
});

// ── The account's keys ───────────────────────────────────────────────

const KEY = Buffer.alloc(32, 1);
const keyFile = (key: Buffer, account: string | null) => JSON.stringify({ v: 1, data: seal(key.toString("base64")), account });

/**
 * The account's key on this PC, with the service answering that the account has no vault yet. `put`: waited for before
 * the service answers a vault put.
 */
function accountKey(signed: { now: string | null } = { now: null }, extra: { maxOtherKeys?: number } = {}, put?: () => Promise<void>): AccountKey {
  const fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method !== "PUT") return new Response(null, { status: 404 });
    await put?.();
    return new Response(null, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return new AccountKey({
    file: at("account-key.json"),
    legacyFile: at("cloud-copy-key.json"),
    cacheFile: at("account-vault.bin"),
    seenFile: at("account-vault-seen"),
    encryptor,
    baseUrl: "http://tavora.test/v1/account",
    fetch,
    token: () => (signed.now ? "token" : null),
    account: () => signed.now,
    ...extra,
  });
}

const ASK = { status: "ask" };

describe("account-key.json", () => {
  for (const code of ["EBUSY", "EPERM", "EACCES"]) {
    it(`${code} on read: no new key is made, the recovery key is asked for and why, and the key is used once it reads again`, async () => {
      const kept = keyFile(KEY, null);
      await writeFile(at("account-key.json"), kept);
      hold("account-key.json", code);
      const key = accountKey();
      expect(await key.load()).toBeNull();
      expect(await key.setUpHere(false)).toEqual(ASK);
      expect(key.keyBlocked).toBe(true);
      expect(await files()).toEqual({ "account-key.json": kept });
      free("account-key.json");
      expect(await key.setUpHere(false)).toEqual({ status: "ready", created: false });
      expect(key.copyKey()).toEqual(KEY);
      expect(key.keyBlocked).toBe(false);
      expect(await files()).toEqual({ "account-key.json": kept });
    });
  }

  it("held for good: Start over moves it aside, never removes it, and makes a new key", async () => {
    const kept = keyFile(KEY, null);
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json", "EACCES");
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual(ASK);
    await key.startOverHere();
    const found = await files();
    expect(found["account-key.unopened.json"]).toBe(kept);
    expect(JSON.parse(found["account-key.json"]!)).toMatchObject({ v: 1, account: null });
    expect(key.copyKey()?.equals(KEY)).toBe(false);
  });

  it("held, and it can't be moved aside either: Start over says so, and nothing is written or removed", async () => {
    const kept = keyFile(KEY, null);
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json");
    stuck.add(path.resolve(at("account-key.json")));
    const key = accountKey();
    await key.load();
    await expect(key.startOverHere()).rejects.toMatchObject({ key: "cloudCopy.error.keyStuck" });
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("EBUSY on read, signed in: no new key is made for the account either", async () => {
    const kept = keyFile(KEY, "account-a");
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json");
    const key = accountKey({ now: "account-a" });
    await key.load();
    expect(await key.setUp()).toEqual(ASK);
    expect(key.keyBlocked).toBe(true);
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("EBUSY on another account's own key file, signed in as it: no new key is made beside it", async () => {
    const copyKey = keyFile(Buffer.alloc(32, 2), "account-a");
    const kept = keyFile(KEY, "account-b");
    await writeFile(at("account-key.json"), copyKey);
    await writeFile(at("account-key.account-b.json"), kept);
    hold("account-key.account-b.json");
    const key = accountKey({ now: "account-b" });
    await key.load();
    expect(await key.setUp()).toEqual(ASK);
    expect(await files()).toEqual({ "account-key.account-b.json": kept, "account-key.json": copyKey });
  });

  it("one moved aside already that may be the account's: no new key is made while it can't be opened", async () => {
    const aside = keyFile(KEY, null);
    await writeFile(at("account-key.unopened.json"), aside);
    hold("account-key.unopened.json");
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual(ASK);
    expect(await files()).toEqual({ "account-key.unopened.json": aside });
    // Another account's moved aside (its record says whose, outside the seal) doesn't stop this one.
    free("account-key.unopened.json");
    await writeFile(at("account-key.unopened.json"), JSON.stringify({ v: 1, data: Buffer.from("not here").toString("base64"), account: "account-z" }));
    const other = accountKey();
    await other.load();
    expect(await other.setUpHere(false)).toEqual({ status: "ready", created: true });
  });

  it("a key that is written reads the file first: one that can't be read then is never written over", async () => {
    const key = accountKey();
    await key.load();
    const kept = keyFile(KEY, null);
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json");
    // Typed in: the file came meanwhile, and can't be read.
    await expect(key.takeHere(Buffer.alloc(32, 3))).rejects.toBeInstanceOf(SavedFileHeld);
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("its data doesn't open here (another Windows user): the recovery key is asked for, nothing is made", async () => {
    await writeFile(at("account-key.json"), OTHER_USER);
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual(ASK);
    expect(key.keyBlocked).toBe(true);
    expect(await files()).toEqual({ "account-key.json": OTHER_USER, "account-key.json.unopened": OTHER_USER });
  });

  it("truly missing: a new key is made, as before", async () => {
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual({ status: "ready", created: true });
    expect(JSON.parse((await files())["account-key.json"]!)).toMatchObject({ v: 1, account: null });
  });

  it("truly missing, signed in: a new key is made for the account, as before", async () => {
    const key = accountKey({ now: "account-a" });
    await key.load();
    expect(await key.setUp()).toEqual({ status: "ready", created: true });
    expect(JSON.parse((await files())["account-key.json"]!)).toMatchObject({ v: 1, account: "account-a" });
  });

  it("damaged: set aside, and a new key made, as before", async () => {
    await writeFile(at("account-key.json"), "{ damaged");
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual({ status: "ready", created: true });
    const found = await files();
    expect(found["account-key.json.corrupt-<time>"]).toBe("{ damaged");
    expect(JSON.parse(found["account-key.json"]!)).toMatchObject({ v: 1, account: null });
  });

  it("from a newer Tavora: copied aside, the recovery key is asked for, nothing is made", async () => {
    const newer = JSON.stringify({ v: 2, data: "sealed anew", account: null });
    await writeFile(at("account-key.json"), newer);
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual(ASK);
    expect(await files()).toEqual({ "account-key.json": newer, "account-key.json.from-version-2": newer });
  });

  it("from a newer Tavora, signed in: the recovery key is asked for, no new key is made for the account", async () => {
    const newer = JSON.stringify({ v: 2, data: "sealed anew", account: "account-a" });
    await writeFile(at("account-key.json"), newer);
    const key = accountKey({ now: "account-a" });
    await key.load();
    expect(await key.setUp()).toEqual(ASK);
    expect(await files()).toEqual({ "account-key.json": newer, "account-key.json.from-version-2": newer });
  });

  it("signed out while a new key's vault goes up: nothing of it is noted on this PC", async () => {
    const signed: { now: string | null } = { now: "account-a" };
    let sending!: () => void;
    let answer!: () => void;
    const sent = new Promise<void>((resolve) => (sending = resolve));
    const key = accountKey(signed, {}, () => {
      sending();
      return new Promise<void>((resolve) => (answer = resolve));
    });
    await key.load();
    const setUp = key.setUp();
    await sent;
    signed.now = null;
    await key.forget();
    answer();
    await expect(setUp).rejects.toMatchObject({ reason: "signed-out" });
    expect(await files()).toEqual({});
  });

  it("reading a key file again reads only that file: the copy's key, readable at start, stays", async () => {
    const copyKey = Buffer.alloc(32, 2);
    await writeFile(at("account-key.json"), keyFile(copyKey, "account-a"));
    await writeFile(at("account-key.account-b.json"), keyFile(KEY, "account-b"));
    hold("account-key.account-b.json");
    const signed: { now: string | null } = { now: "account-b" };
    const key = accountKey(signed);
    await key.load();
    // Held now too: what was read at start stays as it was.
    hold("account-key.json");
    expect(await key.setUp()).toEqual(ASK);
    signed.now = "account-a";
    expect(key.get()).toEqual(copyKey);
  });

  it("one moved aside in this run still keeps a new key from being made", async () => {
    // The copy's key file, sealed by another Windows user; B's own key, readable.
    await writeFile(at("account-key.json"), OTHER_USER);
    await writeFile(at("account-key.account-b.json"), keyFile(KEY, "account-b"));
    const signed: { now: string | null } = { now: "account-b" };
    const key = accountKey(signed);
    await key.load();
    expect(await key.setUp()).toEqual({ status: "ready", created: false });
    // B's key becomes the copy's: the file that couldn't be opened moves aside, as it is.
    await key.useForCopy();
    expect((await files())["account-key.unopened.json"]).toBe(OTHER_USER);
    signed.now = null;
    expect(await key.setUpHere(false)).toEqual(ASK);
  });

  it("a key file moving aside never lands on one that can't be looked at right now", async () => {
    const earlier = keyFile(Buffer.alloc(32, 5), null);
    await writeFile(at("account-key.json"), OTHER_USER);
    await writeFile(at("account-key.unopened.json"), earlier);
    // Neither read nor looked at right now: only its being there may keep the move off it.
    hold("account-key.unopened.json");
    unseen.add(path.resolve(at("account-key.unopened.json")));
    const key = accountKey();
    await key.load();
    await key.startOverHere();
    unseen.clear();
    const found = await files();
    expect(found["account-key.unopened.json"]).toBe(earlier);
    expect(found["account-key.unopened-2.json"]).toBe(OTHER_USER);
  });
});

describe("cloud-copy-key.json (the key's older file)", () => {
  it("EBUSY on read: no new key is made in account-key.json beside it", async () => {
    const kept = keyFile(KEY, null);
    await writeFile(at("cloud-copy-key.json"), kept);
    hold("cloud-copy-key.json");
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual(ASK);
    expect(await files()).toEqual({ "cloud-copy-key.json": kept });
    free("cloud-copy-key.json");
    expect(await key.setUpHere(false)).toEqual({ status: "ready", created: false });
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("is never moved onto an account-key.json that can't be read right now", async () => {
    const held = keyFile(KEY, null);
    const legacy = keyFile(Buffer.alloc(32, 4), null);
    await writeFile(at("account-key.json"), held);
    await writeFile(at("cloud-copy-key.json"), legacy);
    hold("account-key.json");
    await accountKey().load();
    expect(await files()).toEqual({ "account-key.json": held, "cloud-copy-key.json": legacy });
  });

  it("account-key.json came after start, while the older file was held: that one is used, the older one never moved onto it", async () => {
    const legacy = keyFile(Buffer.alloc(32, 4), null);
    await writeFile(at("cloud-copy-key.json"), legacy);
    hold("cloud-copy-key.json");
    const key = accountKey();
    await key.load();
    free("cloud-copy-key.json");
    // Another Tavora (or a restore) put one there meanwhile.
    const now = keyFile(Buffer.alloc(32, 7), null);
    await writeFile(at("account-key.json"), now);
    expect(await key.setUpHere(false)).toEqual({ status: "ready", created: false });
    expect(key.copyKey()).toEqual(Buffer.alloc(32, 7));
    expect(await files()).toEqual({ "account-key.json": now, "cloud-copy-key.json": legacy });
  });

  it("truly missing account-key.json: the older file moves in, as before", async () => {
    const legacy = keyFile(KEY, null);
    await writeFile(at("cloud-copy-key.json"), legacy);
    const key = accountKey();
    expect(await key.load()).toEqual(KEY);
    expect(await files()).toEqual({ "account-key.json": legacy });
  });

  it("read again while a key another PC sends comes in: one change at a time, and the key sent is kept", async () => {
    const legacy = keyFile(Buffer.alloc(32, 4), null);
    await writeFile(at("cloud-copy-key.json"), legacy);
    hold("cloud-copy-key.json");
    const key = accountKey();
    await key.load();
    free("cloud-copy-key.json");
    let open!: () => void;
    gated.set(path.resolve(at("cloud-copy-key.json")), new Promise<void>((resolve) => (open = resolve)));
    const sent = Buffer.alloc(32, 9);
    // The folder copy turned on (its older key file read again, slowly), and pairing's key arriving meanwhile.
    const turnOn = key.setUpHere(false);
    const taken = key.takeHere(sent);
    open();
    expect(await turnOn).toEqual({ status: "ready", created: false });
    await taken;
    expect(key.copyKey()).toEqual(sent);
    const found = await files();
    expect(found["account-key.json"]).toBe(keyFile(sent, null));
    // The older key moved aside before the sent one took its place: kept.
    expect(found["account-key.unproven.json"]).toBe(legacy);
  });
});

describe("the account's vault as last read", () => {
  it("can't be read right now: it is not taken for missing, and stays", async () => {
    await writeFile(at("account-key.json"), keyFile(KEY, "account-a"));
    await writeFile(at("account-vault.bin"), "a sealed vault");
    hold("account-vault.bin");
    const key = accountKey({ now: "account-a" });
    await key.load();
    // Gone from the service: what this PC last read would go back, or an empty one be made, were it missing.
    await expect(key.change((content) => content)).rejects.toMatchObject({ reason: "failed" });
    expect((await files())["account-vault.bin"]).toBe("a sealed vault");
  });

  it("can't be read right now: its key is never pruned to make room for another account's", async () => {
    await writeFile(at("account-key.json"), keyFile(Buffer.alloc(32, 2), "account-a"));
    const b = keyFile(KEY, "account-b");
    await writeFile(at("account-key.account-b.json"), b);
    await writeFile(at("account-vault.account-b.bin"), "b's vault, with publisher keys");
    hold("account-vault.account-b.bin");
    const key = accountKey({ now: "account-c" }, { maxOtherKeys: 1 });
    await key.load();
    expect(await key.setUp()).toEqual({ status: "ready", created: true });
    expect((await files())["account-key.account-b.json"]).toBe(b);
  });

  it("can't be read right now where a new key goes: it moves aside, never written over", async () => {
    await writeFile(at("account-key.json"), keyFile(Buffer.alloc(32, 2), "account-a"));
    await writeFile(at("account-vault.account-c.bin"), "c's old vault");
    hold("account-vault.account-c.bin");
    const key = accountKey({ now: "account-c" });
    await key.load();
    expect(await key.setUp()).toEqual({ status: "ready", created: true });
    free("account-vault.account-c.bin");
    expect(Object.values(await files())).toContain("c's old vault");
  });
});
