import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc } from "./cloud-copy.test-helper";

// A short code, so a test can grind one the way someone with a lot of computers could grind the real 6 characters.
vi.mock("./copy-crypto", async (actual) => {
  const real = await actual<typeof import("./copy-crypto")>();
  return { ...real, pairingCode: (newPc: Uint8Array, oldPc: Uint8Array) => real.pairingCode(newPc, oldPc).slice(0, 2) };
});

const { newPairingKey, pairingCode, pairingCommit } = await import("./copy-crypto");
const { FolderPairing, Pairing } = await import("./pairing");

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function onPc(transport: InstanceType<typeof FolderPairing>) {
  const { userData } = await pc({ "library.json": "{}" });
  const accountKey = new AccountKey({ file: path.join(userData, "account-key.json"), encryptor, baseUrl: "http://tavora.test/v1/account", fetch, token: () => null, account: () => null });
  const pairing = new Pairing({
    copySync: { accountKey, place: "a folder", keyArrived: async () => undefined, shareableKey: () => accountKey.copyKey() },
    account: { token: () => null },
    serviceUrl: "http://tavora.test/v1/account",
    deviceName: "PC",
    folderTransport: () => transport,
    onChange: () => undefined,
    focus: () => undefined,
  });
  return { accountKey, pairing };
}

it("gives the key to nobody who swaps the new PC's promise after the old PC answered", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  const old = await onPc(new FolderPairing(folder, "Desk"));
  await old.accountKey.setUpHere(false);
  const fresh = await onPc(new FolderPairing(folder, "Laptop"));
  const readStep = async (name: string) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as Record<string, unknown>;
  const writeStep = (name: string, value: Record<string, unknown>) => writeFile(path.join(dir, name), JSON.stringify(value));

  // The new PC asks; the old PC answers with its one-time key O.
  await fresh.pairing.start();
  await old.pairing.lookForRequests();
  const [id] = (await readdir(dir)).map((name) => name.split(".")[0]!);
  const answer = await readStep(`${id}.answer.json`);
  const oldPc = Buffer.from(answer.publicKey as string, "base64url");

  // Whoever can write the folder shows the new PC a key of their own, O'.
  const theirs = newPairingKey();
  await writeStep(`${id}.answer.json`, { ...answer, publicKey: b64(theirs.publicKey) });
  await fresh.pairing.lookForAnswer();
  const shown = fresh.pairing.view().asking!.code!;
  const newPc = Buffer.from((await readStep(`${id}.reveal.json`)).publicKey as string, "base64url");
  expect(shown).toBe(pairingCode(newPc, theirs.publicKey));

  // Now they know the new PC's key, they look for one of their own that gives the old PC the same code...
  let mine = newPairingKey();
  while (pairingCode(mine.publicKey, oldPc) !== shown) mine = newPairingKey();
  // ...and put it in the new PC's place: a new promise, the matching key, and O back where the old PC looks.
  const request = await readStep(`${id}.request.json`);
  await writeStep(`${id}.request.json`, { ...request, commit: b64(pairingCommit(mine.publicKey)) });
  await writeStep(`${id}.reveal.json`, { v: 1, publicKey: b64(mine.publicKey) });
  await writeStep(`${id}.answer.json`, answer);

  // The old PC checks the key against the promise it saw when it answered: it asks nothing and sends nothing.
  await old.pairing.lookForRequests();
  expect(old.pairing.view().approve).toBeNull();
  await expect(old.pairing.decide(id!, true)).rejects.toMatchObject({ key: "pairing.error.gone" });
  expect(await readdir(dir)).not.toContain(`${id}.key.json`);
  expect(await readdir(dir)).toContain(`${id}.declined.json`);
  // Nor is it asked again.
  await old.pairing.lookForRequests();
  expect(old.pairing.view().approve).toBeNull();
  // The new PC hears it was turned down.
  await fresh.pairing.lookForAnswer();
  expect(fresh.pairing.view().asking).toMatchObject({ step: "declined" });
  fresh.pairing.dispose();
  old.pairing.dispose();
});
