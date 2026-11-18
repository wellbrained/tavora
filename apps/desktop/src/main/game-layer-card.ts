// The card at the top of the in-game layer: Tavora's mark, "Overlay", Use | Arrange and Close with the layer key. It is
// Tavora's own UI, drawn with the kit by a small page of the host UI (layer-card.html, renderer/components/LayerCard.vue)
// in a frameless window of its own above the layer, at the top centre of the layer's area (the game window, or the
// screen for Everywhere).
//   - It is served from Tavora's own address, in the host's session (which reaches nothing else), with a preload of six
//     calls (preload/layer-card.ts). It has no bridge: no module reaches it, and it shows nothing a module gave.
//   - The window is only as big as the card plus room for its shadow and its tooltips. It lets clicks through except
//     while the pointer is over the card itself, so the room below never covers a panel.
//   - Like the veil it is visible to screen capture, and the user can't close it: the layer (Close, its key, Esc) does.
import { app, BrowserWindow, type IpcMainEvent } from "electron";
import { DEFAULT_THEME_FONT, type TavoraTheme } from "@tavora/sdk/protocol";
import { cleanExtent } from "../shared/host-toasts";
import { cardWindowRect, isLayerMode, type LayerCardContent, type LayerCardState, type LayerMode } from "../shared/layer-card";
import type { Rect } from "./game-overlays";

/** What the service asks of the card (a test stands in for Electron). */
export interface LayerCard {
  /** Puts the card over `area` (screen coordinates, in DIPs) with this content; it shows once the page has measured it. */
  show(area: Rect, content: LayerCardContent): void;
  /** Above the layer's other windows. */
  raise(): void;
  /** Whether the card has the keyboard (the user clicked or tabbed into it). */
  readonly focused: boolean;
  /** The theme or the language changed. */
  refresh(): void;
  destroy(): void;
}

/** What the card tells the service. */
export interface LayerCardRequest {
  setMode(mode: LayerMode): void;
  close(): void;
}

export interface GameLayerCardOptions extends LayerCardRequest {
  /** The card page's preload (preload/layer-card.cjs). */
  preload: string;
  /** The address of layer-card.html. */
  address: string;
  /** Test runs: the window stays invisible. */
  hidden: boolean;
  devTools: boolean;
  theme(): TavoraTheme;
  language(): string;
}

export class GameLayerCard implements LayerCard {
  private readonly window: BrowserWindow;
  private destroyed = false;
  private quitting = false;
  private ready = false;
  private area: Rect | null = null;
  private content: LayerCardContent | null = null;
  private extent: { width: number; height: number } | null = null;
  private readonly onQuit = () => {
    this.quitting = true;
  };

  constructor(private readonly options: GameLayerCardOptions) {
    const window = (this.window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: options.devTools },
    }));
    window.removeMenu();
    window.setAlwaysOnTop(true, "screen-saver");
    // Clicks go through until the pointer is over the card (hover); the moves still reach the page, so it can tell.
    window.setIgnoreMouseEvents(true, { forward: true });
    if (options.hidden) window.setOpacity(0);
    // Nothing for the user to close (Alt+F4 while it has the keyboard): the layer ends it.
    window.on("close", (event) => {
      if (!this.destroyed && !this.quitting) event.preventDefault();
    });
    app.on("before-quit", this.onQuit);
    window.once("closed", () => {
      this.destroyed = true;
      app.removeListener("before-quit", this.onQuit);
    });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    // A page that died leaves no window in the way; the layer's key and Esc still close the layer.
    contents.on("render-process-gone", () => {
      this.ready = false;
      if (!this.destroyed && !window.isDestroyed()) window.hide();
    });
    contents.ipc.on("layer-card:ready", (event) => {
      if (!this.fromPage(event)) return;
      this.ready = true;
      this.send();
    });
    contents.ipc.on("layer-card:extent", (event, raw) => {
      const extent = this.fromPage(event) && cleanExtent(raw);
      if (!extent || extent.width < 1 || extent.height < 1) return;
      this.extent = extent;
      this.place();
    });
    contents.ipc.on("layer-card:hover", (event, over) => {
      if (!this.fromPage(event) || window.isDestroyed()) return;
      if (over === true) window.setIgnoreMouseEvents(false);
      else window.setIgnoreMouseEvents(true, { forward: true });
    });
    contents.ipc.on("layer-card:mode", (event, mode) => {
      if (this.fromPage(event) && isLayerMode(mode)) options.setMode(mode);
    });
    contents.ipc.on("layer-card:close", (event) => {
      if (this.fromPage(event)) options.close();
    });
    void contents.loadURL(options.address).catch((error: unknown) => console.error("[tavora] the layer card did not load", error));
  }

  get focused(): boolean {
    return !this.destroyed && !this.window.isDestroyed() && this.window.isFocused();
  }

  show(area: Rect, content: LayerCardContent): void {
    this.area = area;
    const changed = JSON.stringify(content) !== JSON.stringify(this.content);
    this.content = content;
    if (changed) this.send();
    this.place();
  }

  raise(): void {
    if (!this.destroyed && !this.window.isDestroyed() && this.window.isVisible()) this.window.moveTop();
  }

  refresh(): void {
    this.send();
  }

  /** Over the area's top centre, sized to the card, once the page has measured it; shown then, without taking the keyboard. */
  private place(): void {
    const window = this.window;
    if (this.destroyed || window.isDestroyed() || !this.area || !this.extent) return;
    const rect = cardWindowRect(this.area, this.extent);
    const now = window.getBounds();
    if (now.x !== rect.x || now.y !== rect.y || now.width !== rect.width || now.height !== rect.height) window.setBounds(rect);
    if (!window.isVisible()) {
      window.showInactive();
      window.setAlwaysOnTop(true, "screen-saver");
    }
  }

  private state(): LayerCardState | null {
    if (!this.content) return null;
    const theme = this.options.theme();
    return {
      ...this.content,
      scheme: theme.mode,
      colors: theme.tokens,
      radius: theme.radius,
      font: theme.font?.family ?? DEFAULT_THEME_FONT.family,
      language: this.options.language(),
    };
  }

  private send(): void {
    const state = this.state();
    if (!state || !this.ready || this.destroyed || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send("layer-card:state", state);
  }

  /** Only the card page's own top frame may speak for it. */
  private fromPage(event: IpcMainEvent): boolean {
    return !this.destroyed && event.senderFrame?.parent === null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    app.removeListener("before-quit", this.onQuit);
    const window = this.window;
    if (!window.isDestroyed()) {
      if (!window.webContents.isDestroyed()) window.webContents.close();
      window.destroy();
    }
  }
}
