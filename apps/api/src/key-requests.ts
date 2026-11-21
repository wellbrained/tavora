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

/** A version listed while nobody can say who held the key: the maintainer decides on it before signing. */
export interface UndecidedVersion {
  sha256: string;
  id: string;
  version: string;
  listedAt: string;
}

/** A revocation as exported; `decide` must be emptied by hand, and `tavora-catalog-sign` refuses the file until it is gone. */
export type RevocationDraft = Revocation & { decide?: UndecidedVersion[] };

/**
 * Every revocation to sign next: the ones in force now, then each waiting leaked key, then each leaked key
 * whose request went with the key's link or its account (leaked_keys). A new one allows the zips the catalog
 * took from that key before anyone asked about the key, so users keep what they installed. A version listed from
 * that request up to the leak report could be the developer's or a thief's, as the key still worked, so it is neither
 * allowed nor left out silently: it goes under `decide`. A report without a kept date has no known end, so that
 * stretch runs on to now.
 */
export function revocationEntries(store: AccountStore, trust: CatalogTrust | null, catalog: CatalogStore | undefined): RevocationDraft[] {
  const entries: RevocationDraft[] = [...(trust?.signed("revocations")?.revoked ?? [])];
  const add = (fingerprint: string, reportedAt: number, from: number, to: number | null) => {
    if (entries.some((entry) => entry.fingerprint === fingerprint)) return;
    const decide = from === to ? [] : (catalog?.signedBetween(fingerprint, new Date(from), to === null ? null : new Date(to)) ?? []);
    entries.push({ fingerprint, revoked: listDate(reportedAt), allow: catalog?.signedBy(fingerprint, new Date(from)) ?? [], ...(decide.length > 0 ? { decide } : {}) });
  };
  for (const request of store.allKeyRequests()) {
    if (request.leaked && keyRequestStatus(request, trust) === "waiting") add(request.old, request.leakedAt ?? request.requestedAt, request.requestedAt, request.leakedAt);
  }
  for (const leaked of store.leakedKeyWindows()) add(leaked.fingerprint, leaked.reportedAt, leaked.from, leaked.to);
  return entries;
}
