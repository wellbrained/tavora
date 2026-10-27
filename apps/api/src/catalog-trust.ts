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

/** Longest chain of successions followed, as in the app. */
const MAX_SUCCESSIONS = 16;

export interface CatalogTrust {
  /** Whether a key is revoked and this zip is not one it signed before. */
  revoked(fingerprint: string, sha256: string): boolean;
  /** The first key of a key's account by its successions, and that account; the key itself and null without one. */
  firstKey(fingerprint: string): { key: string; account: string | null };
  /** The signed list of a kind as it is served, or null without a validly signed one. */
  signed<K extends CatalogListKind>(kind: K): CatalogListOf<K> | null;
}

export function catalogTrust(catalog: CatalogStore, publicKey: string = CATALOGUE_PUBLIC_KEY): CatalogTrust {
  const list = <K extends CatalogListKind>(kind: K): CatalogListOf<K> | null => {
    const bytes = catalog.list(kind);
    return bytes ? readCatalogList(kind, bytes.toString("utf8"), publicKey) : null;
  };
  return {
    signed: list,
    revoked(fingerprint, sha256) {
      const revocation = list("revocations")?.revoked.find((entry) => entry.fingerprint === fingerprint);
      return revocation !== undefined && !revocation.allow.includes(sha256);
    },
    // The same rules as the app's SafetyLists.firstKey, so the catalog lists what users' Tavora installs.
    firstKey(fingerprint) {
      const statements = list("successions")?.successions ?? [];
      // A key named as the new key of two different old keys has no clear owner: neither is followed.
      const before = new Map<string, { old: string; account: string } | null>();
      for (const { old, new: next, account } of statements) {
        const known = before.get(next);
        before.set(next, known === undefined || (known?.old === old && known.account === account) ? { old, account } : null);
      }
      let key = fingerprint;
      let account: string | null = null;
      const seen = new Set([key]);
      for (let i = 0; i < MAX_SUCCESSIONS; i++) {
        const step = before.get(key);
        // Every step stays in the one account, and a loop goes nowhere.
        if (!step || (account !== null && step.account !== account) || seen.has(step.old)) break;
        account = step.account;
        key = step.old;
        seen.add(key);
      }
      return { key, account };
    },
  };
}
