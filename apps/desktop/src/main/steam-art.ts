import { rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { imageType } from "./icons";

/**
 * A game's official Steam cover, fetched by this app on the player's PC and
 * kept unchanged in the player's data folder. Tavora's service never fetches,
 * relays or stores it, and Tavora never ships it: only the player's own copy
 * exists, shown with Tavora's border and a slight colour adjustment.
 */

export const STEAM_ART_BASE = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/** Steam's library cover, 600 by 900. The app crops it square when showing it. */
export function steamArtUrl(appid: number, base: string = STEAM_ART_BASE): string {
  return `${base.replace(/\/+$/, "")}/${appid}/library_600x900.jpg`;
}

export const MAX_ART_BYTES = 2 * 1024 * 1024;
export const ART_TIMEOUT_MS = 10_000;
/** A game Steam has no cover for is asked again after this long. */
export const ART_RETRY_DAYS = 30;

export function isSteamAppId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

/** The file name for a game's cover: only digits, so it can never point elsewhere. */
export function artFileName(appid: number): string {
  return `${appid}.jpg`;
}

export function isArtFileName(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,10}\.jpg$/.test(value);
}

export type ArtResult = { status: "saved"; file: string } | { status: "none" } | { status: "failed" };

/**
 * Fetches and saves one cover. `none` means Steam has no cover for this game
 * (a 404 or something that is not a JPEG): ask again much later. `failed` means
 * the network or Steam did not answer: try again soon.
 */
export async function fetchSteamArt(
  artDir: string,
  appid: number,
  options: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<ArtResult> {
  if (!isSteamAppId(appid)) return { status: "none" };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(steamArtUrl(appid, options.baseUrl), {
      // No cookies, no referrer, nothing that says who is asking.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(ART_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 403) return { status: "none" };
    if (!response.ok) return { status: "failed" };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ART_BYTES) return { status: "none" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ART_BYTES || imageType(bytes) !== "jpg") return { status: "none" };
    const file = artFileName(appid);
    await writeFileAtomic(path.join(artDir, file), bytes);
    return { status: "saved", file };
  } catch {
    return { status: "failed" };
  }
}

export async function removeSteamArt(artDir: string, file: string): Promise<void> {
  if (!isArtFileName(file)) return;
  await rm(path.join(artDir, file), { force: true });
}

/** True when a game with a Steam id should be asked for its cover now. */
export function needsArt(
  game: { steamAppId: number | null; artFile: string | null; artCheckedAt: string | null },
  now: Date,
): boolean {
  if (game.steamAppId === null || game.artFile !== null) return false;
  if (game.artCheckedAt === null) return true;
  const checked = Date.parse(game.artCheckedAt);
  return !Number.isFinite(checked) || now.getTime() - checked > ART_RETRY_DAYS * 24 * 60 * 60 * 1000;
}
