# Bridge protocol v1

**Status:** Version 1 is what `@tavora/sdk` 0.2.4 speaks. It may still change before Tavora's first public release; after that, breaking changes need a new major version (see [Versioning](#versioning)). What changed when is in the [changelog](./changelog.md).

Module authors normally use `@tavora/sdk` and never see these messages. This page is for people writing another SDK, reviewing the host, or debugging.

## Connecting

1. The module posts `{ type: "tavora:hello", v: 1 }` to its own window (`window.postMessage(..., location.origin)`).
2. The host's preload sees it and asks the main process for a channel. The main process creates a `MessagePort` pair and binds it to the panel that asked: its module id, game and panel instance. Only the panel's top frame can ask; iframes are ignored.
3. The preload posts `{ type: "tavora:port", v: 1 }` back to the window with the port attached.
4. The module sends `bridge.handshake` on the port. Every other request before a successful handshake fails with `BAD_REQUEST`, and the host sends no events until then.

Asking again (a new hello) closes the old port and creates a new one. A reload or navigation inside the module also closes the port; the new page connects again.

Identity is never part of a message. Fields such as `moduleId` or `gameId` in params are rejected or ignored: the host only uses what it bound to the port.

## Messages

All messages are plain JSON-compatible objects (structured clone of JSON values).

**Request**, module to host:

```json
{ "v": 1, "id": 7, "method": "storage.set", "params": { "key": "count", "value": 3 } }
```

`id` is a positive integer chosen by the module, unique among its requests in flight. Messages without a usable `id` are dropped, since there is nobody to answer.

**Response**, host to module, exactly one per request:

```json
{ "v": 1, "id": 7, "ok": true, "result": null }
{ "v": 1, "id": 7, "ok": false, "error": { "code": "QUOTA_EXCEEDED", "message": "settings are limited to 5242880 bytes per module and game" } }
```

**Event**, host to module, after the handshake:

```json
{ "v": 1, "event": "workspace.resize", "data": { "width": 500, "height": 624 } }
```

Ports a module attaches to a message are closed by the host.

## Methods

Methods without params must be sent with `params` left out.

| Method | Params | Result |
| --- | --- | --- |
| `bridge.handshake` | `{ protocol: 1, sdkVersion: string }` | `{ protocol: 1, host: { name: "tavora-desktop", version }, module: { id, version }, capabilities, panel: { type } }`: `capabilities` lists what the player has granted, such as `["network"]`; `panel.type` is the [panel type](./manifest.md#panel-types) this panel shows, or `null` for a module without panel types (Tavora 0.17.12 and newer) |
| `game.getCurrent` | none | `{ id, displayName, kind }` of the game this panel belongs to; `kind` is `"game"`, or `"workspace"` for a personal workspace that belongs to no game (Tavora 0.18.1 and newer; an older Tavora leaves it out, which means a game) |
| `storage.get` | `{ key }` | the stored JSON value, or `null` |
| `storage.set` | `{ key, value }` | `null` |
| `storage.delete` | `{ key }` | `null` |
| `storage.keys` | none | sorted array of keys |
| `storage.app.get`, `storage.app.set`, `storage.app.delete`, `storage.app.keys` | as `storage.*` | the same calls for settings shared by every game, see [Where data lives](#where-data-lives) |
| `documents.list` | none | `DocumentSummary[]`, newest first |
| `documents.get` | `{ id }` | `{ id, title, revision, updatedAt, bytes, data }` or `null` |
| `documents.put` | `{ id?, title, data, ifRevision? }` | `DocumentSummary` of the saved document |
| `documents.delete` | `{ id, ifRevision? }` | `null` (also when the document did not exist) |
| `panel.getState` | none | this panel's state, or `null` |
| `panel.setState` | `{ value }` | `null`; `value: null` removes the state |
| `panel.getLaunch` | none | why this page is loading, the same on every call until it loads again: `{ reason: "add" }` for a panel the player just added, `{ reason: "restore", content }` for one that was open before, with what it last showed through `panel.setContent` (or `null`), or `{ reason: "open", content }` for one another panel opened with `panels.open` (Tavora 0.17.18 and newer). See [Content per panel](#content-per-panel) (Tavora 0.17.17 and newer) |
| `panels.open` | `{ type, content? }` | `"shown"`, `"switched"`, `"opened"` or `"failed"`: opens one of this module's own panel types in the current game, on `content` (`{ id, title }`) when given. See [Opening another panel](#opening-another-panel). Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a type the module does not have (Tavora 0.17.18 and newer) |
| `panel.navigated` | `{ requestId, handled, ok }` | `null`; the answer to a `panel.navigate` event. The SDK sends it for you from `panel.onNavigate` (Tavora 0.17.18 and newer) |
| `panel.setContent` | `{ content }` | `null`; `content` is `{ id, title }` or `null`: what the panel shows now. `id` is your own, 1 to 200 characters; `title` is its full name, 1 to 200 characters, kept on one line. `INVALID_PARAMS` otherwise (Tavora 0.17.17 and newer) |
| `panel.isMaximized` | none | `true` while the panel fills the workspace (Maximize in its menu, or `panel.setMaximized`) (Tavora 0.20.20 and newer) |
| `panel.setMaximized` | `{ maximized }` | `null`; `true` makes the panel fill the workspace, as Maximize in its menu does, `false` puts it back. Nothing happens while the panel is the only one, as it fills the workspace already. `true` only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise) (Tavora 0.20.20 and newer) |
| `workspace.getViewport` | none | `{ width, height }` of the panel in CSS pixels |
| `ui.getLanguage` | none | the language of Tavora's own texts as a code, `"en"` or `"de"` for now; show your module in it, or in English when you have no translation |
| `ui.showMenu` | `{ items, at, side?, align? }` | the chosen item's `id`, or `null` when the player closed the menu; see [Menus](#menus) |
| `links.open` | `{ url }` | `null`; opens the web address (http or https, at most 2048 characters) as a new tab in the game's Browser panel, or in a new Browser panel. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for anything but a web address. You learn nothing about the page |
| `blobs.list` | none | `BlobInfo[]` (`{ id, bytes, type, createdAt }`), oldest first |
| `blobs.usage` | none | `{ bytes, count, maxBytes, maxFileBytes }` for this module and game |
| `blobs.delete` | `{ id }` | `null` (also when the file did not exist); `INVALID_PARAMS` for an id the host did not make |
| `ui.getTheme` | none | `{ mode, colors: { background, surface, text, textMuted, accent }, tokens, radius }`: `tokens` holds every semantic colour by its shadcn-vue name (`THEME_TOKENS`), `radius` is in CSS pixels |
| `network.fetch` | `{ url, method?, headers?, body?, responseType? }` | `{ status, url, headers, body }`; needs the `network` capability, see [Network](#network) |
| `network.readPage` | `{ url }` | `{ status, url, title, html }`; isolated public page capture, same `network` grant, Tavora 0.19.3+ |
| `aiUsage.accounts` | none | `AiUsageAccountInfo[]` in the player's order; needs the `aiUsage` capability, see [Connectors](#connectors) |
| `aiUsage.read` | `{ accountId }` | `AiUsageReading`; needs the `aiUsage` capability |
| `systemInfo.info` | none | `SystemInfo`; this PC's processor, memory, graphics cards and drives. Needs the `systemInfo` capability, see [Connectors](#connectors). Tavora 0.21.1+ |
| `systemInfo.watch` | `{ blocks, intervalMs }` | `null`; sets what this panel watches, see [Connectors](#connectors). Needs the `systemInfo` capability |
| `discord.state` | none | `DiscordState`; starts the connection for this panel. Needs the `discord` capability, see [Connectors](#connectors) |
| `discord.connect`, `discord.allowControl` | none | `null`; only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise) |
| `discord.command` | `{ command, args }` | `DiscordResult`; one of `DISCORD_COMMANDS` |
| `discord.subscribe`, `discord.unsubscribe` | `{ event, channelId? }` | `null`; one of `DISCORD_EVENTS` |
| `discord.image` | `{ url }` | a small PNG as a `data:` address, or `null` |
| `overlay.publish` | `{ key, state }` | `null`; what the overlay for `key` shows now, on its stream link and over the game. Needs no capability since Tavora 0.20.51; before that it needed `overlay`. See [Stream overlays](#stream-overlays) (Tavora 0.19.26 and newer) |
| `overlay.remove` | `{ key }` | `null`; the overlay shows nothing until it is published again, and keeps its link. Needs no capability since Tavora 0.20.51 |
| `overlay.copyLink` | `{ key }` | `"copied"`: the link is on the clipboard; `"off"`: Stream overlays are off, and Tavora opened that setting. `"denied"`: the module asks for the connector on request and the player said no in Tavora's dialog (Tavora 0.19.32 and newer). Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise) |
| `overlay.resetLink` | `{ key }` | `null`; the overlay gets a new link and the old one stops working. Needs the `overlay` capability |
| `overlay.showOverGame` | `{ key }` | `"shown"`: the overlay is over the game now, or already was; `"off"`: Game overlays are off, and Tavora opened Settings > Overlays; `"full"`: the game already has 8. Needs no capability. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a module without an `overlay` page. See [Game overlays](#game-overlays) (Tavora 0.20.51 and newer) |
| `overlay.hideOverGame` | `{ key }` | `null`; takes this module's game overlay for `key` away in the panel's workspace scope (a game, or the general ones). Needs no click and no capability; nothing happens when there is none (Tavora 0.21.2 and newer) |
| `overlay.overGame` | none | `string[]`; the keys of this module's game overlays in the panel's workspace scope. Needs no capability (Tavora 0.21.2 and newer) |
| `overlay.preview` | `{ key }` | `null`; opens a small Tavora window showing the overlay for `key` at its real size, on a dark, light or checkered background, so the player can see how it looks. One window per overlay; a second call brings it forward. Needs no capability and works whether Game overlays and Stream overlays are on or off. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a module without an `overlay` page. See [Overlay preview](#overlay-preview) (Tavora 0.21.2 and newer) |
| `hotkeys.list` | none | `{ action, target }[]`: the hotkeys the player set for this module in the current game, never the keys. See [Hotkeys](#hotkeys) (Tavora 0.19.26 and newer) |
| `hotkeys.set` | `{ action, target, label }` | `"set"`, `"removed"` or `"cancelled"`: what the player did in Tavora's hotkey dialog. Only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for an action the manifest does not list |
| `hotkeys.remove` | `{ target, action? }` | `null`; removes the target's hotkeys, or only the one for `action` |

### Where data lives

| Kind | Scope | Removed when |
| --- | --- | --- |
| `storage` | module + game, shared by all its panels | never by closing panels; later by uninstalling (Milestone C) |
| `storage.app` | module, shared by all its panels in every game | never by closing panels or deleting a game; with the module's data in Settings > Modules |
| `documents` | module + game, shared by all its panels | as above |
| `blobs` (pictures) | module + game, shared by all its panels | the game is deleted from the Trash; never by closing panels |
| `panel` state | one panel instance | the panel is closed |
| panel content (`panel.setContent`) | one panel instance | the panel is closed |

A module never sees another module's data, or its own data for another game (except what it keeps in `storage.app` for every game). `storage.app` has the same limits as a game's `storage`; use it for settings the player expects to stay the same from game to game. Data belongs to the module's id together with who published it (the key that signed its zip, or "local" for an unsigned folder), so a module from another publisher with the same id starts with nothing.

### Files (blobs)

A module can keep pictures that are too big for a document: up to 50 MB each and 500 MB together per module and game. They live in a folder Tavora manages (`module-blobs` in its data folder by default; the player can move it in Settings > Modules), shared by all of the module's panels, and are removed with the game.

- **Storing:** `sdk.blobs.put(file)` sends the file to the module's own address, `POST /_blobs/`, as the request body, so it is streamed to disk and never held in memory whole. The answer is a `BlobInfo`: `id` (32 lowercase hex characters chosen by the host), `bytes`, `type` and `createdAt`. A module never names a file.
- **Showing:** `sdk.blobs.url(id)` is the address to use as an image source (`GET /_blobs/<id>`). It only works from the module's own page.
- **What is accepted:** PNG, JPEG, GIF and WebP, judged by the first bytes of the file itself, never by its name or type. Anything else (SVG, BMP, documents, scripts) is refused with `INVALID_PARAMS`. Over the limits it is `QUOTA_EXCEEDED`, and nothing is left behind.
- **Serving:** each file is sent with its real type, `X-Content-Type-Options: nosniff` and a policy that lets it load nothing, so a picture can only be shown.

### Clipboard

`sdk.clipboard.writeImage(png)` puts a picture on the system clipboard so the player can paste it into any app. The PNG is sent to the module's own address, `POST /_clipboard/`, as the request body.

- **Only after the player did something:** it must follow a real click or key press in the module (within 2 seconds), and one press copies one picture; otherwise it is refused with `PERMISSION_DENIED`. Call it from the click handler of the button.
- **Only a complete PNG:** the host checks every part of the file before using it (`INVALID_PARAMS` for anything else, such as a different format, a cut-off or damaged file, or a picture over 16384 pixels on a side or 100 million pixels), and a file over 20 MB is `QUOTA_EXCEEDED`.
- **Write only:** a module cannot read the clipboard.

### Saving pictures

`sdk.pictures.save(png, name)` saves a picture as a `.png` file where the player says. Tavora's save dialog opens in the folder they last saved a picture to, at first Tavora's own folder in their Pictures (`Pictures\Tavora`), with `name` filled in. The PNG is sent to the module's own address, `POST /_pictures/?name=…`, as the request body, and the answer is `{ fileName }`, the name the file was saved under, or `null` when the player closed the dialog. Tavora 0.20.16 and older save in `Pictures\Tavora` without a dialog.

- **Only after the player did something:** the same as the clipboard, one picture per click or key press within 2 seconds, otherwise `PERMISSION_DENIED`. A press used for the clipboard is used up for saving too.
- **Only a complete PNG,** with the same checks and limits as the clipboard (`INVALID_PARAMS`, `QUOTA_EXCEEDED`).
- **The player picks the file:** `name` is a suggestion. Tavora takes out anything a file name cannot hold (slashes, colons, control characters, leading and trailing dots), shortens it to 80 characters, uses `Picture` when nothing is left, adds `.png`, and adds ` (2)`, ` (3)` and so on when the folder already has it. Only the player chooses the folder and name, and a file is replaced only when they confirm that in the dialog. A module cannot choose the folder or the type, and never learns where the file went.

### Menus

`sdk.ui.showMenu(request)` shows a menu that Tavora draws above every panel, in its own style and theme. A menu inside your page is cut off at the panel's edge; this one is not.

- **Only after the player did something:** call it from the click, right-click or key press that asked for it (within 2 seconds); each press opens one menu, otherwise `PERMISSION_DENIED`. One menu shows at a time: a new one closes the last, and Esc, a click elsewhere or switching games closes it too. It resolves with the chosen item's `id`, or `null`.
- **Where:** `at` is in your panel's CSS pixels from its top left corner (`getBoundingClientRect()` values). Give the pointer's `{ x, y }` for a context menu, or a button's `{ x, y, width, height }` for a dropdown next to it. `side` (`"bottom"`, `"top"`, `"right"`, `"left"`; default bottom) and `align` (`"start"`, `"center"`, `"end"`; default start) say where it opens when there is room; Tavora keeps it inside the window.
- **What:** `items` is a list of entries:
  - `{ type: "item", id, label, hint?, color?, checked?, radio?, disabled?, danger? }`: `id` is what you get back (unique in the menu, up to 64 letters, digits, `.`, `_`, `:` or `-`). `hint` is small text on the right, such as a shortcut. `color` adds a dot: `#rgb`/`#rrggbb`, a colour function of numbers such as `oklch(0.7 0.17 150)`, or `transparent` for an empty ring. `checked` shows a check mark (a dot with `radio`); in a list where any item sets it, the others keep the column so labels line up. `danger` makes it red.
  - `{ type: "separator" }` and `{ type: "heading", label }`.
  - `{ type: "submenu", label, color?, disabled?, items }`: one level only; its items hold no further submenus.
- **Text only:** labels are plain text (at most 80 characters, hints 30), never HTML, and a menu holds at most 100 entries, submenus included. Anything else is `INVALID_PARAMS`. There are no sliders or other controls in menus; keep those in your page.

```ts
button.addEventListener("click", async () => {
  const box = button.getBoundingClientRect();
  const choice = await tavora.ui.showMenu({
    at: { x: box.left, y: box.top, width: box.width, height: box.height },
    align: "end",
    items: [
      { type: "item", id: "rename", label: "Rename", hint: "F2" },
      { type: "submenu", label: "Color", items: [{ type: "item", id: "red", label: "Red", color: "#e5675a", radio: true, checked: true }] },
      { type: "separator" },
      { type: "item", id: "delete", label: "Delete", danger: true },
    ],
  });
  if (choice === "rename") startRename();
});
```

### Network

A module's page has no network of its own: it cannot fetch, load remote images or open sockets. It names the hosts it needs in [`permissions.network`](./manifest.md), and once the player has granted them, `sdk.network.fetch(url, init)` asks Tavora to make the request. The player is asked when they first add the module; until they agree, the handshake reports no `network` capability and every call fails with `PERMISSION_DENIED`. When an update asks for more hosts, what was granted keeps working and the module's panels offer the player to review the new ones. The player can take a grant back at any time in Settings > Modules > Website access, which removes the module's panels.

- **Which addresses:** only `https:` on the standard port, to a host the module lists and the player granted, without a user name or password. A redirect is followed only to such an address too (at most 5); anything else is `PERMISSION_DENIED`. A granted name that points to this PC or the local network is refused as well.
- **Params:** `method` is `GET` (default), `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`; `headers` is an object of text values; `body` is text (send binary data as base64 or JSON), not allowed with `GET` and `HEAD`; `responseType` is `"text"` (default, read as UTF-8) or `"base64"` for pictures and other binary answers.
- **Set by Tavora:** `Cookie`, `Host`, `Origin`, `Referer`, `User-Agent` (`Tavora/<version> (module <id>)`), `Accept-Encoding`, `Connection`, `Content-Length`, `Transfer-Encoding` and the other transfer headers, `Proxy-*` and `Sec-*` cannot be sent (`INVALID_PARAMS`). No cookies are sent or kept. On a redirect to another host, `Authorization` is dropped.
- **The answer:** `status`, the final `url`, `headers` with lowercase names (without `Set-Cookie`), and `body`. Compressed answers are unpacked. An error status such as 404 or 500 is an answer, not an error.
- **Limits:** at most 5 MB of body (after unpacking; `QUOTA_EXCEEDED` otherwise), 15 seconds per request including redirects, and 6 requests at once per panel (`BAD_REQUEST` for a seventh). When no answer comes at all (unknown host, refused connection, certificate error, too slow), the error is `NETWORK_ERROR`.
- **To show a picture** from a granted host, ask for `responseType: "base64"` and use a `data:` address, or store it with `blobs.put`.

### Isolated public pages

`sdk.network.readPage(url)` is an optional public-page fallback when a source needs
its own scripts to render. Set `minTavora` to `0.19.3` or newer. It accepts no script,
selector or interaction. The hidden sandbox uses a new session with no player sign-ins,
and only granted HTTPS domains; it closes after capturing HTML. A module parses that
HTML as untrusted data and must never evaluate scripts extracted from it. Verification
and login pages fail with `NETWORK_ERROR`; attach a file as a fallback. There is one
active page import per module (`BAD_REQUEST` otherwise), a 30-second deadline and a
5 MiB returned-HTML limit. Panel disconnect cancels the import. Resource and connection
limits and DNS protection are described in the [security model](../guide/security.md#isolated-public-page-importing).

### Connectors

A connector is a part of Tavora that reaches outside the module's panel, such as a sign-in or streaming software on this PC, and lets a module use it without ever seeing what is behind it. A module asks for one in [`permissions.connectors`](./manifest.md); the player agrees when they first add the module, and can take it back in Settings > Integrations. Until then the handshake reports no capability for it and its calls fail with `PERMISSION_DENIED`.

**`ai-usage`** (capability `aiUsage`, `sdk.connectors.aiUsage`): the Claude and Codex accounts the player set up in Settings > Integrations > AI usage, by the folder of each CLI profile. Tavora reads each account with its own login and hands over only the answer.

- `aiUsage.accounts` gives `{ id, provider, label, plan }` per account, in the player's order: `provider` is `"claude"` or `"codex"`, `plan` a name such as `"Pro"` or `"Max 5×"`, or `null`. The profile folder is never given out. The `aiUsage.accountsChanged` event says the list changed.
- `aiUsage.read` gives `{ status, retryAfterMs, answer, email, plan, readAt }`. `status` is `ok`, `sign-in` (no usable subscription login), `rate-limited` (wait `retryAfterMs`), `api-key` (the profile uses an API key, which has no subscription allowance), `cli-missing` (the Codex command line is not installed) or `unavailable`. For `ok`, `answer` is the provider's answer as it came: Claude's usage answer (undocumented, it may change) or the result of the Codex app-server's `account/rateLimits/read`. `email` is who is signed in, when the provider says; keep it in memory only. `readAt` is an ISO 8601 time.
- Tavora reads each account at most once a minute for all modules together; asking sooner gives the last reading again, and a provider's wait applies to every module. One read can take up to 40 seconds while the Codex command starts. An unknown `accountId` is `INVALID_PARAMS`.

**`system-info`** (capability `systemInfo`, `sdk.connectors.systemInfo`, Tavora 0.21.1+): this PC's hardware and how busy it is. Tavora reads Windows' own performance counters inside its process, the same numbers Task Manager shows. It starts no helper program, uses no driver and no sensor, and sends nothing anywhere. A module gets numbers and names only, never a path, a serial number or a file name.

- `systemInfo.info` gives `{ cpu: { model, threads }, ramBytes, gpus, drives }`. `gpus` lists the graphics cards as `{ id, name, dedicated, vramBytes }` without software adapters; `id` is the card's LUID such as `"0x00000000_0x0001defc"`, `dedicated` means 512 MB or more of its own memory. `drives` lists the drives with a letter as `{ id: "C:", label, kind, totalBytes }`; `kind` is `internal`, `removable`, `network` or `other`, CD and DVD drives are left out, and a network drive has an empty `label` and no size, because asking it can hold everything up. Tavora reads it once and keeps it; ask again after `systemInfo.drivesChanged`.
- `systemInfo.watch` takes `{ blocks, intervalMs }` and replaces what this panel watched before. `blocks` may hold `cpu`, `gpu`, `ram`, `tavora` (each `true` or `false`) and `drives` (up to 26 letters such as `"C:"`); anything else, or an `intervalMs` other than 1000, 2000, 5000, 15000 or 60000, is `INVALID_PARAMS`. Empty `blocks` stop watching. A first `systemInfo.snapshot` follows almost at once, then one every `intervalMs`.
- Tavora reads the PC only while at least one panel that is shown watches something, and opens only the counters those panels need. A panel that is hidden, minimized or covered gets no snapshots and counts for nothing; when it is shown again it gets a snapshot at once. With no watching panel nothing runs at all. Panels share one reader, so more panels cost almost nothing.
- A `systemInfo.snapshot` holds `at` (milliseconds since 1970), `intervalMs` and only the blocks the panel asked for. `cpu` is `{ usage, peak, cores }`, `gpus` is `{ id, usage, peak, vramUsedBytes }` for each graphics card, `ram` is `{ usedBytes, totalBytes }`, `drives` is `{ id, connected, freeBytes, totalBytes, readBytesPerSec, writeBytesPerSec }` for each drive asked for, in that order, and `tavora` is `{ cpu, memoryBytes }` for Tavora itself. Percentages run from 0 to 100 with one decimal. `usage` is the average since the last snapshot, as Task Manager counts (a graphics card is as busy as its busiest kind of work, such as 3D). `peak` is the busiest second since the last snapshot when `intervalMs` is 5000 or more, and the same as `usage` below that. A drive that is gone (an unplugged USB stick) has `connected: false`, `null` sizes and speeds of 0. A block Windows can't read right now is left out.
- `systemInfo.drivesChanged` says a drive letter appeared or went away; ask `systemInfo.info` again. It comes only while the panel watches.
- Outside Windows the connector answers with the processor and memory only: no graphics cards, no drives and no `cpu`, `gpus` or `drives` in snapshots.

**`discord`** (capability `discord`, `sdk.connectors.discord`): the Discord app on this PC, through Tavora's own Discord sign-in (PKCE, no Client Secret). Tavora keeps the local connection, the sign-in and the token; a module sends a fixed list of RPC commands and gets Discord's answers as they came. Nothing goes through Tavora's service, and Tavora can't hear, talk or read messages.

- `discord.state` gives `{ status, error, user, canControl, canSaveSignIn }` and makes the panel a user of the connection, which runs while at least one panel uses it and stops with the last one. `status` is `connecting`, `not-running` (no Discord app found; Tavora keeps looking), `signed-out`, `approving` (Discord shows its pop-up), `connected` or `error`; `error` is then `not-approved`, `no-code`, `offline`, `no-sign-in` or `failed`. `canControl` says the sign-in may mute and deafen; one made before Tavora 0.5.11 can't until the player presses a button that calls `discord.allowControl`. The `discord.state` event tells every change.
- `discord.connect` signs in, asking for approval in Discord the first time. It and `discord.allowControl` only work right after a real click or key press in the panel, once per click.
- `discord.command` sends one of these, with exactly these arguments (anything else is `INVALID_PARAMS`): `GET_SELECTED_VOICE_CHANNEL` and `GET_GUILDS` (no arguments), `GET_GUILD` and `GET_CHANNELS` (`guild_id`), `GET_CHANNEL` (`channel_id`), `SELECT_VOICE_CHANNEL` (`channel_id`, or `null` to leave; only right after a real click or key press, once per click), `SET_VOICE_SETTINGS` (`mute` and/or `deaf`; needs `canControl`, and like joining only right after a real click or key press, once per click, since unmuting turns the player's microphone back on) and `SET_USER_VOICE_SETTINGS` (`user_id` with `volume` 0 to 200 and/or `mute`). Ids are Discord ids (digits). The result is `{ ok: true, data }` with Discord's answer, or `{ ok: false, reason, code, message }`: `not-connected`, `refused` (Discord's error `code` and `message`) or `no-answer` (no answer in 15 seconds, the connection ended, or an answer over 512 KB). Joining takes the player out of a call they are in, as Discord's own list does.
- `discord.subscribe` sends a Discord event to this panel as the `discord.event` event (`{ event, data }`, the data as Discord sent it) until `discord.unsubscribe` or the panel goes. `VOICE_CHANNEL_SELECT` (the player joined, moved or left) takes no `channelId`; `VOICE_STATE_CREATE`, `VOICE_STATE_UPDATE`, `VOICE_STATE_DELETE`, `SPEAKING_START` and `SPEAKING_STOP` need the voice channel's id. Subscriptions are kept across reconnects and shared: Discord is asked once, whichever panels want it. At most 32 per panel.
- `discord.image` fetches a picture from Discord's image server, an avatar (`https://cdn.discordapp.com/avatars/<user id>/<hash>.<ext>`) or a server icon (`…/icons/<server id>/<hash>.<ext>`, as `GET_GUILD` gives it), and gives it as a small PNG `data:` address; any other address, or any problem, gives `null`.
- Names and everything else from Discord are Discord's: show them as text only.

### Stream overlays

A module that lists an [`overlay`](./manifest.md#overlay) page and the `stream-overlay` connector can show it in OBS or other streaming software on the player's PC, as a Browser Source. It works with keys: one overlay per key, such as an item id, each with its own link.

- `overlay.publish` sets what the overlay for a key shows: any JSON, at most 16 KB. Tavora keeps it, so the overlay goes on showing it while none of the module's panels runs, and after a restart. Publish when something changes, not on every frame: a running clock publishes when it starts or stops, and its overlay counts the time itself.
- `overlay.copyLink` puts the overlay's link on the clipboard after a click. It and `overlay.resetLink` are the calls that need the connector. A module that lists the connector in [`permissions.onRequest`](./manifest.md) is not asked for it when it is added; Tavora shows its consent dialog on the first `copyLink` instead, and the call gives `"denied"` if the player says no. The player turns Stream overlays on in Settings > Streaming; while they are off, the call gives `"off"` and Tavora opens that setting.
- `overlay.remove` empties an overlay (an item was deleted) and `overlay.resetLink` gives it a new link. The player can also reset every link in Settings.

The overlay page runs in the streaming software, not in Tavora, so it has no bridge. It reads what the module published from `_state` next to it as server-sent events, each message `{ "state": <JSON or null> }`, the first one right away; `watchOverlay(fn)` in the SDK does it for you and reconnects when Tavora restarts. `null` means there is nothing to show.

Tavora serves the page and the files next to it from `127.0.0.1` only, under a random link per overlay, with a policy that loads nothing from anywhere else and talks only to Tavora. The link works while Stream overlays are on, the module is installed under the same publisher and the player still grants the connector; otherwise it gives `404`. Theme and language don't reach the overlay: give it what it needs in the state.

### Game overlays

The same [`overlay`](./manifest.md#overlay) page can also be shown over the player's game, in a window of Tavora's own, with `overlay.showOverGame(key)`. Call it from the click or key press that asked for it, for example a Show over game button. The page and what it publishes work exactly as for Stream overlays (one page per key, `overlay.publish`, `watchOverlay`), and it needs no connector and no permission: the player decides in Settings > Overlays.

- The call gives `"off"` while the player has Game overlays off (they are off at first); Tavora then opens Settings > Overlays. It gives `"full"` when the game already has 8 game overlays; the player can remove one there. Otherwise it gives `"shown"`, also when the overlay was already added.
- The overlay shows only while its game is running and in front, and hides when the player switches to another window, Tavora included. The player picks per overlay whether it is always shown or toggled by a key, how see-through it is, and whether it hides from screen capture (it shows in capture at first). They place and resize it in the game by holding the in-game layer open with the "Tavora over game" key.
- An overlay asked for from a game's workspace shows only over that game. One asked for from a workspace that is no game, such as Personal, is general: it shows over every library game in front. A game has room for 8, and the general ones for another 8.
- Tavora draws its own window above the game. It does not touch the game: nothing is injected into it or drawn by it. Games that run in exclusive full screen hide it; the player is told to switch the game to borderless. Windows only; elsewhere the call gives `"off"`.
- The page has no bridge and runs under the same policy as a Stream overlay page, with no network. Clicks go through it to the game, so it can't take input.
- Theme and language don't reach the page, and its size is the player's choice, so lay it out for any size and keep its background transparent.
- A panel type that sets [`inGame: true`](./manifest.md#panel-types) in the manifest gets **Show in game** in its menu. The panel is then over the game only while the player holds the in-game layer open (their "Tavora over game" key), and goes back into its workspace slot when the layer closes. Your panel isn't told and calls nothing different: it keeps its bridge, and hears `workspace.resize` for the new size, `lifecycle.suspend` and `lifecycle.resume` as it moves. Clicks and key presses reach it only while the layer is open. While it is in the layer, calls that need Tavora's own window (`pictures.save`, `files.saveJson`, `files.openJson`, `files.pickReadOnly`, `overlay.copyLink` when it needs the consent dialog or a setting, `overlay.showOverGame`, `overlay.preview`, `hotkeys.set`, `ui.showMenu`, `panels.open`, `panel.setMaximized` and `links.open`) are refused with `PERMISSION_DENIED`; Tavora tells the player to close the layer first.

### Overlay preview

`overlay.preview(key)` opens a small, normal Tavora window with the overlay page for `key` at its real size, so the player can see how it looks without a game or OBS. A footer switches the background between dark, light and checkered. Call it from the click or key press that asked for it, for example a Preview button next to Show over game. The page gets the same live state as in the game (`overlay.publish`, `watchOverlay`), no bridge and no network. It needs no connector and no permission, the module needs an `overlay` in its manifest, and it works whether Game overlays and Stream overlays are on or off. There is one window per overlay: calling it again brings that window forward. Tavora 0.21.2 and newer, so set `minTavora` to at least `0.21.2` if you rely on it.

### Hotkeys

A module lists what it can do on a key press in the manifest's [`actions`](./manifest.md#actions), such as Start/Pause. `hotkeys.set` opens Tavora's own dialog, where the player presses the keys for one action on one target (an item id, say); `label` names the target there. The binding belongs to the current game. A module never learns which key it is.

When the player presses it, one panel of the module in the game shown now, the one used last, gets the `hotkeys.pressed` event with `{ action, target }`, so one press is one action however many panels are open. Hotkeys work system-wide, also while the game has the focus, but only while their game is shown in Tavora and the module has a panel in its workspace. The game doesn't get a key that is a hotkey. Settings > Streaming lists every hotkey, and the player can remove them there.

### Documents

A document is a named JSON value with a title and a revision. `DocumentSummary` is `{ id, title, revision, updatedAt, bytes }`; `updatedAt` is an ISO 8601 timestamp and `bytes` the size of `data` as stored.

- `id`: 1 to 64 characters from `A-Z a-z 0-9 _ -`, starting with a letter or digit. Leave it out of `documents.put` to get a new random id.
- `revision` starts at 1 and goes up by one on every put.
- `ifRevision` makes a put or delete conditional: it fails with `CONFLICT` (and `error.revision` set to the current revision) unless the stored revision equals it. `ifRevision: 0` means "only if it does not exist yet".
- After a successful put or delete, every **other** connected panel of the same module and game gets a `documents.changed` event. The panel that made the change does not.

Writes are atomic: a crash leaves either the old or the new document, never a mix.

### Content per panel

Each panel of a module can show something different: one build, character, run or document of your own, picked in a selector in your panel's toolbar. Tavora has no model of its own for it; it only needs to know what each panel shows. Needs Tavora 0.17.17 or newer.

- When the page loads, ask `panel.getLaunch()`. `{ reason: "add" }` means the player just added the panel: pick the content yourself, such as the one used last, or show a picker. `{ reason: "restore", content }` means the panel was open before (a restart, a switch back to this game, a reload); `content` is what it last showed, or `null`. Keep the panel's own choice in its `panel` state too, so each copy keeps its own.
- Whenever the selection changes, call `panel.setContent({ id, title })`, or `panel.setContent(null)` for nothing. Tavora keeps it with the panel and shows `title` when the player hovers the tab, below the panel's and the module's names. Tabs stay short, so copies of one panel type look the same; the hover text and your toolbar tell them apart.
- Show long titles shortened in your toolbar, with the full name on hover.
- When the content a panel shows is deleted, keep the panel open: say so where the content was, keep the selector, and never switch to other content by yourself.

#### Opening another panel

A panel can open the module's other panel types on what it shows, such as the gear for the build in the planner: `panels.open(type, { content })`. Needs Tavora 0.17.18 or newer. Only right after a click or key press in the panel, once per click, and only the module's own types in the game shown now. Tavora picks the panel:

1. A panel of that type that already shows `content` (by `id`, as its `panel.setContent` said) comes to the front: `"shown"`. Without `content`, the panel of that type used last comes to the front.
2. Else the panel of that type the player used last is asked to switch: it gets a `panel.navigate` event, which the SDK hands to your `panel.onNavigate` handler. Save any pending edits there, switch, and resolve: `"switched"`, and it comes to the front. Other copies keep what they show.
3. Else, or when that page has no `onNavigate` handler, a new panel of that type opens; its `panel.getLaunch()` says `{ reason: "open", content }`: `"opened"`.

When the handler throws, or does not resolve within 5 seconds, the panel keeps its content and edits, the call answers `"failed"`, and Tavora tells the player and offers to open the content in a new panel instead. Never switch content without saving first.

The Panel Types Example in Tavora's examples folder does all of this.

## Events

| Event | Data | When |
| --- | --- | --- |
| `workspace.resize` | `{ width, height }` | the panel's size changed |
| `ui.theme` | theme, as `ui.getTheme` | the host theme changed |
| `ui.language` | language code, as `ui.getLanguage` | the player changed the language |
| `documents.changed` | `{ id, revision, deleted }` | another panel of this module changed a document |
| `aiUsage.accountsChanged` | `null` | the player added, renamed or removed an AI account; only with the `aiUsage` capability |
| `systemInfo.snapshot` | `SystemSnapshot` | how busy the PC is, for what this panel watches; only with the `systemInfo` capability, while it watches and is shown |
| `systemInfo.drivesChanged` | `null` | a drive letter appeared or went away; only with the `systemInfo` capability, while the panel watches |
| `discord.state` | `DiscordState` | the connection to the Discord app changed; only with the `discord` capability, after `discord.state` was asked |
| `discord.event` | `{ event, data }` | a Discord event the panel subscribed to; only with the `discord` capability |
| `hotkeys.pressed` | `{ action, target }` | the player pressed a hotkey set for this module in the game shown now; sent to one panel of the module there, the one used last |
| `panel.navigate` | `{ requestId, content }` | another panel of this module asked this one to show `content` (`panels.open`); answer with `panel.navigated` within 5 seconds. The SDK does it for you: use `panel.onNavigate` (Tavora 0.17.18 and newer) |
| `panel.maximized` | `{ maximized }` | the panel started or stopped filling the workspace, by the player or `panel.setMaximized`. The SDK hands it to `panel.onMaximizedChange` (Tavora 0.20.20 and newer) |
| `lifecycle.suspend` | `null` | the panel is hidden (window minimized or hidden, its tab is in the background, or another group is maximized); pause timers and animations. Also sent right after the handshake if the panel connects while hidden |
| `lifecycle.resume` | `null` | the panel is visible again |
| `lifecycle.dispose` | `null` | the panel is closing. Best effort only: it may never arrive, so never rely on it to save |

## Default look

Tavora inserts a stylesheet into every module page before it renders, as a
*user* stylesheet. It sits above the browser's defaults and below everything
the module writes, so any rule of the module's own wins. It makes a page that
styles nothing look like part of Tavora: no page margin, the theme's
background and text colour, Inter at 14 px, dark buttons, fields and
scrollbars, a gold focus ring, muted `small` and `dt` text, and headings
sized like the host's.

It also defines the theme's tokens as CSS custom properties, the same values
`ui.getTheme` returns, so a module can use them in its own CSS without the
SDK:

| Property | Use |
| --- | --- |
| `--tavora-background`, `--tavora-foreground` | Page background and text |
| `--tavora-card` | Raised surfaces and fields |
| `--tavora-primary`, `--tavora-primary-hover`, `--tavora-primary-foreground` | The one main action, its hover, and text on it |
| `--tavora-secondary`, `--tavora-accent` | Default buttons; hover and selection surfaces |
| `--tavora-muted-foreground` | Secondary text |
| `--tavora-border`, `--tavora-input`, `--tavora-ring` | Dividers, field outlines, focus ring |
| `--tavora-destructive`, `--tavora-success`, `--tavora-warning`, `--tavora-info` | States |
| `--tavora-radius` | Corner radius of controls |
| `--tavora-font-sans`, `--tavora-font-mono` | Text and code fonts |

## Errors

| Code | Meaning | Extra fields |
| --- | --- | --- |
| `BAD_REQUEST` | Malformed message, wrong `v`, no handshake yet, over the size limit or too many requests in flight | `supported` for a wrong `v` |
| `UNKNOWN_METHOD` | The method is not part of the protocol | |
| `INVALID_PARAMS` | Params missing, of the wrong shape or not JSON, or params sent to a method that takes none | |
| `PERMISSION_DENIED` | The method exists but needs a capability this module was not granted; also a call that needs a click it did not get, or Tavora's own window while the panel is over the game | `capability` (only for a missing capability) |
| `QUOTA_EXCEEDED` | A storage, document or panel-state limit would be exceeded, or a network answer is over 5 MB | |
| `NETWORK_ERROR` | `network.fetch` got no answer: the host could not be found or reached, the connection or certificate failed, or it took too long | |
| `CONFLICT` | `ifRevision` did not match | `revision` |
| `INCOMPATIBLE` | The handshake asked for a protocol version this host does not speak | `supported` |
| `INTERNAL` | The host failed; details are only in the host's log | |

The SDK adds two codes of its own, never sent by the host: `TIMEOUT` (no answer within the request timeout, 10 s by default) and `HOST_UNAVAILABLE` (no port within the connect timeout, 5 s by default, for example when the page is opened outside Tavora).

`message` is for people. Code against `code` and the extra fields only.

## Capabilities

Some methods need a capability the player grants. A module asks for it in its manifest's `permissions`; the player's yes is a grant, kept by Tavora for the module's publisher and id and checked on every call, so a grant the player takes back stops working at once. The handshake's `capabilities` lists what is granted when the module connects.

| Method | Capability | |
| --- | --- | --- |
| `network.fetch` | `network` | granted per host, see [Network](#network) |
| `network.readPage` | `network` | the same exact-host grant; fresh isolated session |
| `aiUsage.accounts`, `aiUsage.read` | `aiUsage` | granted for the `ai-usage` connector, see [Connectors](#connectors) |
| `systemInfo.*` | `systemInfo` | granted for the `system-info` connector, see [Connectors](#connectors) |
| `discord.*` | `discord` | granted for the `discord` connector, see [Connectors](#connectors) |
| `overlay.copyLink`, `overlay.resetLink` | `overlay` | granted for the `stream-overlay` connector, see [Stream overlays](#stream-overlays). `overlay.publish`, `overlay.remove`, `overlay.showOverGame` and `overlay.preview` need none |
| `files.open`, `files.save` | `files` | reserved |
| `clipboard.writeText`, `clipboard.readText` | `clipboard` | reserved |
| `sharedData.publish`, `sharedData.read`, `sharedData.subscribe` | `sharedData` | reserved |

Without the capability every one of them fails with `PERMISSION_DENIED` and `capability`. The reserved ones cannot be granted yet and always fail that way, so a module can feature-detect them safely; their params and results are not specified yet.

## Limits

| Limit | Value |
| --- | --- |
| Request size (serialized) | 8 MiB |
| Requests in flight per panel | 64 |
| Bytes of requests in flight per panel | 16 MiB |
| Storage key length | 256 characters |
| Storage per module and game | 5 MiB (keys + serialized values); the same again for `storage.app` |
| One document's `data` | 4 MiB |
| All documents per module and game | 50 MiB, at most 1000 documents |
| Document title | 200 characters |
| Panel content (`panel.setContent`) | `id` 200 characters, `title` 200 characters |
| `panels.open` | one per click or key press; the panel asked to switch has 5 s |
| Stored files (`blobs`) | 50 MB each, 500 MB per module and game; PNG, JPEG, GIF and WebP only |
| `clipboard.writeImage` | one PNG per click or key press, at most 20 MB, 16384 pixels on a side and 100 million pixels |
| `pictures.save` | the same as `clipboard.writeImage`; names up to 80 characters |
| `files.saveJson`, `files.openJson` | one file per click or key press, JSON up to 8 MiB; names up to 80 characters |
| Panel state | 256 KiB |
| JSON nesting depth | 64 |
| `network.fetch` answer | 5 MB of body, 15 s, 5 redirects, 6 requests at once per panel |
| `network.readPage` answer | 5 MiB of HTML, 30 s, 5 redirects, one active import per module |
| `aiUsage.read` | one reading per account and minute for all modules, 40 s, answers up to 256 KB |
| `systemInfo.watch` | one watch per panel, 26 drives; Tavora reads at most once a second, for all panels together |
| `discord.command` | 15 s, answers and events up to 512 KB; 32 subscriptions per panel |
| `ui.showMenu` | one menu per click or key press, 100 entries, labels 80 characters, hints 30 |
| `overlay.publish` | 16 KB of state per overlay, 200 overlays per module and game; keys up to 64 letters, digits, `-` and `_` |
| `hotkeys` | 100 per module and game; labels 60 characters on one line; targets like overlay keys |

These limits are checked first inside your own page, by the preload Tavora gives it, before a message reaches the host. A request over a limit is answered with `BAD_REQUEST` (`INVALID_PARAMS` for data that is not plain JSON) and never sent on, so a module that sends something huge can only slow itself down. A request id cannot be reused while its answer is pending.

Values must be JSON: `null`, booleans, finite numbers, strings, arrays and plain objects. `undefined`, `Date`, `Map`, typed arrays, `NaN` and similar are rejected with `INVALID_PARAMS`, not converted.

## Versioning

- `v` on every message is the major protocol version. A host answers a message with another `v` with `BAD_REQUEST` and `supported`.
- The handshake carries the version the SDK wants. A host that cannot serve it answers `INCOMPATIBLE` with the versions it supports, and the SDK's `connect()` rejects with that error.
- Within a major version, the host may add methods, events, optional params, result fields and error codes. Modules must ignore event names and result fields they do not know.
- Removing or changing anything existing needs a new major version. A host should keep serving the previous major version for as long as published modules use it.
- The manifest's `apiVersion` names the major version the module was built for, and `minTavora` the oldest Tavora that has everything it uses.
- Before Tavora 1.0, version 1 may still change in ways that break modules. Each such change raises `@tavora/sdk`'s minor version and is marked **Breaking** in the [changelog](./changelog.md). From 1.0 on, the rules above apply.

## Shared rich tooltips (Tavora 0.18.18+)

- `ui.tooltip.show({ id, at: { x, y }, content, pinned? })` returns whether it was
  accepted. Coordinates are CSS pixels relative to the source panel. Pinning needs
  a genuine click/key press; hover must follow trusted source input. A current pin
  rejects ordinary hover. The host prefers the right side, then left, bounded to
  the application window.
- `ui.tooltip.move({ id, at })` moves only the owner's matching unpinned tooltip.
- `ui.tooltip.hide({ id })` ends hover, leaving a pin unchanged.
- `ui.tooltip.close({ id })` explicitly closes the owner's matching tooltip.
- `ui.tooltipClosed` carries `{ id }` when the host dismisses or replaces details.

`TooltipContent` contains a title (200 characters), optional subtitle, rarity
`tone`, bundle-relative raster `image` (`dist/...png`, JPEG, WebP or GIF), up to
8 badges and requirements, 20 properties, and 12 sections with up to 100 rows in
total. A row has text, optional right-aligned badges/status and a connected-affix
marker. Content is limited to 40,000 characters; no HTML, CSS or links. Raster
assets are capped at 512 KB. See the SDK's exported types for individual bounds.

Use `ui.tooltip.onClose` to clear local pin state. Close details before changing
source data or destroying the triggering UI. Underlying panels remain live.

## Saving and opening JSON files

`sdk.files.saveJson(value, name?)` saves JSON as a `.json` file where the player says, and `sdk.files.openJson()` opens one they pick. Both use Tavora's own dialogs, which start in the folder the player last saved a file to or opened one from for this module, at first Tavora's own folder in their Documents (`Documents\Tavora`). Each module has its own remembered folder.

- `saveJson` POSTs the JSON to the module's own address, `/_files/json/save/?name=…`; `name` is filled in (cleaned, up to 80 characters, numbered `name (2).json` when taken) and `.json` is added when missing. The answer is `{ fileName }`, the name it was saved under, or `null` when the player closed the dialog. Replacing a file needs the player's OK in the dialog.
- `openJson` POSTs to `/_files/json/open/`. The answer is `{ fileName, value }` with the parsed content (a file over 8 MiB is `QUOTA_EXCEEDED`, a file that is not JSON is `INVALID_PARAMS`), or `null` when the player closed the dialog.
- Both work only right after a real click or key press (one file per press, shared with the clipboard and picture calls), otherwise `PERMISSION_DENIED`. The module never learns a path. No extra permission grant.

They go through module addresses rather than bridge calls so a document up to 8 MiB does not hit the bridge's message limit, like `pictures.save`.

## JSON exports (Tavora 0.19.17+)

`files.exportJson(value, name?)` (deprecated: use `files.saveJson`, which asks the player where to save) in SDK 0.2.10 POSTs JSON to `/_exports/json/?name=...` in the module origin. Maximum 8 MiB before and after host formatting (1 MiB in Tavora 0.20.7 and older). A trusted click/key press is consumed once, shared with picture operations. Saves a new sanitized `.json` in Downloads/Tavora; no arbitrary paths or overwrite. Returns `{ fileName }`. No extra permission grant.


### Remembered read-only files

The native picker is opened with `files.pickReadOnly({ extensions: ["ksd"] })` after a real click/key press. Cancellation returns null; selection returns `{ id, name, size }`. File names are basenames; references are opaque 128-bit values scoped by publisher, module and game. No path or folder is accepted from module code. The SDK allows time for the player to use the dialog.

`files.read(id)` POSTs to `/_read-only-files/<id>` in the module origin and returns a Uint8Array, up to 32 MiB. The selected file can be reread after restart without another picker. Two concurrent reads are allowed per scope, four across the host, including reference lookups; errors use the protocol error envelope. `files.forget(id)` revokes access without deleting the selected file. These calls do not enable the reserved `files.open` or `files.save` methods.

References stay on the current PC outside backups/cloud copies and are cleared with module/game data. Data copied to another PC may contain an inert reference and must relink files. The page receives no arbitrary filesystem or write access. See [Security](../guide/security.md#remembered-read-only-files).
