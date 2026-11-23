import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AccountKey } from "./account-key";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { newPairingKey, pairingCommit } from "./copy-crypto";
import type { PairingKey } from "./copy-crypto";
import { ANSWER_WAIT_MS, CLOCK_AHEAD_MS, FOLDER_PAIRING_MS, FolderPairing, MAX_OPEN_ANSWERS, OPEN_ANSWER_MS, Pairing, ServicePairing, SLOW_ANSWER_MS, type PairingOptions, type PairingTransport } from "./pairing";

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

it("keeps counting an answer after a No, so a wrong code shown isn't a free try", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  const old = await oldPc(new FolderPairing(folder, "Desk"));
  // Whoever can write the folder asks with a key of its own and reveals it: the old PC shows a code that matches
  // nothing, and its user says no.
  const rogue = new FolderPairing(folder, "Laptop");
  const tryOnce = async () => {
    const theirs: PairingKey = newPairingKey();
    const { id } = await rogue.ask(pairingCommit(theirs.publicKey).toString("base64url"));
    await old.pairing.lookForRequests();
    const answered = (await rogue.read())?.answer !== undefined;
    if (answered) {
      await rogue.reveal(id, theirs.publicKey.toString("base64url"));
      await old.pairing.lookForRequests();
      await old.pairing.decide(old.pairing.view().approve!.id, false);
    }
    await rogue.end(id, false);
    return answered;
  };
  const tries: boolean[] = [];
  for (let i = 0; i < MAX_OPEN_ANSWERS + 1; i++) tries.push(await tryOnce());
  expect(tries).toEqual([...Array(MAX_OPEN_ANSWERS).fill(true), false]);
  old.pairing.dispose();
});

it("answers a second new PC after the first one is done, whatever its old files look like", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  const old = await oldPc(new FolderPairing(folder, "Desk"));
  const done = new Set<string>();
  const pairOnce = async (name: string, end: "add" | "cancel") => {
    const fresh = await onPc(new FolderPairing(folder, name));
    await fresh.pairing.start();
    const id = (await readdir(dir)).map((file) => file.split(".")[0]!).find((name) => !done.has(name))!;
    done.add(id);
    await old.pairing.lookForRequests();
    await fresh.pairing.lookForAnswer();
    await old.pairing.lookForRequests();
    expect(old.pairing.view().approve).toMatchObject({ name, code: fresh.pairing.view().asking!.code });
    if (end === "add") {
      await old.pairing.decide(id, true);
      await fresh.pairing.lookForAnswer();
      await fresh.pairing.confirm();
    } else {
      await fresh.pairing.cancel();
      await old.pairing.lookForRequests();
    }
    fresh.pairing.dispose();
    // Its request file comes back half there (a sync app bringing an old copy): it doesn't hold up the next PC.
    await writeFile(path.join(dir, `${id}.request.json`), "{");
  };
  await pairOnce("Laptop", "add");
  await pairOnce("Tablet", "cancel");
  await pairOnce("Tower", "add");
  old.pairing.dispose();
});

it("doesn't answer when it can't note the answer down", async () => {
  const { userData } = await pc();
  // A folder where the file should be: it can't be written.
  const answersFile = path.join(userData, "pairing-answers.json");
  await mkdir(path.join(answersFile, "taken"), { recursive: true });
  const { transport, answered } = carrier(async () => true);
  const old = await oldPc(transport, { answersFile });
  await look(old.pairing, 3);
  expect(answered).toEqual([]);
  old.pairing.dispose();
});

// Anyone who can write the folder can plant a request. It may make adding a PC fail for a while, but not for good.

/** A request as only someone writing the folder would plant it, lasting until `expiresAt`. */
async function plant(dir: string, id: string, expiresAt: number) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.request.json`), JSON.stringify({ v: 1, name: "Laptop", commit: commit(), expiresAt }));
}

it("never answers a request that says it lasts longer than any request does, and removes it", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  const now = Date.now();
  const old = await oldPc(new FolderPairing(folder, "Desk", () => now), { now: () => now });
  await plant(dir, "0123456789abcdef", now + 10 * 365 * 24 * 60 * 60_000);
  await old.pairing.lookForRequests();
  expect(await readdir(dir)).toEqual([]);
  // One made by a PC whose clock is a little ahead is still answered.
  await plant(dir, "fedcba9876543210", now + FOLDER_PAIRING_MS + CLOCK_AHEAD_MS);
  await old.pairing.lookForRequests();
  expect((await readdir(dir)).sort()).toEqual(["fedcba9876543210.answer.json", "fedcba9876543210.request.json"]);
  old.pairing.dispose();
});

it("answers a real new PC once it let go of a planted request, though the planted one stays and looks newer", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  await mkdir(path.dirname(dir), { recursive: true });
  let now = Date.now();
  const old = await oldPc(new FolderPairing(folder, "Desk", () => now), { now: () => now });
  const fresh = await onPc(new FolderPairing(folder, "Laptop", () => now), { now: () => now });
  await fresh.pairing.start();
  await plant(dir, "0123456789abcdef", now + FOLDER_PAIRING_MS + CLOCK_AHEAD_MS);
  await old.pairing.lookForRequests();
  expect(await readdir(dir)).toContain("0123456789abcdef.answer.json");
  // Whoever planted it takes the answer away, so it looks unanswered, and never shows a key: let go of, and the real
  // one is answered.
  await rm(path.join(dir, "0123456789abcdef.answer.json"));
  now += ANSWER_WAIT_MS.folder;
  await old.pairing.lookForRequests();
  await fresh.pairing.lookForAnswer();
  await old.pairing.lookForRequests();
  expect(old.pairing.view().approve).toMatchObject({ name: "Laptop", code: fresh.pairing.view().asking!.code });
  fresh.pairing.dispose();
  old.pairing.dispose();
});

it("lets go of a request it answered once the request runs out, also when its key came and nobody clicked", async () => {
  const start = Date.now();
  let now = start;
  const theirs = newPairingKey();
  let sent: string | null = null;
  // A carrier that answers with the new PC's key, and keeps showing the request after it ran out.
  const transport: PairingTransport = {
    via: "folder",
    read: async () => ({
      id: "planted",
      own: false,
      name: "Laptop",
      commit: pairingCommit(theirs.publicKey).toString("base64url"),
      expiresAt: start + 60_000,
      ...(sent ? { answer: { name: "Desk", publicKey: sent }, reveal: theirs.publicKey.toString("base64url") } : {}),
    }),
    ask: async () => ({ id: "x", expiresAt: 0 }),
    answer: async (_id, publicKey) => {
      sent = publicKey;
      return true;
    },
    reveal: async () => undefined,
    sendKey: async () => undefined,
    end: async () => undefined,
  };
  const old = await oldPc(transport, { now: () => now });
  await look(old.pairing, 2);
  expect(old.pairing.view().approve).toMatchObject({ id: "planted", name: "Laptop" });
  now = start + 60_000;
  await old.pairing.lookForRequests();
  expect(old.pairing.view().approve).toBeNull();
  old.pairing.dispose();
});

it("reads, writes and cleans up nothing through a link in place of the pairing folder", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const elsewhere = path.join(root, "elsewhere");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  const now = Date.now();
  // Out there: a request run out long ago, which a look would clean up.
  await plant(elsewhere, "0123456789abcdef", now - 1);
  await symlink(elsewhere, path.join(folder, "Tavora", "pairing"), "junction");
  const transport = new FolderPairing(folder, "Desk", () => now);
  expect(await transport.read()).toBeNull();
  expect(await readdir(elsewhere)).toEqual(["0123456789abcdef.request.json"]);
  await expect(transport.ask(commit())).rejects.toMatchObject({ reason: "folder-locked" });
  expect(await readdir(elsewhere)).toEqual(["0123456789abcdef.request.json"]);
});

it("reads no step through a link in place of its file", async (context) => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  const dir = path.join(folder, "Tavora", "pairing");
  const elsewhere = path.join(root, "elsewhere");
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  await plant(elsewhere, "0123456789abcdef", now + 60_000);
  try {
    await symlink(path.join(elsewhere, "0123456789abcdef.request.json"), path.join(dir, "0123456789abcdef.request.json"), "file");
  } catch (error) {
    // Windows makes file links only with the right to: nothing to look at there.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip();
    throw error;
  }
  expect(await new FolderPairing(folder, "Desk", () => now).read()).toBeNull();
});

it("answers a real request from a PC whose clock is hours ahead", async () => {
  const { root } = await pc();
  const folder = path.join(root, "OneDrive");
  await mkdir(path.join(folder, "Tavora"), { recursive: true });
  const now = Date.now();
  // Its clock is six hours ahead: its request says it lasts until 30 hours from here.
  const { id } = await new FolderPairing(folder, "Laptop", () => now + 6 * 60 * 60_000).ask(commit());
  const old = await oldPc(new FolderPairing(folder, "Desk", () => now), { now: () => now });
  await old.pairing.lookForRequests();
  expect((await readdir(path.join(folder, "Tavora", "pairing"))).sort()).toEqual([`${id}.answer.json`, `${id}.request.json`]);
  old.pairing.dispose();
});
