import type { AccountView } from "../shared/host-api";
import { suggestPrefix } from "../shared/id-prefix";
import type { AccountClient } from "./account";
import type { CopySync } from "./cloud-copy-sync";
import type { DeveloperKeys } from "./developer-keys";
import type { FileDialogs } from "./file-dialogs";
import type { Inbox } from "./inbox";
import { UserError } from "./messages";
import { ownKeys } from "./own-keys";

export interface AccountFlowsOptions {
  account: Pick<AccountClient, "view" | "accountId" | "token" | "signOut" | "deleteAccount" | "deleteWithDiscord" | "setDeveloperName" | "checkPrefix" | "claimPrefix" | "replaceKey">;
  /** The account the saved sign-in is for (sign-in.ts), whether or not this build has accounts on. */
  signInId: () => string | null;
  /** The messages; told only when being signed in changes. */
  inbox: Pick<Inbox, "accountChanged">;
  developerKeys: Pick<DeveloperKeys, "accountChanged" | "view" | "create" | "replacementFor">;
  copy: Pick<CopySync, "accountChanged" | "signedOut" | "turnOn" | "move">;
  dialogs: Pick<FileDialogs, "pick" | "remember">;
  /** Whether the user allows the online features (Settings > Online). */
  online: () => boolean;
}

/**
 * What follows the Tavora account in the rest of the app: the messages, publisher keys and cloud copy hear which account
 * is signed in (which one, not only whether one, so what was read for one is never shown to another); signing out or
 * deleting it lets the cloud copy forget only that account's key; a first-time developer gets a prefix and a publisher
 * key; a lost key is replaced; messages need a sign-in and the online features; and the cloud copy's own folder is
 * picked here.
 */
export class AccountFlows {
  private inboxSignedIn = false;

  constructor(private readonly options: AccountFlowsOptions) {}

  /** The account's view changed: the messages, the publisher keys and the cloud copy follow it. */
  changed(view: AccountView): void {
    const signedIn = view.account !== null;
    if (this.inboxSignedIn !== signedIn) {
      this.inboxSignedIn = signedIn;
      this.options.inbox.accountChanged(signedIn);
    }
    const accountId = signedIn ? this.options.signInId() : null;
    this.options.developerKeys.accountChanged(accountId);
    this.options.copy.accountChanged(accountId);
  }

  /** Signs out; the cloud copy then forgets the key of the account that signed out, read before its sign-in goes. */
  async signOut(): Promise<void> {
    const who = this.options.account.accountId();
    await this.options.account.signOut();
    return this.options.copy.signedOut(who);
  }

  /** Deletes the account with the code sent to its email, then lets the cloud copy forget its key. */
  async delete(code: string): Promise<void> {
    const who = this.options.account.accountId();
    await this.options.account.deleteAccount(code);
    return this.options.copy.signedOut(who);
  }

  /** Deletes an account that signs in with Discord; the cloud copy forgets its key once it is gone. */
  async deleteWithDiscord(): Promise<void> {
    const { account } = this.options;
    const who = account.accountId();
    await account.deleteWithDiscord();
    if (!account.view().account) await this.options.copy.signedOut(who);
  }

  /**
   * Sets the developer name. A first-time developer gets the prefix of the name with it (WellBrained: wellbrained) when
   * it is free; when it isn't, the check stays on screen to pick another. And a publisher key: Tavora makes, keeps and
   * links it, and the recovery key is shown. One with a key already (kept, linked, or paused) gets none.
   */
  async setDeveloperName(name: string): Promise<void> {
    const { account, developerKeys } = this.options;
    await account.setDeveloperName(name);
    const prefix = suggestPrefix(name);
    if (prefix && account.view().prefixes?.held.length === 0) {
      if ((await account.checkPrefix(prefix).catch(() => null)) === "free") await account.claimPrefix(prefix).catch(() => undefined);
    }
    const keys = developerKeys.view();
    // Paused keys count as keys: they are linked again, never replaced by a new one.
    if ((keys.status === "ready" || keys.status === "none") && !keys.keys.length && ownKeys(account.view()).length === 0) {
      // Another PC keeps the account's key: its recovery key is asked for on screen, then a key is made there.
      await developerKeys.create().catch(() => undefined);
    }
  }

  /**
   * Moves a lost or leaked key's modules to another key. The old key may be a paused one whose file is lost (audit
   * 2026-11-22); the new one is a key linked and working, or one made for it.
   */
  async replaceKey(fingerprint: string, leaked: boolean): Promise<void> {
    const { account } = this.options;
    if (!ownKeys(account.view()).includes(fingerprint)) throw new UserError("account.error.keyGone");
    const linked = (account.view().publisherKeys ?? []).map((key) => key.fingerprint);
    const next = await this.options.developerKeys.replacementFor(fingerprint, linked);
    return account.replaceKey(fingerprint, next, leaked);
  }

  /** A messages action: the online features must be on, and the user needs a sign-in. */
  async messages<T>(run: () => Promise<T>): Promise<T> {
    if (!this.options.online()) throw new UserError("error.catalogOff");
    if (!this.options.account.token()) throw new UserError("account.error.signedOut");
    return run();
  }

  /** Turns the cloud copy on in a folder the user picks; nothing when the dialog is closed. */
  async turnOnInFolder(): Promise<void> {
    const folder = await this.pickFolder();
    if (!folder) return;
    await this.options.copy.turnOn(folder);
    this.options.dialogs.remember("cloud-copy", folder);
  }

  /** Moves the cloud copy to Tavora's service, or to a folder the user picks (nothing when the dialog is closed). */
  async moveCopy(to: "server" | "folder"): Promise<void> {
    if (to === "server") return this.options.copy.move(null);
    const folder = await this.pickFolder();
    if (!folder) return;
    await this.options.copy.move(folder);
    this.options.dialogs.remember("cloud-copy", folder);
  }

  private pickFolder(): Promise<string | undefined> {
    return this.options.dialogs.pick("cloud-copy", { properties: ["openDirectory", "createDirectory"] });
  }
}
