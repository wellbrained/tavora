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
| `TAKEDOWN_CONTACT` | unset | Where a publisher asks for an icon to be removed (an address or a link). Hosted icons are only served while it is set. On the server it lives in `/srv/tavora-api/shared/production.env` |
| `TAVORA_ICONS_DIR` | `data/icons` | The hosted icons: `<id>.png` files and their `index.json`. In a release it is the `icons` folder next to `server.mjs` |

## API

- `GET /v1/games/search?q=<text>&limit=<1-20>` returns `{ "results": [{ "id": "elden-ring", "name": "Elden Ring", "steamAppId": 1245620 }] }` (`steamAppId` is `null` for games without one; the app uses it to fetch the game's icon from Steam itself), best match first: exact name, exact alias, name prefix, alias prefix, then every word as a word start. Case, accents and apostrophes are ignored. `q` is at most 100 characters, `limit` defaults to 8.
- `GET /v1/health` returns `{ ok, games, builtAt }`.
- `POST /v1/steam/library` with JSON `{ "profile": "<steamcommunity.com profile link or SteamID64>" }` returns `{ "games": [{ "appid": 1245620, "name": "ELDEN RING", "id": "elden-ring" }] }`, sorted by name; `id` is the canonical id when the dataset knows that Steam appid, otherwise `null`. The service asks Steam's Web API with its own key, passes the list straight back and stores nothing. 400 for a profile it cannot read, 404 for an unknown custom name, 502 when Steam fails or the profile's Game details are private, 503 without a key, 415 unless the body is JSON. 6 requests a minute per client. It is a POST so the profile is in no URL.
- `GET /v1/icons` returns `{ "notice": "…", "takedown": "<contact>", "icons": [{ "id": "diablo-iv", "names": ["Diablo IV", "Diablo 4"], "sha256": "…", "size": 9527 }] }` and `GET /v1/icons/<id>.png` the icon itself (a PNG of at most 256 px). 503 and 404 while `TAKEDOWN_CONTACT` is not set. The app downloads the list, matches it on the player's PC and asks only for the icons it needs, so the service sees which icons are asked for, one request each, and nothing else (no log is kept). These two are the only answers that may be cached (5 minutes for the list, a day for a file).
- 60 requests a minute per client, then `429` with `Retry-After`. No CORS: the app calls it from its main process.
- Every other answer is never cached. The service never logs a request, so what a player typed is not kept.

## The dataset

`pnpm --filter @tavora/api dataset` runs on a PC, never on the server. It merges:

1. the app's built-in games (`apps/desktop/src/main/catalog.ts`), which keep their ids,
2. Wikidata (CC0): video games with a Steam application ID (P1733), their English label and aliases,
3. optionally Steam's game list, when `STEAM_WEB_API_KEY` is set.

`--limit <n>` stops after n Wikidata rows (for a quick test; do not commit its registry).

It writes `data/games.sqlite` (not in git) and updates `data/ids.tsv`.

### Ids are frozen

An id is a slug of the game's name, issued once. `data/ids.tsv` lists every id ever issued with its matching keys (`wd:Q…`, `steam:…`). A rebuild reads it first, so a renamed game keeps its id, a new game with the same name gets a suffix, and a game that dropped out of the sources keeps its id reserved. Commit the file after every real build and never edit it by hand. No id starts with `local-`: that prefix belongs to custom games on a player's PC.

## Hosted game icons

Logos only, never covers or artwork: the small icon each game uses itself, kept unchanged (an .ico is turned into a PNG without changing a pixel). Game names and icons belong to their publishers, and Tavora is not affiliated with them: the notice says so in every list, the app shows it wherever it shows the icons, and the website's privacy page repeats it. The icons live in `data/icons` and ship in each release.

```sh
pnpm --filter @tavora/api icon add diablo-iv "Diablo IV|Diablo 4" path\to\Diablo.ico "where it came from"
pnpm --filter @tavora/api icon remove diablo-iv     # a publisher's takedown request
```

Commit `data/icons` and deploy with `scripts/Deploy-Api.ps1`. **A takedown request is met by removing the icon and deploying, the same day.** The service checks every file against its recorded hash and refuses anything that is not a small, well-formed PNG, so a damaged folder never serves a wrong file.

## Tests

`pnpm test` at the repository root. The tests use in-memory datasets and need no network.
