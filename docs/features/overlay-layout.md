# Overlay page

The Overlay page (a screen of the main window, opened by the Overlay button in the workspace header) applies changes immediately. The Overlay button stays in the header, lit, and any workspace on the rail leaves it; items snap to the grid by their left or right and top or bottom edge, whichever is nearer; undo and redo cover everything done on the page, per setup, until the page is left. It replaced the separate Overlay layout window in step 2 of [overlay setups](overlay-setups.md).

## Setups

The page edits one [overlay setup](overlay-setups.md) at a time; its dropdown lists Everywhere, All games and every game setup. The per-game overrides of general positions (Customize for this game, Follow All games) are gone: an item in several setups has its own position and settings in each, so editing one setup never changes another. Hotkeys stay per item, one key for every setup it is in.

- Game setups and All games are drawn in the game window's shape; Everywhere in the main screen's.
- Moving an item in the in-game layer writes to the setup it shows from.
- Removing an item takes it out of the chosen setup only; closing its panel or hiding the overlay from its module takes it out of every setup.

## Canvas and capture

`OverlayLayout` owns selection, drag previews, undo and messages. `GameOverlays.layout` resolves positions for the controller; the runtime uses the same resolved positions for overlays, interactive panels and panel live views.

`LayoutCanvas` keeps temporary rectangles in a shallow ref so Vue does not turn them into proxies that Electron IPC cannot clone. A drop must reach the main process before Reset position or undo can work reliably.

When menus or dialogs cover the canvas, `OverlayCanvas` captures the native pages and the input layer. The page decodes and displays the stills before acknowledging that the native views can step aside. A generation counter prevents a slow capture from hiding views after a menu closes.

Take picture requires both a running-game report and a window handle observed since launch. Changes to either refresh the layout. A disabled button distinguishes a stopped game from a running game whose window has not been seen. Capture is click-only and remains disabled in hidden test apps; the public security guide describes the capture boundary.

Every setup can have a picture (`LayoutPictures` keys it by the setup id, hashed, so Everywhere and All games work like a game). Take picture needs one game's window and is shown for game setups only; Choose picture… and Remove picture show for all. Preview as is per setup and lives only in `OverlayLayout` (`previews`); `shape()` draws the canvas in that shape, and legacy (unconverted) positions are anchored on the setup's real shape first, so a preview never converts them differently.

## Selecting several

Ctrl+click (Cmd+click on a Mac) and Shift+click add a frame to the selection or take it away; a box drawn on the empty canvas selects every frame it touches (with Ctrl, Cmd or Shift held, added to what was selected); Esc lets go. The view has `selected` (every selected id, in the order picked) and `selection` (the id while exactly one is selected, else null). Dragging one of the selected frames, or the arrow keys (Shift: 5 cells), moves all of them: their bounding box snaps and stays on the canvas, and each moves by as much, so they keep their places to each other. The drop sends one `commit` with `rects`; several frames keep their own anchors (`anchorIn`), one alone is anchored to its nearest edges as before. Resize handles show only while one frame is selected. Del removes all selected.

With several selected, the toolbar sits over their bounding box and has Hide (Show once all are hidden), Reset position, Reset size and Remove, and the Settings box says "3 frames selected" with Show, Opacity and Hide from capture for all of them (`set` message); a setting that differs shows as Mixed. Key and Move to… are for one frame only.

An empty setup shows "Add something from the list on the right" in the canvas, naming the side the Sources list is on (`gameOverlays.sidebar`).

## Undo

`OverlayLayout` keeps one `LayoutHistory` (`shared/layout-history.ts`) per setup, in memory, cleared when the page is opened again. A step is one user action: add, remove (one or many), hide or show on the canvas, move or resize (one or many), Reset position or size, Move to…, a change in the Settings box. It holds snapshots, not commands: for each item it touched, in each setup it touched it in, the item's whole saved state before and after (`LayoutSource.state`: the stored item, its index in the setup's list and its toggle key) and whether it was hidden on the canvas, or null where it wasn't in that setup. Undo writes every "before" back, redo every "after" (`LayoutSource.put`): an item that isn't there is put back exactly (same place in the list, settings, position and key; its module must still show it, a panel must still be open, the setup must have room), one that is there gets its settings and position, null takes it out. Items leave first, so a swap in a full setup works. A step applies only while every item is still as the step left it; one changed since (moved in the game, removed by its module) is never written over: the step is dropped and the one before it is tried. A write that fails puts back what was written and drops the step. Saved data is unchanged.

## Keys, the item toolbar and Settings

Del and Backspace remove the selected items from the setup shown (not while a text field, list or menu has the focus); Ctrl+Z (Cmd+Z) undoes, Ctrl+Y or Ctrl+Shift+Z (Cmd+Shift+Z) redoes. The selected item also gets a small toolbar in the layer, above it or below it where there is no room above: Settings, Hide on canvas (the eye of the Sources list), Reset position, Reset size, and after a thin line Remove. Its tooltips open on the side away from the item. The Settings box on the right keeps what belongs to the frame itself: Show (Always on or On a key), Opacity, Hide from capture, and Move to… (a menu of the other setups the item's workspace may be in).

Settings (the toolbar button, the gear of a Sources row, or a double-click on the frame) sends the `settings` message: the main process puts the item's panel in its dialog right over the Overlay page (`openSettingsOverOverlayPage` in host.ts). The panel runs in the background while the page is open (the page starts the panels that can show over a game, for what they list), a panel that does not run is started quietly, and `PanelViews.openDialog` accepts a panel without a slot for this (`unplaced`). For an overlay, the page then sends the module `panel.openSettings` with the overlay's key, once the page has connected, so the module shows that item's or group's settings; a panel item or a module without a handler shows the panel as it is. The dialog's close button leaves the user on the Overlay page with the frame still selected, and the frame follows the settings live. While it is open the canvas shows stills, as for any dialog.

## What a panel offers

A panel that called `overlay.setSources` is a header in Sources (it folds open and closed, and has no + or gear of its own), with a row under it for each thing it listed, in the module's order. Clicking a row adds that overlay to the setup shown (`GameOverlays.addOverlay`, the path of `overlay.showOverGame` into this setup), the module hears it through `overlay.onOverGameChange`, and the frame starts at the size the source asked for (`size`, in canvas units: pixels of a 1080 px high window) plus 8 units of room on each side, snapped up to the grid, never below the smallest size, in the first free place going down the left side and then across (`freeSpot`). Reset size on such a frame goes back to that size. A panel that never listed anything is added as a whole. Frames from before, which show a whole panel, still load, draw and have their row at the end of the list.

The list keeps its order whatever is added, removed or searched: workspaces, then panels, then the module's order of things. Rows that can't go into the setup shown are not listed; a search that finds only such a panel says why in one quiet line. The kit has no sortable list yet, so the user cannot reorder rows.

## Checks

- Unit coverage: `game-overlays.test.ts`, `game-overlay-service.test.ts`, `overlay-layout.test.ts`, `layout-history.test.ts`, `layout-math.test.ts` and `layout-view.test.ts`.
- Electron coverage: `pnpm --filter @tavora/desktop exec playwright test overlay-layout.spec.ts` exercises the move from a version-4 file, Del, the item toolbar, Settings over the page, per-setup places and opacity, opacity stills, mouse dragging/resizing, reset buttons, selecting several (Ctrl+click, a box), Del of several and undo, the Sources list, Add overlay / Remove overlay and Back; `overlay-button.spec.ts` the header button.
- Real-game screenshot capture still needs a live-game check; hidden Electron tests cannot verify it.
