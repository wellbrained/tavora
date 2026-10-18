import { generateKeyPairSync, createPrivateKey, type KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Where the pack command keeps a publisher's key unless told otherwise. */
export function defaultKeyFile(): string {
  return path.join(homedir(), ".tavora", "publisher-key.pem");
}

/**
 * The publisher's private key, made the first time. The key never leaves
 * this PC: only its public half goes into packages (and, with accounts, into
 * the publisher's profile). `created` is true when it was made just now.
 */
export async function loadOrCreateKey(file: string): Promise<{ key: KeyObject; created: boolean }> {
  try {
    const key = createPrivateKey(await readFile(file, "utf8"));
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 key`);
    return { key, created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  await mkdir(path.dirname(file), { recursive: true });
  // "wx" never replaces a key that appeared in the meantime; 0600 keeps it the owner's.
  await writeFile(file, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
  return { key: privateKey, created: true };
}

/** The publisher's private key, which must exist already: publishing never makes one. */
export async function loadExistingKey(file: string): Promise<{ key: KeyObject }> {
  let pem: string;
  try {
    pem = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`There is no publisher key at ${file}. Publish with the key that packed the zip (--key).`);
    throw error;
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 key`);
  return { key };
}
