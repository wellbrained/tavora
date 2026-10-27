// The canvas of the Overlay page: the views that sit over the page's canvas area in the main window while the page
// is shown. It is three layers:
//   1. the page itself (Tavora's main window): the toolbar, the sidebar and the canvas background (grid, game picture);
//   2. one live page per overlay or panel with an overlay page, sized to its rectangle on the canvas. They are served
//      exactly like a game overlay's page (game-overlay-page.ts): from a Tavora-internal address, no bridge, no
//      network, a session of their own that reaches nothing else. They cannot take the mouse: the layer above covers them;
//   3. the layer, a transparent page of Tavora's own over the canvas that takes the mouse and the keys: outlines, handles,
//      guide lines, and the dragging itself.
// Nothing here touches the game. The views leave the window when the page is left.
import { BrowserWindow, WebContentsView } from "electron";
import { createHash } from "node:crypto";
import { GAME_OVERLAY_SCHEME } from "./assets";
import { GAME_OVERLAY_ORIGIN, serveGameOverlay, type GameOverlaySource } from "./game-overlay-page";
import { lockedSession } from "./game-overlay-window";
import type { LayoutFrame, LayoutWindow } from "./overlay-layout";
import type { Rect } from "./game-overlays";
import type { LayoutStills, LayoutView } from "../shared/layout-view";
import { pageZoom } from "../shared/overlay-anchor";

export interface OverlayCanvasOptions {
  /** Tavora's main window: the page is its host UI, and the views are added to it. */
  window: BrowserWindow;
  /** Tavora's host preload: the layer talks to the main process through it. */
  preload: string;
  devTools: boolean;
  /** The address of the layer's page. */
  address(): string;
}

/** How long a page gets to give its still picture before the canvas goes on without it. */
const STILL_TIMEOUT_MS = 250;
/** How long the page is waited for to say its stills are on screen before the pages step aside anyway. */
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

export class OverlayCanvas implements LayoutWindow {
  private readonly window: BrowserWindow;
  private readonly layer: WebContentsView;
  private readonly items = new Map<string, ItemView>();
  private destroyed = false;
  /** A list or menu of the page is open over the canvas. */
  private covered = false;
  /** The live pages and the layer are out of the way because the page shows still pictures of them. */
  private frozen = false;
  /** Counts the opening and closing of lists, so a slow freeze never hides the pages after the list closed. */
  private coverChanges = 0;
  private stillsOnScreen: (() => void) | null = null;
  private layerWanted = false;

  constructor(private readonly options: OverlayCanvasOptions) {
    this.window = options.window;
    const web = { preload: options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: options.devTools };
    this.layer = new WebContentsView({ webPreferences: web });
    this.layer.setBackgroundColor("#00000000");
    this.layer.setVisible(false);
    const contents = this.layer.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    this.window.contentView.addChildView(this.layer);
    void contents.loadURL(options.address()).catch(() => {});
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed();
  }

  /** Which page sent something, by its web contents: the main window's page ("shell") or the layer; null for anything else. */
  kindOf(contentsId: number, mainFrame: boolean): "shell" | "layer" | null {
    if (this.isDestroyed || !mainFrame) return null;
    if (contentsId === this.window.webContents.id) return "shell";
    if (contentsId === this.layer.webContents.id) return "layer";
    return null;
  }

  send(view: LayoutView): void {
    if (this.isDestroyed) return;
    for (const contents of [this.window.webContents, this.layer.webContents]) if (!contents.isDestroyed()) contents.send("layout:state", view);
  }

  /** The host's state (language, theme) for the layer; the main window's page gets its own. */
  sendHostState(state: unknown): void {
    if (this.isDestroyed) return;
    if (!this.layer.webContents.isDestroyed()) this.layer.webContents.send("host:state", state);
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

  /** The page is left: every view of the canvas goes out of the window. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.coverChanges++;
    this.stillsOnScreen?.();
    const alive = !this.window.isDestroyed();
    for (const entry of this.items.values()) {
      if (alive) this.window.contentView.removeChildView(entry.view);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    }
    this.items.clear();
    if (alive) this.window.contentView.removeChildView(this.layer);
    if (!this.layer.webContents.isDestroyed()) this.layer.webContents.close();
    if (alive && !this.window.webContents.isDestroyed()) this.window.webContents.send("layout:stills", NO_STILLS);
  }
}
