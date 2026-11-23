// The in-game layer's platform on Electron and Windows: the screen, the keyboard, the window in front (foreground.ts),
// and the windows LayerWindows drives (game-layer-windows.ts): an overlay's or a panel's window, the veil and the card,
// stacked in Windows' order of windows when the user is elsewhere (window-order.ts). Only Tavora's own windows: nothing
// here reads, opens or injects into a game's process. Tests stand in for all of it (game-overlay-service.test.ts).
import { BrowserWindow, globalShortcut, screen } from "electron";
import path from "node:path";
import type { Language } from "../shared/i18n";
import type { TavoraTheme } from "@tavora/sdk/protocol";
import { HOST_SCHEME } from "./assets";
import { windowsForegroundProbe } from "./foreground";
import { GameLayerCard } from "./game-layer-card";
import type { OverlayWindowRequest } from "./game-layer-windows";
import type { OverlayPlatform } from "./game-overlay-service";
import { GameOverlayWindow, type OverlayPanel } from "./game-overlay-window";
import { STAND_IN_TITLE, standInProbe } from "./game-stand-in";
import { GameVeilWindow } from "./game-veil-window";
import { stackAbove, windowsOrder } from "./window-order";

/** Stacking the overlays above the game failed (Windows' calls couldn't be loaded): said once only. */
let stackFailed = false;

export interface ElectronLayerOptions {
  /** Test runs: the windows stay invisible. */
  hidden: boolean;
  devServer?: string | undefined;
  devTools: boolean;
  /** The host UI's preload (the card has its own next to it) and the module preload (the frames' preload is next to it). */
  hostPreload: string;
  modulePreload: string;
  /** The theme and language Tavora's own UI is drawn in now (the card). */
  theme(): TavoraTheme;
  language(): Language;
  /** The interface font's stylesheet for Tavora's own overlay chrome (module-fonts.ts). */
  fontCss?: (() => string) | undefined;
  /** Tests only: a window of the test's own stands in for the game in front (game-stand-in.ts), in place of Windows' look. */
  standIn?: boolean | undefined;
}

export function electronLayerPlatform(options: ElectronLayerOptions): OverlayPlatform {
  return {
    supported: process.platform === "win32",
    probe: () => (options.standIn ? standInProbe(() => BrowserWindow.getAllWindows(), (rect) => screen.dipToScreenRect(null, rect)) : windowsForegroundProbe()),
    // Windows reports pixels; windows are placed in DIPs.
    toDip: (rect) => screen.screenToDipRect(null, rect),
    screen: () => screen.getPrimaryDisplay().bounds,
    // Any of Tavora's windows with the keyboard; the service tells its own overlay windows apart.
    // (The test's stand-in for a game is no window of Tavora's.)
    tavoraInFront: () => {
      const focused = BrowserWindow.getFocusedWindow();
      return focused !== null && !(options.standIn && focused.getTitle() === STAND_IN_TITLE);
    },
    openWindow: (request, panel) => overlayWindow(options, request, panel),
    openVeil: () => new GameVeilWindow({ hidden: options.hidden }),
    // Overlays that stay while the user is elsewhere sit right above the game's window, not above every window.
    stackAboveGame: (game, windows) => {
      if (process.platform !== "win32") return false;
      try {
        stackAbove(windowsOrder(), game, windows);
        return true;
      } catch (error) {
        // Said once: the service then keeps them above every window, as before, and tries again on each look.
        if (!stackFailed) console.warn("[tavora] cannot stack the overlays above the game", error);
        stackFailed = true;
        return false;
      }
    },
    gameOnTop: (game) => {
      if (process.platform !== "win32") return false;
      try {
        return windowsOrder().topmost(game);
      } catch {
        return false;
      }
    },
    // The card is a page of the host UI (layer-card.html), with a preload of its own.
    openCard: (request) =>
      new GameLayerCard({
        ...request,
        preload: path.join(path.dirname(options.hostPreload), "layer-card.cjs"),
        address: options.devServer ? new URL("layer-card.html", options.devServer).href : `${HOST_SCHEME}://app/layer-card.html`,
        hidden: options.hidden,
        devTools: options.devTools,
        theme: options.theme,
        language: options.language,
      }),
    shortcuts: globalShortcut,
  };
}

/** The window for an overlay's page, or (with `panel`) for a panel over its game: the panel's own view goes into it, and no copy is made. */
function overlayWindow(options: ElectronLayerOptions, request: OverlayWindowRequest, panel?: OverlayPanel): GameOverlayWindow {
  return new GameOverlayWindow({
    preload: path.join(path.dirname(options.modulePreload), "game-overlay.cjs"),
    hidden: options.hidden,
    id: request.id,
    source: { page: request.page, state: request.state, watch: request.watch },
    gameBounds: request.gameBounds,
    moved: request.moved,
    closeRequested: request.closeRequested,
    layoutRequested: request.layoutRequested,
    ended: request.ended,
    activated: request.activated,
    frameText: request.frameText,
    // The frame is Tavora's own chrome, in the font the user picked.
    ...(options.fontCss ? { fontCss: options.fontCss } : {}),
    ...(panel ? { panel } : {}),
  });
}
