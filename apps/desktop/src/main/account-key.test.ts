import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, openVault, recoveryKey, sealVault } from "./copy-crypto";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;

/** The account's key on one PC of the test account (`userData`: the same PC again, as at the next start). */
async function onPc(cloud: Service, { keyStore = true, fetch = cloud.fetch, userData: folder, kept = false, putBackAfterMs = 0 }: { keyStore?: boolean; fetch?: typeof globalThis.fetch; userData?: string; kept?: boolean; putBackAfterMs?: number } = {}) {
  const userData = folder ?? (await pc({ "library.json": "{}" })).userData;
  const file = path.join(userData, "account-key.json");
  const key = new AccountKey({
    file,
    legacyFile: path.join(userData, "cloud-copy-key.json"),
    // `kept`: the vault as last read and whether one was seen are kept on this PC, as the app does.
    ...(kept ? { cacheFile: path.join(userData, "account-vault.bin"), seenFile: path.join(userData, "account-vault-seen") } : {}),
    encryptor: keyStore ? encryptor : { ...encryptor, isAvailable: () => false },
    baseUrl: "http://tavora.test/v1/account",
    fetch,
    token: () => cloud.token,
    account: () => "me",
    putBackAfterMs,
  });
  return { key, file, userData };
}

const vault = (cloud: Service) => cloud.fetch("http://tavora.test/v1/account/vault", { headers: { authorization: `Bearer ${cloud.token}` } });

/**
 * The service as a broken-into one serves it: `mode` "garbage" answers the vault with bytes no key opens, "gone"
 * answers that there is none; "real" passes everything through. Writes to the vault are counted.
 */
function tampered(cloud: Service) {
  const state = { mode: "real" as "real" | "garbage" | "gone", puts: 0 };
  const fetch = (async (url: string, init?: RequestInit) => {
    const vaultUrl = new URL(url).pathname.endsWith("/vault");
    if (vaultUrl && init?.method === "PUT") state.puts++;
    if (vaultUrl && (init?.method ?? "GET") === "GET" && state.mode === "garbage") return new Response(new Uint8Array(200).fill(7), { headers: { "x-vault-version": "9" } });
    if (vaultUrl && (init?.method ?? "GET") === "GET" && state.mode === "gone") return new Response(null, { status: 404 });
    if (vaultUrl && init?.method === "PUT" && state.mode !== "real") {
      // The service has none (or claims so): a put from version 0 is taken.
      return new Response(null, { status: 204, headers: { "x-vault-version": "1" } });
    }
    return cloud.fetch(url, init);
  }) as typeof globalThis.fetch;
  return { state, fetch };
}

describe("the account's key", () => {
  it("keeps every mark when two changes to the seen file overlap", async () => {
    const cloud = await service();
    const { key, userData } = await onPc(cloud, { kept: true });
    const seenFile = path.join(userData, "account-vault-seen");
    await writeFile(seenFile, "1");
    // A sign-in's own read and a refresh, at once: one names the old "1" as its account, the other adds another.
    const marks = key as unknown as { provenSeen(who: string): Promise<void>; markSeen(who: string): Promise<void> };
    await Promise.all([marks.provenSeen("me"), marks.markSeen("other")]);
    expect((await readFile(seenFile, "utf8")).split("\n").sort()).toEqual(["me", "other"]);
  });

  it("made while signing out is not kept on this PC", async () => {
    const cloud = await service();
    let answer: (() => void) | null = null;
    // The vault's answer waits until the test lets it through.
    const held = (async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") await new Promise<void>((resolve) => (answer = resolve));
      return cloud.fetch(url, init);
    }) as typeof fetch;
    const a = await onPc(cloud, { fetch: held });
    const setUp = a.key.setUp();
    for (let tries = 0; tries < 100 && !answer; tries++) await new Promise((resolve) => setTimeout(resolve, 5));
    await a.key.forget();
    answer!();
    await expect(setUp).rejects.toMatchObject({ reason: "signed-out" });
    expect(a.key.get()).toBeNull();
    await expect(access(a.file)).rejects.toThrow();
  });

  it("is made on the first PC, kept encrypted there, and asked for on the next", async () => {
    const cloud = await service();
    const a = await onPc(cloud);
    expect(await a.key.setUp()).toEqual({ status: "ready", created: true });
    const root = a.key.get()!;
    expect(await readFile(a.file, "utf8")).not.toContain(root.toString("base64"));
    // The service holds only the sealed vault, which the key opens.
    const sealed = new Uint8Array(await (await vault(cloud)).arrayBuffer());
    expect(sealed.length).toBeGreaterThan(0);
    expect(JSON.parse(openVault(root, sealed).toString("utf8"))).toEqual({ v: 1 });
    expect(Buffer.from(sealed).includes(Buffer.from('"v"'))).toBe(false);

    // Read back at the next start; nothing new is made.
    const again = await onPc(cloud);
    await writeFile(again.file, await readFile(a.file));
    expect((await again.key.load())?.equals(root)).toBe(true);
    expect(await again.key.setUp()).toEqual({ status: "ready", created: false });

    const b = await onPc(cloud);
    expect(await b.key.load()).toBeNull();
    expect(await b.key.setUp()).toEqual({ status: "ask" });
    await expect(b.key.enter("not a key")).rejects.toMatchObject({ key: "cloudCopy.error.badKey" });
    const other = await onPc(await service());
    await other.key.setUp();
    await expect(b.key.enter(other.key.recoveryKey()!)).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    expect(b.key.get()).toBeNull();
    await b.key.enter(a.key.recoveryKey()!.toLowerCase().replace(/-/g, " "));
    expect(b.key.get()?.equals(root)).toBe(true);

    await b.key.forget();
    expect(b.key.get()).toBeNull();
    expect(await b.key.load()).toBeNull();
  });

  it("starts over with a new key, and a PC with the old one asks for the new", async () => {
    const cloud = await service();
    const a = await onPc(cloud);
    await a.key.setUp();
    const old = a.key.get()!;
    const b = await onPc(cloud);
    await b.key.enter(a.key.recoveryKey()!);

    await b.key.startOver();
    expect(b.key.get()?.equals(old)).toBe(false);
    expect(await a.key.setUp()).toEqual({ status: "ask" });
    // A keeps its key until one that opens the account's vault is typed in.
    expect(a.key.get()?.equals(old)).toBe(true);
    expect(a.key.trouble).toBe("unopened");
    await expect(a.key.enter(recoveryKey(old))).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    await a.key.enter(b.key.recoveryKey()!);
    expect(a.key.get()?.equals(b.key.get()!)).toBe(true);
    expect(a.key.trouble).toBeNull();
  });

  it("gives a key from before the vault one, and moves it from the cloud copy's old file", async () => {
    const cloud = await service();
    const a = await onPc(cloud);
    const old = newCopyKey();
    await writeFile(path.join(a.userData, "cloud-copy-key.json"), JSON.stringify({ v: 1, data: encryptor.encrypt(old.toString("base64")).toString("base64") }));
    expect((await a.key.load())?.equals(old)).toBe(true);
    expect((await a.key.load())?.equals(old)).toBe(true);
    expect(await a.key.setUp()).toEqual({ status: "ready", created: false });
    expect(JSON.parse(openVault(old, new Uint8Array(await (await vault(cloud)).arrayBuffer())).toString("utf8"))).toEqual({ v: 1 });
  });

  it("is never kept, or made, without the system's key store", async () => {
    const cloud = await service();
    const a = await onPc(cloud, { keyStore: false });
    expect(a.key.canKeep).toBe(false);
    await expect(a.key.setUp()).rejects.toMatchObject({ key: "cloudCopy.error.cantKeep" });
    expect(await a.key.load()).toBeNull();
  });

  it("keeps its key and the vault it last read when the service sends a vault the key doesn't open, and puts that one back when it goes", async () => {
    const cloud = await service();
    const a = await onPc(cloud, { kept: true });
    await a.key.setUp();
    const root = a.key.get()!;
    const publisherKeys = ["-----BEGIN PRIVATE KEY-----\nkept\n-----END PRIVATE KEY-----\n"];
    await a.key.change((content) => ({ ...content, publisherKeys }));

    const service2 = tampered(cloud);
    service2.state.mode = "garbage";
    const again = await onPc(cloud, { kept: true, userData: a.userData, fetch: service2.fetch });
    await again.key.load();
    // Asked for the key, but nothing is forgotten: the key, and the vault it last read, which still serves.
    expect(await again.key.setUp()).toEqual({ status: "ask" });
    expect(again.key.get()?.equals(root)).toBe(true);
    expect(again.key.trouble).toBe("unopened");
    expect(await again.key.fits()).toBe(false);
    expect(again.key.get()?.equals(root)).toBe(true);
    expect((await again.key.content()).publisherKeys).toEqual(publisherKeys);
    await expect(again.key.change((content) => content)).rejects.toMatchObject({ reason: "damaged" });
    // The garbage was not kept as the last read.
    expect(JSON.parse(openVault(root, await readFile(path.join(a.userData, "account-vault.bin"))).toString("utf8"))).toMatchObject({ publisherKeys });

    // The service drops the vault: what this PC last read goes back, not an empty one.
    service2.state.mode = "real";
    await cloud.fetch("http://tavora.test/v1/account/vault", { method: "DELETE", headers: { authorization: `Bearer ${cloud.token}` } });
    expect(await again.key.setUp()).toEqual({ status: "ready", created: false });
    expect(again.key.trouble).toBeNull();
    expect(JSON.parse(openVault(root, new Uint8Array(await (await vault(cloud)).arrayBuffer())).toString("utf8"))).toMatchObject({ publisherKeys });
  });

  it("never makes a vault it saw again empty without the user", async () => {
    const cloud = await service();
    const a = await onPc(cloud, { kept: true });
    await a.key.setUp();
    const root = a.key.get()!;
    // A new PC sees the account's vault and asks for the key.
    const service2 = tampered(cloud);
    const b = await onPc(cloud, { kept: true, fetch: service2.fetch });
    expect(await b.key.setUp()).toEqual({ status: "ask" });

    // Then the service says there is none, also at B's next start: B still asks, and the key typed in makes nothing.
    service2.state.mode = "gone";
    const restarted = await onPc(cloud, { kept: true, userData: b.userData, fetch: service2.fetch });
    expect(await restarted.key.exists()).toBe(true);
    expect(await restarted.key.setUp()).toEqual({ status: "ask" });
    await restarted.key.enter(recoveryKey(root));
    expect(restarted.key.get()?.equals(root)).toBe(true);
    expect(service2.state.puts).toBe(0);
    expect(restarted.key.trouble).toBe("gone");
    // Neither the next start nor a change puts an empty vault there.
    expect(await restarted.key.setUp()).toEqual({ status: "ready", created: false });
    await expect(restarted.key.change((content) => ({ ...content, publisherKeys: ["x"] }))).rejects.toMatchObject({ reason: "damaged" });
    expect(await restarted.key.content()).toEqual({ v: 1 });
    expect(service2.state.puts).toBe(0);
    expect(restarted.key.trouble).toBe("gone");
    // Only when the user says so.
    await restarted.key.rebuild();
    expect(service2.state.puts).toBe(1);
    expect(restarted.key.trouble).toBeNull();
  });

  it("makes the first vault without asking when the account never had one", async () => {
    const cloud = await service();
    const service2 = tampered(cloud);
    service2.state.mode = "gone";
    const a = await onPc(cloud, { kept: true, fetch: service2.fetch });
    expect(await a.key.exists()).toBe(false);
    expect(await a.key.setUp()).toEqual({ status: "ready", created: true });
    expect(service2.state.puts).toBe(1);
    expect(a.key.trouble).toBeNull();
  });

  it("doesn't put the old vault back between another PC's delete and its new vault", async () => {
    const cloud = await service();
    let between: (() => Promise<void>) | null = null;
    // A's Start over: right after its delete, B looks at the vault, before A puts its new one.
    const startingOver = (async (url: string, init?: RequestInit) => {
      const answer = await cloud.fetch(url, init);
      if (init?.method === "DELETE" && between) {
        const run = between;
        between = null;
        void run();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return answer;
    }) as typeof fetch;
    const a = await onPc(cloud, { fetch: startingOver });
    await a.key.setUp();
    const b = await onPc(cloud, { kept: true, putBackAfterMs: 200 });
    await b.key.enter(a.key.recoveryKey()!);
    let looked: Promise<unknown> = Promise.resolve();
    between = async () => void (looked = b.key.setUp());
    await a.key.startOver();
    expect(await looked).toEqual({ status: "ready", created: false });
    // B looked again, found A's new vault, and put nothing back over it.
    expect(b.key.trouble).toBe("unopened");
    expect(JSON.parse(openVault(a.key.get()!, new Uint8Array(await (await vault(cloud)).arrayBuffer())).toString("utf8"))).toEqual({ v: 1 });
  });

  it("starts over even when another PC put the old vault back meanwhile", async () => {
    const cloud = await service();
    let between: (() => Promise<void>) | null = null;
    const startingOver = (async (url: string, init?: RequestInit) => {
      const answer = await cloud.fetch(url, init);
      if (init?.method === "DELETE" && between) {
        const run = between;
        between = null;
        await run();
      }
      return answer;
    }) as typeof fetch;
    const a = await onPc(cloud, { fetch: startingOver });
    await a.key.setUp();
    const old = a.key.get()!;
    const b = await onPc(cloud, { kept: true });
    await b.key.enter(a.key.recoveryKey()!);
    // B (looking again at once) puts the old vault back before A's new one goes up: A's put is refused, and A tries again.
    between = async () => void (await b.key.setUp());
    cloud.routes.length = 0;
    await a.key.startOver();
    expect(cloud.routes.filter((route) => route === "DELETE /v1/account/vault")).toHaveLength(2);
    const now = new Uint8Array(await (await vault(cloud)).arrayBuffer());
    expect(a.key.get()?.equals(old)).toBe(false);
    expect(JSON.parse(openVault(a.key.get()!, now).toString("utf8"))).toEqual({ v: 1 });
  });

  it("keeps the vault it read as the last read only once the key is kept", async () => {
    const cloud = await service();
    const a = await onPc(cloud);
    await a.key.setUp();
    const b = await onPc(cloud, { kept: true, keyStore: false });
    await expect(b.key.enter(a.key.recoveryKey()!)).rejects.toMatchObject({ key: "cloudCopy.error.cantKeep" });
    await expect(access(path.join(b.userData, "account-vault.bin"))).rejects.toThrow();
  });

  it("never opens a sealed copy part as a vault", () => {
    const key = newCopyKey();
    expect(() => openVault(newCopyKey(), sealVault(key, Buffer.from("{}")))).toThrow();
  });
});
