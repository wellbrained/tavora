import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PairingView } from "../shared/host-api";
import { AccountKey } from "./account-key";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey, newPairingKey, openFromPc, pairingCode, pairingCommit, sealForPc } from "./copy-crypto";
import { FOLDER_PAIRING_MS, FolderPairing, Pairing, ServicePairing, type PairingTransport } from "./pairing";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

/** One PC: its account key and its pairing, through the service with `token` or through `folder`. */
async function onPc(fetch: typeof globalThis.fetch, token: string | null, transport?: PairingTransport) {
  const { userData } = await pc({ "library.json": "{}" });
  const accountKey = new AccountKey({ file: path.join(userData, "account-key.json"), encryptor, baseUrl: "http://tavora.test/v1/account", fetch, token: () => token });
  const service = token ? new ServicePairing({ baseUrl: "http://tavora.test/v1/account", fetch, token: () => token }) : null;
  const views: PairingView[] = [];
  let focused = 0;
  const pairing = new Pairing({
    accountKey,
    service: () => service,
    folder: () => transport ?? null,
    received: async (key, via) => {
      if (via === "service") await accountKey.take(key);
      else await accountKey.takeHere(key);
    },
    onChange: (view) => views.push(view),
    focus: () => focused++,
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
  it("sends the key once the old PC's player clicks Add, with the same code on both", async () => {
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
    expect(fresh.pairing.view().asking).toBeNull();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    // Done: nothing is left on the service.
    expect((await cloud.fetch("http://tavora.test/v1/account/pairing", { headers: { authorization: `Bearer ${cloud.token}` } })).status).toBe(204);
    fresh.pairing.dispose();
    old.pairing.dispose();
  });

  it("tells the new PC when the old PC's player said no, and isn't asked again", async () => {
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
    await old.pairing.decide(old.pairing.view().approve!.id, true);
    await fresh.pairing.lookForAnswer();
    expect(fresh.accountKey.get()?.equals(old.accountKey.get()!)).toBe(true);
    expect((await readdir(dir)).filter((name) => !name.includes("(1)"))).toEqual([]);
    fresh.pairing.dispose();
    old.pairing.dispose();
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
