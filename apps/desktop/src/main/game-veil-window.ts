// The veil of the in-game layer: a frameless Tavora window over the game window, black at about 30 % opacity, that
// takes clicks and does nothing with them, so the game under it isn't played by accident while the player arranges
// overlays and works in panels. It loads one tiny page of its own (no files, no network, no bridge) that paints the
// veil only while Tavora's main process keeps telling it so (a beat every BEAT_MS); with no beat for EXPIRE_MS the
// page turns fully transparent, so a Tavora that stopped responding doesn't leave the game under a dark sheet.
// If the page itself dies, the window is made click-through at once. It never takes the keyboard (the game keeps it
// until a panel asks), and is visible to screen capture like the overlays. Nothing is injected into the game.
//
// Limit: the veil stops mouse clicks as a window does. A game that reads the mouse straight from the device (raw
// input) can still see them. And a main process that is truly hung can't change its window: Windows alone decides
// what a click on an unresponsive window does, so the veil can only go transparent, not click-through, then.
import { BrowserWindow, app } from "electron";
import type { Rect } from "./game-overlays";

/** How dark the veil is. */
export const VEIL_OPACITY = 0.3;
/** How often the main process tells the page it is alive, and how long the page waits for a beat before it gives up. */
export const BEAT_MS = 500;
export const EXPIRE_MS = 2000;

/** The veil's page: transparent until a beat arrives, transparent again EXPIRE_MS after the last one. */
export const VEIL_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><body style="margin:0;background:transparent;overflow:hidden"><script>
var seen = 0;
function paint() { document.body.style.background = Date.now() - seen < ${EXPIRE_MS} ? "rgba(0,0,0,${VEIL_OPACITY})" : "transparent"; }
window.__beat = function () { seen = Date.now(); paint(); };
setInterval(paint, 250);
</script>`;

/** What the service needs of the veil (a test stands in for Electron). */
export interface VeilWindow {
  /** Puts the veil over `rect` (screen coordinates, in DIPs) and shows it, above the game. */
  place(rect: Rect): void;
  destroy(): void;
}

export class GameVeilWindow implements VeilWindow {
  /** Null in test runs (hidden): no veil is ever made or shown there. */
  private readonly window: BrowserWindow | null;
  private destroyed = false;
  private quitting = false;
  private beat: ReturnType<typeof setInterval> | undefined;
  private readonly onQuit = () => {
    this.quitting = true;
  };

  constructor(options: { hidden: boolean }) {
    if (options.hidden) {
      this.window = null;
      return;
    }
    const window = (this.window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
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
    }));
    window.removeMenu();
    window.setAlwaysOnTop(true, "screen-saver");
    // Nothing for the player to close: only the layer (or quitting) ends it.
    window.on("close", (event) => {
      if (!this.destroyed && !this.quitting) event.preventDefault();
    });
    app.on("before-quit", this.onQuit);
    window.once("closed", () => {
      this.destroyed = true;
      clearInterval(this.beat);
      app.removeListener("before-quit", this.onQuit);
    });
    const contents = window.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    // A page that died or hangs can't take the veil down by itself: the window stops taking clicks.
    const passThrough = () => {
      if (!window.isDestroyed()) window.setIgnoreMouseEvents(true);
    };
    contents.on("render-process-gone", passThrough);
    contents.on("unresponsive", passThrough);
    void contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(VEIL_PAGE)}`).catch(() => passThrough());
    const tell = () => {
      if (!this.destroyed && !contents.isDestroyed() && !contents.isLoading()) void contents.executeJavaScript("window.__beat && window.__beat()").catch(() => {});
    };
    contents.once("did-finish-load", tell);
    this.beat = setInterval(tell, BEAT_MS);
    this.beat.unref?.();
  }

  place(rect: Rect): void {
    const window = this.window;
    if (!window || this.destroyed || window.isDestroyed()) return;
    const now = window.getBounds();
    if (now.x !== rect.x || now.y !== rect.y || now.width !== rect.width || now.height !== rect.height) window.setBounds(rect);
    if (!window.isVisible()) {
      window.showInactive();
      window.setAlwaysOnTop(true, "screen-saver");
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.beat);
    app.removeListener("before-quit", this.onQuit);
    const window = this.window;
    if (window && !window.isDestroyed()) {
      if (!window.webContents.isDestroyed()) window.webContents.close();
      window.destroy();
    }
  }
}
