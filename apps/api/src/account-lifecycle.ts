import type { AccountStore } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import type { CopyStore } from "./cloud-copy.ts";
import type { ConversationStore } from "./conversations.ts";
import type { IconState } from "./icon-state.ts";
import type { LeaderboardStore } from "./leaderboards.ts";
import type { ReviewStore } from "./reviews.ts";

/**
 * Every store that keeps something of an account. Each key must be named, even when the store is off, so a new
 * store can't be left out of delete, suspend and ban by accident (account-lifecycle.test.ts also checks server.ts).
 */
export interface AccountStores {
  accounts: AccountStore;
  catalog: CatalogStore | undefined;
  copies: CopyStore | undefined;
  reviews: ReviewStore | undefined;
  conversations: ConversationStore | undefined;
  leaderboards: LeaderboardStore | undefined;
  icons: IconState | undefined;
}

/**
 * What happens to one account across all stores (decided 2026-10-29):
 *
 * - **Delete** (the owner's choice, final): the account, its sign-ins, cloud copy, reviews, leaderboard results,
 *   reports, waiting icon offers and icon block go; its conversations close with `left` and lose its texts.
 * - **Suspend** (the maintainer, reversible): signed out everywhere and no sign-in, its reviews hidden, no
 *   publishing. Nobody can start a conversation with it; leaderboards leave it out. Unsuspend undoes exactly that.
 * - **Ban** (the maintainer, a developer): its keys publish nothing, waiting versions are declined, its modules are
 *   unlisted and its open developer conversations close (`tavora`). Its contact link is hidden and it can't reply to
 *   reviews or change the link; leaderboards leave it out. Unban lists the modules again; conversations stay closed.
 *
 * What is checked when read (who may start a conversation, the contact link, acting as publisher, leaderboards) looks
 * at the account's state, so nothing has to be written back on unsuspend or unban.
 */
export function accountLifecycle(stores: AccountStores) {
  const { accounts, catalog, copies, reviews, conversations, leaderboards, icons } = stores;
  /** The account's modules that are in the catalog and listed now. */
  const listedModules = (accountId: string): string[] =>
    catalog ? catalog.modulesOfAccount(accountId, accounts.keys(accountId).map((key) => key.fingerprint)).filter((id) => catalog.isListed(id)) : [];
  return {
    /** The account goes last: should a store fail before it, the account is still there and deleting it again finishes. */
    delete(accountId: string, now: number): void {
      copies?.remove(accountId, true);
      reviews?.forget(accountId);
      conversations?.forget(accountId, now);
      leaderboards?.forget(accountId);
      catalog?.forgetReporter(accountId);
      icons?.forgetSender(accountId);
      accounts.deleteAccount(accountId, now);
    },

    /** A retry of a suspension that already holds only finishes hiding the reviews: no new reason, nobody signed out twice. */
    suspend(accountId: string, reason: string, note: string | null, now: number): { already: boolean; signedOut: number; hiddenReviews: number } {
      const already = accounts.isSuspended(accountId);
      const signedOut = already ? 0 : accounts.suspend(accountId, reason, note, now);
      return { already, signedOut, hiddenReviews: reviews?.hideForSuspension(accountId) ?? 0 };
    },

    /** Safe to retry: the reviews the suspension hid come back even when the suspension is already gone. */
    unsuspend(accountId: string): { was: boolean; shownReviews: number } {
      const was = accounts.unsuspend(accountId);
      return { was, shownReviews: reviews?.showAfterSuspension(accountId) ?? 0 };
    },

    /**
     * Needs the catalog: a ban is about publishing. The ban, with the modules it is about to unlist, is written first, in
     * its own store: should a later step fail, the account is banned already, unban knows what to list again, and banning
     * again finishes (`banUnfinished`). The modules leave last, so a ban that didn't finish always has one still listed.
     */
    ban(accountId: string, reason: string, note: string | null, now: number): { unlisted: string[]; declined: number; closedConversations: number } {
      if (!catalog) throw new Error("A ban needs the module catalog.");
      const listed = listedModules(accountId);
      accounts.ban(accountId, reason, note, listed, now);
      const closedConversations = conversations?.closeForBannedDeveloper(accountId, now) ?? 0;
      let declined = 0;
      for (const waiting of catalog.waitingVersions().filter((version) => version.accountId === accountId)) {
        catalog.recordDeclined(waiting, reason, note, new Date(now));
        catalog.removeWaiting(waiting.sha256);
        declined++;
      }
      const unlisted = catalog.unlistAll(listed);
      return { unlisted, declined, closedConversations };
    },

    /** A banned account that still has a module listed or a version waiting: its ban stopped halfway. */
    banUnfinished(accountId: string): boolean {
      if (!catalog || !accounts.isBanned(accountId)) return false;
      return listedModules(accountId).length > 0 || catalog.waitingVersions().some((version) => version.accountId === accountId);
    },

    /** The modules the ban unlisted come back, nothing else; null when the account wasn't banned. The ban goes last, so a failed unban can be repeated. */
    unban(accountId: string): { relisted: string[] } | null {
      if (!catalog) throw new Error("A ban needs the module catalog.");
      const modules = accounts.bannedModules(accountId);
      if (modules === null) return null;
      const relisted = modules.filter((id) => catalog.setListed(id, true));
      accounts.unban(accountId);
      return { relisted };
    },
  };
}

export type AccountLifecycle = ReturnType<typeof accountLifecycle>;
