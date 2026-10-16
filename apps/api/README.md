# @tavora/api

Tavora's online game database: a small read-only service that answers game searches from its own dataset. The app asks it; it never calls Wikidata or Steam while running. The only player data it holds is accounts (an email address and its sign-ins), and only once it can send email. Design and decisions: [docs/decisions.md](../../docs/decisions.md) (2026-10-15).

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
| `TAVORA_STATE_DIR` | `data/state` | The one writable place: icons players offered, approved ones and takedowns (`icons.sqlite`), and accounts (`accounts.sqlite`). On the server it is `/var/lib/tavora-api` (systemd `StateDirectory`) |
| `ADMIN_TOKEN` | unset | At least 24 characters. Starts the private review page; without it nothing offered can be approved. Make it with `tavora-api-set-setting admin-token` on the server |
| `TAVORA_TEST_INBOX_PORT` | unset | Development only, ignored when `NODE_ENV=production`: turns accounts on with a test inbox that keeps mail in memory and shows it on `http://127.0.0.1:<port>` (`GET /mails` as JSON, `DELETE /mails` empties it). Without it, and until a mail provider is set up, accounts are off and answer 503 |
| `ADMIN_PORT` | `4011` | The review page's port, always on 127.0.0.1 and never forwarded by the web server |

## API

- `GET /v1/games/search?q=<text>&limit=<1-20>` returns `{ "results": [{ "id": "elden-ring", "name": "Elden Ring", "steamAppId": 1245620 }] }` (`steamAppId` is `null` for games without one; the app uses it to fetch the game's icon from Steam itself), best match first: exact name, exact alias, name prefix, alias prefix, then every word as a word start. Case, accents and apostrophes are ignored. `q` is at most 100 characters, `limit` defaults to 8.
- `GET /v1/health` returns `{ ok, games, builtAt }`.
- `POST /v1/steam/library` with JSON `{ "profile": "<steamcommunity.com profile link or SteamID64>" }` returns `{ "games": [{ "appid": 1245620, "name": "ELDEN RING", "id": "elden-ring" }] }`, sorted by name; `id` is the canonical id when the dataset knows that Steam appid, otherwise `null`. The service asks Steam's Web API with its own key, passes the list straight back and stores nothing. 400 for a profile it cannot read, 404 for an unknown custom name, 502 when Steam fails or the profile's Game details are private, 503 without a key, 415 unless the body is JSON. 6 requests a minute per client. It is a POST so the profile is in no URL.
- `GET /v1/icons` returns `{ "notice": "…", "takedown": "<contact>", "icons": [{ "id": "diablo-iv", "names": ["Diablo IV", "Diablo 4"], "sha256": "…", "size": 9527 }] }` and `GET /v1/icons/<id>.png` the icon itself (a PNG of at most 256 px). 503 and 404 while `TAKEDOWN_CONTACT` is not set. The app downloads the list, matches it on the player's PC and asks only for the icons it needs, so the service sees which icons are asked for, one request each, and nothing else (no log is kept). These two are the only answers that may be cached (5 minutes for the list, a day for a file).
- `POST /v1/icons/submit` with JSON `{ "id": "diablo-iv", "name": "Diablo IV", "source": "installed", "icon": "<base64 PNG or .ico>" }` offers an icon the player's PC has and the service lacks. The id must be a game in the dataset that has no icon yet; the file must be a PNG or an .ico of 32 to 256 px and at most 200 KB. It is cleaned (a PNG keeps only the chunks that make the picture), queued and answered `202 { "status": "received" }`, the same for a new offer, a repeat and a blocked file. Nothing is served until a person approves it, and who sent it is never recorded. `400` for what is not an icon offer, `409` when the game already has an icon, `413` over 400 KB, `415` unless the body is JSON, `503` while `TAKEDOWN_CONTACT` is not set or the queue is full. 10 offers an hour per client.
- **Accounts** (`/v1/account`, design in [docs/decisions.md](../../docs/decisions.md), 2026-10-16). An account is an email address; the player signs in with a 6-digit code sent to it, never a password. JSON bodies only; errors are `{ error, reason }`, and the app translates `reason` (`bad-email`, `bad-request`, `wrong-code`, `too-many`, `mail-failed`, `signed-out`, `same-email`, `email-taken`, `not-found`, `unavailable`). All of it answers `503` while the service cannot send email.
  - `POST /code { email, language }` mails a code (`language` is `en` or `de`) and answers `202 { "status": "sent" }`, the same whether or not the address has an account. A code lasts 10 minutes, a new one replaces the last, 5 wrong tries spend it; one address gets at most 3 codes in 15 minutes and 10 a day (all purposes together), and a client may ask 10 times an hour.
  - `POST /verify { email, code, os, create }` signs in. For an address with an account it answers `{ status: "signed-in", token, device, account }`. For a new address it answers `{ status: "no-account" }` and keeps the code, so the app can ask the player; the same call with `create: true` makes the account (`status: "created"`). `os` is `windows`, `linux`, `macos` or anything else (kept as `other`). A client may check 20 codes in 15 minutes.
  - Signed in, with `Authorization: Bearer <token>`: `GET /` returns `{ account: { email, createdAt }, devices: [{ id, os, createdAt, lastUsedAt, current }] }`; `POST /sign-out` ends this sign-in; `DELETE /devices/<id>` ends another; `POST /email/code { email, language }` and then `POST /email { email, code, language }` change the address (the code goes to the new one, a notice to the old one, and `409 email-taken` comes only after the right code); `POST /delete/code { language }` and then `POST /delete { code }` delete the account and every sign-in at once. A token unused for a year stops working. `GET /profile` returns `{ profile: { name, initials, picture, updatedAt } | null }` and `PUT /profile` with the same fields keeps it unless the account already has a newer one (`updatedAt`, never later than now), answering with what the account has; `picture` is a base64 PNG of 256 px and at most 512 KB, or `null`; the name is at most 32 characters, the initials 3. The profile is only ever shown to its owner.
  - Kept: the address, when the account was made, the profile (name, initials, picture, when it changed), and per sign-in a hash of its token, the operating system and two dates. Codes and the per-address counters are kept under a hash of the address and are gone within a day. No connection address and no PC name is stored.
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

### Reviewing what players offer

Offers wait in the state file until a person approves them. The review page is a second, private listener (`ADMIN_PORT`, 127.0.0.1 only, never forwarded by Caddy) and every call needs the `ADMIN_TOKEN` in an `X-Admin-Token` header, so reaching it takes the server and the token.

```powershell
ssh root@100.64.0.1 tavora-api-set-setting admin-token      # once: prints a token, save it (done 2026-10-15: D:\Server\tavora-icon-admin-token.txt)
apps\api\scripts\Open-IconReview.ps1                           # opens an SSH tunnel and the page
```

The everyday way in is `https://tavora-iconreview.taile00b16.ts.net`, from any device on the tailnet, with no password. `tools/icon-review/proxy.mjs` runs on this PC as the tracker project "Tavora-IconReview" (prod port 4100, Tailscale name `tavora-iconreview`): it keeps an SSH tunnel to the server's review page and adds the admin token itself, so nothing on the server changes. It answers only to `127.0.0.1`, `localhost` and its tailnet name. Once an hour (first check three minutes after it starts) it looks at the queue, and when offers are waiting that it has not announced yet it posts to tracker's `/api/notify` on this PC: a Windows notification and a phone push (tap it to open the project in tracker). Announced offers are remembered in `notified.json` beside the proxy, so restarts do not repeat them. Install or update it with `tools\icon-review\Install-IconReview.ps1` (copies to `D:\Server\tracker\Tavora-IconReview`), then restart the project's prod server in tracker. Its log is `D:\Server\tracker\Tavora-IconReview\logs\proxy.log`. `Open-IconReview.ps1` stays as a fallback.

The page has two tabs, **Needs review** (the default) and **Hosted** (with a search box, and its pictures load only when opened). The first shows each offered icon the way the app shows it (on a tile, small, and on a light background), the game it is offered for, how often the same file was offered and where it came from, with **Approve**, **Deny** and **Deny and block** (the same file is refused for ever). Approving publishes the icon at once under the game's name and the name it was offered under, and drops the other offers for that game. The page's second list shows the hosted icons with **Take down** (a publisher's request, effective at once; a release icon also has to be removed with `pnpm --filter @tavora/api icon remove <id>` and deployed) and **Take down and block**. An approved icon wins over a release icon of the same game, and a takedown of a release icon stays in force until it is deployed away.

Set where publishers send removal requests with `ssh -t root@100.64.0.1 tavora-api-set-setting takedown`; hosted icons are only served while it is set.
## Tests

`pnpm test` at the repository root. The tests use in-memory datasets and need no network.
