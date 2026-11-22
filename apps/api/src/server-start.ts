import { ZIP_LIMITS, publishReadMs } from "@tavora/pack";
import { REMOVED_ZIP, type CatalogStore } from "./catalog.ts";

/**
 * Node ends a request after 5 minutes by default, which cut off a slow honest upload the catalog was still willing to read
 * (publishReadMs: about 8 minutes for the biggest zip on a 1 Mbit/s line). The catalog's own reader is what limits an upload.
 */
export const REQUEST_TIMEOUT_MS = 600_000;
/** Headers still have to arrive within Node's default minute, so a slow request can't hold a connection before it is known. */
export const HEADERS_TIMEOUT_MS = 60_000;

export function setServerTimeouts(server: { requestTimeout: number; headersTimeout: number }): void {
  server.requestTimeout = Math.max(REQUEST_TIMEOUT_MS, publishReadMs(ZIP_LIMITS.maxArchiveBytes) + 60_000);
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}

/**
 * The signed hash and file hashes of each version from before they were kept. Only rows still without them are read, so after
 * the first start this is quick; a zip it can't use is named and the start goes on. Whatever goes wrong here (a database that
 * can't be written, say) is logged and never stops the service: it is tried again at the next start.
 */
export function backfillAtStart(catalog: CatalogStore, log: Pick<Console, "log" | "warn" | "error"> = console): void {
  try {
    const { filled, skipped } = catalog.backfillSignedHashes({ skipStalled: true });
    if (filled > 0) log.log(`[tavora-api] Filled the signed hash of ${filled} catalog versions.`);
    const removed = skipped.filter((version) => version.reason === REMOVED_ZIP).length;
    if (removed > 0) log.log(`[tavora-api] ${removed} catalog versions have no signed hash: their zip was removed to make room.`);
    for (const version of skipped.filter((version) => version.reason !== REMOVED_ZIP)) log.warn(`[tavora-api] Hashes not filled for ${version.id} ${version.version} (${version.sha256}): ${version.reason}.`);
  } catch (error) {
    log.error(`[tavora-api] Couldn't fill the catalog's hashes at this start: ${error instanceof Error ? error.message : String(error)}`);
  }
}
