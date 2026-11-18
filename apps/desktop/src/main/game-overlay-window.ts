// The window one game overlay lives in: a frameless, transparent Tavora window above the game that never takes the
// keyboard or the mouse (clicks go through to the game), loading the module's overlay page from game-overlay-page.ts.
// Nothing is injected into the game or drawn by it. The page has no bridge and no preload, its session can reach only
// its own address, and the window is visible to screen capture unless the user turned "Hide from capture" on (some anti-cheats flag windows hidden from capture over a game). While
// the in-game layer is in Arrange a second view of Tavora's own, with an outline, edges and a close button, sits on top
// and the window takes the mouse, but still never the keyboard.
//
// The same window also holds a whole panel the user shows in their game (`panel`), while the in-game layer is open.
// It is the panel's own view, moved here from the workspace and moved back when the window goes; nothing about the
// panel changes. In Use the window is exactly the panel's place and takes the mouse and the keyboard, with no frame. In
// Arrange it grows by the frame's room around the panel, and the frame lies over the panel too: a drag never reaches
// the panel's content, the keys stay with the frame, and the panel shows dimmed under it.
import { BrowserWindow, WebContentsView, app, screen, session, type Session, type WebContents } from "electron";
import { createHash } from "node:crypto";
import { GAME_OVERLAY_SCHEME } from "./assets";
import { dragRect, panelBounds, panelWindowRect, type Opacity, type Rect, type WindowMode } from "./game-overlays";
import { GAME_OVERLAY_FRAME_URL, GAME_OVERLAY_ORIGIN, serveGameOverlay, type GameOverlaySource } from "./game-overlay-page";
import { GAME_OVERLAY_FRAME_DOCUMENT } from "../shared/game-overlay-frame";
import { InsertedCss } from "./inserted-css";

/** What the window needs of a panel it holds (implemented by ModuleView). */
export interface OverlayPanel {
  readonly view: WebContentsView;
  /** The panel is over the game now; its clicks and keys count as the user's only while `layerOpen()` says so. */
  enterGame(layerOpen: () => boolean): void;
  /** The panel is in its workspace slot again. */
  leaveGame(): void;
  setBounds(rect: Rect): void;
  setVisible(visible: boolean): void;
  setGameOpacity(opacity: Opacity): void;
  /** Content scales with the game window's height while the panel is over the game (1 is its natural size). */
  setGameZoom(factor: number): void;
  suspend(): void;
  resume(): void;
}

export interface GameOverlayWindowOptions {
  /** Tavora's preload for the arrange frame. */
  preload: string;
  /** Test runs: the window stays invisible. */
  hidden: boolean;
  source: GameOverlaySource;
  /** Names the overlay; its sessions are named after it, so a window made again (after a crash) reuses them. */
  id: string;
  /** The game window's client area now, to keep drags inside it. */
  gameBounds(): Rect | null;
  /** The user dragged or resized the window; where it is now. */
  moved(rect: Rect): void;
  /** The user pressed the frame's close button. */
  closeRequested(): void;
  /** The user pressed the frame's Overlay layout button. */
  layoutRequested(): void;
  /** The window or its page is gone (the page crashed). */
  ended(): void;
  /** The window got the keyboard (a panel clicked or given the keyboard): it may have come above the layer's card. */
  activated?: (() => void) | undefined;
  /** The name and the close button's label the frame shows. */
  frameText(): { name: string; closeLabel: string; layoutLabel: string };
  /** The interface font's stylesheet for the frame (module-fonts.ts). */
  fontCss?(): string;
  /** A panel to hold instead of an overlay page (lent by Panel views, which takes it back when GameOverlays returns the loan). */
  panel?: OverlayPanel;
}

type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

function edgesOf(edge: unknown): Edges | null {
  if (typeof edge !== "string" || !/^[lrtb]{1,2}$/.test(edge)) return null;
  return { left: edge.includes("l"), right: edge.includes("r"), top: edge.includes("t"), bottom: edge.includes("b") };
}

/** A session that can reach nothing but the overlay's own address. */
export function lockedSession(partition: string, allowed: (url: string) => boolean): Session {
  const ses = session.fromPartition(partition);
  // The same session comes back when a window is made again for the same overlay; its handlers are replaced.
  if (ses.protocol.isProtocolHandled(GAME_OVERLAY_SCHEME)) ses.protocol.unhandle(GAME_OVERLAY_SCHEME);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));
  // Belt and braces: anything that bypasses webRequest still has to go through a proxy that does not exist.
  void ses.setProxy({ mode: "fixed_servers", proxyRules: "http://127.0.0.1:9", proxyBypassRules: "<-loopback>" });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setSpellCheckerEnabled(false);
  ses.on("will-download", (event) => event.preventDefault());
  return ses;
}

/**
 * What every view showing an overlay page, or Tavora's own page around one, gets: no new windows, no navigating away,
 * and WebRTC only through a proxy. The locked session's proxy does not exist, so no WebRTC UDP gets out either, which
 * webRequest and the CSP would not see (G4). A module panel gets the same in module-view.ts.
 */
export function lockContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
}

export class GameOverlayWindow {
  private readonly window: BrowserWindow;
  private readonly frame: WebContentsView;
  private opacityCss: string | undefined;
  private opacity: Opacity = 100;
  private zoom = 1;
  /** `off`: click-through, no frame. `use`: a panel takes input, no frame. `arrange`: the frame, to move and resize. */
  private mode: WindowMode = "off";
  private drag: { rect: Rect; cursor: { x: number; y: number }; edges: Edges | null } | null = null;
  /** The item's place as last given (setRect); a panel's window may be bigger, with the arrange frame around it. */
  private place: Rect | null = null;
  private destroyed = false;
  /** Tavora is quitting: the window may close then (an app quit closes every window and must not be held up). */
  private quitting = false;
  private readonly onQuit = () => {
    this.quitting = true;
  };

  /** The interface font in the frame, swapped when the user picks another. */
  private readonly frameFont = new InsertedCss(() => this.frame.webContents);

  constructor(private readonly options: GameOverlayWindowOptions) {
    // No "persist:" prefix: nothing of the page is kept on disk. Each overlay has a session of its own, kept for as long
    // as Tavora runs, so a page that keeps crashing doesn't leave a new session behind every time.
    const name = createHash("sha256").update(options.id).digest("hex").slice(0, 32);
    const partition = `game-overlay-${name}`;
    const ses = lockedSession(partition, (url) => url.startsWith(`${GAME_OVERLAY_ORIGIN}/`));
    if (!options.panel) ses.protocol.handle(GAME_OVERLAY_SCHEME, (request) => serveGameOverlay(request, options.source));

    this.window = new BrowserWindow({
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
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false },
    });
    const window = this.window;
    window.removeMenu();
    // Above full-screen windows too; the lowest level that is.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true);
    // Visible to screen capture; setHideFromCapture hides it when the user asks.
    if (options.hidden) window.setOpacity(0);
    const contents = window.webContents;
    lockContents(contents);
    contents.on("did-finish-load", () => {
      void this.applyOpacity();
      // The page keeps the zoom it was given, but a load may reset it.
      if (!this.options.panel && !contents.isDestroyed() && contents.getZoomFactor() !== this.zoom) contents.setZoomFactor(this.zoom);
    });
    contents.once("render-process-gone", () => this.end());
    // A window holding a panel is never closed by the user (Alt+F4 while it has the keyboard): that would strand the panel.
    // Closing the layer (or Stop showing in game) is how it leaves. Tavora's own destroy() does not go through this.
    window.on("close", (event) => {
      if (options.panel && !this.destroyed && !this.quitting) event.preventDefault();
    });
    app.on("before-quit", this.onQuit);
    window.on("focus", () => this.options.activated?.());
    window.once("closed", () => {
      app.removeListener("before-quit", this.onQuit);
      const unexpected = !this.destroyed;
      this.destroyed = true;
      // Closed by something other than destroy(): let go of the panel and tell the service, so no dead entry stays.
      if (unexpected) {
        this.release();
        if (!this.frame.webContents.isDestroyed()) this.frame.webContents.close();
        this.options.ended();
      }
    });
    // A panel brings its own page; this window only holds it.
    if (!options.panel) void contents.loadURL(GAME_OVERLAY_FRAME_URL).catch(() => this.end());

    const frameSession = lockedSession(`game-overlay-frame-${name}`, (url) => url.startsWith("data:"));
    this.frame = new WebContentsView({
      webPreferences: { session: frameSession, preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false },
    });
    this.frame.setBackgroundColor("#00000000");
    this.frame.setVisible(false);
    // The frame goes above the panel: hidden in Use, and in Arrange it covers the panel, so a drag never ticks a box.
    if (options.panel) {
      options.panel.setVisible(true);
      window.contentView.addChildView(options.panel.view);
      options.panel.enterGame(() => this.mode !== "off");
      options.panel.suspend();
    }
    window.contentView.addChildView(this.frame);
    const frame = this.frame.webContents;
    lockContents(frame);
    frame.on("did-finish-load", () => {
      this.sendFrameText();
      this.frameFont.forget();
      this.refreshFont();
    });
    void frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GAME_OVERLAY_FRAME_DOCUMENT)}`).catch(() => {});
    frame.ipc.on("game-overlay:close", () => this.mode === "arrange" && options.closeRequested());
    frame.ipc.on("game-overlay:layout", () => this.mode === "arrange" && options.layoutRequested());
    frame.ipc.on("game-overlay:drag", (_event, phase: unknown, edge: unknown) => this.onDrag(phase, edge));
  }

  /** Puts the interface font the user has now into the frame; the same font again changes nothing. */
  refreshFont(): void {
    const css = this.options.fontCss?.();
    if (css && !this.frame.webContents.isDestroyed()) void this.frameFont.replace(css);
  }

  private end(): void {
    if (this.destroyed) return;
    this.options.ended();
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed();
  }

  /** The user is dragging or resizing it now. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  private sendFrameText(): void {
    if (this.isDestroyed || this.frame.webContents.isDestroyed()) return;
    const { name, closeLabel, layoutLabel } = this.options.frameText();
    this.frame.webContents.send("game-overlay:frame", name, closeLabel, layoutLabel);
  }

  /** Puts the item at `rect` (screen coordinates, in DIPs); in Arrange a panel's window takes the frame's room around it. */
  setRect(place: Rect): void {
    if (this.isDestroyed) return;
    this.place = place;
    const rect = this.options.panel ? panelWindowRect(place, this.options.gameBounds(), this.mode === "arrange") : place;
    const now = this.window.getBounds();
    if (now.x === rect.x && now.y === rect.y && now.width === rect.width && now.height === rect.height) return;
    this.window.setBounds(rect);
    this.frame.setBounds({ x: 0, y: 0, width: rect.width, height: rect.height });
    this.placePanel();
  }

  private placePanel(): void {
    if (!this.options.panel) return;
    const { width, height } = this.window.getContentBounds();
    this.options.panel.setBounds(panelBounds({ width, height }, this.mode === "arrange"));
  }

  /** Whether this window has the keyboard (only a panel's window ever takes it, while the layer is open). */
  get focused(): boolean {
    return !this.isDestroyed && this.window.isFocused();
  }

  setShown(shown: boolean): void {
    if (this.isDestroyed || this.window.isVisible() === shown) return;
    if (shown) {
      this.window.showInactive();
      // The system may have put it under the game's window; ask again each time it comes back.
      this.window.setAlwaysOnTop(true, "screen-saver");
      this.options.panel?.resume();
    } else {
      this.window.hide();
      this.options.panel?.suspend();
    }
  }

  /** Puts the window above the other windows of its level (the veil is shown first, and everything above it is raised after). */
  raise(): void {
    if (!this.isDestroyed) this.window.moveTop();
  }

  /** Gives the keyboard to the panel (the service does so for one panel window only), in Use. */
  focusPanel(): void {
    const panel = this.options.panel;
    if (!panel || this.isDestroyed || this.mode !== "use") return;
    this.window.focus();
    panel.view.webContents.focus();
  }

  /** The window's part in the layer (see `mode`). */
  get layerMode(): WindowMode {
    return this.mode;
  }

  /**
   * What the window does in the layer. An overlay takes the mouse and shows its frame only in `arrange`. A panel takes the
   * mouse in `use` and `arrange`, and the keyboard only in `use`, so its text fields can be typed in; in `arrange` the
   * frame covers it. The keyboard is given with focusPanel.
   */
  setMode(mode: WindowMode): void {
    if (this.isDestroyed || this.mode === mode) return;
    this.mode = mode;
    this.drag = null;
    const panel = this.options.panel;
    this.window.setIgnoreMouseEvents(mode === "off" || (!panel && mode === "use"));
    this.frame.setVisible(mode === "arrange");
    if (mode === "arrange") this.sendFrameText();
    if (!panel) return;
    // Keys the panel had go to the frame, which does nothing with them; the window keeps the keyboard, so the layer stays.
    if (mode === "arrange" && !panel.view.webContents.isDestroyed() && panel.view.webContents.isFocused()) this.frame.webContents.focus();
    this.window.setFocusable(mode === "use");
    // The window grows by the frame's room, or gives it back.
    if (this.place) this.setRect(this.place);
    this.placePanel();
  }

  /** Only with this on is the window hidden from screen capture. */
  setHideFromCapture(hide: boolean): void {
    if (!this.isDestroyed) this.window.setContentProtection(hide);
  }

  setOpacity(opacity: Opacity): void {
    this.opacity = opacity;
    if (this.options.panel) this.options.panel.setGameOpacity(opacity);
    else void this.applyOpacity();
  }

  /**
   * Scales the page with the game window's height (contentScale): the page's own zoom for an overlay page, which has a
   * session of its own; a style on the page for a panel, whose session is shared with the module's other panels.
   */
  setZoom(factor: number): void {
    this.zoom = factor;
    if (this.options.panel) return this.options.panel.setGameZoom(factor);
    if (!this.isDestroyed && !this.window.webContents.isDestroyed()) this.window.webContents.setZoomFactor(factor);
  }

  /** Fades the page by a style of Tavora's own, so the frame on top stays clear. */
  private async applyOpacity(): Promise<void> {
    if (this.isDestroyed) return;
    const contents = this.window.webContents;
    try {
      if (this.opacityCss) await contents.removeInsertedCSS(this.opacityCss);
      this.opacityCss = this.opacity === 100 ? undefined : await contents.insertCSS(`html{opacity:${this.opacity / 100} !important}`, { cssOrigin: "user" });
    } catch {
      // The page went away while the style was being set; the next load sets it again.
    }
  }

  private onDrag(phase: unknown, edge: unknown): void {
    if (this.isDestroyed || this.mode !== "arrange") return;
    if (phase === "start") {
      this.drag = { rect: this.place ?? this.window.getBounds(), cursor: screen.getCursorScreenPoint(), edges: edgesOf(edge) };
      return;
    }
    const drag = this.drag;
    const game = this.options.gameBounds();
    if (!drag || !game) return;
    const cursor = screen.getCursorScreenPoint();
    const next = dragRect(drag.rect, game, drag.edges, cursor.x - drag.cursor.x, cursor.y - drag.cursor.y);
    this.setRect(next);
    if (phase === "end") {
      this.drag = null;
      this.options.moved(next);
    }
  }

  /** The panel is let go, not closed: its page goes on running wherever the host puts it. It closes only when the panel itself does. */
  private release(): void {
    const panel = this.options.panel;
    if (!panel) return;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(panel.view);
    panel.leaveGame();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    app.removeListener("before-quit", this.onQuit);
    this.release();
    // Close the pages' processes too, as the other views do; destroying the window alone can leave them running.
    if (!this.frame.webContents.isDestroyed()) this.frame.webContents.close();
    if (!this.window.isDestroyed()) {
      if (!this.window.webContents.isDestroyed()) this.window.webContents.close();
      this.window.destroy();
    }
  }
}
