import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Publisher keys in files, for publishing from CI. The pack command never makes a key; Tavora does, and
// exports it for CI (Settings > Publishing > Publisher keys and CI).

/** A publisher's private key from a file, which must exist. */
export async function loadExistingKey(file: string): Promise<{ key: KeyObject }> {
  let pem: string;
  try {
    pem = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`There is no publisher key at ${file}.`);
    throw error;
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 key`);
  return { key };
}

/**
 * Writes a new Ed25519 publisher key to a file that must not exist yet (readable by its owner only) and answers with
 * the key. For keys that sign outside Tavora, such as the one Tavora's own modules are signed with; the key Tavora
 * keeps for a developer is made inside Tavora.
 */
export async function createKeyFile(file: string): Promise<{ key: KeyObject }> {
  const { privateKey } = generateKeyPairSync("ed25519");
  try {
    await writeFile(file, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists; it is not overwritten.`);
    throw error;
  }
  return { key: privateKey };
}
