import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PairingView } from "../shared/host-api";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, newPairingKey, openFromPc, pairingCode, pairingCommit, sealForPc } from "./copy-crypto";
import { FOLDER_PAIRING_MS, FolderPairing, MAX_OPEN_ANSWERS, OPEN_ANSWER_MS, Pairing, ServicePairing, type PairingOptions, type PairingTransport } from "./pairing";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

/** One PC: its account key and its pairing, through the service with `token` or through `folder`. */
async function onPc(fetch: typeof globalThis.fetch, token: string | null, transport?: PairingTransport, extra: Partial<PairingOptions> = {}) {
  const { userData } = await pc({ "library.json": "{}" });
  const accountKey = new AccountKey({ file: path.join(userData, "account-key.json"), encryptor, baseUrl: "http://tavora.test/v1/account", fetch, token: () => token, account: () => (token ? "me" : null) });
  const views: PairingView[] = [];
  let focused = 0;
  const pairing = new Pairing({
    copySync: { accountKey, place: transport ? "a folder" : null, keyArrived: async () => undefined, shareableKey: () => (accountKey.signedIn ? accountKey.get() : accountKey.copyKey()) },
    account: { token: () => token },
    serviceUrl: "http://tavora.test/v1/account",
    fetch,
    deviceName: "Desk",
    ...(transport ? { folderTransport: () => transport } : {}),
    onChange: (view) => views.push(view),
    focus: () => focused++,
    ...extra,
  });
  return { accountKey, pairing, views, focused: () => focused };
}

describe("the pairing keys", () => {
  it("seal the key for the other PC only, and give both the same code", () => {
    const fresh = newPairingKey();
    const old = newPairingKey();
    const root = newCopyKey();
    const sealed = sealForPc(old, fresh.publicKey, root);
    expect(openFromPc(fresh, old.publicKey, sealed).equals(root)).toBe(true);
    expect(() => openFromPc(newPairingKey(), old.publicKey, sealed)).toThrow();
    expect(sealed.includes(root)).toBe(false);
    expect(pairingCode(fresh.publicKey, old.publicKey)).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
    expect(pairingCode(fresh.publicKey, old.publicKey)).not.toBe(pairingCode(fresh.publicKey, newPairingKey().publicKey));
    expect(pairingCommit(fresh.publicKey)).toHaveLength(32);
  });
});

describe("approving a new PC through the service", () => {
  it("sends the key once the old PC's user clicks Add, with the same code on both", async () => {
    const cloud = await service();
    const old = await onPc(cloud.fetch, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    expect(await fresh.accountKey.setUp()).toEqual({ status: "ask" });

    await fresh.pairing.start();
    expect(fresh.pairing.view().asking).toMatchObject({ via: "service", step: "waiting" });
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toBeNull();
    await fresh.pairing.lookForAnswer();
    const code = fresh.pairing.view().asking?.code;
    expect(code).toMatch(/^.{3}-.{3}$/);
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ name: "Laptop", code });
    expect(old.focused()).toBe(1);

    await old.pairing.decide(old.pairing.view().approve!.id, true);
    expect(old.pairing.view().approve).toBeNull();
    await fresh.pairing.lookForAnswer();
    // Add came first: the key waits, unused, until this PC's user says the codes match.
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code", code });
    expect(fresh.accountKey.get()).toBeNull();
    await fresh.pairing.confirm();
    expect(fresh.pairing.view().asking).toBeNull();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    // Done: nothing is left on the service.
    expect((await cloud.fetch("http://tavora.test/v1/account/pairing", { headers: { authorization: `Bearer ${cloud.token}` } })).status).toBe(204);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("gets the new key to a PC whose key no longer opens the account's vault, and that PC hands out nothing", async () => {
    const cloud = await service();
    const stale = await onPc(cloud.fetch, cloud.token);
    await stale.accountKey.setUp();
    const old = stale.accountKey.get()!;
    // Another PC starts over with a new key.
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.accountKey.enter(stale.accountKey.recoveryKey()!);
    await fresh.accountKey.startOver();
    expect(await stale.accountKey.setUp()).toEqual({ status: "ask" });
    expect(stale.accountKey.trouble).toBe("unopened");

    // The stale PC asks, and doesn't cancel itself for the key it still has.
    await stale.pairing.start();
    await fresh.pairing.lookForRequests();
    await stale.pairing.lookForAnswer();
    expect(stale.pairing.view().asking).toMatchObject({ step: "code" });
    await fresh.pairing.lookForRequests();
    await fresh.pairing.decide(fresh.pairing.view().approve!.id, true);
    await stale.pairing.confirm();
    await stale.pairing.lookForAnswer();
    expect(stale.pairing.view().asking).toBeNull();
    expect(stale.accountKey.get()?.equals(fresh.accountKey.get()!)).toBe(true);
    expect(stale.accountKey.get()?.equals(old)).toBe(false);
    expect(stale.accountKey.trouble).toBeNull();
    stale.pairing.dispose();
    fresh.pairing.dispose();
  });

  it("never answers another PC while its key doesn't open the account's vault, and checks before it sends", async () => {
    const cloud = await service();
    const a = await onPc(cloud.fetch, cloud.token);
    await a.accountKey.setUp();
    const b = await onPc(cloud.fetch, await cloud.signIn("Tower"));
    await b.accountKey.enter(a.accountKey.recoveryKey()!);
    const newPc = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    expect(await newPc.accountKey.setUp()).toEqual({ status: "ask" });
    await newPc.pairing.start();

    // B answers, then A starts over before B's user clicks Add: B sees its key no longer fits and sends nothing.
    await b.pairing.lookForRequests();
    await newPc.pairing.lookForAnswer();
    await b.pairing.lookForRequests();
    const id = b.pairing.view().approve!.id;
    await a.accountKey.startOver();
    await expect(b.pairing.decide(id, true)).rejects.toMatchObject({ key: "pairing.error.oldKey" });
    expect(b.accountKey.trouble).toBe("unopened");
    await newPc.pairing.lookForAnswer();
    expect(newPc.accountKey.get()).toBeNull();

    // Asked again, B doesn't answer at all now.
    await newPc.pairing.start();
    await b.pairing.lookForRequests();
    await newPc.pairing.lookForAnswer();
    expect(newPc.pairing.view().asking).toMatchObject({ step: "waiting" });
    newPc.pairing.dispose();
    b.pairing.dispose();
    a.pairing.dispose();
  });

  it("asks again when Add did not get through, so the user can try again", async () => {
    const cloud = await service();
    let offline = false;
    const flaky = (async (url: string, init?: RequestInit) => {
      if (offline) throw new TypeError("fetch failed");
      return cloud.fetch(url, init);
    }) as typeof fetch;
    const old = await onPc(flaky, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    const id = old.pairing.view().approve!.id;
    offline = true;
    await expect(old.pairing.decide(id, true)).rejects.toMatchObject({ key: "cloudCopy.error.offline" });
    expect(old.pairing.view().approve).toMatchObject({ id, name: "Laptop" });
    offline = false;
    await old.pairing.decide(id, true);
    await fresh.pairing.lookForAnswer();
    await fresh.pairing.confirm();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("a No that did not get through stays a no", async () => {
    const cloud = await service();
    let offline = false;
    const flaky = (async (url: string, init?: RequestInit) => {
      if (offline) throw new TypeError("fetch failed");
      return cloud.fetch(url, init);
    }) as typeof fetch;
    const old = await onPc(flaky, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    offline = true;
    await expect(old.pairing.decide(old.pairing.view().approve!.id, false)).rejects.toMatchObject({ key: "cloudCopy.error.offline" });
    offline = false;
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toBeNull();
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("tells the new PC when the old PC's user said no, and isn't asked again", async () => {
    const cloud = await service();
    const old = await onPc(cloud.fetch, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    await old.pairing.decide(old.pairing.view().approve!.id, false);
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toBeNull();
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "declined" });
    expect(fresh.accountKey.get()).toBeNull();
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("keeps no key a rogue 'old PC' (or the service) sends before this PC's user says the codes match", async () => {
    const cloud = await service();
    // No PC of the account has a key yet: a planted one would become the account's.
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    const rogueToken = await cloud.signIn("Rogue");
    const rogue = new ServicePairing({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => rogueToken });
    const rogueKey = newPairingKey();

    await fresh.pairing.start();
    const asked = (await rogue.read())!;
    expect(await rogue.answer(asked.id, rogueKey.publicKey.toString("base64url"))).toBe(true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code", from: "Rogue" });
    const revealed = (await rogue.read())!.reveal!;
    await rogue.sendKey(asked.id, sealForPc(rogueKey, Buffer.from(revealed, "base64url"), newCopyKey()).toString("base64url"));

    await fresh.pairing.lookForAnswer();
    await fresh.pairing.lookForAnswer();
    // The user never said the codes match: nothing is kept, and the account gets no vault from it.
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code" });
    expect(fresh.accountKey.get()).toBeNull();
    expect(await fresh.accountKey.exists()).toBe(false);
    await fresh.pairing.cancel();
    expect(fresh.pairing.view().asking).toBeNull();
    expect(fresh.accountKey.get()).toBeNull();
    expect(await fresh.accountKey.exists()).toBe(false);
    fresh.pairing.dispose();
  });

  it("lets go of a key it holds when the recovery key is typed in meanwhile", async () => {
    const cloud = await service();
    const old = await onPc(cloud.fetch, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    await old.pairing.decide(old.pairing.view().approve!.id, true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code" });
    await fresh.accountKey.enter(old.accountKey.recoveryKey()!);
    await fresh.pairing.lookForAnswer();
    // Done asking, so this PC answers other PCs again.
    expect(fresh.pairing.view().asking).toBeNull();
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("waits after Codes match until the other PC's user clicks Add", async () => {
    const cloud = await service();
    const old = await onPc(cloud.fetch, cloud.token);
    await old.accountKey.setUp();
    const fresh = await onPc(cloud.fetch, await cloud.signIn("Laptop"));
    await fresh.pairing.start();
    // Codes match can't be pressed before there is a code.
    await expect(fresh.pairing.confirm()).rejects.toMatchObject({ key: "pairing.error.gone" });
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    await fresh.pairing.confirm();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "confirmed" });
    await fresh.pairing.lookForAnswer();
    expect(fresh.accountKey.get()).toBeNull();
    await old.pairing.decide(old.pairing.view().approve!.id, true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toBeNull();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("refuses a new PC whose key isn't the one it promised", async () => {
    const cloud = await service();
    const old = await onPc(cloud.fetch, cloud.token);
    await old.accountKey.setUp();
    const token = await cloud.signIn("Laptop");
    // A PC (or a service) that picks its key after seeing the old PC's: the commitment doesn't match.
    const sneaky = new ServicePairing({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => token });
    const { id } = await sneaky.ask(Buffer.from(pairingCommit(newPairingKey().publicKey)).toString("base64url"));
    await old.pairing.lookForRequests();
    await sneaky.reveal(id, newPairingKey().publicKey.toString("base64url"));
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toBeNull();
    expect(await sneaky.read()).toMatchObject({ declined: true });
    old.pairing.dispose();
  });
});

describe("approving a new PC through the copy's folder", () => {
  it("works signed out, ignores a sync app's copies, and cleans up after itself", async () => {
    const { root } = await pc();
    const folder = path.join(root, "OneDrive");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    const old = await onPc(fetch, null, new FolderPairing(folder, "Desk"));
    await old.accountKey.setUpHere(false);
    const freshTransport = new FolderPairing(folder, "Laptop");
    const fresh = await onPc(fetch, null, freshTransport);

    await fresh.pairing.start();
    expect(fresh.pairing.view().asking).toMatchObject({ via: "folder", step: "waiting" });
    const dir = path.join(folder, "Tavora", "pairing");
    const [request] = await readdir(dir);
    // A sync app's conflict copy is not a request.
    await writeFile(path.join(dir, request!.replace(".json", " (1).json")), "{}");

    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code", from: "Desk" });
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ name: "Laptop", code: fresh.pairing.view().asking!.code });
    // The codes match here first; the key comes with the other PC's Add.
    await fresh.pairing.confirm();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "confirmed", from: "Desk" });
    await old.pairing.decide(old.pairing.view().approve!.id, true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toBeNull();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    expect((await readdir(dir)).filter((name) => !name.includes("(1)"))).toEqual([]);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("keeps no key that anyone who can write the folder plants before this PC's user says the codes match", async () => {
    const { root } = await pc();
    const folder = path.join(root, "OneDrive");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    const fresh = await onPc(fetch, null, new FolderPairing(folder, "Laptop"));
    // Someone else on the share answers as an "old PC" and sends a key of their own.
    const rogue = new FolderPairing(folder, "Desk");
    const rogueKey = newPairingKey();

    await fresh.pairing.start();
    const asked = (await rogue.read())!;
    expect(await rogue.answer(asked.id, rogueKey.publicKey.toString("base64url"))).toBe(true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code" });
    const revealed = (await rogue.read())!.reveal!;
    await rogue.sendKey(asked.id, sealForPc(rogueKey, Buffer.from(revealed, "base64url"), newCopyKey()).toString("base64url"));

    await fresh.pairing.lookForAnswer();
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code" });
    expect(fresh.accountKey.get()).toBeNull();
    await fresh.pairing.cancel();
    expect(fresh.accountKey.get()).toBeNull();
    expect(await readdir(path.join(folder, "Tavora", "pairing"))).toEqual([]);
    fresh.pairing.dispose();
  });

  it("turns a request down when what it answered changes on the way", async () => {
    const { root } = await pc();
    const folder = path.join(root, "OneDrive");
    const dir = path.join(folder, "Tavora", "pairing");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    const old = await onPc(fetch, null, new FolderPairing(folder, "Desk"));
    await old.accountKey.setUpHere(false);
    const fresh = await onPc(fetch, null, new FolderPairing(folder, "Laptop"));
    const step = async (name: string) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as Record<string, unknown>;
    const other = newPairingKey().publicKey.toString("base64url");

    // Its own answer swapped for another key: turned down at the next look.
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    let [id] = (await readdir(dir)).map((name) => name.split(".")[0]!);
    await writeFile(path.join(dir, `${id}.answer.json`), JSON.stringify({ ...(await step(`${id}.answer.json`)), publicKey: other }));
    await old.pairing.lookForRequests();
    expect(await readdir(dir)).toContain(`${id}.declined.json`);
    await fresh.pairing.cancel();
    await rm(path.join(dir, `${id}.declined.json`), { force: true });

    // The new PC's key changed while "Add Laptop?" shows: the question goes away and nothing is sent.
    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    [id] = (await readdir(dir)).map((name) => name.split(".")[0]!);
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ id, name: "Laptop" });
    await writeFile(path.join(dir, `${id}.reveal.json`), JSON.stringify({ v: 1, publicKey: other }));
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toBeNull();
    await expect(old.pairing.decide(id!, true)).rejects.toMatchObject({ key: "pairing.error.gone" });
    expect(await readdir(dir)).not.toContain(`${id}.key.json`);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "declined" });
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("waits for a file a sync app hasn't finished instead of turning the request down", async () => {
    const { root } = await pc();
    const folder = path.join(root, "OneDrive");
    const dir = path.join(folder, "Tavora", "pairing");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    const old = await onPc(fetch, null, new FolderPairing(folder, "Desk"));
    await old.accountKey.setUpHere(false);
    const fresh = await onPc(fetch, null, new FolderPairing(folder, "Laptop"));
    const halfway = async (file: string, look: () => Promise<void>) => {
      const whole = await readFile(path.join(dir, file), "utf8");
      await writeFile(path.join(dir, file), whole.slice(0, 5));
      await look();
      await writeFile(path.join(dir, file), whole);
    };

    await fresh.pairing.start();
    await old.pairing.lookForRequests();
    const [id] = (await readdir(dir)).map((name) => name.split(".")[0]!);
    await fresh.pairing.lookForAnswer();
    // The old PC's answer, then the new PC's key, half there for a look: nothing is turned down.
    await halfway(`${id}.answer.json`, () => old.pairing.lookForRequests());
    expect(old.pairing.view().approve).toBeNull();
    await halfway(`${id}.reveal.json`, () => old.pairing.lookForRequests());
    expect(old.pairing.view().approve).toBeNull();
    expect(await readdir(dir)).not.toContain(`${id}.declined.json`);
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ id, code: fresh.pairing.view().asking!.code });
    // The same while "Add Laptop?" shows.
    await halfway(`${id}.reveal.json`, () => old.pairing.lookForRequests());
    await halfway(`${id}.answer.json`, () => old.pairing.lookForRequests());
    expect(old.pairing.view().approve).toMatchObject({ id });
    await old.pairing.decide(id!, true);
    await fresh.pairing.lookForAnswer();
    await fresh.pairing.confirm();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("waits for a request file a sync app hasn't finished, and leaves other PCs' files alone", async () => {
    const { root } = await pc();
    const folder = path.join(root, "OneDrive");
    const dir = path.join(folder, "Tavora", "pairing");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    const old = await onPc(fetch, null, new FolderPairing(folder, "Desk"));
    await old.accountKey.setUpHere(false);
    // A third PC with the key, which didn't answer.
    const other = new FolderPairing(folder, "Tower");
    const fresh = await onPc(fetch, null, new FolderPairing(folder, "Laptop"));
    const halfway = async (file: string, look: () => Promise<unknown>) => {
      const whole = await readFile(path.join(dir, file), "utf8");
      await writeFile(path.join(dir, file), whole.slice(0, 5));
      await look();
      await writeFile(path.join(dir, file), whole);
    };

    await fresh.pairing.start();
    const [id] = (await readdir(dir)).map((name) => name.split(".")[0]!);
    // Half there before anyone answered: nobody answers it, and nobody deletes it.
    await halfway(`${id}.request.json`, async () => {
      await old.pairing.lookForRequests();
      expect(await other.read()).toBeNull();
    });
    expect(await readdir(dir)).toEqual([`${id}.request.json`]);
    await old.pairing.lookForRequests();
    // Half there while both PCs are at it: each looks again, nothing is deleted or turned down.
    await halfway(`${id}.request.json`, async () => {
      await fresh.pairing.lookForAnswer();
      await old.pairing.lookForRequests();
      await other.read();
    });
    expect(fresh.pairing.view().asking).toMatchObject({ step: "waiting" });
    expect((await readdir(dir)).sort()).toEqual([`${id}.answer.json`, `${id}.request.json`]);
    await fresh.pairing.lookForAnswer();
    expect(fresh.pairing.view().asking).toMatchObject({ step: "code" });
    await halfway(`${id}.request.json`, () => old.pairing.lookForRequests());
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ id, code: fresh.pairing.view().asking!.code });
    // An answer that isn't readable yet is someone's: the third PC doesn't answer over it.
    await halfway(`${id}.answer.json`, async () => {
      expect(await other.read()).toBeNull();
      expect(await other.answer(id!, newPairingKey().publicKey.toString("base64url"))).toBe(false);
    });
    await old.pairing.decide(id!, true);
    await fresh.pairing.lookForAnswer();
    await fresh.pairing.confirm();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("cleans up a request file that is still unreadable once it is older than any request lasts", async () => {
    const { root } = await pc();
    let now = Date.now();
    await mkdir(path.join(root, "Tavora", "pairing"), { recursive: true });
    const dir = path.join(root, "Tavora", "pairing");
    await writeFile(path.join(dir, "0123456789abcdef.request.json"), "{\"v\":1,");
    await writeFile(path.join(dir, "0123456789abcdef.answer.json"), "{}");
    const pcWithKey = new FolderPairing(root, "Desk", () => now);
    expect(await pcWithKey.read()).toBeNull();
    expect(await readdir(dir)).toHaveLength(2);
    now += FOLDER_PAIRING_MS + 60_000;
    expect(await pcWithKey.read()).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it("stops answering, also after a restart, when request after request ends without a click", async () => {
    const { root, userData } = await pc();
    const folder = path.join(root, "OneDrive");
    const dir = path.join(folder, "Tavora", "pairing");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    let now = Date.now();
    const answersFile = path.join(userData, "pairing-answers.json");
    const transport = new FolderPairing(folder, "Desk");
    const old = await onPc(fetch, null, transport, { answersFile, now: () => now });
    await old.accountKey.setUpHere(false);
    // Whoever can write the folder asks as a "new PC" with a key of its own, sees which code the old PC would show,
    // and asks again with a fresh request when it isn't the one it needs, so the old PC never shows a question.
    const rogue = new FolderPairing(folder, "Laptop");
    const theirs = newPairingKey();
    const tryOnce = async () => {
      const { id } = await rogue.ask(pairingCommit(theirs.publicKey).toString("base64url"));
      await old.pairing.lookForRequests();
      const answer = (await rogue.read())?.answer;
      if (answer) pairingCode(theirs.publicKey, Buffer.from(answer.publicKey, "base64url"));
      await old.pairing.lookForRequests();
      await rogue.end(id, false);
      await old.pairing.lookForRequests();
      return answer !== undefined;
    };
    const tries: boolean[] = [];
    for (let i = 0; i < MAX_OPEN_ANSWERS + 2; i++) tries.push(await tryOnce());
    expect(tries).toEqual([...Array(MAX_OPEN_ANSWERS).fill(true), false, false]);
    expect(old.pairing.view().approve).toBeNull();

    // Started again, it still counts them.
    old.pairing.dispose();
    const restarted = new Pairing({
      copySync: { accountKey: old.accountKey, place: "a folder", keyArrived: async () => undefined, shareableKey: () => old.accountKey.copyKey() },
      account: { token: () => null },
      serviceUrl: "http://tavora.test/v1/account",
      deviceName: "Desk",
      folderTransport: () => new FolderPairing(folder, "Desk"),
      onChange: () => undefined,
      focus: () => undefined,
      answersFile,
      now: () => now,
    });
    const fresh = await onPc(fetch, null, new FolderPairing(folder, "Laptop"));
    await fresh.pairing.start();
    await restarted.lookForRequests();
    expect((await readdir(dir)).some((name) => name.endsWith(".answer.json"))).toBe(false);

    // An hour on, a real new PC is answered again and gets the key.
    now += OPEN_ANSWER_MS;
    await restarted.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await restarted.lookForRequests();
    expect(restarted.view().approve).toMatchObject({ name: "Laptop", code: fresh.pairing.view().asking!.code });
    await restarted.decide(restarted.view().approve!.id, true);
    await fresh.pairing.lookForAnswer();
    await fresh.pairing.confirm();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    // Answered with a click: it doesn't count.
    expect(JSON.parse(await readFile(answersFile, "utf8"))).toMatchObject({ at: expect.any(Array) });
    expect((JSON.parse(await readFile(answersFile, "utf8")) as { at: number[] }).at.filter((at) => now - at < OPEN_ANSWER_MS)).toHaveLength(0);
    fresh.pairing.dispose();
    restarted.dispose();
  });

  it("lasts a day, then is gone", async () => {
    const { root } = await pc();
    let now = Date.parse("2026-10-20T12:00:00Z");
    const fresh = new FolderPairing(root, "Laptop", () => now);
    const old = new FolderPairing(root, "Desk", () => now);
    await mkdir(path.join(root, "Tavora"), { recursive: true });
    const { id } = await fresh.ask("x".repeat(43));
    now += FOLDER_PAIRING_MS - 1;
    expect(await old.read()).toMatchObject({ id, own: false, name: "Laptop" });
    now += 2;
    expect(await old.read()).toBeNull();
    expect(await readdir(path.join(root, "Tavora", "pairing"))).toEqual([]);
  });
});
