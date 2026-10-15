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
| H8 | Hosted game icons (0.4.3) cannot be used to run code, fill the disk or follow a player | the service only reads its own icon folder at start: every file must be a PNG with right chunk checksums, at most 256 px and 200 KB, and match the hash recorded for it, else it is left out; an icon id is lower-case letters, digits and dashes, so no path can leave the folder; only GET is routed, there are no uploads yet, and the routes answer 503 and 404 until a takedown contact is configured. Icon answers are the same for everyone and may be cached; everything else is never cached, and no request is ever logged. In the app only the main process asks: the list is capped (5000 entries, every field checked), a file must have the size and hash the list promised, a PNG signature and a header of at most 256 px, at most 200 KB, and is stored as hosted-<gameId>.png, a name only that game can have; no cookies, no referrer, no redirects, 5 s; and nothing is asked while Online game search is off. The service sees which icon files are asked for, from an address it does not keep | unit: png.test.ts, icons.test.ts, icon-files.test.ts, pp.test.ts (icon endpoints) in apps/api; hosted-icons.test.ts, icon-sync.test.ts, steam-icons.test.ts, library.test.ts in the app |

Also changed in C: Ctrl+K is caught by the host before any page, so a module cannot take it over, and panels in background tabs are hidden and suspended through the same lifecycle events as before.

## Known limits and open risks

- **Webview isolation is not proven safe by this spike.** It relies on Chromium site isolation and the OS sandbox. A Chromium renderer exploit would break G1–G4. Mitigation: keep Electron current, enable the OS sandbox everywhere, set Electron fuses at packaging time (no `RunAsNode`, no `NODE_OPTIONS`, ASAR integrity, cookie encryption).
- **The gate tests need the OS sandbox on.** They run as a normal user (Chromium refuses its sandbox as root), and CI allows unprivileged user namespaces so the sandbox works there too. A run with `--no-sandbox` would not prove G1.
- **DNS prefetch and other browser side channels** may still leak hostnames even with requests blocked. Needs a packet-level check on Windows and Linux.
- **Timing and covert channels** between modules on the same machine are not addressed.
- **The heartbeat cannot tell a hang from long synchronous work.** A module that blocks its main thread for more than 10 s is shown as not responding until it answers again. That is the honest state from the player's view, but the Stop action ends it.
- **Same module, several panels** share a renderer process. A crash in one instance can take down its siblings of the same module, not other modules.
- **Data a module already received cannot be recalled** after a grant is revoked (relevant from Milestone F).
- **Tauri was not evaluated.** Electron was spiked first for a single Chromium engine on Windows and Linux. Revisit only if memory overhead is unacceptable.
