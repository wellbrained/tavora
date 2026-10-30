## 0.3.0

The helper entries are complete: `testing`, `store` (document store, item session, result queue, run store), `bootstrap` and the generated protocol table. Nothing changes on the wire, so `MIN_TAVORA` stays (Tavora 0.19.32).

- Item session: `reload()` reads the open item again after something other than its handle wrote it (the panel's own `documents.put` is not reported back to it), keeping unsaved edits on top; `deletedCopy` is the last copy of an item deleted by another panel (unsaved edits included, null otherwise), so a panel can keep showing it. `parse(null)` must return a valid placeholder: the docs say so now.
- Document store: `reload()` on the handle is the same for one document.
- The kit's `useItemSession` returns `deletedCopy` and `reload`.
- The kit no longer exports `updateDocument`, `readDocument`, `applyTheme`, `Versioned` and `UpdateOptions`; use `openDocument` / `useDocument`, and `connectModule({ texts })`. `serial` and the callback form of `connectModule` are still there, deprecated, for modules that have not moved.

## 0.2.21

The protocol table: every call declared once. Nothing changes on the wire or for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `METHOD_INFO` in `@tavora/sdk/protocol` holds, for each call, the first Tavora that answers it (`since`), the permission it needs (`capability`) and whether it needs a click or key press (`gesture`). The memory host (`@tavora/sdk/testing`) reads it instead of its own copy, and so does `apps/docs/reference/protocol.md`, whose method index is generated from it. `needsGesture(call, params)`, `supportsCall(version, call)` and `versionAtLeast(version, wanted)` are exported with it, and `HttpCalls` types the file, picture and blob calls that go over HTTP.
- `sdk.supports(call)` says whether the Tavora the module runs in has a call: `sdk.supports("storage.compareAndSet")`, `sdk.supports("panel.openDialog")`. Use it to pick a fallback before calling.
- `MIN_TAVORA` is worked out from the table (the newest call not marked `later`, and `permissions.onRequest`), not written by hand.
- The memory host now agrees with Tavora about capabilities: `clipboard.writeImage`, `files.*` and `overlay.publish`/`overlay.remove` need no grant there, as in the real host (they answered `PERMISSION_DENIED` in tests before).
- Doc comments and the changelog name the real error code `UNKNOWN_METHOD`, where they said `METHOD_NOT_FOUND`.

## 0.2.20

The result queue and the run store: `openResults` and `openRuns` in `@tavora/sdk/store`. Nothing changes for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `openResults(sdk, { boards?, key?, pollMs? })` keeps finished games for a leaderboard. `record(board, result)` stores the result in `storage.app` at once (compare-and-set, so two panels never lose one) and sends in the background, in batches of up to 50 per board through `leaderboards.submit`. Results the board refused leave the queue like taken ones; results wait while the user is signed out or has not agreed (`status` `"waiting"`, checked again every `pollMs`), while Tavora's service is away (`"offline"`, retried after 1, 2, 4 … at most 30 minutes) and when the leaderboard connector is not allowed (`"denied"`). A panel resuming sends too. `onStanding(fn)` gets `leaderboards.mine()` after results were taken (not on a Tavora older than 0.21.97). `pending`, `has(id)`, `flush()`, `onStatus(fn)` and `dispose()` complete it. A Tavora without an `online` field in the status counts as online.
- `rowsOf(answer)`, `isOffline(status)` and `retryDelay(failures)` are exported for the leaderboard tab: `top` answers with a bare list on Tavora 0.21.92 and `{ rows }` later.
- `openRuns(sdk, { validate, awaitsUpload, keys?, groups?, groupOf?, keep?, now? })` keeps the played games of a daily-puzzle module (`start`, `change`, `finish`, `expire`, `makeCasual`, `fold`, `statistics`, `load`, `onChange`). Every change is a compare-and-set on the run's own key and is applied again on the newest copy; a ranked run whose time is up ends first, so a move after the deadline never counts. `fold()` folds old finished unlimited runs into a summary but keeps runs that `awaitsUpload`, and yields to another panel that folded first. Also exported: `localDate`, `previousDate`, `msUntilMidnight`, `onItsDay`, `runStatistics`, `finishRun`, `expireRun`, `makeRunCasual`, `defaultRunKeys`.

## 0.2.19

The anchor form: pass the element a menu or tooltip is for. Nothing changes on the wire or for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `ui.showMenu({ anchor, items, side?, align? })`: `anchor` is the element (its box is read when you call) or a box `{ x, y, width?, height? }`. The SDK sends that box as `at`; Tavora adds the gap and opens the menu next to it, never at the pointer. `at` still works for the rare case without an element; with neither, the call rejects with `INVALID_PARAMS`. The new `MenuOptions` type describes the argument (`MenuRequest` stays the wire shape).
- `ui.tooltip.show` and `ui.tooltip.move` take `anchor` instead of `at`: with an element, the tooltip opens next to it, at the middle of its right edge. `TooltipShowOptions` and `TooltipMoveOptions` are the new argument types.
- The memory host (`@tavora/sdk/testing`) does the same, so `host.calls["ui.showMenu"]` holds the box that was sent.

## 0.2.18

The item session: `openItems` in `@tavora/sdk/store`. Nothing changes for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `openItems(sdk, { prefix, parse, title, rename?, newItem?, content?, onAdd?, onDeleted?, followNavigate?, restore?, whenEmpty?, merge?, debounceMs? })` keeps the items of one kind (documents whose id starts with `prefix`) and the one a panel has open, on top of `openDocument`. `items` follows `documents.onChange` and the panel's own saves; `current` is the open item's document handle. `pick(id)` saves the open item and opens another; a slow pick that finishes after a newer one resolves `false`, an unknown id rejects with `ItemNotFoundError`. `create`, `rename` and `remove` keep the list in step; `remove` deletes only the copy that was listed (else `CONFLICT`), opens the next item when it was the open one and returns an `undo`. A panel that was open before (or opened by `panels.open`) shows its item again; a new one follows `onAdd` (`last`, `first`, `none`). `panel.setContent` and `panel.onNavigate` are kept in step. When another panel deletes the open item, the session stays on it (`onDeleted: "keep"`, default; `deleted` turns true and `restoreDeleted()` puts its last copy back) or opens the next one (`"fallback"`); `flush()` and `pick` never create a deleted item again. A `pick` that cannot save the open item rejects with `ItemSaveError` and keeps it open. `job(fn)` runs one async job at a time and shows what other panels changed meanwhile once afterwards; `panels.open` and the fallback wait for it (`busy`). `restore(launch, state)` lets a module choose the item to show from `panel.getState`, and `whenEmpty()` creates a starter item once for an empty list.

## 0.2.17

The module bootstrap: `@tavora/sdk/bootstrap`. Nothing changes for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `bootstrapModule()` connects, applies the host theme now and whenever it changes, and tracks the language. It returns `{ sdk, theme, language, status, error?, onLanguage(fn), onTheme(fn), dispose() }`; `dispose()` removes every listener it added. A failed connection does not throw: `status` is `"failed"` and `error` says why, so the page can show "Could not connect".
- `applyHostTheme(theme, root?)` writes the theme to the page: every token as `--<token>`, the summary colours as `--host-background`, `--host-surface`, `--host-text`, `--host-text-muted` and `--host-accent`, `--radius`, `color-scheme`, the `dark` class and `data-mode` (`"dark"` or `"light"`).
- `isGerman(language)` and `languageOf(language)`: anything but German (`de`, `de-AT`, `de_DE`, …) is English, as in the host.


## 0.2.16

The document store: `@tavora/sdk/store`. Nothing changes for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `openDocument(sdk, id, { parse, title, merge?, debounceMs? })` keeps one document for a panel: `update(change)` shows an edit at once and saves it after a short pause, one save at a time. What the panel shows is what gets saved; make ids and timestamps outside the change function, because after a `CONFLICT` the store reads the newest copy and applies your edits on it again (up to 5 attempts). An edit that throws on the newest copy is dropped (`onError(error, "change")`), the others stay. When a save gives up, `onError(error, "save")` fires and `data` goes back to the saved copy plus the edits made meanwhile, which are saved next; the `onChange` event has `source: "rollback"`. `status` is `idle`, `dirty`, `saving` or `error`, and an empty `flush()` leaves it alone. When another panel changes the document, the store reloads it (also after a delete and re-create), or applies your unsaved edits on the new copy; a delete elsewhere pauses saving and keeps your edits until your next `update` or `flush()`. `merge: "mine"` is for an editor that owns the whole document: its copy wins a conflict, a failed save keeps the copy on screen (`status` `error`, retried on the next `flush()` or `update`), and another panel's copy arrives as `event.remote` for `adoptRemote()`. `flush()`, `dispose()` and the panel being hidden save what is pending.

## 0.2.15

A test host: `@tavora/sdk/testing`. Nothing changes for a running module, so `MIN_TAVORA` stays (Tavora 0.19.32).

- `createMemoryHost()` gives `{ sdk, host }`: `sdk` is a whole `TavoraSDK` that keeps its state in memory and follows the real host's rules (limits, document revisions and `CONFLICT`, `compareAndSet`, panel state, events), and `host` is what a test uses to set things up, raise events and look at the calls the module made. It can simulate an older Tavora, refuse calls that need a click, and share its state with a second panel. See [Testing your module](https://docs.mytavora.app/guide/testing).

## 0.2.14

Panel dialogs, with Tavora 0.21.95 or newer. `MIN_TAVORA` stays (Tavora 0.19.32): on an older Tavora `openDialog` throws `UNKNOWN_METHOD`, so a module can show its settings in the panel instead.

- `panel.openDialog({ width, height })` shows the panel big in a dialog centred on the app, over everything else, with the module's name and a close button: for settings or details that don't fit a small panel. It is the same page, so it keeps all it had. Opening needs a real click or key press. `panel.closeDialog()` puts it back, and `panel.onDialogChange` hears when it opens or closes, also when the user closes it. From a panel over the game, Tavora closes the in-game layer and comes to the front with the dialog open.
- Toasts follow the user: `theme.toasts` (`ToastPosition`, one of `TOAST_POSITIONS`: `"bottom-center"`, `"bottom-right"` or `"top-center"`) says where they want toasts in a panel; an older Tavora leaves it out, which means bottom center. The new theme tokens `toast` and `toast-foreground` colour them; a theme may leave them out (`OPTIONAL_THEME_TOKENS`) and Tavora fills them in as flipped pills, so a module always gets every token.

## 0.2.13

Leaderboards, with Tavora 0.21.92 or newer; board names, the `total`, `average` and `rate` kinds, periods and `mine()` with Tavora 0.21.97 or newer. Everything else still works on every Tavora the SDK supports (Tavora 0.19.32), so `MIN_TAVORA` stays; a module that uses leaderboards sets `minTavora` to 0.21.92.

- `leaderboards`: the boards a manifest's `leaderboards` declares, kept on Tavora's service with the user's Tavora account, through the new `leaderboards` connector. `status()` says whether Tavora's service answered (`online`, so it never fails offline), whether the user is signed in, whether the boards run for the module, and whether the user agreed to be shown, with their public name once they did. `show()` (after a click) has Tavora ask the user in the panel; `hide()` (after a click) takes them off and deletes their results. `submit(board, results)` sends up to 50 games, each taken or refused on its own, and `top(board, { period, day, limit })` reads a board as `{ rows }`. A module never gets an account id, only a `self` mark on the user's own line.
- Five kinds of board, so most games find one that fits: `streak` (won and lost games, optionally one a day), `score` (a user's best number, highest or lowest), `total` (the sum of a user's numbers), `average` (the mean, after `minGames` games) and `rate` (the share of games won, after `minGames`). Every board has a `name` users see, translatable through `translations.boards`, and `score`, `total` and `average` boards may name a `unit`.
- Every board can be read for a `period`: a day, a week, a month, a year or all time. A result counts for the periods its `day` is in; the SDK fills `day` in from `at` when a result has none.
- `mine()` gives the user's own standing on every board of the module in every period: rank, how many users the board has, and their numbers. Tavora shows the same in the user's profile.
- `storage.compareAndSet(key, expected, value)` and `storage.app.compareAndSet`: set a value only while the key still holds what you read, so two panels can't overwrite each other's change.

## 0.2.12

From Tavora 0.21.43 every item on its rail is a workspace: a game workspace, linked to a game, or a personal workspace.

- `workspace.getCurrent()` answers the `TavoraWorkspace` the panel is in: `{ id, displayName, kind }`, with `kind` `"game"` (its id is the game's, the one your manifest's `games` lists) or `"personal"`. It works on every Tavora the SDK supports (Tavora 0.19.32): an older one is asked `game.getCurrent` instead and answered in the new words, so `MIN_TAVORA` stays.
- `game.getCurrent()` and `TavoraGame` are deprecated: they still answer, with `kind` `"workspace"` for a personal workspace, until Tavora's 1.0 preparation.

## 0.2.11

Stream overlays and hotkeys (Tavora 0.19.26). `MIN_TAVORA` is now `0.19.32`, for `permissions.onRequest`.

- Stream overlays: a manifest `overlay` page that OBS or other streaming software shows as a Browser Source, with the new `stream-overlay` connector. `overlay.publish(key, state)` sets what an overlay shows (Tavora keeps it while no panel runs), `overlay.copyLink(key)` copies its link after a click, `overlay.remove` and `overlay.resetLink`. The overlay page reads its state with `watchOverlay(fn)`.
- `permissions.onRequest`: list `"stream-overlay"` there too, and players are asked for it on the first `overlay.copyLink` instead of when they add the module; the call then gives `"denied"` if they say no (Tavora 0.19.32).
- Hotkeys: manifest `actions`, which players bind to keys in Tavora's own dialog (`hotkeys.set(action, target, label)` after a click). Panels hear `hotkeys.onPress` while their game is shown; `hotkeys.list` and `hotkeys.remove` manage them. A module never learns the key.
- In-game overlays: `overlay.showOverGame`, `hideOverGame`, `overGame` and `preview` show, remove, list and preview a module's overlay. `panel.setLive` supplies the read-only live view for a panel shown in game. See each method's host-version requirement.
- Panels: `isMaximized`, `setMaximized` and `onMaximizedChange` share the host's Maximize state; maximizing requires a real click or key press.
- Files: remember a file chosen with `pickReadOnly`, reread it with `read`, and revoke its reference with `forget`. `saveJson` and `openJson` use Tavora's dialogs without exposing paths. `exportJson` is deprecated in favour of `saveJson`; its limit is now 8 MiB. `pictures.save` also uses a save dialog.
- System info: the consented `system-info` connector adds PC readings, running apps, connection checks and history, and Windows traffic totals. Sampling and host-version requirements are documented on the methods and protocol types.
- Media: the consented `media` connector reads Windows media sessions, watches changes, and sends play/pause, previous or next only after a real click or key press. No player sign-in or token reaches a module.

## 0.2.10

Requires the JSON export host (Tavora 0.19.17). Adds `files.exportJson(value, name?)`: gesture-gated, bounded JSON export to a new file in Downloads/Tavora.

# Changelog

What changed in `@tavora/sdk` and the bridge protocol it speaks, newest first. Before Tavora 1.0 the SDK may still change in ways that break modules; each such change raises the minor version (0.2 → 0.3) and is marked **Breaking** here. Anything else raises the patch version. To make sure players have a Tavora that knows what your module uses, set [`minTavora`](https://docs.mytavora.app/reference/manifest) in its manifest.

## 0.2.9

- `network.readPage(url)` (Tavora 0.19.3): bounded public HTML capture in a fresh hidden sandbox, using existing exact-domain grants. No module script execution API, interactions or player cookies. Owner disconnect cancels it. `MIN_TAVORA` is now `0.19.3`.

## 0.2.8

- Shared rich tooltips (Tavora 0.18.18). Adds `ui.tooltip.show/move/hide/close/onClose` for checked rich details over neighbouring panels. Hover is pointer-transparent; a pin requires real input. One shared pin remains until closed or its source goes away.

## 0.2.7

- Manifest `changelog`: a JSON file in the package with the module's patch notes, `[{ "version", "date", "notes": [...] }]`, newest first. Players read them under the module in Settings > Modules, and an update marks the new ones (Tavora 0.18.2). `MIN_TAVORA` is now `0.18.2`.

## 0.2.6

- `game.getCurrent()` answers `kind`: `"game"`, or `"workspace"` for a personal workspace the player made for modules that belong to no game, such as notes (Tavora 0.18.1). An older Tavora leaves it out, which means a game. `MIN_TAVORA` is now `0.18.1`.
- Manifest `workspaces`: modules for any game are offered in personal workspaces too. Set `"workspaces": false` for one that only makes sense in a game; a module for one game is never offered there (Tavora 0.18.1).

## 0.2.5

- `pictures.save(png, name)`: saves a PNG as a new file in the player's `Pictures\Tavora` folder, right after a click or key press in the panel; resolves with the file name it got (Tavora 0.17.19). `MIN_TAVORA` is now `0.17.19`.

## 0.2.4

- Opening another panel: `panels.open(type, { content })` opens one of the module's own panel types in the current game, right after a click or key press. Tavora brings forward a panel of that type already showing the content, else asks the one used last to switch through `panel.onNavigate(fn)` (save pending edits, then resolve; throw to refuse; 5 seconds), else opens a new one, whose `panel.getLaunch()` is `{ reason: "open", content }`. It resolves with `"shown"`, `"switched"`, `"opened"` or `"failed"`; when a switch fails, the player is offered the content in a new panel (Tavora 0.17.18). Set `minTavora` to `0.17.18` or newer when you use them.

## 0.2.3

- Content per panel: `panel.setContent({ id, title } | null)` tells Tavora what the panel shows now, such as the build picked in your toolbar. Tavora keeps it with the panel across game switches and restarts and shows the title when the player hovers the tab. `panel.getLaunch()` says why the page is loading: `{ reason: "add" }` for a panel the player just added (pick the content yourself, such as the last one used), or `{ reason: "restore", content }` for one that was open before (Tavora 0.17.17). Set `minTavora` to `0.17.17` or newer when you use them.

## 0.2.2

- `MIN_TAVORA`: the oldest Tavora that has everything this SDK version offers, for `minTavora` in your manifest.
- Panel types: a manifest may list `panels`, named tools such as Inventory and Build planner that players add, dock and copy on their own, all sharing the module's saved content and permissions. `panel.type` says which one a page runs as; the handshake carries it as `panel.type` (Tavora 0.17.12). Set `minTavora` to `0.17.12` or newer when you use them: an older Tavora refuses the `panels` field.

## 0.2.1

- `ui.showMenu(request)`: a menu Tavora draws above every panel, so it is never cut off at the panel's edge. Items with an optional colour dot, check or radio mark, hint and danger style; separators; headings; one level of submenus. Only right after a click, right-click or key press in the panel; resolves with the chosen id or null (Tavora 0.17.9).

## 0.2.0

Needs Tavora 0.17.8 or newer for `minTavora`; everything else works from the Tavora version named next to it.

- `minTavora` in the manifest: the oldest Tavora a module works with. An older Tavora refuses to install or load it and says why (Tavora 0.17.8).
- `connectors.discord`: the Discord app on the player's PC through Tavora's Discord sign-in: `state()`, `connect()`, `allowControl()`, `command()` for a fixed list of RPC commands, `subscribe()` and `onEvent()` for voice events, and `image()` for avatars and server icons. Needs `"discord"` in `permissions.connectors` and the player's consent (Tavora 0.16.11).
- `connectors.aiUsage`: the usage of the player's Claude and Codex accounts, without ever seeing a login. Needs `"ai-usage"` in `permissions.connectors` (Tavora 0.16.10).
- `storage.app`: small settings shared by every game, next to `storage` for the current game (Tavora 0.16.10).
- `network.fetch`: web requests to the hosts in `permissions.network`, after the player allowed them; HTTPS only, no cookies (Tavora 0.16.8).
- `clipboard.writeImage(png)`: puts a PNG on the clipboard right after a click or key press in the panel (Tavora 0.14.1).
- `blobs`: pictures a module keeps for a game, served from the module's own address (Tavora 0.12.0).
- `links.open(url)`: opens a web address in the game's Browser panel, right after a click or key press (Tavora 0.11.0).
- `ui.getLanguage()` and `ui.onLanguageChange()`: the language Tavora shows its texts in (Tavora 0.5.9).

## 0.1.0

The first version: `connect()`, the current game, `storage`, `documents` with revisions and change events, panel state, the panel's size, the theme and its changes, and the suspend, resume and dispose lifecycle. Bridge protocol v1.
