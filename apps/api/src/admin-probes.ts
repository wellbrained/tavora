/**
 * What the admin panel asks the outside world, read-only: the update feed, the public sites, npm and
 * the repository's main branch. Each answer is kept for a minute so opening the panel in a loop does
 * not hammer anyone; a failed ask is an answer too (null / not up), never an error for the panel.
 */

export interface FeedInfo {
  version: string;
  releasedAt: string | null;
  installerSize: number | null;
}

export interface SiteState {
  ok: boolean;
  /** The HTTP status, or null when nothing answered. */
  status: number | null;
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

/** `1.2.10` > `1.2.9`; anything that is not major.minor.patch counts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(version) ?? [, "0", "0", "0"]).slice(1).map(Number) as number[];
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

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
  const get = (url: string, init: RequestInit = {}) => fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(6000), ...init });
  const version = async (url: string) => {
    const response = await get(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const found = ((await response.json()) as { version?: unknown }).version;
    return typeof found === "string" ? found : null;
  };
  return {
    feed: () =>
      once("feed", async () => {
        const response = await get(`${FEED_URL}/latest.yml`);
        return response.ok ? parseLatestYml(await response.text()) : null;
      }),
    site: (url) =>
      once(`site:${url}`, async (): Promise<SiteState> => {
        try {
          const response = await get(url, { method: "GET" });
          await response.body?.cancel();
          return { ok: response.ok, status: response.status };
        } catch {
          return { ok: false, status: null };
        }
      }),
    npmVersion: (name) => once(`npm:${name}`, () => version(`https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`)),
    mainVersion: (folder) => once(`main:${folder}`, () => version(`${REPO_RAW}/${folder}/package.json`)),
  };
}
