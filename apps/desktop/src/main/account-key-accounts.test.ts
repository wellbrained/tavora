import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, openVault, recoveryKey, sealVault } from "./copy-crypto";
import { CopySync } from "./cloud-copy-sync";
import { DeveloperKeys } from "./developer-keys";
import { accountIdOf } from "./sign-in";

// The account's key and the vault this PC last read belong to one account (security audit 2026-11-20, run 2): a
// sign-in the service ended by itself (a 401) leaves them on the PC, and another account signed in later never gets
// them.

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;
interface Signed {
  token: string;
  id: string;
}

/** Two accounts on the service, A (the helper's own) and B, and the vault requests each token made. */
async function twoAccounts() {
  const cloud = await service();
  const a: Signed = { token: cloud.token, id: "account-a" };
  const b: Signed = { token: await cloud.newAccount("other@example.com"), id: "account-b" };
  const requests: { method: string; token: string; body: Uint8Array | null }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname.endsWith("/vault")) {
      const token = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "").replace(/^Bearer /, "");
      requests.push({ method: init?.method ?? "GET", token, body: init?.body ? new Uint8Array(init.body as Uint8Array) : null });
    }
    return cloud.fetch(url, init);
  }) as typeof globalThis.fetch;
  const vaultOf = async (who: Signed) => {
    const response = await cloud.fetch("http://tavora.test/v1/account/vault", { headers: { authorization: `Bearer ${who.token}` } });
    return response.status === 404 ? null : new Uint8Array(await response.arrayBuffer());
  };
  return { cloud, a, b, fetch, requests, vaultOf };
}

/** Tavora on one PC: its account key and publisher keys, with whoever `signed.now` names signed in. */
async function onPc(cloud: Service, fetch: typeof globalThis.fetch, signed: { now: Signed | null }, { userData: folder, putBackAfterMs = 0 }: { userData?: string; putBackAfterMs?: number } = {}) {
  const userData = folder ?? (await pc({ "library.json": "{}" })).userData;
  const files = { file: path.join(userData, "account-key.json"), cacheFile: path.join(userData, "account-vault.bin"), seenFile: path.join(userData, "account-vault-seen") };
  const accountKey = new AccountKey({
    ...files,
    encryptor,
    baseUrl: "http://tavora.test/v1/account",
    fetch,
    token: () => signed.now?.token ?? null,
    account: () => signed.now?.id ?? null,
    putBackAfterMs,
  });
  const keys = new DeveloperKeys({
    accountKey,
    account: {
      signedIn: () => signed.now !== null,
      link: async () => undefined,
      publish: async () => {
        throw new Error("not in these tests");
      },
    },
    onChange: () => undefined,
  });
  /** The account changes as the host tells it (an account change from AccountClient). */
  const changed = async () => {
    keys.accountChanged(signed.now?.id ?? null);
    await keys.refresh();
  };
  return { accountKey, keys, changed, userData, ...files };
}

const pem = () => generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();

describe("the account's key belongs to one account", () => {
  it("after a 401, another account signing in never sees, exports or uploads the first one's keys; the first one goes on", async () => {
    const { cloud, a, b, fetch, requests, vaultOf } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await onPc(cloud, fetch, signed);
    await here.changed();
    const fpr = await here.keys.create();
    const rootA = here.accountKey.get()!;
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    expect(JSON.parse(await readFile(here.file, "utf8"))).toMatchObject({ account: "account-a" });

    // The service ends A's sign-in by itself (a 401): only the sign-in goes, nothing runs CopySync.signedOut.
    signed.now = null;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "signed-out", keys: [] });

    // B signs in on the same Tavora.
    signed.now = b;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "none", keys: [], hasKey: false });
    expect(() => here.keys.exportKey(fpr)).toThrow();
    expect(here.accountKey.get()).toBeNull();
    expect(here.accountKey.recoveryKey()).toBeNull();
    await expect(here.accountKey.content()).rejects.toMatchObject({ reason: "failed" });
    await expect(here.accountKey.fits()).resolves.toBe(false);
    // Nothing of A's went into B's vault.
    expect(requests.filter((request) => request.token === b.token && request.method !== "GET")).toEqual([]);
    expect(await vaultOf(b)).toBeNull();

    // A signs in again: the key and its publisher keys are there, as before.
    signed.now = a;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }], hasKey: true });
    expect(here.accountKey.get()?.equals(rootA)).toBe(true);
    expect(here.keys.exportKey(fpr)).toContain("PRIVATE KEY");
  });

  it("another account whose vault A's key doesn't open is asked for its own key, and A's cached keys stay out of it", async () => {
    const { cloud, a, b, fetch, requests } = await twoAccounts();
    // B made its key on another PC.
    const rootB = newCopyKey();
    const sealed = sealVault(rootB, Buffer.from(JSON.stringify({ v: 1 })));
    const body = Buffer.alloc(4 + sealed.length);
    sealed.copy(body, 4);
    const made = await cloud.fetch("http://tavora.test/v1/account/vault", { method: "PUT", headers: { authorization: `Bearer ${b.token}`, "content-type": "application/octet-stream" }, body: Uint8Array.from(body) });
    expect(made.ok).toBe(true);

    const signed: { now: Signed | null } = { now: a };
    const here = await onPc(cloud, fetch, signed);
    await here.changed();
    const fpr = await here.keys.create();
    signed.now = null;
    await here.changed();
    signed.now = b;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ask", keys: [], vault: null });
    expect(() => here.keys.exportKey(fpr)).toThrow();
    expect(requests.filter((request) => request.token === b.token && request.method !== "GET")).toEqual([]);

    // B types its own recovery key: kept in B's own files; A's key and the vault it last read stay as they were.
    const fileA = await readFile(here.file, "utf8");
    const cacheA = await readFile(here.cacheFile);
    await here.keys.enterKey(recoveryKey(rootB));
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [] });
    expect(await readFile(here.file, "utf8")).toBe(fileA);
    expect(await readFile(here.cacheFile)).toEqual(cacheA);
    const fileB = path.join(here.userData, "account-key.account-b.json");
    expect(JSON.parse(await readFile(fileB, "utf8"))).toMatchObject({ account: "account-b" });
    expect(openVault(rootB, await readFile(path.join(here.userData, "account-vault.account-b.bin"))).length).toBeGreaterThan(0);
    // A comes back: its key waited for it, and B's stays out of it.
    signed.now = null;
    await here.changed();
    signed.now = a;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }], hasKey: true });
    // Both still there after a restart.
    const restarted = await onPc(cloud, fetch, signed, { userData: here.userData });
    await restarted.accountKey.load();
    await restarted.changed();
    expect(restarted.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    signed.now = b;
    expect(restarted.accountKey.get()?.equals(rootB)).toBe(true);
  });

  it("puts nothing into another account's vault when the account changes while a missing vault waits to be put back", async () => {
    const { cloud, a, b, fetch, requests, vaultOf } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await onPc(cloud, fetch, signed, { putBackAfterMs: 50 });
    await here.changed();
    await here.keys.add(pem());
    // A's vault goes missing on the service; the PC would put back what it last read after a few moments.
    await cloud.fetch("http://tavora.test/v1/account/vault", { method: "DELETE", headers: { authorization: `Bearer ${a.token}` } });
    const content = here.accountKey.content();
    await new Promise((resolve) => setTimeout(resolve, 10));
    signed.now = b;
    expect((await content).publisherKeys).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(requests.filter((request) => request.token === b.token)).toEqual([]);
    expect(await vaultOf(b)).toBeNull();
  });

  it("a key made signed out goes to the first account that uses it, and stays that account's", async () => {
    const { cloud, a, b, fetch, vaultOf } = await twoAccounts();
    const signed: { now: Signed | null } = { now: null };
    const here = await onPc(cloud, fetch, signed);
    // A folder's copy, signed out: the key belongs to no account yet.
    expect(await here.accountKey.setUpHere(false)).toEqual({ status: "ready", created: true });
    const root = here.accountKey.get()!;
    expect(JSON.parse(await readFile(here.file, "utf8"))).toMatchObject({ account: null });
    signed.now = a;
    // Signing in gives the account a vault with it (as before keys noted their account).
    expect(await here.accountKey.setUp()).toEqual({ status: "ready", created: false });
    expect(openVault(root, (await vaultOf(a))!).length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(here.file, "utf8"))).toMatchObject({ account: "account-a" });
    // Signed out, the folder's copy goes on with it; it isn't shown as a key of no account any more.
    signed.now = null;
    expect(here.accountKey.copyKey()?.equals(root)).toBe(true);
    expect(here.accountKey.get()).toBeNull();
    expect(here.accountKey.recoveryKey()).toBeNull();
    signed.now = b;
    expect(here.accountKey.get()).toBeNull();
    expect(here.accountKey.copyKey()).toBeNull();
    expect(await here.accountKey.setUp()).toEqual({ status: "ready", created: true });
    expect(here.accountKey.get()?.equals(root)).toBe(false);
    // B's own key went to B's files: the copy's key is still A's.
    signed.now = null;
    expect(here.accountKey.copyKey()?.equals(root)).toBe(true);
  });

  describe("a key file from before keys noted their account", () => {
    /**
     * A PC that used A's key signed in before this change (the key file names no account, the seen file only says
     * "seen"), read again at a start with A signed in, or with no one.
     */
    async function legacyPc(signedInAtStart: boolean) {
      const setUp = await twoAccounts();
      const signed: { now: Signed | null } = { now: setUp.a };
      const before = await onPc(setUp.cloud, setUp.fetch, signed);
      await before.changed();
      const fpr = await before.keys.create();
      const root = before.accountKey.get()!;
      const file = JSON.parse(await readFile(before.file, "utf8")) as Record<string, unknown>;
      delete file.account;
      await writeFile(before.file, JSON.stringify(file));
      await writeFile(before.seenFile, "1");
      if (!signedInAtStart) signed.now = null;
      const after = await onPc(setUp.cloud, setUp.fetch, signed, { userData: before.userData });
      await after.accountKey.load();
      return { ...setUp, signed, after, fpr, root };
    }

    it("is the account's signed in when it is first read", async () => {
      const { after, fpr, root } = await legacyPc(true);
      expect(after.accountKey.get()?.equals(root)).toBe(true);
      expect(JSON.parse(await readFile(after.file, "utf8"))).toMatchObject({ account: "account-a" });
      await after.changed();
      expect(after.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    });

    it("read signed out, goes only to an account whose vault opens with it, also after a restart", async () => {
      const { a, b, signed, after, fpr, root, requests, cloud, fetch, vaultOf } = await legacyPc(false);
      expect(JSON.parse(await readFile(after.file, "utf8"))).toMatchObject({ account: null, unproven: true });
      // Signed out, the key is there as it was, for a folder's copy only.
      expect(after.accountKey.copyKey()?.equals(root)).toBe(true);
      expect(after.accountKey.get()).toBeNull();

      signed.now = b;
      await after.changed();
      expect(after.keys.view()).toMatchObject({ keys: [], hasKey: false });
      expect(after.keys.view().status === "ask" || after.keys.view().status === "none").toBe(true);
      expect(after.accountKey.recoveryKey()).toBeNull();
      expect(requests.filter((request) => request.token === b.token && request.method !== "GET")).toEqual([]);
      expect(await vaultOf(b)).toBeNull();

      // A restart with B signed in doesn't give it to B either.
      const restarted = await onPc(cloud, fetch, signed, { userData: after.userData });
      await restarted.accountKey.load();
      expect(restarted.accountKey.get()).toBeNull();
      await restarted.changed();
      expect(restarted.keys.view()).toMatchObject({ keys: [] });

      // A signs in: its vault opens with the key, which is A's from now on.
      signed.now = a;
      await restarted.changed();
      expect(restarted.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
      expect(JSON.parse(await readFile(restarted.file, "utf8"))).toMatchObject({ account: "account-a" });
    });
  });
});

describe("which account a sign-in is for", () => {
  it("stays the same for the account however its creation time is written, and differs between accounts", () => {
    const id = accountIdOf({ createdAt: "2026-10-16T12:00:00.000Z" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(accountIdOf({ createdAt: "2026-10-16T12:00:00Z" })).toBe(id);
    expect(accountIdOf({ createdAt: "2026-10-16T12:00:00.001Z" })).not.toBe(id);
  });
});

/** Tavora with its cloud copy, as the host runs it, and the publisher keys over the same account key. */
async function copyPc(cloud: Service, fetch: typeof globalThis.fetch, signed: { now: Signed | null }, userData?: string) {
  const at = userData ? { userData, moduleFiles: path.join(userData, "..", "Pictures") } : await pc({ "library.json": "a1" });
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    files: { root: () => at.moduleFiles },
    account: { token: () => signed.now?.token ?? null, id: () => signed.now?.id ?? null },
    serviceUrl: "http://tavora.test/v1/account",
    fetch,
    encryptor,
    restart: () => undefined,
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  const keys = new DeveloperKeys({
    accountKey: sync.accountKey,
    account: { signedIn: () => signed.now !== null, link: async () => undefined, publish: async () => Promise.reject(new Error("not here")) },
    onChange: () => undefined,
  });
  /** The account changes as the host tells it. */
  const changed = async () => {
    keys.accountChanged(signed.now?.id ?? null);
    sync.accountChanged(signed.now?.id ?? null);
    await keys.refresh();
  };
  await sync.beforeLoad();
  await changed();
  return { sync, keys, changed, userData: at.userData };
}

describe("the cloud copy and each account's key", () => {

  it("another account signing in and out after a 401 leaves the first one's key: it is ready again when that one signs in", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await copyPc(cloud, fetch, signed);
    await here.sync.turnOn();
    expect(here.sync.view().on).toBe(true);
    const fpr = await here.keys.create();

    // A's sign-in ends by itself; B signs in, makes its own publisher key, and signs out with Sign out.
    signed.now = null;
    await here.changed();
    signed.now = b;
    await here.changed();
    expect(here.sync.view().on).toBe(false);
    const fprB = await here.keys.create();
    expect(fprB).not.toBe(fpr);
    signed.now = null;
    await here.sync.signedOut(b.id);
    await here.changed();
    await expect(stat(path.join(here.userData, "account-key.account-b.json"))).rejects.toThrow();

    // A signs in again: its key, its publisher key and its copy are all there.
    signed.now = a;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    expect(here.sync.view().on).toBe(true);
    const restarted = await copyPc(cloud, fetch, signed, here.userData);
    expect(restarted.sync.view().on).toBe(true);
    expect(restarted.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
  });

  it("a folder's copy stays with its account's key: off while another account is signed in, on again for it", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await copyPc(cloud, fetch, signed);
    const folder = await mkdtemp(path.join(os.tmpdir(), "tavora-folder-copy-"));
    try {
      await here.sync.turnOn(folder);
      expect(here.sync.view()).toMatchObject({ on: true, folder });
      const rootA = here.sync.accountKey.copyKey()!;
      const fpr = await here.keys.create();

      signed.now = null;
      await here.changed();
      // Signed out, the folder's copy goes on with A's key.
      expect(here.sync.view().on).toBe(true);
      signed.now = b;
      await here.changed();
      expect(here.sync.view().on).toBe(false);
      expect(here.sync.accountKey.copyKey()).toBeNull();
      // B's own key doesn't touch the copy's.
      await here.keys.create();
      expect(here.sync.accountKey.get()?.equals(rootA)).toBe(false);
      signed.now = null;
      await here.sync.signedOut(b.id);
      await here.changed();
      expect(here.sync.view()).toMatchObject({ on: true, folder });
      expect(here.sync.accountKey.copyKey()?.equals(rootA)).toBe(true);

      signed.now = a;
      await here.changed();
      expect(here.sync.view()).toMatchObject({ on: true, folder });
      expect(here.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("another account turning a copy on takes the copy's key; the first one's waits in its own files", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await copyPc(cloud, fetch, signed);
    await here.sync.turnOn();
    const rootA = here.sync.accountKey.copyKey()!;
    signed.now = b;
    await here.changed();
    await here.sync.turnOn();
    expect(here.sync.view().on).toBe(true);
    const rootB = here.sync.accountKey.copyKey()!;
    expect(rootB.equals(rootA)).toBe(false);
    expect(JSON.parse(await readFile(path.join(here.userData, "account-key.json"), "utf8"))).toMatchObject({ account: "account-b" });
    expect(JSON.parse(await readFile(path.join(here.userData, "account-key.account-a.json"), "utf8"))).toMatchObject({ account: "account-a" });
    signed.now = a;
    await here.changed();
    expect(here.sync.accountKey.get()?.equals(rootA)).toBe(true);
    expect(here.sync.view().on).toBe(false);
  });

  it("signed out after a 401, Show key shows nothing of a copy on the service; one shown goes when the account changes", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await copyPc(cloud, fetch, signed);
    await here.sync.turnOn();
    here.sync.keySaved();
    here.sync.showKey();
    expect(here.sync.view().recoveryKey).toMatch(/^[0-9A-Z]{4}-/);
    signed.now = null;
    await here.changed();
    expect(here.sync.view().recoveryKey).toBeNull();
    here.sync.showKey();
    expect(here.sync.view().recoveryKey).toBeNull();
    signed.now = b;
    await here.changed();
    here.sync.showKey();
    expect(here.sync.view().recoveryKey).toBeNull();
  });
});

describe("an unproven key", () => {
  it("is never dropped by another account's Start over, and its seen mark becomes the account's once its vault opens with it", async () => {
    const { cloud, a, b, fetch, vaultOf } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const before = await onPc(cloud, fetch, signed);
    await before.changed();
    const fpr = await before.keys.create();
    const file = JSON.parse(await readFile(before.file, "utf8")) as Record<string, unknown>;
    delete file.account;
    await writeFile(before.file, JSON.stringify(file));
    await writeFile(before.seenFile, "1");
    signed.now = null;
    const after = await onPc(cloud, fetch, signed, { userData: before.userData });
    await after.accountKey.load();
    const unproven = await readFile(after.file, "utf8");
    const cache = await readFile(after.cacheFile);

    // B can't prove it, and starts over: its new key goes to its own files, the unproven key and its vault stay.
    signed.now = b;
    await after.accountKey.startOver();
    expect(await vaultOf(b)).not.toBeNull();
    expect(await readFile(after.file, "utf8")).toBe(unproven);
    expect(await readFile(after.cacheFile)).toEqual(cache);

    // Offline, A can't prove it yet: nothing is used.
    signed.now = a;
    const offlineFetch = (async () => Promise.reject(new TypeError("offline"))) as unknown as typeof globalThis.fetch;
    const offline = await onPc(cloud, offlineFetch, signed, { userData: after.userData });
    await offline.accountKey.load();
    await expect(offline.accountKey.content()).rejects.toMatchObject({ reason: "unreachable" });
    // Online, it opens A's vault: A's from now on, and the seen file names A instead of "1".
    await after.changed();
    expect(after.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    const marks = (await readFile(after.seenFile, "utf8")).split("\n");
    expect(marks).toContain("account-a");
    expect(marks).not.toContain("1");
    // And from now on offline too, from the vault it last read.
    const later = await onPc(cloud, offlineFetch, signed, { userData: after.userData });
    await later.accountKey.load();
    expect((await later.accountKey.content()).publisherKeys).toHaveLength(1);
  });
});

describe("keys of no account, and keys moved aside", () => {
  /** A vault for `who` sealed under `root`, made on another PC. */
  async function vaultOn(cloud: Service, who: Signed, root: Buffer, content: object = { v: 1 }) {
    const sealed = sealVault(root, Buffer.from(JSON.stringify(content)));
    const body = Buffer.alloc(4 + sealed.length);
    sealed.copy(body, 4);
    const made = await cloud.fetch("http://tavora.test/v1/account/vault", { method: "PUT", headers: { authorization: `Bearer ${who.token}`, "content-type": "application/octet-stream" }, body: Uint8Array.from(body) });
    expect(made.ok).toBe(true);
  }
  const keyFile = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

  it("signed out after a 401, a folder copy turned on gets a new key: the account's is never shown, and its vault moves with it", async () => {
    const { cloud, a, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const here = await copyPc(cloud, fetch, signed);
    await here.sync.turnOn();
    await here.keys.create();
    const rootA = here.sync.accountKey.copyKey()!;
    here.sync.keySaved();

    signed.now = null;
    await here.changed();
    // A's service copy is still on, signed out: nothing of A's key is shown or handed out.
    expect(here.sync.shareableKey()).toBeNull();
    here.sync.showKey();
    expect(here.sync.view().recoveryKey).toBeNull();
    // Nor can it be moved into a folder.
    const folder = await mkdtemp(path.join(os.tmpdir(), "tavora-moved-"));
    try {
      await expect(here.sync.move(folder)).rejects.toMatchObject({ key: "cloudCopy.error.signed-out" });
      await here.sync.turnOff();
      await here.sync.turnOn(folder);
      expect(here.sync.view()).toMatchObject({ on: true, folder });
      const shown = here.sync.view().recoveryKey;
      expect(shown).toMatch(/^[0-9A-Z]{4}-/);
      expect(shown).not.toBe(recoveryKey(rootA));
      expect(here.sync.accountKey.copyKey()?.equals(rootA)).toBe(false);
      // A's key and the vault it last read wait in A's own files; the copy's vault file isn't A's.
      expect(await keyFile(path.join(here.userData, "account-key.account-a.json"))).toMatchObject({ account: "account-a" });
      expect(openVault(rootA, await readFile(path.join(here.userData, "account-vault.account-a.bin"))).length).toBeGreaterThan(0);
      const copyVault = await readFile(path.join(here.userData, "account-vault.bin")).catch(() => null);
      if (copyVault) expect(() => openVault(rootA, copyVault)).toThrow();
      signed.now = a;
      await here.changed();
      expect(here.keys.view()).toMatchObject({ status: "ready" });
      expect(here.sync.accountKey.get()?.equals(rootA)).toBe(true);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("a folder copy's key of no account doesn't hide an account's own key, and an account's Start over never writes over it", async () => {
    const { cloud, a, fetch } = await twoAccounts();
    const rootA = newCopyKey();
    await vaultOn(cloud, a, rootA);
    const signed: { now: Signed | null } = { now: null };
    const here = await onPc(cloud, fetch, signed);
    expect(await here.accountKey.setUpHere(false)).toEqual({ status: "ready", created: true });
    const folderKey = await readFile(here.file, "utf8");
    // A signs in: its vault doesn't open with the folder's key, so A is asked for its own, and the folder's stays of no account.
    signed.now = a;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ask" });
    expect(await keyFile(here.file)).toMatchObject({ account: null });
    await here.accountKey.startOver();
    expect(await readFile(here.file, "utf8")).toBe(folderKey);
    expect(await keyFile(path.join(here.userData, "account-key.account-a.json"))).toMatchObject({ account: "account-a" });
    expect(here.accountKey.get()?.equals(rootA)).toBe(false);
    expect(here.accountKey.get()).not.toBeNull();
  });

  it("an account with its own key signing in after a folder copy made signed out keeps both", async () => {
    const { cloud, a, fetch } = await twoAccounts();
    const rootA = newCopyKey();
    await vaultOn(cloud, a, rootA);
    const signed: { now: Signed | null } = { now: null };
    const here = await onPc(cloud, fetch, signed);
    await here.accountKey.setUpHere(false);
    const folderRoot = here.accountKey.copyKey()!;
    const folderKey = await readFile(here.file, "utf8");
    signed.now = a;
    await here.keys.enterKey(recoveryKey(rootA));
    expect(await readFile(here.file, "utf8")).toBe(folderKey);
    expect(here.accountKey.get()?.equals(rootA)).toBe(true);
    expect(here.keys.view()).toMatchObject({ status: "ready" });
    signed.now = null;
    expect(here.accountKey.copyKey()?.equals(folderRoot)).toBe(true);
  });

  it("keeps the keys of other accounts used last, never one whose vault as last read holds publisher keys, and says what went", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const c: Signed = { token: await cloud.newAccount("third@example.com"), id: "account-c" };
    const d: Signed = { token: await cloud.newAccount("fourth@example.com"), id: "account-d" };
    const lines: string[] = [];
    const signed: { now: Signed | null } = { now: a };
    const { userData } = await pc({ "library.json": "{}" });
    const accountKey = new AccountKey({
      file: path.join(userData, "account-key.json"),
      cacheFile: path.join(userData, "account-vault.bin"),
      seenFile: path.join(userData, "account-vault-seen"),
      encryptor,
      baseUrl: "http://tavora.test/v1/account",
      fetch,
      token: () => signed.now?.token ?? null,
      account: () => signed.now?.id ?? null,
      putBackAfterMs: 0,
      maxOtherKeys: 1,
      log: (line) => void lines.push(line),
    });
    await accountKey.setUp();
    signed.now = b;
    await accountKey.setUp();
    // C's key needs room: B's holds no publisher keys, and goes (said in the log).
    signed.now = c;
    await accountKey.setUp();
    await accountKey.change((content) => ({ ...content, publisherKeys: [pem()] }));
    expect(lines.some((line) => line.includes("account-key.account-b.json"))).toBe(true);
    signed.now = b;
    expect(accountKey.get()).toBeNull();
    // D's needs room too, but C's vault as last read holds a publisher key: both stay.
    signed.now = d;
    await accountKey.setUp();
    signed.now = c;
    expect(accountKey.get()).not.toBeNull();
    signed.now = d;
    expect(accountKey.get()).not.toBeNull();
    expect(lines.some((line) => line.includes("none can go"))).toBe(true);
    // A's, the copy's key, is never one of them.
    signed.now = a;
    expect(accountKey.get()).not.toBeNull();
  });

  it("never writes over a key file it can't open in this run: another account's key goes to its own files", async () => {
    const { cloud, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: b };
    const { userData } = await pc({ "library.json": "{}" });
    const file = path.join(userData, "account-key.json");
    // Sealed by a key store this run can't use: it reads, but doesn't open as a key.
    const blocked = JSON.stringify({ v: 1, data: Buffer.from("sealed:not a key").toString("base64"), account: "account-a" });
    await writeFile(file, blocked);
    const here = await onPc(cloud, fetch, signed, { userData });
    await here.accountKey.load();
    expect(await here.accountKey.setUp()).toEqual({ status: "ready", created: true });
    expect(await readFile(file, "utf8")).toBe(blocked);
    expect(await keyFile(path.join(userData, "account-key.account-b.json"))).toMatchObject({ account: "account-b" });
    // Taken for the cloud copy: the file it can't open moves aside as it was, read again at the next start.
    await here.accountKey.useForCopy();
    expect(await readFile(path.join(userData, "account-key.unopened.json"), "utf8")).toBe(blocked);
    expect(await keyFile(file)).toMatchObject({ account: "account-b" });
  });

  describe("an unproven key", () => {
    async function legacy() {
      const set = await twoAccounts();
      const signed: { now: Signed | null } = { now: set.a };
      const before = await onPc(set.cloud, set.fetch, signed);
      await before.changed();
      const fpr = await before.keys.create();
      const root = before.accountKey.get()!;
      const file = await keyFile(before.file);
      delete file.account;
      await writeFile(before.file, JSON.stringify(file));
      await writeFile(before.seenFile, "1");
      signed.now = null;
      const after = await onPc(set.cloud, set.fetch, signed, { userData: before.userData });
      await after.accountKey.load();
      return { ...set, signed, after, fpr, root };
    }

    it("its old seen mark doesn't count for a new account without a vault: that one has none, it isn't asked", async () => {
      const { b, signed, after } = await legacy();
      signed.now = b;
      await after.changed();
      expect(after.keys.view()).toMatchObject({ status: "none", keys: [] });
    });

    it("typed in by its account, it goes on with the vault it last read, also when the account's vault is gone", async () => {
      const { cloud, a, signed, after, fpr, root } = await legacy();
      await cloud.fetch("http://tavora.test/v1/account/vault", { method: "DELETE", headers: { authorization: `Bearer ${a.token}` } });
      signed.now = a;
      await after.changed();
      expect(after.keys.view().keys).toEqual([]);
      await after.keys.enterKey(recoveryKey(root));
      expect(after.keys.view()).toMatchObject({ status: "ready", keys: [{ fingerprint: fpr }] });
    });

    it("moved aside, never replaces another one moved aside before", async () => {
      const { signed, after, root } = await legacy();
      const earlier = await readFile(after.file, "utf8");
      await writeFile(path.join(after.userData, "account-key.unproven.json"), earlier);
      const restarted = await onPc((await twoAccounts()).cloud, (async () => Promise.reject(new TypeError("offline"))) as unknown as typeof globalThis.fetch, signed, { userData: after.userData });
      await restarted.accountKey.load();
      await restarted.accountKey.startOverHere();
      expect(await readFile(path.join(after.userData, "account-key.unproven.json"), "utf8")).toBe(earlier);
      expect(await keyFile(path.join(after.userData, "account-key.unproven-2.json"))).toMatchObject({ account: null, unproven: true });
      expect(restarted.accountKey.copyKey()?.equals(root)).toBe(false);
    });
  });
});

describe("an account's key file this run can't open", () => {
  const unopenable = {
    "sealed by another user": JSON.stringify({ v: 1, data: Buffer.from("sealed:not a key").toString("base64"), account: "account-b" }),
    "from a newer Tavora": JSON.stringify({ v: 99, data: "whatever it holds now", account: "account-b" }),
  };

  for (const [kind, text] of Object.entries(unopenable)) {
    it(`${kind}: Start over keeps it and the vault saved with it, moved aside as they are`, async () => {
      const { cloud, a, b, fetch } = await twoAccounts();
      const signed: { now: Signed | null } = { now: a };
      const first = await onPc(cloud, fetch, signed);
      await first.accountKey.setUp();
      // B's own key file and the vault it last read, as this run finds them.
      const keyB = path.join(first.userData, "account-key.account-b.json");
      const vaultB = path.join(first.userData, "account-vault.account-b.bin");
      const savedVault = Buffer.from("a sealed vault with publisher keys");
      await writeFile(keyB, text);
      await writeFile(vaultB, savedVault);
      signed.now = b;
      const here = await onPc(cloud, fetch, signed, { userData: first.userData });
      await here.accountKey.load();
      expect(here.accountKey.get()).toBeNull();
      await here.accountKey.startOver();
      expect(await keyFile(keyB)).toMatchObject({ account: "account-b" });
      expect(await readFile(keyB, "utf8")).not.toBe(text);
      expect(await readFile(path.join(first.userData, "account-key.unopened.json"), "utf8")).toBe(text);
      expect(await readFile(path.join(first.userData, "account-vault.unopened.bin"))).toEqual(savedVault);
    });
  }

  it("a key moving aside never lands on one: the copy's key of A moves past A's file this run can't open", async () => {
    const { cloud, a, b, fetch } = await twoAccounts();
    const signed: { now: Signed | null } = { now: a };
    const first = await onPc(cloud, fetch, signed);
    await first.accountKey.setUp();
    const keyA = path.join(first.userData, "account-key.account-a.json");
    await writeFile(keyA, unopenable["from a newer Tavora"]);
    signed.now = b;
    const here = await onPc(cloud, fetch, signed, { userData: first.userData });
    await here.accountKey.load();
    await here.accountKey.setUp();
    // B takes the copy's key: A's moves to A's own files, and the file there first moves aside.
    await here.accountKey.useForCopy();
    expect(await keyFile(keyA)).toMatchObject({ account: "account-a", data: expect.any(String) });
    expect(await readFile(path.join(first.userData, "account-key.unopened.json"), "utf8")).toBe(unopenable["from a newer Tavora"]);
    signed.now = a;
    const restarted = await onPc(cloud, fetch, signed, { userData: first.userData });
    await restarted.accountKey.load();
    expect(await restarted.accountKey.setUp()).toEqual({ status: "ready", created: false });
  });
});

const keyFile = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
