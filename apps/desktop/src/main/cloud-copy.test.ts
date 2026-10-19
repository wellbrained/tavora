import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudCopy, copyRoots, CopyError, EMPTY_STATE, hasLocalChanges, loadCopyKey, safeCopyPath, saveCopyKey, swapInCopy, type CopyState } from "./cloud-copy";
import { copyKeys, newCopyKey, open, parseRecoveryKey, partId, recoveryKey, seal } from "./copy-crypto";

const OWNER = "0123456789abcdef0123456789abcdef";

describe("the copy's encryption", () => {
  it("opens what it sealed, and nothing sealed with another key", () => {
    const keys = copyKeys(newCopyKey());
    const text = Buffer.from("notes ".repeat(500));
    const sealed = seal(keys, text);
    expect(sealed.length).toBeLessThan(text.length); // compressed
    expect(open(keys, sealed).equals(text)).toBe(true);
    expect(() => open(copyKeys(newCopyKey()), sealed)).toThrow();
    const changed = Buffer.from(sealed);
    changed.writeUInt8(changed.readUInt8(20) ^ 1, 20);
    expect(() => open(keys, changed)).toThrow();
  });

  it("names a part by its content, differently for every key", () => {
    const key = newCopyKey();
    const a = partId(copyKeys(key), Buffer.from("same"));
    expect(partId(copyKeys(key), Buffer.from("same")).equals(a)).toBe(true);
    expect(partId(copyKeys(newCopyKey()), Buffer.from("same")).equals(a)).toBe(false);
  });

  it("writes the key as a recovery key and reads it back, forgiving case, spaces and look-alike letters", () => {
    const key = newCopyKey();
    const text = recoveryKey(key);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(parseRecoveryKey(text)?.equals(key)).toBe(true);
    const sloppy = ` ${text.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `;
    expect(parseRecoveryKey(sloppy)?.equals(key)).toBe(true);
  });

  it("refuses a recovery key with a typo", () => {
    const text = recoveryKey(newCopyKey());
    const typo = (text[0] === "A" ? "B" : "A") + text.slice(1);
    expect(parseRecoveryKey(typo)).toBeNull();
    expect(parseRecoveryKey(text.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey("")).toBeNull();
  });
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A PC: its data folder, with a module files folder elsewhere that also holds the player's own files. */
async function pc(files: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tavora-copy-"));
  dirs.push(root);
  const userData = path.join(root, "data");
  const moduleFiles = path.join(root, "Pictures", "Tavora");
  for (const [name, content] of Object.entries(files)) {
    const file = name.startsWith("module-blobs/") ? path.join(moduleFiles, name.slice("module-blobs/".length)) : path.join(userData, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { root, userData, moduleFiles, roots: copyRoots(userData, moduleFiles) };
}

/**
 * The real account service (apps/api), in memory. Loaded by a path the desktop typecheck does not follow:
 * the service is checked with its own settings (Node's types, no DOM).
 */
async function loadService() {
  const api = (file: string) => import(/* @vite-ignore */ new URL(`../../../api/src/${file}`, import.meta.url).href);
  const [{ AccountStore }, { createApp }, { CopyStore }, { buildDataset, writeDatabase }, { createTestInbox }, { createRateLimiter }] = await Promise.all(
    ["account-store.ts", "app.ts", "cloud-copy.ts", "dataset.ts", "mail.ts", "rate-limit.ts"].map(api),
  );
  return { AccountStore, createApp, CopyStore, buildDataset, writeDatabase, createTestInbox, createRateLimiter };
}

async function service() {
  const { AccountStore, createApp, CopyStore, buildDataset, writeDatabase, createTestInbox, createRateLimiter } = await loadService();
  const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
  const roomy = () => createRateLimiter({ limit: 10_000, windowMs: 60_000 });
  const inbox = createTestInbox();
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store: new AccountStore(":memory:"), mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), copies: new CopyStore(":memory:") } });
  const routes: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    routes.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return app.request(url, init) as Promise<Response>;
  }) as typeof fetch;
  const json = (route: string, body: unknown) => app.request(`http://tavora.test/v1/account${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await json("/code", { email: "me@example.com" });
  const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
  const { token } = (await (await json("/verify", { email: "me@example.com", code, create: true })).json()) as { token: string };
  const client = () => new CloudCopy({ baseUrl: "http://tavora.test/v1/account", fetch: fetchImpl, token: () => token });
  return { client, routes };
}

const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");

describe("the cloud copy", () => {
  it("takes a PC's data to another PC, keeping what that PC had as a local backup", async () => {
    const key = newCopyKey();
    const { client } = await service();
    const a = await pc({
      "library.json": '{"version":1,"games":["elden-ring"]}',
      "workspace.json": "{}",
      "module-data/tavora.notes/elden-ring/storage.json": '{"a":1}',
      "game-icons/elden-ring.png": "png",
      [`module-blobs/${OWNER}/notes/picture.webp`]: "webp",
      "module-blobs/my-own-photo.jpg": "not Tavora's",
    });
    const uploaded = await client().upload(key, a.roots, EMPTY_STATE);
    expect(uploaded).toMatchObject({ status: "uploaded", pictures: true, state: { version: 1 } });
    if (uploaded.status !== "uploaded") return;
    expect(Object.keys(uploaded.state.files).sort()).toEqual(["game-icons/elden-ring.png", "library.json", `module-blobs/${OWNER}/notes/picture.webp`, "module-data/tavora.notes/elden-ring/storage.json", "workspace.json"]);
    expect(await client().remote()).toMatchObject({ version: 1 });

    const b = await pc({ "library.json": '{"version":1,"games":[]}', "module-data/other/x.json": "old", "module-blobs/holiday.jpg": "mine" });
    const staging = path.join(b.root, "staging");
    const copy = await client().download(key, b.roots, staging);
    expect(copy).toMatchObject({ version: 1, pictures: true });
    const kept = path.join(b.root, "before-cloud");
    const state = await swapInCopy(staging, b.roots, kept, copy!);
    expect(await read(b.userData, "library.json")).toBe('{"version":1,"games":["elden-ring"]}');
    expect(await read(b.userData, "module-data/tavora.notes/elden-ring/storage.json")).toBe('{"a":1}');
    expect(await read(b.moduleFiles, `${OWNER}/notes/picture.webp`)).toBe("webp");
    // The player's own files in that folder stay where they are, and never went up.
    expect(await read(b.moduleFiles, "holiday.jpg")).toBe("mine");
    // What B had is kept aside.
    expect(await read(kept, "library.json")).toBe('{"version":1,"games":[]}');
    expect(await read(kept, "module-data/other/x.json")).toBe("old");
    expect(state.version).toBe(1);
    expect(await hasLocalChanges(b.roots, state)).toBe(false);
  });

  it("uploads nothing when nothing changed, and only new parts when something did", async () => {
    const key = newCopyKey();
    const { client, routes } = await service();
    const a = await pc({ "library.json": "{}", "module-data/m/g/storage.json": "x".repeat(1000) });
    const first = await client().upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    routes.length = 0;
    expect(await client().upload(key, a.roots, first.state)).toEqual({ status: "unchanged" });
    expect(routes).toEqual([]);

    await writeFile(path.join(a.userData, "library.json"), '{"changed":true}');
    expect(await hasLocalChanges(a.roots, first.state)).toBe(true);
    const second = await client().upload(key, a.roots, first.state);
    expect(second).toMatchObject({ status: "uploaded", state: { version: 2 } });
    // One upload of parts (only library.json's), then the new version.
    expect(routes).toEqual(["POST /v1/account/copy/parts", "PUT /v1/account/copy"]);
  });

  it("gives a conflict to a PC that missed a newer version, instead of overwriting it", async () => {
    const key = newCopyKey();
    const { client } = await service();
    const a = await pc({ "library.json": "a" });
    const fromA = await client().upload(key, a.roots, EMPTY_STATE);
    if (fromA.status !== "uploaded") throw new Error(fromA.status);

    const b = await pc({ "library.json": "b" });
    const copy = await client().download(key, b.roots, path.join(b.root, "staging"));
    const stateB = await swapInCopy(path.join(b.root, "staging"), b.roots, path.join(b.root, "kept"), copy!);
    await writeFile(path.join(b.userData, "library.json"), "changed on b");
    expect(await client().upload(key, b.roots, stateB)).toMatchObject({ status: "uploaded", state: { version: 2 } });

    await writeFile(path.join(a.userData, "library.json"), "changed on a");
    expect(await client().upload(key, a.roots, fromA.state)).toEqual({ status: "conflict", version: 2 });
    // A new PC that turns the copy on where one exists gets the same question.
    expect(await client().upload(key, (await pc({ "library.json": "c" })).roots, EMPTY_STATE)).toEqual({ status: "conflict", version: 2 });
  });

  it("cannot be opened with another recovery key", async () => {
    const { client } = await service();
    const a = await pc({ "library.json": "secret" });
    await client().upload(newCopyKey(), a.roots, EMPTY_STATE);
    const b = await pc();
    await expect(client().download(newCopyKey(), b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "damaged" });
  });

  it("splits big files into parts and puts them back together", async () => {
    const key = newCopyKey();
    const { client } = await service();
    const big = Buffer.alloc(9 * 1024 * 1024);
    for (let index = 0; index < big.length; index += 4096) big.writeUInt32BE(index, index);
    const a = await pc({ "library.json": "{}" });
    await mkdir(path.join(a.moduleFiles, OWNER), { recursive: true });
    await writeFile(path.join(a.moduleFiles, OWNER, "big.png"), big);
    await mkdir(path.join(a.userData, "module-data", "m"), { recursive: true });
    await writeFile(path.join(a.userData, "module-data", "m", "empty.json"), "");
    const uploaded = await client().upload(key, a.roots, EMPTY_STATE);
    if (uploaded.status !== "uploaded") throw new Error(uploaded.status);
    expect(uploaded.state.files[`module-blobs/${OWNER}/big.png`]?.parts).toHaveLength(3);
    const b = await pc();
    const copy = await client().download(key, b.roots, path.join(b.root, "staging"));
    await swapInCopy(path.join(b.root, "staging"), b.roots, path.join(b.root, "kept"), copy!);
    expect((await readFile(path.join(b.moduleFiles, OWNER, "big.png"))).equals(big)).toBe(true);
  });

  it("answers null without a copy, and is gone after Delete", async () => {
    const key = newCopyKey();
    const { client } = await service();
    const a = await pc({ "library.json": "{}" });
    expect(await client().remote()).toBeNull();
    expect(await client().download(key, a.roots, path.join(a.root, "staging"))).toBeNull();
    await client().upload(key, a.roots, EMPTY_STATE);
    await client().remove();
    expect(await client().remote()).toBeNull();
  });

  it("needs a sign-in", async () => {
    const copy = new CloudCopy({ baseUrl: "http://tavora.test/v1/account", fetch: fetch, token: () => null });
    await expect(copy.remote()).rejects.toBeInstanceOf(CopyError);
    await expect(copy.remote()).rejects.toMatchObject({ reason: "signed-out" });
  });

  it("notices changes by size and date", async () => {
    const a = await pc({ "library.json": "{}" });
    const file = path.join(a.userData, "library.json");
    await utimes(file, 1000, 1000);
    const state: CopyState = { version: 1, pictures: true, files: { "library.json": { size: 2, mtimeMs: 1_000_000, sha256: "0".repeat(64), parts: [] } } };
    expect(await hasLocalChanges(a.roots, state)).toBe(false);
    await writeFile(path.join(a.userData, "profile.json"), "{}");
    expect(await hasLocalChanges(a.roots, state)).toBe(true);
  });
});

describe("paths in a copy", () => {
  it("only takes paths under the copy's own parts", async () => {
    const { roots } = await pc();
    expect(safeCopyPath("library.json", roots)).toBe("library.json");
    expect(safeCopyPath("module-data/a/b.json", roots)).toBe("module-data/a/b.json");
    expect(safeCopyPath(`module-blobs/${OWNER}/x.png`, roots)).toBe(`module-blobs/${OWNER}/x.png`);
    for (const bad of ["../library.json", "module-data/../../x", "module-data", "library.json/x", "elsewhere/x", "/library.json", "module-data//x", "module-data/a\\b", "module-blobs/photo.jpg", "C:/x", 5]) {
      expect(safeCopyPath(bad, roots)).toBeNull();
    }
  });
});

describe("the copy key on this PC", () => {
  const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

  it("is kept encrypted, and not at all without the key store", async () => {
    const { root } = await pc();
    const file = path.join(root, "cloud-copy-key.json");
    const key = newCopyKey();
    await saveCopyKey(file, encryptor, key);
    expect(await readFile(file, "utf8")).not.toContain(key.toString("hex"));
    expect((await loadCopyKey(file, encryptor))?.equals(key)).toBe(true);
    await saveCopyKey(file, encryptor, null);
    expect(await loadCopyKey(file, encryptor)).toBeNull();
    await saveCopyKey(file, { ...encryptor, isAvailable: () => false }, key);
    expect(await loadCopyKey(file, encryptor)).toBeNull();
  });
});
