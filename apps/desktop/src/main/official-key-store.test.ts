import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint } from "@tavora/pack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIRS, PICTURE_DIRS } from "./backup";
import { copyRoots } from "./cloud-copy";
import type { Encryptor } from "./discord-store";
import { DATA_FILES } from "./saved-data";
import { OFFICIAL_KEY_FILE, OfficialKeyStore } from "./official-key-store";

// Stands in for safeStorage: reversible, and never the plain text.
const encryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
});

let userData: string;
const file = () => path.join(userData, OFFICIAL_KEY_FILE);

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), "tavora-key-store-"));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe("the Tavora key saved on this PC", () => {
  it("is sealed by the system and opens back to the same key", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const store = new OfficialKeyStore(userData, encryptor());
    expect(store.hasKey()).toBe(false);
    await store.save(privateKey);
    expect(store.hasKey()).toBe(true);
    expect((await readFile(file())).toString()).not.toContain("PRIVATE KEY");
    const loaded = await new OfficialKeyStore(userData, encryptor()).load();
    expect(loaded && fingerprint(loaded)).toBe(fingerprint(privateKey));
  });

  it("is never written when the system can't seal it, and only an ed25519 private key is kept", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await expect(new OfficialKeyStore(userData, encryptor(false)).save(privateKey)).rejects.toThrow();
    await expect(new OfficialKeyStore(userData, encryptor()).save(publicKey)).rejects.toThrow();
    await expect(new OfficialKeyStore(userData, encryptor()).save(generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey)).rejects.toThrow();
    expect(existsSync(file())).toBe(false);
  });

  it("deletes a saved key that can't be opened, and keeps it while the system's protection is off for now", async () => {
    const store = new OfficialKeyStore(userData, encryptor());
    await store.save(generateKeyPairSync("ed25519").privateKey);
    expect(await new OfficialKeyStore(userData, encryptor(false)).load()).toBeNull();
    expect(existsSync(file())).toBe(true);
    await writeFile(file(), "damaged");
    const damaged = new OfficialKeyStore(userData, encryptor());
    expect(await damaged.load()).toBeNull();
    expect(existsSync(file())).toBe(false);
    expect(damaged.hasKey()).toBe(false);
  });

  it("Forget key deletes it", async () => {
    const store = new OfficialKeyStore(userData, encryptor());
    await store.save(generateKeyPairSync("ed25519").privateKey);
    await store.forget();
    expect(store.hasKey()).toBe(false);
    expect(existsSync(file())).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it("is in neither the backup nor the cloud copy", () => {
    const roots = copyRoots(userData, path.join(userData, "files"));
    expect(roots.some((root) => root.path === file() || root.name === OFFICIAL_KEY_FILE)).toBe(false);
    // Both take only the files and folders they list; the key sits at the top of the data folder, in none of them.
    expect(roots.every((root) => root.path !== userData)).toBe(true);
    expect([...DATA_FILES, ...DATA_DIRS, ...PICTURE_DIRS]).not.toContain(OFFICIAL_KEY_FILE);
  });
});
