// The sealed files (the sign-in, Discord's sign-in, the account's keys) by the rule decided 2026-11-23, "a saved file
// that can't be read is never written over": one that can't be read for a moment (EBUSY, EPERM: a virus scan, a sync
// app) is never written over or removed, and no new key is made in its place; one truly missing is made as before; a
// damaged one is set aside; a newer Tavora's is copied aside.
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountFile, type SavedAccount } from "./account";
import { AccountKey } from "./account-key";
import { DiscordSecretsFile, type Encryptor } from "./discord-store";
import { UserError } from "./messages";
import { SavedFileHeld } from "./saved-file";
import { onSealedFileHeld, sealedFilesHeld } from "./sealed-file";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile) };
});

const realReadFile = vi.mocked(readFile).getMockImplementation()!;
const readText = async (file: string) => String(await realReadFile(file, "utf8"));
/** The files that can't be read right now, and with which error. */
const busy = new Map<string, string>();

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-sealed-held-"));
  busy.clear();
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => {
    const code = busy.get(path.resolve(String(file)));
    return code ? Promise.reject(Object.assign(new Error(`${code}: busy`), { code })) : realReadFile(file, options);
  }) as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  busy.clear();
  onSealedFileHeld(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const at = (name: string) => path.join(dir, name);
const hold = (name: string, code: string) => busy.set(path.resolve(at(name)), code);
const free = (name: string) => busy.delete(path.resolve(at(name)));
/** Every file in the folder and what it holds, the times in names hidden. */
async function files(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) found[name.replace(/\.corrupt-\d+/, ".corrupt-<time>")] = await readText(at(name));
  return found;
}

const encryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(`sealed:${text}`),
  decrypt: (data) => {
    const text = data.toString();
    if (!text.startsWith("sealed:")) throw new Error("sealed by another user");
    return text.slice("sealed:".length);
  },
};
const seal = (text: string) => encryptor.encrypt(text).toString("base64");
/** A sealed file whose data another Windows user sealed: it reads, but doesn't open here. */
const OTHER_USER = JSON.stringify({ v: 1, data: Buffer.from("someone else's").toString("base64") });

const ACCOUNT: SavedAccount = { token: "t".repeat(24), email: "nik@example.com", discord: null, createdAt: "2026-11-01T00:00:00.000Z" };
const OLD_ACCOUNT: SavedAccount = { ...ACCOUNT, token: "o".repeat(24), email: "old@example.com" };
const TOKEN = { accessToken: "a", refreshToken: "r", expiresAt: 1 };
const OLD_TOKEN = { accessToken: "x", refreshToken: "y", expiresAt: 2 };

/** A store of a sealed file, opened once and then saved with, as at a start of Tavora. */
interface Store {
  name: string;
  file: string;
  /** What Tavora wrote for the user before. */
  before: string;
  /** What the store reads when signed out. */
  signedOut: unknown;
  load(): Promise<unknown>;
  save(): Promise<unknown>;
  /** Signs out: removes the file. */
  forget(): Promise<unknown>;
}

function stores(): Store[] {
  const account = new AccountFile(at("account.json"), encryptor);
  const discord = new DiscordSecretsFile(at("discord.json"), encryptor);
  return [
    {
      name: "account.json",
      file: "account.json",
      before: JSON.stringify({ v: 1, data: seal(JSON.stringify(OLD_ACCOUNT)) }),
      signedOut: null,
      load: () => account.load(),
      save: () => account.save(ACCOUNT),
      forget: () => account.save(null),
    },
    {
      name: "discord.json",
      file: "discord.json",
      before: JSON.stringify({ v: 1, data: seal(JSON.stringify({ token: OLD_TOKEN, last: null, games: {} })) }),
      signedOut: { token: null, last: null, games: {} },
      load: () => discord.load(),
      save: () => discord.save({ token: TOKEN, last: null, games: {} }),
      forget: () => discord.save({ token: null }),
    },
  ];
}

describe.each(["account.json", "discord.json"])("%s", (name) => {
  const store = () => stores().find((item) => item.file === name)!;

  for (const code of ["EBUSY", "EPERM"]) {
    it(`${code} on read: read as signed out, and neither written over nor removed while it stays so; the user is told`, async () => {
      const opened = store();
      await writeFile(at(name), opened.before);
      hold(name, code);
      const told = vi.fn();
      onSealedFileHeld(told);
      const before = sealedFilesHeld();
      expect(await opened.load()).toEqual(opened.signedOut);
      await expect(opened.save()).rejects.toBeInstanceOf(SavedFileHeld);
      await expect(opened.forget()).rejects.toBeInstanceOf(SavedFileHeld);
      expect(await files()).toEqual({ [name]: opened.before });
      expect(sealedFilesHeld()).toBe(before + 1);
      expect(told).toHaveBeenCalledTimes(1);
      // Readable again: the next save reads it first, and then writes.
      free(name);
      await opened.save();
      expect(Object.keys(await files())).toEqual([name]);
      expect(await readText(at(name))).not.toBe(opened.before);
    });
  }

  it("truly missing: made as before", async () => {
    const opened = store();
    await opened.load();
    await opened.save();
    expect(Object.keys(await files())).toEqual([name]);
    expect(JSON.parse(await readText(at(name)))).toMatchObject({ v: 1, data: expect.any(String) });
  });

  it("damaged: set aside, and a new one made", async () => {
    await writeFile(at(name), '{"v":1}');
    const opened = store();
    await opened.load();
    await opened.save();
    expect(Object.keys(await files())).toEqual([name, `${name}.corrupt-<time>`]);
    expect((await files())[`${name}.corrupt-<time>`]).toBe('{"v":1}');
  });

  it("from a newer Tavora: copied aside before it is written", async () => {
    const newer = JSON.stringify({ v: 2, data: "sealed anew", more: true });
    await writeFile(at(name), newer);
    const opened = store();
    await opened.load();
    await opened.save();
    expect((await files())[`${name}.from-version-2`]).toBe(newer);
  });
});

// ── The account's keys ───────────────────────────────────────────────

const KEY = Buffer.alloc(32, 1);
const keyFile = (key: Buffer, account: string | null) => JSON.stringify({ v: 1, data: seal(key.toString("base64")), account });

/** The account's key on this PC, with the service answering that the account has no vault yet. */
function accountKey(signed: { now: string | null } = { now: null }): AccountKey {
  const fetch = (async (_url: string, init?: RequestInit) =>
    init?.method === "PUT" ? new Response(null, { status: 200 }) : new Response(null, { status: 404 })) as unknown as typeof globalThis.fetch;
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
  });
}

const keyHeld = { key: "cloudCopy.error.keyHeld" };

describe("account-key.json", () => {
  for (const code of ["EBUSY", "EPERM"]) {
    it(`${code} on read: no new key is made, the user is told, and the key is used once it reads again`, async () => {
      const kept = keyFile(KEY, null);
      await writeFile(at("account-key.json"), kept);
      hold("account-key.json", code);
      const key = accountKey();
      expect(await key.load()).toBeNull();
      await expect(key.setUpHere(false)).rejects.toMatchObject(keyHeld);
      await expect(key.setUpHere(false)).rejects.toBeInstanceOf(UserError);
      expect(await files()).toEqual({ "account-key.json": kept });
      free("account-key.json");
      expect(await key.setUpHere(false)).toEqual({ status: "ready", created: false });
      expect(key.copyKey()).toEqual(KEY);
      expect(await files()).toEqual({ "account-key.json": kept });
    });
  }

  it("EBUSY on read, signed in: no new key is made for the account either", async () => {
    const kept = keyFile(KEY, "account-a");
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json", "EBUSY");
    const key = accountKey({ now: "account-a" });
    await key.load();
    await expect(key.setUp()).rejects.toMatchObject(keyHeld);
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("EBUSY on another account's own key file, signed in as it: no new key is made beside it", async () => {
    const copyKey = keyFile(Buffer.alloc(32, 2), "account-a");
    const kept = keyFile(KEY, "account-b");
    await writeFile(at("account-key.json"), copyKey);
    await writeFile(at("account-key.account-b.json"), kept);
    hold("account-key.account-b.json", "EBUSY");
    const key = accountKey({ now: "account-b" });
    await key.load();
    await expect(key.setUp()).rejects.toMatchObject(keyHeld);
    expect(await files()).toEqual({ "account-key.account-b.json": kept, "account-key.json": copyKey });
  });

  it("a key that is written reads the file first: one that can't be read then is never written over", async () => {
    const key = accountKey();
    await key.load();
    const kept = keyFile(KEY, null);
    await writeFile(at("account-key.json"), kept);
    hold("account-key.json", "EBUSY");
    // Typed in: the file came meanwhile, and can't be read.
    await expect(key.takeHere(Buffer.alloc(32, 3))).rejects.toBeInstanceOf(SavedFileHeld);
    expect(await files()).toEqual({ "account-key.json": kept });
  });

  it("its data doesn't open here (another Windows user): the recovery key is asked for, nothing is made", async () => {
    await writeFile(at("account-key.json"), OTHER_USER);
    const key = accountKey();
    await key.load();
    expect(await key.setUpHere(false)).toEqual({ status: "ask" });
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
    expect(await key.setUpHere(false)).toEqual({ status: "ask" });
    expect(await files()).toEqual({ "account-key.json": newer, "account-key.json.from-version-2": newer });
  });

  it("from a newer Tavora, signed in: the recovery key is asked for, no new key is made for the account", async () => {
    const newer = JSON.stringify({ v: 2, data: "sealed anew", account: "account-a" });
    await writeFile(at("account-key.json"), newer);
    const key = accountKey({ now: "account-a" });
    await key.load();
    expect(await key.setUp()).toEqual({ status: "ask" });
    expect(await files()).toEqual({ "account-key.json": newer, "account-key.json.from-version-2": newer });
  });
});

describe("cloud-copy-key.json (the key's older file)", () => {
  it("EBUSY on read: no new key is made in account-key.json beside it", async () => {
    const kept = keyFile(KEY, null);
    await writeFile(at("cloud-copy-key.json"), kept);
    hold("cloud-copy-key.json", "EBUSY");
    const key = accountKey();
    await key.load();
    await expect(key.setUpHere(false)).rejects.toMatchObject(keyHeld);
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
    hold("account-key.json", "EBUSY");
    await accountKey().load();
    expect(await files()).toEqual({ "account-key.json": held, "cloud-copy-key.json": legacy });
  });

  it("truly missing account-key.json: the older file moves in, as before", async () => {
    const legacy = keyFile(KEY, null);
    await writeFile(at("cloud-copy-key.json"), legacy);
    const key = accountKey();
    expect(await key.load()).toEqual(KEY);
    expect(await files()).toEqual({ "account-key.json": legacy });
  });
});

describe("the account's vault as last read", () => {
  it("can't be read right now: it is not taken for missing, and stays", async () => {
    await writeFile(at("account-key.json"), keyFile(KEY, "account-a"));
    await writeFile(at("account-vault.bin"), "a sealed vault");
    hold("account-vault.bin", "EBUSY");
    const key = accountKey({ now: "account-a" });
    await key.load();
    // Gone from the service: what this PC last read would go back, or an empty one be made, were it missing.
    await expect(key.change((content) => content)).rejects.toMatchObject({ reason: "failed" });
    expect((await files())["account-vault.bin"]).toBe("a sealed vault");
  });
});
