import type { AccountView, DeveloperKeysView } from "../shared/host-api";

/**
 * Whether publishing is set up: signed in, with a developer name and a publisher key Tavora keeps that is
 * linked to the account. "unknown" while the account, its developer side (read at start, quietly; offline
 * leaves it unread) or the kept keys aren't read yet, so nothing claims it isn't set up before we know.
 */
export function developerSetup(view: AccountView | null, keys: DeveloperKeysView | null): "ready" | "missing" | "unknown" {
  if (!view) return "unknown";
  if (!view.account) return "missing";
  if (view.publisherKeys === null || !keys || keys.status === "loading" || keys.status === "offline" || keys.status === "signed-out") return "unknown";
  if (!view.developer || keys.status !== "ready") return "missing";
  const linked = new Set(view.publisherKeys.map((key) => key.fingerprint));
  return keys.keys.some((key) => linked.has(key.fingerprint)) ? "ready" : "missing";
}
