# Module isolation threat model

**Status:** updated for Milestone C (2026-10-15); G1–G9 date from Milestones A and B, H1–H5 were added for the host UI in C. Covers the local desktop host only; the catalog, publishing pipeline and update channel get their own model in Milestone E.

## What we protect

| Asset | Why it matters |
| --- | --- |
| The player's machine (files, processes, credentials, game memory) | A module must never become a way into the OS. |
| Each module's stored data, per game | Builds, notes and plans the player made with that module. |
| Other modules' data | One module must not read or corrupt another's data without an explicit grant (grants arrive in Milestone F). |
| The trusted context: which module is running, for which game | Everything else (storage, grants, permissions) is keyed on it. If a module can lie about it, every other check fails. |
| Network privacy | A module must not send player data anywhere without declared, consented, mediated access. |
| Host availability | A broken or hostile module must not take down Tavora or other panels. |

## Trust boundaries

```
 ┌──────────────── Tavora Desktop (Electron main process) ───────────────┐
 │  trusted: module registry, storage, layout, bridge, permission checks │
 └──────▲───────────────────────▲────────────────────────▲───────────────┘
        │ ipc (host preload)    │ MessagePort (bridge)   │ MessagePort (bridge)
 ┌──────┴───────┐        ┌──────┴────────────┐    ┌──────┴────────────┐
 │ Host UI      │        │ Module A view     │    │ Module B view     │
 │ trusted code │        │ UNTRUSTED code    │    │ UNTRUSTED code    │
 │ default sess.│        │ own session/origin│    │ own session/origin│
 └──────────────┘        └───────────────────┘    └───────────────────┘
```

- **Main process:** trusted. Only place with Node/OS access. Validates every bridge message.
- **Host UI renderer:** trusted code, still sandboxed with no Node. Talks to main only through a small preload API; main checks the sender is the host window.
- **Module renderers:** untrusted. Each module (per game) gets its own Electron session (`persist:module:<moduleId>@<gameId>`), its own origin (`tavora-module://<moduleId>/`), a separate renderer process from the host and from other modules, `sandbox: true`, `contextIsolation: true`, no Node, no `<webview>`.

## Attacker

A published or locally installed community module whose author is hostile, or whose dependencies were compromised. It controls all JavaScript, HTML and CSS in its own bundle and can send any bytes over its bridge port. It does not control the host, the main process, or other modules' bundles.

Out of scope for Milestone A: a malicious host build, local malware already running as the user, physical access, and the update/signing channel.

## Required guarantees (Milestone A and B gates)

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| G1 | No module can reach Node, Electron or OS APIs | sandbox, context isolation, no node integration, module preload exposes nothing | e2e: hostile module probes `require`, `process`, `ipcRenderer`, `electron` |
| G2 | No module can read or write another module's storage | host storage keyed by bound identity; separate sessions for web storage | unit + e2e: hostile module cannot see the other module's keys or localStorage |
| G3 | No module can choose or spoof its identity or game | identity bound in main to the sending webContents when the port is created; message params never carry identity | unit + e2e: forged `moduleId`/`gameId` fields are ignored |
| G4 | No network access unless the host mediates it | CSP, `webRequest` deny-all except own origin, unreachable proxy, WebRTC limited to proxied UDP | e2e: fetch, image, WebSocket, beacon and navigation to a local test server all fail, server sees zero hits |
| G5 | A crash, hang or failed load does not take down the host or other modules, and loses no saved data | separate renderer processes, `render-process-gone` and HTTP status handling, a heartbeat to each panel's preload, Reload and Stop actions, atomic writes | e2e: crash, hang and load-failure recovery with the other module still working and data intact |
| G6 | Modules can't escape their own bundle on disk | protocol handler resolves real paths inside the module root only | unit: `..`, encoded `..`, backslashes, null bytes, symlinks out of the root |
| G7 | Modules can't open windows, navigate away, download or request device permissions | `setWindowOpenHandler` deny, `will-navigate` same-origin only, downloads cancelled, permission handlers deny | e2e: `window.open`, cross-origin navigation |
| G8 | A module can't exhaust host resources through the bridge | the module's port ends in its own page: Tavora's module preload (`preload/relay.ts`) measures every message (plain JSON only, 8 MiB, 64 requests and 16 MiB in flight, no reused ids) before passing it on, so a huge message is refused inside the module's own renderer and the main process never receives it; the host checks again (`bridge.ts`); quotas for settings, documents and panel state | unit: `relay.test.ts`; e2e: oversized, over-quota and flood tests (a flood of 400 MB messages crashed the main process before the relay, found in the 2026-10-16 sandbox review) |
| G9 | A module can't use a capability it was not granted | reserved methods checked against the granted set (always empty in v1) before anything else runs | unit + e2e: `network.fetch`, `files.open`, `clipboard.readText`, `sharedData.read` fail with `PERMISSION_DENIED` |
| G10 | A module's icon cannot run anything or read outside its package | the manifest names a .png or .webp inside the package; the host resolves it like any asset (no traversal, no links out), reads at most 256 KB, accepts it only with a PNG or WebP signature and hands the host UI a data address shown as a plain picture, so an SVG or script renamed to .png is dropped | unit: `module-icon.test.ts`, `registry.test.ts`, `module-schema` (no svg, no remote icon) |
| G11 | A module can't fill the player's disk through its own browser storage | Chromium lets a module's IndexedDB and file system grow to about 60 % of the disk and has no per-origin quota to set, so the host measures the session's folder every second while a panel is open (`storage-guard.ts`); past 256 MB (or 5,000 files) it ends the module's renderer, clears the session's storage, restarts the panels and tells the player. A module can still write for up to one second first (a few hundred MB on a fast disk), which is accepted | unit: `storage-guard.test.ts`; e2e: `sandbox-review.spec.ts` (limit lowered to 16 MB with `TAVORA_MODULE_STORAGE_LIMIT_MB`, development builds only) |

## Host UI guarantees (Milestone C)

Milestone C added a library, docking, saved layouts, Trash, search and a default look injected into modules. These are the new ways a module or a bad file on disk could reach the host.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| H1 | Only the host window can drive the host | every `host:*` IPC handler checks the sender is the host window's main frame; a module view has no host preload and cannot reach them | no module-side test; the check is one shared `fromHost` function in `host.ts` |
| H2 | The host UI can only ask for actions the host understands | one `host:action` channel; every request is strictly parsed, anything else is refused with a generic message | unit: `parseAction` accepts and rejects cases (`actions.test.ts`) |
| H3 | A malformed or oversized layout is refused, never saved or applied | layouts are validated and size-limited in the main process before they are stored or used to place views | unit: valid, too deep, and pruning cases (`layout.test.ts`) |
| H4 | Removing a game removes its data after the Trash period | Trash keeps a game for 30 days, then startup deletes its module data and browser storage | unit: library Trash rules (`library.test.ts`); deletion of the data on disk is not covered by an e2e test |
| H5 | The injected default look cannot give a module more power | host-written CSS is added as a *user* stylesheet; a module's own rules win and it carries no script | none; reviewed by hand |
| H6 | Finding a game's Steam icon cannot read or write anything it should not, or reach anywhere else | only the main process does it. It reads exactly two things from the Steam folder, `appcache/appinfo.vdf` (read-only, at most 256 MB, parsed with every read bounds-checked, a depth limit and no code run; a damaged entry loses only that game) and `steam/games/<hash>.ico` where `<hash>` must be 40 lowercase hex characters, so no path can leave that folder. A file from disk or from the one fixed icon address (numeric id and hash only, no cookies, no referrer, no redirects, 10 s) must be a well-formed ICO of at most 1 MB and is stored under `<digits>.ico`; a saved or forged file name that is not that is dropped on load. Modules never see it | unit: `steam-appinfo.test.ts` (versions 39 to 41, damaged and hostile files), `steam-icons.test.ts` (names, hashes, ICO check, address, headers, sizes, Steam folder lookup), `icon-sync.test.ts`, `library.test.ts` (loading) |
| H7 | Finding a game's icon from the installed game (0.4.2) cannot run, change or leak anything | only the main process does it. It runs `reg query` on three fixed `Uninstall` keys and GOG's key (read-only, 15 s, output capped), and reads `*.item` files from Epic's fixed manifest folder. Only a name and an absolute `.exe` or `.ico` path are kept (no `..`, no network paths, an Epic launch program must stay inside its install folder). The PE reader only reads: it takes the resource tree of the program a few kilobytes at a time, checks every offset against the file and the section table, caps directories, frames (512 KB each) and the result (1 MB), and returns null on anything odd; no program is started or loaded. The result must pass the ICO check and is stored as `exe-<gameId>.ico`, a name only that game can have; a saved or forged name is dropped on load. The small Steam icon is a `.jpg` (JPEG signature, at most 1 MB) from the same fixed address, found with a numeric appid and sent no cookies or referrer. Nothing about installed games is sent anywhere | unit: `pe-icon.test.ts` (a built program, group choice, size limits, truncated, wrong and hostile files), `launcher-games.test.ts` (registry and manifest parsing, names, `DisplayIcon` forms, hostile paths), `steam-icons.test.ts` (file names, public API, JPEG), `icon-sync.test.ts` (order, fallbacks, deleted games); run once by hand on a PC with Battle.net |
| H8 | Hosted game icons (0.4.3) cannot be used to run code, fill the disk or follow a player | the service only reads its own icon folder at start: every file must be a PNG with right chunk checksums, at most 256 px and 200 KB, and match the hash recorded for it, else it is left out; an icon id is lower-case letters, digits and dashes, so no path can leave the folder; only GET is routed, there are no uploads yet, and the routes answer 503 and 404 until a takedown contact is configured. Icon answers are the same for everyone and may be cached; everything else is never cached, and no request is ever logged. In the app only the main process asks: the list is capped (5000 entries, every field checked), a file must have the size and hash the list promised, a PNG signature and a header of at most 256 px, at most 200 KB, and is stored as hosted-<gameId>.png, a name only that game can have; no cookies, no referrer, no redirects, 5 s; and nothing is asked while Online game search is off. The service sees which icon files are asked for, from an address it does not keep | unit: png.test.ts, icons.test.ts, icon-files.test.ts, app.test.ts (icon endpoints) in apps/api; hosted-icons.test.ts, icon-sync.test.ts, steam-icons.test.ts, library.test.ts in the app |
| H9 | Offered icons cannot harm the service, sneak in, or reveal who sent them | the one write route only queues: JSON only, at most 400 KB, 10 an hour per client, a game known to the dataset, a PNG or .ico of 32 to 256 px and 200 KB that must pass the same chunk-by-chunk checks as every hosted file, then cleaned down to its picture chunks so nothing hidden is kept; the queue is capped (300, 5 per game), a blocked file is dropped without saying so, and every answer for an accepted, repeated or blocked file is the same 202. No sender is recorded: only the file, the game id, a name, a source word, a counter and times, and the service keeps no request log. Nothing offered is served until a person approves it. The review page is a separate listener on 127.0.0.1 that the web server never forwards, every call needs the admin token (compared in constant time) and a change needs JSON, so a web page on another site cannot send one; its content security policy allows only its own script and style, and it builds every card with textContent, so a name or id from a player is never markup. The writable state is one SQLite file in a systemd state folder (mode 0700), the only place the service can write | unit: `png.test.ts` (cleaning), `submissions.test.ts` (rules, caps, blocking, approval, takedown), `app.test.ts` (offer route), `admin-app.test.ts` (token, JSON-only changes, headers, no innerHTML); run by hand: offer, review, approve and takedown over real HTTP, and the page rendered with offers |
| H10 | Offering an icon from the app cannot send anything the player did not see, or anything but their game's own local icon | the offer is made only by pressing Share in a dialog that shows each icon and states what is sent; the main process then reads the icon file itself from the app's own icon folder (the file name must be an installed-game or Steam client icon, never a picked image, a hosted icon or Steam's small one), keeps only its biggest frame, and sends JSON with the file, the game's id, its name and a source word, with no cookies, no referrer, no redirects and no other field; the host UI can ask for at most 50 games and only ones that pass the same rule again in the main process, so a forged request cannot name another file; a game is offered once; nothing is sent while Online game search or the icons setting is off. The service queues it for review (H9) | unit: `share-icons.test.ts` (what can be shared, the biggest frame, the request), `actions.test.ts` (the action's shape and limits), `library.test.ts` (the flags); run by hand: the real app offered an icon to a local service and it arrived in the review queue |

## Browser panel guarantees (0.5.6)

The Browser panel shows any website, so its attacker is any page, not a module author. It is built into the host and has no preload, no bridge and no IPC. Design: [browser-security.md](browser-security.md).

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| B1 | A page cannot reach Node, Electron, IPC or the host | own `WebContentsView` with `sandbox`, `contextIsolation`, no node integration, no preload, no `<webview>`; the toolbar is host UI | e2e: page probes `require`, `process`, `ipcRenderer`, `electron`, `tavoraHost` (`browser.spec.ts`) |
| B2 | A page cannot read module bundles or another game's browser data | sessions `persist:browser@<game>` and `persist:browser`, which register no `tavora-module:` protocol; only http(s), ws(s) requests pass | e2e: `tavora-module://` fetch fails; a cookie set in one game is absent in another |
| B3 | Only http(s) pages open; no external protocols | `will-navigate`, `will-frame-navigate` and `will-redirect` checks, request filter by scheme, `openExternal` permission denied | unit: `browser-url.test.ts`, `browser-filter.test.ts`; e2e: `file:`, `tavora-module:`, `steam:` and a redirect to `file:` refused |
| B4 | No new windows; a clicked new-window link opens as a new Browser tab | window open handler always denies, and opens the link as a new Browser panel (no opener) only within 1 s of a click or key press | e2e: `window.open` without a click and a clicked `target=_blank` link |
| B5 | Downloads never write a file | every session cancels `will-download`; the toolbar says so | e2e: a download link leaves no file |
| B6 | Permissions are denied except clipboard write and fullscreen, which stays inside the panel | permission request and check handlers, device and display-media handlers deny; `disableHtmlFullscreenWindowResize` | e2e: notifications, geolocation, camera denied; fullscreen leaves the window as it is and Esc exits |
| B7 | A public page cannot reach this PC or the local network | requests to loopback, private and link-local addresses and `.local` names are cancelled unless the page itself is local; navigation and redirects there from a public page are refused | unit: address classification; e2e with host resolver rules |
| B8 | Bad certificates are refused, never clicked through | Chromium's default verification; the panel shows an error | e2e: self-signed HTTPS server |
| B9 | The toolbar shows the true address | host-drawn toolbar; labels in non-Latin scripts shown as punycode | unit: `displayHost` |
| B10 | Deleting a game deletes its browser data, and only sites the player shares use the shared session | `orphanedPartitions` covers `browser@<game>`; registrable-domain matching | unit: `host-files.test.ts`, `browser-url.test.ts`, `library.test.ts`; e2e: shared and per-game cookies |

Ad blocking runs in the main process on every browser request with a filter engine compiled at build time from EasyList and EasyPrivacy; it adds no script to pages.

Also changed in C: Ctrl+K is caught by the host before any page, so a module cannot take it over, and panels in background tabs are hidden and suspended through the same lifecycle events as before.

## Discord panel guarantees (0.5.7)

The Discord panel shows who is in the player's voice channel. The main process reads it from the Discord desktop app on this PC over Discord's local connection (RPC: a named pipe or Unix socket), and the host UI draws it; there is no page, view or module code. What Discord says (names, channel names, ids) is untrusted text. Tavora's Discord application is a public client and signs in with PKCE, so no Client Secret exists on any PC or server. While Discord limits RPC to the application's testers (up to 50), only they can press Authorize.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| D1 | The sign-in only ever goes to Discord, and no secret exists | each sign-in makes a new random code verifier; its hash goes only to the local Discord app and the verifier, the code and the refresh token only in the token request to `https://discord.com/api/oauth2/token` (no redirects, no `client_secret`); the access token only to the local Discord app; none of it is ever sent to the host UI, a module or Tavora's service (the host UI learns only the status) | unit: `discord.test.ts` (the verifier matches the challenge, is new each time, and no request holds a secret); e2e: `discord.spec.ts` |
| D2 | Tavora reads voice, and only changes the player's own voice when asked | the scopes asked for are `rpc`, `rpc.voice.read`, `rpc.voice.write` and `identify`; the commands that change anything in Discord are `SELECT_VOICE_CHANNEL` (join a channel Tavora showed or remembered, or leave; 0.5.10), `SET_VOICE_SETTINGS` (mute and deafen the player; 0.5.11) and `SET_USER_VOICE_SETTINGS` (the volume of a person in the player's own call and "mute for me", which only change what the player hears; 0.5.22), each sent only after the player used its control, and never for the player themselves; muting needs the write scope, which a sign-in made earlier gets only after the player presses Allow muting and approves it in Discord; nothing else is written | unit: `discord.test.ts` (join, leave, mute, unknown channel, no write scope), `actions.test.ts`; the AUTHORIZE scopes |
| D3 | The sign-in is kept encrypted on this PC | `discord.json` holds only safeStorage-encrypted data (DPAPI, Keychain, secret service); where only Linux's plain-text fallback exists nothing is saved; a file from another user or PC is ignored | unit: `discord-store.test.ts` (also: a Client Secret an older version kept is dropped); e2e: the file does not contain the token |
| D4 | Nothing Discord sends can run or reorder the page | every value is checked (ids are Discord ids, names lose control and direction characters and are cut to 64 characters, lists are capped) and shown as text; frames over 1 MB close the connection | unit: `discord-voice.test.ts`, `discord-rpc.test.ts` |
| D5 | Pictures come only from Discord's image server and only as small PNGs | avatar and server icon addresses are rebuilt from checked ids and hashes on `https://cdn.discordapp.com/`; no cookies, referrer or redirects; at most 256 KB with a PNG signature, passed on as a data address | unit: `discord-voice.test.ts` |
| D6 | Nothing happens until the player asks | the connection only runs while a Discord panel is open, and Discord's approval is only asked for when the player presses Connect; closing the last panel disconnects | unit: `discord.test.ts`; e2e: no command before Connect |
| D7 | Only the main process and the host window talk about Discord | `host:get-discord` and the `discord-*` actions answer only the host window's main frame, like every `host:*` call; the actions are checked by `parseAction` | unit: `actions.test.ts` |

## Links from modules (0.11.0)

A module can ask the host to open a web address in the Browser (`links.open`, used by Notes). This is the first call that lets a module cause something outside its own panel, so it gets its own guarantees.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| K1 | A module cannot open a link on its own | the module preload reports clicks and key presses only when `event.isTrusted` (a script cannot make an event trusted); the host refuses `links.open` unless one came within 2 s, and uses it up: one click opens one link | unit: the bridge passes the host's refusal on (`bridge.test.ts`); the gesture check is in `module-view.ts`, reviewed by hand |
| K2 | Only web addresses open | the main process checks the address is `http` or `https` with a host and at most 2048 characters; `file:`, `javascript:`, `data:`, `mailto:` and custom schemes are refused | unit: `bridge.test.ts` (types and length); `browser-url.test.ts` (`isWebUrl`) |
| K3 | The module learns nothing from opening a link | the answer is `null`; no panel id, no page content, no address back | unit: `bridge.test.ts` |
| K4 | The page opens like any link in the Browser | it uses the Browser panel's own sessions (private addresses get their own kind), its blocking and its permissions; a full workspace shows the usual notice | the Browser panel guarantees B1–B7 |
| K5 | Opening in the system browser cannot be forced or redirected by a module | the module only asks (`links.open`); when the game has no Browser panel the host keeps the address itself and asks the player in its own dialog (`pendingLink`); the answer (`link-choice`: panel, system or cancel) carries no address, so the host UI cannot swap it; the address is checked as a web address again before `shell.openExternal` | unit: `actions.test.ts` (`link-choice` parsing); the dialog and the `openExternal` call are reviewed by hand |

Accepted: a module can still show a fake button and get the player to click it, which opens a link in the Browser. That is the same as any web page's link, the player sees the new tab, and the Browser is sandboxed.

## Module files (0.12.0)

A module can keep pictures in a folder Tavora manages (`blobs` in the SDK, used by Notes for images). Files are written by the main process from a request body, never by the module.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| F1 | A module reaches only its own files, for the current game | the files are served and stored inside the module's own session (one per module and game), which answers only to its own address; the folder is `<root>/<module id>/<game id>` from ids the host validated | unit: the bridge and `blobs.test.ts` use one store per module and game; the session wiring is reviewed by hand |
| F2 | A module cannot choose where a file goes or read anything else | the module never gives a name or a path: the host makes a random 128-bit id, and every id it receives must match 32 lowercase hex characters before it touches a path | unit: `blobs.test.ts` ("refuses ids that are not ours"); `bridge.test.ts` |
| F3 | Only pictures are stored, and a picture cannot run | the kind is judged from the first bytes (PNG, JPEG, GIF, WebP); SVG, BMP and everything else are refused; files are served with their own type, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-origin` | unit: `blobs.test.ts` (sniffing, serving headers) |
| F4 | A module cannot fill the disk | 50 MB per file and 500 MB per module and game, checked while the body streams in; a refused or cut-off write removes its temp file, and leftovers are cleaned up on the next listing | unit: `blobs.test.ts` (limits, leftovers) |
| F5 | Files go with the game | deleting a game from the Trash removes its folder under every module; daily backups include the files unless the snapshot would be too big, as with pictures | unit: `gamedata.test.ts`; `backup.test.ts` |
| F6 | No other page can read or write them | only the module's session handles `/_blobs/`; the Browser and the host UI use other sessions, and the answers are same-origin only | no test; reviewed by hand |
| F7 | Only the player decides where the files go | the folder is picked in the system's own dialog, opened by the host when the host window asks (`module-files-change`, parsed by `parseAction` with no fields); a module cannot trigger it, name a place or learn the path | unit: `actions.test.ts` |
| F8 | Moving never loses or mixes up a picture | the files are copied and each copy's size checked before the setting is switched, the old files are removed only after that, a cut-off move can be run again, and nothing new is accepted while it runs | unit: `module-files.test.ts` (copy, checks, resume, lock) |
| F9 | A move cannot be pointed at something it should not touch | the files go into a folder of their own inside the place picked; places inside the current folder or around it, the same folder, Tavora's own data folder and folders that can't be written to are refused; only files named like ours (`<module>/<game>/<32 hex>.<png/jpg/gif/webp>`) are copied or removed | unit: `module-files.test.ts` (`filesTarget`, listing) |

Accepted: a module can use its whole 500 MB share; Notes shows the usage. A folder the player moved is not part of the daily backup, and one on a drive that is unplugged shows the pictures as missing, with a notice, until it is back; nothing is deleted or re-pointed meanwhile.

## Clipboard from modules (0.14.1)

A module can put a PNG on the system clipboard (`clipboard.writeImage` in the SDK, used by the Whiteboard for Copy as picture). This changes something outside the module, so it gets its own guarantees. It cannot read the clipboard.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| C1 | A module cannot change the clipboard on its own | the same click and key press check as links (K1): the preload reports real input only, the host accepts a write within 2 s of one and uses it up, so one press writes one picture | e2e: refused without a key press, accepted after one, refused again straight after (`official-modules.spec.ts`); unit: `clipboard-http.test.ts` |
| C2 | A hostile file cannot reach an image decoder in the main process | the body is a PNG only if every chunk has a right checksum, the header comes first, there is picture data, the end marker is last with nothing after it, and the size is within 16384 px a side and 100 million pixels; it is read with a hard limit of 20 MB; nothing is decoded by the main process, the checked bytes go to the clipboard as `image/png` | unit: `clipboard-http.test.ts` (`checkPng`: cut off, damaged, padded, too large, not a PNG) |
| C3 | A module cannot read the clipboard | there is no read call; the route only accepts POST | none needed; reviewed by hand |
| C4 | Only the module's own page can use it | the address is answered inside the module's own session; the Browser and the host UI use other sessions | no test; reviewed by hand |

Accepted: a module can label a button misleadingly ("Save") and replace what is on the clipboard when the player clicks it. The player pasted nothing yet and the module learns nothing, so this is a nuisance, not a leak.

## WebAssembly for Tavora's own modules (0.14.6)

Excalidraw, which the Whiteboard is built on, resizes pictures with WebAssembly. Every module page has the policy `script-src 'self'`, which blocks that, so a module can now ask for `permissions.webAssembly`.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| W1 | Only Tavora's own modules can run WebAssembly | the manifest field is accepted but the registry refuses to load a module from the player's folder that sets it (with a message on the Modules page); the policy gets `'wasm-unsafe-eval'` only when the module is official and asked for it | unit: `registry.test.ts`, `assets.test.ts` (`moduleCsp`), `module-schema` |
| W2 | The relaxation is as narrow as the policy allows | `'wasm-unsafe-eval'` allows compiling WebAssembly and nothing else: no `eval` of strings, no inline script, no remote code (`script-src` stays `'self'`, `connect-src 'self'`); the module is still sandboxed, with no network and no host access beyond the SDK | unit: `assets.test.ts` (policy is otherwise unchanged) |

Accepted: WebAssembly widens what a bug in the browser engine could be reached with, for the one official module that needs it. Community modules do not get it until there is a reviewed way to grant it.

## Known limits and open risks

- **Webview isolation is not proven safe by this spike.** It relies on Chromium site isolation and the OS sandbox. A Chromium renderer exploit would break G1–G4. Mitigation: keep Electron current, enable the OS sandbox everywhere, Electron fuses are set at packaging time (`electronFuses` in `apps/desktop/package.json`, checked 2026-10-16 with `@electron/fuses read` on a packaged build): `RunAsNode`, `NODE_OPTIONS`, `--inspect` and extra `file://` privileges are off, cookie encryption is on. ASAR integrity is not used because the app ships unpacked (`"asar": false`); someone who can edit Tavora's files can already act as the player, so this is accepted.
- **The gate tests need the OS sandbox on.** They run as a normal user (Chromium refuses its sandbox as root), and CI allows unprivileged user namespaces so the sandbox works there too. A run with `--no-sandbox` would not prove G1.
- **DNS prefetch and other browser side channels** may still leak hostnames even with requests blocked. Needs a packet-level check on Windows and Linux.
- **Timing and covert channels** between modules on the same machine are not addressed.
- **The heartbeat cannot tell a hang from long synchronous work.** A module that blocks its main thread for more than 10 s is shown as not responding until it answers again. That is the honest state from the player's view, but the Stop action ends it.
- **Same module, several panels** share a renderer process. A crash in one instance can take down its siblings of the same module, not other modules.
- **Data a module already received cannot be recalled** after a grant is revoked (relevant from Milestone F).
- **Browser: no Safe Browsing.** A phishing page still renders; downloads, permissions and external protocols are refused. **DNS rebinding** can still point a public name at a local address, because B7 looks at the name, not the resolved address. **Sign-in popups** that need `window.opener` do not work, because new windows open in the same panel. Ad blocking is network-only, so empty ad boxes can remain and in-video ads are not reliably blocked.
- **Discord: the local pipe is trusted.** Whatever listens at `discord-ipc-0` gets the Discord access token, and anything already running as the player could listen there. Such a program can read the player's files anyway, so this is accepted. Tavora's application is a public client, so anyone can start a sign-in with its client id; that only asks the person for their own approval in their own Discord app, and Discord's tester limit decides who gets a token. No player handles a secret.
- **Tauri was not evaluated.** Electron was spiked first for a single Chromium engine on Windows and Linux. Revisit only if memory overhead is unacceptable.

## Sandbox review 2026-10-16

Foundation 1 core list, item 7: review the module sandbox before the first outside developer gets the SDK. Scope, agreed with Nik: the sandbox as it is (G1–G10 and what sits around them), the install path (folders, manifest and id rules), and the electron packaging the model counts on. Module grants (Milestone F) are a separate design; this section only lists what they must not break. The attacker is the one assumed above: a hostile module author or a compromised dependency, with the module delivered to other people's PCs.

Method: read the main-process side (`module-view.ts`, `bridge.ts`, `assets.ts`, `storage.ts`, `documents.ts`, `registry.ts`, the module preload, `module-schema`, `index.ts`), ran the existing isolation gate tests on a clean `main`, then wrote new hostile-module probes (`test/fixtures/hostile-module`, `test/e2e/sandbox-review.spec.ts`) for what the model claimed but no test covered. Each probe printed what a hostile module can do before any fix was written.

### Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| S1 | High | **A module could crash the whole app through the bridge.** Three 400 MB messages killed the main process (`OOM error in V8`). The bridge could only check a message's size after the main process had received it, so G8 did not hold; 40 messages of 8 MiB also grew the main process by about 560 MB. A big `ArrayBuffer` looked tiny to `JSON.stringify`, so the size check would not have seen it either. | Fixed (0.7.1): the module's port ends in its own page, and `preload/relay.ts` measures every message before passing it on. G8 updated. |
| S2 | Medium | **A module could fill the player's disk.** The quotas covered only bridge storage; a module's own IndexedDB and origin-private file system took 192 MB each with no error, and Chromium reported a 23 GB quota (about 60 % of the disk). An in-memory session does not help (it moves the problem to RAM, 5 GB). | Fixed (0.7.2): the host measures the session folder every second and clears it past 256 MB (G11). A module can still write for up to one second first; accepted. |
| S3 | Low–Medium | **No Electron fuses were set**, although this model counted on them. With `RunAsNode` on, one environment variable turns the signed `Tavora.exe` into a Node interpreter. ASAR integrity cannot apply because the app ships with `asar: false`. | Fixed (no version change): fuses set and read back from a packaged exe. The ASAR point is accepted. |
| S4 | Low | **Dev-only switches worked in packaged builds**: `TAVORA_USER_DATA`, `TAVORA_MODULE_DIRS`, `TAVORA_OFFICIAL_MODULE_DIRS`, `TAVORA_OFFICIAL_THEME_DIRS`. The `OFFICIAL` one could list any module as Official. Needs control of the environment Tavora starts in, so local malware, which is out of scope. | Fixed with S3. |
| S5 | Medium | **A module id is a claim, not an identity.** Data is keyed by the manifest's `id`, and removing a module keeps its data (a decision, so adding it back brings it back). A different module that later claims the same id inherits that module's documents, settings and web storage. It needs the player to install it, and two modules with one id cannot run together. | Decided 2026-10-16, not built: data is keyed by owner (a signing key, `local` or `official`) and id; see "Publisher binding" below and decisions.md. Until it is built, accepted as before: install modules only from a source the player trusts. |

### What held

All of G1–G10 passed on a clean `main` (`isolation.spec.ts`), and these new probes found nothing: service workers (the scheme has no worker privilege), dedicated workers from a blob (blocked by the request filter), WebRTC (a UDP listener heard nothing), WebTransport (CSP), frames to the network, `window.open`, path traversal in assets and manifest paths, the `tavora.` id prefix, duplicate ids, manifest field checks, and spoofing identity through message fields. The new gate tests keep the WebRTC, worker and WebTransport results from regressing.

### Accepted limits

- A module can use all the CPU and memory its own renderer can get. The panel shows "not responding" and the player can Stop it; there is no hard cap. A module that allocates until the PC runs out of RAM is not prevented. (Unchanged from the limits above.)
- A module's panels of one game share a renderer process (listed above).
- A module can write browser storage for up to one second (a few hundred MB on a fast disk) before it is cleared.
- Local files of Tavora are not protected from someone who can edit them: that person can already act as the player.

### Verdict for the SDK

No finding met the blocking rule agreed for this review (a hostile module reading or writing outside its own module and game, running code outside its sandbox, or sending data off the PC). S1 was fixed anyway because it broke a stated guarantee and let a module take down the whole app. The SDK can go to a first outside developer once the fixes for S1 to S3 are released. S5 is the reason modules must still be installed from a source the player trusts until the catalogue has publisher identity.

### Rules for a future zip installer

There is no installer today; modules are folders in `modules` in the data folder. When one is built, it must:

1. Read the manifest from the archive and validate it with `validateManifest` before extracting anything.
2. Extract only regular files: refuse links, absolute paths, `..`, drive letters, reserved Windows names and duplicate paths that differ only in case.
3. Cap the archive size, the unpacked size, the number of files and the compression ratio.
4. Check the signature before extracting and record the owner (the key, or `local` for an unsigned zip) in the host's own list. Refuse an id that starts with `tavora.`, and an id already installed unless the zip is signed by the same owner (an update).
5. Key data by owner and id, so a module from a different owner starts empty and never sees data another owner left under its id (S5; "Publisher binding" below). Never ask at install whether to hand data over.
6. Install into a temporary folder and rename it into place, so a half-extracted module is never loaded.
7. Never run anything from the archive.

The existing folder loading already meets the manifest, path and id rules (`validateManifest`, `resolveAsset`, `discoverModules`).

### Publisher binding (S5, decided 2026-10-16)

The owner of a module's data is who signed it, not the id it claims. Decided with Nik; the full rules are the 2026-10-16 publisher row in decisions.md.

- Owners: `official` (Tavora's own folder), `local` (unsigned folder modules and zips) or an Ed25519 key's fingerprint. Documents, settings and web storage are keyed by owner and id, so the S5 attack (claim a removed module's id) gets an empty store.
- The secret key stays on the developer's PC. Tavora's servers hold only public keys, so a break-in there cannot sign a module.
- Data moves between owners only by (a) the player clicking "Move data from the local copy" in Settings > Modules, from `local` to a signed module of the same id, or (b) a key succession statement signed by Tavora's catalogue key after an account replaced a lost key. Never by a prompt at install.
- The owner is checked at install and stored by the host, outside the module's folder. Someone who can edit the data folder can already act as the player (accepted limit above).
- The catalogue accepts `<prefix>.*` only from keys of the account that reserved the prefix. Zips shared by hand get no such check; the player sees the key's fingerprint, or the profile name once the key is linked to an account.
- Grants (Milestone F) are recorded for owner, id and version, using the same owner.
- Revocation: an account can revoke a leaked key. The service publishes a revocation list signed by the catalogue key; the catalogue refuses uploads from a revoked key and notifies the owner, and the app refuses installs and updates from it, with an opt-in Report (module id, key fingerprint and zip hash only). Packages the catalogue accepted under the key before revocation stay valid by hash, since a signature cannot prove its own date. The owner id is the first key's fingerprint and never changes with a succession.
- Open risk: a stolen key works until its owner notices and revokes it, and a player who is offline or has online features off does not get the list. A developer without an account cannot revoke at all. Accepted by Nik: players are usually online while gaming, so the list reaches them soon.

### What module grants must not break

For the Milestone F design (backlog):

- A grant is decided by the host from the player's consent, recorded for a module id, version and publisher. The manifest alone is never enough. Every granted method is checked again on each call in the main process, like G9.
- The bridge relay and its limits apply to what a grant returns too. A file or network response is capped in size before it reaches the page.
- Network: the main process makes the request against hosts the player consented to. No raw sockets, no cookies from the player's sessions, size and time limits, and the DNS-rebinding limit of the Browser (B7) applies.
- Files: only folders the player picked in a host dialog, read-only first, paths made real before use, no links out, size caps.
- Commands: a named command with fixed arguments, no shell, a time limit and an output cap (the Codex case).
- Where a login is involved (AI Usage), prefer a purpose-built capability, such as "read my usage", over a raw file-read grant, so the module never holds the token.
- Updates that ask for more re-ask. Revoking a grant takes effect at once, and data already given cannot be recalled (listed above).
