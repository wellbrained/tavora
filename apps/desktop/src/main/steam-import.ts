import { isGameId } from "@tavora/module-schema";
import type { SteamGameView, SteamImportGame, SteamLibraryResult } from "../shared/host-api";
import { translate, type Language, type MessageKey } from "../shared/i18n";
import { normalizeName } from "./launcher-games";
import { addGame, type Library } from "./library";
import { isSteamAppId } from "./steam-icons";

export const MAX_PROFILE_LENGTH = 200;
export const MAX_IMPORT_GAMES = 5000;
const IMPORT_TIMEOUT_MS = 20_000;

/**
 * Whether a game from a Steam library is already in the user's library: by its
 * Tavora id, by the Steam appid a game was added with, or by name (a game the
 * user added by hand is the same game). Trash counts, so an import never
 * brings back a game the user removed.
 */
export function steamGameStatus(library: Library, game: SteamImportGame): "new" | "owned" | "trash" {
  const name = normalizeName(game.name);
  let found: Library["games"][string] | undefined = game.id ? library.games[game.id] : undefined;
  if (!found) {
    found = Object.values(library.games).find(
      (own) => own.steamAppId === game.appid || (name !== "" && normalizeName(own.name) === name),
    );
  }
  if (!found) return "new";
  return found.trashedAt ? "trash" : "owned";
}

/** Adds the games that are new, one entry each. Returns how many were added and their ids. */
export function importSteamGames(library: Library, games: SteamImportGame[], now: Date): string[] {
  const added: string[] = [];
  for (const game of games) {
    if (steamGameStatus(library, game) !== "new") continue;
    try {
      added.push(
        addGame(library, game.id ? { online: { id: game.id, name: game.name, steamAppId: game.appid } } : { name: game.name, steamAppId: game.appid }, now),
      );
    } catch {
      // A name that cannot be used is skipped; the rest still go in.
    }
  }
  return added;
}

/** Keeps a game only if it has the shape the app relies on. */
export function parseSteamGame(raw: unknown): SteamImportGame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { appid, name, id } = raw as Record<string, unknown>;
  if (!isSteamAppId(appid)) return null;
  if (typeof name !== "string" || !name.trim() || name.length > 300) return null;
  return { appid, name: name.trim(), id: isGameId(id) && !id.startsWith("local-") ? id : null };
}

export interface SteamImportOptions {
  baseUrl: string;
  /** The language of the messages made here; the service's own messages stay as it sent them. */
  language?: Language;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Asks the Tavora service for the games a Steam account owns. The service holds
 * the Steam key and keeps nothing; the app sends only what the user typed.
 * Never throws: a problem comes back as a message the user can read.
 */
export async function fetchSteamLibrary(
  options: SteamImportOptions,
  profile: string,
): Promise<{ status: "ok"; games: SteamImportGame[] } | { status: "error"; error: string }> {
  const say = (key: MessageKey) => ({ status: "error" as const, error: translate(options.language ?? "en", key) });
  const text = profile.trim();
  if (!text) return say("error.steam.enter");
  if (text.length > MAX_PROFILE_LENGTH) return say("error.steam.tooLong");
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/v1/steam/library`, {
      method: "POST",
      // No cookies, no referrer, nothing that says who is asking.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? IMPORT_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ profile: text }),
    });
    const body = (await response.json().catch(() => null)) as { games?: unknown; error?: unknown } | null;
    if (response.status === 429) return say("error.steam.tooMany");
    if (!response.ok) {
      // The service words its refusals for users (a wrong link, a private profile, Steam being down).
      return typeof body?.error === "string" && body.error.length <= 300 ? { status: "error", error: body.error } : say("error.steam.unavailable");
    }
    if (!Array.isArray(body?.games)) return say("error.steam.unreadable");
    const games = body.games
      .slice(0, MAX_IMPORT_GAMES)
      .map(parseSteamGame)
      .filter((game): game is SteamImportGame => game !== null);
    return { status: "ok", games };
  } catch {
    return say("error.unreachable");
  }
}

/** The list the dialog shows: each game with whether the user already has it. */
export function steamLibraryView(library: Library, games: SteamImportGame[]): SteamLibraryResult {
  const views: SteamGameView[] = games.map((game) => ({ ...game, status: steamGameStatus(library, game) }));
  return { status: "ok", games: views };
}
