/**
 * What the admin panel asks the outside world, read-only: the update feed, the public sites, npm and
 * the repository's main branch. Each answer is kept for a minute so opening the panel in a loop does
 * not hammer anyone; a failed ask is an answer too (null / not up), never an error for the panel. Answers are read
 * up to a cap and redirects are followed only on the same host, so none of these hosts can make the service read
 * without end or ask somewhere else.
 */
import { compareVersionsLoose } from "../../desktop/src/shared/plain-version.ts";
import { fetchSameOrigin, isUnfollowedRedirect, readCapped, readCappedJson } from "./capped-fetch.ts";

export interface FeedInfo {
  version: string;
  releasedAt: string | null;
  installerSize: number | null;
}

export interface SiteState {
  ok: boolean;
  /** The HTTP status, or null when nothing answered. */
  status: number | null;
  /** The site answered, but by sending the visitor to another host (or round in circles): it is up, yet not itself. */
  redirectsElsewhere?: true;
}

export interface Probes {
  feed(): Promise<FeedInfo | null>;
  site(url: string): Promise<SiteState>;
  /** The newest version of an `@tavora/*` package on npm. */
  npmVersion(name: string): Promise<string | null>;
  /** The version in a package's package.json on the repository's main branch. */
  mainVersion(folder: string): Promise<string | null>;
}

export const FEED_URL = "https://updates.mytavora.app";
export const REPO_RAW = "https://raw.githubusercontent.com/wellbrained/tavora/main";
/** latest.yml is a few hundred bytes; npm's and GitHub's package.json answers a few KB (npm's can carry a readme). */
const FEED_BYTES = 64 * 1024;
const VERSION_BYTES = 1024 * 1024;

/** `1.2.10` > `1.2.9`; anything that is not major.minor.patch counts as 0.0.0. */
export const compareVersions = compareVersionsLoose;

/** Reads what the panel needs from electron-builder's latest.yml. */
export function parseLatestYml(text: string): FeedInfo | null {
  const version = /^version:\s*['"]?([0-9][^\s'"]*)/m.exec(text)?.[1];
  if (!version) return null;
  const released = /^releaseDate:\s*['"]?([^'"\r\n]+)/m.exec(text)?.[1];
  const size = /^\s+size:\s*(\d+)/m.exec(text)?.[1];
  return { version, releasedAt: released ? released.trim() : null, installerSize: size ? Number(size) : null };
}

export function createProbes(fetchFn: typeof fetch = fetch, now: () => number = Date.now, keepMs = 60_000): Probes {
  const kept = new Map<string, { at: number; value: Promise<unknown> }>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const known = kept.get(key);
    if (known && now() - known.at < keepMs) return known.value as Promise<T>;
    const value = load().catch(() => null as T);
    kept.set(key, { at: now(), value });
    return value;
  };
  const get = (url: string, init: RequestInit = {}) => fetchSameOrigin(fetchFn, url, { signal: AbortSignal.timeout(6000), ...init });
  const version = async (url: string) => {
    const response = await get(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const found = ((await readCappedJson(response, VERSION_BYTES)) as { version?: unknown } | null)?.version;
    return typeof found === "string" ? found : null;
  };
  return {
    feed: () =>
      once("feed", async () => {
        const response = await get(`${FEED_URL}/latest.yml`);
        return response.ok ? parseLatestYml(await readCapped(response, FEED_BYTES)) : null;
      }),
    site: (url) =>
      once(`site:${url}`, async (): Promise<SiteState> => {
        try {
          const response = await get(url, { method: "GET" });
          await response.body?.cancel();
          if (isUnfollowedRedirect(response)) return { ok: false, status: response.status, redirectsElsewhere: true };
          return { ok: response.ok, status: response.status };
        } catch {
          return { ok: false, status: null };
        }
      }),
    npmVersion: (name) => once(`npm:${name}`, () => version(`https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`)),
    mainVersion: (folder) => once(`main:${folder}`, () => version(`${REPO_RAW}/${folder}/package.json`)),
  };
}
