import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Publisher keys in files: for publishing from CI, and from before Tavora kept them (decided 2026-10-20).
// The pack command never makes a key; Tavora does (Settings > Account > Module developer).

/** Where older versions of the pack command made a publisher's key; still used when it is there. */
export function defaultKeyFile(): string {
  return path.join(homedir(), ".tavora", "publisher-key.pem");
}

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
