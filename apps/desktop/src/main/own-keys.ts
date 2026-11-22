import type { AccountView } from "../shared/host-api";

/**
 * The fingerprints of every publisher key the account has: linked ones and paused ones (audit 2026-11-22). A paused key
 * (the email changed, a device was removed) signs nothing until it is linked again, but it is still the account's: its
 * modules stay its own, and it is linked again, never replaced by a new key.
 */
export function ownKeys(view: Pick<AccountView, "publisherKeys" | "pausedKeys">): string[] {
  return [...(view.publisherKeys ?? []), ...(view.pausedKeys ?? [])].map((key) => key.fingerprint);
}
