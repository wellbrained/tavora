import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";

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
 * Writes `pem` to a new file that only this user can read, and never replaces a file. Where modes count it is 0600. On
 * Windows the file is made empty first and its access list cut down to this user before the key goes in; where that
 * can't be done (a drive without permissions, such as a FAT USB stick) nothing is written and it throws.
 */
export async function writePrivateFile(file: string, pem: string | Buffer): Promise<void> {
  if (process.platform !== "win32") {
    await writeFile(file, pem, { flag: "wx", mode: 0o600 });
    return;
  }
  await writeFile(file, "", { flag: "wx" });
  const name = userInfo().username;
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${name}` : name;
  const result = spawnSync("icacls", [path.resolve(file), "/inheritance:r", "/grant:r", `${user}:F`], { encoding: "utf8" });
  if (result.status !== 0) {
    await rm(file, { force: true });
    throw new Error(`could not limit who can read ${path.resolve(file)}, so no key was written there. Make it on an NTFS drive (your user folder), then copy it where you keep it.`);
  }
  await writeFile(file, pem);
}

/**
 * Writes a new Ed25519 publisher key to a file that must not exist yet (readable by its owner only, also on Windows)
 * and answers with the key. For keys that sign outside Tavora, such as the one Tavora's own modules are signed with;
 * the key Tavora keeps for a developer is made inside Tavora.
 */
export async function createKeyFile(file: string): Promise<{ key: KeyObject }> {
  const { privateKey } = generateKeyPairSync("ed25519");
  try {
    await writePrivateFile(file, privateKey.export({ format: "pem", type: "pkcs8" }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists; it is not overwritten.`);
    throw error;
  }
  return { key: privateKey };
}
