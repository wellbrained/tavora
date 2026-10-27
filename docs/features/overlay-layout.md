# Overlay layout

The layout window applies changes immediately. Done closes it; undo and redo last until the window closes or the selected setup changes. Step 2 of [overlay setups](overlay-setups.md) replaces this window with the Overlay page.

## Setups

The window edits one [overlay setup](overlay-setups.md) at a time; its Game dropdown lists All games, Everywhere (only while it has items) and every game setup. The per-game overrides of general positions (Customize for this game, Follow All games) are gone: an item in several setups has its own position and settings in each, so editing one setup never changes another. Hotkeys stay per item, one key for every setup it is in.

- Game setups and All games are drawn in the game window's shape; Everywhere in the main screen's.
- Moving an item in the in-game layer writes to the setup it shows from.
- Removing an item takes it out of the chosen setup only; closing its panel or hiding the overlay from its module takes it out of every setup.

## Canvas and capture

`OverlayLayout` owns selection, drag previews, undo and messages. `GameOverlays.layout` resolves positions for the controller; the runtime uses the same resolved positions for overlays, interactive panels and panel live views.

`LayoutCanvas` keeps temporary rectangles in a shallow ref so Vue does not turn them into proxies that Electron IPC cannot clone. A drop must reach the main process before Reset position or undo can work reliably.

When menus cover the canvas, `OverlayLayoutWindow` captures the native pages and the input layer. The shell decodes and displays the stills before acknowledging that the native views can step aside. A generation counter prevents a slow capture from hiding views after a menu closes.

Take picture requires both a running-game report and a window handle observed since launch. Changes to either refresh the layout. A disabled button distinguishes a stopped game from a running game whose window has not been seen. Capture is click-only and remains disabled in hidden test apps; the public security guide describes the capture boundary.

## Checks

- Unit coverage: `game-overlays.test.ts`, `game-overlay-service.test.ts`, `overlay-layout.test.ts` and `layout-view.test.ts`.
- Electron coverage: `pnpm --filter @tavora/desktop exec playwright test overlay-layout.spec.ts` exercises the move from a version-4 file, per-setup places and opacity, opacity stills, mouse dragging/resizing, reset buttons and Done.
- Real-game screenshot capture still needs a live-game check; hidden Electron tests cannot verify it.
