import { isGameId } from "@tavora/module-schema";
import type { OnlineGame, OnlineSearchResult } from "../shared/host-api";

/** The Tavora service. The app talks to no one else; the desktop never holds keys. */
export const DEFAULT_API_URL = "https://api.mytavora.app";
export const SEARCH_TIMEOUT_MS = 2000;
export const MIN_ONLINE_QUERY = 2;
const MAX_RESULTS = 20;

/** Keeps a result only if it has the shape the app relies on. */
export function parseOnlineGame(raw: unknown): OnlineGame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, name } = raw as Record<string, unknown>;
  if (!isGameId(id)) return null;
  if (typeof name !== "string" || !name.trim() || name.length > 200) return null;
  return { id, name: name.trim() };
}

/** The service answers `{ results: [...] }`; an older reply was the bare list. */
function resultsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const results = (body as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? results : [];
}

export interface OnlineSearchOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Searches games on the Tavora service from the main process, so the host UI
 * needs no network permission. It sends only the typed text. A newer search
 * cancels the one before it; a slow or failing service never throws, it just
 * reports `unreachable` and the caller falls back to the built-in games.
 */
export class OnlineSearch {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private pending: AbortController | null = null;

  constructor(options: OnlineSearchOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  }

  async search(query: string): Promise<OnlineSearchResult> {
    this.pending?.abort();
    const text = query.replace(/\s+/g, " ").trim();
    if ([...text].length < MIN_ONLINE_QUERY) {
      this.pending = null;
      return { status: "ok", games: [] };
    }
    const controller = new AbortController();
    this.pending = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}/v1/games/search?q=${encodeURIComponent(text)}&limit=${MAX_RESULTS}`;
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        // No cookies, no referrer, no identifier of any kind.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return { status: "unreachable", games: [] };
      const games = resultsOf(await response.json())
        .map(parseOnlineGame)
        .filter((game): game is OnlineGame => game !== null);
      return { status: "ok", games };
    } catch {
      // A search replaced by a newer one is not a failure the player should see.
      return controller.signal.aborted && this.pending !== controller ? { status: "ok", games: [] } : { status: "unreachable", games: [] };
    } finally {
      clearTimeout(timer);
      if (this.pending === controller) this.pending = null;
    }
  }
}
