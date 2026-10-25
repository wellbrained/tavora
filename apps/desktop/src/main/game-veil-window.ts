// The veil of the in-game layer: a frameless Tavora window over the game window, black at about 30 % opacity, that
// takes clicks and does nothing with them, so the game under it isn't played by accident while the player arranges
// overlays and works in panels. It shows no page and loads nothing, never takes the keyboard (the game keeps it until
// a panel asks), and is visible to screen capture like the overlays. Nothing is injected into the game.
import { BrowserWindow, app } from "electron";
import type { Rect } from "./game-overlays";

/** How dark the veil is. */
export const VEIL_OPACITY = 0.3;

/** What the service needs of the veil (a test stands in for Electron). */
export interface VeilWindow {
  /** Puts the veil over `rect` (screen coordinates, in DIPs) and shows it, above the game. */
  place(rect: Rect): void;
  destroy(): void;
}

export class GameVeilWindow implements VeilWindow {
  private readonly window: BrowserWindow;
  private destroyed = false;
  private quitting = false;
  private readonly onQuit = () => {
    this.quitting = true;
  };

  constructor(private readonly options: { hidden: boolean }) {
    this.window = new BrowserWindow({
      show: false,
      frame: false,
      backgroundColor: "#000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false },
    });
    this.window.removeMenu();
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setOpacity(options.hidden ? 0 : VEIL_OPACITY);
    // Nothing for the player to close: only the layer (or quitting) ends it.
    this.window.on("close", (event) => {
      if (!this.destroyed && !this.quitting) event.preventDefault();
    });
    app.on("before-quit", this.onQuit);
    this.window.once("closed", () => {
      this.destroyed = true;
      app.removeListener("before-quit", this.onQuit);
    });
    this.window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  place(rect: Rect): void {
    if (this.destroyed || this.window.isDestroyed()) return;
    const now = this.window.getBounds();
    if (now.x !== rect.x || now.y !== rect.y || now.width !== rect.width || now.height !== rect.height) this.window.setBounds(rect);
    if (!this.window.isVisible()) {
      this.window.showInactive();
      this.window.setAlwaysOnTop(true, "screen-saver");
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    app.removeListener("before-quit", this.onQuit);
    if (!this.window.isDestroyed()) {
      if (!this.window.webContents.isDestroyed()) this.window.webContents.close();
      this.window.destroy();
    }
  }
}
