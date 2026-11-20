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
//
// The key notes the account it belongs to (security audit 2026-11-20, run 2). A sign-in the service ends by itself (a
// 401: signed out from another device, unused for a year) forgets only the sign-in, so the key and the vault last read
// stay on this PC, kept for that account: the same account signing in again goes on with them, and any other account
// signed in here never gets them (not used, shown, sent to another PC or put into its vault). A key made or typed in
// signed out (a folder's copy) belongs to no account yet: the first account it is used with takes it. A key file from
// before keys noted their account is taken by the account signed in at the first start that reads it; with none signed
// in then, on a PC used signed in before (it saw a vault), an account takes it only when its vault opens with it.
// What this PC last read of another account's vault goes once an account keeps its own key here.

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
  /** Names the accounts whose vault this PC has seen, so one that goes missing later is not made again empty unasked. */
  seenFile?: string;
  encryptor: Encryptor;
  /** The account service, ending in /v1/account. */
  baseUrl: string;
  fetch: typeof fetch;
  /** The sign-in token, or null when signed out. */
  token: () => string | null;
  /** The signed-in account, as an id that stays the same for it (sign-in.ts accountIdOf); null when signed out. */
  account: () => string | null;
  timeoutMs?: number;
  /**
   * How long a vault found missing is looked at again before this PC puts back the one it last read: another PC's
   * Start over deletes the vault and puts a new one right after, and a put-back in between would take its place.
   */
  putBackAfterMs?: number;
}

/** See AccountKeyOptions.putBackAfterMs. */
export const PUT_BACK_AFTER_MS = 5_000;

/** The seen file's line from before it named accounts. */
const SEEN_BEFORE_ACCOUNTS = "1";
/** Accounts the seen file names at most (the newest). */
const MAX_SEEN = 20;

export type KeySetUp = { status: "ready"; created: boolean } | { status: "ask" };

export class AccountKey {
  private key: Buffer | null = null;
  /** The account the key belongs to; null for one made or typed in signed out, which the first account to use it takes. */
  private owner: string | null = null;
  /**
   * A key from before keys noted their account, read with no one signed in on a PC used signed in before: whose it is
   * isn't known, so an account takes it only once its vault opens with it.
   */
  private unproven = false;
  /** Raised by `forget`: a key read or made before it (signed out meanwhile) is not kept. */
  private generation = 0;
  /** The account whose vault this PC saw in this run (the seen file keeps it across runs). */
  private sawVault: string | null = null;
  private problem: { account: string; trouble: VaultTrouble } | null = null;

  constructor(private readonly options: AccountKeyOptions) {}

  /** False where this PC can't keep the key encrypted: nothing that needs it can be turned on here. */
  get canKeep(): boolean {
    return this.options.encryptor.isAvailable();
  }

  /** The root key, when this PC has it for the account signed in now (signed out: as it is, for a folder's copy). */
  get(): Buffer | null {
    return this.mine(this.options.account());
  }

  /** What is wrong with the account's vault, as this PC last saw it; null when nothing is. */
  get trouble(): VaultTrouble | null {
    const who = this.options.account();
    return who !== null && this.mine(who) && this.problem?.account === who ? this.problem.trouble : null;
  }

  /** The recovery key to show, when this PC has the key (for the account signed in now). */
  recoveryKey(): string | null {
    const key = this.get();
    return key ? recoveryKey(key) : null;
  }

  /** Reads this PC's key, at start. Never throws. */
  async load(): Promise<Buffer | null> {
    let saved = await readKey(this.options.file, this.options.encryptor);
    const legacy = this.options.legacyFile;
    if (!saved && legacy) {
      saved = await readKey(legacy, this.options.encryptor);
      if (saved) await rename(legacy, this.options.file).catch(() => undefined);
    }
    this.key = saved?.key ?? null;
    this.owner = saved?.owner ?? null;
    this.unproven = saved?.unproven === true;
    if (saved && saved.owner === undefined) {
      // From before keys noted their account: it is the one signed in now, which it was used with. With no one signed
      // in, it is noted as unproven when this PC was used signed in, so a later start doesn't give it to whoever is then.
      const who = this.options.account();
      if (who !== null) await this.save(saved.key, this.generation, who, who).catch(() => undefined);
      else await this.save(saved.key, this.generation, null, null, await this.usedSignedIn()).catch(() => undefined);
    }
    return this.key;
  }

  /**
   * The key for the account signed in now, taking a key that belongs to no account yet (see `claim`); signed out, the
   * key as it is. Null when this PC has none for it.
   */
  async forAccount(): Promise<Buffer | null> {
    const who = this.options.account();
    return who === null ? this.key : this.claim(who, this.generation);
  }

  /**
   * Makes sure this PC has the account's key. When the account has none yet, one is made here
   * (`created`: show the recovery key now). When another PC made one, the user types it in ("ask").
   */
  async setUp(): Promise<KeySetUp> {
    const generation = this.generation;
    const who = this.signedInAs();
    const key = await this.claim(who, generation);
    const vault = await this.vault(who, key);
    if (key) {
      if (!vault) {
        // Gone from the service: put back what this PC last read. With nothing to put back, an account that had a
        // vault gets an empty one only when the user says so (rebuild); this PC goes on with its key.
        await this.putBack(who, key);
        return { status: "ready", created: false };
      }
      if (opens(key, vault.data)) {
        this.note(who, null);
        return { status: "ready", created: false };
      }
      // Another PC started over with a new key, or the service sent something else: the new key is asked for, and
      // this PC keeps its key and the vault it last read until one that opens it is typed in.
      this.note(who, "unopened");
      return { status: "ask" };
    }
    // A vault this PC saw before and that is gone now: the account has a key, so it is asked for, not made anew.
    if (vault || (await this.seen(who))) return { status: "ask" };
    const made = newCopyKey();
    // Another PC may have made one at the same moment: then its key is asked for.
    if (!(await this.putVault(who, 0, made, EMPTY_VAULT))) return { status: "ask" };
    await this.save(made, generation, who, who);
    return { status: "ready", created: true };
  }

  /** Whether the account has a key already, made on this PC or another (also when its vault went missing since). */
  async exists(): Promise<boolean> {
    const who = this.signedInAs();
    return (await this.vault(who)) !== null || (await this.seen(who));
  }

  /**
   * Whether this PC's key still opens the account's vault; false only when it surely doesn't (another PC started over,
   * or the service sent something else), or this PC has no key for the account signed in. It forgets nothing either way.
   */
  async fits(): Promise<boolean> {
    const who = this.options.account();
    if (who === null) return false;
    const key = await this.claim(who, this.generation);
    if (!key) return false;
    const vault = await this.vault(who, key);
    if (!vault) return true;
    const fits = opens(key, vault.data);
    this.note(who, fits ? null : "unopened");
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
    const who = this.signedInAs();
    // Not kept as the last read yet: only once the key is kept on this PC.
    const vault = await this.vault(who);
    if (vault && !opens(key, vault.data)) throw new UserError("cloudCopy.error.wrongKey");
    await this.save(key, generation, who, who);
    if (vault) {
      await this.keep(vault.data);
      this.note(who, null);
      return;
    }
    // No vault: the key becomes the account's, with what this PC last read under it. A vault seen before and gone now
    // is not made again empty without the user (rebuild): the key is kept, and the trouble shown.
    await this.putBack(who, key);
  }

  /**
   * The user's answer when the account's vault is gone and this PC has nothing to put back: the account gets a vault
   * under this PC's key again, empty. Its publisher keys are lost then, unless the developer exported them to a file.
   */
  async rebuild(): Promise<void> {
    const who = this.signedInAs();
    const key = await this.claim(who, this.generation);
    if (!key) throw new CopyError("failed", "no key on this PC");
    const vault = await this.vault(who, key);
    if (vault) {
      // Back meanwhile: nothing is replaced.
      this.note(who, opens(key, vault.data) ? null : "unopened");
      return;
    }
    if (!(await this.putVault(who, 0, key, (await this.cached(key)) ?? EMPTY_VAULT))) throw new CopyError("failed", "another PC made a vault at the same moment");
    this.note(who, null);
  }

  /**
   * A lost key: the vault is replaced by one under a new key, made here. What the old key sealed can't be
   * opened again, except the vault itself when this PC still has the old key: its publisher keys move over.
   */
  async startOver(): Promise<void> {
    const generation = this.generation;
    const who = this.signedInAs();
    // Only the account's own key moves anything over; another account's, kept here for it, stays out of this.
    const oldKey = await this.claim(who, generation);
    const old = oldKey ? await this.vault(who, oldKey).catch(() => null) : null;
    // The publisher keys move over: from the vault when the old key opens it, else from what this PC last read.
    const content = (old && oldKey && openContent(oldKey, old.data)) || (oldKey && (await this.cached(oldKey))) || EMPTY_VAULT;
    const key = newCopyKey();
    if (oldKey) this.key = null;
    for (let attempt = 0; ; attempt++) {
      await this.request(who, "DELETE");
      if (await this.putVault(who, 0, key, content)) break;
      // Another PC came first. One that put back the old vault (it saw it missing) is undone and tried again; a vault
      // under any other key is another PC's new key, which stays.
      const now = await this.vault(who).catch(() => null);
      if (attempt >= 2 || !now || !oldKey || !opens(oldKey, now.data)) throw new CopyError("failed", "another PC made a key at the same moment");
    }
    await this.save(key, generation, who, who);
    this.note(who, null);
  }

  /**
   * What the vault holds; when the service can't be reached, or its vault doesn't open with this PC's key or is gone,
   * what this PC last read (`trouble` says which).
   */
  async content(): Promise<VaultContent> {
    const who = this.signedInAs();
    const key = await this.claim(who, this.generation);
    if (!key) throw new CopyError("failed", "no key on this PC");
    let vault: { version: number; data: Uint8Array } | null;
    try {
      vault = await this.vault(who, key);
    } catch (error) {
      const cached = error instanceof CopyError && (error.reason === "unreachable" || error.reason === "unavailable") ? await this.cached(key) : null;
      if (cached) return cached;
      throw error;
    }
    if (!vault) {
      // Gone from the service: what this PC last read goes back (setUp does the same); nothing is made empty here.
      const cached = await this.cached(key);
      if (!cached) {
        this.note(who, (await this.seen(who)) ? "gone" : null);
        return EMPTY_VAULT;
      }
      await this.restore(who, key, cached).catch(() => undefined);
      return cached;
    }
    const content = openContent(key, vault.data);
    if (content) {
      this.note(who, null);
      return content;
    }
    this.note(who, "unopened");
    const cached = await this.cached(key);
    if (cached) return cached;
    throw new CopyError("damaged");
  }

  /** Changes what the vault holds, made on top of what it holds now (tried again when another PC changed it first). */
  async change(update: (content: VaultContent) => VaultContent): Promise<VaultContent> {
    const who = this.signedInAs();
    const key = await this.claim(who, this.generation);
    if (!key) throw new CopyError("failed", "no key on this PC");
    for (let attempt = 0; attempt < 3; attempt++) {
      const vault = await this.vault(who, key);
      // Only on top of a vault this key opens; a gone one is made again from what this PC last read, never empty unasked.
      const content = vault ? openContent(key, vault.data) : ((await this.cached(key)) ?? ((await this.seen(who)) ? null : EMPTY_VAULT));
      if (!content) {
        this.note(who, vault ? "unopened" : "gone");
        throw new CopyError("damaged");
      }
      const next = update(content);
      if (await this.putVault(who, vault?.version ?? 0, key, next)) {
        this.note(who, null);
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
    await this.save(newCopyKey(), this.generation, null, null);
    return { status: "ready", created: true };
  }

  /** Signed out: the recovery key typed in is kept here. Whether it opens the folder's copy is the check. */
  async enterHere(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    await this.takeHere(key);
  }

  /** Signed out: the key another PC sent through the folder (pairing.ts) is kept here, like one typed in. */
  async takeHere(key: Buffer): Promise<void> {
    // The key this PC has already stays its account's; another one belongs to no account yet.
    await this.save(key, this.generation, null, this.key?.equals(key) ? this.owner : null);
  }

  /** Signed out, a lost key: a new one is made here. */
  async startOverHere(): Promise<void> {
    this.key = null;
    await this.save(newCopyKey(), this.generation, null, null);
  }

  /** Signed out: the key belongs to the account, so this PC forgets it. */
  async forget(): Promise<void> {
    this.generation++;
    this.key = null;
    this.owner = null;
    this.unproven = false;
    this.sawVault = null;
    this.problem = null;
    await forgetSealedFile(this.options.file);
    if (this.options.legacyFile) await forgetSealedFile(this.options.legacyFile);
    // With any half-written copy a crash left (forgetSealedFile removes those too).
    if (this.options.cacheFile) await forgetSealedFile(this.options.cacheFile);
    if (this.options.seenFile) await forgetSealedFile(this.options.seenFile);
  }

  /**
   * Signed out while a folder's copy keeps the key here: the key stays (still the account's), the vault as last read,
   * with the account's publisher keys, goes. Signing in again reads it anew.
   */
  async forgetVault(): Promise<void> {
    this.problem = null;
    if (this.options.cacheFile) await forgetSealedFile(this.options.cacheFile);
  }

  /** The key for `who` (null: signed out, the key as it is, for a folder's copy); null when it is another account's. */
  private mine(who: string | null): Buffer | null {
    const key = this.key;
    if (!key || who === null || this.owner === who) return key;
    return this.owner === null && !this.unproven ? key : null;
  }

  /**
   * The key for `who`, signed in. A key that belongs to no account yet becomes `who`'s now; one from before keys noted
   * their account only when `who`'s vault opens with it. Null when this PC has none for `who` (another account's stays).
   */
  private async claim(who: string, generation: number): Promise<Buffer | null> {
    const key = this.key;
    if (!key || this.owner !== null) return this.mine(who);
    if (this.unproven) {
      const vault = await this.vault(who);
      if (!vault || !opens(key, vault.data) || this.key !== key) return null;
    }
    await this.save(key, generation, who, who);
    return key;
  }

  /** The signed-in account, for what needs the account's vault. */
  private signedInAs(): string {
    const who = this.options.account();
    if (who === null) throw new CopyError("signed-out");
    return who;
  }

  private note(who: string, trouble: VaultTrouble | null): VaultTrouble | null {
    this.problem = trouble ? { account: who, trouble } : null;
    return trouble;
  }

  /**
   * The vault is missing on the service: puts back what this PC last read under `key`, or an empty one when the account
   * never had a vault this PC saw. Answers the trouble left: "gone" when it had one and nothing could be put back.
   */
  private async putBack(who: string, key: Buffer): Promise<VaultTrouble | null> {
    const cached = await this.cached(key);
    if (cached) return this.restore(who, key, cached);
    if (await this.seen(who)) return this.note(who, "gone");
    // The account's first vault.
    if (await this.putVault(who, 0, key, EMPTY_VAULT)) return this.note(who, null);
    return this.settle(who, key);
  }

  /**
   * Puts back the vault this PC last read, when the account's is still missing a few seconds after it was found so (it
   * may be another PC's Start over, between its delete and its new vault). Answers the trouble left. Signed in as
   * another account meanwhile, nothing goes into its vault (request refuses).
   */
  private async restore(who: string, key: Buffer, cached: VaultContent): Promise<VaultTrouble | null> {
    const wait = this.options.putBackAfterMs ?? PUT_BACK_AFTER_MS;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if ((await this.vault(who, key)) === null && (await this.putVault(who, 0, key, cached))) return this.note(who, null);
    return this.settle(who, key);
  }

  /** Another PC made the account's vault meanwhile: the trouble is whether this PC's key opens it. */
  private async settle(who: string, key: Buffer): Promise<VaultTrouble | null> {
    const vault = await this.vault(who, key);
    return this.note(who, vault ? (opens(key, vault.data) ? null : "unopened") : "gone");
  }

  /**
   * Whether this PC has seen `who`'s vault: in this run, or before (the seen file names the accounts; one from before it
   * did says only that a vault was seen, which counts unless the key here is another account's; or a vault it kept).
   */
  private async seen(who: string): Promise<boolean> {
    if (this.sawVault === who) return true;
    const marks = await this.seenMarks();
    const key = this.mine(who);
    const seen = marks.includes(who) || (marks.includes(SEEN_BEFORE_ACCOUNTS) && (this.owner === null || this.owner === who)) || (key !== null && (await this.cached(key)) !== null);
    if (seen) this.sawVault = who;
    return seen;
  }

  /** The seen file's lines: account ids, or "1" in a file from before it named them. */
  private async seenMarks(): Promise<string[]> {
    if (!this.options.seenFile) return [];
    const text = await readFile(this.options.seenFile, "utf8").catch(() => null);
    return text === null ? [] : text.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  /** Whether this PC was used signed in: it saw a vault, or kept one. */
  private async usedSignedIn(): Promise<boolean> {
    for (const file of [this.options.seenFile, this.options.cacheFile]) {
      if (file && (await stat(file).then(() => true, () => false))) return true;
    }
    return false;
  }

  private async markSeen(who: string): Promise<void> {
    if (this.sawVault === who) return;
    this.sawVault = who;
    const file = this.options.seenFile;
    if (!file) return;
    const marks = await this.seenMarks();
    if (marks.includes(who)) return;
    await writeFileAtomic(file, [...marks, who].slice(-MAX_SEEN).join("\n")).catch(() => undefined);
  }

  private async cached(key: Buffer): Promise<VaultContent | null> {
    if (!this.options.cacheFile) return null;
    const sealed = await readFile(this.options.cacheFile).catch(() => null);
    return sealed ? openContent(key, sealed) : null;
  }

  private async keep(sealed: Uint8Array): Promise<void> {
    if (this.options.cacheFile) await writeFileAtomic(this.options.cacheFile, Buffer.from(sealed)).catch(() => undefined);
  }

  /**
   * Keeps the key on this PC as `owner`'s, unless it was forgotten since `generation` (signed out meanwhile) or the
   * account signed in is no longer `who`: then it is not kept. A vault as last read that the key doesn't open (another
   * account's) goes when the key changes hands.
   */
  private async save(key: Buffer, generation: number, who: string | null, owner: string | null, unproven = false): Promise<void> {
    if (!this.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    const stale = () => generation !== this.generation || this.options.account() !== who;
    if (stale()) throw new CopyError("signed-out");
    const data = this.options.encryptor.encrypt(key.toString("base64")).toString("base64");
    // `account` and `unproven` sit next to the sealed key: older Tavoras read only `v` and `data`.
    await writeFileAtomic(this.options.file, JSON.stringify({ v: STORE_VERSIONS.sealed, data, account: owner, ...(unproven ? { unproven } : {}) }));
    if (stale()) {
      await rm(this.options.file, { force: true });
      throw new CopyError("signed-out");
    }
    if (owner !== this.owner || this.unproven !== unproven) await this.dropOthersVault(key);
    this.key = key;
    this.owner = owner;
    this.unproven = unproven;
  }

  /** The vault as last read, when `key` doesn't open it: another account's, or another key's. */
  private async dropOthersVault(key: Buffer): Promise<void> {
    const file = this.options.cacheFile;
    if (!file) return;
    const sealed = await readFile(file).catch(() => null);
    if (sealed && !opens(key, sealed)) await forgetSealedFile(file);
  }

  // ── The vault on the service ───────────────────────────────────────

  /** One request for `who`'s vault; refused when another account, or none, is signed in now. */
  private async request(who: string, method: string, body?: Uint8Array): Promise<Response> {
    const token = this.options.token();
    if (!token || this.options.account() !== who) throw new CopyError("signed-out");
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

  /** `who`'s vault on the service, or null when it has none. Kept as the last read only when `key` opens it. */
  private async vault(who: string, key?: Buffer | null): Promise<{ version: number; data: Uint8Array } | null> {
    const response = await this.request(who, "GET");
    if (response.status === 404) return null;
    const version = Number(response.headers.get("x-vault-version"));
    if (!response.ok || !Number.isInteger(version) || version < 1) throw new CopyError("failed", `the vault answered ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    // Signed in as another account while it came: it is not noted as theirs.
    if (this.options.account() !== who) throw new CopyError("signed-out");
    await this.markSeen(who);
    if (key && opens(key, data)) await this.keep(data);
    return { version, data };
  }

  /** Stores `who`'s vault's content sealed with `key`, made from version `base`. False when another PC changed it first. */
  private async putVault(who: string, base: number, key: Buffer, content: VaultContent): Promise<boolean> {
    const sealed = sealVault(key, Buffer.from(JSON.stringify(content)));
    const body = Buffer.alloc(4 + sealed.length);
    body.writeUInt32BE(base);
    sealed.copy(body, 4);
    const response = await this.request(who, "PUT", body);
    if (response.status === 409) return false;
    if (response.status === 413) throw new CopyError("failed", "the vault is full");
    if (!response.ok) throw new CopyError("failed", `the vault answered ${response.status}`);
    await this.keep(sealed);
    await this.markSeen(who);
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

/**
 * A kept key and the account it belongs to: null for none yet, undefined in a file from before keys noted it (or one
 * whose note can't be read: it is treated the same). `unproven`: see AccountKey.unproven.
 */
async function readKey(file: string, encryptor: Encryptor): Promise<{ key: Buffer; owner: string | null | undefined; unproven: boolean } | null> {
  if (!encryptor.isAvailable()) return null;
  // Missing, newer, damaged, or sealed by another user or PC: none (openSealedFile keeps the file aside).
  return openSealedFile(file, (data, saved) => {
    const key = Buffer.from(encryptor.decrypt(Buffer.from(data, "base64")), "base64");
    if (key.length !== 32) throw new Error("not a key");
    const owner = saved.account;
    return { key, owner: typeof owner === "string" && owner.length > 0 ? owner : owner === null ? null : undefined, unproven: saved.unproven === true };
  });
}
