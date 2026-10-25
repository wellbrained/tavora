# Security model

Tavora runs modules written by other people on players' PCs, next to their games. This page says what the host guarantees, how a module is kept inside its panel, and what is not covered. It describes the desktop host as it is today; Tavora is pre-release, and the guarantees are tested in the repository's gate tests (`apps/desktop/test/e2e`).

The attacker assumed throughout is a module whose author is hostile, or whose dependencies were compromised. It controls all the JavaScript, HTML and CSS in its own bundle and can send any message over its bridge port. It does not control the host or other modules.

To report a problem, see [Security policy](https://github.com/wellbrained/tavora/blob/main/SECURITY.md).

## How a module runs

- The **main process** is the only part with access to the operating system. It checks every message a module sends.
- The **host UI** (library, docking, Settings) is trusted code, but it is still sandboxed and has no Node access.
- Every **module** is untrusted. Each module gets, per game, its own browser session, its own origin (`tavora-module://<module id>/`) and its own renderer process, separate from the host and from other modules. It runs with `sandbox` and `contextIsolation` on, without Node and without `<webview>`.

## What a module cannot do

| | Guarantee |
| --- | --- |
| G1 | Reach Node, Electron or operating-system APIs. The module preload exposes nothing but the bridge port. |
| G2 | Read or write another module's data. Host storage is keyed by the module's bound identity, and web storage lives in separate sessions. |
| G3 | Choose or fake which module it is or which game it runs for. The host binds both when it creates the port; message fields never carry identity. |
| G4 | Use the network on its own. Everything but its own origin is blocked; hosts the player granted are reached only through host-controlled `network.fetch` and `network.readPage`. |
| G5 | Take down Tavora or other panels. A crash, hang or failed load is shown in that panel only, with Reload and Stop, and saved data is written atomically. |
| G6 | Read arbitrary files outside its own bundle. Only files the player explicitly picked can be reread through scoped, read-only references; asset paths are resolved inside the module's folder; `..`, encoded `..`, links out and null bytes are refused. |
| G7 | Open windows, navigate away, download files or ask for devices (camera, microphone, location). |
| G8 | Exhaust the host through the bridge. Messages are plain JSON only, at most 8 MiB each, with at most 64 requests and 16 MiB in flight; an oversized message is refused inside the module's own renderer before the main process sees it. Settings, documents and panel state have quotas. |
| G9 | Use a capability the player did not grant. Gated calls check the player's grant first, on every call, and answer `PERMISSION_DENIED` otherwise. |
| G10 | Run code through its icon. Icons are PNG or WebP files inside the package, at most 256 KB, checked by their signature and shown as a plain picture. |
| G11 | Fill the disk through its own browser storage. Past 256 MB (or 5,000 files) the host ends the module's renderer, clears that storage and tells the player. A module can still write for up to one second before this happens. |

## Grants

A module lists what it needs in its [manifest](../reference/manifest.md). Nothing is granted by the manifest alone:

- **The player is asked when they add a module.** Tavora draws the consent dialog itself, from the manifest as the main process read it, along with who made the module (Tavora, a publisher key or an unsigned folder). A module cannot draw or hide that dialog. Preinstalled modules get no pre-approved grants. A connector the module lists in `permissions.onRequest` (only stream overlays) is asked for in the same dialog, but only right after a click in the module's panel that needs it, such as Copy OBS link; until then the module runs without it.
- **The player grants exactly what they saw.** If an update asks for more while the dialog is open, it gets nothing it did not show.
- **Grants are kept by the host**, outside every module folder, for the module's publisher and id. Another publisher's module with the same id gets nothing.
- **Revoking takes effect at once.** Settings > Modules > Website access lists every module allowed to reach websites, Settings > Integrations every module allowed to use Discord, AI usage or System info, and Settings > Streaming every module allowed to show stream overlays. Taking a grant back shows the games the module is used in and removes its panels there; its data is kept. Data a module already received cannot be recalled.

### Network

`permissions.network` names exact hosts:

- HTTPS only, on the standard port, with lowercase public names. Wildcards, IP addresses, `localhost`, `.local` and `.internal` names are refused.
- The main process resolves the name itself and connects only when every address is public, so a granted name cannot be pointed at the player's PC or local network (DNS rebinding).
- Requests come from the main process, not from a browser session: no cookies, no browser sign-ins, no proxy credentials. A module cannot set `Cookie`, `Host`, `Origin`, `Referer`, `User-Agent`, `Proxy-*` or `Sec-*` headers, `Set-Cookie` is not passed back, and `Authorization` is dropped on a redirect to another host.
- An answer is read to at most 5 MB after unpacking. A request takes at most 15 s including redirects, with at most 5 redirects and 6 requests per panel at a time.

A module page still cannot load remote code (`script-src 'self'`), even from a granted host.

### Connectors

Connectors are capabilities built for one purpose. The host holds the connection, the sign-in and the token, and a module only reaches a fixed list of commands and answers.

- **Discord** shows and controls the player's own voice state through the Discord app on the same PC. A module sends only fixed commands with fixed fields, and never sees a token. Joining or leaving a channel, muting and unmuting need a real click in the module's panel. A granted module does see the player's voice channels, servers and who is in them, and the consent dialog says so.
- **AI Usage** reads usage limits of AI subscriptions signed in on the PC. A module gets account names, plans and readings, never a login, a token or where it is stored. Each account is read at most once a minute for all modules together.
- **System info** lets a module read this PC's hardware and how busy it is: processor, memory, graphics cards, drives and Tavora's own use, and how the connection is doing (pings to the router and one internet address), see [System info](#system-info).
- **Stream overlay** shows the module's overlay page in streaming software on the same PC, see [Stream overlays](#stream-overlays).

## Remembered read-only files

A module can ask you to pick a file in Tavora's native file dialog after a real click. It receives a random reference and the file name, never the path. That choice lets the same publisher's module reread that exact file in that game, including after restarting Tavora. There is no write or folder-browsing call. Each read is limited to 32 MiB, with two reads at a time per module and game and four across Tavora.

Tavora remembers the last selected folder separately for each publisher, module and game. If that folder is unavailable, it may check the game's known save locations to start the native dialog there. These local hints are never given to modules and grant no access: you still choose each file yourself.

File access stays on this PC, outside backups and cloud copies. Restoring map data on another PC requires choosing the files again. A moved file or redirected link requires a new selection. Modules can forget a reference; clearing a game's or module's data also revokes its file access without deleting the selected files. Moving local module data to another publisher does not transfer file access.

## Calls that need a click

Some calls change something outside the module's panel. They work only within 2 seconds of a real click or key press in that panel; a script cannot fake one, and each press allows one call.

- **`files.pickReadOnly`** opens a native file picker; one press opens it once. Only the file you select can be remembered and reread through `files.read`. `files.forget` revokes that reference.
- **`links.open`** opens an `http` or `https` address in Tavora's Browser panel, or, after the player confirms, in the system browser. The module learns nothing back.
- **`clipboard.writeImage`** puts a checked PNG on the clipboard. There is no call to read the clipboard.
- **`pictures.save`** writes a checked PNG where the player picks in Tavora's save dialog, which opens in the folder they last saved a picture to (at first `Pictures\Tavora`). The module only suggests a name, which Tavora cleans; it cannot pick the folder or file type, replace a file unless the player confirms it in the dialog, or read anything back, and it never learns where the file went.
- **`files.saveJson` and `files.openJson`** save and open a JSON file through Tavora's own save and open dialogs, which start in the folder you last used for that module (at first `Documents\Tavora`). The module only suggests a name, which Tavora cleans, and gets back the file name (and, for open, the parsed content of the one file you picked). It never gets a path, cannot pick a file or folder, and cannot replace a file unless you confirm it in the dialog. Each needs a real click or key press and works once per press; files are at most 8 MiB.
- **`ui.showMenu`** shows a menu that Tavora draws above every panel, so it can lie outside the module's panel. Tavora checks the menu first and draws only plain text, separators, headings, check marks and colour dots from plain CSS colour values (nothing that loads or runs), in its own style. One menu shows at a time, it closes with Esc, a click elsewhere or a game switch, and the module learns only which of its own items the player chose, or that none was.
- **`overlay.copyLink`** puts the link of one of the module's own overlays on the clipboard, and nothing else. There is no call to read the clipboard.
- **`overlay.showOverGame`** adds one of the module's own overlays to the player's game overlays, see [Game overlays](#game-overlays). One press adds one, and the player can turn all game overlays off.
- **`overlay.preview`** opens a preview window of one of the module's own overlays, see [Overlay previews](#overlay-previews). One click opens one window.
- **`hotkeys.set`** opens Tavora's own hotkey dialog. The module names the action and the target; the player picks the key, or cancels.
- **`panels.open`** opens, brings forward or switches a panel of the same module, in the game shown now, so it changes the workspace outside the module's panel. A module can open only its own panel types, never another module's panels, and one press opens or switches one panel. The panel asked to switch is the module's own page and may refuse; then nothing changes, and only the player can open the content in a new panel. The module learns only what Tavora did: shown, switched, opened or failed.
- **`panel.setMaximized(true)`** makes the module's own panel fill the workspace, as Maximize in its menu does, so it covers the other panels and they pause. It never reaches past the workspace: not the rest of the window, not fullscreen, not a new window. One press maximizes once. Putting the panel back needs no press, and the player can always do it with Restore in the panel's menu. The module learns only whether its own panel fills the workspace.

A module can still label a button misleadingly and get the player to click it. The result is the same as a link on any web page: the player sees the new tab, and the Browser panel is sandboxed.

A module can name its panel content without a click: **`panel.setContent`** names what the panel shows, and Tavora shows that name when the player hovers the panel's own tab. Tavora checks it first and shows only one line of plain text, at most 200 characters, below the panel's and the module's names, on that tab and nowhere else. The module learns nothing back.

A module's **patch notes** also show outside its panel, in Settings > Modules. They come from the changelog file in its package, not from the running page. Tavora reads at most 64 KB, checks the file first and shows only plain text lines (never HTML, Markdown or links), only for versions up to the installed one, and only when the player opens them.

## System info

A module granted the `system-info` connector can read this PC's hardware and how busy it is: processor, memory, graphics cards, drives and Tavora's own use, and how its connection is doing. The consent dialog says so. Two things run on their own terms: reading the PC, and watching the connection.

**Reading the PC**

- **Read only while a panel shows it.** Tavora reads the PC's performance only while at least one panel that is shown watches something. A hidden, minimized or covered panel counts for nothing, and with no watching panel there is no timer and no open counter. All panels share one reader, which looks at most once a second.
- **Windows' own numbers, read in Tavora's process.** The values are the performance counters Task Manager shows, plus the drive list and the names of the graphics cards. For NVIDIA cards, usage, video memory, temperature, clock speed and power come from NVIDIA's own library that ships with the driver (`nvml.dll`), loaded and read inside Tavora's process. Tavora starts no helper program and installs no driver; none of this is sent anywhere.
- **Numbers and names only.** A module gets the processor and graphics card names, sizes, percentages and drive letters with their labels. It never gets a file name, a path, a serial number, a user name or what other programs are running.
- **Network drives are not asked.** A network drive that doesn't answer could hold Tavora up, so its name and size are left out.

**Watching the connection**

- **It runs without a panel.** While Tavora's own System Monitor is in any game or workspace and the player has granted it System info, Tavora watches the connection, whether or not a panel is shown, so drops are logged. Without the module in a workspace, or without the grant (taking it back stops the watcher at once), or with it switched off, nothing runs. This is the one part of System info that does not wait for a panel.
- **Two pings every 5 seconds.** Tavora sends one ICMP echo (a ping with 32 bytes of filler) to the router and one to an address on the internet, `1.1.1.1` unless the player picks another. The router is the next hop of Windows' route to the internet, which Tavora reads from the routing table. The pings use Windows' own ping function inside Tavora's process: no `ping.exe`, no helper program, no admin rights. Nothing else is sent, nothing goes to a Tavora server, and no module sees the pings or the router's address.
- **Name lookups.** When the address is a name, Tavora asks the PC's name server for it, at most every 5 minutes (every 30 seconds while it can't be found), one lookup at a time. The address that comes back must be public; if it is not, Tavora does not ping it.
- **Only public addresses.** The address is a public IPv4 address or a name with a dot in it. Tavora refuses private, loopback, link-local, shared (CGNAT), documentation, multicast and other reserved addresses, names without a dot, local endings such as `.local`, `.lan` or `.home.arpa`, and router names such as `fritz.box`. Tavora's pings can't be aimed at this PC or the local network except for the router itself.
- **Only the System Monitor, only after a click.** Any granted module can read the log of drops, the settings and the readings. Changing the settings (watching on or off, the address) and clearing the log are only for Tavora's own System Monitor (publisher `official`, id `tavora.system-monitor`, which other publishers can't take), and each call must come right after a click or key press in its page, one per click. A change can be made once every 5 seconds, and a new address waits for the next normal ping.
- **The log of drops stays on the PC.** Tavora keeps the start, end and kind of each drop for 30 days in `connection.json` in its data folder, and a module can only read or clear it. The alert is a notice in the panel: no sound, no system notification. The same calls read whether Windows thinks it is online and the byte counters of the network adapter in use, which stay on the PC.

**Ending**

- **The snapshots end with the panel and the grant.** Closing the panel ends its watch at once. Taking the connector back removes the module's panels (see Revoking above) and stops the watcher, and a snapshot or an event is never sent to a module without the grant.

## Stream overlays

A module granted the `stream-overlay` connector can have Tavora serve its overlay page to streaming software such as OBS, which shows it as a Browser Source. This is the only way a module page is reachable from outside Tavora. The connector is what lets the module copy and reset a link. `overlay.publish` and `overlay.remove` only set what an overlay shows, which a link or a [game overlay](#game-overlays) then displays, so they need no grant. Without the connector Tavora keeps a published state only for a key that has a game overlay or a link already; for any other key the call succeeds and stores nothing, so a module can't fill the disk. A published state can't be reached from outside Tavora without the connector.

- **Off until the player turns it on** in Settings > Streaming. Tavora then listens on `127.0.0.1` only, on one port the player can change, so nothing on the network can reach it.
- **Only the links the player copies work.** Each overlay has a random link (128 bits), made by Tavora. Anything that asks without one gets nothing. The player can give every overlay a new link at once, and the old ones stop working.
- **Web pages can't reach it**, not even ones that point their own name at `127.0.0.1` (DNS rebinding): Tavora answers only requests addressed to `127.0.0.1` or `localhost` at its port.
- **The page is locked down like a panel.** Tavora serves only files from the module's package (the same path checks as G6), only for `GET`, with a policy that loads no code from anywhere else and lets the page talk only to Tavora. It has no bridge: it can only read what the module published for that overlay, at most 16 KB of plain JSON.
- **A link works only for its module.** It belongs to one module, under its publisher, in one game. When the module is removed, replaced by another publisher's module with the same id, or loses the grant, the link stops working and open overlays stop getting data.
- **What an overlay shows goes on stream.** Whatever the module publishes for it is visible to viewers. The consent dialog says what the connector does; a module still decides what it shows.

## Game overlays

Tavora can show two kinds of things over the player's game: a module's **overlay page**, and **panels in game**. Neither is the connector above, and neither reaches anything outside Tavora: they are windows of Tavora's own on the player's screen.

- **Off until the player turns it on** in Settings > Overlays. While it is off, the calls only open that setting. Turning it off closes every window at once. The same page has Hide all for now, which closes everything until the player shows it again or Tavora starts again (it is not remembered).
- **Only the player's own games, only the player's own overlays.** The windows are shown while a game of the player's library is the window in front, found by reading which program owns it (the same look the game watcher takes, with the same limited access). They hide within a moment (up to about 0.4 seconds) after another window comes to the front, Tavora included, and an overlay window that stays out of the front is closed after about 30 seconds. Something made in a game's workspace shows only over that game. Something made in a workspace that is no game (such as the Personal workspace) is **general**: it shows over every library game that is in front, never over other programs. A game can have at most 8 and the general ones at most 8, the player removes them in Settings > Overlays, and removing the module (a development folder's too), a game, or a module replaced by another publisher's with the same id removes them too. A module can bring a removed overlay back only with a new click in its panel while Game overlays are on.
- **Nothing is put into the game.** Tavora does not inject code, read the game's memory, hook its graphics or keyboard, or draw into its window. The overlays are ordinary windows above it. The only calls to Windows are reading which window is in front, where its client area is and whether Windows thinks a full-screen game owns the screen, asking for the path of the program that owns it (the game's process is opened with the limited query right only, never with rights to read its memory or change it), and, after the player closes the layer, giving the game the focus back.
- **Windows never outlive Tavora.** They close when Tavora quits, when its main window closes, when it gets a stop signal and when its process exits. A development restart ends the old process and its windows before the new one starts.
- **The page is locked down like a Stream overlay page.** It has no bridge, loads only files from the module's package (the same path checks as G6) from a Tavora-internal address, under the same policy, and can reach nothing else; it can only read what the module published for that overlay, at most 16 KB of plain JSON. It needs neither the Stream overlays server nor the connector.
- **Capture hiding is opt-in.** By default the windows show in screen capture and recording like any other window. The player can turn on Hide from capture per overlay, which excludes it from capture. It is off by default because some anti-cheats flag windows that are hidden from capture over a game.

### Overlays

An overlay page can't take input: it is transparent to the mouse, never takes the keyboard, and is always there (or toggled by a key the player set), as the player chose. The key that toggles an overlay is set in Tavora's hotkey dialog and works only while a game it applies to is in front. The module never learns it. A module's keys for overlay pages can't start with `panel-`, which Tavora keeps for itself; `overlay.showOverGame` refuses them. `overlay.hideOverGame` and `overlay.overGame` only remove or list the module's own overlays for its own game (or the general ones, for a panel in a workspace that is no game), and need neither a click nor a permission.

### The in-game layer

The player has **one** key for it ("Tavora over game", set in Settings > Overlays with the hotkey dialog; it works over any library game that is in front). While the player holds the layer open:

- **A veil** covers the game's window: a Tavora window, black at about 30 % opacity, that takes clicks and does nothing with them, so the game isn't played by accident. It never takes the keyboard. It is one small page of Tavora's own (no files, no network, no bridge) that paints the dark sheet only while Tavora's main process keeps telling it so, twice a second; with nothing heard for 2 seconds it turns fully transparent, and if the page itself stops it makes the window click-through. It stops mouse clicks the way a window does: a game that reads the mouse straight from the device (raw input) may still see them. And if Tavora's main process hangs altogether, Windows alone decides what a click on its unresponsive window does; the veil can only become invisible then. Closing Tavora, or the game window going away or being minimized, ends it.
- **Panels in game** show on top of the veil and take the mouse and the keyboard.
- **Every overlay** of the game gets a frame Tavora draws (the page is below it), so the player can move, resize or close it.

While any general overlay or panel exists (made in a workspace that is no game), the layer key and the toggle keys of general overlays are taken in **every** library game while it is in front, so such a key can't be used for anything else there; Tavora's hotkey dialog refuses a key that collides with another one that works in the same game. A general panel learns when the layer opens and closes and the size of the game window (the usual `workspace.resize`), not which game it is. The layer opens only over the window that was in front when the key was pressed, and not over a game that owns the screen exclusively (Tavora says so instead). The key again, or Esc, closes it: panels return to their workspace slots, overlays are click-through again, and the game gets the focus back. While the layer is open Tavora takes Esc globally, so the game doesn't get Esc until it is closed. Nothing else from Tavora is shown over the game. If the game leaves the front, the layer closes.

### Panels in game

A panel type can set `inGame: true` in the manifest. Only for those types, the panel's own menu offers **Show in game** (and **Stop showing in game**). That click is the consent: no module call is involved and a module can't ask for it. Panels of other types get no such item.

- **Only while the player holds the layer open.** A panel in game is *not* over the game normally. It is over the game only while the layer is open, and it goes back into its workspace slot when the layer closes. The slot says "Open in game" meanwhile. What the player chose is kept across a restart by the panel's id; a panel that no longer exists is dropped.
- **The same panel, the same rights.** Tavora moves the panel's own view into the overlay window; it does not start a second copy. (If the panel's workspace is not the one shown, Tavora makes its view for the layer and closes it again afterwards.) The page keeps its bridge, session, storage, grants and identity, and what the module may call does not change. Nothing new can reach the page or leave it. The module can notice that it was moved, because the page is resized, paused and resumed like any panel whose place changes, but it is not told why.
- **Same limits as other overlays.** It counts toward the 8 per game (or the 8 general ones) and is off until Game overlays is on. Its place and size are kept relative to the game's window and changed by dragging in the layer. The frame around it shows the panel's name and a close button that means Stop showing in game.
- **Calls that need Tavora's window are refused.** While a panel is in the layer it can't open a save or open dialog (`pictures.save`, `files.saveJson`, `files.openJson`, `files.pickReadOnly`), the hotkey dialog (`hotkeys.set`), a menu (`ui.showMenu`), the consent dialog or a setting (`overlay.copyLink` when it would need one, `overlay.showOverGame`), a preview window (`overlay.preview`), another panel (`panels.open`), maximize it (`panel.setMaximized`) or open a link (`links.open`). They fail with `PERMISSION_DENIED`, and Tavora tells the player once per press: "Close the game layer to do this." Nothing waits for an answer that can't come. `links.open` also works only for the game shown now.
- **Input only while the layer is open.** A click or key press counts as the player's (what links and files need) only while the layer is open; at any other time none is counted. Tavora's own shortcuts leave the keys to the panel. While a panel has the keyboard, Windows reports one of Tavora's own windows as the one in front; Tavora reads only that it is its own and keeps the game as the one in front.
- **It goes when the panel goes.** Closing the panel, removing its module or game, a module replaced by another publisher's, turning Game overlays off, closing Tavora's window or quitting closes the overlay window, and the player can't close it any other way (Alt+F4 is ignored; the layer closing is how it leaves). A panel that crashes shows its usual crash screen in its slot.
- **Live badge.** A panel's tab shows a small **Live** badge when the panel is in game, or when its module has an overlay that shows over the game. It is only a label; clicking it opens Settings > Overlays.

### Overlay previews

A module with an overlay page can ask, after a real click in its panel, for `overlay.preview(key)`; Settings > Overlays and Settings > Streaming have a Preview button per overlay and per OBS link. It opens a small, ordinary Tavora window (not on top, not click-through, in the taskbar) titled with the module's name, showing the overlay page at its real size on a dark, light or checkered background. It is served exactly like the game overlay page: from a Tavora-internal address, with no bridge, no network and the same policy, and it reads the same live state the module publishes. There is one window per overlay. It needs no permission and works whether Game overlays and Stream overlays are on or off, because it shows nothing over a game and serves nothing outside Tavora. To feed the preview, Tavora keeps an OBS link (a secret address) for the key, as it does for a game overlay; that link is still served on the network only while the module has the `stream-overlay` connector and Stream overlays is on, so a preview alone puts nothing on the network.

## Hotkeys

Modules can name actions in their manifest, and the player can bind a key to each in Tavora's own dialog. The module never learns the key, only which action fired for which of its targets.

- **Only the player sets keys.** The dialog opens only right after a click in the module's panel, Tavora draws it and catches the key, and the module can't press it or choose for the player.
- **A key needs a modifier** (Ctrl, Alt or Win) unless it is an F-key or a number-pad key, so a hotkey never takes letters the player types with.
- **Keys work only while they're needed.** Tavora registers a game's hotkeys with the system only while that game is shown in Tavora and the module has a panel in its workspace, and lets them go otherwise. The game itself doesn't get a key that is a hotkey right then.
- **One key, one action per game.** Tavora refuses a key that is already a hotkey in the same game, or that another program holds. Settings > Streaming lists every hotkey, in every game, and removes any of them.

## Module files

`blobs` keeps pictures for a module, per game:

- The host picks every file name (a random 128-bit id). A module never names a path.
- Only PNG, JPEG, GIF and WebP are stored, judged by their first bytes. SVG and everything else is refused. Files are served with `nosniff` and a content security policy that runs nothing.
- Limits are 50 MB per file and 500 MB per module and game. Files are deleted along with the game.
- Only the player can move the folder, in the system's own dialog. A module cannot trigger the move or learn the path.

## Installing modules

A zip is checked before anything is extracted:

1. The manifest is read and validated first.
2. Only regular files are extracted. Links, absolute paths, `..`, drive letters, reserved Windows names and paths that differ only in case are refused.
3. The archive size, the unpacked size, the file count and the compression ratio are capped.
4. The signature is checked, and the publisher (a key, or `local` for an unsigned zip) is recorded by the host. Ids starting with `tavora.` are refused. A zip whose id is already installed is accepted only as an update signed by the same publisher, with a higher version.
5. Data is keyed by publisher and id. A module from another publisher that claims a removed module's id starts empty.
6. The module is unpacked into a temporary folder and moved into place, so a half-extracted module never loads.
7. Nothing from the archive is ever run.

### From the catalog

The Catalog view of the module library lists modules from Tavora's catalog and installs them. The catalog is a new way for the app to reach the network, so it follows these rules:

- **The app asks, never a module or page.** The main process fetches the list and the zip; the host UI gets checked plain values, and modules and Browser pages cannot reach the catalog at all. It is asked only while Online features (Settings > Online) are on, with no cookies or referrer, and with your sign-in only when you rate or reply. It learns only which zip is downloaded, which module's page you open, that you installed a module from Browse (its id, nothing about you), what you chose to report, and the ratings you post. The list is always the whole catalog, so it doesn't learn which game is open.
- **The server is not trusted.** Every listing is checked field by field, and its text is shown as plain text, never HTML or Markdown. The name shown after "by" is only the developer name the service gives for the publisher key, in the same plain name form as above.
- **Pictures are only pictures, the readme is only text, and the homepage is only a link.** A module's page shows the icon and screenshots its listing names. Tavora fetches a card's icon by its SHA-256 when the list shows it, and each screenshot only when you open the page, reads at most its listed size, checks the hash and that its first bytes are a PNG or WebP of at most 1 MB, (256 KB for an icon), and shows it as a plain picture, like a module icon. The service checks every screenshot and icon too before it lists them. The readme is read in the main process for its headings, paragraphs, lists, code, bold, italic and links only, and shown as plain text by the host UI (never as HTML): pictures and HTML are never loaded or run. A link in the readme shows its words and opens only when you click it, and only if its address is an `http` or `https` one that the module's current readme really contains: Tavora reads the readme again itself before opening it, so the page can't ask for any other address, and an address with another scheme is shown as plain words without a link. It opens in a Browser panel or where you pick, like the homepage. The homepage shows as plain text and opens only as an `http` or `https` address, like a module's link: in a Browser panel or where you pick. Tavora reads it from the listing again itself, never from the page that shows it. **The support link is only a button.** A module may name one `https` address or one email address as its `support` link. The page shows a Send feedback button, never the address as a link in the page, and nothing happens until you click it. Then Tavora reads the link again itself, from the module's own manifest or the catalog listing, and opens it only in these two forms: a web address like the homepage, in a Browser panel or where you pick, or an email address in your mail app as a plain `mailto:` link with just that address. Any other kind of address is refused, and a module can't pass an address of its own.
- **A zip is installed only if it is the listed one.** Tavora asks for the listing again itself, downloads the zip into memory with its listed size as a cap, and checks its SHA-256 against the listing before anything uses it. The zip then goes through every check of [Installing modules](#installing-modules), and must also be the listed module id and be signed by the listed publisher key, all before a file is written. An unsigned zip is refused.
- **A report names nothing about you.** Report, in the catalog or in Settings > Modules, sends Tavora only the module id, its publisher key and the SHA-256 of its zip (the installed one, for a module installed from the catalog), and only after you said yes. Reports are limited per connection and hide nothing by themselves: a person at Tavora looks at them and decides.
- **A rating is only what you post.** Rating a module needs a sign-in and the module installed, and sends the stars, your review's text and the installed version, nothing else about your PC or your other modules. The service keeps them with your account until you delete the rating or the account. Your review shows your profile name and picture; your profile stays private everywhere else. Reading reviews needs no sign-in. Reporting a review sends only its id.
- **Installing grants nothing.** A module installed from the catalog asks for its network hosts and connectors when it is added, like any other.
- **Updates come only from the same publisher, only forward, and never widen a module quietly.** While online features are on, Tavora downloads the whole catalog index (never a list of what you have installed) and compares it on your PC with the modules you installed from the catalog. An update is installed only if its zip passes every check above, including the safety lists, is signed by the same publisher key as the installed module (or its successor by a signed succession) and has a higher version; an older version, the same version or another key's zip is refused. Updates wait for you to press Update, unless you turned on **Update modules automatically** (off by default): then one that asks for nothing new installs at once and its panels reload. One that asks for network hosts or connectors the installed version did not always waits for your yes, with the setting on or off, and the installed version keeps running until then; allowing it grants exactly what the dialog showed. A module installed or replaced from a zip by hand is not updated from the catalog.

## The Browser panel

The Browser panel shows any website, so here the attacker is any page:

- A page cannot reach Node, Electron or the host. It has no preload and no bridge.
- Each game gets its own browser session, and a page cannot read module bundles.
- Only `http` and `https` pages open. `file:`, `tavora-module:` and other app protocols are refused, including through redirects.
- No new windows open. A clicked link that asks for one opens as one new tab.
- Downloads never write a file. Permissions are denied, except writing to the clipboard and fullscreen inside the panel.
- A public page cannot reach the player's PC or local network: requests to loopback, private and link-local addresses, local name endings and common router names are cancelled.
- Bad certificates are refused, with no way to click through. The toolbar shows the true address, with non-Latin labels shown as punycode.
- Ads and trackers are blocked in the main process, with EasyList and EasyPrivacy rules. No script is added to pages.

## Accounts and modules

Tavora accounts are optional. Modules learn nothing about them: no SDK call, bridge message or module view carries the player's email address, the sign-in or whether the player is signed in. How accounts handle data is on the [privacy page](https://mytavora.app/privacy/).

A developer can link a publisher key to their account, so players see a developer name instead of the key's fingerprint:

- **Only whoever holds the key can link it.** The signed-in app gets a one-time code (10 minutes, used once); the key signs it (Tavora itself for a key it keeps, `tavora-pack link` for a key file in CI), and the service checks that signature against the public half it was sent. The secret key never leaves the developer's PC, and the service keeps only public halves.
- **A name cannot pose as another.** Developer names are plain letters, digits, spaces, dots, dashes and underscores, unique when case and those separators are ignored, never Tavora's, changeable once every 30 days, and a name given up stays blocked for others for 30 days.
- **Players learn a name, nothing else.** Tavora asks the service which name a key has (only while online features are on, at most once a day per key) and gets the name alone, never an account or an address. The name shown is a label: what a player installs is still decided by the key's signature, as before.

### Publisher keys Tavora keeps

Tavora keeps a developer's publisher keys (Settings > Development), so the recovery key is the only thing they have to keep safe.

- **They are sealed with your recovery key.** The keys sit in your account's vault, sealed on your PC with a key derived from the recovery key, so the service only ever sees sealed bytes. Each PC keeps the vault as it last read it, sealed the same way, so signing works offline.
- **Only Tavora's own buttons sign.** Tavora signs when you press Publish on the review screen, or Save as zip in Settings > Development or a module's menu, and at no other time. It opens no pipe, socket or port for signing, so no other program, web page or module can ask it to sign.
- **What you see is what gets signed.** Tavora packs the zip itself from your module's project folder and shows the review screen from that zip: its name, version, patch notes and what it asks for. Pressing Publish there signs and uploads that zip and nothing else; the press is your yes.
- **A key leaves Tavora only when you export it**, to a file you pick, to publish from CI (Settings > Development > Publisher keys and CI). Packing works with that file alone; publishing also needs a publish token.

### Publishing to the catalog

- **The key alone publishes nothing.** Every upload carries the key's signature over the zip's SHA-256 and a sign-in of the account the key is linked to: Tavora's own, when you press Publish, or a publish token, from CI. An upload with only a key, or with the sign-in of another account, is refused.
- **Publish tokens are narrow.** A token is shown once and the service keeps only its hash. It works for a year, is removed in Settings > Development > Publisher keys and CI, and publishes only under id prefixes the account already holds, so it can't claim a new one. It can't sign in, read the account or change anything else.
- **Every upload is told.** The account's email address gets a mail for each published version, naming the module, the key and whether it came from Tavora or which token.

## The cloud copy

The cloud copy (Settings > Account) keeps your Tavora data on Tavora's service or in a folder you pick, so your other PCs get it. It is optional and off until you turn it on.

- **Only you can read it.** It is encrypted on your PC with AES-256-GCM, under a random key made there. The key leaves your PC only as the recovery key Tavora shows you. The service keeps sealed parts, a sealed list of files and a version number; parts are named by a keyed hash, so their names say nothing without the key. The key is kept with your system's key store, and the copy can't be turned on where there is none.
- **One key for the account.** The key belongs to your account, not to one PC: the first PC that needs it makes it, and the others get it from one of your PCs ([below](#adding-a-pc-from-another-one)) or ask for your recovery key. A small vault sealed with a key derived from it (at most 64 KB, holding the publisher keys Tavora keeps) stays on the service and goes out only to a signed-in PC of the account; that it exists tells a new PC to ask for your key instead of making another. Signing out forgets the key on that PC; turning the copy off doesn't.
- **A lost key starts over, never overwrites.** Start over makes a new key and replaces the copy with this PC's data under it. The publisher keys in the vault are lost with the old key; a key linked to the account can be replaced as [A lost or leaked key](./publishing.md#a-lost-or-leaked-key) says. A PC with the old key can't open the new copy, so it stops syncing and asks for the new key; it never writes over the copy.
- **It holds your Tavora data and nothing else.** That is what the daily backup holds (library, layouts, profile, every module's data, pictures), plus the installed modules and who publishes them. Sign-ins (Tavora's, Discord's, AI usage accounts), grants and Browser panel data are never in it.
- **A copy is checked before it is used.** Every part must open with the key and match its name, and every file its size and SHA-256. Every path must be one of the copy's own places: no `..`, absolute paths or other folders, and in the module files folder only Tavora's own folders. A copy is downloaded into a staging folder and swapped in only at start, before anything reads the data; what was there moves to the backups folder.
- **Modules in a copy come from you.** Only your key can make a copy, so its modules are not checked again like a new install. The safety lists still apply at start, and grants are not copied: a module asks again on each PC.
- **Older data never replaces newer.** The service takes a new version only from a PC that started from the current one. Otherwise you choose which side to keep, and the other is kept as a local backup.
- **A folder holds the same sealed copy.** In a folder you pick (usually one OneDrive, Dropbox or Google Drive syncs), Tavora writes only the sealed parts and lists, in a `Tavora` folder inside it, and your sync app moves them. Tavora's service is not used, and no account is needed: signed out, the key stays on your PC, kept like the account's key, and signing out doesn't turn a folder's copy off. Anything in that folder is checked like a download, since other apps and PCs can write there. Tavora only reads the names it writes, seals each list's version inside it so an old list can't pose as a newer one, never takes a list older than the one it last synced, and asks you which side to keep when two PCs saved at once. Deleting the copy removes only Tavora's files.
- **Modules and pages can't reach it.** No SDK call, bridge message or module view carries the copy, its key, the vault or whether it is on.

## Adding a PC from another one

A new PC can get the account's key from a PC that has it, so you only type the recovery key when every PC is gone. It is the same key, so the new PC can open the cloud copy and the publisher keys Tavora keeps.

- **Nothing on the way opens the key.** The new PC makes a one-time X25519 key and asks; an old PC answers with its own one-time key. On your click, the old PC seals the key with AES-256-GCM under a key both PCs derive from the two one-time keys, and only the new PC can open it.
- **Signed in, Tavora's service only passes it on.** It holds the request in memory, for 10 minutes and one per account, between PCs signed in to the account; the sealed key goes to the new PC once and is gone. Signed out, with the cloud copy in a folder of your own, the same steps go through files in its `Tavora/pairing` folder instead. Such a request lasts 24 hours, since a sync app can be slow, and Tavora reads only the names it writes there.
- **Nothing goes without a click on the old PC.** It shows "Add *PC name*?" with a 6-character code, and the new PC shows the same code. The code comes from both one-time keys, and the new PC commits to its key before it sees the old PC's, so no one in between, the service included, can swap a key and still get matching codes.
- **A stolen email account isn't enough.** Someone who signs in with it can ask, but gets the key only if you click Add on one of your PCs. Only add a PC you are setting up yourself, and only when the codes match. If you didn't ask, click Not me and sign that PC out under Account.
- **Modules and pages can't reach it.** Requests and answers stay in Tavora's main process, like the key itself.

## Revoked keys, blocked modules and lost keys

Tavora keeps three lists for modules from other people: publisher keys that were revoked, module zips it blocked, and new keys that replace an account's lost one. They are signed with Tavora's catalogue key, which is kept offline and never on the service.

- **Only Tavora's signature counts.** The app checks every list against the catalogue key built into it. A list signed by any other key, or older than the one the app already has, is ignored, so a service that was broken into can hold a new list back but cannot lift a block or revoke a key.
- **The lists come only while online features are on**, from the Tavora service, like hosted game icons: no cookies, no referrer and nothing that says who asks. The app never sends which modules it has.
- **A revoked key installs nothing new.** A zip signed by it is refused, for a first install and for an update, unless Tavora listed that exact zip as signed before the revocation. A module already installed keeps running.
- **A blocked zip stops at once.** Its panels close, it does not load, and Settings > Modules says why. Its data is kept, and it comes back only with a zip that is not blocked.
- **A new key replaces a lost one only by a signed statement.** Updates signed by the new key are accepted for the old key's modules, and their data stays where it was. Without a statement, a zip from another key is another publisher, as before.
- **Asking for one changes nothing by itself.** "Lost it?" in Settings > Account only queues a request on the service: both keys must be linked to the signed-in account, and the account's email address is told. A person at Tavora checks it, exports the waiting requests and signs them offline with the catalogue key, so a stolen sign-in or a service that was broken into still can't move a module to another key. The one thing a request does at once is stop the catalog from taking new uploads signed by a key reported as leaked.

## Known limits

- **The sandbox is Chromium's.** A Chromium renderer exploit would break the isolation guarantees, so Tavora follows Electron releases. Electron fuses turn off `RunAsNode`, `NODE_OPTIONS`, `--inspect` and extra `file://` privileges, and a packaged Tavora quits when started with switches that weaken the sandbox or the network rules.
- **Someone who can edit Tavora's files** on the PC can already act as the player. Local files are not protected from them.
- **CPU and memory are not capped.** A busy module is shown as not responding and can be stopped, but it can still use whatever its renderer gets.
- **Panels of one module share a process.** Several panels of the same module in one game share a renderer, so a crash can take down its siblings, but no other module.
- **Side channels** such as DNS prefetch or timing between modules are not fully addressed.
- **The Browser panel has no Safe Browsing.** A phishing page still renders. A public name that resolves to a local address (DNS rebinding) is not caught there, because the panel checks names, not resolved addresses. Sign-in popups that need `window.opener` do not work.
- **Discord's local connection is trusted.** Whatever listens where the Discord app listens gets the Discord token. A program that can do that is already running as the player.
- **Players who stay offline, or turn online features off, do not get new safety lists.** A revoked key or a blocked zip still works for them until they go online, and an unsigned module that is already installed is not stopped by a block.
- **Unsigned local modules are known only by their id.** Another local module put in the same folder under the same id gets its grants.
- **A development folder is a module's whole bundle.** A module loaded from a development folder (Settings > Development) can read every file in its project folder, such as its sources or a `.env` file, because G6 is measured from that folder. It is an unsigned local module, known only by its id. Add only your own projects.
- **WebAssembly is allowed only for Tavora's own modules** that ask for it, because the Whiteboard needs it. Community modules do not get it.

## Shared item tooltips

`ui.tooltip` renders checked, bounded plain content above neighbouring panels in a
separate host-owned surface. It accepts text, semantic item colours, badges,
requirements and modifier rows, plus a raster asset inside the calling module's
bundle. No HTML, module styles, links, scripts, remote images or arbitrary file
paths are accepted. Image reads stay inside that bundle and are limited to 512 KB.
The surface has its own sandboxed renderer and session, no administrative host
bridge, and no permissions. Its footer identifies the source module.

Hover requires recent trusted pointer or keyboard input in a visible source panel.
Hover details pass mouse input through and do not freeze the workspace. Pinning
requires a real click or key press, once per gesture. One tooltip is shared by the
window; ordinary hover cannot replace a pin. Only the owning panel can move or
close its current tooltip by id. Escape and the host close button always dismiss
it. Source hide, reload, close, game switch, app focus loss and host dialogs clear
it; stale asynchronous requests cannot revive a closed tooltip. Tooltips stay
inside Tavora's content bounds and do not open remote pages.

## Isolated public page importing

`network.readPage` renders one public HTTPS address in a hidden, sandboxed browser,
using a new temporary session for every call. It shares no cookies, storage,
sign-ins, browser tabs or bridge with the player or the module. The module supplies
only a URL; it cannot inject JavaScript, click, fill forms, choose headers or read
cookies. Tavora returns bounded page HTML, title, final URL and status after loading.
The page's own scripts may run, without Node or a preload. Popups, webviews,
downloads, device access and permission requests are refused. Login and verification
pages fail instead of asking for interaction.

Every page, script and data request needs an exact granted domain and HTTPS on the
standard port. Only GET/HEAD document, script, stylesheet and XHR requests are allowed;
images, media, fonts, frames, sockets and other resource types are blocked. A mandatory
session proxy resolves each connection, refuses any non-public address and connects
to the checked IP, so a second DNS resolution cannot redirect it into the local network.
Chromium still checks the destination's TLS certificate. Non-proxied WebRTC UDP is
disabled. This session never uses the player's Browser session or system proxy.

One import per module may run at once, for at most 30 seconds, with 200 resource
requests, 100 connections, five redirects, 20 MiB of total tunnel traffic and 5 MiB
of returned HTML. The window, tunnels and temporary storage are cleared after each
call; closing, reloading or disconnecting the source panel cancels its import.
An import can fail when a site needs resources on domains that were not granted,
requires interaction or changes its page format. No protection or verification is bypassed.

## JSON file exports

`files.exportJson` is the older way and stays for modules made before `files.saveJson`; new modules use `files.saveJson`, which asks you where to save. `files.exportJson` accepts at most 8 MiB of valid UTF-8 JSON after a real module click or key press, consumed once per request. The host serializes it as JSON and writes a new `.json` file inside Downloads/Tavora. Suggested names are sanitized, paths and extensions cannot be supplied, and existing files are never replaced. Modules receive only the resulting file name, never a filesystem path. Export does not grant arbitrary filesystem access.
