# Bridge protocol v1

**Status:** Version 1 is what `@tavora/sdk` 0.2.4 speaks. It may still change before Tavora's first public release; after that, breaking changes need a new major version (see [Versioning](#versioning)). What changed when is in the [changelog](./changelog.md).

Module authors normally use `@tavora/sdk` and never see these messages. This page is for people writing another SDK, reviewing the host, or debugging.

## Connecting

1. The module posts `{ type: "tavora:hello", v: 1 }` to its own window (`window.postMessage(..., location.origin)`).
2. The host's preload sees it and asks the main process for a channel. The main process creates a `MessagePort` pair and binds it to the panel that asked: its module id, workspace and panel instance. Only the panel's top frame can ask; iframes are ignored.
3. The preload posts `{ type: "tavora:port", v: 1 }` back to the window with the port attached.
4. The module sends `bridge.handshake` on the port. Every other request before a successful handshake fails with `BAD_REQUEST`, and the host sends no events until then.

Asking again (a new hello) closes the old port and creates a new one. A reload or navigation inside the module also closes the port; the new page connects again.

Identity is never part of a message. Fields such as `moduleId` or `workspaceId` in params are rejected or ignored: the host only uses what it bound to the port.

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
{ "v": 1, "id": 7, "ok": false, "error": { "code": "QUOTA_EXCEEDED", "message": "settings are limited to 5242880 bytes per module and workspace" } }
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
| `bridge.handshake` | `{ protocol: 1, sdkVersion: string }` | `{ protocol: 1, host: { name: "tavora-desktop", version }, module: { id, version }, capabilities, panel: { type } }`: `capabilities` lists what the user has granted, such as `["network"]`; `panel.type` is the [panel type](./manifest.md#panel-types) this panel shows, or `null` for a module without panel types (Tavora 0.17.12 and newer) |
| `workspace.getCurrent` | none | `{ id, displayName, kind }` of the workspace this panel is in; `kind` is `"game"` for a game workspace (its `id` is the game's id, the one a manifest's `games` lists) or `"personal"` for a personal workspace that belongs to no game (Tavora 0.21.43 and newer; the SDK asks `game.getCurrent` on an older Tavora) |
| `game.getCurrent` | none | Deprecated: the same in the old words, `{ id, displayName, kind }` with `kind` `"game"`, or `"workspace"` for a personal workspace (Tavora 0.18.1 and newer; an older Tavora leaves `kind` out, which means a game). Answered until Tavora 1.0; use `workspace.getCurrent` |
| `storage.get` | `{ key }` | the stored JSON value, or `null` |
| `storage.set` | `{ key, value }` | `null` |
| `storage.delete` | `{ key }` | `null` |
| `storage.keys` | none | sorted array of keys |
| `storage.compareAndSet` | `{ key, expected, value }` | `true` when `value` was set: only while the key holds `expected` (`null`: not set), in one step, so two panels can't overwrite each other's change. Values count as equal when they hold the same JSON, whatever the order of their keys. `false`: read it again and retry (Tavora 0.21.92 and newer) |
| `storage.app.get`, `storage.app.set`, `storage.app.delete`, `storage.app.keys`, `storage.app.compareAndSet` | as `storage.*` | the same calls for settings shared by every workspace, see [Where data lives](#where-data-lives) |
| `documents.list` | none | `DocumentSummary[]`, newest first |
| `documents.get` | `{ id }` | `{ id, title, revision, updatedAt, bytes, data }` or `null` |
| `documents.put` | `{ id?, title, data, ifRevision? }` | `DocumentSummary` of the saved document |
| `documents.delete` | `{ id, ifRevision? }` | `null` (also when the document did not exist) |
| `panel.getState` | none | this panel's state, or `null` |
| `panel.setState` | `{ value }` | `null`; `value: null` removes the state |
| `panel.getLaunch` | none | why this page is loading, the same on every call until it loads again: `{ reason: "add" }` for a panel the user just added, `{ reason: "restore", content }` for one that was open before, with what it last showed through `panel.setContent` (or `null`), or `{ reason: "open", content }` for one another panel opened with `panels.open` (Tavora 0.17.18 and newer). See [Content per panel](#content-per-panel) (Tavora 0.17.17 and newer) |
| `panels.open` | `{ type, content? }` | `"shown"`, `"switched"`, `"opened"` or `"failed"`: opens one of this module's own panel types in the current workspace, on `content` (`{ id, title }`) when given. See [Opening another panel](#opening-another-panel). Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a type the module does not have (Tavora 0.17.18 and newer) |
| `panel.navigated` | `{ requestId, handled, ok }` | `null`; the answer to a `panel.navigate` event. The SDK sends it for you from `panel.onNavigate` (Tavora 0.17.18 and newer) |
| `panel.setContent` | `{ content }` | `null`; `content` is `{ id, title }` or `null`: what the panel shows now. `id` is your own, 1 to 200 characters; `title` is its full name, 1 to 200 characters, kept on one line. `INVALID_PARAMS` otherwise (Tavora 0.17.17 and newer) |
| `panel.isMaximized` | none | `true` while the panel fills the workspace (Maximize in its menu, or `panel.setMaximized`) (Tavora 0.20.20 and newer) |
| `panel.setMaximized` | `{ maximized }` | `null`; `true` makes the panel fill the workspace, as Maximize in its menu does, `false` puts it back. Nothing happens while the panel is the only one, as it fills the workspace already. `true` only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise) (Tavora 0.20.20 and newer) |
| `panel.setLive` | `{ state }` | `null`; `state` is any JSON up to 16 KB, or `null`. What this panel's [live view](#live-views) shows; `null` shows nothing. `QUOTA_EXCEEDED` when too big. Needs no click and no permission (Tavora 0.21.11 and newer) |
| `workspace.getViewport` | none | `{ width, height }` of the panel in CSS pixels |
| `ui.getLanguage` | none | the language of Tavora's own texts as a code, `"en"` or `"de"` for now; show your module in it, or in English when you have no translation |
| `ui.showMenu` | `{ items, at, side?, align? }` | the chosen item's `id`, or `null` when the user closed the menu; see [Menus](#menus) |
| `links.open` | `{ url }` | `null`; opens the web address (http or https, at most 2048 characters) as a new tab in the workspace's Browser panel, or in a new Browser panel. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for anything but a web address. You learn nothing about the page |
| `blobs.list` | none | `BlobInfo[]` (`{ id, bytes, type, createdAt }`), oldest first |
| `blobs.usage` | none | `{ bytes, count, maxBytes, maxFileBytes }` for this module and workspace |
| `blobs.delete` | `{ id }` | `null` (also when the file did not exist); `INVALID_PARAMS` for an id the host did not make |
| `ui.getTheme` | none | `{ mode, colors: { background, surface, text, textMuted, accent }, tokens, radius }`: `tokens` holds every semantic colour by its shadcn-vue name (`THEME_TOKENS`), `radius` is in CSS pixels |
| `network.fetch` | `{ url, method?, headers?, body?, responseType? }` | `{ status, url, headers, body }`; needs the `network` capability, see [Network](#network) |
| `network.readPage` | `{ url }` | `{ status, url, title, html }`; isolated public page capture, same `network` grant, Tavora 0.19.3+ |
| `aiUsage.accounts` | none | `AiUsageAccountInfo[]` in the user's order; needs the `aiUsage` capability, see [Connectors](#connectors) |
| `aiUsage.read` | `{ accountId }` | `AiUsageReading`; needs the `aiUsage` capability |
| `systemInfo.info` | none | `SystemInfo`; this PC's processor, memory, graphics cards and drives. Needs the `systemInfo` capability, see [Connectors](#connectors). Tavora 0.21.1+ |
| `systemInfo.watch` | `{ blocks, intervalMs }` | `null`; sets what this panel watches, see [Connectors](#connectors). Needs the `systemInfo` capability |
| `systemInfo.connectionLog` | none | `{ outages }`; the drops of the connection in the last 30 days, newest first. Needs the `systemInfo` capability, see [Connectors](#connectors). Tavora 0.21.22+ |
| `systemInfo.clearConnectionLog` | none | `null`; empties that list. Needs the `systemInfo` capability, and only works for Tavora's own System Monitor, right after a click or key press (`PERMISSION_DENIED` otherwise). Tavora 0.21.22+ |
| `systemInfo.connectionSettings` | none | `{ enabled, target }`; whether the connection is watched and which address is pinged. Needs the `systemInfo` capability. Tavora 0.21.22+ |
| `systemInfo.setConnectionSettings` | `{ enabled?, target? }` | `{ enabled, target }`; changes what is given. A `target` that is not a public IPv4 address or a public name is `INVALID_PARAMS`. Needs the `systemInfo` capability, and only works for Tavora's own System Monitor, right after a click or key press (`PERMISSION_DENIED` otherwise); one change every 5 seconds (`QUOTA_EXCEEDED` after that). Tavora 0.21.22+ |
| `media.watch` | `{ on }` | `MediaState` (or `null` for `on: false`); starts or ends this panel's watch of what plays, see [Connectors](#connectors). Needs the `media` capability. Tavora 0.21.18+ |
| `media.control` | `{ session, action }` | `boolean`; asks the session's app to `playPause`, go to the `next` or `previous` song. Needs the `media` capability, a watch and a click, key press or hotkey just before |
| `systemInfo.apps` | none | `SystemApps`; the apps running now with their memory and CPU. Only for Tavora's own System Monitor, see [Connectors](#connectors). Tavora 0.21.21+ |
| `systemInfo.traffic` | none | `SystemTraffic`; what this PC downloaded and uploaded this week and month and the 3 months before. Only for Tavora's own System Monitor, see [Connectors](#connectors). Tavora 0.21.31+ |
| `discord.state` | none | `DiscordState`; starts the connection for this panel. Needs the `discord` capability, see [Connectors](#connectors) |
| `discord.connect`, `discord.allowControl` | none | `null`; only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise) |
| `discord.command` | `{ command, args }` | `DiscordResult`; one of `DISCORD_COMMANDS` |
| `discord.subscribe`, `discord.unsubscribe` | `{ event, channelId? }` | `null`; one of `DISCORD_EVENTS` |
| `discord.image` | `{ url }` | a small PNG as a `data:` address, or `null` |
| `overlay.publish` | `{ key, state }` | `null`; what the overlay for `key` shows now, on its stream link and over the game. Needs no capability since Tavora 0.20.51; before that it needed `overlay`. See [Stream overlays](#stream-overlays) (Tavora 0.19.26 and newer) |
| `overlay.remove` | `{ key }` | `null`; the overlay shows nothing until it is published again, and keeps its link. Needs no capability since Tavora 0.20.51 |
| `overlay.copyLink` | `{ key }` | `"copied"`: the link is on the clipboard; `"off"`: Stream overlays are off, and Tavora opened that setting. `"denied"`: the module asks for the connector on request and the user said no in Tavora's dialog (Tavora 0.19.32 and newer). Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise) |
| `overlay.resetLink` | `{ key }` | `null`; the overlay gets a new link and the old one stops working. Needs the `overlay` capability |
| `overlay.showOverGame` | `{ key }` | `"shown"`: the overlay is over the game now, or already was; `"off"`: Game overlays are off, and Tavora opened Settings > Overlays; `"full"`: the setup it lands in already has 8 items. Needs no capability. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a module without an `overlay` page. See [Game overlays](#game-overlays) (Tavora 0.20.51 and newer) |
| `overlay.hideOverGame` | `{ key }` | `null`; takes this module's game overlay for `key` of the panel's workspace out of every setup it is in. Needs no click and no capability; nothing happens when there is none (Tavora 0.21.3 and newer) |
| `overlay.overGame` | none | `string[]`; the keys of this module's game overlays of the panel's workspace, whichever setups they are in. Needs no capability (Tavora 0.21.3 and newer) |
| `overlay.preview` | `{ key }` | `null`; opens a small Tavora window showing the overlay for `key` at its real size, on a dark, light or checkered background, so the user can see how it looks. One window per overlay; a second call brings it forward. Needs no capability and works whether Game overlays and Stream overlays are on or off. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for a module without an `overlay` page. See [Overlay preview](#overlay-preview) (Tavora 0.21.3 and newer) |
| `hotkeys.list` | none | `{ action, target }[]`: the hotkeys the user set for this module in the current workspace, never the keys. See [Hotkeys](#hotkeys) (Tavora 0.19.26 and newer) |
| `hotkeys.set` | `{ action, target, label }` | `"set"`, `"removed"` or `"cancelled"`: what the user did in Tavora's hotkey dialog. Only right after a real click or key press in the panel (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for an action the manifest does not list |
| `hotkeys.remove` | `{ target, action? }` | `null`; removes the target's hotkeys, or only the one for `action` |

### Where data lives

| Kind | Scope | Removed when |
| --- | --- | --- |
| `storage` | module + workspace, shared by all its panels | never by closing panels; later by uninstalling (Milestone C) |
| `storage.app` | module, shared by all its panels in every workspace | never by closing panels or deleting a workspace; with the module's data in Settings > Modules |
| `documents` | module + workspace, shared by all its panels | as above |
| `blobs` (pictures) | module + workspace, shared by all its panels | the workspace is deleted from the Trash; never by closing panels |
| `panel` state | one panel instance | the panel is closed |
| panel content (`panel.setContent`) | one panel instance | the panel is closed |

A module never sees another module's data, or its own data for another workspace (except what it keeps in `storage.app` for every workspace). `storage.app` has the same limits as a workspace's `storage`; use it for settings the user expects to stay the same from workspace to workspace. Data belongs to the module's id together with who published it (the key that signed its zip, or "local" for an unsigned folder), so a module from another publisher with the same id starts with nothing.

### Files (blobs)

A module can keep pictures that are too big for a document: up to 50 MB each and 500 MB together per module and workspace. They live in a folder Tavora manages (`module-blobs` in its data folder by default; the user can move it in Settings > Modules), shared by all of the module's panels, and are removed with the workspace.

- **Storing:** `sdk.blobs.put(file)` sends the file to the module's own address, `POST /_blobs/`, as the request body, so it is streamed to disk and never held in memory whole. The answer is a `BlobInfo`: `id` (32 lowercase hex characters chosen by the host), `bytes`, `type` and `createdAt`. A module never names a file.
- **Showing:** `sdk.blobs.url(id)` is the address to use as an image source (`GET /_blobs/<id>`). It only works from the module's own page.
- **What is accepted:** PNG, JPEG, GIF and WebP, judged by the first bytes of the file itself, never by its name or type. Anything else (SVG, BMP, documents, scripts) is refused with `INVALID_PARAMS`. Over the limits it is `QUOTA_EXCEEDED`, and nothing is left behind.
- **Serving:** each file is sent with its real type, `X-Content-Type-Options: nosniff` and a policy that lets it load nothing, so a picture can only be shown.

### Clipboard

`sdk.clipboard.writeImage(png)` puts a picture on the system clipboard so the user can paste it into any app. The PNG is sent to the module's own address, `POST /_clipboard/`, as the request body.

- **Only after the user did something:** it must follow a real click or key press in the module (within 2 seconds), and one press copies one picture; otherwise it is refused with `PERMISSION_DENIED`. Call it from the click handler of the button.
- **Only a complete PNG:** the host checks every part of the file before using it (`INVALID_PARAMS` for anything else, such as a different format, a cut-off or damaged file, or a picture over 16384 pixels on a side or 100 million pixels), and a file over 20 MB is `QUOTA_EXCEEDED`.
- **Write only:** a module cannot read the clipboard.

### Saving pictures

`sdk.pictures.save(png, name)` saves a picture as a `.png` file where the user says. Tavora's save dialog opens in the folder they last saved a picture to, at first Tavora's own folder in their Pictures (`Pictures\Tavora`), with `name` filled in. The PNG is sent to the module's own address, `POST /_pictures/?name=…`, as the request body, and the answer is `{ fileName }`, the name the file was saved under, or `null` when the user closed the dialog. Tavora 0.20.16 and older save in `Pictures\Tavora` without a dialog.

- **Only after the user did something:** the same as the clipboard, one picture per click or key press within 2 seconds, otherwise `PERMISSION_DENIED`. A press used for the clipboard is used up for saving too.
- **Only a complete PNG,** with the same checks and limits as the clipboard (`INVALID_PARAMS`, `QUOTA_EXCEEDED`).
- **The user picks the file:** `name` is a suggestion. Tavora takes out anything a file name cannot hold (slashes, colons, control characters, leading and trailing dots), shortens it to 80 characters, uses `Picture` when nothing is left, adds `.png`, and adds ` (2)`, ` (3)` and so on when the folder already has it. Only the user chooses the folder and name, and a file is replaced only when they confirm that in the dialog. A module cannot choose the folder or the type, and never learns where the file went.

### Menus

`sdk.ui.showMenu(request)` shows a menu that Tavora draws above every panel, in its own style and theme. A menu inside your page is cut off at the panel's edge; this one is not.

- **Only after the user did something:** call it from the click, right-click or key press that asked for it (within 2 seconds); each press opens one menu, otherwise `PERMISSION_DENIED`. One menu shows at a time: a new one closes the last, and Esc, a click elsewhere or switching workspaces closes it too. It resolves with the chosen item's `id`, or `null`.
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

A module's page has no network of its own: it cannot fetch, load remote images or open sockets. It names the hosts it needs in [`permissions.network`](./manifest.md), and once the user has granted them, `sdk.network.fetch(url, init)` asks Tavora to make the request. The user is asked when they first add the module; until they agree, the handshake reports no `network` capability and every call fails with `PERMISSION_DENIED`. When an update asks for more hosts, what was granted keeps working and the module's panels offer the user to review the new ones. The user can take a grant back at any time in Settings > Modules > Website access, which removes the module's panels.

- **Which addresses:** only `https:` on the standard port, to a host the module lists and the user granted, without a user name or password. A redirect is followed only to such an address too (at most 5); anything else is `PERMISSION_DENIED`. A granted name that points to this PC or the local network is refused as well.
- **Params:** `method` is `GET` (default), `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`; `headers` is an object of text values; `body` is text (send binary data as base64 or JSON), not allowed with `GET` and `HEAD`; `responseType` is `"text"` (default, read as UTF-8) or `"base64"` for pictures and other binary answers.
- **Set by Tavora:** `Cookie`, `Host`, `Origin`, `Referer`, `User-Agent` (`Tavora/<version> (module <id>)`), `Accept-Encoding`, `Connection`, `Content-Length`, `Transfer-Encoding` and the other transfer headers, `Proxy-*` and `Sec-*` cannot be sent (`INVALID_PARAMS`). No cookies are sent or kept. On a redirect to another host, `Authorization` is dropped.
- **The answer:** `status`, the final `url`, `headers` with lowercase names (without `Set-Cookie`), and `body`. Compressed answers are unpacked. An error status such as 404 or 500 is an answer, not an error.
- **Limits:** at most 5 MB of body (after unpacking; `QUOTA_EXCEEDED` otherwise), 15 seconds per request including redirects, and 6 requests at once per panel (`BAD_REQUEST` for a seventh). When no answer comes at all (unknown host, refused connection, certificate error, too slow), the error is `NETWORK_ERROR`.
- **To show a picture** from a granted host, ask for `responseType: "base64"` and use a `data:` address, or store it with `blobs.put`.

### Isolated public pages

`sdk.network.readPage(url)` is an optional public-page fallback when a source needs
its own scripts to render. Set `minTavora` to `0.19.3` or newer. It accepts no script,
selector or interaction. The hidden sandbox uses a new session with no user sign-ins,
and only granted HTTPS domains; it closes after capturing HTML. A module parses that
HTML as untrusted data and must never evaluate scripts extracted from it. Verification
and login pages fail with `NETWORK_ERROR`; attach a file as a fallback. There is one
active page import per module (`BAD_REQUEST` otherwise), a 30-second deadline and a
5 MiB returned-HTML limit. Panel disconnect cancels the import. Resource and connection
limits and DNS protection are described in the [security model](../guide/security.md#isolated-public-page-importing).

### Connectors

A connector is a part of Tavora that reaches outside the module's panel, such as a sign-in or streaming software on this PC, and lets a module use it without ever seeing what is behind it. A module asks for one in [`permissions.connectors`](./manifest.md); the user agrees when they first add the module, and can take it back in Settings > Integrations. Until then the handshake reports no capability for it and its calls fail with `PERMISSION_DENIED`.

**`ai-usage`** (capability `aiUsage`, `sdk.connectors.aiUsage`): the Claude and Codex accounts the user set up in Settings > Integrations > AI usage, by the folder of each CLI profile. Tavora reads each account with its own login and hands over only the answer.

- `aiUsage.accounts` gives `{ id, provider, label, plan }` per account, in the user's order: `provider` is `"claude"` or `"codex"`, `plan` a name such as `"Pro"` or `"Max 5×"`, or `null`. The profile folder is never given out. The `aiUsage.accountsChanged` event says the list changed.
- `aiUsage.read` gives `{ status, retryAfterMs, answer, email, plan, readAt }`. `status` is `ok`, `sign-in` (no usable subscription login), `rate-limited` (wait `retryAfterMs`), `api-key` (the profile uses an API key, which has no subscription allowance), `cli-missing` (the Codex command line is not installed) or `unavailable`. For `ok`, `answer` is the provider's answer as it came: Claude's usage answer (undocumented, it may change) or the result of the Codex app-server's `account/rateLimits/read`. `email` is who is signed in, when the provider says; keep it in memory only. `readAt` is an ISO 8601 time.
- Tavora reads each account at most once a minute for all modules together; asking sooner gives the last reading again, and a provider's wait applies to every module. One read can take up to 40 seconds while the Codex command starts. An unknown `accountId` is `INVALID_PARAMS`.

**`system-info`** (capability `systemInfo`, `sdk.connectors.systemInfo`, Tavora 0.21.1+): this PC's hardware and how busy it is. Tavora reads Windows' own performance counters inside its process, the same numbers Task Manager shows. It starts no helper program, uses no driver and no sensor, and sends nothing anywhere. A module gets numbers and names only, never a path, a serial number or a file name.

- `systemInfo.info` gives `{ cpu: { model, threads }, ramBytes, gpus, drives }`. `gpus` lists the graphics cards as `{ id, name, dedicated, vramBytes }` without software adapters; `id` is the card's LUID such as `"0x00000000_0x0001defc"`, `dedicated` means 512 MB or more of its own memory. `drives` lists the drives with a letter as `{ id: "C:", label, kind, totalBytes }`; `kind` is `internal`, `removable`, `network` or `other`, CD and DVD drives are left out, and a network drive has an empty `label` and no size, because asking it can hold everything up. Tavora reads it once and keeps it; ask again after `systemInfo.drivesChanged`.
- `systemInfo.watch` takes `{ blocks, intervalMs }` and replaces what this panel watched before. `blocks` may hold `cpu`, `gpu`, `ram`, `tavora` (each `true` or `false`) and `drives` (up to 26 letters such as `"C:"`); anything else, or an `intervalMs` other than 1000, 2000, 5000, 15000 or 60000, is `INVALID_PARAMS`. Empty `blocks` stop watching. A first `systemInfo.snapshot` follows almost at once, then one every `intervalMs`.
- Tavora reads the PC only while at least one panel that is shown watches something, and opens only the counters those panels need. A panel that is hidden, minimized or covered gets no snapshots and counts for nothing; when it is shown again it gets a snapshot at once. With no watching panel nothing runs at all. Panels share one reader, so more panels cost almost nothing.
- A `systemInfo.snapshot` holds `at` (milliseconds since 1970), `intervalMs` and only the blocks the panel asked for. `cpu` is `{ usage, peak, cores }`, `gpus` is `{ id, usage, peak, vramUsedBytes, temperatureC, clockMhz, powerW }` for each graphics card, `ram` is `{ usedBytes, totalBytes }`, `drives` is `{ id, connected, freeBytes, totalBytes, readBytesPerSec, writeBytesPerSec }` for each drive asked for, in that order, and `tavora` is `{ cpu, memoryBytes }` for Tavora itself. Percentages run from 0 to 100 with one decimal. `usage` is the average since the last snapshot, as Task Manager counts (a graphics card is as busy as its busiest kind of work, such as 3D). `peak` is the busiest second since the last snapshot when `intervalMs` is 5000 or more, and the same as `usage` below that. A drive that is gone (an unplugged USB stick) has `connected: false`, `null` sizes and speeds of 0. `temperatureC` (whole degrees Celsius of the graphics chip), `clockMhz` (graphics clock) and `powerW` (watts with one decimal) come from NVIDIA's own library on the PC and are only there for NVIDIA cards, in Tavora 0.21.8 and newer; for other cards, or when a card doesn't say, they are `null`, and older Tavora leaves them out. A block Windows can't read right now is left out.
- `systemInfo.drivesChanged` says a drive letter appeared or went away; ask `systemInfo.info` again. It comes only while the panel watches.
- `systemInfo.apps` (Tavora 0.21.21+) is only for Tavora's own System Monitor; every other module gets `PERMISSION_DENIED`, with the grant or without. It gives `{ apps, usedBytes }`: `apps` lists each running app once, its processes taken together, as `{ name, memoryBytes, cpu, windows }`, the biggest first. `name` is the program's file name without `.exe` and with a capital first letter, `memoryBytes` is its private working set (Task Manager's Memory column), `cpu` is its share of the whole PC since the last call with one decimal (`null` on the first call after a while), and `windows` marks Windows' own processes. `usedBytes` is the memory the PC uses in all. Tavora reads the list with one call into Windows that opens no process, only when asked; outside Windows `apps` is empty.
- `systemInfo.traffic` (Tavora 0.21.31+) is only for Tavora's own System Monitor; every other module gets `PERMISSION_DENIED`, with the grant or without. It gives `{ week, months }`: this week (from Monday, local time) and this month with the 3 months before it, newest first, each `{ start, end, downBytes, upBytes, countedFrom }`. The numbers are Windows' own, the record behind Settings > Network > Data usage, which Windows keeps whether Tavora runs or not: every network the PC used (wired, Wi-Fi, mobile), not VPNs and other virtual adapters, whose traffic already goes through a real one. Windows keeps the record for 60 days, so Tavora keeps each month's totals in its data folder once the month is over. `countedFrom` is where the record of a period begins: `start`, a later time when it begins inside the period, or `null` with `null` bytes when there is none. Tavora reads Windows' record only when asked, at most every 5 minutes; outside Windows the bytes are `null`.
- Outside Windows the connector answers with the processor and memory only: no graphics cards, no drives and no `cpu`, `gpus` or `drives` in snapshots.
- **The connection** (Tavora 0.21.22+). Add `connection: true` to `blocks` and each `systemInfo.snapshot` carries `connection`: `{ state, routerMs, internetMs, routerFound, lossPercent, downMbit, upMbit, target, since }`. `state` is `online`; `offline` (Windows says there is no network); `no-router` (the router answered before and has lost 3 pings in a row, and the internet is down too); `no-internet` (3 pings in a row to `target` were lost, and the router answers, is not found or never answers pings); or `off` (the watcher is switched off, so there are no readings). A drop keeps the worst of these it had, so it does not flip back and forth. `routerMs` and `internetMs` are the last ping in milliseconds, `null` when lost; `routerFound` is `false` when Tavora found no router. `lossPercent` is the share of the last 100 pings lost, the worse of the router and the internet, 0 to 100 with one decimal. `downMbit` and `upMbit` are the megabits per second through the network adapter in use since the last check (not a speed test), `null` before the second check. `target` is the address pinged on the internet and `since` when the current drop began (`null` while online).
- **The watcher runs by itself.** While a System Monitor panel exists in any workspace and the user granted it System info, Tavora pings the router and `target` every 5 seconds, shown or not, and logs drops. That is one ICMP echo to each (the router is the next hop on the way to the internet, found by Tavora), one question to Windows whether it is online, and one read of the adapter's counters; it starts no program and sends nothing else (a `target` that is a name is also looked up with the PC's name server, at most every 5 minutes, and only a public address is pinged). A drop begins when Windows says there is no network or 3 pings to `target` in a row are lost; single losses only count towards `lossPercent`. It ends with the first answer. `connection` is only in snapshots when the panel asks, and the watcher costs nothing when the module is not there. `systemInfo.connectionChanged` carries the same `connection` when the state changes (a drop begins, changes kind or ends); it comes only while the panel watches `connection` and is shown, and is the moment to ask `systemInfo.connectionLog` again.
- `systemInfo.connectionLog` gives `{ outages: [{ start, end, kind, durationMs }] }`, newest first. `start` and `end` are milliseconds since 1970 (`end` is `null` while the drop goes on), `kind` is `offline`, `no-router` or `no-internet`, and `durationMs` is how long it lasted so far. Tavora keeps drops for 30 days, per PC, and `systemInfo.clearConnectionLog` empties the list (a drop that still goes on stays). `systemInfo.setConnectionSettings` is for the whole PC, not one panel, and for Tavora's own System Monitor alone: `enabled: false` stops the watcher, `target` is a public IPv4 address or a name with a dot such as `example.com` (default `1.1.1.1`). Addresses on this PC or the local network, names without a dot, local endings such as `.lan` and router names such as `fritz.box` are `INVALID_PARAMS`. Other modules granted System info can read the log and the settings, not change them.

**`media`** (capability `media`, `sdk.connectors.media`, Tavora 0.21.18+): what plays on this PC, as Windows' media controls (the volume flyout) show it, and play/pause, next and previous. Tavora reads it with a small helper program of its own that waits for Windows' change events; nothing polls and nothing leaves the PC.

- `media.watch` with `{ on: true }` starts this panel's watch and answers a `MediaState`: `{ state, sessions }`. `state` is `starting` (Tavora is still looking; a `media.changed` follows), `ready`, `unavailable` (not Windows, or a Tavora built without the helper) or `failed` (the helper kept stopping; watching again tries again). `{ on: false }` ends the watch; so does closing the page.
- Each session is one app that plays something: `{ id, app: { id, name }, current, title, artist, album, status, positionMs, positionAt, durationMs, cover, can }`. `app.id` is the name Windows gives it (such as `"Spotify.exe"` or `"Chrome"`), `app.name` a readable one (`"Spotify"`). `current` marks the session Windows' media keys work on now. `status` is `playing`, `paused`, `stopped`, `changing` or `closed`. Texts are as the app gives them and may be empty; a browser tab's title can be the page's title.
- `positionMs` is where the song was at `positionAt` (milliseconds since 1970). While `status` is `playing` it runs on from there, so count forward yourself; a new `media.changed` comes when it jumps (a seek, a new song), not every second. Both are `null`, like `durationMs`, when the app doesn't say. Some apps report the position late or not at all.
- `cover` is a JPEG data URL of at most 300 px a side, or `null` when the app gives none; it may come in a second `media.changed` a moment after the song. `can` says which of `playPause`, `next` and `previous` the app takes now.
- `media.changed` carries the whole `MediaState` after every change: a song, play or pause, a jump, an app that starts or stops playing. It also comes while the panel is hidden, so an overlay can stay current.
- `media.control` with `{ session, action }` asks the app of a watched session to do one of `playPause`, `next` or `previous`, and answers whether it took it (`false` also for a session that is gone). It needs a click or key press in the panel within 2 seconds, or a press of one of the module's hotkeys, and one press allows one call; otherwise `PERMISSION_DENIED`.
- Outside Windows `state` is always `unavailable`.

**`leaderboards`** (capability `leaderboards`, `sdk.leaderboards`, Tavora 0.21.92+): the boards of the manifest's [`leaderboards`](./manifest.md#leaderboards), kept on Tavora's service with the user's Tavora account. Tavora keeps the sign-in and talks to the service; the module gets names, ranks and numbers, never an account id or anything made from one. See the [guide](../guide/leaderboards.md).

- `leaderboards.status` gives `{ online, signedIn, available, shown, name }`: Tavora's service answered (while it can't be reached, `available` and `shown` are false and `name` is `null`; ask again later); signed in to Tavora; the service runs this module's boards (a catalog module once Tavora allowed it, a development copy always); the user agreed to show their results here; and, once `shown`, the name the boards show for them (their Tavora profile name, or a neutral one such as `"User · K7"`), else `null`. It never fails for being offline.
- `leaderboards.show` asks the user, in Tavora's own words in this panel, whether to show their Tavora name and results; signed out, it offers to sign in instead (the user signs in in Settings, then your module asks again). It answers the status after the user's answer, and asks nothing while offline. Only right after a real click or key press in the panel, once per click, and not while the panel is over the game.
- `leaderboards.hide` takes the user off this module's boards; the service deletes their results for it. Only right after a real click or key press.
- `leaderboards.submit` with `{ board, results }` sends 1 to 50 finished games to a board of the manifest. A result on a streak or rate board is `{ id, outcome: "won" | "lost", at, day }`, on a score, total or average board `{ id, value, at, day }`: `id` a UUID you make once per game (`crypto.randomUUID()`), `at` when it ended in milliseconds since 1970, `day` the local calendar day as `YYYY-MM-DD`, which decides the day, week, month and year the game counts for (the SDK and Tavora fill it in from `at` when you leave it out; on a daily board give the puzzle's day), `value` a number (0 or more on a total board). It answers `{ accepted, rejected }`: `accepted` lists the ids the board took, also ones it had already, so sending a result again is safe; `rejected` lists `{ id, reason }`, with `reason` `invalid` (its shape is off), `time` (`at` in the future or more than a year ago), `archive` (a result that ended outside its `day`), `day-taken` (the board has another result for that day) or `full` (the account keeps too many results for this module). A refused result never counts: drop it. Each result is taken or refused on its own; one without a string `id` is left out of both lists. `PERMISSION_DENIED` while the user is signed out, hasn't agreed, or the board isn't live on the service yet, and `NETWORK_ERROR` while the service can't be reached or is busy: keep the results and send them later. An unknown board, or no or more than 50 results, is `INVALID_PARAMS`.
- `leaderboards.top` with `{ board, period?, day?, limit? }` gives `{ rows }`, the best lines of a board, `limit` of them (1 to 100, default 20). `period` is `day`, `week` (Monday to Sunday), `month`, `year` or `all` (the default); `day`, the user's local day, picks which one (default today; a past day reads a past period, nothing later than tomorrow). Streak boards have no `day` period: it answers no rows. Each row is `{ rank, of, name, self }` with the board's numbers: `current` and `best` on a streak board, `value` (the best) on a score board, `value` (the sum) and `games` on a total board, `value` (the mean) and `games` on an average board, `value` (the share won, 0 to 100) with `games` and `wins` on a rate board. `of` is how many users the board has in that period; average and rate boards list a user only after `minGames` games. Equal lines share a rank. `self` marks the user's own line, which comes last when they are further down. On a daily board, pass the user's local `day`: a streak whose last day was before yesterday shows `current` 0. Signed out it still answers, without a `self` line. A development copy's test boards show only the user's own line.
- `leaderboards.mine` with `{ day? }` gives `{ boards }`: every board of the manifest as `{ id, name, periods }`, `name` in Tavora's language and `periods` the user's own standing for `day`, `week`, `month`, `year` and `all` (`{ rank, of, ...numbers }` as in a `top` row, or `null` where they aren't on the board). Signed out, not shown or offline, every standing is `null`. Tavora's profile card shows the same.

**`discord`** (capability `discord`, `sdk.connectors.discord`): the Discord app on this PC, through Tavora's own Discord sign-in (PKCE, no Client Secret). Tavora keeps the local connection, the sign-in and the token; a module sends a fixed list of RPC commands and gets Discord's answers as they came. Nothing goes through Tavora's service, and Tavora can't hear, talk or read messages.

- `discord.state` gives `{ status, error, user, canControl, canSaveSignIn }` and makes the panel a user of the connection, which runs while at least one panel uses it and stops with the last one. `status` is `connecting`, `not-running` (no Discord app found; Tavora keeps looking), `signed-out`, `approving` (Discord shows its pop-up), `connected` or `error`; `error` is then `not-approved`, `no-code`, `offline`, `no-sign-in` or `failed`. `canControl` says the sign-in may mute and deafen; one made before Tavora 0.5.11 can't until the user presses a button that calls `discord.allowControl`. The `discord.state` event tells every change.
- `discord.connect` signs in, asking for approval in Discord the first time. It and `discord.allowControl` only work right after a real click or key press in the panel, once per click.
- `discord.command` sends one of these, with exactly these arguments (anything else is `INVALID_PARAMS`): `GET_SELECTED_VOICE_CHANNEL` and `GET_GUILDS` (no arguments), `GET_GUILD` and `GET_CHANNELS` (`guild_id`), `GET_CHANNEL` (`channel_id`), `SELECT_VOICE_CHANNEL` (`channel_id`, or `null` to leave; only right after a real click or key press, once per click), `SET_VOICE_SETTINGS` (`mute` and/or `deaf`; needs `canControl`, and like joining only right after a real click or key press, once per click, since unmuting turns the user's microphone back on) and `SET_USER_VOICE_SETTINGS` (`user_id` with `volume` 0 to 200 and/or `mute`). Ids are Discord ids (digits). The result is `{ ok: true, data }` with Discord's answer, or `{ ok: false, reason, code, message }`: `not-connected`, `refused` (Discord's error `code` and `message`) or `no-answer` (no answer in 15 seconds, the connection ended, or an answer over 512 KB). Joining takes the user out of a call they are in, as Discord's own list does.
- `discord.subscribe` sends a Discord event to this panel as the `discord.event` event (`{ event, data }`, the data as Discord sent it) until `discord.unsubscribe` or the panel goes. `VOICE_CHANNEL_SELECT` (the user joined, moved or left) takes no `channelId`; `VOICE_STATE_CREATE`, `VOICE_STATE_UPDATE`, `VOICE_STATE_DELETE`, `SPEAKING_START` and `SPEAKING_STOP` need the voice channel's id. Subscriptions are kept across reconnects and shared: Discord is asked once, whichever panels want it. At most 32 per panel.
- `discord.image` fetches a picture from Discord's image server, an avatar (`https://cdn.discordapp.com/avatars/<user id>/<hash>.<ext>`) or a server icon (`…/icons/<server id>/<hash>.<ext>`, as `GET_GUILD` gives it), and gives it as a small PNG `data:` address; any other address, or any problem, gives `null`.
- Names and everything else from Discord are Discord's: show them as text only.

### Stream overlays

A module that lists an [`overlay`](./manifest.md#overlay) page and the `stream-overlay` connector can show it in OBS or other streaming software on the user's PC, as a Browser Source. It works with keys: one overlay per key, such as an item id, each with its own link.

- `overlay.publish` sets what the overlay for a key shows: any JSON, at most 16 KB. Tavora keeps it, so the overlay goes on showing it while none of the module's panels runs, and after a restart. Publish when something changes, not on every frame: a running clock publishes when it starts or stops, and its overlay counts the time itself.
- `overlay.copyLink` puts the overlay's link on the clipboard after a click. It and `overlay.resetLink` are the calls that need the connector. A module that lists the connector in [`permissions.onRequest`](./manifest.md) is not asked for it when it is added; Tavora shows its consent dialog on the first `copyLink` instead, and the call gives `"denied"` if the user says no. The user turns Stream overlays on in Settings > Streaming; while they are off, the call gives `"off"` and Tavora opens that setting.
- `overlay.remove` empties an overlay (an item was deleted) and `overlay.resetLink` gives it a new link. The user can also reset every link in Settings.

The overlay page runs in the streaming software, not in Tavora, so it has no bridge. It reads what the module published from `_state` next to it as server-sent events, each message `{ "state": <JSON or null> }`, the first one right away; `watchOverlay(fn)` in the SDK does it for you and reconnects when Tavora restarts. `null` means there is nothing to show.

Tavora serves the page and the files next to it from `127.0.0.1` only, under a random link per overlay, with a policy that loads nothing from anywhere else and talks only to Tavora. The link works while Stream overlays are on, the module is installed under the same publisher and the user still grants the connector; otherwise it gives `404`. Theme and language don't reach the overlay: give it what it needs in the state.

### Game overlays

The same [`overlay`](./manifest.md#overlay) page can also be shown over the user's game, in a window of Tavora's own, with `overlay.showOverGame(key)`. Call it from the click or key press that asked for it, for example a Show over game button. The page and what it publishes work exactly as for Stream overlays (one page per key, `overlay.publish`, `watchOverlay`), and it needs no connector and no permission: the user decides in Settings > Overlays.

- The call gives `"off"` while the user has Game overlays off (they are off at first); Tavora then opens Settings > Overlays. It gives `"full"` when the setup the overlay lands in already has 8 items; the user can remove one on the Overlay page. Otherwise it gives `"shown"`, also when the overlay was already added.
- The overlay shows only while its game is running and in front (or, in All games, any library game without a setup of its own), and hides when the user switches to another window, Tavora included. The user picks per overlay whether it is always shown or toggled by a key, how see-through it is, and whether it hides from screen capture (it shows in capture at first). They place and resize it on the Overlay page, or in the game by holding the in-game layer open with the "Tavora over game" key. Its place sticks to the nearest corner or edge of the game window and scales with the window's height, and the page is scaled the same way: it is laid out as in a 1080 px high window, and shown bigger or smaller with the game window.
- Tavora keeps overlays in setups: Everywhere (over any program), All games, and one per game workspace. An overlay asked for from a game workspace lands in that game's setup, which Tavora adds when there is none; one asked for from a personal workspace lands in All games. Your module never puts anything in Everywhere; the user does. Each setup has room for 8 items (`LIMITS.maxGameOverlays`), panels in game included. In Everywhere the overlay is placed and scaled on the main screen instead of a game window, so lay it out for any size.
- Tavora draws its own window above the game. It does not touch the game: nothing is injected into it or drawn by it. Games that run in exclusive full screen hide it; the user is told to switch the game to borderless. Windows only; elsewhere the call gives `"off"`.
- The page has no bridge and runs under the same policy as a Stream overlay page, with no network. Clicks go through it to the game, so it can't take input.
- Theme and language don't reach the page, and its size is the user's choice, so lay it out for any size and keep its background transparent.
- A panel type that sets [`inGame: true`](./manifest.md#panel-types) in the manifest gets **Show in game** in its menu. The panel is then over the game only while the user holds the in-game layer open (their "Tavora over game" key), and goes back into its workspace slot when the layer closes. Your panel isn't told and calls nothing different: it keeps its bridge, and hears `workspace.resize` for the new size, `lifecycle.suspend` and `lifecycle.resume` as it moves. Clicks and key presses reach it only while the layer is open. In game the panel is scaled with the game window's height (laid out as in a 1080 px high window, as an overlay page is) with a style on the page, not the browser's zoom, which the module's other panels of the game would share. A page that sizes itself with `100vh` can overflow its panel in game; use `100%` height instead. While it is in the layer, calls that need Tavora's own window (`pictures.save`, `files.saveJson`, `files.openJson`, `files.pickReadOnly`, `overlay.copyLink` when it needs the consent dialog or a setting, `overlay.showOverGame`, `overlay.preview`, `hotkeys.set`, `ui.showMenu`, `panels.open`, `panel.setMaximized` and `links.open`) are refused with `PERMISSION_DENIED`; Tavora tells the user to close the layer first.

### Live views

When the user shows a panel in game (the [`inGame`](./manifest.md#panel-types) item in its menu) and its module has an [`overlay`](./manifest.md#overlay) page, Tavora shows that page over the game even while the in-game layer is closed: read-only, click-through, in exactly the panel's spot and size. Feed it with `panel.setLive(state)` (or `tavora.panel.setLive` in the SDK): any JSON up to `LIMITS.maxOverlayStateBytes` (16 KB), or `null` to show nothing. Tavora keeps the last state in memory and keeps showing it while the panel isn't running, for example while the user looks at another game in Tavora; it forgets it when the panel closes for good. After a restart nothing shows until the panel runs again and calls `setLive`.

- The page reads the state with `watchOverlay`, like any overlay page (no key to pick: it gets the state of its own panel). It has no bridge and no network, and can't take input.
- Nothing shows until the panel passes a state. While the layer is open the full panel is there instead, and the view returns in the new spot and size when the layer closes.
- The user picks per panel whether the view is always there or toggled by a key, its opacity, and Hide from capture, on the Overlay page (the Overlay button in the workspace header).
- Needs no click and no permission. Tavora 0.21.11 and newer, so set `minTavora` to at least `0.21.11` if you rely on it.

### Overlay preview

`overlay.preview(key)` opens a small, normal Tavora window with the overlay page for `key` at its real size, so the user can see how it looks without a game or OBS. A footer switches the background between dark, light and checkered. Call it from the click or key press that asked for it, for example a Preview button next to Show over game. The page gets the same live state as in the game (`overlay.publish`, `watchOverlay`), no bridge and no network. It needs no connector and no permission, the module needs an `overlay` in its manifest, and it works whether Game overlays and Stream overlays are on or off. There is one window per overlay: calling it again brings that window forward. Tavora 0.21.3 and newer, so set `minTavora` to at least `0.21.3` if you rely on it.

### Hotkeys

A module lists what it can do on a key press in the manifest's [`actions`](./manifest.md#actions), such as Start/Pause. `hotkeys.set` opens Tavora's own dialog, where the user presses the keys for one action on one target (an item id, say); `label` names the target there. The binding belongs to the current workspace. A module never learns which key it is.

When the user presses it, one panel of the module in the workspace shown now, the one used last, gets the `hotkeys.pressed` event with `{ action, target }`, so one press is one action however many panels are open. Hotkeys work system-wide, also while the game has the focus, but only while their workspace is shown in Tavora and the module has a panel in it. The game doesn't get a key that is a hotkey. Settings > Streaming lists every hotkey, and the user can remove them there.

### Documents

A document is a named JSON value with a title and a revision. `DocumentSummary` is `{ id, title, revision, updatedAt, bytes }`; `updatedAt` is an ISO 8601 timestamp and `bytes` the size of `data` as stored.

- `id`: 1 to 64 characters from `A-Z a-z 0-9 _ -`, starting with a letter or digit. Leave it out of `documents.put` to get a new random id.
- `revision` starts at 1 and goes up by one on every put.
- `ifRevision` makes a put or delete conditional: it fails with `CONFLICT` (and `error.revision` set to the current revision) unless the stored revision equals it. `ifRevision: 0` means "only if it does not exist yet".
- After a successful put or delete, every **other** connected panel of the same module and workspace gets a `documents.changed` event. The panel that made the change does not.

Writes are atomic: a crash leaves either the old or the new document, never a mix.

### Content per panel

Each panel of a module can show something different: one build, character, run or document of your own, picked in a selector in your panel's toolbar. Tavora has no model of its own for it; it only needs to know what each panel shows. Needs Tavora 0.17.17 or newer.

- When the page loads, ask `panel.getLaunch()`. `{ reason: "add" }` means the user just added the panel: pick the content yourself, such as the one used last, or show a picker. `{ reason: "restore", content }` means the panel was open before (a restart, a switch back to this workspace, a reload); `content` is what it last showed, or `null`. Keep the panel's own choice in its `panel` state too, so each copy keeps its own.
- Whenever the selection changes, call `panel.setContent({ id, title })`, or `panel.setContent(null)` for nothing. Tavora keeps it with the panel and shows `title` when the user hovers the tab, below the panel's and the module's names. Tabs stay short, so copies of one panel type look the same; the hover text and your toolbar tell them apart.
- Show long titles shortened in your toolbar, with the full name on hover.
- When the content a panel shows is deleted, keep the panel open: say so where the content was, keep the selector, and never switch to other content by yourself.

#### Opening another panel

A panel can open the module's other panel types on what it shows, such as the gear for the build in the planner: `panels.open(type, { content })`. Needs Tavora 0.17.18 or newer. Only right after a click or key press in the panel, once per click, and only the module's own types in the workspace shown now. Tavora picks the panel:

1. A panel of that type that already shows `content` (by `id`, as its `panel.setContent` said) comes to the front: `"shown"`. Without `content`, the panel of that type used last comes to the front.
2. Else the panel of that type the user used last is asked to switch: it gets a `panel.navigate` event, which the SDK hands to your `panel.onNavigate` handler. Save any pending edits there, switch, and resolve: `"switched"`, and it comes to the front. Other copies keep what they show.
3. Else, or when that page has no `onNavigate` handler, a new panel of that type opens; its `panel.getLaunch()` says `{ reason: "open", content }`: `"opened"`.

When the handler throws, or does not resolve within 5 seconds, the panel keeps its content and edits, the call answers `"failed"`, and Tavora tells the user and offers to open the content in a new panel instead. Never switch content without saving first.

The Panel Types Example in Tavora's examples folder does all of this.

## Events

| Event | Data | When |
| --- | --- | --- |
| `workspace.resize` | `{ width, height }` | the panel's size changed |
| `ui.theme` | theme, as `ui.getTheme` | the host theme changed |
| `ui.language` | language code, as `ui.getLanguage` | the user changed the language |
| `documents.changed` | `{ id, revision, deleted }` | another panel of this module changed a document |
| `aiUsage.accountsChanged` | `null` | the user added, renamed or removed an AI account; only with the `aiUsage` capability |
| `systemInfo.snapshot` | `SystemSnapshot` | how busy the PC is, for what this panel watches; only with the `systemInfo` capability, while it watches and is shown |
| `systemInfo.drivesChanged` | `null` | a drive letter appeared or went away; only with the `systemInfo` capability, while the panel watches |
| `systemInfo.connectionChanged` | `SystemConnection` | the connection went down, changed kind or came back; only with the `systemInfo` capability, while the panel watches `connection` and is shown. Tavora 0.21.22+ |
| `media.changed` | `MediaState` | what plays on the PC changed; only with the `media` capability, while the panel watches (also while hidden) |
| `discord.state` | `DiscordState` | the connection to the Discord app changed; only with the `discord` capability, after `discord.state` was asked |
| `discord.event` | `{ event, data }` | a Discord event the panel subscribed to; only with the `discord` capability |
| `hotkeys.pressed` | `{ action, target }` | the user pressed a hotkey set for this module in the workspace shown now; sent to one panel of the module there, the one used last |
| `panel.navigate` | `{ requestId, content }` | another panel of this module asked this one to show `content` (`panels.open`); answer with `panel.navigated` within 5 seconds. The SDK does it for you: use `panel.onNavigate` (Tavora 0.17.18 and newer) |
| `panel.maximized` | `{ maximized }` | the panel started or stopped filling the workspace, by the user or `panel.setMaximized`. The SDK hands it to `panel.onMaximizedChange` (Tavora 0.20.20 and newer) |
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

Some methods need a capability the user grants. A module asks for it in its manifest's `permissions`; the user's yes is a grant, kept by Tavora for the module's publisher and id and checked on every call, so a grant the user takes back stops working at once. The handshake's `capabilities` lists what is granted when the module connects.

| Method | Capability | |
| --- | --- | --- |
| `network.fetch` | `network` | granted per host, see [Network](#network) |
| `network.readPage` | `network` | the same exact-host grant; fresh isolated session |
| `aiUsage.accounts`, `aiUsage.read` | `aiUsage` | granted for the `ai-usage` connector, see [Connectors](#connectors) |
| `systemInfo.*` | `systemInfo` | granted for the `system-info` connector, see [Connectors](#connectors) |
| `media.*` | `media` | granted for the `media` connector, see [Connectors](#connectors) |
| `discord.*` | `discord` | granted for the `discord` connector, see [Connectors](#connectors) |
| `leaderboards.*` | `leaderboards` | granted for the `leaderboards` connector, see [Connectors](#connectors) |
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
| Storage per module and workspace | 5 MiB (keys + serialized values); the same again for `storage.app` |
| One document's `data` | 4 MiB |
| All documents per module and workspace | 50 MiB, at most 1000 documents |
| Document title | 200 characters |
| Panel content (`panel.setContent`) | `id` 200 characters, `title` 200 characters |
| `panels.open` | one per click or key press; the panel asked to switch has 5 s |
| Stored files (`blobs`) | 50 MB each, 500 MB per module and workspace; PNG, JPEG, GIF and WebP only |
| `clipboard.writeImage` | one PNG per click or key press, at most 20 MB, 16384 pixels on a side and 100 million pixels |
| `pictures.save` | the same as `clipboard.writeImage`; names up to 80 characters |
| `files.saveJson`, `files.openJson` | one file per click or key press, JSON up to 8 MiB; names up to 80 characters |
| Panel state | 256 KiB |
| JSON nesting depth | 64 |
| `network.fetch` answer | 5 MB of body, 15 s, 5 redirects, 6 requests at once per panel |
| `network.readPage` answer | 5 MiB of HTML, 30 s, 5 redirects, one active import per module |
| `aiUsage.read` | one reading per account and minute for all modules, 40 s, answers up to 256 KB |
| `systemInfo.watch` | one watch per panel, 26 drives; Tavora reads at most once a second, for all panels together. The connection is checked every 5 seconds, whatever the panels ask |
| `media.control` | one per press; an app gets 5 s to answer |
| `discord.command` | 15 s, answers and events up to 512 KB; 32 subscriptions per panel |
| `leaderboards.submit` | 50 results per call; the service keeps 10,000 results per account and module and takes 60 requests a minute per account and module |
| `leaderboards.top` | 100 lines |
| `ui.showMenu` | one menu per click or key press, 100 entries, labels 80 characters, hints 30 |
| `overlay.publish` | 16 KB of state per overlay, 200 overlays per module and workspace; keys up to 64 letters, digits, `-` and `_` |
| `hotkeys` | 100 per module and workspace; labels 60 characters on one line; targets like overlay keys |

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

`sdk.files.saveJson(value, name?)` saves JSON as a `.json` file where the user says, and `sdk.files.openJson()` opens one they pick. Both use Tavora's own dialogs, which start in the folder the user last saved a file to or opened one from for this module, at first Tavora's own folder in their Documents (`Documents\Tavora`). Each module has its own remembered folder.

- `saveJson` POSTs the JSON to the module's own address, `/_files/json/save/?name=…`; `name` is filled in (cleaned, up to 80 characters, numbered `name (2).json` when taken) and `.json` is added when missing. The answer is `{ fileName }`, the name it was saved under, or `null` when the user closed the dialog. Replacing a file needs the user's OK in the dialog.
- `openJson` POSTs to `/_files/json/open/`. The answer is `{ fileName, value }` with the parsed content (a file over 8 MiB is `QUOTA_EXCEEDED`, a file that is not JSON is `INVALID_PARAMS`), or `null` when the user closed the dialog.
- Both work only right after a real click or key press (one file per press, shared with the clipboard and picture calls), otherwise `PERMISSION_DENIED`. The module never learns a path. No extra permission grant.

They go through module addresses rather than bridge calls so a document up to 8 MiB does not hit the bridge's message limit, like `pictures.save`.

## JSON exports (Tavora 0.19.17+)

`files.exportJson(value, name?)` (deprecated: use `files.saveJson`, which asks the user where to save) in SDK 0.2.10 POSTs JSON to `/_exports/json/?name=...` in the module origin. Maximum 8 MiB before and after host formatting (1 MiB in Tavora 0.20.7 and older). A trusted click/key press is consumed once, shared with picture operations. Saves a new sanitized `.json` in Downloads/Tavora; no arbitrary paths or overwrite. Returns `{ fileName }`. No extra permission grant.


### Remembered read-only files

The native picker is opened with `files.pickReadOnly({ extensions: ["ksd"] })` after a real click/key press. Cancellation returns null; selection returns `{ id, name, size }`. File names are basenames; references are opaque 128-bit values scoped by publisher, module and workspace. No path or folder is accepted from module code. The SDK allows time for the user to use the dialog.

`files.read(id)` POSTs to `/_read-only-files/<id>` in the module origin and returns a Uint8Array, up to 32 MiB. The selected file can be reread after restart without another picker. Two concurrent reads are allowed per scope, four across the host, including reference lookups; errors use the protocol error envelope. `files.forget(id)` revokes access without deleting the selected file. These calls do not enable the reserved `files.open` or `files.save` methods.

References stay on the current PC outside backups/cloud copies and are cleared with module/workspace data. Data copied to another PC may contain an inert reference and must relink files. The page receives no arbitrary filesystem or write access. See [Security](../guide/security.md#remembered-read-only-files).
