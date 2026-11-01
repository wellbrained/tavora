// The Overlay page: the state behind the page in the main window where the user arranges the items of one overlay setup
// on a canvas shaped like the game's window (a plain screen-sized one for Everywhere and All games)
// (overlay-canvas.ts puts the live pages on the canvas, the renderer's OverlayPage is the page).
// This file holds what the page shows (the setup, the selection, the grid, undo, the picture, the sources) and does what
// its messages ask: it moves nothing itself, it writes the new position into the overlays (LayoutSource) so the game
// shows exactly what the canvas shows at once, and it tells the canvas where to put the live pages.
import { LIMITS, type OverlaySource } from "@tavora/sdk/protocol";
import { translate, type Language, type MessageKey } from "../shared/i18n";
import { UndoHistory, type Change, type HistoryTarget } from "../shared/layout-history";
import { canvasFor, gridCell, type Canvas } from "../shared/layout-math";
import { PREVIEW_DEFAULT, PREVIEW_MONITOR, PREVIEW_RATIOS, previewAspect, ratioLabel, type Monitor } from "../shared/layout-preview";
import { LAYOUT_ALL_GAMES, LAYOUT_EVERYWHERE, idsOf, placementsOf, type LayoutItemView, type LayoutMessage, type LayoutSettingsChange, type LayoutSourceChild, type LayoutSourceView, type LayoutView, type SourceBlock } from "../shared/layout-view";
import { DEFAULT_RECT, MIN_OVERLAY_SIZE, REFERENCE_HEIGHT, anchorAs, anchorOf, contentScale, placeAnchored, placeLegacy, type AnchoredRect, type Rect } from "../shared/overlay-anchor";
import type { GameOverlaySource } from "./game-overlay-page";
import type { LayoutItemInfo, LayoutItemRef, LayoutItemSnapshot, LayoutSource } from "./game-overlay-service";
import { DEFAULT_GAME_SIZE, allowedIn, isGameSetup, panelWindowId, placeItem, type OverlayScope } from "./game-overlays";
import { captureSize, type LayoutPictures } from "./layout-pictures";
import type { Library } from "./library";
import type { WorkspaceNames } from "./workspace-lookup";

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

/** One panel of some workspace, as the Sources list gets it. */
export interface SourcePanel {
  instanceId: string;
  name: string;
  owner: string;
  moduleId: string;
  workspaceId: string;
  workspaceName: string;
  scope: OverlayScope;
  /** Its type allows being shown over a game (`inGame`). */
  inGame: boolean;
  /** What the panel told overlay.setSources, in its order; null when it never did. */
  sources: readonly OverlaySource[] | null;
}

/** The part of the canvas the controller drives (a test stands in for Electron). */
export interface LayoutWindow {
  destroy(): void;
  /** Hands the pages their new view. */
  send(view: LayoutView): void;
  /**
   * Puts the live pages and the layer on the canvas where they belong. `layer` is the canvas area in the window;
   * `covered`: a list or menu is open over it, so the page shows still pictures of them and they step aside.
   */
  place(frames: LayoutFrame[], layer: Rect | null, covered: boolean): void;
}

export interface OverlayLayoutOptions<W extends LayoutWindow = LayoutWindow> {
  source: LayoutSource;
  pictures: LayoutPictures;
  /** The library's workspaces: a game's name, null once it is gone. */
  workspaces: Pick<WorkspaceNames, "name" | "games">;
  /** The main screen's work area (DIPs): the canvas takes its shape for a game whose window was never seen. */
  screen(): Rect;
  /** The connected monitors in their own pixels, the main one first: the choices of "Preview as". */
  monitors(): Monitor[];
  /** The Game overlays switch in Settings > Overlays, read as it is now. */
  settings: Pick<Library, "gameOverlays"> & Partial<Pick<Library, "overlaySidebar">>;
  language(): Language;
  /** Every panel from every workspace. */
  sources(): SourcePanel[];
  openWindow(request: { closed(): void }): W;
  /** The panels behind the items shown: they have to run for their pages to have anything to show, whichever workspace they are in. */
  keepRunning(panels: { workspaceId: string; moduleId: string; instanceId: string | null }[]): boolean[];
  /** The page asked to go back to the workspace. */
  leave(): void;
  /** The toolbar's Settings: the panel behind an item shows in its dialog over the page, with the settings of `key` (an overlay's key; null for a panel's own item). */
  openSettings(target: { workspaceId: string; moduleId: string; instanceId: string | null; key: string | null }): void;
  /** The picture of the window with this handle (physical pixels at most `size`), as PNG bytes; null when it can't be taken. */
  capture(handle: string, size: { width: number; height: number }): Promise<Buffer | null>;
  /** The picture the user picks from a file, as PNG bytes; "cancelled" when they closed the dialog, "bad" when the file isn't a picture. */
  choose(): Promise<Buffer | "cancelled" | "bad">;
}

/** The game window's height the layout works with: the one seen, or the main screen's. */
interface Shape {
  /** The canvas as shown: the shape of the game's window or the main screen, or the one picked in "Preview as". */
  canvas: Canvas;
  /** The canvas in the shape the setup really has. Positions that aren't anchored yet are converted on this one. */
  real: Canvas;
  gameHeight: number;
  seen: boolean;
}

/** A canvas rectangle in window pixels. Each edge is rounded on its own, so a view never reaches past the canvas by a pixel. */
export function edgesToBounds(layer: Rect, placed: Rect, scale: number): Rect {
  const left = Math.round(layer.x + placed.x * scale);
  const top = Math.round(layer.y + placed.y * scale);
  return { x: left, y: top, width: Math.max(1, Math.round(layer.x + (placed.x + placed.width) * scale) - left), height: Math.max(1, Math.round(layer.y + (placed.y + placed.height) * scale) - top) };
}

/** How often the live pages are looked at for having something to show. */
const IDLE_CHECK_MS = 1000;
/** Room kept around what a panel says its overlay needs, on each side, in canvas units. */
const FIT_PADDING = 8;
/** The gap kept between a new frame and the others when it is placed, in canvas units. */
const PLACE_GAP = 8;

/** Whether an overlay subject is the thing `key` of this panel's module in its workspace. */
const sameSubject = (subject: { owner: string; moduleId: string; workspaceId: string; key: string }, panel: { owner: string; moduleId: string; workspaceId: string }, key: string) =>
  subject.owner === panel.owner && subject.moduleId === panel.moduleId && subject.workspaceId === panel.workspaceId && subject.key === key;

const overlaps = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * Where a new frame of this size goes: the first place, going down the left side and then across, where it covers no other
 * frame (with a gap), on the grid. Where nothing is free, the corner where new items start.
 */
export function freeSpot(size: { width: number; height: number }, canvas: Canvas, others: readonly Rect[], cell: number): { x: number; y: number } {
  const snap = (value: number) => (cell > 0 ? Math.round(value / cell) * cell : Math.round(value));
  const start = { x: snap(DEFAULT_RECT.x * REFERENCE_HEIGHT), y: snap(DEFAULT_RECT.y * REFERENCE_HEIGHT) };
  const stepX = Math.max(cell, snap(size.width + PLACE_GAP), 1);
  const stepY = Math.max(cell, snap(size.height + PLACE_GAP), 1);
  for (let x = start.x; x + size.width <= canvas.width; x += stepX) {
    for (let y = start.y; y + size.height <= canvas.height; y += stepY) {
      const spot = { x, y, ...size };
      if (!others.some((other) => overlaps(spot, other, PLACE_GAP))) return { x, y };
    }
  }
  return start;
}

const sameRect = (a: AnchoredRect, b: AnchoredRect) => a.h === b.h && a.v === b.v && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * An item of one setup as an undo step keeps it: what the page can change on it (its place, Show, Opacity, Hide from
 * capture, hidden on the canvas) and the snapshot that brings it back exactly once it was removed.
 */
export interface ItemState {
  ref: LayoutItemRef;
  rect: AnchoredRect;
  mode: "always" | "toggle";
  opacity: 100 | 75 | 50 | 25;
  hideFromCapture: boolean;
  hidden: boolean;
  snapshot: LayoutItemSnapshot | null;
}

/** Whether two states are the same for undo (the snapshot only brings an item back; it is not compared). */
export const sameState = (a: ItemState | null, b: ItemState | null): boolean =>
  a === null || b === null ? a === b : sameRect(a.rect, b.rect) && a.mode === b.mode && a.opacity === b.opacity && a.hideFromCapture === b.hideFromCapture && a.hidden === b.hidden;

export class OverlayLayout<W extends LayoutWindow = LayoutWindow> {
  private window: W | null = null;
  /** The setup shown (its id: Everywhere, All games, or a game's). */
  private gameId = "";
  /** The items selected, in the order they were picked. */
  private selected: string[] = [];
  /** Hidden on the canvas only (the eye in the list), per setup; forgotten when the window closes. */
  private readonly hiddenOnCanvas = new Map<string, Set<string>>();
  /** Undo and redo, one history per setup, while the page is open (memory only). */
  private readonly histories = new Map<string, UndoHistory<ItemState>>();
  private bounds: Rect | null = null;
  private covered = false;
  private notice: string | null = null;
  /** The note after Copy to…: what it did and the game it went to; forgotten when another setup is shown. */
  private copied: { gameId: string; text: string } | null = null;
  /** Where an item is while it is dragged, in canvas units. */
  private readonly dragging = new Map<string, Rect>();
  private picture: string | null = null;
  /** The shape each setup is previewed in, for this session. A preview only: saved positions never depend on it. */
  private readonly previews = new Map<string, string>();
  /** Picture work in the background (taking, choosing, loading, removing), so a test can wait for it. */
  private readonly pending = new Set<Promise<unknown>>();
  private pictureFor = "";
  private sentView = "";
  /** Items seen in the last look (of the setup `knownIn`), to drop the undo steps of those that went without the page. */
  private known = new Set<string>();
  private knownIn = "";
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  /** Whether the panel behind each item runs, as of the last look. */
  private running = new Map<string, boolean>();

  constructor(private readonly options: OverlayLayoutOptions<W>) {}

  /** The canvas window while the page is open. */
  get canvas(): W | null {
    return this.window;
  }

  get isOpen(): boolean {
    return this.window !== null;
  }

  /**
   * Shows the page on a setup, else on the running game's setup, else on All games while a game runs, else on Everywhere.
   * Already open, it only changes the setup it shows.
   */
  open(setupId?: string | null): void {
    const first = !this.window;
    if (setupId) this.switchTo(setupId);
    else if (first) this.switchTo(this.startSetup());
    if (this.window) {
      this.refresh();
      return;
    }
    this.hiddenOnCanvas.clear();
    this.histories.clear();
    this.selected = [];
    this.notice = null;
    this.copied = null;
    this.sentView = "";
    this.window = this.options.openWindow({ closed: () => this.closed() });
    // A page's panel starts or stops publishing without telling the layout; looked at again every second.
    this.idleTimer = setInterval(() => this.refresh(), IDLE_CHECK_MS);
    this.refresh();
  }

  /** Shows another setup: what was selected or dragged in the one before is let go; its undo history stays with it. */
  private switchTo(gameId: string): void {
    if (gameId === this.gameId) return;
    this.gameId = gameId;
    this.selected = [];
    this.notice = null;
    this.copied = null;
    this.dragging.clear();
  }

  /** The undo history of a setup (the one shown by default). */
  private history(setupId = this.gameId): UndoHistory<ItemState> {
    let history = this.histories.get(setupId);
    if (!history) {
      history = new UndoHistory<ItemState>();
      this.histories.set(setupId, history);
    }
    return history;
  }

  /** The items of a setup hidden on the canvas. */
  private hiddenIn(setupId: string): Set<string> {
    let hidden = this.hiddenOnCanvas.get(setupId);
    if (!hidden) {
      hidden = new Set();
      this.hiddenOnCanvas.set(setupId, hidden);
    }
    return hidden;
  }


  /** The setup the page opens on: the running game's, else All games while a game runs, else Everywhere. */
  private startSetup(): string {
    const running = this.options.source.running();
    if (running.length === 0) return LAYOUT_EVERYWHERE;
    return running.find((id) => this.options.source.setups().includes(id)) ?? LAYOUT_ALL_GAMES;
  }

  /** The page was left (by the user, or Tavora is quitting). */
  private closed(): void {
    clearInterval(this.idleTimer);
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

  /** The setups: Everywhere and All games, then the games that have one, in name order. */
  private games(): { id: string; name: string }[] {
    const list = this.options.source.setups().filter(isGameSetup).map((id) => ({ id, name: this.options.workspaces.name(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name));
    return [{ id: LAYOUT_EVERYWHERE, name: this.text("overlays.everywhere") }, { id: LAYOUT_ALL_GAMES, name: this.text("overlays.allGames") }, ...list];
  }

  /** The games Copy to… lists, in name order: every game workspace but the setup shown, with the frames its own setup has. */
  private copyTargets(setupId: string): { id: string; name: string; frames: number }[] {
    return this.options.workspaces
      .games()
      .filter((game) => game.id !== setupId)
      .map((game) => ({ id: game.id, name: game.name, frames: this.itemsOf(game.id).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Every panel of every workspace, with why it can't go into the setup shown (if it can't). A panel that listed its things
   * (overlay.setSources) is a header over them: each is added on its own, the panel as a whole is not.
   */
  private sources(setupId: string, items: readonly LayoutItemInfo[], panels: readonly SourcePanel[]): LayoutSourceView[] {
    const inSetup = new Set(items.flatMap((info) => (info.ref.kind === "panel" ? [info.ref.instanceId] : [])));
    const full = items.length >= LIMITS.maxGameOverlays;
    return panels.map((panel) => {
      if (panel.sources) {
        const allowed = allowedIn(setupId, panel.workspaceId, panel.scope);
        const children = panel.sources.map((source): LayoutSourceChild => {
          const item = items.find((info) => info.ref.kind === "overlay" && sameSubject(info.ref.subject, panel, source.key));
          const block: SourceBlock | null = item ? "in-setup" : !allowed ? "game-only" : full ? "full" : null;
          return { key: source.key, name: source.name, group: source.group === true, item: item?.id ?? null, block };
        });
        const header: SourceBlock | null = children.some((child) => child.block === "in-setup") ? "in-setup" : children.some((child) => child.block === null) ? null : (children[0]?.block ?? "game-only");
        return { id: panel.instanceId, name: panel.name, moduleId: panel.moduleId, from: panel.workspaceName, game: panel.scope === "game" ? panel.workspaceName : null, block: header, children };
      }
      const block: SourceBlock | null = inSetup.has(panel.instanceId)
        ? "in-setup"
        : !allowedIn(setupId, panel.workspaceId, panel.scope)
          ? "game-only"
          : !panel.inGame
            ? "not-in-game"
            : full
              ? "full"
              : null;
      return { id: panel.instanceId, name: panel.name, moduleId: panel.moduleId, from: panel.workspaceName, game: panel.scope === "game" ? panel.workspaceName : null, block, children: null };
    });
  }

  /** What the panel behind an overlay told about it (overlay.setSources), when it did. */
  private sourceOf(info: LayoutItemInfo, panels: readonly SourcePanel[]): OverlaySource | undefined {
    if (info.ref.kind !== "overlay") return undefined;
    const subject = info.ref.subject;
    for (const panel of panels) {
      const found = panel.sources?.find((source) => sameSubject(subject, panel, source.key));
      if (found) return found;
    }
    return undefined;
  }

  private text(key: MessageKey, params?: Record<string, string | number>): string {
    return translate(this.options.language(), key, params);
  }

  /** The setup shown: the one asked for if the picker has it, else All games (what shows over a game without its own). */
  private current(games: { id: string }[]): string {
    return games.some((game) => game.id === this.gameId) ? this.gameId : LAYOUT_ALL_GAMES;
  }

  /** The other setups an item may be moved to: the ones its workspace is allowed in (a game's own item only goes to that game's). */
  private moveTargets(info: LayoutItemInfo, setupId: string, games: readonly { id: string; name: string }[]): { id: string; name: string }[] {
    return games.filter((game) => game.id !== setupId && allowedIn(game.id, info.keyTarget.workspaceId, info.scope));
  }

  /** A game's setup takes the shape of the game's window; Everywhere and All games the main screen's; "Preview as" can show another. */
  private shape(gameId: string): Shape {
    const seen = isGameSetup(gameId) ? this.options.source.seenSize(gameId) : undefined;
    const size = seen ?? this.screenSize();
    const real = canvasFor(size.width / size.height);
    const aspect = previewAspect(this.previews.get(gameId) ?? PREVIEW_DEFAULT, this.options.monitors());
    return { canvas: aspect === null ? real : canvasFor(aspect), real, gameHeight: size.height, seen: seen !== undefined };
  }

  /** The choices of "Preview as" for a setup, and the one in use (the default again when a monitor was unplugged). */
  private previewOf(gameId: string, shape: Shape): LayoutView["preview"] {
    const monitors = this.options.monitors();
    const own = ratioLabel(shape.real.width, shape.real.height);
    const options = [
      { id: PREVIEW_DEFAULT, label: shape.seen ? this.text("overlays.layout.previewWindow", { ratio: own }) : this.text("overlays.layout.previewScreen", { ratio: own }) },
      ...PREVIEW_RATIOS.map((item) => ({ id: item.id, label: item.id })),
      ...monitors.map((monitor, index) => ({ id: `${PREVIEW_MONITOR}${monitor.id}`, label: this.text("overlays.layout.previewMonitor", { n: index + 1, size: `${monitor.width}×${monitor.height}` }) })),
    ];
    const choice = this.previews.get(gameId) ?? PREVIEW_DEFAULT;
    return { choice: options.some((option) => option.id === choice) ? choice : PREVIEW_DEFAULT, options };
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

  /**
   * Where an item is on the canvas: one that is not converted yet (fractions of the window) the old way, on the canvas size.
   * In another preview shape it is converted on the real one first, so it is anchored like any other.
   */
  private placed(info: LayoutItemInfo, shape: Shape): Rect {
    const canvas = { x: 0, y: 0, ...shape.canvas };
    if (info.legacy && shape.canvas.width !== shape.real.width) return placeAnchored(this.rectOf(info, shape), canvas, this.minimum(shape));
    return placeItem(info, canvas, this.minimum(shape));
  }

  /** The item's position as an anchored rectangle on the canvas: what an undo step goes back to. */
  private rectOf(info: LayoutItemInfo, shape: Shape): AnchoredRect {
    if (!info.legacy) return info.rect;
    const canvas = { x: 0, y: 0, ...shape.real };
    return anchorOf(placeLegacy(info.legacy, canvas, this.minimum(shape)), canvas);
  }

  /** What the pages show now. */
  view(): LayoutView {
    const games = this.games();
    const gameId = this.current(games);
    const shape = this.shape(gameId);
    const infos = this.itemsOf(gameId);
    const panels = this.options.sources();
    const grid = this.options.source.grid();
    // The game runs and its window was seen (the window in front at some look since it started), whichever window is in front now.
    const canTakePicture = isGameSetup(gameId) && this.options.source.handleOf(gameId) !== null;
    const items: LayoutItemView[] = infos.map((info) => ({
      id: info.id,
      target: info.ref.kind === "panel" ? { kind: "panel", instanceId: info.ref.instanceId } : { kind: "overlay", ...info.ref.subject },
      keyTarget: { owner: info.keyTarget.owner, moduleId: info.keyTarget.moduleId, workspaceId: info.keyTarget.workspaceId, key: info.keyTarget.key },
      // A thing its panel listed goes by the name the panel gave it.
      name: this.sourceOf(info, panels)?.name ?? info.name,
      from: this.options.workspaces.name(info.keyTarget.workspaceId) ?? "",
      moduleId: info.moduleId,
      kind: info.ref.kind,
      moveTargets: this.moveTargets(info, gameId, games),
      rect: this.rectOf(info, shape),
      placed: this.dragging.get(info.id) ?? this.placed(info, shape),
      mode: info.mode,
      opacity: info.opacity,
      hideFromCapture: info.hideFromCapture,
      hotkey: info.hotkey,
      live: info.source !== null,
      idle: info.source === null || info.source.state() !== null ? null : this.running.get(info.id) === false ? "stopped" : "empty",
      off: info.mode === "toggle" && !info.toggledOn,
      hiddenOnCanvas: this.hiddenIn(gameId).has(info.id),
    }));
    const selected = items.filter((item) => this.selected.includes(item.id)).map((item) => item.id);
    return {
      games,
      sources: this.sources(gameId, infos, panels),
      copyTargets: this.copyTargets(gameId),
      limit: LIMITS.maxGameOverlays,
      gameId,
      canvas: shape.canvas,
      seen: shape.seen,
      preview: this.previewOf(gameId, shape),
      grid,
      cell: gridCell(grid, REFERENCE_HEIGHT),
      minSize: this.minimum(shape),
      selection: selected.length === 1 ? selected[0]! : null,
      selected,
      sidebar: this.options.settings.overlaySidebar ?? "right",
      items,
      picture: this.pictureFor === gameId ? this.picture : null,
      canTakePicture,
      pictureHint: canTakePicture ? null : isGameSetup(gameId) && this.options.source.gameRunning(gameId) ? "switch" : "start",
      canUndo: this.history(gameId).canUndo,
      canRedo: this.history(gameId).canRedo,
      enabled: this.options.settings.gameOverlays,
      notice: this.notice,
      copied: this.copied,
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
        bounds: edgesToBounds(layer, item.placed, scale),
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
    if (gameId) this.switchTo(gameId);
    if (this.pictureFor !== gameId) {
      this.pictureFor = gameId;
      this.picture = null;
      this.track(this.loadPicture(gameId));
    }
    const shown = this.itemsOf(this.gameId);
    // Panels that can show over a game run too while the page is open, so what they list (overlay.setSources) is known.
    const listed = this.options.sources().filter((panel) => panel.inGame && !shown.some((info) => (info.ref.kind === "panel" ? info.ref.instanceId === panel.instanceId : info.keyTarget.workspaceId === panel.workspaceId && info.moduleId === panel.moduleId)));
    const runs = this.options.keepRunning([
      ...shown.map((info) => ({ workspaceId: info.keyTarget.workspaceId, moduleId: info.moduleId, instanceId: info.ref.kind === "panel" ? info.ref.instanceId : null })),
      ...listed.map((panel) => ({ workspaceId: panel.workspaceId, moduleId: panel.moduleId, instanceId: panel.instanceId })),
    ]);
    this.running = new Map(shown.map((info, index) => [info.id, runs[index] ?? false]));
    const view = this.view();
    // Undo steps of an item that went without the page doing it (its module removed it, its workspace was deleted) can't be taken back.
    const present = new Set(view.items.map((item) => item.id));
    if (this.knownIn === view.gameId) for (const id of this.known) if (!present.has(id)) this.history(view.gameId).forget(view.gameId, id);
    this.known = present;
    this.knownIn = view.gameId;
    const hidden = this.hiddenIn(view.gameId);
    for (const id of [...hidden]) if (!present.has(id)) hidden.delete(id);
    const text = JSON.stringify(view);
    if (text !== this.sentView) {
      this.sentView = text;
      window.send(view);
    }
    window.place(this.bounds ? this.frames(view, this.bounds) : [], this.bounds, this.covered);
  }

  private track(work: Promise<unknown>): void {
    const done = work.then(
      () => void this.pending.delete(done),
      () => void this.pending.delete(done),
    );
    this.pending.add(done);
  }

  /** Resolves once the picture work started so far, and what it started in turn, has finished. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
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
        if (fromShell) this.options.leave();
        return;
      case "game":
        if (!fromShell || message.gameId === this.gameId) return;
        this.switchTo(message.gameId);
        break;
      case "add-source":
        if (!fromShell) return;
        this.record([this.gameId], () => this.addSource(message.id, message.key));
        break;
      case "copy-setup":
        if (!fromShell) return;
        this.copySetup(message.to, message.mode);
        break;
      case "move":
        if (!fromShell) return;
        this.record([this.gameId, message.to], () => this.moveItem(message.id, message.to));
        break;
      case "grid":
        this.options.source.setGrid(message.grid);
        break;
      case "preview":
        if (!fromShell || !this.setPreview(message.choice)) return;
        break;
      case "select":
        this.selected = "ids" in message ? [...message.ids] : message.id === null ? [] : [message.id];
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
        for (const { id, rect } of placementsOf(message)) this.dragging.set(id, this.fit(rect));
        // Only the live pages follow; the pages draw the drag themselves.
        this.placeOnly();
        return;
      case "commit": {
        const placements = placementsOf(message);
        for (const { id } of placements) this.dragging.delete(id);
        this.record([this.gameId], () => this.commit(placements));
        break;
      }
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
      case "canvas-hidden": {
        const ids = idsOf(message).filter((id) => this.info(id));
        this.record([this.gameId], () => {
          const hidden = this.hiddenIn(this.gameId);
          for (const id of ids) {
            if (message.hidden) hidden.add(id);
            else hidden.delete(id);
          }
        });
        break;
      }
      case "reset":
        this.record([this.gameId], () => idsOf(message).forEach((id) => this.resetPosition(id)));
        break;
      case "reset-size":
        this.record([this.gameId], () => idsOf(message).forEach((id) => this.resetSize(id)));
        break;
      case "remove":
        this.record([this.gameId], () => this.removeItems(idsOf(message)));
        break;
      case "change":
        this.record([this.gameId], () => this.changeSettings(message.ids, message.change));
        break;
      case "settings": {
        const info = this.info(message.id);
        if (info) this.options.openSettings({ workspaceId: info.keyTarget.workspaceId, moduleId: info.moduleId, instanceId: info.ref.kind === "panel" ? info.ref.instanceId : null, key: info.ref.kind === "overlay" ? info.ref.subject.key : null });
        return;
      }
      case "take-picture":
        if (!fromShell) return;
        this.track(this.takePicture());
        return;
      case "choose-picture":
        if (!fromShell) return;
        this.track(this.choosePicture());
        return;
      case "remove-picture":
        if (!fromShell) return;
        this.track(this.options.pictures.remove(this.gameId).then(() => this.loadPicture(this.gameId)));
        return;
      case "dismiss-notice":
        this.notice = null;
        this.copied = null;
        break;
    }
    this.refresh();
  }

  /** "Preview as": the setup shown is drawn in another shape from now on (this session); false when the choice isn't one of its choices. */
  private setPreview(choice: string): boolean {
    const gameId = this.current(this.games());
    if (!this.previewOf(gameId, this.shape(gameId)).options.some((option) => option.id === choice)) return false;
    if (choice === PREVIEW_DEFAULT) this.previews.delete(gameId);
    else this.previews.set(gameId, choice);
    // An item dragged in the old shape is let go; nothing was moved.
    this.dragging.clear();
    return true;
  }

  /**
   * A panel from the Sources goes into the setup shown, if it may, and is selected; with a `key`, one thing the panel listed
   * (a panel that listed some can't be added as a whole). A new frame starts at the size its panel said it needs, in a free place.
   */
  private addSource(instanceId: string, key?: string): void {
    const setupId = this.current(this.games());
    const infos = this.itemsOf(setupId);
    const panels = this.options.sources();
    const view = this.sources(setupId, infos, panels).find((source) => source.id === instanceId);
    const panel = panels.find((source) => source.instanceId === instanceId);
    if (!view || !panel) return;
    if (view.children !== null || key !== undefined) {
      const child = view.children?.find((one) => one.key === key);
      if (!child) return;
      if (child.item) {
        this.selected = [child.item];
        return;
      }
      if (child.block !== null) {
        if (child.block === "full") this.say("overlays.full");
        return;
      }
      const subject = { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: child.key };
      const added = this.options.source.addOverlay(setupId, subject);
      if (added === "full") this.say("overlays.full");
      else if (added === "added") {
        const info = this.itemsOf(setupId).find((one) => one.ref.kind === "overlay" && sameSubject(one.ref.subject, panel, subject.key));
        if (info) {
          this.fitNew(setupId, info, panel.sources?.find((source) => source.key === subject.key));
          this.selected = [info.id];
        }
      }
      return;
    }
    if (view.block !== null) {
      if (view.block === "full") this.say("overlays.full");
      return;
    }
    const added = this.options.source.addPanel(setupId, { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, instanceId });
    if (added === "full") this.say("overlays.full");
    else if (added === "added") this.selected = [panelWindowId(instanceId)];
  }

  /** The size an overlay needs on the canvas (what its panel said, with room around it), on the grid and never below the smallest size; null when the panel said nothing. */
  private fitSize(source: OverlaySource | undefined, shape: Shape): { width: number; height: number } | null {
    if (!source?.size) return null;
    const cell = gridCell(this.options.source.grid(), REFERENCE_HEIGHT);
    const snap = (value: number) => (cell > 0 ? Math.ceil(value / cell) * cell : Math.round(value));
    const min = this.minimum(shape);
    return {
      width: Math.min(shape.canvas.width, Math.max(min, snap(source.size.width + 2 * FIT_PADDING))),
      height: Math.min(shape.canvas.height, Math.max(min, snap(source.size.height + 2 * FIT_PADDING))),
    };
  }

  /** A frame just added gets the size its content needs and the first place where it covers no other frame. */
  private fitNew(setupId: string, info: LayoutItemInfo, source: OverlaySource | undefined): void {
    // A new frame is placed in the shape the setup really has, whatever "Preview as" shows: it must start inside the real window.
    const shape = { ...this.shape(setupId), canvas: this.shape(setupId).real };
    const size = this.fitSize(source, shape);
    if (!size) return;
    const others = this.itemsOf(setupId)
      .filter((one) => one.id !== info.id)
      .map((one) => this.placed(one, shape));
    const at = freeSpot(size, shape.canvas, others, gridCell(this.options.source.grid(), REFERENCE_HEIGHT));
    this.options.source.setRect(setupId, info.ref, anchorOf({ ...at, ...size }, { x: 0, y: 0, ...shape.canvas }));
  }

  /** Copy to…: the frames of the setup shown go into a game's setup, and a note says what went and what could not. */
  private copySetup(to: string, mode: "replace" | "add"): void {
    const from = this.current(this.games());
    const target = this.copyTargets(from).find((game) => game.id === to);
    if (!target) return;
    const outcome = this.options.source.copy(from, to, mode);
    if (!outcome) {
      this.copied = null;
      return this.say("overlays.copy.nothing");
    }
    const skips = this.skipText(outcome.skipped);
    if (outcome.copied === 0) {
      this.copied = null;
      this.notice = [this.text("overlays.copy.none"), skips].filter(Boolean).join(" ");
    } else {
      this.notice = null;
      const name = target.name;
      this.copied = { gameId: to, text: skips ? `${translate(this.options.language(), "overlays.copy.copied", { count: outcome.copied, game: name })} ${skips}` : translate(this.options.language(), "overlays.copy.copiedTo", { game: name }) };
    }
    this.sentView = "";
    this.refresh();
  }

  /** The sentences about what a copy left out: frames that only work in one game, ones that can't show over a game, ones already there, ones that did not fit. */
  private skipText(skipped: readonly { reason: "game-only" | "not-in-game" | "exists" | "full"; workspaceId: string }[]): string {
    const language = this.options.language();
    const count = (reason: string) => skipped.filter((item) => item.reason === reason);
    const sentences: string[] = [];
    const only = count("game-only");
    if (only.length > 0) {
      const games = new Set(only.map((item) => item.workspaceId));
      const game = games.size === 1 ? (this.options.workspaces.name([...games][0]!) ?? "") : "";
      sentences.push(translate(language, game ? "overlays.copy.skipGame" : "overlays.copy.skipGames", { count: only.length, game }));
    }
    for (const [reason, key] of [["not-in-game", "overlays.copy.skipNotInGame"], ["exists", "overlays.copy.skipExists"], ["full", "overlays.copy.skipFull"]] as const) {
      const found = count(reason).length;
      if (found > 0) sentences.push(translate(language, key, { count: found, max: LIMITS.maxGameOverlays }));
    }
    return sentences.join(" ");
  }

  /** Del and the toolbar's Remove: the items leave the setup shown (not the others), and are not selected any more. */
  private removeItems(ids: readonly string[]): void {
    for (const id of ids) {
      const info = this.info(id);
      if (!info) continue;
      this.options.source.remove(this.gameId, info.ref);
      this.hiddenIn(this.gameId).delete(id);
    }
    this.selected = this.selected.filter((id) => !ids.includes(id));
  }

  /** The Settings box: Show, Opacity or Hide from capture of each item named, in the setup shown. */
  private changeSettings(ids: readonly string[], change: LayoutSettingsChange): void {
    for (const id of ids) {
      const info = this.info(id);
      if (info) this.setSettings(this.gameId, info, change);
    }
  }

  private setSettings(setupId: string, info: Pick<LayoutItemInfo, "ref">, change: LayoutSettingsChange): void {
    if (info.ref.kind === "panel") this.options.source.setPanel(setupId, info.ref.instanceId, change);
    else this.options.source.setOverlay(setupId, info.ref.subject, change);
  }

  /** Move to…: the item goes to another setup, if its workspace may be there, with its place and settings. */
  private moveItem(id: string, to: string): void {
    const games = this.games();
    const setupId = this.current(games);
    const info = this.info(id);
    if (!info || !this.moveTargets(info, setupId, games).some((game) => game.id === to)) return;
    const moved = this.options.source.move(info.ref, setupId, to);
    if (moved === "full") this.say("overlays.full");
    else if (moved === "added" || moved === "exists") this.selected = this.selected.filter((one) => one !== id);
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

  /**
   * Items were dropped (or nudged) at these rectangles (canvas units). One alone is anchored to its nearest edges; several
   * moved together each keep the anchors they had, so the group lands as it was arranged and each stays tied to its edge.
   */
  private commit(placements: readonly { id: string; rect: Rect }[]): void {
    const shape = this.shape(this.current(this.games()));
    const canvas = { x: 0, y: 0, ...shape.canvas };
    for (const { id, rect } of placements) {
      const info = this.info(id);
      if (!info) continue;
      const fitted = this.fit(rect);
      // Dropped where it already is: nothing to keep, and no rounding of its place.
      const now = this.placed(info, shape);
      if (fitted.x === now.x && fitted.y === now.y && fitted.width === now.width && fitted.height === now.height) continue;
      const before = this.rectOf(info, shape);
      const next = placements.length > 1 ? anchorAs(fitted, canvas, before.h, before.v) : anchorOf(fitted, canvas);
      this.change(info, before, next);
    }
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
    // An overlay whose panel said what it needs goes back to that, where it is.
    const need = this.fitSize(this.sourceOf(info, this.options.sources()), this.shape(gameId));
    if (need) {
      const shape = this.shape(gameId);
      const placed = this.placed(info, shape);
      this.change(info, before, anchorOf(this.fit({ x: placed.x, y: placed.y, ...need }), { x: 0, y: 0, ...shape.canvas }));
      return;
    }
    // The size is in units of the window's height: it is worked out on the game's window, else the main screen.
    const size = this.options.source.seenSize(gameId) ?? this.screenSize();
    this.change(info, before, { ...before, ...this.options.source.startSize(info.ref, size) });
  }

  /** Keeps `after` as the item's position in the setup shown when it differs from `before`. */
  private change(info: LayoutItemInfo, before: AnchoredRect, after: AnchoredRect): void {
    if (sameRect(before, after)) return;
    this.options.source.setRect(this.gameId, info.ref, after);
  }

  // ── Undo ────────────────────────────────────────────────────────────

  /** An item of a setup as undo sees it now; null when the setup hasn't it. */
  private stateOf(setupId: string, id: string): ItemState | null {
    const info = this.itemsOf(setupId).find((one) => one.id === id);
    if (!info) return null;
    return {
      ref: info.ref,
      rect: this.rectOf(info, this.shape(setupId)),
      mode: info.mode,
      opacity: info.opacity,
      hideFromCapture: info.hideFromCapture,
      hidden: this.hiddenIn(setupId).has(id),
      snapshot: this.options.source.snapshot(setupId, info.ref),
    };
  }

  /** Every item of these setups, as undo sees them now. */
  private statesOf(setupIds: readonly string[]): Map<string, { setup: string; id: string; state: ItemState }> {
    const states = new Map<string, { setup: string; id: string; state: ItemState }>();
    for (const setup of new Set(setupIds)) {
      for (const info of this.itemsOf(setup)) {
        const state = this.stateOf(setup, info.id);
        if (state) states.set(`${setup}\n${info.id}`, { setup, id: info.id, state });
      }
    }
    return states;
  }

  /**
   * Runs one user action as one undo step: every item of the setups it may touch is looked at before and after, and what
   * changed (added, removed, moved, set) is kept in the history of the setup shown. An action that changed nothing makes no step.
   */
  private record(setupIds: readonly string[], action: () => void): void {
    const before = this.statesOf(setupIds);
    action();
    const after = this.statesOf(setupIds);
    const changes: Change<ItemState>[] = [];
    for (const [key, { setup, id, state }] of before) changes.push({ setup, id, before: state, after: after.get(key)?.state ?? null });
    for (const [key, { setup, id, state }] of after) if (!before.has(key)) changes.push({ setup, id, before: null, after: state });
    this.history().push(changes, sameState);
    this.syncKnown();
  }

  /** What the page did itself is not taken for an item going without it. */
  private syncKnown(): void {
    this.known = new Set(this.itemsOf(this.gameId).map((info) => info.id));
    this.knownIn = this.gameId;
  }

  /** How undo reads and writes the setups. */
  private readonly target: HistoryTarget<ItemState> = {
    read: (setup, id) => this.stateOf(setup, id),
    same: sameState,
    write: (setup, id, from, to) => {
      const hidden = this.hiddenIn(setup);
      if (to === null) {
        if (from) this.options.source.remove(setup, from.ref);
        hidden.delete(id);
        return true;
      }
      if (from === null) {
        if (!to.snapshot || !this.options.source.restore(setup, to.snapshot)) return false;
      } else {
        if (!sameRect(from.rect, to.rect)) this.options.source.setRect(setup, to.ref, to.rect);
        const change: LayoutSettingsChange = {};
        if (from.mode !== to.mode) change.mode = to.mode;
        if (from.opacity !== to.opacity) change.opacity = to.opacity;
        if (from.hideFromCapture !== to.hideFromCapture) change.hideFromCapture = to.hideFromCapture;
        if (Object.keys(change).length > 0) this.setSettings(setup, to, change);
      }
      if (to.hidden) hidden.add(id);
      else hidden.delete(id);
      return true;
    },
  };

  /**
   * Ctrl+Z and Ctrl+Y: the newest step of the setup shown is taken back or done again, but only while every item it
   * touched is still as the step left it; one changed since (in the game, say) is dropped and the one before it is tried.
   * What the step touched is selected.
   */
  private step(side: "before" | "after"): void {
    const history = this.history();
    const changes = side === "before" ? history.undo(this.target) : history.redo(this.target);
    if (!changes) return;
    const present = new Set(this.itemsOf(this.gameId).map((info) => info.id));
    this.selected = [...new Set(changes.filter((change) => change.setup === this.gameId && present.has(change.id)).map((change) => change.id))];
    this.syncKnown();
  }

  // ── The game's picture ──────────────────────────────────────────────

  private async takePicture(): Promise<void> {
    const gameId = this.gameId;
    const handle = isGameSetup(gameId) ? this.options.source.handleOf(gameId) : null;
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
    this.track(this.options.pictures.remove(workspaceId));
  }
}
