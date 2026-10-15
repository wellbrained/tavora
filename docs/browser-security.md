# Browser panel: security design

**Status:** agreed with Nik on 2026-10-15 and built in 0.5.6; tabs added in
0.5.7. The guarantees
are B1–B10 in [threat-model.md](threat-model.md); the choices are in
[decisions.md](decisions.md).

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
- **Per game storage, with shared sites.** By default cookies, logins and
  caches are kept per game (`persist:browser@<gameId>`), matching "no
  cross-game leakage through browser storage". The player can mark a site
  (its registrable domain, so `google.com` covers `accounts.google.com`) as
  **signed in for all games**; pages of those sites load in one shared session
  (`persist:browser`). A view has one session, so the panel switches views
  when the player opens a page of the other kind (address bar, link click);
  redirects stay in the session they started in, so a sign-in that bounces
  through another domain finishes where it began. When a game leaves Trash its
  browser partition is deleted at startup with its module data (H4 extended to
  `browser@<game>`); the shared session is untouched. Settings gets "Clear
  browser data for this game" and "Clear shared browser data".
- **Modules cannot reach the page and the page cannot reach modules.** The
  browser session does not register the `tavora-module://` protocol, so module
  bundles are not even addressable from a web page.
- **Keyboard:** the host keeps its shortcuts (Ctrl+K and the rest) through
  `before-input-event`, as it does for modules. Ctrl+L focuses the address
  bar, Alt+Left/Right go back/forward, Ctrl+T opens a new tab and Ctrl+W
  closes this one.

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
  clicked open as a **new Browser tab** in the same panel group, right after
  the page's tab (a middle-click opens it in the background), when they are
  `http(s)`; anything else is dropped. Popups without a click are dropped. A
  new tab is an ordinary Browser panel: it gets no `window.opener` and shares
  nothing with the page that opened it except the session the game already
  uses.
- **New tabs** also come from the toolbar's + button and Ctrl+T, which open an
  empty tab with the address bar focused; Ctrl+W closes the tab.
- The toolbar has **Open in your browser**, which hands the current
  `http(s)` address to the system browser. Pages cannot trigger it.
- **Downloads are cancelled** with a notice in the panel that offers Open in
  your browser instead. Tavora never writes a file a website sent.

## Permissions

Everything is denied (camera, microphone, location, notifications, MIDI,
USB/HID/serial/Bluetooth, screen capture, pointer lock, idle detection,
clipboard read, storage access, external protocols, persistent storage),
except:

- **clipboard write**, so "copy" buttons on wikis and build sites work;
- **fullscreen, kept inside the panel**: the host stops Electron from making
  the window fullscreen and the video fills the page view; Esc or the
  toolbar leaves it.

## Ad blocking

On by default, with a per-site off switch in the toolbar. Network-level
blocking with `@ghostery/adblocker` (MPL-2.0) and EasyList/EasyPrivacy, run in
the main process on the browser sessions' `webRequest`. The filter lists ship
with the app and later update from Tavora's own service, never from a third
party. No cosmetic filtering in v1: it needs a preload in every page, which
would break "no preload, no IPC"; blocked ads may leave empty boxes, and
YouTube's in-video ads are not reliably blocked by network rules.

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
  toolbar shows a speaker button to mute it.

## Guarantees and tests (gates for the PR)

| # | Guarantee | Test |
| --- | --- | --- |
| B1 | A page cannot reach Node, Electron, IPC or the host | e2e: page probes `require`, `process`, `ipcRenderer`, `electron`, `tavora` |
| B2 | A page cannot read module bundles or another game's browser data | e2e: `tavora-module://` load fails; a cookie set for game A is absent in game B |
| B3 | Only `http(s)` navigates; no external protocols | unit: URL parsing; e2e: `file:`, `javascript:`, `data:`, `steam://` and a redirect to `file:` all refused |
| B4 | No new windows; clicked `_blank` opens as a new Browser tab | e2e: `window.open` and `_blank` |
| B5 | Downloads never write a file | e2e: a download link leaves nothing on disk |
| B6 | Permissions are denied except clipboard write; fullscreen never leaves the panel | e2e: geolocation, notifications, camera answer denied |
| B7 | A public page cannot reach loopback or private addresses | unit: address classification; e2e with a host mapped to a "public" name |
| B8 | Bad certificates are refused | e2e: self-signed HTTPS server |
| B9 | The toolbar shows the true address | unit: punycode and mixed-script cases |
| B10 | Deleting a game deletes its browser data, and only shared sites use the shared session | unit: `orphanedPartitions` covers `browser@<game>`; unit: domain matching; e2e: a cookie on a shared site is seen in two games, on another site it is not |

## Known limits

- **No Safe Browsing.** Electron has no phishing or malware list. Mitigated
  by no downloads, no permissions and no external protocols, but a phishing
  page still renders.
- **Sign-in popups** ("Sign in with Google") that rely on `window.opener`
  will not work in v1, because popups open as a separate tab with no
  `window.opener`.
- **DNS rebinding** can still let a public name resolve to a private address;
  the B7 check looks at the host name and IP literal, not the resolved IP.
- A Chromium renderer exploit breaks B1–B2, as for modules. Same mitigation:
  keep Electron current, OS sandbox on, fuses set.
