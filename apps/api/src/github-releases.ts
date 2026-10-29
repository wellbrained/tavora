import { isAppVersion } from "./stats.ts";

/** The public repo whose releases also carry the installer (each one's Tavora-Setup-<version>.exe). */
export const RELEASES_URL = "https://api.github.com/repos/wellbrained/tavora/releases";
/** Most pages of 100 releases read, so a broken answer can never loop. */
const MAX_PAGES = 10;
const SETUP = /^Tavora-Setup-([0-9.]+)\.exe$/;

/**
 * How often each version's installer was downloaded from the GitHub releases, all time (GitHub's own running
 * total per file). Throws when GitHub can't be reached or answers anything but 200. Asked without a token, which
 * allows 60 requests an hour, plenty for once an hour.
 */
export async function githubInstallerTotals(fetchFn: typeof fetch = fetch): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchFn(`${RELEASES_URL}?per_page=100&page=${page}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "tavora-api" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const releases = (await response.json()) as { assets?: { name?: unknown; download_count?: unknown }[] }[];
    if (!Array.isArray(releases)) throw new Error("GitHub sent no list of releases.");
    for (const release of releases) {
      for (const asset of release.assets ?? []) {
        const version = typeof asset.name === "string" ? SETUP.exec(asset.name)?.[1] : undefined;
        if (isAppVersion(version) && typeof asset.download_count === "number") totals[version] = (totals[version] ?? 0) + asset.download_count;
      }
    }
    if (releases.length < 100) break;
  }
  return totals;
}
