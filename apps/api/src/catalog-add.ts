import type { AccountStore } from "./account-store.ts";
import { CatalogError, checkCatalogZip, type CatalogStore, type CheckedZip } from "./catalog.ts";

export interface AddedByHand {
  added: CheckedZip;
  /** The account the module's id prefix was reserved for now, when its key is linked to one. */
  reservedFor: string | null;
  /** Nobody holds the prefix: the zip's key isn't linked to an account yet. */
  unheld: boolean;
}

/**
 * The maintainer adds a zip by hand (scripts/catalog.ts `add`). Its id prefix goes to the account
 * the zip's key is linked to, as a publish would reserve it, because holding a prefix makes an
 * account the publisher of every module under it. A prefix another account holds is refused.
 */
export function addByHand(catalog: CatalogStore, accounts: AccountStore | undefined, bytes: Buffer, now = new Date()): AddedByHand {
  const checked = checkCatalogZip(bytes);
  const prefix = checked.manifest.id.split(".")[0]!;
  const holder = accounts?.prefixHolder(prefix) ?? null;
  const keyAccount = accounts?.publisherKey(checked.owner)?.accountId ?? null;
  if (holder !== null && holder !== keyAccount) throw new CatalogError(`The id prefix "${prefix}" belongs to another account than the one this zip's key is linked to.`);
  const added = catalog.add(bytes, now, null, checked);
  const reserve = accounts !== undefined && holder === null && keyAccount !== null;
  if (reserve) accounts.reservePrefix(keyAccount, prefix, now.getTime());
  return { added, reservedFor: reserve ? keyAccount : null, unheld: holder === null && !reserve };
}
