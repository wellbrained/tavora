import { DatabaseSync } from "node:sqlite";

/**
 * How long a write waits for another connection's lock (ms) before it fails with "database is locked". The service is
 * not alone on its files: the maintainer's catalog.mjs (scripts/catalog.ts) writes the live catalog, and the daily
 * backup reads every database. node:sqlite waits 0 ms by default. The wait blocks this process, so it stays short.
 */
export const BUSY_TIMEOUT_MS = 5000;

/** Opens one of the service's own databases (the state folder), waiting BUSY_TIMEOUT_MS for another writer. */
export function openStateDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}
