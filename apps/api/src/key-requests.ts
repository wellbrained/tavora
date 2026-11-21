import type { Revocation, Succession } from "@tavora/pack";
import type { AccountStore, KeyRequest } from "./account-store.ts";
import type { CatalogStore } from "./catalog.ts";
import type { CatalogTrust } from "./catalog-trust.ts";

/**
 * "I lost this key": a developer asks in the app to replace a linked publisher key with another key of
 * the same account (account-store.ts keeps the request). The service never signs anything: the review
 * page exports the waiting requests as entries for `tavora-catalog-sign`, the maintainer signs them
 * offline with the catalogue key and uploads the lists as before (catalog threat model, C2, C6, C7).
 * A request is done once the served, validly signed lists hold it.
 */

export type KeyRequestStatus = "waiting" | "done" | "declined";

/** Where a request stands: turned down, signed into the lists, or still waiting. */
export function keyRequestStatus(request: KeyRequest, trust: CatalogTrust | null): KeyRequestStatus {
  if (request.declinedAt !== null) return "declined";
  if (!trust) return "waiting";
  const succeeded = trust.signed("successions")?.successions.some((entry) => entry.old === request.old && entry.new === request.new && entry.account === request.accountId) ?? false;
  const revoked = !request.leaked || (trust.signed("revocations")?.revoked.some((entry) => entry.fingerprint === request.old) ?? false);
  return succeeded && revoked ? "done" : "waiting";
}

/** Whether the served, validly signed revocation list revokes this key. */
export function signedRevoked(fingerprint: string, trust: CatalogTrust | null): boolean {
  return trust?.signed("revocations")?.revoked.some((entry) => entry.fingerprint === fingerprint) ?? false;
}

/** A moment as the signed lists write it: whole seconds, UTC. */
const listDate = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Every succession to sign next: the ones in force now, then each waiting request not in them yet. */
export function successionEntries(store: AccountStore, trust: CatalogTrust | null): Succession[] {
  const entries = [...(trust?.signed("successions")?.successions ?? [])];
  for (const request of store.allKeyRequests()) {
    if (keyRequestStatus(request, trust) !== "waiting") continue;
    if (!entries.some((entry) => entry.old === request.old && entry.new === request.new && entry.account === request.accountId)) {
      entries.push({ old: request.old, new: request.new, account: request.accountId });
    }
  }
  return entries;
}

/**
 * Every revocation to sign next: the ones in force now, then each waiting leaked key, then each leaked key
 * whose request went with the key's link or its account (leaked_keys). A new one allows the zips the catalog
 * took from that key before it was reported as leaked, so users keep what they installed; the maintainer takes
 * out any that look wrong before signing.
 */
export function revocationEntries(store: AccountStore, trust: CatalogTrust | null, catalog: CatalogStore | undefined): Revocation[] {
  const entries = [...(trust?.signed("revocations")?.revoked ?? [])];
  const add = (fingerprint: string, reportedAt: number) => {
    if (entries.some((entry) => entry.fingerprint === fingerprint)) return;
    entries.push({ fingerprint, revoked: listDate(reportedAt), allow: catalog?.signedBy(fingerprint, new Date(reportedAt)) ?? [] });
  };
  for (const request of store.allKeyRequests()) {
    if (request.leaked && keyRequestStatus(request, trust) === "waiting") add(request.old, request.leakedAt ?? request.requestedAt);
  }
  for (const leaked of store.leakedKeys()) add(leaked.fingerprint, leaked.requestedAt);
  return entries;
}
