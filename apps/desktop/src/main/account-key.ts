import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, readdir, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { CopyError } from "./cloud-copy";
import { newCopyKey, openVault, parseRecoveryKey, recoveryKey, sealVault } from "./copy-crypto";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { forgetSealedFile } from "./json";
import { UserError } from "./messages";
import { SealedFile } from "./sealed-file";

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
// its own key is kept apart: account-key.json and account-vault.bin hold the cloud copy's key (the only one an older
// Tavora reads), account-key.<account>.json and account-vault.<account>.bin the other accounts'. The copy goes on only
// with the key it was sealed with: while another account is signed in, it stays off. Signing out forgets only that
// account's. No key file is ever written over with another key: a key moves aside first (a key of no account, or one
// whose account is unknown, to account-key.unproven*.json), and a key file that can't be opened in this run stays too.
// Nor is a new key made while a key file that may hold the one needed can't be opened (decided 2026-11-23, "a saved
// file that can't be read is never written over"): only one that is truly missing is made anew. One that can't be read
// right now (held by a virus scan, or for good: its rights or encryption changed), one whose data doesn't open here
// (sealed by another Windows user, or no key store to open it) and one a newer Tavora wrote (copied aside) are read
// again first, then the recovery key is asked for, and why (`keyBlocked`): a new key would leave what was sealed with
// the old one behind. Start over moves such a file aside, never removes it. One moved aside already, whose record
// names the account or no one, counts too.
//
// Every change runs in one queue, in the order asked, so two (a turn-on and a key another PC sends) never read and
// write the files over each other. Signing out doesn't wait for it: it makes every change under way stale, and a stale
// change keeps nothing.
//
// A key made or typed in signed out (a folder's copy) belongs to no account yet: the first account it is used with
// takes it, when that account has no vault yet or its vault opens with it. A key file from before keys noted their
// account is taken by the account signed in at the first start that reads it; with none signed in then, on a PC used
// signed in before (it saw a vault), it is "unproven": an account takes it only when its vault opens with it (or the
// user types it in), and nothing of it is dropped meanwhile.

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
  /** Keys of other accounts than the copy's kept at most; MAX_OTHER_KEYS unless a test says otherwise. */
  maxOtherKeys?: number;
  log?: (line: string) => void;
}

/** See AccountKeyOptions.putBackAfterMs. */
export const PUT_BACK_AFTER_MS = 5_000;

/** The seen file's line from before it named accounts. */
const SEEN_BEFORE_ACCOUNTS = "1";
/** Accounts the seen file names at most (the newest). */
const MAX_SEEN = 20;
/** Keys of other accounts than the copy's kept at most (the ones used last; see pruneOthers). */
export const MAX_OTHER_KEYS = 32;
/** The file tag of a key moved aside whose account isn't known (unproven, or of no account). */
const UNPROVEN_TAG = "unproven";
/** The file tag of a copy key moved aside because it couldn't be opened in this run. */
const UNOPENED_TAG = "unopened";

export type KeySetUp = { status: "ready"; created: boolean } | { status: "ask" };

/** One kept key: its files, and whose it is. */
interface Slot {
  key: Buffer;
  /** The account it belongs to; null for one made or typed in signed out, or one whose account is unknown. */
  owner: string | null;
  /** Whose it is is unknown (see the header): only an account whose vault opens with it takes it. */
  unproven: boolean;
  keyFile: string;
  cacheFile: string | undefined;
}

type Files = Pick<Slot, "keyFile" | "cacheFile">;

/**
 * A key file this run couldn't open: "held" when it can't be read right now, "unopened" when its data doesn't open here
 * (sealed by another user or PC, or no key store to open it), "newer" when a newer Tavora wrote it (copied aside).
 */
interface Blocked {
  file: string;
  reason: "held" | "unopened" | "newer";
  /** The account its record names (outside the seal), null for none, undefined when unknown. */
  owner: string | null | undefined;
}

export class AccountKey {
  /** The cloud copy's key, in account-key.json: the one older Tavoras read. */
  private main: Slot | null = null;
  /** account-key.json is there but couldn't be opened in this run (a locked key store, a newer Tavora's): never written over. */
  private mainBlocked = false;
  /** The copy's key file (or the older one it came from) when it couldn't be opened in this run: no new key is made beside it. */
  private mainHold: Blocked | null = null;
  /** The other accounts' key files this run couldn't open, by file tag. */
  private readonly othersHold = new Map<string, Blocked>();
  /** The other accounts' keys (and keys moved aside), by file tag. */
  private readonly others = new Map<string, Slot>();
  /** Keys whose last use was noted in this run (pruneOthers). */
  private readonly touched = new Set<string>();
  /** Raised by `forget`: a key read or made before it (signed out meanwhile) is not kept. */
  private generation = 0;
  /** The account whose vault this PC saw in this run (the seen file keeps it across runs). */
  private sawVault: string | null = null;
  /** The seen file's last change, so the next one waits for it (changeSeen). */
  private seenTurn: Promise<void> = Promise.resolve();
  private problem: { account: string; trouble: VaultTrouble } | null = null;
  /** The last change asked for; the next one waits for it (serial). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: AccountKeyOptions) {}

  /** False where this PC can't keep the key encrypted: nothing that needs it can be turned on here. */
  get canKeep(): boolean {
    return this.options.encryptor.isAvailable();
  }

  /**
   * The account's key, for the account signed in now (its own, or one of no account it took). Signed out, only a key
   * of no account: one that is an account's waits for it (a cloud copy in a folder uses copyKey).
   */
  get(): Buffer | null {
    const who = this.options.account();
    if (who === null) return this.adoptable(this.main) ? this.main!.key : null;
    return this.ownSlot(who)?.key ?? null;
  }

  /**
   * The key the cloud copy is sealed with: signed out, the copy's key as it is (a folder's copy needs no account; what
   * may be shown or sent of it is CopySync.shareableKey); signed in, only when it is that account's or no account's.
   */
  copyKey(): Buffer | null {
    const who = this.options.account();
    const main = this.main;
    if (!main) return null;
    return who === null || main.owner === who || this.adoptable(main) ? main.key : null;
  }

  /** Whether the cloud copy's key is `account`'s, or no account's (null: only the latter, or none). */
  copyIsOf(account: string | null): boolean {
    const main = this.main;
    return !main || (account !== null && main.owner === account) || this.adoptable(main);
  }

  /** What is wrong with the account's vault, as this PC last saw it; null when nothing is. */
  get trouble(): VaultTrouble | null {
    const who = this.options.account();
    return who !== null && this.ownSlot(who) && this.problem?.account === who ? this.problem.trouble : null;
  }

  /**
   * A key file on this PC that may hold the key for the account signed in now (or the copy's key, signed out) can't be
   * opened: the recovery key is asked for instead of a new key, and the user is told why.
   */
  get keyBlocked(): boolean {
    return this.mayHold(this.options.account()) !== null;
  }

  /** The recovery key to show, when this PC has the key (see `get`). */
  recoveryKey(): string | null {
    const key = this.get();
    return key ? recoveryKey(key) : null;
  }

  /** Reads this PC's keys, at start. Never throws. Answers the copy's key. */
  load(): Promise<Buffer | null> {
    return this.serial(() => this.loadNow());
  }

  /**
   * The key files that may hold the key needed now and couldn't be opened are read again (only those), as they may open
   * now: the cloud copy asks, while it waits for its key.
   */
  openAgainNow(): Promise<void> {
    return this.serial(() => this.openAgain(this.options.account()));
  }

  private async loadNow(): Promise<Buffer | null> {
    const read = await readKey(this.options.file, this.options.encryptor);
    let saved = read.status === "opened" ? read : null;
    this.mainHold = read.status === "blocked" ? read : null;
    const legacy = this.options.legacyFile;
    // Only in place of a key file that is truly missing: one this run can't open is never put out of its place.
    if (read.status === "missing" && legacy) {
      const old = await readKey(legacy, this.options.encryptor);
      if (old.status === "opened") {
        if (await this.moveLegacyIn(legacy)) saved = old;
        else {
          // account-key.json came meanwhile: that one is read, and the older file stays as it is.
          const now = await readKey(this.options.file, this.options.encryptor);
          if (now.status === "opened") saved = now;
          else if (now.status === "blocked") this.mainHold = now;
        }
      } else if (old.status === "blocked") this.mainHold = old;
    }
    this.main = saved ? this.mainSlot(saved) : null;
    this.mainBlocked = this.mainHold?.file === this.options.file;
    this.others.clear();
    this.othersHold.clear();
    this.touched.clear();
    for (const name of await readdir(path.dirname(this.options.file)).catch(() => [] as string[])) {
      const tag = this.tagOfFile(name);
      if (tag === null) continue;
      const other = await readKey(path.join(path.dirname(this.options.file), name), this.options.encryptor);
      if (other.status === "blocked") this.othersHold.set(tag, other);
      if (other.status === "opened") this.others.set(tag, this.otherSlot(tag, other));
    }
    if (saved) await this.noteOwner(saved);
    return this.main?.key ?? null;
  }

  /**
   * The key for the account signed in now, taking a key of no account or an unproven one when it is that account's (see
   * `claim`); signed out, see `get`. Null when this PC has none for it.
   */
  forAccount(): Promise<Buffer | null> {
    return this.serial<Buffer | null>(async () => {
      const who = this.options.account();
      // A key file that may hold it and couldn't be opened is read again: it may open now.
      await this.openAgain(who);
      return who === null ? this.get() : ((await this.claim(who, this.generation))?.key ?? null);
    });
  }

  /**
   * Makes sure this PC has the account's key. When the account has none yet, one is made here
   * (`created`: show the recovery key now). When another PC made one, the user types it in ("ask").
   */
  setUp(): Promise<KeySetUp> {
    return this.serial<KeySetUp>(async () => {
      const generation = this.generation;
      const who = this.signedInAs();
      await this.openAgain(who);
      const slot = await this.claim(who, generation);
      const vault = await this.vault(who, slot?.key);
      if (slot) {
        if (!vault) {
          // Gone from the service: put back what this PC last read. With nothing to put back, an account that had a
          // vault gets an empty one only when the user says so (rebuild); this PC goes on with its key.
          await this.putBack(who, slot.key);
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
      const blocked = this.noNewKey(who);
      if (blocked) return blocked;
      const made = newCopyKey();
      const place = await this.freePlace(who);
      // Another PC may have made one at the same moment: then its key is asked for.
      if (!(await this.putVault(who, 0, made, EMPTY_VAULT, place.cacheFile))) return { status: "ask" };
      await this.write(place, made, who, false, generation, who);
      return { status: "ready", created: true };
    });
  }

  /** Whether the account has a key already, made on this PC or another (also when its vault went missing since). */
  exists(): Promise<boolean> {
    return this.serial<boolean>(async () => {
      const who = this.signedInAs();
      return (await this.vault(who)) !== null || (await this.seen(who));
    });
  }

  /**
   * Whether this PC's key still opens the account's vault; false only when it surely doesn't (another PC started over,
   * or the service sent something else), or this PC has no key for the account signed in. It forgets nothing either way.
   */
  fits(): Promise<boolean> {
    return this.serial<boolean>(async () => {
      const who = this.options.account();
      if (who === null) return false;
      const slot = await this.claim(who, this.generation);
      if (!slot) return false;
      const vault = await this.vault(who, slot.key);
      if (!vault) return true;
      const fits = opens(slot.key, vault.data);
      this.note(who, fits ? null : "unopened");
      return fits;
    });
  }

  /** The recovery key the user typed in: checked against the account's vault, then kept on this PC. */
  async enter(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    await this.take(key);
  }

  /**
   * The account's key, typed in as the recovery key or sent by another PC (pairing.ts): checked against the vault, then
   * kept, in the account's own files (another key is never written over). The same key as one this PC keeps without
   * an account goes on with what that one last read.
   */
  take(key: Buffer): Promise<void> {
    return this.serial<void>(async () => {
      const generation = this.generation;
      const who = this.signedInAs();
      // Not kept as the last read yet: only once the key is kept on this PC.
      const vault = await this.vault(who);
      if (vault && !opens(key, vault.data)) throw new UserError("cloudCopy.error.wrongKey");
      const same = [this.main, ...this.others.values()].find((item): item is Slot => item !== null && item.owner === null && item.key.equals(key));
      if (same?.unproven) await this.adoptUnproven(same, who, generation);
      else if (same) await this.write(same, key, who, false, generation, who);
      else await this.write(await this.freePlace(who, key), key, who, false, generation, who);
      if (vault) {
        await this.keepFor(who, key, vault.data);
        this.note(who, null);
        return;
      }
      // No vault: the key becomes the account's, with what this PC last read under it. A vault seen before and gone now
      // is not made again empty without the user (rebuild): the key is kept, and the trouble shown.
      await this.putBack(who, key);
    });
  }

  /**
   * The user's answer when the account's vault is gone and this PC has nothing to put back: the account gets a vault
   * under this PC's key again, empty. Its publisher keys are lost then, unless the developer exported them to a file.
   */
  rebuild(): Promise<void> {
    return this.serial<void>(async () => {
      const who = this.signedInAs();
      const slot = await this.claim(who, this.generation);
      if (!slot) throw new CopyError("failed", "no key on this PC");
      const key = slot.key;
      const vault = await this.vault(who, key);
      if (vault) {
        // Back meanwhile: nothing is replaced.
        this.note(who, opens(key, vault.data) ? null : "unopened");
        return;
      }
      if (!(await this.putVault(who, 0, key, (await this.cached(who, key)) ?? EMPTY_VAULT))) throw new CopyError("failed", "another PC made a vault at the same moment");
      this.note(who, null);
    });
  }

  /**
   * A lost key: the vault is replaced by one under a new key, made here. What the old key sealed can't be
   * opened again, except the vault itself when this PC still has the old key: its publisher keys move over. Only the
   * account's own key moves anything over; what this PC keeps of other keys (another account's, an unproven one) stays.
   */
  startOver(): Promise<void> {
    return this.serial<void>(async () => {
      const generation = this.generation;
      const who = this.signedInAs();
      const oldKey = (await this.claim(who, generation))?.key ?? null;
      const old = oldKey ? await this.vault(who, oldKey).catch(() => null) : null;
      // The publisher keys move over: from the vault when the old key opens it, else from what this PC last read.
      const content = (old && oldKey && openContent(oldKey, old.data)) || (oldKey && (await this.cached(who, oldKey))) || EMPTY_VAULT;
      const key = newCopyKey();
      const place = await this.freePlace(who);
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
    });
  }

  /**
   * What the vault holds; when the service can't be reached, or its vault doesn't open with this PC's key or is gone,
   * what this PC last read (`trouble` says which).
   */
  content(): Promise<VaultContent> {
    return this.serial<VaultContent>(async () => {
      const who = this.signedInAs();
      const slot = await this.claim(who, this.generation);
      if (!slot) throw new CopyError("failed", "no key on this PC");
      const key = slot.key;
      let vault: { version: number; data: Uint8Array } | null;
      try {
        vault = await this.vault(who, key);
      } catch (error) {
        const cached = error instanceof CopyError && (error.reason === "unreachable" || error.reason === "unavailable") ? await this.cached(who, key) : null;
        if (cached) return cached;
        throw error;
      }
      if (!vault) {
        // Gone from the service: what this PC last read goes back (setUp does the same); nothing is made empty here.
        const cached = await this.cached(who, key);
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
      const cached = await this.cached(who, key);
      if (cached) return cached;
      throw new CopyError("damaged");
    });
  }

  /** Changes what the vault holds, made on top of what it holds now (tried again when another PC changed it first). */
  change(update: (content: VaultContent) => VaultContent): Promise<VaultContent> {
    return this.serial<VaultContent>(async () => {
      const who = this.signedInAs();
      const slot = await this.claim(who, this.generation);
      if (!slot) throw new CopyError("failed", "no key on this PC");
      const key = slot.key;
      for (let attempt = 0; attempt < 3; attempt++) {
        const vault = await this.vault(who, key);
        // Only on top of a vault this key opens; a gone one is made again from what this PC last read, never empty unasked.
        const content = vault ? openContent(key, vault.data) : ((await this.cached(who, key)) ?? ((await this.seen(who)) ? null : EMPTY_VAULT));
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
    });
  }

  /**
   * Signed in: the account's key becomes the cloud copy's (turning the copy on, or going on with a key typed in). The
   * copy's key before moves aside: another account's to that account's own files, where it waits; one of no account to
   * the unproven ones; a key file that can't be opened in this run as it is.
   */
  useForCopy(): Promise<void> {
    return this.serial<void>(async () => {
      const who = this.signedInAs();
      const slot = await this.claim(who, this.generation);
      if (!slot || slot === this.main) return;
      if (this.mainBlocked) await this.moveBlockedAside();
      if (this.main) await this.moveAside(this.main);
      await this.setAside({ keyFile: this.options.file, cacheFile: this.options.cacheFile });
      await rename(slot.keyFile, this.options.file);
      if (slot.cacheFile && this.options.cacheFile) {
        await rename(slot.cacheFile, this.options.cacheFile).catch(async () => {
          await forgetSealedFile(this.options.cacheFile!);
        });
      }
      for (const [tag, item] of this.others) if (item === slot) this.others.delete(tag);
      this.main = { ...slot, keyFile: this.options.file, cacheFile: this.options.cacheFile };
    });
  }

  /** Whether this PC is signed in, so the key goes through the account's vault. */
  get signedIn(): boolean {
    return this.options.token() !== null;
  }

  /**
   * Signed out, for a copy in a folder of the user's own (decided 2026-10-20): the key is made here
   * without the vault, or asked for when the folder holds a copy already. Signing in later gives the
   * account a vault with it (setUp). Only a copy key of no account is used again: an account's waits for it, and a
   * new key is made beside it.
   */
  setUpHere(hasCopy: boolean): Promise<KeySetUp> {
    return this.serial<KeySetUp>(async () => {
      await this.openAgain(null);
      if (this.main && this.copyIsOf(null)) return { status: "ready", created: false };
      if (hasCopy) return { status: "ask" };
      const blocked = this.noNewKey(null);
      if (blocked) return blocked;
      await this.saveHere(newCopyKey(), null);
      return { status: "ready", created: true };
    });
  }

  /** Signed out: the recovery key typed in is kept here. Whether it opens the folder's copy is the check. */
  async enterHere(text: string): Promise<void> {
    const key = parseRecoveryKey(text);
    if (!key) throw new UserError("cloudCopy.error.badKey");
    await this.takeHere(key);
  }

  /** Signed out: the key another PC sent through the folder (pairing.ts) is kept here, like one typed in. */
  takeHere(key: Buffer): Promise<void> {
    return this.serial<void>(async () => {
      // The copy's key already: it stays its account's. Another one belongs to no account yet.
      await this.saveHere(key, this.main?.key.equals(key) ? this.main.owner : null);
    });
  }

  /** Signed out, a lost key: a new one is made here. */
  startOverHere(): Promise<void> {
    return this.serial<void>(async () => {
      await this.saveHere(newCopyKey(), null);
    });
  }

  /**
   * Signed out: the key belongs to the account, so this PC forgets it. `account`: the account that signed out (only its
   * key goes, and one that belongs to no account yet); null for a key that belongs to none; left out, every key.
   */
  forget(account?: string | null): Promise<void> {
    // At once, not after the changes queued: signing out never waits for one (a request may take long). Each change
    // under way is stale from now on, and keeps nothing it writes (write).
    this.generation++;
    this.sawVault = null;
    this.problem = null;
    return this.forgetNow(account);
  }

  private async forgetNow(account: string | null | undefined): Promise<void> {
    const all = account === undefined;
    const main = this.main;
    if ((main && (all || this.adoptable(main) || (account !== null && main.owner === account))) || (all && this.mainBlocked)) {
      this.main = null;
      this.mainBlocked = false;
      this.mainHold = null;
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
    if (all || (!this.main && !this.mainBlocked && this.others.size === 0)) await this.changeSeen(() => "forget");
    else if (account) await this.changeSeen((marks) => marks.filter((mark) => mark !== account));
  }

  /**
   * Signed out while a folder's copy keeps the key here: the key stays (still the account's), the vault as last read,
   * with the account's publisher keys, goes. Signing in again reads it anew.
   */
  forgetVault(account: string | null): Promise<void> {
    return this.serial<void>(async () => {
      this.problem = null;
      const slot = account === null ? (this.adoptable(this.main) ? this.main : null) : this.ownSlot(account);
      if (slot?.cacheFile) await forgetSealedFile(slot.cacheFile);
    });
  }

  /**
   * A key file this run couldn't open that may hold `who`'s key (null: the copy's key of no account): the copy's key
   * file of `who`, of no account or of an unknown one, or `who`'s own. Null when there is none.
   */
  private mayHold(who: string | null): Blocked | null {
    return this.blockedFor(who)[0]?.blocked ?? null;
  }

  /**
   * The key files this run couldn't open that may hold `who`'s key, by file tag (null: the copy's, or its older file):
   * the copy's when its record names `who`, no one or isn't known; `who`'s own; and one moved aside whose record names
   * `who`, no one or isn't known.
   */
  private blockedFor(who: string | null): { tag: string | null; blocked: Blocked }[] {
    const could = (blocked: Blocked) => blocked.owner === undefined || blocked.owner === null || blocked.owner === who;
    const found: { tag: string | null; blocked: Blocked }[] = [];
    if (this.mainHold && could(this.mainHold)) found.push({ tag: null, blocked: this.mainHold });
    for (const [tag, blocked] of this.othersHold) {
      const own = who !== null && tag === this.tagOf(who);
      const aside = tag.startsWith(UNOPENED_TAG) || tag.startsWith(UNPROVEN_TAG);
      if (own || (aside && could(blocked))) found.push({ tag, blocked });
    }
    return found;
  }

  /** The key files that may hold `who`'s key and couldn't be opened are read again (only those), as they may open now. */
  private async openAgain(who: string | null): Promise<void> {
    for (const { tag, blocked } of this.blockedFor(who)) {
      if (tag === null) await this.reopenMain(blocked);
      else await this.reopenOther(tag);
    }
  }

  /** The copy's key file, or its older one, read again. */
  private async reopenMain(blocked: Blocked): Promise<void> {
    const read = await readKey(blocked.file, this.options.encryptor);
    if (read.status === "blocked") {
      this.mainHold = read;
      return;
    }
    this.mainHold = null;
    if (blocked.file === this.options.file) {
      this.mainBlocked = false;
      if (read.status === "opened") {
        this.main = this.mainSlot(read);
        await this.noteOwner(read);
      }
      return;
    }
    // The older file, with account-key.json missing at start: it moves in only while that is still so. One there now
    // (another Tavora wrote it) is read instead, and the older file stays as it is.
    if (read.status !== "opened" || this.main || this.mainBlocked) return;
    if (await this.moveLegacyIn(blocked.file)) {
      this.main = this.mainSlot(read);
      await this.noteOwner(read);
    } else await this.reopenMain({ file: this.options.file, reason: "held", owner: undefined });
  }

  /** Another account's key file (or one moved aside), read again. */
  private async reopenOther(tag: string): Promise<void> {
    const read = await readKey(this.filesOf(tag).keyFile, this.options.encryptor);
    if (read.status === "blocked") {
      this.othersHold.set(tag, read);
      return;
    }
    this.othersHold.delete(tag);
    if (read.status === "opened") this.others.set(tag, this.otherSlot(tag, read));
  }

  /**
   * The older key file moves in as account-key.json, never onto one: a copy that fails when that is there, then the
   * older file goes. Whether it moved.
   */
  private async moveLegacyIn(legacy: string): Promise<boolean> {
    try {
      await copyFile(legacy, this.options.file, constants.COPYFILE_EXCL);
    } catch {
      return false;
    }
    await rm(legacy, { force: true }).catch(() => undefined);
    return true;
  }

  /** The copy's key as read. */
  private mainSlot(read: OpenedKey): Slot {
    return { key: read.key, owner: read.owner ?? null, unproven: read.unproven, keyFile: this.options.file, cacheFile: this.options.cacheFile };
  }

  /** Another account's key as read (or one moved aside: from before keys noted their account, it counts as unproven). */
  private otherSlot(tag: string, read: OpenedKey): Slot {
    const unproven = read.unproven || read.owner === undefined || tag.startsWith(UNPROVEN_TAG);
    return { key: read.key, owner: read.owner ?? null, unproven: unproven && !read.owner, ...this.filesOf(tag) };
  }

  /**
   * The copy's key from before keys noted their account: it is the one signed in now, which it was used with. With no one
   * signed in, it is noted as unproven when this PC was used signed in, so a later start doesn't give it to whoever is then.
   */
  private async noteOwner(read: OpenedKey): Promise<void> {
    if (read.owner !== undefined || !this.main) return;
    const who = this.options.account();
    if (who !== null) {
      await this.write(this.main, read.key, who, false, this.generation, who).catch(() => undefined);
      await this.provenSeen(who);
    } else {
      await this.write(this.main, read.key, null, await this.usedSignedIn(), this.generation, null).catch(() => undefined);
    }
  }

  /** Runs one change after every change asked for before it (and before every one asked after). */
  private serial<T>(change: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(change);
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * Instead of a new key for `who`, while a key file that may hold one can't be opened (held, its data doesn't open here,
   * or a newer Tavora's): the recovery key is asked for, and `keyBlocked` says why. Null when a new one may be made.
   */
  private noNewKey(who: string | null): KeySetUp | null {
    const blocked = this.mayHold(who);
    if (!blocked) return null;
    this.log(`account key: ${path.basename(blocked.file)} couldn't be opened (${blocked.reason}), so no new key is made`);
    return { status: "ask" };
  }

  /** A key that belongs to no account yet, which the first account to use it may take (claim). */
  private adoptable(slot: Slot | null): boolean {
    return slot !== null && slot.owner === null && !slot.unproven;
  }

  /** `who`'s own kept key, or null. */
  private ownSlot(who: string): Slot | null {
    if (this.main?.owner === who) return this.main;
    for (const slot of this.others.values()) if (slot.owner === who) return slot;
    return null;
  }

  /**
   * Where a key of `who`'s goes: where it is kept; else the copy's files when they hold none, else `who`'s own. Files a
   * new place still holds (ones this run couldn't open: a newer Tavora's, or sealed by another user) move aside first.
   */
  private async freePlace(who: string, key?: Buffer): Promise<Files> {
    const own = this.ownSlot(who);
    if (own) return own;
    const place = this.main || this.mainBlocked ? this.filesOf(this.tagOf(who)) : { keyFile: this.options.file, cacheFile: this.options.cacheFile };
    await this.setAside(place, key);
    return place;
  }

  /** The keys whose account isn't known. */
  private unprovenSlots(): Slot[] {
    return [this.main, ...this.others.values()].filter((item): item is Slot => item !== null && item.unproven);
  }

  /**
   * The key for `who`, signed in: its own; else the copy's key of no account, when `who` has no vault yet or its vault
   * opens with it (else it stays of no account); else an unproven one its vault opens with. Null when this PC has none
   * for `who` (another account's stays). Offline, only its own: whose another one is can't be told (the request throws).
   */
  private async claim(who: string, generation: number): Promise<Slot | null> {
    const own = this.ownSlot(who);
    if (own) {
      await this.touch(own);
      return own;
    }
    if (!this.adoptable(this.main) && this.unprovenSlots().length === 0) return null;
    const vault = await this.vault(who);
    // Another claim took one while the vault came.
    const meanwhile = this.ownSlot(who);
    if (meanwhile) return meanwhile;
    const main = this.main;
    if (main && this.adoptable(main) && (!vault || opens(main.key, vault.data))) return this.write(main, main.key, who, false, generation, who);
    const proven = vault ? this.unprovenSlots().find((item) => opens(item.key, vault.data)) : undefined;
    return proven ? this.adoptUnproven(proven, who, generation) : null;
  }

  /** An unproven key (or one moved aside without an account) is `who`'s: it goes to `who`'s files with what it last read. */
  private async adoptUnproven(slot: Slot, who: string, generation: number): Promise<Slot> {
    let adopted: Slot;
    if (slot === this.main) adopted = await this.write(slot, slot.key, who, false, generation, who);
    else {
      const files = this.filesOf(this.tagOf(who));
      await this.setAside(files);
      adopted = await this.write(files, slot.key, who, false, generation, who);
      if (slot.cacheFile && files.cacheFile) await rename(slot.cacheFile, files.cacheFile).catch(() => undefined);
      await forgetSealedFile(slot.keyFile);
      for (const [tag, item] of this.others) if (item === slot) this.others.delete(tag);
    }
    await this.provenSeen(who);
    return adopted;
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
  private async putBack(who: string, key: Buffer): Promise<VaultTrouble | null> {
    const cached = await this.cached(who, key);
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
   * Whether this PC has seen `who`'s vault: in this run, or before (the seen file names the accounts; or a vault it
   * kept). A seen file from before it named accounts says only that a vault was seen: it counts while no key here can be
   * that vault's other than `who`'s (an unproven key's account is unknown, and an account that never proved it isn't it).
   */
  private async seen(who: string): Promise<boolean> {
    if (this.sawVault === who) return true;
    const marks = await this.seenMarks();
    const own = this.ownSlot(who);
    const legacy = marks.includes(SEEN_BEFORE_ACCOUNTS) && this.unprovenSlots().length === 0 && (!this.main || this.main.owner === null || this.main.owner === who);
    const seen = marks.includes(who) || legacy || (own !== null && (await this.cached(who, own.key)) !== null);
    if (seen) this.sawVault = who;
    return seen;
  }

  /** The seen file's lines: account ids, or "1" in a file from before it named them. */
  private async seenMarks(): Promise<string[]> {
    if (!this.options.seenFile) return [];
    const text = await readFile(this.options.seenFile, "utf8").catch(() => null);
    return text === null ? [] : text.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  /**
   * Changes the seen file one change at a time: each reads what the one before wrote, so two that overlap (a sign-in's
   * own read and a refresh) can't drop each other's mark. `change` answers the new lines, `"forget"` to delete the file,
   * or null to leave it.
   */
  private changeSeen(change: (marks: string[]) => string[] | "forget" | null): Promise<void> {
    const seenFile = this.options.seenFile;
    if (!seenFile) return Promise.resolve();
    const turn = this.seenTurn.then(async () => {
      const next = change(await this.seenMarks());
      if (next === "forget") await forgetSealedFile(seenFile);
      else if (next) await writeFileAtomic(seenFile, next.slice(-MAX_SEEN).join("\n")).catch(() => undefined);
    });
    this.seenTurn = turn.catch(() => undefined);
    return turn;
  }

  /** A key from before keys noted their account is `who`'s: the seen file's "1" was `who`'s vault. */
  private provenSeen(who: string): Promise<void> {
    return this.changeSeen((marks) => (marks.includes(SEEN_BEFORE_ACCOUNTS) ? [...new Set(marks.map((mark) => (mark === SEEN_BEFORE_ACCOUNTS ? who : mark)))] : null));
  }

  /** Whether this PC was used signed in: it saw a vault, or kept one. */
  private async usedSignedIn(): Promise<boolean> {
    for (const file of [this.options.seenFile, this.options.cacheFile]) if (file && (await exists(file))) return true;
    return false;
  }

  private async markSeen(who: string): Promise<void> {
    if (this.sawVault === who) return;
    this.sawVault = who;
    await this.changeSeen((marks) => (marks.includes(who) ? null : [...marks, who]));
  }

  /** Where `who`'s vault as last read under `key` is kept now (looked up again each time: useForCopy may move it). */
  private cacheOf(who: string, key: Buffer): string | undefined {
    const slot = this.ownSlot(who) ?? (this.adoptable(this.main) ? this.main : null);
    return slot && slot.key.equals(key) ? slot.cacheFile : undefined;
  }

  private async cached(who: string, key: Buffer): Promise<VaultContent | null> {
    const file = this.cacheOf(who, key);
    if (!file) return null;
    const sealed = await readVault(file);
    // One that can't be read right now is not taken for missing: nothing is made anew in its place.
    if (sealed === HELD) throw new CopyError("failed", "the vault as last read can't be read right now");
    return sealed ? openContent(key, sealed) : null;
  }

  /** Keeps `sealed` as `who`'s vault as last read under `key`; `fallback` for a key not kept yet (setUp, startOver). */
  private async keepFor(who: string, key: Buffer, sealed: Uint8Array, fallback?: string): Promise<void> {
    const file = this.cacheOf(who, key) ?? fallback;
    if (file) await writeFileAtomic(file, Buffer.from(sealed)).catch(() => undefined);
  }

  /** Signed out: a key for the cloud copy. The copy's key before, when it is another, moves aside first (moveAside). */
  private async saveHere(key: Buffer, owner: string | null): Promise<void> {
    if (this.mainBlocked) await this.moveBlockedAside();
    const main = this.main;
    if (main && !main.key.equals(key)) await this.moveAside(main);
    await this.write({ keyFile: this.options.file, cacheFile: this.options.cacheFile }, key, owner, false, this.generation, null);
  }

  /**
   * The copy's key moves aside with the vault it last read: an account's to that account's own files, one of no account
   * or an unknown one to a free account-key.unproven*.json (taken by the account whose vault opens with it).
   */
  private async moveAside(main: Slot): Promise<void> {
    const tag = main.owner !== null ? this.tagOf(main.owner) : await this.freeTag(UNPROVEN_TAG);
    const files = this.filesOf(tag);
    await this.pruneOthers(tag);
    // Never onto a file that is there (one this run couldn't open): it moves aside first.
    await this.setAside(files);
    await rename(main.keyFile, files.keyFile);
    if (main.cacheFile && files.cacheFile) {
      await rename(main.cacheFile, files.cacheFile).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") await forgetSealedFile(files.cacheFile!);
        else throw error;
      });
    }
    // Moved aside, a key of no account is no longer taken by the first account to use it: only by proof.
    this.others.set(tag, { ...main, ...files, unproven: main.owner === null });
    this.main = null;
  }

  /** account-key.json can't be opened in this run: it moves aside as it is (read again at the next start), never written over. */
  private async moveBlockedAside(): Promise<void> {
    await this.setAside({ keyFile: this.options.file, cacheFile: this.options.cacheFile });
    this.mainBlocked = false;
    if (this.mainHold?.file === this.options.file) this.mainHold = null;
  }

  /**
   * Files at a place no kept key has (a key file this run couldn't open, a vault as last read without its key, unless
   * `keeps` opens it) move aside together, as they are, to a free account-key.unopened*.json and account-vault.unopened*.bin: read again at the
   * next start, never written over.
   */
  private async setAside(place: Files, keeps?: Buffer): Promise<void> {
    const key = await exists(place.keyFile);
    // A vault as last read that opens with the key going there is that key's: it stays. One that can't be read right
    // now isn't known to be, so it moves aside (or, still held, stops this).
    const sealed = place.cacheFile ? await readVault(place.cacheFile) : null;
    const cache = sealed === HELD || (sealed !== null && !(keeps && opens(keeps, sealed)));
    if (!key && !cache) return;
    const tag = await this.freeTag(UNOPENED_TAG);
    const to = this.filesOf(tag);
    // Moved, never removed: one that can't even be moved stops what was asked, and the user is told so.
    const stuck = (error: unknown) => {
      this.log(`account key: ${path.basename(place.keyFile)} couldn't be moved aside: ${error instanceof Error ? error.message : String(error)}`);
      throw new UserError("cloudCopy.error.keyStuck");
    };
    if (key) await rename(place.keyFile, to.keyFile).catch(stuck);
    if (cache && to.cacheFile) await rename(place.cacheFile!, to.cacheFile).catch(stuck);
    // Still not opened where it is now: it still keeps a new key from being made in its stead.
    const was = this.mainHold?.file === place.keyFile ? this.mainHold : [...this.othersHold.values()].find((item) => item.file === place.keyFile);
    if (key && was) {
      if (this.mainHold === was) this.mainHold = null;
      for (const [other, item] of this.othersHold) if (item === was) this.othersHold.delete(other);
      this.othersHold.set(tag, { ...was, file: to.keyFile });
    }
    this.log(`account key: ${path.basename(key ? place.keyFile : place.cacheFile!)} couldn't be opened; kept as ${path.basename(key ? to.keyFile : to.cacheFile!)}`);
  }

  /** `base`, or `base-2`, `base-3`, … : the first tag no key file has. */
  private async freeTag(base: string): Promise<string> {
    for (let number = 1; ; number++) {
      const tag = number === 1 ? base : `${base}-${number}`;
      const files = this.filesOf(tag);
      if (!this.others.has(tag) && !(await exists(files.keyFile)) && !(files.cacheFile && (await exists(files.cacheFile)))) return tag;
    }
  }

  /** Notes that a kept key was used, once a run (pruneOthers keeps the ones used last). */
  private async touch(slot: Slot): Promise<void> {
    if (slot === this.main || this.touched.has(slot.keyFile)) return;
    this.touched.add(slot.keyFile);
    const now = new Date();
    await utimes(slot.keyFile, now, now).catch(() => undefined);
  }

  /**
   * Room for one more other account's key: the one used longest ago goes, but never an unproven one, nor one whose vault
   * as last read holds publisher keys (it may be the only copy left, when the account's vault went missing). With none
   * to let go, all stay.
   */
  private async pruneOthers(adding: string): Promise<void> {
    const max = this.options.maxOtherKeys ?? MAX_OTHER_KEYS;
    if (this.others.has(adding) || this.others.size < max) return;
    const candidates: { tag: string; slot: Slot; at: number }[] = [];
    for (const [tag, slot] of this.others) {
      if (slot.unproven || slot.owner === null) continue;
      const sealed = slot.cacheFile ? await readVault(slot.cacheFile) : null;
      // One that can't be read right now may hold publisher keys: it stays.
      if (sealed === HELD || (sealed && openContent(slot.key, sealed)?.publisherKeys?.length)) continue;
      candidates.push({ tag, slot, at: (await stat(slot.keyFile).catch(() => null))?.mtimeMs ?? 0 });
    }
    const oldest = candidates.sort((a, b) => a.at - b.at)[0];
    if (!oldest) {
      this.log(`account key: keeping ${this.others.size + 1} keys of other accounts, none can go`);
      return;
    }
    this.others.delete(oldest.tag);
    await forgetSealedFile(oldest.slot.keyFile);
    if (oldest.slot.cacheFile) await forgetSealedFile(oldest.slot.cacheFile);
    this.log(`account key: the key of an account not signed in here for the longest time was removed (${path.basename(oldest.slot.keyFile)})`);
  }

  /**
   * Keeps `key` in `place` as `owner`'s, unless it was forgotten since `generation` (signed out meanwhile) or the account
   * signed in is no longer `who`: then it is not kept. Answers the slot it is in now.
   */
  private async write(place: Files, key: Buffer, owner: string | null, unproven: boolean, generation: number, who: string | null): Promise<Slot> {
    if (!this.canKeep) throw new UserError("cloudCopy.error.cantKeep");
    const stale = () => generation !== this.generation || this.options.account() !== who;
    if (stale()) throw new CopyError("signed-out");
    const isMain = place.keyFile === this.options.file;
    // A key file this run couldn't open is never written over.
    if (isMain && this.mainBlocked) throw new CopyError("failed", "the key file can't be opened");
    const tag = isMain ? null : this.tagOfFile(path.basename(place.keyFile))!;
    if (tag !== null) await this.pruneOthers(tag);
    const data = (await this.options.encryptor.encrypt(key.toString("base64"))).toString("base64");
    // `account` and `unproven` sit next to the sealed key: older Tavoras read only `v` and `data`. A file there that
    // can't be read right now is never written over (sealed-file.ts).
    await new SealedFile(place.keyFile).write({ data, account: owner, ...(unproven ? { unproven } : {}) });
    if (stale()) {
      await rm(place.keyFile, { force: true });
      throw new CopyError("signed-out");
    }
    const slot: Slot = { key, owner, unproven, keyFile: place.keyFile, cacheFile: place.cacheFile };
    if (isMain) this.main = slot;
    else this.others.set(tag!, slot);
    return slot;
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  /** A file-name-safe tag for an account (never one of the tags for keys moved aside). */
  private tagOf(account: string): string {
    const safe = /^[A-Za-z0-9_-]{1,64}$/.test(account) && !account.startsWith(UNPROVEN_TAG) && !account.startsWith(UNOPENED_TAG);
    return safe ? account : createHash("sha256").update(account).digest("hex").slice(0, 32);
  }

  /** The files of the key kept under `tag`, next to the copy's (account-key.<tag>.json, account-vault.<tag>.bin). */
  private filesOf(tag: string): Files {
    const cache = this.options.cacheFile;
    return { keyFile: withTag(this.options.file, tag), cacheFile: cache ? withTag(cache, tag) : undefined };
  }

  /** The tag of another account's key file, or null for any other file. */
  private tagOfFile(name: string): string | null {
    const base = path.basename(this.options.file);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
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

  /** `who`'s vault on the service, or null when it has none. Kept as the last read under `key` only when it opens it. */
  private async vault(who: string, key?: Buffer | null): Promise<{ version: number; data: Uint8Array } | null> {
    const response = await this.request(who, "GET");
    if (response.status === 404) return null;
    const version = Number(response.headers.get("x-vault-version"));
    if (!response.ok || !Number.isInteger(version) || version < 1) throw new CopyError("failed", `the vault answered ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    // Signed in as another account while it came: it is not noted as theirs.
    if (this.options.account() !== who) throw new CopyError("signed-out");
    await this.markSeen(who);
    if (key && opens(key, data)) await this.keepFor(who, key, data);
    return { version, data };
  }

  /**
   * Stores `who`'s vault's content sealed with `key`, made from version `base`. False when another PC changed it first.
   * `cacheFile`: where its last read goes while the key isn't kept yet.
   */
  private async putVault(who: string, base: number, key: Buffer, content: VaultContent, cacheFile?: string): Promise<boolean> {
    const generation = this.generation;
    const sealed = sealVault(key, Buffer.from(JSON.stringify(content)));
    const body = Buffer.alloc(4 + sealed.length);
    body.writeUInt32BE(base);
    sealed.copy(body, 4);
    const response = await this.request(who, "PUT", body);
    if (response.status === 409) return false;
    if (response.status === 413) throw new CopyError("failed", "the vault is full");
    if (!response.ok) throw new CopyError("failed", `the vault answered ${response.status}`);
    // Signed out (or in as another account) while it went up: nothing of it is noted on this PC.
    if (generation !== this.generation || this.options.account() !== who) throw new CopyError("signed-out");
    await this.markSeen(who);
    await this.keepFor(who, key, sealed, cacheFile);
    return true;
  }
}

/** `account-key.json` → `account-key.<tag>.json`. */
function withTag(file: string, tag: string): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${tag}${ext}`;
}

/** Whether a file is there: one that can't be looked at right now counts as there. */
function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
  );
}

/** A vault as last read that is there but can't be read right now. */
const HELD = Symbol("held");

/** A vault as last read: its bytes, null when missing, HELD when it can't be read right now. */
function readVault(file: string): Promise<Buffer | null | typeof HELD> {
  return readFile(file).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : HELD));
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

/** A key file as read: its key and the account it belongs to, missing, or one this run can't open (Blocked). */
type OpenedKey = { status: "opened"; key: Buffer; owner: string | null | undefined; unproven: boolean };
type KeyRead = OpenedKey | { status: "missing" } | ({ status: "blocked" } & Blocked);

/** The account a key's record names: null for none yet, undefined in a file from before keys noted it (or unreadable). */
function ownerOf(owner: unknown): string | null | undefined {
  return typeof owner === "string" && owner.length > 0 ? owner : owner === null ? null : undefined;
}

/**
 * A kept key and the account it belongs to: null for none yet, undefined in a file from before keys noted it (or one
 * whose note can't be read: it is treated the same). `unproven`: see the header. Missing, or damaged (set aside), is
 * missing; one that can't be read right now, a newer Tavora's (copied aside), or one sealed by another user or PC is
 * blocked, and stays where it is.
 */
async function readKey(file: string, encryptor: Encryptor): Promise<KeyRead> {
  if (!(await encryptor.ready())) return (await exists(file)) ? { status: "blocked", file, reason: "unopened", owner: undefined } : { status: "missing" };
  const read = await new SealedFile(file).open(async (data, saved) => {
    const key = Buffer.from(await encryptor.decrypt(Buffer.from(data, "base64")), "base64");
    if (key.length !== 32) throw new Error("not a key");
    return { key, owner: ownerOf(saved.account), unproven: saved.unproven === true };
  });
  switch (read.status) {
    case "opened":
      return { status: "opened", ...read.value };
    case "missing":
      return { status: "missing" };
    case "held":
      return { status: "blocked", file, reason: "held", owner: undefined };
    default:
      return { status: "blocked", file, reason: read.status, owner: ownerOf(read.saved.account) };
  }
}
