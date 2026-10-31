import { createPrivateKey, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";

/**
 * The Tavora publisher key, when the developer chose "Remember on this PC" while publishing a built-in module (dev
 * builds only). Sealed with the system's protection (Electron safeStorage: DPAPI on Windows, for this Windows user on
 * this PC), in the dev app's data folder. It is never synced: backups and the cloud copy take only the files they list,
 * and it is not one of them; it never goes to the account key vault. The caller saves only a key that may sign Tavora's
 * modules and checks it again on every load; this file never looks inside the key and never logs it.
 */
export const OFFICIAL_KEY_FILE = "official-publisher-key.bin";

export class OfficialKeyStore {
  private readonly file: string;
  private saved: boolean;

  constructor(
    userData: string,
    private readonly encryptor: Encryptor,
  ) {
    this.file = path.join(userData, OFFICIAL_KEY_FILE);
    this.saved = existsSync(this.file);
  }

  /** Whether this PC can seal a key at all (no keyring on some Linux setups). */
  canRemember(): boolean {
    return this.encryptor.isAvailable();
  }

  /** Whether a key is saved here (it may still fail to open or stop being trusted). */
  hasKey(): boolean {
    return this.saved;
  }

  /** Seals and saves the key; refuses when the system can't seal it, so it is never written in the clear. */
  async save(key: KeyObject): Promise<void> {
    if (!this.canRemember()) throw new Error("this PC can't protect a saved key");
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("not a publisher key");
    const sealed = this.encryptor.encrypt(key.export({ format: "pem", type: "pkcs8" }) as string);
    await writeFileAtomic(this.file, sealed);
    this.saved = true;
  }

  /** The saved key, or null when there is none. One that can't be opened (another user, another PC, damaged) is deleted. */
  async load(): Promise<KeyObject | null> {
    if (!this.saved && !existsSync(this.file)) return null;
    // The system's protection is off for now (a locked keyring): keep the file, ask for the key file this time.
    if (!this.encryptor.isAvailable()) return null;
    try {
      const key = createPrivateKey(this.encryptor.decrypt(await readFile(this.file)));
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not a publisher key");
      this.saved = true;
      return key;
    } catch {
      await this.forget();
      return null;
    }
  }

  /** Deletes the saved key. */
  async forget(): Promise<void> {
    await rm(this.file, { force: true });
    this.saved = existsSync(this.file);
  }
}
