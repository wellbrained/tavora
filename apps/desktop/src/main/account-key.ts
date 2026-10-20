import { readFile, rename, rm } from "node:fs/promises";
import { CopyError } from "./cloud-copy";
import { newCopyKey, openVault, parseRecoveryKey, recoveryKey, sealVault } from "./copy-crypto";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { PlayerError } from "./messages";

// The account's key (decided 2026-10-20, "one recovery key"): one random 256-bit root key per account,
// made on the first PC that needs it and shown to the player once as the recovery key. Everything the
// recovery key keeps safe is sealed under keys derived from it: the cloud copy, and the key vault on
// Tavora's service. The vault is small and goes out only to a signed-in PC of the account; for now it is
// empty, later it holds the account's publisher keys. Its being on the service tells a new PC that the
// account already has a key, so the PC asks for the recovery key instead of making another.
//
// Each PC keeps the root key in account-key.json, encrypted with the system's key store like the sign-in.
// It belongs to the account: signing out forgets it, turning the cloud copy off does not.

/** What the vault holds, before it is sealed. */
interface VaultContent {
  v: 1;
}

const EMPTY_VAULT: VaultContent = { v: 1 };

export interface AccountKeyOptions {
  file: string;
  /** Where the key was kept before it belonged to the account (the cloud copy's own key); moved once. */
  legacyFile?: string;
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

  constructor(private readonly options: AccountKeyOptions) {}

  /** False where this PC can't keep the key encrypted: nothing that needs it can be turned on here. */
  get canKeep(): boolean {
    return this.options.encryptor.isAvailable();
  }

  /** The root key, when this PC has it. */
  get(): Buffer | null {
    return this.key;
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
   * (`created`: show the recovery key now). When another PC made one, the player types it in ("ask").
   */
  async setUp(): Promise<KeySetUp> {
    const vault = await this.vault();
    if (this.key) {
      if (!vault) {
        await this.putVault(0, this.key);
        return { status: "ready", created: false };
      }
      if (opens(this.key, vault.data)) return { status: "ready", created: false };
      // The account started over with a new key on another PC: this one no longer fits.
      await this.forget();
      return { status: "ask" };
    }
    if (vault) return { status: "ask" };
    const key = newCopyKey();
    // Another PC may have made one at the same moment: then its key is asked for.
    if (!(await this.putVault(0, key))) return { status: "ask" };
    await this.save(key);
    return { status: "ready", created: true };
  }

  /** Whether this PC's key still opens the account's vault; false only when it surely doesn't (another PC started over). */
  async fits(): Promise<boolean> {
    if (!this.key) return false;
    const vault = await this.vault();
    return !vault || opens(this.key, vault.data);
  }

  /** The recovery key the player typed in: checked against the account's vault, then kept on this PC. */
  async enter(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new PlayerError("cloudCopy.error.badKey");
    const vault = await this.vault();
    if (vault && !opens(key, vault.data)) throw new PlayerError("cloudCopy.error.wrongKey");
    // No vault (the account started over, or it was never made): the typed key becomes the account's.
    if (!vault) await this.putVault(0, key);
    await this.save(key);
  }

  /** A lost key: the vault is replaced by one under a new key, made here. What the old key sealed can't be opened again. */
  async startOver(): Promise<void> {
    await this.request("DELETE");
    this.key = null;
    const key = newCopyKey();
    if (!(await this.putVault(0, key))) throw new CopyError("failed", "another PC made a key at the same moment");
    await this.save(key);
  }

  /** Signed out: the key belongs to the account, so this PC forgets it. */
  async forget(): Promise<void> {
    this.key = null;
    await rm(this.options.file, { force: true });
  }

  private async save(key: Buffer): Promise<void> {
    if (!this.canKeep) throw new PlayerError("cloudCopy.error.cantKeep");
    await writeFileAtomic(this.options.file, JSON.stringify({ v: 1, data: this.options.encryptor.encrypt(key.toString("base64")).toString("base64") }));
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

  private async vault(): Promise<{ version: number; data: Uint8Array } | null> {
    const response = await this.request("GET");
    if (response.status === 404) return null;
    const version = Number(response.headers.get("x-vault-version"));
    if (!response.ok || !Number.isInteger(version) || version < 1) throw new CopyError("failed", `the vault answered ${response.status}`);
    return { version, data: new Uint8Array(await response.arrayBuffer()) };
  }

  /** Stores an empty vault sealed with `key`, made from version `base`. False when another PC changed it first. */
  private async putVault(base: number, key: Buffer): Promise<boolean> {
    const sealed = sealVault(key, Buffer.from(JSON.stringify(EMPTY_VAULT)));
    const body = Buffer.alloc(4 + sealed.length);
    body.writeUInt32BE(base);
    sealed.copy(body, 4);
    const response = await this.request("PUT", body);
    if (response.status === 409) return false;
    if (!response.ok) throw new CopyError("failed", `the vault answered ${response.status}`);
    return true;
  }
}

function opens(key: Buffer, sealed: Uint8Array): boolean {
  try {
    return (JSON.parse(openVault(key, sealed).toString("utf8")) as { v?: unknown }).v === 1;
  } catch {
    return false;
  }
}

async function readKey(file: string, encryptor: Encryptor): Promise<Buffer | null> {
  if (!encryptor.isAvailable()) return null;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; data?: unknown };
    if (saved.v !== 1 || typeof saved.data !== "string") return null;
    const key = Buffer.from(encryptor.decrypt(Buffer.from(saved.data, "base64")), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
