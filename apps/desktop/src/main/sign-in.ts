import type { SavedAccount } from "./account";
import { sha256Hex } from "./hash";

export interface SignInOptions {
  /** False in release builds until accounts go live: nothing is loaded and no token is ever given. */
  enabled: boolean;
  load: () => Promise<SavedAccount | null>;
  save: (account: SavedAccount | null) => Promise<void>;
}

/**
 * The account's saved sign-in, apart from the account client around it: whoever needs the token (the cloud copy,
 * pairing, the account's own calls) holds this, so the sign-in can be read at start, before the window and the
 * library the client works with exist.
 */
export class SignIn {
  private saved: SavedAccount | null = null;
  /** Raised whenever the sign-in is set, so a read that started before a sign-in or sign-out doesn't undo it. */
  private changes = 0;

  constructor(private readonly options: SignInOptions) {}

  /** Reads the saved sign-in; later calls read it again. */
  async load(): Promise<void> {
    this.saved = this.options.enabled ? await this.options.load() : null;
  }

  /**
   * Reads the saved sign-in again when there is none (the key store answered late). A sign-in made meanwhile stays; true
   * when one was found.
   */
  async loadIfSignedOut(): Promise<boolean> {
    if (!this.options.enabled || this.saved) return false;
    const before = this.changes;
    const read = await this.options.load();
    if (this.saved || !read || this.changes !== before) return false;
    this.saved = read;
    return true;
  }

  get current(): SavedAccount | null {
    return this.saved;
  }

  set current(account: SavedAccount | null) {
    this.changes++;
    this.saved = account;
  }

  /** The token for the service, or null when signed out (or accounts are off). */
  token(): string | null {
    return this.saved?.token ?? null;
  }

  /** The account signed in (accountIdOf), or null when signed out. */
  id(): string | null {
    return this.saved ? accountIdOf(this.saved) : null;
  }

  /** Writes the sign-in down (null removes the file). */
  persist(account: SavedAccount | null): Promise<void> {
    return this.options.save(account);
  }
}

/**
 * The account a sign-in is for, as this PC tells accounts apart (the account's key belongs to one: account-key.ts). The
 * service sends no id, but an account's creation time never changes, also when its email or Discord login does.
 */
export function accountIdOf(account: Pick<SavedAccount, "createdAt">): string {
  const time = Date.parse(account.createdAt);
  const created = Number.isFinite(time) ? new Date(time).toISOString() : account.createdAt;
  return sha256Hex(`tavora-account:${created}`).slice(0, 32);
}
