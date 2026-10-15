# @tavora/api

Tavora's online game database: a small read-only service that answers game searches from its own dataset. The app asks it; it never calls Wikidata or Steam while running, and it holds no player data. Design and decisions: [docs/decisions.md](../../docs/decisions.md) (2026-10-15).

Needs Node 22.18 or newer (it runs the TypeScript directly and uses `node:sqlite`).

## Run it

```sh
pnpm --filter @tavora/api dataset      # build data/games.sqlite (see below)
pnpm --filter @tavora/api dev          # http://127.0.0.1:4010, restarts on changes
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4010` | Port, always bound to 127.0.0.1 |
| `TAVORA_GAMES_DB` | `data/games.sqlite` | Dataset to load, opened read-only |
| `STEAM_WEB_API_KEY` | unset | Enables the Steam import. On the server it lives in `/srv/tavora-api/shared/production.env` (set with `deploy/tavora-api-set-steam-key.sh`, never committed). Without it search works and the import answers 503 |
| `TRUST_PROXY` | unset | `1` behind Caddy: the client is the first `X-Forwarded-For` address, for the rate limit |

## API

- `GET /v1/games/search?q=<text>&limit=<1-20>` returns `{ "results": [{ "id": "elden-ring", "name": "Elden Ring" }] }`, best match first: exact name, exact alias, name prefix, alias prefix, then every word as a word start. Case, accents and apostrophes are ignored. `q` is at most 100 characters, `limit` defaults to 8.
- `GET /v1/health` returns `{ ok, games, builtAt }`.
- `POST /v1/steam/library` with JSON `{ "profile": "<steamcommunity.com profile link or SteamID64>" }` returns `{ "games": [{ "appid": 1245620, "name": "ELDEN RING", "id": "elden-ring" }] }`, sorted by name; `id` is the canonical id when the dataset knows that Steam appid, otherwise `null`. The service asks Steam's Web API with its own key, passes the list straight back and stores nothing. 400 for a profile it cannot read, 404 for an unknown custom name, 502 when Steam fails or the profile's Game details are private, 503 without a key, 415 unless the body is JSON. 6 requests a minute per client. It is a POST so the profile is in no URL.
- 60 requests a minute per client, then `429` with `Retry-After`. No CORS: the app calls it from its main process.
- Answers are never cached. The service never logs a request, so what a player typed is not kept.

## The dataset

`pnpm --filter @tavora/api dataset` runs on a PC, never on the server. It merges:

1. the app's built-in games (`apps/desktop/src/main/catalog.ts`), which keep their ids,
2. Wikidata (CC0): video games with a Steam application ID (P1733), their English label and aliases,
3. optionally Steam's game list, when `STEAM_WEB_API_KEY` is set.

`--limit <n>` stops after n Wikidata rows (for a quick test; do not commit its registry).

It writes `data/games.sqlite` (not in git) and updates `data/ids.tsv`.

### Ids are frozen

An id is a slug of the game's name, issued once. `data/ids.tsv` lists every id ever issued with its matching keys (`wd:Q…`, `steam:…`). A rebuild reads it first, so a renamed game keeps its id, a new game with the same name gets a suffix, and a game that dropped out of the sources keeps its id reserved. Commit the file after every real build and never edit it by hand. No id starts with `local-`: that prefix belongs to custom games on a player's PC.

## Tests

`pnpm test` at the repository root. The tests use in-memory datasets and need no network.
