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
| G8 | A module can't exhaust host resources through the bridge | message size cap, in-flight cap, JSON validation, quotas for settings, documents and panel state | unit + e2e: oversized and over-quota writes are refused |
| G9 | A module can't use a capability it was not granted | reserved methods checked against the granted set (always empty in v1) before anything else runs | unit + e2e: `network.fetch`, `files.open`, `clipboard.readText`, `sharedData.read` fail with `PERMISSION_DENIED` |

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

The Discord panel shows who is in the player's voice channel. The main process reads it from the Discord desktop app on this PC over Discord's local connection (RPC: a named pipe or Unix socket), and the host UI draws it; there is no page, view or module code. What Discord says (names, channel names, ids) is untrusted text. The Client Secret of Tavora's Discord application is the player's to paste while Discord limits RPC to the application's testers.

| # | Guarantee | Mechanism | Test |
| --- | --- | --- | --- |
| D1 | The Client Secret and the sign-in only ever go to Discord | the secret is sent only in the token request to `https://discord.com/api/oauth2/token` (no redirects); the access token only to the local Discord app; neither is ever sent to the host UI, a module or Tavora's service (the host UI only learns whether a secret is saved) | unit: `discord.test.ts` (the secret reaches only the token address); e2e: `discord.spec.ts` |
| D2 | Tavora reads voice, and only changes the player's own voice when asked | the scopes asked for are `rpc`, `rpc.voice.read`, `rpc.voice.write` and `identify`; the commands that change anything in Discord are `SELECT_VOICE_CHANNEL` (join a channel Tavora showed or remembered, or leave; 0.5.10) and `SET_VOICE_SETTINGS` (mute and deafen the player; 0.5.11), each sent only after the player pressed its button; muting needs the write scope, which a sign-in made earlier gets only after the player presses Allow muting and approves it in Discord; nothing else is written | unit: `discord.test.ts` (join, leave, mute, unknown channel, no write scope), `actions.test.ts`; the AUTHORIZE scopes |
| D3 | Secrets are kept encrypted on this PC | `discord.json` holds only safeStorage-encrypted data (DPAPI, Keychain, secret service); where only Linux's plain-text fallback exists nothing is saved; a file from another user or PC is ignored | unit: `discord-store.test.ts`; e2e: the file does not contain the secret |
| D4 | Nothing Discord sends can run or reorder the page | every value is checked (ids are Discord ids, names lose control and direction characters and are cut to 64 characters, lists are capped) and shown as text; frames over 1 MB close the connection | unit: `discord-voice.test.ts`, `discord-rpc.test.ts` |
| D5 | Pictures come only from Discord's image server and only as small PNGs | avatar and server icon addresses are rebuilt from checked ids and hashes on `https://cdn.discordapp.com/`; no cookies, referrer or redirects; at most 256 KB with a PNG signature, passed on as a data address | unit: `discord-voice.test.ts` |
| D6 | Nothing happens until the player asks | the connection only runs while a Discord panel is open, and Discord's approval is only asked for when the player presses Connect; closing the last panel disconnects | unit: `discord.test.ts`; e2e: no command before Connect |
| D7 | Only the main process and the host window talk about Discord | `host:get-discord` and the `discord-*` actions answer only the host window's main frame, like every `host:*` call; the actions are checked by `parseAction` | unit: `actions.test.ts` |

## Known limits and open risks

- **Webview isolation is not proven safe by this spike.** It relies on Chromium site isolation and the OS sandbox. A Chromium renderer exploit would break G1–G4. Mitigation: keep Electron current, enable the OS sandbox everywhere, set Electron fuses at packaging time (no `RunAsNode`, no `NODE_OPTIONS`, ASAR integrity, cookie encryption).
- **The gate tests need the OS sandbox on.** They run as a normal user (Chromium refuses its sandbox as root), and CI allows unprivileged user namespaces so the sandbox works there too. A run with `--no-sandbox` would not prove G1.
- **DNS prefetch and other browser side channels** may still leak hostnames even with requests blocked. Needs a packet-level check on Windows and Linux.
- **Timing and covert channels** between modules on the same machine are not addressed.
- **The heartbeat cannot tell a hang from long synchronous work.** A module that blocks its main thread for more than 10 s is shown as not responding until it answers again. That is the honest state from the player's view, but the Stop action ends it.
- **Same module, several panels** share a renderer process. A crash in one instance can take down its siblings of the same module, not other modules.
- **Data a module already received cannot be recalled** after a grant is revoked (relevant from Milestone F).
- **Browser: no Safe Browsing.** A phishing page still renders; downloads, permissions and external protocols are refused. **DNS rebinding** can still point a public name at a local address, because B7 looks at the name, not the resolved address. **Sign-in popups** that need `window.opener` do not work, because new windows open in the same panel. Ad blocking is network-only, so empty ad boxes can remain and in-video ads are not reliably blocked.
- **Discord: the local pipe is trusted.** Whatever listens at `discord-ipc-0` gets the Discord access token, and anything already running as the player could listen there. Such a program can read the player's files anyway, so this is accepted. While Discord limits RPC to an application's testers, each tester pastes the Client Secret on their PC; once Tavora is approved for RPC, the token exchange should move to Tavora's service so no player handles a secret.
- **Tauri was not evaluated.** Electron was spiked first for a single Chromium engine on Windows and Linux. Revisit only if memory overhead is unacceptable.
