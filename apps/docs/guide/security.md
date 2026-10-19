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
| G4 | Use the network on its own. Everything but its own origin is blocked; hosts the player granted are reached only through `network.fetch`, which the main process makes. |
| G5 | Take down Tavora or other panels. A crash, hang or failed load is shown in that panel only, with Reload and Stop, and saved data is written atomically. |
| G6 | Read files outside its own bundle. Paths are resolved inside the module's folder; `..`, encoded `..`, links out and null bytes are refused. |
| G7 | Open windows, navigate away, download files or ask for devices (camera, microphone, location). |
| G8 | Exhaust the host through the bridge. Messages are plain JSON only, at most 8 MiB each, with at most 64 requests and 16 MiB in flight; an oversized message is refused inside the module's own renderer before the main process sees it. Settings, documents and panel state have quotas. |
| G9 | Use a capability the player did not grant. Gated calls check the player's grant first, on every call, and answer `PERMISSION_DENIED` otherwise. |
| G10 | Run code through its icon. Icons are PNG or WebP files inside the package, at most 256 KB, checked by their signature and shown as a plain picture. |
| G11 | Fill the disk through its own browser storage. Past 256 MB (or 5,000 files) the host ends the module's renderer, clears that storage and tells the player. A module can still write for up to one second before this happens. |

## Grants

A module lists what it needs in its [manifest](../reference/manifest.md). Nothing is granted by the manifest alone:

- **The player is asked when they add a module.** Tavora draws the consent dialog itself, from the manifest as the main process read it, along with who made the module (Tavora, a publisher key or an unsigned folder). A module cannot draw or hide that dialog. Preinstalled modules get no pre-approved grants.
- **The player grants exactly what they saw.** If an update asks for more while the dialog is open, it gets nothing it did not show.
- **Grants are kept by the host**, outside every module folder, for the module's publisher and id. Another publisher's module with the same id gets nothing.
- **Revoking takes effect at once.** Settings > Modules > Website access lists every module allowed to reach websites, and Settings > Integrations every module allowed to use Discord or AI usage. Taking a grant back shows the games the module is used in and removes its panels there; its data is kept. Data a module already received cannot be recalled.

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

## Calls that need a click

Some calls change something outside the module's panel. They work only within 2 seconds of a real click or key press in that panel; a script cannot fake one, and each press allows one call.

- **`links.open`** opens an `http` or `https` address in Tavora's Browser panel, or, after the player confirms, in the system browser. The module learns nothing back.
- **`clipboard.writeImage`** puts a checked PNG on the clipboard. There is no call to read the clipboard.
- **`pictures.save`** writes a checked PNG as a new file into one folder, `Pictures\Tavora`. The module only suggests a name, which Tavora cleans; it cannot pick another folder or file type, replace a file, or read anything back, and it never learns where the folder is.
- **`ui.showMenu`** shows a menu that Tavora draws above every panel, so it can lie outside the module's panel. Tavora checks the menu first and draws only plain text, separators, headings, check marks and colour dots from plain CSS colour values (nothing that loads or runs), in its own style. One menu shows at a time, it closes with Esc, a click elsewhere or a game switch, and the module learns only which of its own items the player chose, or that none was.
- **`panels.open`** opens, brings forward or switches a panel of the same module, in the game shown now, so it changes the workspace outside the module's panel. A module can open only its own panel types, never another module's panels, and one press opens or switches one panel. The panel asked to switch is the module's own page and may refuse; then nothing changes, and only the player can open the content in a new panel. The module learns only what Tavora did: shown, switched, opened or failed.

A module can still label a button misleadingly and get the player to click it. The result is the same as a link on any web page: the player sees the new tab, and the Browser panel is sandboxed.

A module can name its panel content without a click: **`panel.setContent`** names what the panel shows, and Tavora shows that name when the player hovers the panel's own tab. Tavora checks it first and shows only one line of plain text, at most 200 characters, below the panel's and the module's names, on that tab and nowhere else. The module learns nothing back.

A module's **patch notes** also show outside its panel, in Settings > Modules. They come from the changelog file in its package, not from the running page. Tavora reads at most 64 KB, checks the file first and shows only plain text lines (never HTML, Markdown or links), only for versions up to the installed one, and only when the player opens them.

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

- **The app asks, never a module or page.** The main process fetches the list and the zip; the host UI gets checked plain values, and modules and Browser pages cannot reach the catalog at all. It is asked only while Online features (Settings > Online) are on, with no cookies, referrer or sign-in, and it learns only which game or workspace the list is for, which zip is downloaded, which module's page you open, and what you chose to report.
- **The server is not trusted.** Every listing is checked field by field, and its text is shown as plain text, never HTML or Markdown. The name shown after "by" is only the developer name the service gives for the publisher key, in the same plain name form as above.
- **Pictures are only pictures, the readme is only text, and the homepage is only a link.** A module's page shows the icon and screenshots its listing names. Tavora fetches a card's icon by its SHA-256 when the list shows it, and each screenshot only when you open the page, reads at most its listed size, checks the hash and that its first bytes are a PNG or WebP of at most 1 MB, (256 KB for an icon), and shows it as a plain picture, like a module icon. The service checks every screenshot and icon too before it lists them. The readme is read in the main process for its headings, paragraphs, lists and code only, and shown as plain text: links keep only their words, and pictures and HTML are never loaded or run. The homepage shows as plain text and opens only as an `http` or `https` address, like a module's link: in a Browser panel or where you pick. Tavora reads it from the listing again itself, never from the page that shows it.
- **A zip is installed only if it is the listed one.** Tavora asks for the listing again itself, downloads the zip into memory with its listed size as a cap, and checks its SHA-256 against the listing before anything uses it. The zip then goes through every check of [Installing modules](#installing-modules), and must also be the listed module id and be signed by the listed publisher key, all before a file is written. An unsigned zip is refused.
- **A report names nothing about you.** Report, in the catalog or in Settings > Modules, sends Tavora only the module id, its publisher key and the SHA-256 of its zip (the installed one, for a module installed from the catalog), and only after you said yes. Reports are limited per connection and hide nothing by themselves: a person at Tavora looks at them and decides.
- **Installing grants nothing.** A module installed from the catalog asks for its network hosts and connectors when it is added, like any other.
- **Updates come only from the same publisher, only forward, and never widen a module quietly.** While online features are on, Tavora downloads the whole catalog index (never a list of what you have installed) and compares it on your PC with the modules you installed from the catalog. An update is installed only if its zip passes every check above, including the safety lists, is signed by the same publisher key as the installed module (or its successor by a signed succession) and has a higher version; an older version, the same version or another key's zip is refused. An update that asks for nothing new installs at once and its panels reload. One that asks for network hosts or connectors the installed version did not waits for your yes, and the installed version keeps running until then; allowing it grants exactly what the dialog showed. A module installed or replaced from a zip by hand is not updated from the catalog.

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

- **Only whoever holds the key can link it.** The signed-in app gets a one-time code (10 minutes, used once); `tavora-pack link` signs it with the secret key, and the service checks that signature against the public half it was sent. The secret key never leaves the developer's PC, and the service keeps only public halves.
- **A name cannot pose as another.** Developer names are plain letters, digits, spaces, dots, dashes and underscores, unique when case and those separators are ignored, never Tavora's, changeable once every 30 days, and a name given up stays blocked for others for 30 days.
- **Players learn a name, nothing else.** Tavora asks the service which name a key has (only while online features are on, at most once a day per key) and gets the name alone, never an account or an address. The name shown is a label: what a player installs is still decided by the key's signature, as before.

## Revoked keys, blocked modules and lost keys

Tavora keeps three lists for modules from other people: publisher keys that were revoked, module zips it blocked, and new keys that replace an account's lost one. They are signed with Tavora's catalogue key, which is kept offline and never on the service.

- **Only Tavora's signature counts.** The app checks every list against the catalogue key built into it. A list signed by any other key, or older than the one the app already has, is ignored, so a service that was broken into can hold a new list back but cannot lift a block or revoke a key.
- **The lists come only while online features are on**, from the Tavora service, like hosted game icons: no cookies, no referrer and nothing that says who asks. The app never sends which modules it has.
- **A revoked key installs nothing new.** A zip signed by it is refused, for a first install and for an update, unless Tavora listed that exact zip as signed before the revocation. A module already installed keeps running.
- **A blocked zip stops at once.** Its panels close, it does not load, and Settings > Modules says why. Its data is kept, and it comes back only with a zip that is not blocked.
- **A new key replaces a lost one only by a signed statement.** Updates signed by the new key are accepted for the old key's modules, and their data stays where it was. Without a statement, a zip from another key is another publisher, as before.

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
