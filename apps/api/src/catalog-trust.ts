import { firstKeyOf, isOfficialSigner, officialOn, OFFICIAL_PINS, type OfficialPins } from "@tavora/module-schema";
import { readCatalogList, type CatalogListKind, type CatalogListOf } from "@tavora/pack";
import type { CatalogStore } from "./catalog.ts";

/**
 * What the service takes from the lists signed offline with Tavora's catalogue key (C6, C7), for
 * uploads. It reads the stored files and checks each signature itself, so a list someone put on the
 * server without the catalogue key counts for nothing here either: a revoked key publishes nothing new,
 * and a successor key may publish the modules of the key it replaces, in the same account.
 */

/** Tavora's catalogue public key, the same as the app's (apps/desktop/src/main/safety-lists.ts). */
export const CATALOGUE_PUBLIC_KEY = "u44xg/sgGpnPfBN5o8n/xyBU5Xrv3G/ZJC20+phjWIU=";

export { officialOn, OFFICIAL_PINS, type OfficialPins };

export interface CatalogTrust {
  /** Whether a key is revoked and this zip is not one it signed before. */
  revoked(fingerprint: string, sha256: string): boolean;
  /** The first key of a key's account by its successions, and that account; the key itself and null without one. */
  firstKey(fingerprint: string): { key: string; account: string | null };
  /**
   * Whether a signer may publish `tavora.*` modules: its first key is the pinned key, every succession step on the way
   * belongs to the pinned account, and it is not revoked for this zip. Never with an empty pin.
   */
  officialSigner(fingerprint: string, sha256: string, pins: OfficialPins): boolean;
  /** The signed list of a kind as it is served, or null without a validly signed one. */
  signed<K extends CatalogListKind>(kind: K): CatalogListOf<K> | null;
}

export function catalogTrust(catalog: CatalogStore, publicKey: string = CATALOGUE_PUBLIC_KEY): CatalogTrust {
  const list = <K extends CatalogListKind>(kind: K): CatalogListOf<K> | null => {
    const bytes = catalog.list(kind);
    return bytes ? readCatalogList(kind, bytes.toString("utf8"), publicKey) : null;
  };
  const trust: CatalogTrust = {
    signed: list,
    revoked(fingerprint, sha256) {
      const revocation = list("revocations")?.revoked.find((entry) => entry.fingerprint === fingerprint);
      return revocation !== undefined && !revocation.allow.includes(sha256);
    },
    officialSigner(fingerprint, sha256, pins) {
      return isOfficialSigner(trust.firstKey(fingerprint), trust.revoked(fingerprint, sha256), pins);
    },
    // The same rules as the app's SafetyLists.firstKey (shared in module-schema), so the catalog lists what users' Tavora installs.
    firstKey: (fingerprint) => firstKeyOf(list("successions")?.successions ?? [], fingerprint),
  };
  return trust;
}
