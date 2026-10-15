# Browser panel: security design

**Status:** proposal, 2026-10-15. Waiting for Nik's yes before any code. Once
agreed, the guarantees below move into [threat-model.md](threat-model.md) as
B1–B10 and the choices into [decisions.md](decisions.md).

## What it is

A panel that shows ordinary websites (wikis, maps, guides, videos) next to a
game's other panels: an address bar, back, forward, reload, and the page.

## The core choice: a host panel, not an SDK module

Every module today is untrusted code with **no** network (G4), no navigation
away from its bundle and no windows (G7). A browser needs all three. Giving a
module a "web view" capability would mean the first powerful grant in the SDK
is one any community module could ask for, before grants exist (Milestone F).

So the Browser is built into the host:

- It is listed in the module library as **Browser** (Official) and docks,
  saves in layouts and closes like any panel.
- The **toolbar** (address bar and buttons) is drawn by the host UI, which is
  trusted. A page can never draw over it or fake the address it shows.
- The **page** is its own `WebContentsView` placed under the toolbar, the same
  way module views are placed today.
- It ships **no SDK API** in this version. Modules cannot open, read or drive
  it. "Open a link from a module" stays deferred (decision of 2026-10-14).

## Attacker

Any website the player visits, including hostile ones, ad scripts on good
ones, and a page that tries to reach things on the player's PC or local
network. It controls everything inside its own page. It does not control the
host, the toolbar, modules, or other games' browser data.

## Isolation

| | Browser page | Host UI | Module views |
| --- | --- | --- | --- |
| Session | `persist:browser@<gameId>` | default | `persist:module:<id>@<gameId>` |
| Preload / IPC | **none** | host preload | bridge port only |
| Node, Electron APIs | no (`sandbox`, `contextIsolation`, no node integration, no `<webview>`) | no | no |
| Renderer process | own, per site (Chromium site isolation) | own | own |

- **No preload and no IPC at all.** The page has no port, no `ipcRenderer`
  and no host channel. Every `host:*` handler already refuses anything but the
  host window (H1).
- **Per game storage.** Cookies, logins and caches are kept per game, matching
  "no cross-game leakage through browser storage". Logging into a wiki for one
  game does not log you in for another. When a game leaves Trash its browser
  partition is deleted at startup with its module data (H4 extended to
  `browser@<game>`). Settings gets "Clear browser data for this game".
- **Modules cannot reach the page and the page cannot reach modules.** The
  browser session does not register the `tavora-module://` protocol, so module
  bundles are not even addressable from a web page.
- **Keyboard:** the host keeps its shortcuts (Ctrl+K and the rest) through
  `before-input-event`, as it does for modules. Ctrl+L focuses the address
  bar, Alt+Left/Right go back/forward.

## Navigation

- Top-level navigation is allowed only to `http:` and `https:`. `file:`,
  `data:`, `javascript:`, `blob:` at the top level, `chrome:`, `devtools:`,
  `tavora-module:` and every other scheme are refused, including through
  redirects (`will-navigate`, `will-frame-navigate`, `will-redirect`).
- **External protocols** (`steam://`, `mailto:`, `ms-settings:` …) are denied
  through the `openExternal` permission. A page cannot start a game, a program
  or a system dialog.
- The address bar is parsed in the host: something that looks like a host
  name becomes `https://…`; anything else is sent as a search to
  **DuckDuckGo** (only the typed text). `http:` pages load but show
  "Not secure" in the toolbar.
- The toolbar shows the page's host, with internationalised names shown as
  punycode when they mix scripts, so `аpple.com` cannot pass for `apple.com`.
- **Certificate errors are never clicked through.** The page shows an error
  and the request is refused (Electron's default, kept explicitly).
- **Local network protection:** a page loaded from a public address cannot
  make requests to `localhost`, loopback, private ranges (`10/8`,
  `172.16/12`, `192.168/16`, `fc00::/7`, `169.254/16`) or `.local` names.
  The player may still type such an address themselves (a game server's web
  page on their LAN). This stops a website from poking routers or local
  services.

## Windows, popups and downloads

- **No new windows.** `window.open` and `target=_blank` links that the player
  clicked open in the **same panel** when they are `http(s)`; anything else is
  dropped. Popups without a click are dropped.
- The toolbar has **Open in your browser**, which hands the current
  `http(s)` address to the system browser. Pages cannot trigger it.
- **Downloads are cancelled** with a notice in the panel that offers Open in
  your browser instead. Tavora never writes a file a website sent.

## Permissions

Everything is denied (camera, microphone, location, notifications, MIDI,
USB/HID/serial/Bluetooth, screen capture, pointer lock, idle detection,
clipboard read, storage access, external protocols, persistent storage,
fullscreen), except **clipboard write**, so "copy" buttons on wikis and build
sites work. Fullscreen video is left out of v1, because Electron would take
over the whole window; videos play inside the panel, and the panel can be
maximised in the dock.

## Identity and privacy

- The user agent is a plain Chrome string of the bundled Chromium, without
  "Electron" or "Tavora" and without the Tavora version, so sites work and the
  app is not fingerprinted.
- No Tavora headers, no telemetry, spellcheck off (it would fetch
  dictionaries from Google).
- **No history file.** Back and forward live in memory. A panel remembers only
  its current address in its panel state, so a saved layout reopens on it.
  Bookmarks come later.

## Lifecycle and resources

- Same as module panels: hidden while a host menu or dialog is open, hidden
  and throttled in a background tab, a crash shows "This page crashed" with
  Reload and never affects the host or other panels (G5).
- Audio keeps playing in a background tab, like a normal browser, and the tab
  shows a speaker icon with mute.

## Guarantees and tests (gates for the PR)

| # | Guarantee | Test |
| --- | --- | --- |
| B1 | A page cannot reach Node, Electron, IPC or the host | e2e: page probes `require`, `process`, `ipcRenderer`, `electron`, `tavora` |
| B2 | A page cannot read module bundles or another game's browser data | e2e: `tavora-module://` load fails; a cookie set for game A is absent in game B |
| B3 | Only `http(s)` navigates; no external protocols | unit: URL parsing; e2e: `file:`, `javascript:`, `data:`, `steam://` and a redirect to `file:` all refused |
| B4 | No new windows; clicked `_blank` opens in the same panel | e2e: `window.open` and `_blank` |
| B5 | Downloads never write a file | e2e: a download link leaves nothing on disk |
| B6 | Permissions are denied except clipboard write | e2e: geolocation, notifications, camera answer denied |
| B7 | A public page cannot reach loopback or private addresses | unit: address classification; e2e with a host mapped to a "public" name |
| B8 | Bad certificates are refused | e2e: self-signed HTTPS server |
| B9 | The toolbar shows the true address | unit: punycode and mixed-script cases |
| B10 | Deleting a game deletes its browser data | unit: `orphanedPartitions` covers `browser@<game>` |

## Known limits

- **No Safe Browsing.** Electron has no phishing or malware list. Mitigated
  by no downloads, no permissions and no external protocols, but a phishing
  page still renders.
- **Sign-in popups** ("Sign in with Google") that rely on `window.opener`
  will not work in v1, because popups open in the same panel.
- **DNS rebinding** can still let a public name resolve to a private address;
  the B7 check looks at the host name and IP literal, not the resolved IP.
- **No ad blocker** in v1. Fandom-style wikis are heavy; a filter list is a
  later item.
- A Chromium renderer exploit breaks B1–B2, as for modules. Same mitigation:
  keep Electron current, OS sandbox on, fuses set.
