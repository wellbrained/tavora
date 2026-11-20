import { readFile, rename, rm, stat } from "node:fs/promises";
import { CopyError } from "./cloud-copy";
import { newCopyKey, openVault, parseRecoveryKey, recoveryKey, sealVault } from "./copy-crypto";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { forgetSealedFile, openSealedFile } from "./json";
import { STORE_VERSIONS } from "./saved-versions";
import { UserError } from "./messages";

// The account's key (decided 2026-10-20, "one recovery key"): one random 256-bit root key per account,
// made on the first PC that needs it and shown to the user once as the recovery key. Everything the
// recovery key keeps safe is sealed under keys derived from it: the cloud copy, and the key vault on
// Tavora's service. The vault is small and goes out only to a signed-in PC of the account; it holds the
// account's publisher keys, which sign modules (developer-keys.ts). Its being on the service tells a new PC
// that the account already has a key, so the PC asks for the recovery key instead of making another. Each PC
// keeps the sealed vault as last read too, so signing works offline.
//
// Each PC keeps the root key in account-key.json, encrypted with the system's key store like the sign-in.
// It belongs to the account: signing out forgets it, turning the cloud copy off does not.
//
// What the service sends is not trusted over the PC's own (security audit 2026-11-20): a vault this PC's key doesn't
// open never makes it forget the key or the vault it last read (the PC keeps using that one and says so, `trouble`),
// only a vault the key opens is kept as the last read, and a vault this PC has seen is never replaced by an empty one
// unless the user says so (`rebuild`).

/** What the vault holds, before it is sealed. */
export interface VaultContent {
  v: 1;
  /** The account's publisher keys: Ed25519 private keys, PKCS#8 PEM. */
  publisherKeys?: string[];
}

const EMPTY_VAULT: VaultContent = { v: 1 };

/**
 * What is wrong with the account's vault on the service, as this PC saw it last: "unopened" when this PC's key doesn't
 * open it (another PC started over with a new key, or the service sent something else), "gone" when the account had
 * one and it is no longer there, with nothing on this PC to put back.
 */
export type VaultTrouble = "unopened" | "gone";

export interface AccountKeyOptions {
  file: string;
  /** Where the key was kept before it belonged to the account (the cloud copy's own key); moved once. */
  legacyFile?: string;
  /** The sealed vault as last read, kept on this PC: only one this PC's key opens. */
  cacheFile?: string;
  /** Marks that this PC has seen the account's vault, so one that goes missing later is not made again empty unasked. */
  seenFile?: string;
  encryptor: Encryptor;
  /** The account service, ending in /v1/account. */
  baseUrl: string;
  fetch: typeof fetch;
  /** The sign-in token, or null when signed out. */
  token: () => string | null;
  timeoutMs?: number;
}

export type KeySetUp = { status: "ready"; created: boolean } | { status: "ask" };

export class AccountKey {
  private key: Buffer | null = null;
  /** Raised by `forget`: a key read or made before it (signed out meanwhile) is not kept. */
  private generation = 0;
  /** This PC saw the account's vault in this run (the seen file keeps it across runs). */
  private sawVault = false;
  private problem: VaultTrouble | null = null;

  constructor(private readonly options: AccountKeyOptions) {}

  /** False where this PC can't keep the key encrypted: nothing that needs it can be turned on here. */
  get canKeep(): boolean {
    return this.options.encryptor.isAvailable();
  }

  /** The root key, when this PC has it. */
  get(): Buffer | null {
    return this.key;
  }

  /** What is wrong with the account's vault, as this PC last saw it; null when nothing is. */
  get trouble(): VaultTrouble | null {
    return this.key ? this.problem : null;
  }

  /** The recovery key to show, when this PC has the key. */
  recoveryKey(): string | null {
    return this.key ? recoveryKey(this.key) : null;
  }

  /** Reads this PC's key, at start. Never throws. */
  async load(): Promise<Buffer | null> {
    this.key = await readKey(this.options.file, this.options.encryptor);
    const legacy = this.options.legacyFile;
    if (!this.key && legacy) {
      this.key = await readKey(legacy, this.options.encryptor);
      if (this.key) await rename(legacy, this.options.file).catch(() => undefined);
    }
    return this.key;
  }

  /**
   * Makes sure this PC has the account's key. When the account has none yet, one is made here
   * (`created`: show the recovery key now). When another PC made one, the user types it in ("ask").
   */
  async setUp(): Promise<KeySetUp> {
    const generation = this.generation;
    const key = this.key;
    const vault = await this.vault(key);
    if (key) {
      if (!vault) {
        // Gone from the service: put back what this PC last read. With nothing to put back, an account that had a
        // vault gets an empty one only when the user says so (rebuild); this PC goes on with its key.
        await this.putBack(key);
        return { status: "ready", created: false };
      }
      if (opens(key, vault.data)) {
        this.problem = null;
        return { status: "ready", created: false };
      }
      // Another PC started over with a new key, or the service sent something else: the new key is asked for, and
      // this PC keeps its key and the vault it last read until one that opens it is typed in.
      this.problem = "unopened";
      return { status: "ask" };
    }
    // A vault this PC saw before and that is gone now: the account has a key, so it is asked for, not made anew.
    if (vault || (await this.seen())) return { status: "ask" };
    const made = newCopyKey();
    // Another PC may have made one at the same moment: then its key is asked for.
    if (!(await this.putVault(0, made, EMPTY_VAULT))) return { status: "ask" };
    await this.save(made, generation);
    return { status: "ready", created: true };
  }

  /** Whether the account has a key already, made on this PC or another (also when its vault went missing since). */
  async exists(): Promise<boolean> {
    return (await this.vault()) !== null || (await this.seen());
  }

  /**
   * Whether this PC's key still opens the account's vault; false only when it surely doesn't (another PC started over,
   * or the service sent something else). It forgets nothing either way.
   */
  async fits(): Promise<boolean> {
    const key = this.key;
    if (!key) return false;
    const vault = await this.vault(key);
    if (!vault) return true;
    const fits = opens(key, vault.data);
    this.problem = fits ? null : "unopened";
    return fits;
  }

  /** The recovery key the user typed in: checked against the account's vault, then kept on this PC. */
  async enter(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    await this.take(key);
  }

  /** The account's key, typed in as the recovery key or sent by another PC (pairing.ts): checked against the vault, then kept. */
  async take(key: Buffer): Promise<void> {
    const generation = this.generation;
    const vault = await this.vault(key);
    if (vault && !opens(key, vault.data)) throw new UserError("cloudCopy.error.wrongKey");
    // No vault: the typed key becomes the account's, with what this PC last read under it. A vault seen before and
    // gone now is not made again empty without the user (rebuild): the key is kept, and the trouble shown.
    const trouble = vault ? null : await this.putBack(key);
    await this.save(key, generation);
    this.problem = trouble;
  }

  /**
   * The user's answer when the account's vault is gone and this PC has nothing to put back: the account gets a vault
   * under this PC's key again, empty. Its publisher keys are lost then, unless the developer exported them to a file.
   */
  async rebuild(): Promise<void> {
    const key = this.key;
    if (!key) throw new CopyError("failed", "no key on this PC");
    const vault = await this.vault(key);
    if (vault) {
      // Back meanwhile: nothing is replaced.
      this.problem = opens(key, vault.data) ? null : "unopened";
      return;
    }
    if (!(await this.putVault(0, key, (await this.cached(key)) ?? EMPTY_VAULT))) throw new CopyError("failed", "another PC made a vault at the same moment");
    this.problem = null;
  }

  /**
   * A lost key: the vault is replaced by one under a new key, made here. What the old key sealed can't be
   * opened again, except the vault itself when this PC still has the old key: its publisher keys move over.
   */
  async startOver(): Promise<void> {
    const generation = this.generation;
    const old = this.key ? await this.vault(this.key).catch(() => null) : null;
    // The publisher keys move over: from the vault when the old key opens it, else from what this PC last read.
    const content = (old && this.key && openContent(this.key, old.data)) || (this.key && (await this.cached(this.key))) || EMPTY_VAULT;
    await this.request("DELETE");
    this.key = null;
    const key = newCopyKey();
    if (!(await this.putVault(0, key, content))) throw new CopyError("failed", "another PC made a key at the same moment");
    await this.save(key, generation);
    this.problem = null;
  }

  /**
   * What the vault holds; when the service can't be reached, or its vault doesn't open with this PC's key or is gone,
   * what this PC last read (`trouble` says which).
   */
  async content(): Promise<VaultContent> {
    const key = this.key;
    if (!key) throw new CopyError("failed", "no key on this PC");
    let vault: { version: number; data: Uint8Array } | null;
    try {
      vault = await this.vault(key);
    } catch (error) {
      const cached = error instanceof CopyError && (error.reason === "unreachable" || error.reason === "unavailable") ? await this.cached(key) : null;
      if (cached) return cached;
      throw error;
    }
    if (!vault) {
      // Gone from the service: what this PC last read goes back (setUp does the same); nothing is made empty here.
      const cached = await this.cached(key);
      if (!cached) {
        this.problem = (await this.seen()) ? "gone" : null;
        return EMPTY_VAULT;
      }
      if (await this.putVault(0, key, cached).catch(() => false)) this.problem = null;
      return cached;
    }
    const content = openContent(key, vault.data);
    if (content) {
      this.problem = null;
      return content;
    }
    this.problem = "unopened";
    const cached = await this.cached(key);
    if (cached) return cached;
    throw new CopyError("damaged");
  }

  /** Changes what the vault holds, made on top of what it holds now (tried again when another PC changed it first). */
  async change(update: (content: VaultContent) => VaultContent): Promise<VaultContent> {
    const key = this.key;
    if (!key) throw new CopyError("failed", "no key on this PC");
    for (let attempt = 0; attempt < 3; attempt++) {
      const vault = await this.vault(key);
      // Only on top of a vault this key opens; a gone one is made again from what this PC last read, never empty unasked.
      const content = vault ? openContent(key, vault.data) : ((await this.cached(key)) ?? ((await this.seen()) ? null : EMPTY_VAULT));
      if (!content) {
        this.problem = vault ? "unopened" : "gone";
        throw new CopyError("damaged");
      }
      const next = update(content);
      if (await this.putVault(vault?.version ?? 0, key, next)) {
        this.problem = null;
        return next;
      }
    }
    throw new CopyError("failed", "the vault kept changing");
  }

  /** Whether this PC is signed in, so the key goes through the account's vault. */
  get signedIn(): boolean {
    return this.options.token() !== null;
  }

  /**
   * Signed out, for a copy in a folder of the user's own (decided 2026-10-20): the key is made here
   * without the vault, or asked for when the folder holds a copy already. Signing in later gives the
   * account a vault with it (setUp).
   */
  async setUpHere(hasCopy: boolean): Promise<KeySetUp> {
    if (this.key) return { status: "ready", created: false };
    if (hasCopy) return { status: "ask" };
    await this.save(newCopyKey(), this.generation);
    return { status: "ready", created: true };
  }

  /** Signed out: the recovery key typed in is kept here. Whether it opens the folder's copy is the check. */
  async enterHere(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    await this.save(key, this.generation);
  }

  /** Signed out: the key another PC sent through the folder (pairing.ts) is kept here, like one typed in. */
  async takeHere(key: Buffer): Promise<void> {
    await this.save(key, this.generation);
  }

  /** Signed out, a lost key: a new one is made here. */
  async startOverHere(): Promise<void> {
    this.key = null;
    await this.save(newCopyKey(), this.generation);
  }

  /** Signed out: the key belongs to the account, so this PC forgets it. */
  async forget(): Promise<void> {
    this.generation++;
    this.key = null;
    this.sawVault = false;
    this.problem = null;
    await forgetSealedFile(this.options.file);
    if (this.options.legacyFile) await forgetSealedFile(this.options.legacyFile);
    if (this.options.cacheFile) await rm(this.options.cacheFile, { force: true });
    if (this.options.seenFile) await rm(this.options.seenFile, { force: true });
  }

  /**
   * The vault is missing on the service: puts back what this PC last read under `key`, or an empty one when the account
   * never had a vault this PC saw. Answers the trouble left: "gone" when it had one and nothing could be put back.
   */
  private async putBack(key: Buffer): Promise<VaultTrouble | null> {
    const cached = await this.cached(key);
    if (!cached && (await this.seen())) {
      this.problem = "gone";
      return "gone";
    }
    await this.putVault(0, key, cached ?? EMPTY_VAULT);
    this.problem = null;
    return null;
  }

  /** Whether this PC has seen the account's vault: in this run, or before (the seen file, or a vault it kept). */
  private async seen(): Promise<boolean> {
    if (this.sawVault) return true;
    for (const file of [this.options.seenFile, this.options.cacheFile]) {
      if (file && (await stat(file).then(() => true, () => false))) return (this.sawVault = true);
    }
    return false;
  }

  private async markSeen(): Promise<void> {
    if (this.sawVault) return;
    this.sawVault = true;
    if (this.options.seenFile) await writeFileAtomic(this.options.seenFile, "1").catch(() => undefined);
  }

  private async cached(key: Buffer): Promise<VaultContent | null> {
    if (!this.options.cacheFile) return null;
    const sealed = await readFile(this.options.cacheFile).catch(() => null);
    return sealed ? openContent(key, sealed) : null;
  }

  private async keep(sealed: Uint8Array): Promise<void> {
    if (this.options.cacheFile) await writeFileAtomic(this.options.cacheFile, Buffer.from(sealed)).catch(() => undefined);
  }

  /** Keeps the key on this PC, unless it was forgotten since `generation` (signed out meanwhile): then it is not kept. */
  private async save(key: Buffer, generation: number): Promise<void> {
    if (!this.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    if (generation !== this.generation) throw new CopyError("signed-out");
    await writeFileAtomic(this.options.file, JSON.stringify({ v: STORE_VERSIONS.sealed, data: this.options.encryptor.encrypt(key.toString("base64")).toString("base64") }));
    if (generation !== this.generation) {
      await rm(this.options.file, { force: true });
      throw new CopyError("signed-out");
    }
    this.key = key;
  }

  // ── The vault on the service ───────────────────────────────────────

  private async request(method: string, body?: Uint8Array): Promise<Response> {
    const token = this.options.token();
    if (!token) throw new CopyError("signed-out");
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}/vault`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/octet-stream" } : {}) },
        ...(body ? { body: Uint8Array.from(body) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch {
      throw new CopyError("unreachable");
    }
    if (response.status === 401) throw new CopyError("signed-out");
    if (response.status === 429) throw new CopyError("too-many");
    if (response.status === 503) throw new CopyError("unavailable");
    return response;
  }

  /** The account's vault on the service, or null when it has none. Kept as the last read only when `key` opens it. */
  private async vault(key?: Buffer | null): Promise<{ version: number; data: Uint8Array } | null> {
    const response = await this.request("GET");
    if (response.status === 404) return null;
    const version = Number(response.headers.get("x-vault-version"));
    if (!response.ok || !Number.isInteger(version) || version < 1) throw new CopyError("failed", `the vault answered ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    await this.markSeen();
    if (key && opens(key, data)) await this.keep(data);
    return { version, data };
  }

  /** Stores the vault's content sealed with `key`, made from version `base`. False when another PC changed it first. */
  private async putVault(base: number, key: Buffer, content: VaultContent): Promise<boolean> {
    const sealed = sealVault(key, Buffer.from(JSON.stringify(content)));
    const body = Buffer.alloc(4 + sealed.length);
    body.writeUInt32BE(base);
    sealed.copy(body, 4);
    const response = await this.request("PUT", body);
    if (response.status === 409) return false;
    if (response.status === 413) throw new CopyError("failed", "the vault is full");
    if (!response.ok) throw new CopyError("failed", `the vault answered ${response.status}`);
    await this.keep(sealed);
    await this.markSeen();
    return true;
  }
}

function opens(key: Buffer, sealed: Uint8Array): boolean {
  return openContent(key, sealed) !== null;
}

/** The vault's content, or null when `key` doesn't open it. */
function openContent(key: Buffer, sealed: Uint8Array): VaultContent | null {
  let raw: { v?: unknown; publisherKeys?: unknown };
  try {
    raw = JSON.parse(openVault(key, sealed).toString("utf8")) as typeof raw;
  } catch {
    return null;
  }
  if (raw.v !== 1) return null;
  const keys = Array.isArray(raw.publisherKeys) ? raw.publisherKeys.filter((pem): pem is string => typeof pem === "string") : [];
  return keys.length > 0 ? { v: 1, publisherKeys: keys } : { v: 1 };
}

async function readKey(file: string, encryptor: Encryptor): Promise<Buffer | null> {
  if (!encryptor.isAvailable()) return null;
  // Missing, newer, damaged, or sealed by another user or PC: none (openSealedFile keeps the file aside).
  return openSealedFile(file, (data) => {
    const key = Buffer.from(encryptor.decrypt(Buffer.from(data, "base64")), "base64");
    if (key.length !== 32) throw new Error("not a key");
    return key;
  });
}
