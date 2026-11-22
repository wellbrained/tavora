import type { AccountView, DeveloperKeysView } from "../shared/host-api";

/**
 * Whether publishing is set up: signed in, with a developer name and a publisher key Tavora keeps that is
 * linked to the account. "unknown" while the account, its developer side (read at start, quietly; offline
 * leaves it unread) or the kept keys aren't read yet, so nothing claims it isn't set up before we know.
 * "paused": the account has keys, but they were paused when it was taken back (a new email, a device removed):
 * they are linked again, never replaced by a new key.
 */
export function developerSetup(view: AccountView | null, keys: DeveloperKeysView | null): "ready" | "missing" | "paused" | "unknown" {
  if (!view) return "unknown";
  if (!view.account) return "missing";
  if (view.publisherKeys === null || !keys || keys.status === "loading" || keys.status === "offline" || keys.status === "signed-out") return "unknown";
  if (!view.developer) return "missing";
  const linked = new Set(view.publisherKeys.map((key) => key.fingerprint));
  if (keys.status === "ready" && keys.keys.some((key) => linked.has(key.fingerprint))) return "ready";
  return (view.pausedKeys?.length ?? 0) > 0 ? "paused" : "missing";
}
