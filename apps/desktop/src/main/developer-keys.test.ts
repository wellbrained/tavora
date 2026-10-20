import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fingerprint, packModule, PUBLISH_STATEMENT, readZip, tavoraSigner, verifyFiles } from "@tavora/pack";
import { afterEach, describe, expect, it } from "vitest";
import type { DeveloperKeysView } from "../shared/host-api";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { DeveloperKeys } from "./developer-keys";
import { startSignerServer, type SignerServer } from "./signer-server";

const servers: SignerServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await cleanUp();
});

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;

/** Tavora on one PC of the test account, with its signer listening. `answer` clicks on each sign request. */
async function tavora(cloud: Service, answer: ((view: DeveloperKeysView) => boolean | null) | null = () => true, options: { offline?: () => boolean } = {}) {
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
  let focused = 0;
  const keys: DeveloperKeys = new DeveloperKeys({
    accountKey,
    account: { signedIn: () => true, link: async (key) => void linked.push(fingerprint(key)) },
    onChange: (view) => {
      const request = view.request;
      if (!request || !answer) return;
      const allowed = answer(view);
      if (allowed !== null) queueMicrotask(() => keys.answer(request.id, allowed));
    },
    focus: () => void focused++,
    signWaitMs: 300,
  });
  const address = process.platform === "win32" ? `\\\\.\\pipe\\tavora-signer-test-${path.basename(userData)}-${Math.random()}` : path.join(userData, "signer", "signer.sock");
  const server = (await startSignerServer({ handle: (request) => keys.handle(request), address }))!;
  servers.push(server);
  return { keys, accountKey, linked, address, focused: () => focused };
}

async function moduleFolder(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-module-"));
  await mkdir(path.join(dir, "dist"));
  await writeFile(path.join(dir, "dist", "index.html"), "<p>hi</p>");
  const manifest = { id: "wellbrained.tracker", name: "Tracker", version: "1.2.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } };
  await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify(manifest));
  return dir;
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

  it("signs for tavora-pack after the click, and never without it", async () => {
    const cloud = await service();
    let allow = true;
    const a = await tavora(cloud, (view) => {
      expect(view.request).toMatchObject({ kind: "package", module: { id: "wellbrained.tracker", name: "Tracker", version: "1.2.0" } });
      return allow;
    });
    await a.keys.create();
    const kept = a.keys.view().keys[0]!.fingerprint;

    const signer = (await tavoraSigner({ address: a.address }))!;
    expect(signer.fingerprint).toBe(kept);
    const { zip } = await packModule(await moduleFolder(), signer);
    expect(verifyFiles(readZip(zip))).toEqual({ ok: true, owner: kept, signed: true });
    expect(a.focused()).toBe(1);

    allow = false;
    await expect(packModule(await moduleFolder(), signer)).rejects.toThrow(/turned down/);
  });

  it("turns down a request nobody answers, and one at a time", async () => {
    const cloud = await service();
    const a = await tavora(cloud, null);
    await a.keys.create();
    const signer = (await tavoraSigner({ address: a.address }))!;
    const first = packModule(await moduleFolder(), signer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(packModule(await moduleFolder(), signer)).rejects.toThrow(/already asking/);
    await expect(first).rejects.toThrow(/turned down/);
    expect(a.keys.view().request).toBeNull();
  });

  it("refuses a manifest the file hashes don't name, and a key it doesn't keep", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    await a.keys.create();
    const publicKey = (await tavoraSigner({ address: a.address }))!.publicKey;
    const manifest = Buffer.from(JSON.stringify({ id: "x.y", name: "Y", version: "1.0.0" }));
    const hashes = { "tavora.module.json": createHash("sha256").update("something else").digest("hex") };
    expect(await a.keys.handle({ v: 1, op: "sign-package", publicKey, files: hashes, manifest: manifest.toString("base64") })).toEqual({ ok: false, reason: "bad-request" });
    const right = { "tavora.module.json": createHash("sha256").update(manifest).digest("hex") };
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
    expect(await a.keys.handle({ v: 1, op: "sign-package", publicKey: other, files: right, manifest: manifest.toString("base64") })).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("signs the publish statement for a zip its key packed", async () => {
    const cloud = await service();
    const a = await tavora(cloud);
    await a.keys.create();
    const fp = a.keys.view().keys[0]!.fingerprint;
    const { privateKey } = generateKeyPairSync("ed25519");
    const { zip: foreign } = await packModule(await moduleFolder(), privateKey);
    expect(await a.keys.handle({ v: 1, op: "sign-publish", zip: foreign.toString("base64") })).toEqual({ ok: false, reason: "unknown-key" });

    const signer = (await tavoraSigner({ address: a.address }))!;
    const { zip } = await packModule(await moduleFolder(), signer);
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const signature = await signer.signPublish(zip, sha256);
    const key = createPublicKey(a.keys.exportKey(fp));
    expect(verify(null, Buffer.from(`${PUBLISH_STATEMENT}\n${sha256}`), key, signature)).toBe(true);
  });

  it("still signs offline with the keys read last", async () => {
    const cloud = await service();
    let offline = false;
    const a = await tavora(cloud, () => true, { offline: () => offline });
    await a.keys.create();
    offline = true;
    const signer = (await tavoraSigner({ address: a.address }))!;
    const { zip } = await packModule(await moduleFolder(), signer);
    expect(verifyFiles(readZip(zip))).toMatchObject({ ok: true, signed: true });
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
