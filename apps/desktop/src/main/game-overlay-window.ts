// The window one game overlay lives in: a frameless, transparent Tavora window above the game that never takes the
// keyboard or the mouse (clicks go through to the game), loading the module's overlay page from game-overlay-page.ts.
// Nothing is injected into the game or drawn by it. The page has no bridge and no preload, its session can reach only
// its own address, and the window is visible to screen capture unless the player turned "Hide from capture" on (some anti-cheats flag windows hidden from capture over a game). While
// the player arranges overlays a second view of Tavora's own, with an outline, edges and a close button, sits on top
// and the window takes the mouse, but still never the keyboard.
import { BrowserWindow, WebContentsView, screen, session, type Session } from "electron";
import { createHash } from "node:crypto";
import { GAME_OVERLAY_SCHEME } from "./assets";
import { dragRect, type Opacity, type Rect } from "./game-overlays";
import { GAME_OVERLAY_ORIGIN, serveGameOverlay, type GameOverlaySource } from "./game-overlay-page";
import { GAME_OVERLAY_FRAME_DOCUMENT } from "../shared/game-overlay-frame";

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
  /** The player dragged or resized the window; where it is now. */
  moved(rect: Rect): void;
  /** The player pressed the frame's close button. */
  closeRequested(): void;
  /** The window or its page is gone (the page crashed). */
  ended(): void;
  /** The name and the close button's label the frame shows. */
  frameText(): { name: string; closeLabel: string };
}

type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };

function edgesOf(edge: unknown): Edges | null {
  if (typeof edge !== "string" || !/^[lrtb]{1,2}$/.test(edge)) return null;
  return { left: edge.includes("l"), right: edge.includes("r"), top: edge.includes("t"), bottom: edge.includes("b") };
}

/** A session that can reach nothing but the overlay's own address. */
function lockedSession(partition: string, allowed: (url: string) => boolean): Session {
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

export class GameOverlayWindow {
  private readonly window: BrowserWindow;
  private readonly frame: WebContentsView;
  private opacityCss: string | undefined;
  private opacity: Opacity = 100;
  private arranging = false;
  private drag: { rect: Rect; cursor: { x: number; y: number }; edges: Edges | null } | null = null;
  private destroyed = false;

  constructor(private readonly options: GameOverlayWindowOptions) {
    // No "persist:" prefix: nothing of the page is kept on disk. Each overlay has a session of its own, kept for as long
    // as Tavora runs, so a page that keeps crashing doesn't leave a new session behind every time.
    const name = createHash("sha256").update(options.id).digest("hex").slice(0, 32);
    const partition = `game-overlay-${name}`;
    const ses = lockedSession(partition, (url) => url.startsWith(`${GAME_OVERLAY_ORIGIN}/`));
    ses.protocol.handle(GAME_OVERLAY_SCHEME, (request) => serveGameOverlay(request, options.source));

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
    // Visible to screen capture; setHideFromCapture hides it when the player asks.
    if (options.hidden) window.setOpacity(0);
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("did-finish-load", () => void this.applyOpacity());
    contents.once("render-process-gone", () => this.end());
    window.once("closed", () => {
      this.destroyed = true;
    });
    void contents.loadURL(`${GAME_OVERLAY_ORIGIN}/`).catch(() => this.end());

    const frameSession = lockedSession(`game-overlay-frame-${name}`, (url) => url.startsWith("data:"));
    this.frame = new WebContentsView({
      webPreferences: { session: frameSession, preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false },
    });
    this.frame.setBackgroundColor("#00000000");
    this.frame.setVisible(false);
    window.contentView.addChildView(this.frame);
    const frame = this.frame.webContents;
    frame.setWindowOpenHandler(() => ({ action: "deny" }));
    frame.on("will-navigate", (event) => event.preventDefault());
    frame.on("did-finish-load", () => this.sendFrameText());
    void frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GAME_OVERLAY_FRAME_DOCUMENT)}`).catch(() => {});
    frame.ipc.on("game-overlay:close", () => this.arranging && options.closeRequested());
    frame.ipc.on("game-overlay:drag", (_event, phase: unknown, edge: unknown) => this.onDrag(phase, edge));
  }

  private end(): void {
    if (this.destroyed) return;
    this.options.ended();
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed();
  }

  /** The player is dragging or resizing it now. */
  get dragging(): boolean {
    return this.drag !== null;
  }

  private sendFrameText(): void {
    if (this.isDestroyed || this.frame.webContents.isDestroyed()) return;
    const { name, closeLabel } = this.options.frameText();
    this.frame.webContents.send("game-overlay:frame", name, closeLabel);
  }

  /** Puts the window at `rect` (screen coordinates, in DIPs). */
  setRect(rect: Rect): void {
    if (this.isDestroyed) return;
    const now = this.window.getBounds();
    if (now.x === rect.x && now.y === rect.y && now.width === rect.width && now.height === rect.height) return;
    this.window.setBounds(rect);
    this.frame.setBounds({ x: 0, y: 0, width: rect.width, height: rect.height });
  }

  setShown(shown: boolean): void {
    if (this.isDestroyed || this.window.isVisible() === shown) return;
    if (shown) {
      this.window.showInactive();
      // The system may have put it under the game's window; ask again each time it comes back.
      this.window.setAlwaysOnTop(true, "screen-saver");
    } else {
      this.window.hide();
    }
  }

  /** Whether the window takes the mouse and shows the frame, for arranging. */
  setArranging(arranging: boolean): void {
    if (this.isDestroyed || this.arranging === arranging) return;
    this.arranging = arranging;
    this.drag = null;
    this.window.setIgnoreMouseEvents(!arranging);
    this.frame.setVisible(arranging);
    if (arranging) this.sendFrameText();
  }

  /** Only with this on is the window hidden from screen capture. */
  setHideFromCapture(hide: boolean): void {
    if (!this.isDestroyed) this.window.setContentProtection(hide);
  }

  setOpacity(opacity: Opacity): void {
    this.opacity = opacity;
    void this.applyOpacity();
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
    if (this.isDestroyed || !this.arranging) return;
    if (phase === "start") {
      this.drag = { rect: this.window.getBounds(), cursor: screen.getCursorScreenPoint(), edges: edgesOf(edge) };
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Close the pages' processes too, as the other views do; destroying the window alone can leave them running.
    if (!this.frame.webContents.isDestroyed()) this.frame.webContents.close();
    if (!this.window.isDestroyed()) {
      if (!this.window.webContents.isDestroyed()) this.window.webContents.close();
      this.window.destroy();
    }
  }
}
