import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";

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
