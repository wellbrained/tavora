import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { newPairingKey, pairingCommit } from "./copy-crypto";
import { ANSWER_WAIT_MS, FolderPairing, MAX_OPEN_ANSWERS, OPEN_ANSWER_MS, Pairing, ServicePairing, SLOW_ANSWER_MS, type PairingOptions, type PairingTransport } from "./pairing";

// An old PC asked again and again by whoever carries the messages: each answer counts, however it ends.

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
const commit = () => pairingCommit(newPairingKey().publicKey).toString("base64url");

/** A PC signed out, with the cloud copy in a folder: `transport` carries its pairing. */
async function onPc(transport: PairingTransport, extra: Partial<PairingOptions> = {}) {
  const { userData } = await pc({ "library.json": "{}" });
  const accountKey = new AccountKey({ file: path.join(userData, "account-key.json"), encryptor, baseUrl: "http://tavora.test/v1/account", fetch, token: () => null, account: () => null });
  const pairing = new Pairing({
    copySync: { accountKey, place: "a folder", keyArrived: async () => undefined, shareableKey: () => accountKey.copyKey() },
    account: { token: () => null },
    serviceUrl: "http://tavora.test/v1/account",
    deviceName: "Desk",
    folderTransport: () => transport,
    onChange: () => undefined,
    focus: () => undefined,
    ...extra,
  });
  return { accountKey, pairing };
}

async function oldPc(transport: PairingTransport, extra: Partial<PairingOptions> = {}) {
  const old = await onPc(transport, extra);
  await old.accountKey.setUpHere(false);
  return old;
}

/** Whoever carries the messages: a new request after each answer, answered as `answer` says. */
function carrier(answer: () => Promise<boolean>, ids: (n: number) => string = (n) => `request-${n}`) {
  let n = 0;
  const answered: string[] = [];
  const transport: PairingTransport = {
    via: "folder",
    read: async () => ({ id: ids(n), own: false, name: "Laptop", commit: commit(), expiresAt: Date.now() + 100 * OPEN_ANSWER_MS }),
    ask: async () => ({ id: "x", expiresAt: 0 }),
    answer: async (id) => {
      answered.push(id);
      n++;
      return answer();
    },
    reveal: async () => undefined,
    sendKey: async () => undefined,
    end: async () => undefined,
  };
  return { transport, answered };
}

async function look(pairing: Pairing, times: number) {
  for (let i = 0; i < times; i++) await pairing.lookForRequests();
}

it("counts an answer before its key goes out, whether another PC was first or it failed", async () => {
  for (const answer of [async () => false, () => Promise.reject(new Error("503"))]) {
    const { transport, answered } = carrier(answer);
    const old = await oldPc(transport);
    await look(old.pairing, MAX_OPEN_ANSWERS + 4);
    expect(answered).toEqual(["request-0", "request-1", "request-2"]);
    expect(old.pairing.view().approve).toBeNull();
    old.pairing.dispose();
  }
});

it("counts an answer the service turns away", async () => {
  let n = 0;
  const posted: string[] = [];
  const busy = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return Response.json({ id: `request-${n}`, own: false, name: "Laptop", commit: commit(), expiresAt: new Date(Date.now() + 600_000).toISOString() });
    if (url.endsWith("/answer")) {
      posted.push(url);
      n++;
      return Response.json({ reason: "not-now" }, { status: 409 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const old = await oldPc(new ServicePairing({ baseUrl: "http://tavora.test/v1/account", fetch: busy, token: () => "token" }));
  await look(old.pairing, MAX_OPEN_ANSWERS + 4);
  expect(posted).toHaveLength(MAX_OPEN_ANSWERS);
  old.pairing.dispose();
});

it("can't have its saved answers written over by a request's name, and counts each request once", async () => {
  const { userData } = await pc();
  const answersFile = path.join(userData, "pairing-answers.json");
  await mkdir(userData, { recursive: true });
  await writeFile(answersFile, JSON.stringify({ v: 1, at: [Date.now(), Date.now()] }));
  const { transport, answered } = carrier(async () => false, (n) => `saved-${n}`);
  const old = await oldPc(transport, { answersFile });
  await look(old.pairing, MAX_OPEN_ANSWERS + 2);
  expect(answered).toEqual(["saved-0"]);
  expect((JSON.parse(await readFile(answersFile, "utf8")) as { at: number[] }).at).toHaveLength(MAX_OPEN_ANSWERS);
  old.pairing.dispose();
});

it("counts a saved time ahead of the clock from now", async () => {
  const { userData } = await pc();
  let now = Date.now();
  const answersFile = path.join(userData, "pairing-answers.json");
  await mkdir(userData, { recursive: true });
  await writeFile(answersFile, JSON.stringify({ v: 1, at: Array(MAX_OPEN_ANSWERS).fill(now + 10 * OPEN_ANSWER_MS) }));
  const { transport, answered } = carrier(async () => false);
  const old = await oldPc(transport, { answersFile, now: () => now });
  await look(old.pairing, 2);
  expect(answered).toEqual([]);
  now += OPEN_ANSWER_MS;
  await look(old.pairing, 1);
  expect(answered).toEqual(["request-0"]);
  old.pairing.dispose();
});

it("lets go of a request whose new PC never shows its key, and answers others again", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  let now = Date.now();
  const old = await oldPc(new FolderPairing(folder, "Desk"), { now: () => now });
  const rogue = new FolderPairing(folder, "Laptop");
  // Someone who can write the folder asks, then keeps the request unreadable once the old PC answered.
  const { id } = await rogue.ask(commit());
  await old.pairing.lookForRequests();
  expect((await readdir(dir)).sort()).toEqual([`${id}.answer.json`, `${id}.request.json`]);
  await writeFile(path.join(dir, `${id}.request.json`), "{");
  // A real new PC asks meanwhile: not answered while the old PC still waits.
  const fresh = await onPc(new FolderPairing(folder, "Laptop"));
  await fresh.pairing.start();
  now += ANSWER_WAIT_MS.folder - 1;
  await old.pairing.lookForRequests();
  expect((await readdir(dir)).filter((name) => name.endsWith(".answer.json"))).toEqual([`${id}.answer.json`]);
  // Long enough: it lets go and answers the real one.
  now += 1;
  await old.pairing.lookForRequests();
  await fresh.pairing.lookForAnswer();
  await old.pairing.lookForRequests();
  expect(old.pairing.view().approve).toMatchObject({ name: "Laptop", code: fresh.pairing.view().asking!.code });
  fresh.pairing.dispose();
  old.pairing.dispose();
});

it("says so when it answers no more for now, and the new PC says to check the other PC", async () => {
  let now = Date.now();
  const { transport } = carrier(async () => false);
  const old = await oldPc(transport, { now: () => now });
  await look(old.pairing, MAX_OPEN_ANSWERS + 3);
  // Once, not on every look.
  expect(old.pairing.view().tooManyTries).toBe(1);
  now += 5 * 60_000;
  await look(old.pairing, 2);
  expect(old.pairing.view().tooManyTries).toBe(2);
  old.pairing.dispose();

  const { root } = await pc();
  await mkdir(path.join(root, "Tavora"), { recursive: true });
  const fresh = await onPc(new FolderPairing(root, "Laptop"), { now: () => now });
  await fresh.pairing.start();
  await fresh.pairing.lookForAnswer();
  expect(fresh.pairing.view().asking).toMatchObject({ step: "waiting", slow: false });
  now += SLOW_ANSWER_MS.folder;
  await fresh.pairing.lookForAnswer();
  expect(fresh.pairing.view().asking).toMatchObject({ step: "waiting", slow: true });
  fresh.pairing.dispose();
});
