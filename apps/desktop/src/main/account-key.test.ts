import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, openVault, recoveryKey, sealVault } from "./copy-crypto";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;

/** The account's key on one PC of the test account. */
async function onPc(cloud: Service, { keyStore = true } = {}) {
  const { userData } = await pc({ "library.json": "{}" });
  const file = path.join(userData, "account-key.json");
  const key = new AccountKey({
    file,
    legacyFile: path.join(userData, "cloud-copy-key.json"),
    encryptor: keyStore ? encryptor : { ...encryptor, isAvailable: () => false },
    baseUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    token: () => cloud.token,
  });
  return { key, file, userData };
}

const vault = (cloud: Service) => cloud.fetch("http://tavora.test/v1/account/vault", { headers: { authorization: `Bearer ${cloud.token}` } });

describe("the account's key", () => {
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
    expect(a.key.get()).toBeNull();
    await expect(a.key.enter(recoveryKey(old))).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    await a.key.enter(b.key.recoveryKey()!);
    expect(a.key.get()?.equals(b.key.get()!)).toBe(true);
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

  it("never opens a sealed copy part as a vault", () => {
    const key = newCopyKey();
    expect(() => openVault(newCopyKey(), sealVault(key, Buffer.from("{}")))).toThrow();
  });
});
