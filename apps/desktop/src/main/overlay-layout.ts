// The Overlay layout: the state behind the window where the player arranges the overlays and panels in game on a
// canvas shaped like the game's window (overlay-layout-window.ts is the window, the renderer's LayoutApp the pages).
// This file holds what the window shows (the game, the selection, the grid, undo, the picture) and does what its
// messages ask: it moves nothing itself, it writes the new position into the overlays (LayoutSource) so the game shows
// exactly what the canvas shows at once, and it tells the window where to put the live pages.
import { translate, type Language, type MessageKey } from "../shared/i18n";
import { UndoStack } from "../shared/layout-history";
import { canvasFor, gridCell, type Canvas } from "../shared/layout-math";
import { LAYOUT_ALL_GAMES, type LayoutItemView, type LayoutMessage, type LayoutView } from "../shared/layout-view";
import { DEFAULT_RECT, MIN_OVERLAY_SIZE, REFERENCE_HEIGHT, anchorOf, contentScale, placeLegacy, type AnchoredRect, type Rect } from "../shared/overlay-anchor";
import type { GameOverlaySource } from "./game-overlay-page";
import type { LayoutItemInfo, LayoutSource } from "./game-overlay-service";
import { DEFAULT_GAME_SIZE, placeItem, type GameLayoutState } from "./game-overlays";
import { captureSize, type LayoutPictures } from "./layout-pictures";

/** A live page on the canvas, as the window puts it: where, how big the content is drawn, how faded, and whether it shows. */
export interface LayoutFrame {
  id: string;
  source: GameOverlaySource;
  /** Pixels in the window, from its top left. */
  bounds: Rect;
  zoom: number;
  /** 0 to 1. */
  opacity: number;
  visible: boolean;
}

/** The part of the layout window the controller drives (a test stands in for Electron). */
export interface LayoutWindow {
  focus(): void;
  destroy(): void;
  /** Hands the pages their new view. */
  send(view: LayoutView): void;
  /**
   * Puts the live pages and the layer on the canvas where they belong. `layer` is the canvas area in the window;
   * `covered`: a list or menu is open over it, so the window shows still pictures of them and they step aside.
   */
  place(frames: LayoutFrame[], layer: Rect | null, covered: boolean): void;
}

export interface OverlayLayoutOptions {
  source: LayoutSource;
  pictures: LayoutPictures;
  gameName(gameId: string): string | null;
  /** The main screen's work area (DIPs): the canvas takes its shape for a game whose window was never seen. */
  screen(): Rect;
  /** Game overlays are on. */
  enabled(): boolean;
  language(): Language;
  openWindow(request: { closed(): void }): LayoutWindow;
  /** The picture of the window with this handle (physical pixels at most `size`), as PNG bytes; null when it can't be taken. */
  capture(handle: string, size: { width: number; height: number }): Promise<Buffer | null>;
  /** The picture the player picks from a file, as PNG bytes; "cancelled" when they closed the dialog, "bad" when the file isn't a picture. */
  choose(): Promise<Buffer | "cancelled" | "bad">;
}

/** The game window's height the layout works with: the one seen, or the main screen's. */
interface Shape {
  canvas: Canvas;
  gameHeight: number;
  seen: boolean;
}

const sameRect = (a: AnchoredRect, b: AnchoredRect) => a.h === b.h && a.v === b.v && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

type LayoutEdit = { kind: "item"; rect: AnchoredRect } | { kind: "general"; state: GameLayoutState };
const sameEdit = (a: LayoutEdit, b: LayoutEdit) => JSON.stringify(a) === JSON.stringify(b);

export class OverlayLayout {
  private window: LayoutWindow | null = null;
  private gameId = "";
  private selection: string | null = null;
  /** Hidden on the canvas only (the eye in the list); forgotten when the window closes. */
  private readonly hiddenOnCanvas = new Set<string>();
  private readonly undo = new UndoStack<LayoutEdit>();
  private bounds: Rect | null = null;
  private covered = false;
  private notice: string | null = null;
  /** Where an item is while it is dragged, in canvas units. */
  private readonly dragging = new Map<string, Rect>();
  private picture: string | null = null;
  private pictureFor = "";
  private sentView = "";
  /** Items seen in the last look, to drop the undo steps of those that went. */
  private known = new Set<string>();

  constructor(private readonly options: OverlayLayoutOptions) {}

  get isOpen(): boolean {
    return this.window !== null;
  }

  /** Opens the window on `gameId` (or the game it showed, or the first of the picker), or brings it forward. */
  open(gameId?: string | null): void {
    if (gameId) this.gameId = gameId;
    if (this.window) {
      this.window.focus();
      this.refresh();
      return;
    }
    this.hiddenOnCanvas.clear();
    this.undo.clear();
    this.selection = null;
    this.notice = null;
    this.sentView = "";
    this.window = this.options.openWindow({ closed: () => this.closed() });
    this.refresh();
  }

  /** The window was closed (by the player, or Tavora is quitting). */
  private closed(): void {
    this.window = null;
    this.bounds = null;
    this.dragging.clear();
  }

  close(): void {
    const window = this.window;
    this.closed();
    window?.destroy();
  }

  // ── What is shown ───────────────────────────────────────────────────

  /** All games, the library games and the game the window was asked to show. */
  private games(): { id: string; name: string }[] {
    const { own } = this.options.source.games();
    const ids = new Set(own);
    if (this.gameId && this.gameId !== LAYOUT_ALL_GAMES) ids.add(this.gameId);
    const list = [...ids].map((id) => ({ id, name: this.options.gameName(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name));
    list.unshift({ id: LAYOUT_ALL_GAMES, name: this.text("overlays.allGames") });
    return list;
  }

  private text(key: MessageKey): string {
    return translate(this.options.language(), key);
  }

  /** The game shown: the one asked for if the picker has it, else the first. */
  private current(games: { id: string }[]): string {
    return games.some((game) => game.id === this.gameId) ? this.gameId : (games.find((game) => game.id !== LAYOUT_ALL_GAMES)?.id ?? games[0]?.id ?? this.gameId);
  }

  private shape(gameId: string): Shape {
    const seen = gameId === LAYOUT_ALL_GAMES ? undefined : this.options.source.seenSize(gameId);
    const size = seen ?? this.screenSize();
    return { canvas: canvasFor(size.width / size.height), gameHeight: size.height, seen: seen !== undefined };
  }

  private screenSize(): { width: number; height: number } {
    const { width, height } = this.options.screen();
    return width > 0 && height > 0 ? { width, height } : DEFAULT_GAME_SIZE;
  }

  /** The smallest size an item may have on the canvas: the 48 px of the game window, in canvas units. */
  private minimum(shape: Shape): number {
    return (MIN_OVERLAY_SIZE * REFERENCE_HEIGHT) / shape.gameHeight;
  }

  private itemsOf(gameId: string): LayoutItemInfo[] {
    return this.options.source.items(gameId);
  }

  /** Where an item is on the canvas: one that is not converted yet (fractions of the window) the old way, on the canvas size. */
  private placed(info: LayoutItemInfo, shape: Shape): Rect {
    return placeItem(info, { x: 0, y: 0, ...shape.canvas }, this.minimum(shape));
  }

  /** The item's position as an anchored rectangle on the canvas: what an undo step goes back to. */
  private rectOf(info: LayoutItemInfo, shape: Shape): AnchoredRect {
    if (!info.legacy) return info.rect;
    const canvas = { x: 0, y: 0, ...shape.canvas };
    return anchorOf(placeLegacy(info.legacy, canvas, this.minimum(shape)), canvas);
  }

  /** What the pages show now. */
  view(): LayoutView {
    const games = this.games();
    const gameId = this.current(games);
    const shape = this.shape(gameId);
    const infos = this.itemsOf(gameId);
    const layout = this.options.source.layoutState(gameId);
    const grid = this.options.source.grid();
    // The game runs and its window was seen (the window in front at some look since it started), whichever window is in front now.
    const canTakePicture = gameId !== LAYOUT_ALL_GAMES && this.options.source.handleOf(gameId) !== null;
    const items: LayoutItemView[] = infos.map((info) => ({
      id: info.id,
      target: info.ref.kind === "panel" ? { kind: "panel", instanceId: info.ref.instanceId } : { kind: "overlay", ...info.ref.subject },
      keyTarget: { owner: info.keyTarget.owner, moduleId: info.keyTarget.moduleId, workspaceId: info.keyTarget.workspaceId, key: info.keyTarget.key },
      name: info.name,
      moduleId: info.moduleId,
      kind: info.ref.kind,
      general: info.scope === "all",
      ownPosition: info.scope === "all" && Object.hasOwn(layout.positions, info.id),
      rect: this.rectOf(info, shape),
      placed: this.dragging.get(info.id) ?? this.placed(info, shape),
      mode: info.mode,
      opacity: info.opacity,
      hideFromCapture: info.hideFromCapture,
      hotkey: info.hotkey,
      live: info.source !== null,
      off: info.mode === "toggle" && !info.toggledOn,
      hiddenOnCanvas: this.hiddenOnCanvas.has(info.id),
    }));
    return {
      games,
      gameId,
      customized: layout.detached,
      hasOverrides: Object.keys(layout.positions).length > 0,
      canvas: shape.canvas,
      seen: shape.seen,
      grid,
      cell: gridCell(grid, REFERENCE_HEIGHT),
      minSize: this.minimum(shape),
      selection: this.selection !== null && items.some((item) => item.id === this.selection) ? this.selection : null,
      items,
      picture: this.pictureFor === gameId ? this.picture : null,
      canTakePicture,
      pictureHint: canTakePicture ? null : gameId !== LAYOUT_ALL_GAMES && this.options.source.gameRunning(gameId) ? "switch" : "start",
      canUndo: this.undo.canUndo,
      canRedo: this.undo.canRedo,
      enabled: this.options.enabled(),
      notice: this.notice,
    };
  }

  /** The live pages of the items, placed on the canvas whose area in the window is `layer`. */
  private frames(view: LayoutView, layer: Rect): LayoutFrame[] {
    const scale = layer.height / REFERENCE_HEIGHT;
    const shape = this.shape(view.gameId);
    const infos = new Map(this.itemsOf(view.gameId).map((info) => [info.id, info]));
    const frames: LayoutFrame[] = [];
    for (const item of view.items) {
      const info = infos.get(item.id);
      if (!info?.source || !item.live) continue;
      frames.push({
        id: item.id,
        source: info.source,
        bounds: {
          x: Math.round(layer.x + item.placed.x * scale),
          y: Math.round(layer.y + item.placed.y * scale),
          width: Math.max(1, Math.round(item.placed.width * scale)),
          height: Math.max(1, Math.round(item.placed.height * scale)),
        },
        // The content has its natural size in a game window of 1080 pixels' height, and the canvas shows that window smaller or bigger.
        zoom: (contentScale(shape.gameHeight) * layer.height) / shape.gameHeight,
        opacity: (item.opacity / 100) * (item.off ? 0.5 : 1),
        visible: !item.hiddenOnCanvas,
      });
    }
    return frames;
  }

  /** Looks at everything again and tells the window; called whenever something the layout shows may have changed. */
  refresh(): void {
    const window = this.window;
    if (!window) return;
    const games = this.games();
    const gameId = this.current(games);
    if (gameId !== this.gameId && gameId) this.gameId = gameId;
    if (this.pictureFor !== gameId) {
      this.pictureFor = gameId;
      this.picture = null;
      void this.loadPicture(gameId);
    }
    const view = this.view();
    // Undo steps of an item that is gone can't be taken back.
    const present = new Set(view.items.map((item) => item.id));
    for (const id of this.known) if (!present.has(id)) this.undo.forget(id);
    this.known = present;
    for (const id of [...this.hiddenOnCanvas]) if (!present.has(id)) this.hiddenOnCanvas.delete(id);
    const text = JSON.stringify(view);
    if (text !== this.sentView) {
      this.sentView = text;
      window.send(view);
    }
    window.place(this.bounds ? this.frames(view, this.bounds) : [], this.bounds, this.covered);
  }

  private async loadPicture(gameId: string): Promise<void> {
    const address = await this.options.pictures.address(gameId);
    if (this.pictureFor !== gameId) return;
    this.picture = address;
    this.sentView = "";
    this.refresh();
  }

  // ── What the pages ask ──────────────────────────────────────────────

  /** `fromShell`: the message comes from the page with the list (the other page is the layer on the canvas). */
  handle(message: LayoutMessage, fromShell: boolean): void {
    if (!this.window) return;
    switch (message.type) {
      case "done":
        if (fromShell) this.close();
        return;
      case "game":
        if (!fromShell || message.gameId === this.gameId) return;
        this.gameId = message.gameId;
        this.selection = null;
        this.undo.clear();
        this.notice = null;
        this.dragging.clear();
        break;
      case "grid":
        this.options.source.setGrid(message.grid);
        break;
      case "select":
        this.selection = message.id;
        break;
      case "bounds":
        if (!fromShell) return;
        this.bounds = message.bounds && message.bounds.width > 0 && message.bounds.height > 0 ? message.bounds : null;
        break;
      case "cover":
        if (!fromShell) return;
        this.covered = message.covered;
        break;
      case "drag":
        this.dragging.set(message.id, this.fit(message.rect));
        // Only the live pages follow; the pages draw the drag themselves.
        this.placeOnly();
        return;
      case "commit":
        this.dragging.delete(message.id);
        this.commit(message.id, message.rect);
        break;
      case "undo":
        this.step("before");
        break;
      case "redo":
        this.step("after");
        break;
      case "drag-end":
        // The drag stopped without a drop (the pointer was lost, the window lost the focus, the page was loaded again).
        this.dragging.clear();
        break;
      case "canvas-hidden":
        if (message.hidden) this.hiddenOnCanvas.add(message.id);
        else this.hiddenOnCanvas.delete(message.id);
        break;
      case "reset":
        this.resetPosition(message.id);
        break;
      case "reset-size":
        this.resetSize(message.id);
        break;
      case "customize":
      case "follow-all":
      case "follow-item": {
        if (!fromShell || this.gameId === LAYOUT_ALL_GAMES) return;
        if (message.type === "follow-item" && this.info(message.id)?.scope !== "all") return;
        const before: LayoutEdit = { kind: "general", state: this.options.source.layoutState(this.gameId) };
        if (message.type === "customize") this.options.source.customize(this.gameId);
        else this.options.source.follow(this.gameId, message.type === "follow-item" ? message.id : undefined);
        const after: LayoutEdit = { kind: "general", state: this.options.source.layoutState(this.gameId) };
        if (!sameEdit(before, after)) this.undo.push({ target: "$layout", before, after });
        break;
      }
      case "take-picture":
        if (!fromShell) return;
        void this.takePicture();
        return;
      case "choose-picture":
        if (!fromShell) return;
        void this.choosePicture();
        return;
      case "remove-picture":
        if (!fromShell) return;
        void this.options.pictures.remove(this.gameId).then(() => this.loadPicture(this.gameId));
        return;
      case "dismiss-notice":
        this.notice = null;
        break;
    }
    this.refresh();
  }

  /** Moves the live pages to the dragged rectangles without a new view. */
  private placeOnly(): void {
    if (!this.window || !this.bounds) return;
    this.window.place(this.frames(this.view(), this.bounds), this.bounds, this.covered);
  }

  private info(id: string): LayoutItemInfo | undefined {
    return this.itemsOf(this.current(this.games())).find((info) => info.id === id);
  }

  /** A rectangle from the canvas, kept on it and not smaller than the smallest size. */
  private fit(rect: Rect): Rect {
    const shape = this.shape(this.current(this.games()));
    const min = this.minimum(shape);
    const width = Math.min(shape.canvas.width, Math.max(min, Math.round(rect.width)));
    const height = Math.min(shape.canvas.height, Math.max(min, Math.round(rect.height)));
    return {
      x: Math.min(shape.canvas.width - width, Math.max(0, Math.round(rect.x))),
      y: Math.min(shape.canvas.height - height, Math.max(0, Math.round(rect.y))),
      width,
      height,
    };
  }

  /** An item was dropped at `rect` (canvas units): it is kept as anchored to the nearest edges, and an undo step is made. */
  private commit(id: string, rect: Rect): void {
    const info = this.info(id);
    if (!info) return;
    const shape = this.shape(this.current(this.games()));
    const fitted = this.fit(rect);
    // Dropped where it already is: nothing to keep, and no rounding of its place.
    const now = this.placed(info, shape);
    if (fitted.x === now.x && fitted.y === now.y && fitted.width === now.width && fitted.height === now.height) return;
    const next = anchorOf(fitted, { x: 0, y: 0, ...shape.canvas });
    if (sameRect(next, this.rectOf(info, shape))) return;
    this.change(info, this.rectOf(info, shape), next);
  }

  /** Reset position: back to the corner where a new item starts, at the size it has. */
  private resetPosition(id: string): void {
    const info = this.info(id);
    if (!info) return;
    const before = this.rectOf(info, this.shape(this.current(this.games())));
    this.change(info, before, { ...before, h: DEFAULT_RECT.h, v: DEFAULT_RECT.v, x: DEFAULT_RECT.x, y: DEFAULT_RECT.y });
  }

  /** Reset size: the size a new item of its kind gets (an overlay's from its module, a panel's from its viewport), where it is. */
  private resetSize(id: string): void {
    const info = this.info(id);
    if (!info) return;
    const gameId = this.current(this.games());
    const before = this.rectOf(info, this.shape(gameId));
    // The size is in units of the window's height: it is worked out on the game's window, else the main screen.
    const size = this.options.source.seenSize(gameId) ?? this.screenSize();
    this.change(info, before, { ...before, ...this.options.source.startSize(info.ref, size) });
  }

  /** Keeps `after` as the item's position when it differs from `before`, with an undo step. */
  private change(info: LayoutItemInfo, before: AnchoredRect, after: AnchoredRect): void {
    if (sameRect(before, after)) return;
    const previous = this.editOf(info);
    if (!this.options.source.setRect(info.ref, after, this.gameId)) return;
    this.undo.push({ target: info.scope === "all" && this.gameId !== LAYOUT_ALL_GAMES ? "$layout" : info.id, before: previous, after: this.editOf(this.info(info.id)!) });
  }

  private editOf(info: LayoutItemInfo): LayoutEdit {
    return info.scope === "all" && this.gameId !== LAYOUT_ALL_GAMES
      ? { kind: "general", state: this.options.source.layoutState(this.gameId) }
      : { kind: "item", rect: this.rectOf(info, this.shape(this.gameId)) };
  }

  /**
   * Ctrl+Z and Ctrl+Y: sets one side of a step back, but only if the item is still where the step left it. One that was
   * moved since (in the game, say) is not put back over that: its step is dropped and the one before it is tried.
   */
  private step(side: "before" | "after"): void {
    const from = side === "before" ? "after" : "before";
    for (;;) {
      const step = side === "before" ? this.undo.undo() : this.undo.redo();
      if (!step) return;
      const info = this.info(step.target);
      const expected = step[from];
      const next = step[side];
      if (expected.kind === "general" && next.kind === "general") {
        if (!sameEdit({ kind: "general", state: this.options.source.layoutState(this.gameId) }, expected)) {
          this.undo.discard(step);
          continue;
        }
        this.options.source.setLayoutState(this.gameId, next.state);
        return;
      }
      if (info && expected.kind === "item" && next.kind === "item" && sameRect(this.rectOf(info, this.shape(this.current(this.games()))), expected.rect)) {
        if (this.options.source.setRect(info.ref, next.rect, this.gameId)) this.selection = step.target;
        return;
      }
      this.undo.discard(step);
    }
  }

  // ── The game's picture ──────────────────────────────────────────────

  private async takePicture(): Promise<void> {
    const gameId = this.gameId;
    const handle = gameId === LAYOUT_ALL_GAMES ? null : this.options.source.handleOf(gameId);
    if (!handle) return this.say("overlays.layout.noGame");
    const seen = this.options.source.seenSize(gameId);
    // The window's own size when it was seen, else the main screen's: the shape the canvas has.
    const known = seen ?? this.screenSize();
    const size = captureSize(known.width, known.height);
    let png: Buffer | null = null;
    try {
      png = await this.options.capture(handle, size);
    } catch {
      png = null;
    }
    // The game's window is not there (closed, minimized) or gave no picture.
    if (!png) return this.say("overlays.layout.pictureFailed");
    await this.keep(gameId, png);
  }

  private async choosePicture(): Promise<void> {
    const gameId = this.gameId;
    const picked = await this.options.choose();
    if (picked === "cancelled") return;
    if (picked === "bad") return this.say("overlays.layout.badPicture");
    await this.keep(gameId, picked);
  }

  private async keep(gameId: string, png: Buffer): Promise<void> {
    const result = await this.options.pictures.save(gameId, png);
    if (result !== "saved") return this.say(result === "too-big" ? "overlays.layout.bigPicture" : "overlays.layout.badPicture");
    this.notice = null;
    await this.loadPicture(gameId);
  }

  private say(key: MessageKey): void {
    this.notice = this.text(key);
    this.sentView = "";
    this.refresh();
  }

  /** A workspace left the library: the picture of its game goes. */
  forgetWorkspace(workspaceId: string): void {
    void this.options.pictures.remove(workspaceId);
  }
}
