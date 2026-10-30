import type { SavedAccount } from "./account";

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

  constructor(private readonly options: SignInOptions) {}

  /** Reads the saved sign-in; later calls read it again. */
  async load(): Promise<void> {
    this.saved = this.options.enabled ? await this.options.load() : null;
  }

  get current(): SavedAccount | null {
    return this.saved;
  }

  set current(account: SavedAccount | null) {
    this.saved = account;
  }

  /** The token for the service, or null when signed out (or accounts are off). */
  token(): string | null {
    return this.saved?.token ?? null;
  }

  /** Writes the sign-in down (null removes the file). */
  persist(account: SavedAccount | null): Promise<void> {
    return this.options.save(account);
  }
}
