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
  return {
    delete(accountId: string, now: number): void {
      accounts.deleteAccount(accountId, now);
      copies?.remove(accountId, true);
      reviews?.forget(accountId);
      conversations?.forget(accountId, now);
      leaderboards?.forget(accountId);
      catalog?.forgetReporter(accountId);
      icons?.forgetSender(accountId);
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

    /** Needs the catalog: a ban is about publishing. */
    ban(accountId: string, reason: string, note: string | null, now: number): { unlisted: string[]; declined: number; closedConversations: number } {
      if (!catalog) throw new Error("A ban needs the module catalog.");
      const keys = accounts.keys(accountId).map((key) => key.fingerprint);
      let declined = 0;
      for (const waiting of catalog.waitingVersions().filter((version) => version.accountId === accountId)) {
        catalog.recordDeclined(waiting, reason, note, new Date(now));
        catalog.removeWaiting(waiting.sha256);
        declined++;
      }
      const unlisted = catalog.unlistAll(catalog.modulesOfAccount(accountId, keys));
      accounts.ban(accountId, reason, note, unlisted, now);
      const closedConversations = conversations?.closeForBannedDeveloper(accountId, now) ?? 0;
      return { unlisted, declined, closedConversations };
    },

    /** The modules the ban unlisted come back, nothing else; null when the account wasn't banned. */
    unban(accountId: string): { relisted: string[] } | null {
      if (!catalog) throw new Error("A ban needs the module catalog.");
      const modules = accounts.unban(accountId);
      if (modules === null) return null;
      return { relisted: modules.filter((id) => catalog.setListed(id, true)) };
    },
  };
}

export type AccountLifecycle = ReturnType<typeof accountLifecycle>;
