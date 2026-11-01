# Overlay page

The Overlay page (a screen of the main window, opened by the Overlay button in the workspace header) applies changes immediately. The Overlay button stays in the header, lit, and any workspace on the rail leaves it; items snap to the grid by their left or right and top or bottom edge, whichever is nearer; undo and redo last until the page is left or the selected setup changes. It replaced the separate Overlay layout window in step 2 of [overlay setups](overlay-setups.md).

## Setups

The page edits one [overlay setup](overlay-setups.md) at a time; its dropdown lists Everywhere, All games and every game setup. The per-game overrides of general positions (Customize for this game, Follow All games) are gone: an item in several setups has its own position and settings in each, so editing one setup never changes another. Hotkeys stay per item, one key for every setup it is in.

- Game setups and All games are drawn in the game window's shape; Everywhere in the main screen's.
- Moving an item in the in-game layer writes to the setup it shows from.
- Removing an item takes it out of the chosen setup only; closing its panel or hiding the overlay from its module takes it out of every setup.

## Copy to…

Next to the setup dropdown, Copy to… lists every game workspace but the one shown (those with a setup, with their frame count, and those without). It sends `{ type: "copy-setup", to, mode }`; `OverlayLayout` asks `GameOverlays.layout.copy`, which calls `GameOverlayStore.copySetup`.

- A game with frames asks first (`replace` / `add` / cancel); one without is copied to at once and gets a setup of its own, empty at the start, never seeded from All games.
- Copied: place (the anchored rectangle, so it fits any window), mode, opacity, Hide from capture, and the item itself (a module overlay by its subject and key, a panel by its instance id, so what #597 adds to an item travels with it). Never copied: the game's picture, and hotkeys (they are per item and already work in every setup it is in).
- Left out and named in the note: a game workspace's items that only work in another game (`allowedIn`), panels whose type can't show over a game, items the target has already (`add`: its own place stays) and items past the limit of 8.
- `replace` with nothing that can go in changes nothing. Items a `replace` took out of the game and that are in no setup any more lose their key, as with Remove.
- The note carries Show, which sends the usual `game` message; it goes away with the next setup you pick or Close.

## Canvas and capture

`OverlayLayout` owns selection, drag previews, undo and messages. `GameOverlays.layout` resolves positions for the controller; the runtime uses the same resolved positions for overlays, interactive panels and panel live views.

`LayoutCanvas` keeps temporary rectangles in a shallow ref so Vue does not turn them into proxies that Electron IPC cannot clone. A drop must reach the main process before Reset position or undo can work reliably.

When menus or dialogs cover the canvas, `OverlayCanvas` captures the native pages and the input layer. The page decodes and displays the stills before acknowledging that the native views can step aside. A generation counter prevents a slow capture from hiding views after a menu closes.

Take picture requires both a running-game report and a window handle observed since launch. Changes to either refresh the layout. A disabled button distinguishes a stopped game from a running game whose window has not been seen. Capture is click-only and remains disabled in hidden test apps; the public security guide describes the capture boundary.

Every setup can have a picture (`LayoutPictures` keys it by the setup id, hashed, so Everywhere and All games work like a game). Take picture needs one game's window and is shown for game setups only; Choose picture… and Remove picture show for all. Preview as is per setup and lives only in `OverlayLayout` (`previews`); `shape()` draws the canvas in that shape, and legacy (unconverted) positions are anchored on the setup's real shape first, so a preview never converts them differently.

## Keys, the item toolbar and Settings

Del and Backspace remove the selected item from the setup shown (not while a text field, list or menu has the focus; no undo). The selected item also gets a small toolbar in the layer, above it or below it where there is no room above: Settings, Hide on canvas (the eye of the Sources list), Reset position, Reset size, and after a thin line Remove. Its tooltips open on the side away from the item. The Settings box on the right keeps what belongs to the frame itself: Show (Always on or On a key), Opacity, Hide from capture, and Move to… (a menu of the other setups the item's workspace may be in).

Settings (the toolbar button, the gear of a Sources row, or a double-click on the frame) sends the `settings` message: the main process puts the item's panel in its dialog right over the Overlay page (`openSettingsOverOverlayPage` in host.ts). The panel runs in the background while the page is open (the page starts the panels that can show over a game, for what they list), a panel that does not run is started quietly, and `PanelViews.openDialog` accepts a panel without a slot for this (`unplaced`). For an overlay, the page then sends the module `panel.openSettings` with the overlay's key, once the page has connected, so the module shows that item's or group's settings; a panel item or a module without a handler shows the panel as it is. The dialog's close button leaves the user on the Overlay page with the frame still selected, and the frame follows the settings live. While it is open the canvas shows stills, as for any dialog.

## What a panel offers

A panel that called `overlay.setSources` is a header in Sources (it folds open and closed, and has no + or gear of its own), with a row under it for each thing it listed, in the module's order. Clicking a row adds that overlay to the setup shown (`GameOverlays.addOverlay`, the path of `overlay.showOverGame` into this setup), the module hears it through `overlay.onOverGameChange`, and the frame starts at the size the source asked for (`size`, in canvas units: pixels of a 1080 px high window) plus 8 units of room on each side, snapped up to the grid, never below the smallest size, in the first free place going down the left side and then across (`freeSpot`). Reset size on such a frame goes back to that size. A panel that never listed anything is added as a whole. Frames from before, which show a whole panel, still load, draw and have their row at the end of the list.

The list keeps its order whatever is added, removed or searched: workspaces, then panels, then the module's order of things. Rows that can't go into the setup shown are not listed; a search that finds only such a panel says why in one quiet line. The kit has no sortable list yet, so the user cannot reorder rows.

## Checks

- Unit coverage: `game-overlays.test.ts`, `game-overlay-service.test.ts`, `overlay-layout.test.ts` and `layout-view.test.ts`.
- Electron coverage: `pnpm --filter @tavora/desktop exec playwright test overlay-layout.spec.ts` exercises the move from a version-4 file, Del, the item toolbar, Settings over the page, per-setup places and opacity, opacity stills, mouse dragging/resizing, reset buttons, the Sources list, Add overlay / Remove overlay, Copy to… and Back; `overlay-button.spec.ts` the header button.
- Real-game screenshot capture still needs a live-game check; hidden Electron tests cannot verify it.
