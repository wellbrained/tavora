import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Reader, type CountryResponse } from "mmdb-lib";

/**
 * Visits to mytavora.app (decided 2026-10-29), counted like everything else in stats.ts: plain daily totals,
 * nothing about a person. The page sends one call when it opens (with the site it came from) and one when a
 * tracked link is clicked. Per day: views by the referring site's domain, views by country, clicks by link.
 * The country is looked up from the address in DB-IP's free country database and the address is then
 * forgotten; no cookie, no id, no address is kept.
 */

export const SITE_ORIGIN = "https://mytavora.app";
/** The links the site reports a click on. */
export const SITE_CLICKS = ["download", "docs", "github", "privacy"] as const;
/** A view whose page didn't say where it came from (typed in, a bookmark, an app). */
export const DIRECT = "direct";
/** Country unknown: no database yet, or an address it doesn't know. */
export const UNKNOWN_COUNTRY = "unknown";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|axios|node-fetch|go-http/i;
const DOMAIN = /^(?=.{3,100}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** True for programs that announce themselves as one; most others never run the page's script anyway. */
export const isBot = (userAgent: string | undefined) => !userAgent || BOT.test(userAgent);

/** The domain a view came from (www. left off), `direct` without one, or null for the site itself (a click inside it). */
export function referrerDomain(referrer: unknown): string | null {
  if (typeof referrer !== "string" || referrer === "") return DIRECT;
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DIRECT;
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return DIRECT;
  }
  if (host === "mytavora.app" || host.endsWith(".mytavora.app")) return null;
  return DOMAIN.test(host) ? host : DIRECT;
}

/** The free DB-IP country database, refreshed once a month (CC BY 4.0: "IP Geolocation by DB-IP", db-ip.com). */
const DATABASE_URL = (month: string) => `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`;
const REFRESH_MS = 32 * 24 * 60 * 60_000;

/** Country codes for addresses, from a DB-IP country file kept in the state folder. */
export class CountryLookup {
  private reader: Reader<CountryResponse> | null = null;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (existsSync(file)) this.reader = new Reader<CountryResponse>(readFileSync(file));
  }

  /** Two-letter country code (DE), or null when there is no database or the address isn't known. */
  country(address: string | undefined): string | null {
    if (!this.reader || !address) return null;
    try {
      const code = this.reader.get(address)?.country?.iso_code;
      return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }

  /** Downloads this month's file (or last month's, early in a month) when there is none or it's over a month old. */
  async refresh(fetchFn: typeof fetch = fetch, now: number = Date.now()): Promise<boolean> {
    if (this.reader && existsSync(this.file) && now - statSync(this.file).mtimeMs < REFRESH_MS) return false;
    const months = [0, 1].map((back) => {
      const at = new Date(now);
      at.setUTCDate(1);
      at.setUTCMonth(at.getUTCMonth() - back);
      return at.toISOString().slice(0, 7);
    });
    for (const month of months) {
      const response = await fetchFn(DATABASE_URL(month), { signal: AbortSignal.timeout(60_000) });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`DB-IP answered ${response.status}.`);
      const data = gunzipSync(Buffer.from(await response.arrayBuffer()));
      // Read it before it replaces the old file, so a broken download never takes the lookup away.
      const reader = new Reader<CountryResponse>(data);
      writeFileSync(`${this.file}.new`, data);
      renameSync(`${this.file}.new`, this.file);
      this.reader = reader;
      return true;
    }
    throw new Error("DB-IP has no country file for this or last month.");
  }
}

/** Reads the page's body: JSON sent as plain text, so the browser sends it without asking CORS first. */
export function parseVisit(text: string): { referrer?: unknown; click?: unknown } | null {
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as { referrer?: unknown; click?: unknown }) : null;
  } catch {
    return null;
  }
}
