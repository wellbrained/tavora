import { checkAll, createRateLimiter } from "./rate-limit.ts";

// Steam import: turns a profile link or SteamID64 into the list of games that
// account owns, using Steam's Web API with the service's key. Nothing is kept:
// the list goes straight back to the user's PC.

export interface SteamGame {
  appid: number;
  name: string;
}

/**
 * Why an import failed, as a stable word the app words for the user in their
 * own language. The English message stays for app versions that show it as is.
 */
export type SteamErrorCode =
  | "bad-request"
  | "bad-link"
  | "not-steam-link"
  | "bad-id"
  | "bad-name"
  | "no-such-profile"
  | "steam-unreachable"
  | "steam-unreadable"
  | "no-game-list"
  | "too-many"
  | "unavailable";

/** What the user did wrong or what Steam said, with the HTTP status to answer. */
export class SteamError extends Error {
  // Declared as fields: Node strips types without running parameter properties.
  readonly status: 400 | 404 | 502 | 503;
  readonly code: SteamErrorCode;
  constructor(status: 400 | 404 | 502 | 503, code: SteamErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Profile = { kind: "id"; id: string } | { kind: "vanity"; name: string };

const STEAM_ID = /^\d{17}$/;
const VANITY = /^[A-Za-z0-9_-]{2,64}$/;
export const MAX_PROFILE_LENGTH = 200;
const MAX_GAMES = 20_000;
const MAX_NAME_LENGTH = 300;
const TIMEOUT_MS = 15_000;

/** A SteamID64, or a steamcommunity.com link to a profile by id or by custom name. */
export function parseProfile(input: string): Profile {
  const text = input.trim();
  if (STEAM_ID.test(text)) return { kind: "id", id: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SteamError(400, "bad-link", "Enter a Steam profile link or a SteamID64.");
  }
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== "https:" && url.protocol !== "http:") || (host !== "steamcommunity.com" && host !== "www.steamcommunity.com")) {
    throw new SteamError(400, "not-steam-link", "Enter a steamcommunity.com profile link.");
  }
  const match = /^\/(id|profiles)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) throw new SteamError(400, "not-steam-link", "Enter a steamcommunity.com profile link.");
  let value: string;
  try {
    value = decodeURIComponent(match[2]!);
  } catch {
    // A stray % in the link.
    throw new SteamError(400, "bad-link", "Enter a Steam profile link or a SteamID64.");
  }
  if (match[1] === "profiles") {
    if (!STEAM_ID.test(value)) throw new SteamError(400, "bad-id", "That profile link has no valid SteamID64.");
    return { kind: "id", id: value };
  }
  if (!VANITY.test(value)) throw new SteamError(400, "bad-name", "That profile name is not valid.");
  return { kind: "vanity", name: value };
}

export interface SteamClient {
  ownedGames(profile: string): Promise<SteamGame[]>;
}

/**
 * Calls to Steam's Web API the service makes with its key, for every user together (audit 2026-11-22): half of the 100,000
 * a day Steam allows a key, and a tenth of that an hour, so no number of addresses can use the key up or get it blocked.
 * Past them the import answers "try again later".
 */
export const STEAM_CALLS_PER_DAY = 50_000;
export const STEAM_CALLS_PER_HOUR = 5_000;

export interface SteamClientOptions {
  key: string;
  fetch?: typeof fetch;
  /** Steam calls for all users together; STEAM_CALLS_PER_HOUR and STEAM_CALLS_PER_DAY by default. */
  budget?: { perHour?: number; perDay?: number };
  now?: () => number;
}

export function createSteamClient({ key, fetch: fetcher = globalThis.fetch, budget = {}, now = Date.now }: SteamClientOptions): SteamClient {
  const hourly = createRateLimiter({ limit: budget.perHour ?? STEAM_CALLS_PER_HOUR, windowMs: 3_600_000 });
  const daily = createRateLimiter({ limit: budget.perDay ?? STEAM_CALLS_PER_DAY, windowMs: 86_400_000 });
  /** Takes the calls an import makes out of the budget before the first, all or none. */
  const spend = (calls: number) => {
    if (checkAll([[hourly, "steam", calls], [daily, "steam", calls]], now()) > 0) {
      throw new SteamError(503, "unavailable", "Steam import is busy right now. Try again later.");
    }
  };
  // The key goes in a header, so it is in no URL, log or error message.
  async function call(method: string, query: Record<string, string>): Promise<unknown> {
    const url = `https://api.steampowered.com/${method}/v1/?${new URLSearchParams(query)}`;
    let response: Response;
    try {
      response = await fetcher(url, { headers: { "x-webapi-key": key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new SteamError(502, "steam-unreachable", "Steam did not answer. Try again in a moment.");
    }
    if (!response.ok) throw new SteamError(502, "steam-unreachable", "Steam could not give the game list. Try again in a moment.");
    try {
      return await response.json();
    } catch {
      throw new SteamError(502, "steam-unreadable", "Steam sent an answer Tavora could not read.");
    }
  }

  async function resolve(profile: Profile): Promise<string> {
    if (profile.kind === "id") return profile.id;
    const body = (await call("ISteamUser/ResolveVanityURL", { vanityurl: profile.name })) as {
      response?: { success?: number; steamid?: string };
    };
    const id = body.response?.success === 1 ? body.response.steamid : undefined;
    if (typeof id !== "string" || !STEAM_ID.test(id)) throw new SteamError(404, "no-such-profile", "Steam has no profile with that name.");
    return id;
  }

  return {
    async ownedGames(input) {
      const profile = parseProfile(input);
      // A custom name takes a second call to turn it into an id.
      spend(profile.kind === "vanity" ? 2 : 1);
      const steamid = await resolve(profile);
      const body = (await call("IPlayerService/GetOwnedGames", {
        steamid,
        include_appinfo: "true",
        include_played_free_games: "true",
      })) as { response?: { game_count?: unknown; games?: unknown } };
      const answer = body.response;
      // A private "Game details" setting gives an empty answer, not an empty list.
      if (!answer || typeof answer.game_count !== "number") {
        throw new SteamError(502, "no-game-list", "Steam did not return a game list. Check that Game details are public on the profile.");
      }
      if (answer.game_count === 0) return [];
      if (!Array.isArray(answer.games)) {
        throw new SteamError(502, "no-game-list", "Steam did not return a game list. Check that Game details are public on the profile.");
      }
      const seen = new Map<number, SteamGame>();
      for (const entry of answer.games.slice(0, MAX_GAMES) as { appid?: unknown; name?: unknown }[]) {
        const appid = entry.appid;
        const name = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_NAME_LENGTH) : "";
        if (typeof appid === "number" && Number.isInteger(appid) && appid > 0 && name && !seen.has(appid)) {
          seen.set(appid, { appid, name });
        }
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
