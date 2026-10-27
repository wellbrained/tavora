/**
 * Offering a game's icon to the Tavora service, which does not have one for it
 * yet. Only ever the game's own icon found on this PC (from the installed game
 * or the Steam folder), never a picture the user chose and never an icon
 * downloaded from Tavora. The offer holds the icon, the game's id and its name,
 * and goes with the user's sign-in: only signed-in users can share, and the
 * service keeps the account with an offer until a person has checked it. A
 * person checks every offer before anyone else sees it. A game the user added
 * by name (`local-`) is offered by that name.
 */

import type { SteamImportGame } from "../shared/host-api";
import { matchHosted, type HostedList } from "./hosted-icons";

export const SHARE_TIMEOUT_MS = 10_000;

/**
 * `sent`: the service took it. `skipped`: it will not take this one (bad, already there). `busy`: it takes only
 * so many an hour, try the rest later. `signed-out`: the service does not know the sign-in. `failed`: try again later.
 */
export type ShareOutcome = "sent" | "skipped" | "busy" | "signed-out" | "failed";

/** True for the icon files that came from this PC: the installed game's, or Steam's own `.ico` from its folder. */
export function isOriginalIconFile(file: string | null): file is string {
  return typeof file === "string" && /^(exe-[a-z0-9][a-z0-9-]{0,63}\.ico|\d{1,10}\.ico)$/.test(file);
}

export function shareSource(file: string): "installed" | "steam" {
  return file.startsWith("exe-") ? "installed" : "steam";
}

/** A workspace of the library, as far as sharing its game's icon needs it. */
export interface ShareGame {
  id: string;
  name: string;
  kind: "game" | "personal";
  catalogId: string | null;
  trashedAt: string | null;
  iconFile: string | null;
  iconSharedAt: string | null;
}

/** A game that could be offered at all: the game of a game workspace (not a personal one), not in Trash, not offered before, with an icon of its own. */
export function isShareCandidate(game: ShareGame): boolean {
  return game.kind === "game" && game.trashedAt === null && game.iconSharedAt === null && isOriginalIconFile(game.iconFile);
}

/**
 * The icon file of a game that could be offered right now, or null: the game's
 * own icon found on this PC (never a picture the user chose, a hosted icon or
 * Steam's small one), while the service has no icon for the game (or one it
 * marked open for replacements) and the user's settings allow talking to it.
 */
export function shareableIconFile(
  game: ShareGame,
  settings: { steamIcons: boolean; onlineSearch: boolean; iconsOffered: readonly string[] },
  list: HostedList | null,
): string | null {
  if (!list || !settings.steamIcons || !settings.onlineSearch || !isShareCandidate(game) || settings.iconsOffered.includes(game.id)) return null;
  const hosted = matchHosted(game, list);
  return hosted && hosted.open !== true ? null : game.iconFile;
}

/**
 * The games of a Steam import whose icon could be offered without adding them:
 * ones the user does not have (`isNew`), with an id the service knows, that
 * were not offered before and that the service has no icon for (or one open for replacements). Whether this PC
 * has the icon is for the caller to find out.
 */
export function steamShareGames(
  games: readonly SteamImportGame[],
  isNew: (game: SteamImportGame) => boolean,
  offered: readonly string[],
  list: HostedList,
): (SteamImportGame & { id: string })[] {
  const done = new Set(offered);
  const seen = new Set<string>();
  return games.filter((game): game is SteamImportGame & { id: string } => {
    if (game.id === null || game.id.startsWith("local-") || done.has(game.id) || seen.has(game.id) || !isNew(game)) return false;
    seen.add(game.id);
    const hosted = matchHosted({ id: game.id, name: game.name, catalogId: null }, list);
    return !hosted || hosted.open === true;
  });
}

/**
 * An .ico with only its biggest frame (at most 256 px), so an offer stays small:
 * a game's icon can carry a dozen sizes. Null when the file is not a readable icon.
 */
export function largestIcoFrame(ico: Uint8Array): Uint8Array | null {
  return pickIcoFrame(ico, (a, b) => a > b);
}

/** An .ico with one frame of about `size` px (the smallest at least that big, else the biggest), for a preview. */
export function icoFrameNear(ico: Uint8Array, size: number): Uint8Array | null {
  const want = size * size;
  return pickIcoFrame(ico, (a, b) => (a >= want ? b < want || a < b : b < want && a > b));
}

/** An .ico with only the frame `better` prefers (by pixel count). */
function pickIcoFrame(ico: Uint8Array, better: (pixels: number, best: number) => boolean): Uint8Array | null {
  if (ico.byteLength < 22) return null;
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return null;
  const count = view.getUint16(4, true);
  if (count < 1 || count > 64 || 6 + count * 16 > ico.byteLength) return null;
  let best: { at: number; pixels: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (size === 0 || offset < 6 + count * 16 || offset + size > ico.byteLength) continue;
    const pixels = (ico[at]! || 256) * (ico[at + 1]! || 256);
    if (!best || better(pixels, best.pixels)) best = { at, pixels };
  }
  if (!best) return null;
  const size = view.getUint32(best.at + 8, true);
  const offset = view.getUint32(best.at + 12, true);
  const out = new Uint8Array(22 + size);
  const outView = new DataView(out.buffer);
  outView.setUint16(2, 1, true);
  outView.setUint16(4, 1, true);
  out.set(ico.subarray(best.at, best.at + 16), 6);
  outView.setUint32(6 + 12, 22, true);
  out.set(ico.subarray(offset, offset + size), 22);
  return out;
}

export interface SubmitOptions {
  baseUrl: string;
  /** The user's sign-in token. */
  token: string;
  fetchImpl?: typeof fetch;
}

/** Sends one offer. Never throws: a network problem is `failed`. */
export async function submitIcon(
  options: SubmitOptions,
  offer: { id: string; name: string; source: "installed" | "steam"; ico: Uint8Array },
): Promise<ShareOutcome> {
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/v1/icons/submit`, {
      method: "POST",
      // No cookies and no referrer: the sign-in is the only thing that says who is asking.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(SHARE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${options.token}` },
      body: JSON.stringify({ id: offer.id, name: offer.name, source: offer.source, icon: Buffer.from(offer.ico).toString("base64") }),
    });
    if (response.status === 202) return "sent";
    if (response.status === 429) return "busy";
    if (response.status === 401) return "signed-out";
    // A refusal that asking again cannot change: the game has an icon now, or the file is not usable.
    if (response.status === 400 || response.status === 409 || response.status === 413) return "skipped";
    return "failed";
  } catch {
    return "failed";
  }
}
