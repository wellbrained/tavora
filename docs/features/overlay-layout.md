# Overlay layout

The layout window applies changes immediately. Done closes it; undo and redo last until the window closes or the selected game changes.

## Shared and game-specific positions

- All games contains only general overlays and panels, from workspaces such as Personal.
- A game contains its own items plus the general ones. General items follow All games until moved or resized there.
- Customize for this game snapshots every general item's current position and size. General items added later also receive independent positions in customized games.
- Follow All games again removes either one item's override or the whole game's overrides. Following one item returns the game to per-item customization; its other overrides remain.
- Mode, opacity, hotkeys and Hide from capture belong to the item, not the game layout.
- Moving a general item in the in-game layer writes the same per-game override as moving it on the canvas.

`GameOverlayStore` keeps shared positions on the original items and game-specific positions in `game-overlays.json` under `layout.games`. The existing version-3 base positions remain readable by older versions; older versions do not understand or preserve the per-game overrides. Removing an item prunes its overrides; removing a game removes its layout. Undo restores inheritance as well as coordinates.

## Canvas and capture

`OverlayLayout` owns selection, drag previews, undo and messages. `GameOverlays.layout` resolves positions for the controller; the runtime uses the same resolved positions for overlays, interactive panels and panel live views.

`LayoutCanvas` keeps temporary rectangles in a shallow ref so Vue does not turn them into proxies that Electron IPC cannot clone. A drop must reach the main process before Reset position or undo can work reliably.

When menus cover the canvas, `OverlayLayoutWindow` captures the native pages and the input layer. The shell decodes and displays the stills before acknowledging that the native views can step aside. A generation counter prevents a slow capture from hiding views after a menu closes.

Take picture requires both a running-game report and a window handle observed since launch. Changes to either refresh the layout. A disabled button distinguishes a stopped game from a running game whose window has not been seen. Capture is click-only and remains disabled in hidden test apps; the public security guide describes the capture boundary.

## Checks

- Unit coverage: `game-overlays.test.ts`, `game-overlay-service.test.ts`, `overlay-layout.test.ts` and `layout-view.test.ts`.
- Electron coverage: `pnpm --filter @tavora/desktop exec playwright test overlay-layout.spec.ts` exercises shared/per-game controls, opacity stills, mouse dragging/resizing, reset buttons and Done.
- Real-game screenshot capture still needs a live-game check; hidden Electron tests cannot verify it.
