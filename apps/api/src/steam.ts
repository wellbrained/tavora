// Steam import: turns a profile link or SteamID64 into the list of games that
// account owns, using Steam's Web API with the service's key. Nothing is kept:
// the list goes straight back to the user's PC.

export interface SteamGame {
  appid: number;
  name: string;
}

/** What the user did wrong or what Steam said, with the HTTP status to answer. */
export class SteamError extends Error {
  // Declared as a field: Node strips types without running parameter properties.
  readonly status: 400 | 404 | 502 | 503;
  constructor(status: 400 | 404 | 502 | 503, message: string) {
    super(message);
    this.status = status;
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
    throw new SteamError(400, "Enter a Steam profile link or a SteamID64.");
  }
  const host = url.hostname.toLowerCase();
  if ((url.protocol !== "https:" && url.protocol !== "http:") || (host !== "steamcommunity.com" && host !== "www.steamcommunity.com")) {
    throw new SteamError(400, "Enter a steamcommunity.com profile link.");
  }
  const match = /^\/(id|profiles)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) throw new SteamError(400, "Enter a steamcommunity.com profile link.");
  const value = decodeURIComponent(match[2]!);
  if (match[1] === "profiles") {
    if (!STEAM_ID.test(value)) throw new SteamError(400, "That profile link has no valid SteamID64.");
    return { kind: "id", id: value };
  }
  if (!VANITY.test(value)) throw new SteamError(400, "That profile name is not valid.");
  return { kind: "vanity", name: value };
}

export interface SteamClient {
  ownedGames(profile: string): Promise<SteamGame[]>;
}

export interface SteamClientOptions {
  key: string;
  fetch?: typeof fetch;
}

export function createSteamClient({ key, fetch: fetcher = globalThis.fetch }: SteamClientOptions): SteamClient {
  // The key goes in a header, so it is in no URL, log or error message.
  async function call(method: string, query: Record<string, string>): Promise<unknown> {
    const url = `https://api.steampowered.com/${method}/v1/?${new URLSearchParams(query)}`;
    let response: Response;
    try {
      response = await fetcher(url, { headers: { "x-webapi-key": key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new SteamError(502, "Steam did not answer. Try again in a moment.");
    }
    if (!response.ok) throw new SteamError(502, "Steam could not give the game list. Try again in a moment.");
    try {
      return await response.json();
    } catch {
      throw new SteamError(502, "Steam sent an answer Tavora could not read.");
    }
  }

  async function resolve(profile: Profile): Promise<string> {
    if (profile.kind === "id") return profile.id;
    const body = (await call("ISteamUser/ResolveVanityURL", { vanityurl: profile.name })) as {
      response?: { success?: number; steamid?: string };
    };
    const id = body.response?.success === 1 ? body.response.steamid : undefined;
    if (typeof id !== "string" || !STEAM_ID.test(id)) throw new SteamError(404, "Steam has no profile with that name.");
    return id;
  }

  return {
    async ownedGames(input) {
      const steamid = await resolve(parseProfile(input));
      const body = (await call("IPlayerService/GetOwnedGames", {
        steamid,
        include_appinfo: "true",
        include_played_free_games: "true",
      })) as { response?: { game_count?: unknown; games?: unknown } };
      const answer = body.response;
      // A private "Game details" setting gives an empty answer, not an empty list.
      if (!answer || typeof answer.game_count !== "number") {
        throw new SteamError(502, "Steam did not return a game list. Check that Game details are public on the profile.");
      }
      if (answer.game_count === 0) return [];
      if (!Array.isArray(answer.games)) {
        throw new SteamError(502, "Steam did not return a game list. Check that Game details are public on the profile.");
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
