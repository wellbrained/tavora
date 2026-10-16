# Bridge protocol v1

**Status:** Milestone B, 2026-10-14. Version 1 is what `@tavora/sdk` 0.1.0 speaks. It may still change before Tavora's first public release; after that, breaking changes need a new major version (see [Versioning](#versioning)).

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
| `bridge.handshake` | `{ protocol: 1, sdkVersion: string }` | `{ protocol: 1, host: { name: "tavora-desktop", version }, module: { id, version }, capabilities }`: `capabilities` lists what the player has granted, such as `["network"]` |
| `game.getCurrent` | none | `{ id, displayName }` of the game this panel belongs to |
| `storage.get` | `{ key }` | the stored JSON value, or `null` |
| `storage.set` | `{ key, value }` | `null` |
| `storage.delete` | `{ key }` | `null` |
| `storage.keys` | none | sorted array of keys |
| `documents.list` | none | `DocumentSummary[]`, newest first |
| `documents.get` | `{ id }` | `{ id, title, revision, updatedAt, bytes, data }` or `null` |
| `documents.put` | `{ id?, title, data, ifRevision? }` | `DocumentSummary` of the saved document |
| `documents.delete` | `{ id, ifRevision? }` | `null` (also when the document did not exist) |
| `panel.getState` | none | this panel's state, or `null` |
| `panel.setState` | `{ value }` | `null`; `value: null` removes the state |
| `workspace.getViewport` | none | `{ width, height }` of the panel in CSS pixels |
| `ui.getLanguage` | none | the language of Tavora's own texts as a code, `"en"` or `"de"` for now; show your module in it, or in English when you have no translation |
| `links.open` | `{ url }` | `null`; opens the web address (http or https, at most 2048 characters) as a new tab in the game's Browser panel, or in a new Browser panel. Only right after a real click or key press in the panel, once per click (`PERMISSION_DENIED` otherwise); `INVALID_PARAMS` for anything but a web address. You learn nothing about the page |
| `blobs.list` | none | `BlobInfo[]` (`{ id, bytes, type, createdAt }`), oldest first |
| `blobs.usage` | none | `{ bytes, count, maxBytes, maxFileBytes }` for this module and game |
| `blobs.delete` | `{ id }` | `null` (also when the file did not exist); `INVALID_PARAMS` for an id the host did not make |
| `ui.getTheme` | none | `{ mode, colors: { background, surface, text, textMuted, accent }, tokens, radius }`: `tokens` holds every semantic colour by its shadcn-vue name (`THEME_TOKENS`), `radius` is in CSS pixels |
| `network.fetch` | `{ url, method?, headers?, body?, responseType? }` | `{ status, url, headers, body }`; needs the `network` capability, see [Network](#network) |

### Where data lives

| Kind | Scope | Removed when |
| --- | --- | --- |
| `storage` | module + game, shared by all its panels | never by closing panels; later by uninstalling (Milestone C) |
| `documents` | module + game, shared by all its panels | as above |
| `blobs` (pictures) | module + game, shared by all its panels | the game is deleted from the Trash; never by closing panels |
| `panel` state | one panel instance | the panel is closed |

A module never sees another module's data, or its own data for another game. Data belongs to the module's id together with who published it (the key that signed its zip, or "local" for an unsigned folder), so a module from another publisher with the same id starts with nothing.

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

### Network

A module's page has no network of its own: it cannot fetch, load remote images or open sockets. It names the hosts it needs in [`permissions.network`](./manifest.md), and once the player has granted them, `sdk.network.fetch(url, init)` asks Tavora to make the request. The player is asked when they first add the module; until they agree, the handshake reports no `network` capability and every call fails with `PERMISSION_DENIED`. When an update asks for more hosts, what was granted keeps working and the module's panels offer the player to review the new ones. The player can take a grant back at any time in Settings > Integrations, which removes the module's panels.

- **Which addresses:** only `https:` on the standard port, to a host the module lists and the player granted, without a user name or password. A redirect is followed only to such an address too (at most 5); anything else is `PERMISSION_DENIED`. A granted name that points to this PC or the local network is refused as well.
- **Params:** `method` is `GET` (default), `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`; `headers` is an object of text values; `body` is text (send binary data as base64 or JSON), not allowed with `GET` and `HEAD`; `responseType` is `"text"` (default, read as UTF-8) or `"base64"` for pictures and other binary answers.
- **Set by Tavora:** `Cookie`, `Host`, `Origin`, `Referer`, `User-Agent` (`Tavora/<version> (module <id>)`), `Accept-Encoding`, `Connection`, `Content-Length`, `Transfer-Encoding` and the other transfer headers, `Proxy-*` and `Sec-*` cannot be sent (`INVALID_PARAMS`). No cookies are sent or kept. On a redirect to another host, `Authorization` is dropped.
- **The answer:** `status`, the final `url`, `headers` with lowercase names (without `Set-Cookie`), and `body`. Compressed answers are unpacked. An error status such as 404 or 500 is an answer, not an error.
- **Limits:** at most 5 MB of body (after unpacking; `QUOTA_EXCEEDED` otherwise), 15 seconds per request including redirects, and 6 requests at once per panel (`BAD_REQUEST` for a seventh). When no answer comes at all (unknown host, refused connection, certificate error, too slow), the error is `NETWORK_ERROR`.
- **To show a picture** from a granted host, ask for `responseType: "base64"` and use a `data:` address, or store it with `blobs.put`.

### Documents

A document is a named JSON value with a title and a revision. `DocumentSummary` is `{ id, title, revision, updatedAt, bytes }`; `updatedAt` is an ISO 8601 timestamp and `bytes` the size of `data` as stored.

- `id`: 1 to 64 characters from `A-Z a-z 0-9 _ -`, starting with a letter or digit. Leave it out of `documents.put` to get a new random id.
- `revision` starts at 1 and goes up by one on every put.
- `ifRevision` makes a put or delete conditional: it fails with `CONFLICT` (and `error.revision` set to the current revision) unless the stored revision equals it. `ifRevision: 0` means "only if it does not exist yet".
- After a successful put or delete, every **other** connected panel of the same module and game gets a `documents.changed` event. The panel that made the change does not.

Writes are atomic: a crash leaves either the old or the new document, never a mix.

## Events

| Event | Data | When |
| --- | --- | --- |
| `workspace.resize` | `{ width, height }` | the panel's size changed |
| `ui.theme` | theme, as `ui.getTheme` | the host theme changed |
| `ui.language` | language code, as `ui.getLanguage` | the player changed the language |
| `documents.changed` | `{ id, revision, deleted }` | another panel of this module changed a document |
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
| `PERMISSION_DENIED` | The method exists but needs a capability this module was not granted | `capability` |
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
| Storage per module and game | 5 MiB (keys + serialized values) |
| One document's `data` | 4 MiB |
| All documents per module and game | 50 MiB, at most 1000 documents |
| Document title | 200 characters |
| Panel state | 256 KiB |
| JSON nesting depth | 64 |
| `network.fetch` answer | 5 MB of body, 15 s, 5 redirects, 6 requests at once per panel |

These limits are checked first inside your own page, by the preload Tavora gives it, before a message reaches the host. A request over a limit is answered with `BAD_REQUEST` (`INVALID_PARAMS` for data that is not plain JSON) and never sent on, so a module that sends something huge can only slow itself down. A request id cannot be reused while its answer is pending.

Values must be JSON: `null`, booleans, finite numbers, strings, arrays and plain objects. `undefined`, `Date`, `Map`, typed arrays, `NaN` and similar are rejected with `INVALID_PARAMS`, not converted.

## Versioning

- `v` on every message is the major protocol version. A host answers a message with another `v` with `BAD_REQUEST` and `supported`.
- The handshake carries the version the SDK wants. A host that cannot serve it answers `INCOMPATIBLE` with the versions it supports, and the SDK's `connect()` rejects with that error.
- Within a major version, the host may add methods, events, optional params, result fields and error codes. Modules must ignore event names and result fields they do not know.
- Removing or changing anything existing needs a new major version. A host should keep serving the previous major version for as long as published modules use it.
- The manifest's `apiVersion` names the major version the module was built for.
