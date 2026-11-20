import { generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, openVault, recoveryKey, sealVault } from "./copy-crypto";
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

    // B types its own recovery key: the PC's key is B's from now on, and what it had read of A's vault is gone.
    await here.keys.enterKey(recoveryKey(rootB));
    expect(here.keys.view()).toMatchObject({ status: "ready", keys: [] });
    expect(JSON.parse(await readFile(here.file, "utf8"))).toMatchObject({ account: "account-b" });
    expect(openVault(rootB, await readFile(here.cacheFile)).length).toBeGreaterThan(0);
    // A comes back: this PC has no key for A any more, so A is asked for it, and never gets B's.
    signed.now = a;
    await here.changed();
    expect(here.keys.view()).toMatchObject({ status: "ask", keys: [], hasKey: false });
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
    signed.now = null;
    expect(here.accountKey.get()?.equals(root)).toBe(true);
    signed.now = b;
    expect(here.accountKey.get()).toBeNull();
    expect(await here.accountKey.setUp()).toEqual({ status: "ready", created: true });
    expect(here.accountKey.get()?.equals(root)).toBe(false);
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
      // Signed out, the key is there as it was (a folder's copy).
      expect(after.accountKey.get()?.equals(root)).toBe(true);

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
