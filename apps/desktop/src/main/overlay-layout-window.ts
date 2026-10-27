// The Overlay layout window: a normal, resizable Tavora window (not on top, in the taskbar, with the focus like any
// other) where the user arranges what shows over their game. It is three layers:
//   1. the shell, the window's own page: the toolbar, the list and the canvas background (grid, game picture);
//   2. one live page per overlay or panel with an overlay page, sized to its rectangle on the canvas. They are served
//      exactly like a game overlay's page (game-overlay-page.ts): from a Tavora-internal address, no bridge, no
//      network, a session of their own that reaches nothing else. They cannot take the mouse: the layer above covers them;
//   3. the layer, a transparent page of Tavora's own over the canvas that takes the mouse and the keys: outlines, handles,
//      guide lines, and the dragging itself.
// Nothing here touches the game. The window never shows in test runs (`hidden`): it is made, loaded and driven, but
// not put on screen.
import { BrowserWindow, WebContentsView } from "electron";
import { createHash } from "node:crypto";
import { GAME_OVERLAY_SCHEME } from "./assets";
import { GAME_OVERLAY_ORIGIN, serveGameOverlay, type GameOverlaySource } from "./game-overlay-page";
import { lockedSession } from "./game-overlay-window";
import type { LayoutFrame, LayoutWindow } from "./overlay-layout";
import type { Rect } from "./game-overlays";
import type { WindowState } from "./window-state";
import type { LayoutStills, LayoutView } from "../shared/layout-view";
import { pageZoom } from "../shared/overlay-anchor";

export interface OverlayLayoutWindowOptions {
  /** Tavora's host preload: the pages talk to the main process through it. */
  preload: string;
  /** Test runs: the window is never shown. */
  hidden: boolean;
  title: string;
  icon?: string | undefined;
  background: string;
  devTools: boolean;
  bounds: WindowState;
  /** The page of the shell and of the layer. */
  address(part: "shell" | "layer"): string;
  /** The window was moved or resized: where it is now, to keep. */
  boundsChanged(state: WindowState): void;
  closed(): void;
}

/** How long a page gets to give its still picture before the window goes on without it. */
const STILL_TIMEOUT_MS = 250;
/** How long the shell waits to say its stills are on screen before the pages step aside anyway. */
const STILLS_SHOWN_CAP_MS = 300;
/** How long the stills stay under the pages when they come back, so a page that has not drawn yet never shows empty. */
const STILLS_LINGER_MS = 80;
const NO_STILLS: LayoutStills = { items: [], layer: null };

interface ItemView {
  view: WebContentsView;
  /** The page should show on the canvas (its item isn't hidden there, the canvas is on screen); it still steps aside behind a still picture. */
  wanted: boolean;
  source: GameOverlaySource;
  zoom: number;
  opacity: number;
  /** The style that fades the page now. */
  css: string | undefined;
  queue: Promise<void>;
}

const LOCKED = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false } as const;

export class OverlayLayoutWindow implements LayoutWindow {
  private readonly window: BrowserWindow;
  private readonly layer: WebContentsView;
  private readonly items = new Map<string, ItemView>();
  private destroyed = false;
  /** A list or menu of the shell is open over the canvas. */
  private covered = false;
  /** The live pages and the layer are out of the way because the shell shows still pictures of them. */
  private frozen = false;
  /** Counts the opening and closing of lists, so a slow freeze never hides the pages after the list closed. */
  private coverChanges = 0;
  private stillsOnScreen: (() => void) | null = null;
  private layerWanted = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: OverlayLayoutWindowOptions) {
    const web = { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: options.devTools };
    this.window = new BrowserWindow({
      ...options.bounds.bounds,
      minWidth: 900,
      minHeight: 480,
      title: options.title,
      ...(options.icon ? { icon: options.icon } : {}),
      autoHideMenuBar: true,
      backgroundColor: options.background,
      show: false,
      webPreferences: web,
    });
    const window = this.window;
    window.removeMenu();
    // The title stays Tavora's, whatever the page calls itself.
    window.on("page-title-updated", (event) => event.preventDefault());
    if (options.bounds.maximized) window.maximize();
    window.on("resize", () => this.saveSoon());
    window.on("move", () => this.saveSoon());
    // Where the window was, kept before it goes (the timer would find it destroyed).
    window.on("close", () => this.flushSave());
    window.once("closed", () => {
      clearTimeout(this.saveTimer);
      const wasDestroyed = this.destroyed;
      this.destroyed = true;
      // The pages of the layer and of the items are views of the window; they don't close by themselves.
      for (const entry of this.items.values()) if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
      this.items.clear();
      if (!this.layer.webContents.isDestroyed()) this.layer.webContents.close();
      if (!wasDestroyed) options.closed();
    });

    this.layer = new WebContentsView({ webPreferences: web });
    this.layer.setBackgroundColor("#00000000");
    this.layer.setVisible(false);
    for (const contents of [window.webContents, this.layer.webContents]) {
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event) => event.preventDefault());
    }
    window.contentView.addChildView(this.layer);
    void window.loadURL(options.address("shell")).catch(() => {});
    void this.layer.webContents.loadURL(options.address("layer")).catch(() => {});
    if (!options.hidden) window.once("ready-to-show", () => window.show());
  }

  /** For dialogs that belong to this window. */
  get browserWindow(): BrowserWindow {
    return this.window;
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed();
  }

  /** Which of the two pages sent something, by its web contents; null for anything else. */
  kindOf(contentsId: number, mainFrame: boolean): "shell" | "layer" | null {
    if (this.isDestroyed || !mainFrame) return null;
    if (contentsId === this.window.webContents.id) return "shell";
    if (contentsId === this.layer.webContents.id) return "layer";
    return null;
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 800);
  }

  /** Keeps the window's place now, if a change is waiting to be kept. */
  private flushSave(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.window.isDestroyed()) return;
    this.options.boundsChanged({ bounds: this.window.getNormalBounds(), maximized: this.window.isMaximized() });
  }

  focus(): void {
    if (this.isDestroyed || this.options.hidden) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  send(view: LayoutView): void {
    if (this.isDestroyed) return;
    for (const contents of [this.window.webContents, this.layer.webContents]) if (!contents.isDestroyed()) contents.send("layout:state", view);
  }

  /** The host's state (language, theme, the hotkey dialog) for the shell. */
  sendHostState(state: unknown): void {
    if (this.isDestroyed) return;
    for (const contents of [this.window.webContents, this.layer.webContents]) if (!contents.isDestroyed()) contents.send("host:state", state);
  }

  place(frames: LayoutFrame[], layer: Rect | null, covered: boolean): void {
    if (this.isDestroyed) return;
    const wanted = new Set(frames.map((frame) => frame.id));
    for (const [id, entry] of [...this.items]) {
      if (wanted.has(id)) continue;
      this.window.contentView.removeChildView(entry.view);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
      this.items.delete(id);
    }
    let added = false;
    for (const frame of frames) {
      let entry = this.items.get(frame.id);
      if (!entry) {
        entry = this.createItem(frame);
        this.items.set(frame.id, entry);
        this.window.contentView.addChildView(entry.view);
        added = true;
      }
      entry.source = frame.source;
      entry.view.setBounds(frame.bounds);
      entry.wanted = frame.visible && layer !== null;
      entry.view.setVisible(entry.wanted && !this.frozen);
      this.zoom(entry, frame.zoom);
      this.fade(entry, frame.opacity);
    }
    if (layer) this.layer.setBounds(layer);
    this.layerWanted = layer !== null;
    this.layer.setVisible(this.layerWanted && !this.frozen);
    this.cover(covered);
    // Added again, the layer is the topmost: it takes the mouse over every page.
    if (added) this.window.contentView.addChildView(this.layer);
  }

  /**
   * A list or menu opened or closed over the canvas. The native pages would be drawn over it, so they step aside, but not
   * before the shell shows a still picture of each where it is (the host's frozen-image way): nothing on the canvas changes.
   */
  private cover(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    const change = ++this.coverChanges;
    if (covered) void this.freeze(change);
    else this.thaw(change);
  }

  private async freeze(change: number): Promise<void> {
    const grab = async (view: WebContentsView, wanted: boolean) => {
      if (!wanted || view.webContents.isDestroyed()) return null;
      const image = await Promise.race([view.webContents.capturePage().catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), STILL_TIMEOUT_MS))]);
      return image && !image.isEmpty() ? { bounds: view.getBounds(), url: image.toDataURL() } : null;
    };
    const [layerShot, ...itemShots] = await Promise.all([
      grab(this.layer, this.layerWanted),
      ...[...this.items].map(async ([id, entry]) => {
        const shot = await grab(entry.view, entry.wanted);
        return shot && { id, ...shot };
      }),
    ]);
    if (change !== this.coverChanges || this.isDestroyed) return;
    const stills: LayoutStills = { items: itemShots.filter((shot) => shot !== null), layer: layerShot };
    this.sendStills(stills);
    // Hidden before their pictures are on screen, the canvas would show empty for a frame.
    if (stills.items.length || stills.layer) await this.stillsAreShown();
    if (change !== this.coverChanges || this.isDestroyed) return;
    this.frozen = true;
    this.showViews();
  }

  private thaw(change: number): void {
    this.frozen = false;
    this.showViews();
    // The stills go once the pages are back and have had a moment to draw.
    setTimeout(() => {
      if (change === this.coverChanges && !this.isDestroyed) this.sendStills(NO_STILLS);
    }, STILLS_LINGER_MS);
  }

  private showViews(): void {
    for (const entry of this.items.values()) entry.view.setVisible(entry.wanted && !this.frozen);
    this.layer.setVisible(this.layerWanted && !this.frozen);
  }

  private sendStills(stills: LayoutStills): void {
    if (!this.window.webContents.isDestroyed()) this.window.webContents.send("layout:stills", stills);
  }

  /** Resolves once the shell says the stills are on screen, or after a cap. */
  private stillsAreShown(): Promise<void> {
    this.stillsOnScreen?.();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.stillsOnScreen === done) this.stillsOnScreen = null;
        resolve();
      };
      const timer = setTimeout(done, STILLS_SHOWN_CAP_MS);
      this.stillsOnScreen = done;
    });
  }

  /** The shell says the stills it was sent are on screen. */
  stillsShown(): void {
    this.stillsOnScreen?.();
  }

  private createItem(frame: LayoutFrame): ItemView {
    const name = createHash("sha256").update(frame.id).digest("hex").slice(0, 32);
    const session = lockedSession(`overlay-layout-${name}`, (url) => url.startsWith(`${GAME_OVERLAY_ORIGIN}/`));
    const entry: ItemView = {
      view: new WebContentsView({ webPreferences: { ...LOCKED, session } }),
      wanted: false,
      source: frame.source,
      zoom: 1,
      opacity: 1,
      css: undefined,
      queue: Promise.resolve(),
    };
    // The source is looked up at every request: the module's page and state as they are now.
    session.protocol.handle(GAME_OVERLAY_SCHEME, (request) =>
      serveGameOverlay(request, {
        page: () => entry.source.page(),
        state: () => entry.source.state(),
        watch: (fn) => entry.source.watch(fn),
      }),
    );
    const contents = entry.view.webContents;
    entry.view.setBackgroundColor("#00000000");
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("did-finish-load", () => {
      if (contents.getZoomFactor() !== entry.zoom) contents.setZoomFactor(entry.zoom);
      entry.css = undefined;
      this.applyFade(entry);
    });
    void contents.loadURL(`${GAME_OVERLAY_ORIGIN}/`).catch(() => {});
    return entry;
  }

  private zoom(entry: ItemView, wanted: number): void {
    // A small canvas asks for less than Chromium's smallest zoom; the page is laid out at that zoom then.
    const factor = pageZoom(wanted);
    if (entry.zoom === factor) return;
    entry.zoom = factor;
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.setZoomFactor(factor);
  }

  private fade(entry: ItemView, opacity: number): void {
    if (entry.opacity === opacity) return;
    entry.opacity = opacity;
    this.applyFade(entry);
  }

  /** Fades the page by a style of Tavora's own, as the game overlays do. */
  private applyFade(entry: ItemView): void {
    const contents = entry.view.webContents;
    entry.queue = entry.queue.then(async () => {
      if (contents.isDestroyed()) return;
      try {
        if (entry.css) await contents.removeInsertedCSS(entry.css);
        entry.css = entry.opacity === 1 ? undefined : await contents.insertCSS(`html{opacity:${entry.opacity} !important}`, { cssOrigin: "user" });
      } catch {
        // The page went away while the style was being set; the next load sets it again.
      }
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.flushSave();
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    for (const entry of this.items.values()) if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    this.items.clear();
    if (!this.layer.webContents.isDestroyed()) this.layer.webContents.close();
    if (!this.window.isDestroyed()) {
      if (!this.window.webContents.isDestroyed()) this.window.webContents.close();
      this.window.destroy();
    }
  }
}
