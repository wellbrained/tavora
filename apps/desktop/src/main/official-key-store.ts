import { createPrivateKey, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
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

  /** Whether this PC can seal a key at all (no keyring on some Linux setups), as last checked (the start checks it). */
  canRemember(): boolean {
    return this.encryptor.isAvailable();
  }

  /** Asks the system now, for what is about to save a key (a keyring may have been unlocked since start). */
  canRememberNow(): Promise<boolean> {
    return this.encryptor.ready();
  }

  /** Whether a key is saved here (it may still fail to open or stop being trusted). */
  hasKey(): boolean {
    return this.saved;
  }

  /** Seals and saves the key; refuses when the system can't seal it, so it is never written in the clear. */
  async save(key: KeyObject): Promise<void> {
    if (!(await this.encryptor.ready())) throw new Error("this PC can't protect a saved key");
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("not a publisher key");
    const sealed = await this.encryptor.encrypt(key.export({ format: "pem", type: "pkcs8" }) as string);
    await writeFileAtomic(this.file, sealed);
    this.saved = true;
  }

  /** The saved key, or null when there is none. One that can't be opened (another user, another PC, damaged) is deleted. */
  async load(): Promise<KeyObject | null> {
    if (!this.saved && !existsSync(this.file)) return null;
    // The system's protection is off for now (a locked keyring): keep the file, ask for the key file this time.
    if (!(await this.encryptor.ready())) return null;
    // A file that can't be read right now (held by a virus scan) stays; only one that doesn't open is deleted.
    let sealed: Buffer;
    try {
      sealed = await readFile(this.file);
    } catch {
      return null;
    }
    try {
      const note = { stale: false };
      const key = createPrivateKey(await this.encryptor.decrypt(sealed, note));
      if (key.asymmetricKeyType !== "ed25519") throw new Error("not a publisher key");
      this.saved = true;
      // The system's key moved on: sealed again under the new one, once.
      if (note.stale) await this.save(key).catch(() => undefined);
      return key;
    } catch {
      await this.forget();
      return null;
    }
  }

  /** Deletes the saved key, and any half-written copy a failed save left (`<file>.tmp`, or `<file>.<random>.tmp` since). */
  async forget(): Promise<void> {
    const base = path.basename(this.file);
    const temps = (await readdir(path.dirname(this.file)).catch(() => [] as string[])).filter((name) => name === `${base}.tmp` || (name.startsWith(`${base}.`) && /^\.[0-9a-f]+\.tmp$/.test(name.slice(base.length))));
    for (const name of temps) await rm(path.join(path.dirname(this.file), name), { force: true });
    await rm(this.file, { force: true });
    this.saved = existsSync(this.file);
  }
}
