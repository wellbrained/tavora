import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { fingerprint } from "@tavora/pack";
import { afterEach, describe, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { DeveloperKeys } from "./developer-keys";

afterEach(async () => {
  await cleanUp();
});

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;

/** Tavora on one PC of the test account. */
async function tavora(cloud: Service, options: { offline?: () => boolean } = {}) {
  const { userData } = await pc({ "library.json": "{}" });
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (options.offline?.()) throw new TypeError("fetch failed");
    return cloud.fetch(url, init);
  }) as typeof fetch;
  const accountKey = new AccountKey({
    file: path.join(userData, "account-key.json"),
    cacheFile: path.join(userData, "account-vault.bin"),
    encryptor,
    baseUrl: "http://tavora.test/v1/account",
    fetch: fetchImpl,
    token: () => cloud.token,
  });
  const linked: string[] = [];
  const keys = new DeveloperKeys({
    accountKey,
    account: {
      signedIn: () => true,
      link: async (key) => void linked.push(fingerprint(key)),
      publish: async () => {
        throw new Error("not in these tests");
      },
    },
    onChange: () => undefined,
  });
  return { keys, accountKey, linked };
}

describe("the publisher keys Tavora keeps", () => {
  it("makes the account's key with the first publisher key, links it, and keeps it for the next PC", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    await a.keys.refresh();
    expect(a.keys.view().status).toBe("none");
    await a.keys.create();
    const view = a.keys.view();
    expect(view).toMatchObject({ status: "ready", keys: [{ fingerprint: expect.stringMatching(/^[0-9a-f]{32}$/) }] });
    expect(view.recoveryKey).toBe(a.accountKey.recoveryKey());
    expect(a.linked).toEqual([view.keys[0]!.fingerprint]);
    a.keys.keySaved();
    expect(a.keys.view().recoveryKey).toBeNull();

    // Another PC asks for the recovery key, then has the same publisher key.
    const b = await tavora(cloud);
    await b.keys.refresh();
    expect(b.keys.view().status).toBe("ask");
    await expect(b.keys.create()).rejects.toMatchObject({ key: "developerKeys.error.needRecoveryKey" });
    await b.keys.enterKey(a.accountKey.recoveryKey()!);
    expect(b.keys.view()).toMatchObject({ status: "ready", keys: view.keys });
  });

  it("adds a key from a file once, and refuses anything else", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    await a.keys.add(pem);
    await a.keys.add(pem);
    expect(a.keys.view().keys).toEqual([{ fingerprint: fingerprint(privateKey) }]);
    expect(a.keys.exportKey(fingerprint(privateKey))).toBe(pem);
    await expect(a.keys.add("not a key")).rejects.toMatchObject({ key: "developerKeys.error.notKey" });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    await expect(a.keys.add(rsa)).rejects.toMatchObject({ key: "developerKeys.error.notKey" });
  });

  it("replaces a lost key with the newest kept key that is linked, or makes one", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    const lost = "0123456789abcdef0123456789abcdef";
    // Nothing kept here yet: a new key is made and linked.
    const made = await a.keys.replacementFor(lost, [lost]);
    expect(a.linked).toEqual([made]);
    const second = await a.keys.create();
    expect(await a.keys.replacementFor(lost, [lost, made, second])).toBe(second);
    // A kept key the account hasn't linked, and the lost key itself, are never picked.
    expect(await a.keys.replacementFor(second, [made, second])).toBe(made);
    expect(await a.keys.replacementFor(lost, [lost, made])).toBe(made);
  });

  it("keeps the keys read last while offline", async () => {
    const cloud = await service();
    let offline = false;
    const a = await tavora(cloud, { offline: () => offline });
    await a.keys.create();
    const before = a.keys.view().keys;
    offline = true;
    await a.keys.refresh();
    expect(a.keys.view()).toMatchObject({ status: "ready", keys: before });
  });

  it("moves the publisher keys over when this PC starts over with a new recovery key", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    await a.keys.create();
    const before = a.keys.view().keys;
    await a.accountKey.startOver();
    await a.keys.refresh();
    expect(a.keys.view().keys).toEqual(before);
  });
});
