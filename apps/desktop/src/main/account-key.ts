import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
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
// Each key notes the account it belongs to, and each account's key waits on this PC for that account (security audit
// 2026-11-20, run 2). A sign-in the service ends by itself (a 401: signed out from another device, unused for a year)
// forgets only the sign-in: the key and the vault last read stay, and the same account signing in again goes on with
// them. Another account signed in here never gets them (not used, shown, sent to another PC or put into its vault), and
// its own key is kept apart: account-key.json and account-vault.bin hold the cloud copy's key (the one older Tavoras
// read), account-key.<account>.json and account-vault.<account>.bin the other accounts'. The copy goes on only with
// the key it was sealed with: while another account is signed in, it stays off. Signing out forgets only that account's.
//
// A key made or typed in signed out (a folder's copy) belongs to no account yet: the first account it is used with
// takes it. A key file from before keys noted their account is taken by the account signed in at the first start that
// reads it; with none signed in then, on a PC used signed in before (it saw a vault), it is "unproven": an account takes
// it only when its vault opens with it, and nothing of it is dropped meanwhile.

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
/** Keys of other accounts than the copy's kept at most (the ones used last). */
const MAX_OTHER_KEYS = 8;
/** The file tag of an unproven key moved aside (see the header). */
const UNPROVEN_TAG = "unproven";

export type KeySetUp = { status: "ready"; created: boolean } | { status: "ask" };

/** One kept key: its files, and whose it is. */
interface Slot {
  key: Buffer;
  /** The account it belongs to; null for one made or typed in signed out, or an unproven one. */
  owner: string | null;
  /** From before keys noted their account, whose it is unknown (see the header). */
  unproven: boolean;
  keyFile: string;
  cacheFile: string | undefined;
}

export class AccountKey {
  /** The cloud copy's key, in account-key.json: the one older Tavoras read. */
  private main: Slot | null = null;
  /** The other accounts' keys, by file tag. */
  private readonly others = new Map<string, Slot>();
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

  /**
   * The account's key, for the account signed in now. Signed out, only a key that belongs to no account yet: one that
   * is an account's waits for it (the cloud copy in a folder uses copyKey).
   */
  get(): Buffer | null {
    const who = this.options.account();
    if (who === null) return this.adoptable(this.main) ? this.main!.key : null;
    return this.slotFor(who)?.key ?? null;
  }

  /**
   * The key the cloud copy is sealed with: signed out, the copy's key as it is (a folder's copy needs no account);
   * signed in, only when it is that account's (or no account's yet), so the copy stays off for another account.
   */
  copyKey(): Buffer | null {
    const who = this.options.account();
    const main = this.main;
    if (!main) return null;
    return who === null || main.owner === who || this.adoptable(main) ? main.key : null;
  }

  /** Whether the cloud copy's key is `account`'s (or no account's yet): its sign-out ends the copy too. */
  copyIsOf(account: string | null): boolean {
    const main = this.main;
    return !main || (account !== null && main.owner === account) || this.adoptable(main);
  }

  /** What is wrong with the account's vault, as this PC last saw it; null when nothing is. */
  get trouble(): VaultTrouble | null {
    const who = this.options.account();
    return who !== null && this.slotFor(who) && this.problem?.account === who ? this.problem.trouble : null;
  }

  /** The recovery key to show, when this PC has the key (see `get`). */
  recoveryKey(): string | null {
    const key = this.get();
    return key ? recoveryKey(key) : null;
  }

  /** Reads this PC's keys, at start. Never throws. Answers the copy's key. */
  async load(): Promise<Buffer | null> {
    let saved = await readKey(this.options.file, this.options.encryptor);
    const legacy = this.options.legacyFile;
    if (!saved && legacy) {
      saved = await readKey(legacy, this.options.encryptor);
      if (saved) await rename(legacy, this.options.file).catch(() => undefined);
    }
    this.main = saved ? { key: saved.key, owner: saved.owner ?? null, unproven: saved.unproven, keyFile: this.options.file, cacheFile: this.options.cacheFile } : null;
    this.others.clear();
    for (const name of await readdir(path.dirname(this.options.file)).catch(() => [] as string[])) {
      const tag = this.tagOfFile(name);
      if (tag === null) continue;
      const other = await readKey(path.join(path.dirname(this.options.file), name), this.options.encryptor);
      if (!other) continue;
      const files = this.filesOf(tag);
      this.others.set(tag, { key: other.key, owner: other.owner ?? null, unproven: other.unproven || tag === UNPROVEN_TAG, ...files });
    }
    if (saved && saved.owner === undefined) {
      // From before keys noted their account: it is the one signed in now, which it was used with. With no one signed
      // in, it is noted as unproven when this PC was used signed in, so a later start doesn't give it to whoever is then.
      const who = this.options.account();
      if (who !== null) {
        await this.write(this.main!, saved.key, who, false, this.generation, who).catch(() => undefined);
        await this.provenSeen(who);
      } else {
        await this.write(this.main!, saved.key, null, await this.usedSignedIn(), this.generation, null).catch(() => undefined);
      }
    }
    return this.main?.key ?? null;
  }

  /**
   * The key for the account signed in now, taking a key that belongs to no account yet (see `claim`); signed out, see
   * `get`. Null when this PC has none for it.
   */
  async forAccount(): Promise<Buffer | null> {
    const who = this.options.account();
    return who === null ? this.get() : ((await this.claim(who, this.generation))?.key ?? null);
  }

  /**
   * Makes sure this PC has the account's key. When the account has none yet, one is made here
   * (`created`: show the recovery key now). When another PC made one, the user types it in ("ask").
   */
  async setUp(): Promise<KeySetUp> {
    const generation = this.generation;
    const who = this.signedInAs();
    const slot = await this.claim(who, generation);
    const vault = await this.vault(who, slot);
    if (slot) {
      if (!vault) {
        // Gone from the service: put back what this PC last read. With nothing to put back, an account that had a
        // vault gets an empty one only when the user says so (rebuild); this PC goes on with its key.
        await this.putBack(who, slot);
        return { status: "ready", created: false };
      }
      if (opens(slot.key, vault.data)) {
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
    const place = this.placeFor(who);
    // Another PC may have made one at the same moment: then its key is asked for.
    if (!(await this.putVault(who, 0, made, EMPTY_VAULT, place.cacheFile))) return { status: "ask" };
    await this.write(place, made, who, false, generation, who);
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
    const slot = await this.claim(who, this.generation);
    if (!slot) return false;
    const vault = await this.vault(who, slot);
    if (!vault) return true;
    const fits = opens(slot.key, vault.data);
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
    const slot = await this.write(this.placeFor(who), key, who, false, generation, who);
    if (vault) {
      await this.keep(slot.cacheFile, vault.data);
      this.note(who, null);
      return;
    }
    // No vault: the key becomes the account's, with what this PC last read under it. A vault seen before and gone now
    // is not made again empty without the user (rebuild): the key is kept, and the trouble shown.
    await this.putBack(who, slot);
  }

  /**
   * The user's answer when the account's vault is gone and this PC has nothing to put back: the account gets a vault
   * under this PC's key again, empty. Its publisher keys are lost then, unless the developer exported them to a file.
   */
  async rebuild(): Promise<void> {
    const who = this.signedInAs();
    const slot = await this.claim(who, this.generation);
    if (!slot) throw new CopyError("failed", "no key on this PC");
    const vault = await this.vault(who, slot);
    if (vault) {
      // Back meanwhile: nothing is replaced.
      this.note(who, opens(slot.key, vault.data) ? null : "unopened");
      return;
    }
    if (!(await this.putVault(who, 0, slot.key, (await this.cached(slot)) ?? EMPTY_VAULT, slot.cacheFile))) throw new CopyError("failed", "another PC made a vault at the same moment");
    this.note(who, null);
  }

  /**
   * A lost key: the vault is replaced by one under a new key, made here. What the old key sealed can't be
   * opened again, except the vault itself when this PC still has the old key: its publisher keys move over. Only the
   * account's own key moves anything over; what this PC keeps of other keys (another account's, an unproven one) stays.
   */
  async startOver(): Promise<void> {
    const generation = this.generation;
    const who = this.signedInAs();
    const oldSlot = await this.claim(who, generation);
    const oldKey = oldSlot?.key ?? null;
    const old = oldSlot ? await this.vault(who, oldSlot).catch(() => null) : null;
    // The publisher keys move over: from the vault when the old key opens it, else from what this PC last read.
    const content = (old && oldKey && openContent(oldKey, old.data)) || (oldSlot && (await this.cached(oldSlot))) || EMPTY_VAULT;
    const key = newCopyKey();
    const place = this.placeFor(who);
    for (let attempt = 0; ; attempt++) {
      await this.request(who, "DELETE");
      if (await this.putVault(who, 0, key, content, place.cacheFile)) break;
      // Another PC came first. One that put back the old vault (it saw it missing) is undone and tried again; a vault
      // under any other key is another PC's new key, which stays.
      const now = await this.vault(who).catch(() => null);
      if (attempt >= 2 || !now || !oldKey || !opens(oldKey, now.data)) throw new CopyError("failed", "another PC made a key at the same moment");
    }
    await this.write(place, key, who, false, generation, who);
    this.note(who, null);
  }

  /**
   * What the vault holds; when the service can't be reached, or its vault doesn't open with this PC's key or is gone,
   * what this PC last read (`trouble` says which).
   */
  async content(): Promise<VaultContent> {
    const who = this.signedInAs();
    const slot = await this.claim(who, this.generation);
    if (!slot) throw new CopyError("failed", "no key on this PC");
    let vault: { version: number; data: Uint8Array } | null;
    try {
      vault = await this.vault(who, slot);
    } catch (error) {
      const cached = error instanceof CopyError && (error.reason === "unreachable" || error.reason === "unavailable") ? await this.cached(slot) : null;
      if (cached) return cached;
      throw error;
    }
    if (!vault) {
      // Gone from the service: what this PC last read goes back (setUp does the same); nothing is made empty here.
      const cached = await this.cached(slot);
      if (!cached) {
        this.note(who, (await this.seen(who)) ? "gone" : null);
        return EMPTY_VAULT;
      }
      await this.restore(who, slot, cached).catch(() => undefined);
      return cached;
    }
    const content = openContent(slot.key, vault.data);
    if (content) {
      this.note(who, null);
      return content;
    }
    this.note(who, "unopened");
    const cached = await this.cached(slot);
    if (cached) return cached;
    throw new CopyError("damaged");
  }

  /** Changes what the vault holds, made on top of what it holds now (tried again when another PC changed it first). */
  async change(update: (content: VaultContent) => VaultContent): Promise<VaultContent> {
    const who = this.signedInAs();
    const slot = await this.claim(who, this.generation);
    if (!slot) throw new CopyError("failed", "no key on this PC");
    for (let attempt = 0; attempt < 3; attempt++) {
      const vault = await this.vault(who, slot);
      // Only on top of a vault this key opens; a gone one is made again from what this PC last read, never empty unasked.
      const content = vault ? openContent(slot.key, vault.data) : ((await this.cached(slot)) ?? ((await this.seen(who)) ? null : EMPTY_VAULT));
      if (!content) {
        this.note(who, vault ? "unopened" : "gone");
        throw new CopyError("damaged");
      }
      const next = update(content);
      if (await this.putVault(who, vault?.version ?? 0, slot.key, next, slot.cacheFile)) {
        this.note(who, null);
        return next;
      }
    }
    throw new CopyError("failed", "the vault kept changing");
  }

  /**
   * Signed in: the account's key becomes the cloud copy's (turning the copy on, or going on with a key typed in). The
   * copy's key before, another account's, moves to that account's own files and waits for it there.
   */
  async useForCopy(): Promise<void> {
    const who = this.signedInAs();
    const slot = await this.claim(who, this.generation);
    if (!slot || slot === this.main) return;
    if (this.main) await this.moveAside(this.main);
    await rename(slot.keyFile, this.options.file);
    if (slot.cacheFile && this.options.cacheFile) {
      await rename(slot.cacheFile, this.options.cacheFile).catch(async () => {
        await forgetSealedFile(this.options.cacheFile!);
      });
    }
    this.others.delete(this.tagOf(who));
    this.main = { ...slot, keyFile: this.options.file, cacheFile: this.options.cacheFile };
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
    if (this.main) return { status: "ready", created: false };
    if (hasCopy) return { status: "ask" };
    await this.saveHere(newCopyKey(), null);
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
    // The copy's key already: it stays its account's. Another one belongs to no account yet.
    await this.saveHere(key, this.main?.key.equals(key) ? this.main.owner : null);
  }

  /** Signed out, a lost key: a new one is made here. */
  async startOverHere(): Promise<void> {
    await this.saveHere(newCopyKey(), null);
  }

  /**
   * Signed out: the key belongs to the account, so this PC forgets it. `account`: the account that signed out (only its
   * key goes, and one that belongs to no account yet); null for a key that belongs to none; left out, every key.
   */
  async forget(account?: string | null): Promise<void> {
    this.generation++;
    this.sawVault = null;
    this.problem = null;
    const all = account === undefined;
    const main = this.main;
    if (main && (all || this.adoptable(main) || (account !== null && main.owner === account))) {
      this.main = null;
      await forgetSealedFile(this.options.file);
      if (this.options.legacyFile) await forgetSealedFile(this.options.legacyFile);
      // With any half-written copy a crash left (forgetSealedFile removes those too).
      if (this.options.cacheFile) await forgetSealedFile(this.options.cacheFile);
    }
    for (const [tag, slot] of [...this.others]) {
      if (!all && (account === null || slot.owner !== account)) continue;
      this.others.delete(tag);
      await forgetSealedFile(slot.keyFile);
      if (slot.cacheFile) await forgetSealedFile(slot.cacheFile);
    }
    const seenFile = this.options.seenFile;
    if (!seenFile) return;
    if (all || (!this.main && this.others.size === 0)) await forgetSealedFile(seenFile);
    else if (account) await this.writeSeen((await this.seenMarks()).filter((mark) => mark !== account));
  }

  /**
   * Signed out while a folder's copy keeps the key here: the key stays (still the account's), the vault as last read,
   * with the account's publisher keys, goes. Signing in again reads it anew.
   */
  async forgetVault(account: string | null): Promise<void> {
    this.problem = null;
    const slot = account === null ? (this.adoptable(this.main) ? this.main : null) : this.slotFor(account);
    if (slot?.cacheFile) await forgetSealedFile(slot.cacheFile);
  }

  /** A key that belongs to no account yet, which the first account to use it takes. */
  private adoptable(slot: Slot | null): boolean {
    return slot !== null && slot.owner === null && !slot.unproven;
  }

  /** `who`'s kept key, or null (another account's stays with it). */
  private slotFor(who: string): Slot | null {
    if (this.main && (this.main.owner === who || this.adoptable(this.main))) return this.main;
    for (const slot of this.others.values()) if (slot.owner === who) return slot;
    return null;
  }

  /** Where `who`'s key goes: where it is, else the copy's files when there is no copy key, else `who`'s own. */
  private placeFor(who: string): Slot | Pick<Slot, "keyFile" | "cacheFile"> {
    return this.slotFor(who) ?? (this.main ? this.filesOf(this.tagOf(who)) : { keyFile: this.options.file, cacheFile: this.options.cacheFile });
  }

  /**
   * The key for `who`, signed in. A key that belongs to no account yet becomes `who`'s now; an unproven one only when
   * `who`'s vault opens with it. Null when this PC has none for `who` (another account's stays). Offline, an unproven key
   * stays unproven (the request throws): whose it is can't be told, so it isn't used.
   */
  private async claim(who: string, generation: number): Promise<Slot | null> {
    const slot = this.slotFor(who);
    if (slot) return slot.owner === null ? this.write(slot, slot.key, who, false, generation, who) : slot;
    const unproven = [this.main, ...this.others.values()].filter((item): item is Slot => item !== null && item.unproven);
    if (unproven.length === 0) return null;
    const vault = await this.vault(who);
    // Another claim took it while the vault came.
    const meanwhile = this.slotFor(who);
    if (meanwhile) return meanwhile;
    const proven = vault ? unproven.find((item) => item.unproven && opens(item.key, vault.data) && (item === this.main || this.others.get(UNPROVEN_TAG) === item)) : undefined;
    if (!proven) return null;
    if (proven.keyFile === this.options.file) await this.write(proven, proven.key, who, false, generation, who);
    else {
      // Moved aside before (another account took the copy): it goes to `who`'s own files, with what it last read.
      const files = this.filesOf(this.tagOf(who));
      await this.write(files, proven.key, who, false, generation, who);
      if (proven.cacheFile && files.cacheFile) await rename(proven.cacheFile, files.cacheFile).catch(() => undefined);
      await forgetSealedFile(proven.keyFile);
      this.others.delete(UNPROVEN_TAG);
    }
    await this.provenSeen(who);
    return this.slotFor(who);
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
   * The vault is missing on the service: puts back what this PC last read under the key, or an empty one when the account
   * never had a vault this PC saw. Answers the trouble left: "gone" when it had one and nothing could be put back.
   */
  private async putBack(who: string, slot: Slot): Promise<VaultTrouble | null> {
    const cached = await this.cached(slot);
    if (cached) return this.restore(who, slot, cached);
    if (await this.seen(who)) return this.note(who, "gone");
    // The account's first vault.
    if (await this.putVault(who, 0, slot.key, EMPTY_VAULT, slot.cacheFile)) return this.note(who, null);
    return this.settle(who, slot);
  }

  /**
   * Puts back the vault this PC last read, when the account's is still missing a few seconds after it was found so (it
   * may be another PC's Start over, between its delete and its new vault). Answers the trouble left. Signed in as
   * another account meanwhile, nothing goes into its vault (request refuses).
   */
  private async restore(who: string, slot: Slot, cached: VaultContent): Promise<VaultTrouble | null> {
    const wait = this.options.putBackAfterMs ?? PUT_BACK_AFTER_MS;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if ((await this.vault(who, slot)) === null && (await this.putVault(who, 0, slot.key, cached, slot.cacheFile))) return this.note(who, null);
    return this.settle(who, slot);
  }

  /** Another PC made the account's vault meanwhile: the trouble is whether this PC's key opens it. */
  private async settle(who: string, slot: Slot): Promise<VaultTrouble | null> {
    const vault = await this.vault(who, slot);
    return this.note(who, vault ? (opens(slot.key, vault.data) ? null : "unopened") : "gone");
  }

  /**
   * Whether this PC has seen `who`'s vault: in this run, or before (the seen file names the accounts; one from before it
   * did says only that a vault was seen, which counts unless the copy's key is another account's; or a vault it kept).
   */
  private async seen(who: string): Promise<boolean> {
    if (this.sawVault === who) return true;
    const marks = await this.seenMarks();
    const slot = this.slotFor(who);
    const legacy = marks.includes(SEEN_BEFORE_ACCOUNTS) && (!this.main || this.main.owner === null || this.main.owner === who);
    const seen = marks.includes(who) || legacy || (slot !== null && (await this.cached(slot)) !== null);
    if (seen) this.sawVault = who;
    return seen;
  }

  /** The seen file's lines: account ids, or "1" in a file from before it named them. */
  private async seenMarks(): Promise<string[]> {
    if (!this.options.seenFile) return [];
    const text = await readFile(this.options.seenFile, "utf8").catch(() => null);
    return text === null ? [] : text.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private async writeSeen(marks: string[]): Promise<void> {
    if (this.options.seenFile) await writeFileAtomic(this.options.seenFile, marks.slice(-MAX_SEEN).join("\n")).catch(() => undefined);
  }

  /** A key from before keys noted their account is `who`'s: the seen file's "1" was `who`'s vault. */
  private async provenSeen(who: string): Promise<void> {
    const marks = await this.seenMarks();
    if (!marks.includes(SEEN_BEFORE_ACCOUNTS)) return;
    await this.writeSeen([...new Set(marks.map((mark) => (mark === SEEN_BEFORE_ACCOUNTS ? who : mark)))]);
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
    const marks = await this.seenMarks();
    if (!marks.includes(who)) await this.writeSeen([...marks, who]);
  }

  private async cached(slot: Slot): Promise<VaultContent | null> {
    if (!slot.cacheFile) return null;
    const sealed = await readFile(slot.cacheFile).catch(() => null);
    return sealed ? openContent(slot.key, sealed) : null;
  }

  private async keep(cacheFile: string | undefined, sealed: Uint8Array): Promise<void> {
    if (cacheFile) await writeFileAtomic(cacheFile, Buffer.from(sealed)).catch(() => undefined);
  }

  /** Signed out: a key for the cloud copy. The copy's key before, when it is an account's, waits in that account's files. */
  private async saveHere(key: Buffer, owner: string | null): Promise<void> {
    const main = this.main;
    if (main && !main.key.equals(key) && (main.owner !== null || main.unproven)) await this.moveAside(main);
    await this.write({ keyFile: this.options.file, cacheFile: this.options.cacheFile }, key, owner, false, this.generation, null);
  }

  /** The copy's key moves to its account's own files (an unproven one to its own), with the vault it last read. */
  private async moveAside(main: Slot): Promise<void> {
    const tag = main.owner !== null ? this.tagOf(main.owner) : UNPROVEN_TAG;
    const files = this.filesOf(tag);
    await this.pruneOthers(tag);
    await rename(main.keyFile, files.keyFile);
    if (main.cacheFile && files.cacheFile) {
      await rename(main.cacheFile, files.cacheFile).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") await forgetSealedFile(files.cacheFile!);
        else throw error;
      });
    }
    this.others.set(tag, { ...main, ...files });
    this.main = null;
  }

  /** Room for one more other account's key: the one kept longest without use goes (never an unproven one). */
  private async pruneOthers(adding: string): Promise<void> {
    if (this.others.has(adding) || this.others.size < MAX_OTHER_KEYS) return;
    const accounts = [...this.others].filter(([tag]) => tag !== UNPROVEN_TAG);
    const dated = await Promise.all(accounts.map(async ([tag, slot]) => ({ tag, slot, at: (await stat(slot.keyFile).catch(() => null))?.mtimeMs ?? 0 })));
    const oldest = dated.sort((a, b) => a.at - b.at)[0];
    if (!oldest) return;
    this.others.delete(oldest.tag);
    await forgetSealedFile(oldest.slot.keyFile);
    if (oldest.slot.cacheFile) await forgetSealedFile(oldest.slot.cacheFile);
  }

  /**
   * Keeps `key` in `place` as `owner`'s, unless it was forgotten since `generation` (signed out meanwhile) or the account
   * signed in is no longer `who`: then it is not kept. Answers the slot it is in now.
   */
  private async write(place: Pick<Slot, "keyFile" | "cacheFile">, key: Buffer, owner: string | null, unproven: boolean, generation: number, who: string | null): Promise<Slot> {
    if (!this.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    const stale = () => generation !== this.generation || this.options.account() !== who;
    if (stale()) throw new CopyError("signed-out");
    const isMain = place.keyFile === this.options.file;
    if (!isMain) await this.pruneOthers(this.tagOfFile(path.basename(place.keyFile))!);
    const data = this.options.encryptor.encrypt(key.toString("base64")).toString("base64");
    // `account` and `unproven` sit next to the sealed key: older Tavoras read only `v` and `data`.
    await writeFileAtomic(place.keyFile, JSON.stringify({ v: STORE_VERSIONS.sealed, data, account: owner, ...(unproven ? { unproven } : {}) }));
    if (stale()) {
      await rm(place.keyFile, { force: true });
      throw new CopyError("signed-out");
    }
    const slot: Slot = { key, owner, unproven, keyFile: place.keyFile, cacheFile: place.cacheFile };
    if (isMain) this.main = slot;
    else this.others.set(this.tagOfFile(path.basename(place.keyFile))!, slot);
    return slot;
  }

  /** A file-name-safe tag for an account. */
  private tagOf(account: string): string {
    return /^[A-Za-z0-9_-]{1,64}$/.test(account) && account !== UNPROVEN_TAG ? account : createHash("sha256").update(account).digest("hex").slice(0, 32);
  }

  /** The files of the key kept under `tag`, next to the copy's (account-key.<tag>.json, account-vault.<tag>.bin). */
  private filesOf(tag: string): Pick<Slot, "keyFile" | "cacheFile"> {
    const cache = this.options.cacheFile;
    return { keyFile: withTag(this.options.file, tag), cacheFile: cache ? withTag(cache, tag) : undefined };
  }

  /** The tag of another account's key file, or null for any other file. */
  private tagOfFile(name: string): string | null {
    const base = path.basename(this.options.file);
    const stem = base.slice(0, base.length - path.extname(base).length);
    const ext = path.extname(base);
    if (!name.startsWith(`${stem}.`) || !name.endsWith(ext)) return null;
    const tag = name.slice(stem.length + 1, name.length - ext.length);
    return /^[A-Za-z0-9_-]{1,64}$/.test(tag) ? tag : null;
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

  /** `who`'s vault on the service, or null when it has none. Kept as `slot`'s last read only when its key opens it. */
  private async vault(who: string, slot?: Slot | null): Promise<{ version: number; data: Uint8Array } | null> {
    const response = await this.request(who, "GET");
    if (response.status === 404) return null;
    const version = Number(response.headers.get("x-vault-version"));
    if (!response.ok || !Number.isInteger(version) || version < 1) throw new CopyError("failed", `the vault answered ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    // Signed in as another account while it came: it is not noted as theirs.
    if (this.options.account() !== who) throw new CopyError("signed-out");
    await this.markSeen(who);
    if (slot && opens(slot.key, data)) await this.keep(slot.cacheFile, data);
    return { version, data };
  }

  /** Stores `who`'s vault's content sealed with `key`, made from version `base`. False when another PC changed it first. */
  private async putVault(who: string, base: number, key: Buffer, content: VaultContent, cacheFile: string | undefined): Promise<boolean> {
    const sealed = sealVault(key, Buffer.from(JSON.stringify(content)));
    const body = Buffer.alloc(4 + sealed.length);
    body.writeUInt32BE(base);
    sealed.copy(body, 4);
    const response = await this.request(who, "PUT", body);
    if (response.status === 409) return false;
    if (response.status === 413) throw new CopyError("failed", "the vault is full");
    if (!response.ok) throw new CopyError("failed", `the vault answered ${response.status}`);
    await this.markSeen(who);
    await this.keep(cacheFile, sealed);
    return true;
  }
}

/** `account-key.json` → `account-key.<tag>.json`. */
function withTag(file: string, tag: string): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${tag}${ext}`;
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
 * whose note can't be read: it is treated the same). `unproven`: see the header.
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
