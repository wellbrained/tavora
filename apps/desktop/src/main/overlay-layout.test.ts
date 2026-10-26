import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GridSetting } from "../shared/layout-math";
import { LAYOUT_ALL_GAMES, type LayoutMessage, type LayoutView } from "../shared/layout-view";
import { DEFAULT_PANEL_ANCHORED, DEFAULT_RECT, placeAnchored, placeLegacy, type AnchoredRect, type LegacyRect } from "../shared/overlay-anchor";
import type { LayoutItemInfo, LayoutItemRef, LayoutSource } from "./game-overlay-service";
import type { GameLayoutState, SeenSize } from "./game-overlays";
import { LayoutPictures } from "./layout-pictures";
import { OverlayLayout, type LayoutFrame, type LayoutWindow } from "./overlay-layout";
import type { WindowState } from "./window-state";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-overlay-layout-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("picture")]);
const SOURCE = { page: () => null, state: () => null, watch: () => null };
let setups = 0;
const at = (x: number, y: number, width: number, height: number): AnchoredRect => ({ h: "left", v: "top", x, y, width, height });

interface Item {
  key: string;
  /** The game the item was made in; "all" scope shows in every game. */
  gameId: string;
  scope: "game" | "all";
  rect: AnchoredRect;
  /** Not converted yet: the fractions of the window. */
  legacy?: LegacyRect;
  mode?: "always" | "toggle";
  toggledOn?: boolean;
  panel?: boolean;
  page?: boolean;
  opacity?: 100 | 75 | 50 | 25;
}

function setup(items: Item[], options: { seen?: Record<string, SeenSize>; handles?: Record<string, string>; running?: string[]; startSizes?: { overlay?: { width: number; height: number }; panel?: { width: number; height: number } }; capture?: Buffer | null | "throws"; choose?: Buffer | "cancelled" | "bad"; enabled?: boolean } = {}) {
  const sent: LayoutView[] = [];
  const placed: { frames: LayoutFrame[]; layer: { x: number; y: number; width: number; height: number } | null; covered: boolean }[] = [];
  const world = {
    items,
    grid: "normal" as GridSetting,
    layouts: new Map<string, GameLayoutState>(),
    windowState: null as WindowState | null,
    seen: { ...options.seen },
    opened: 0,
    focused: 0,
    destroyed: 0,
    closedWindow: () => {},
    captured: [] as { handle: string; size: { width: number; height: number } }[],
    enabled: options.enabled ?? true,
    changed: [] as { overlay?: unknown; panel?: unknown }[],
    removed: [] as LayoutItemRef[],
    /** The window handles seen, and the games the watcher says run (by default those with a handle). */
    handles: { ...options.handles } as Record<string, string>,
    running: new Set(options.running ?? Object.keys(options.handles ?? {})),
    /** Sizes asked for by Reset size: the window they were worked out on. */
    sizedOn: [] as { width: number; height: number }[],
  };
  const info = (item: Item): LayoutItemInfo => {
    const subject = { owner: "official", moduleId: "tavora.clock-counter", gameId: item.gameId, key: item.key };
    return {
      id: item.panel ? `panel\n${item.key}` : [subject.owner, subject.moduleId, subject.gameId, subject.key].join("\n"),
      ref: item.panel ? { kind: "panel", instanceId: item.key } : { kind: "overlay", subject },
      name: item.key,
      moduleId: "tavora.clock-counter",
      scope: item.scope,
      mode: item.mode ?? "always",
      opacity: item.opacity ?? 100,
      hideFromCapture: false,
      rect: item.rect,
      ...(item.legacy ? { legacy: item.legacy } : {}),
      hotkey: null,
      toggledOn: item.toggledOn ?? false,
      source: item.page === false ? null : SOURCE,
      keyTarget: subject,
    };
  };
  const find = (ref: LayoutItemRef) => world.items.find((item) => (ref.kind === "panel" ? item.panel && item.key === ref.instanceId : !item.panel && item.key === ref.subject.key && item.gameId === ref.subject.gameId));
  const source: LayoutSource = {
    items: (gameId) => world.items.filter((item) => item.scope === "all" || item.gameId === gameId).map((item) => {
      const result = info(item);
      const rect = world.layouts.get(gameId)?.positions[result.id];
      if (rect && item.scope === "all") {
        result.rect = rect;
        delete result.legacy;
      }
      return result;
    }),
    games: () => ({ own: [...new Set(world.items.filter((item) => item.scope === "game").map((item) => item.gameId))], general: world.items.some((item) => item.scope === "all") }),
    seenSize: (gameId) => world.seen[gameId],
    handleOf: (gameId) => (world.running.has(gameId) ? (world.handles[gameId] ?? null) : null),
    gameRunning: (gameId) => world.running.has(gameId),
    gameWindow: () => null,
    grid: () => world.grid,
    setGrid: (grid) => void (world.grid = grid),
    window: () => world.windowState,
    setWindow: (state) => void (world.windowState = state),
    layoutState: (gameId) => structuredClone(world.layouts.get(gameId) ?? { detached: false, positions: {} }),
    setLayoutState: (gameId, state) => void world.layouts.set(gameId, structuredClone(state)),
    customize: (gameId) => {
      const state = source.layoutState(gameId);
      state.detached = true;
      for (const item of source.items(gameId)) if (item.scope === "all") state.positions[item.id] = item.rect;
      source.setLayoutState(gameId, state);
    },
    follow: (gameId, id) => {
      if (!id) world.layouts.delete(gameId);
      else {
        const state = source.layoutState(gameId);
        delete state.positions[id];
        state.detached = false;
        source.setLayoutState(gameId, state);
      }
    },
    setRect: (ref, rect, gameId) => {
      const item = find(ref);
      if (item) {
        if (item.scope === "all" && gameId && gameId !== LAYOUT_ALL_GAMES) {
          const state = source.layoutState(gameId);
          state.positions[info(item).id] = rect;
          source.setLayoutState(gameId, state);
          return true;
        }
        item.rect = rect;
        delete item.legacy;
      }
      return item !== undefined;
    },
    startSize: (ref, size) => {
      world.sizedOn.push(size);
      return ref.kind === "panel" ? (options.startSizes?.panel ?? { width: DEFAULT_PANEL_ANCHORED.width, height: DEFAULT_PANEL_ANCHORED.height }) : (options.startSizes?.overlay ?? { width: DEFAULT_RECT.width, height: DEFAULT_RECT.height });
    },
    setOverlay: (_subject, change) => void world.changed.push({ overlay: change }),
    setPanel: (_id, change) => void world.changed.push({ panel: change }),
    remove: (ref) => void world.removed.push(ref),
    layerOpen: () => false,
  };
  const window: LayoutWindow = {
    focus: () => void world.focused++,
    destroy: () => void world.destroyed++,
    send: (view) => void sent.push(view),
    place: (frames, layer, covered) => void placed.push({ frames, layer, covered }),
  };
  const pictures = new LayoutPictures(path.join(dir, `pictures-${setups++}`));
  const layout = new OverlayLayout({
    source,
    pictures,
    gameName: (id) => ({ elden: "Elden Ring", poe2: "Path of Exile 2" })[id] ?? null,
    screen: () => ({ x: 0, y: 0, width: 2560, height: 1440 }),
    enabled: () => world.enabled,
    language: () => "en",
    openWindow: (request) => {
      world.opened++;
      world.closedWindow = request.closed;
      return window;
    },
    capture: async (handle, size) => {
      world.captured.push({ handle, size });
      if (options.capture === "throws") throw new Error("no capture");
      return options.capture === undefined ? PNG : options.capture;
    },
    choose: async () => options.choose ?? "cancelled",
  });
  const last = () => sent.at(-1)!;
  const lastPlace = () => placed.at(-1)!;
  /** Lets the shell report where the canvas is: 1080 px high is the reference, so scale 1 for a 1920x1080 game. */
  const bounds = (height = 540, x = 300, y = 50) => layout.handle({ type: "bounds", bounds: { x, y, width: Math.round((height * 16) / 9), height } }, true);
  // The pictures are files: under load a few rounds are needed for the writes to land.
  const flush = async () => {
    for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { layout, world, sent, placed, last, lastPlace, bounds, flush, pictures };
}

const clock = (key: string, gameId = "elden", rect = at(0.036, 0.03, 0.356, 0.16)): Item => ({ key, gameId, scope: "game", rect });

describe("opening", () => {
  it("closes with Done only when the shell asks", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open();
    layout.handle({ type: "done" }, false);
    expect(layout.isOpen).toBe(true);
    layout.handle({ type: "done" }, true);
    expect(layout.isOpen).toBe(false);
    expect(world.destroyed).toBe(1);
  });
  it("offers All games alongside a game and shows only general items there", () => {
    const { layout } = setup([clock("own"), { ...clock("general", "personal"), scope: "all" }]);
    layout.open("elden");
    layout.handle({ type: "game", gameId: LAYOUT_ALL_GAMES }, true);
    expect(layout.view().games[0]!.id).toBe(LAYOUT_ALL_GAMES);
    expect(layout.view().items.map((item) => item.name)).toEqual(["general"]);
  });

  it("undoes and redoes whole-layout customization and returning to All games", () => {
    const { layout } = setup([{ ...clock("general", "personal"), scope: "all" }]);
    layout.open("elden");
    layout.handle({ type: "customize" }, true);
    expect(layout.view()).toMatchObject({ customized: true, hasOverrides: true });
    expect(layout.view().items[0]!.ownPosition).toBe(true);
    layout.handle({ type: "undo" }, true);
    expect(layout.view()).toMatchObject({ customized: false, hasOverrides: false });
    layout.handle({ type: "redo" }, true);
    expect(layout.view().customized).toBe(true);
    layout.handle({ type: "follow-all" }, true);
    expect(layout.view().hasOverrides).toBe(false);
    layout.handle({ type: "undo" }, true);
    expect(layout.view().customized).toBe(true);
  });

  it("undoes a per-item move back to inheritance, and can follow one item again", () => {
    const { layout, world } = setup([{ ...clock("general", "personal"), scope: "all" }]);
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const base = { ...world.items[0]!.rect };
    layout.handle({ type: "commit", id, rect: { x: 600, y: 400, width: 300, height: 200 } }, false);
    expect(layout.view().items[0]!.ownPosition).toBe(true);
    expect(world.items[0]!.rect).toEqual(base);
    layout.handle({ type: "undo" }, true);
    expect(layout.view().items[0]!.ownPosition).toBe(false);
    layout.handle({ type: "redo" }, true);
    expect(layout.view().items[0]!.ownPosition).toBe(true);
    layout.handle({ type: "follow-item", id }, true);
    expect(layout.view().items[0]!.ownPosition).toBe(false);
    layout.handle({ type: "undo" }, true);
    expect(layout.view().items[0]!.ownPosition).toBe(true);
  });
  it("opens one window and brings it forward when opened again", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open("elden");
    layout.open("elden");
    expect(world.opened).toBe(1);
    expect(world.focused).toBe(1);
    expect(layout.isOpen).toBe(true);
  });

  it("opens again after the window was closed, with a fresh start", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open("elden");
    layout.handle({ type: "select", id: layout.view().items[0]!.id }, true);
    world.closedWindow();
    expect(layout.isOpen).toBe(false);
    layout.open("elden");
    expect(world.opened).toBe(2);
    expect(layout.view().selection).toBeNull();
  });

  it("closes the window with Tavora", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open();
    layout.close();
    expect(world.destroyed).toBe(1);
    expect(layout.isOpen).toBe(false);
  });

  it("ignores messages while closed", () => {
    const { layout, world } = setup([clock("a")]);
    layout.handle({ type: "grid", grid: "fine" }, true);
    expect(world.grid).toBe("normal");
  });
});

describe("the games of the picker", () => {
  it("lists the games that have overlays or panels, and shows the general ones in each", () => {
    const { layout } = setup([clock("a", "elden"), clock("b", "poe2"), { key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open("elden");
    const view = layout.view();
    expect(view.games).toEqual([{ id: LAYOUT_ALL_GAMES, name: "All games" }, { id: "elden", name: "Elden Ring" }, { id: "poe2", name: "Path of Exile 2" }]);
    expect(view.gameId).toBe("elden");
    expect(view.items.map((item) => [item.name, item.general])).toEqual([["a", false], ["g", true]]);
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view().items.map((item) => [item.name, item.general])).toEqual([["b", false], ["g", true]]);
  });

  it("includes the game it was opened for, even when it has nothing of its own yet", () => {
    const { layout } = setup([{ key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }, clock("b", "poe2")]);
    layout.open("elden");
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_ALL_GAMES, "elden", "poe2"]);
    expect(layout.view().items.map((item) => item.name)).toEqual(["g"]);
  });

  it("falls back to All games when only general ones exist and no game is known", () => {
    const { layout } = setup([{ key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open();
    expect(layout.view().games).toEqual([{ id: LAYOUT_ALL_GAMES, name: "All games" }]);
    expect(layout.view().gameId).toBe(LAYOUT_ALL_GAMES);
    expect(layout.view().canTakePicture).toBe(false);
  });

  it("stays on the game shown when its last item goes, so the canvas doesn't jump", () => {
    const { layout, world } = setup([clock("a", "elden"), clock("b", "poe2")]);
    layout.open("elden");
    world.items = world.items.filter((item) => item.gameId !== "elden");
    layout.refresh();
    expect(layout.view().gameId).toBe("elden");
    expect(layout.view().items).toEqual([]);
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_ALL_GAMES, "elden", "poe2"]);
  });

  it("shows the first game when the one asked for is not a game it knows", () => {
    const { layout } = setup([clock("b", "poe2")]);
    layout.open();
    expect(layout.view().gameId).toBe("poe2");
  });
});

describe("the canvas", () => {
  it("has the shape of the game window last seen, 1080 units high", () => {
    const { layout } = setup([clock("a")], { seen: { elden: { width: 3440, height: 1440 } } });
    layout.open("elden");
    expect(layout.view()).toMatchObject({ canvas: { width: 2580, height: 1080 }, seen: true });
  });

  it("takes the shape of the main screen until the game was seen", () => {
    const { layout } = setup([clock("a")]);
    layout.open("elden");
    expect(layout.view()).toMatchObject({ canvas: { width: 1920, height: 1080 }, seen: false });
  });

  it("places an item where it sits in the game window, in canvas units", () => {
    const { layout } = setup([clock("a", "elden", { h: "right", v: "bottom", x: 0.05, y: 0.05, width: 0.3, height: 0.2 })], { seen: { elden: { width: 1920, height: 1080 } } });
    layout.open("elden");
    expect(layout.view().items[0]!.placed).toEqual({ x: 1920 - 324 - 54, y: 1080 - 216 - 54, width: 324, height: 216 });
  });

  it("keeps a corner item in its corner on a wider canvas, at the same size", () => {
    const rect: AnchoredRect = { h: "right", v: "top", x: 0.05, y: 0.04, width: 0.3, height: 0.2 };
    const narrow = setup([clock("a", "elden", rect)], { seen: { elden: { width: 1920, height: 1080 } } });
    narrow.layout.open("elden");
    const wide = setup([clock("a", "elden", rect)], { seen: { elden: { width: 2520, height: 1080 } } });
    wide.layout.open("elden");
    const a = narrow.layout.view().items[0]!.placed;
    const b = wide.layout.view().items[0]!.placed;
    expect([b.width, b.height, b.y]).toEqual([a.width, a.height, a.y]);
    expect(b.x + b.width).toBe(2520 - 54);
  });

  it("shows an item that is not converted yet the old way on the canvas, whatever the canvas's shape", () => {
    const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
    for (const size of [{ width: 3440, height: 1440 }, { width: 1920, height: 1080 }]) {
      const { layout } = setup([{ ...clock("a"), legacy }], { seen: { elden: size } });
      layout.open("elden");
      const canvas = layout.view().canvas;
      expect(layout.view().items[0]!.placed).toEqual(placeLegacy(legacy, { x: 0, y: 0, ...canvas }));
    }
    // Before the game was seen too: the canvas takes the main screen's shape.
    const { layout } = setup([{ ...clock("a"), legacy }]);
    layout.open("elden");
    expect(layout.view().items[0]!.placed).toEqual(placeLegacy(legacy, { x: 0, y: 0, ...layout.view().canvas }));
  });

  it("anchors an unconverted item where it stands on the canvas when it is moved, and undo goes back to that place", () => {
    const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
    const { layout, world } = setup([{ ...clock("a"), legacy }], { seen: { elden: { width: 1920, height: 1080 } } });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const before = layout.view().items[0]!.placed;
    layout.handle({ type: "commit", id, rect: { x: 100, y: 100, width: 400, height: 200 } }, false);
    expect(world.items[0]!.legacy).toBeUndefined();
    expect(layout.view().items[0]!.placed).toEqual({ x: 100, y: 100, width: 400, height: 200 });
    layout.handle({ type: "undo" }, false);
    expect(layout.view().items[0]!.placed).toEqual(before);
  });

  it("has the grid cell the setting says, and remembers the setting", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open("elden");
    expect(layout.view()).toMatchObject({ grid: "normal", cell: 30 });
    for (const [grid, cell] of [["fine", 15], ["coarse", 60], ["off", 0]] as const) {
      layout.handle({ type: "grid", grid }, true);
      expect(world.grid).toBe(grid);
      expect(layout.view()).toMatchObject({ grid, cell });
    }
  });

  it("makes the smallest size the 48 pixels of the game window, in canvas units", () => {
    const { layout } = setup([clock("a")], { seen: { elden: { width: 2560, height: 1440 } } });
    layout.open("elden");
    expect(layout.view().minSize).toBeCloseTo(36, 5);
  });
});

describe("the live pages on the canvas", () => {
  it("puts each page where its item is, scaled to the canvas, with the zoom of the game window's height", () => {
    const { layout, lastPlace, bounds } = setup([clock("a", "elden", at(0.1, 0.1, 0.3, 0.2))], { seen: { elden: { width: 2560, height: 1440 } } });
    layout.open("elden");
    // Nothing to place before the shell says where the canvas is.
    expect(lastPlace()).toMatchObject({ frames: [], layer: null });
    bounds(540);
    const { frames, layer } = lastPlace();
    expect(layer).toEqual({ x: 300, y: 50, width: 960, height: 540 });
    expect(frames).toHaveLength(1);
    // Canvas units are 1080 high, the canvas is 540 px high: half. 0.1 of 1080 = 108 units = 54 px.
    expect(frames[0]!.bounds).toEqual({ x: 300 + 54, y: 50 + 54, width: 162, height: 108 });
    // Content is at its natural size in a 1080 px window; this game window is 1440 px high and the canvas draws it at 540 px.
    expect(frames[0]!.zoom).toBeCloseTo((1440 / 1080) * (540 / 1440), 5);
    expect(frames[0]).toMatchObject({ opacity: 1, visible: true });
  });

  it("draws toggle items faded when they are off, and with their opacity setting", () => {
    const { layout, lastPlace, bounds } = setup([
      { ...clock("on"), mode: "toggle", toggledOn: true },
      { ...clock("off"), mode: "toggle", toggledOn: false },
      { ...clock("soft"), opacity: 50 },
      { ...clock("both"), mode: "toggle", opacity: 50 },
    ]);
    layout.open("elden");
    bounds();
    expect(lastPlace().frames.map((frame) => frame.opacity)).toEqual([1, 0.5, 0.5, 0.25]);
    expect(layout.view().items.map((item) => item.off)).toEqual([false, true, false, true]);
  });

  it("shows a panel with no overlay page as a box, not a page", () => {
    const { layout, lastPlace, bounds } = setup([clock("a"), { ...clock("p"), panel: true, page: false }]);
    layout.open("elden");
    bounds();
    expect(lastPlace().frames).toHaveLength(1);
    expect(layout.view().items.map((item) => [item.kind, item.live])).toEqual([["overlay", true], ["panel", false]]);
  });

  it("hides an item on the canvas only, and brings it back", () => {
    const { layout, lastPlace, bounds, world } = setup([clock("a"), clock("b")]);
    layout.open("elden");
    bounds();
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "canvas-hidden", id, hidden: true }, true);
    expect(lastPlace().frames.map((frame) => frame.visible)).toEqual([false, true]);
    expect(layout.view().items[0]).toMatchObject({ hiddenOnCanvas: true });
    // Nothing changed over the game.
    expect(world.items[0]!.rect).toEqual(at(0.036, 0.03, 0.356, 0.16));
    layout.handle({ type: "canvas-hidden", id, hidden: false }, true);
    expect(lastPlace().frames.map((frame) => frame.visible)).toEqual([true, true]);
  });

  it("steps the pages aside while a list or menu is open over the canvas", () => {
    const { layout, lastPlace, bounds } = setup([clock("a")]);
    layout.open("elden");
    bounds();
    layout.handle({ type: "cover", covered: true }, true);
    expect(lastPlace().covered).toBe(true);
    layout.handle({ type: "cover", covered: false }, true);
    expect(lastPlace().covered).toBe(false);
    // Only the shell knows what is open over the page.
    layout.handle({ type: "cover", covered: true }, false);
    expect(lastPlace().covered).toBe(false);
  });

  it("places nothing while the canvas can't be drawn", () => {
    const { layout, lastPlace, bounds } = setup([clock("a")]);
    layout.open("elden");
    bounds();
    layout.handle({ type: "bounds", bounds: { x: 0, y: 0, width: 0, height: 0 } }, true);
    expect(lastPlace()).toMatchObject({ frames: [], layer: null });
    layout.handle({ type: "bounds", bounds: { x: 1, y: 1, width: 100, height: 50 } }, false);
    expect(lastPlace().layer).toBeNull();
  });
});

describe("moving and resizing", () => {
  const SEEN = { elden: { width: 1920, height: 1080 } };

  it("follows a drag with the live page, without keeping anything", () => {
    const { layout, lastPlace, bounds, world } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    bounds();
    layout.handle({ type: "drag", id: layout.view().items[0]!.id, rect: { x: 600, y: 400, width: 384, height: 173 } }, false);
    expect(lastPlace().frames[0]!.bounds).toEqual({ x: 300 + 300, y: 50 + 200, width: 192, height: 87 });
    expect(world.items[0]!.rect).toEqual(at(0.036, 0.03, 0.356, 0.16));
    expect(layout.view().canUndo).toBe(false);
  });

  it("keeps a dropped item as an anchored place, which the game shows at once", () => {
    const { layout, world } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "commit", id, rect: { x: 1400, y: 800, width: 400, height: 200 } }, false);
    expect(world.items[0]!.rect).toMatchObject({ h: "right", v: "bottom" });
    expect(placeAnchored(world.items[0]!.rect, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ x: 1400, y: 800, width: 400, height: 200 });
    expect(layout.view().items[0]!.placed).toEqual({ x: 1400, y: 800, width: 400, height: 200 });
  });

  it("keeps a general item's move in one game separate from All games and other games", () => {
    const { layout, world } = setup([{ key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }, clock("a", "elden"), clock("b", "poe2")], { seen: { elden: { width: 1920, height: 1080 }, poe2: { width: 2560, height: 1080 } } });
    layout.open("elden");
    const id = layout.view().items.find((item) => item.general)!.id;
    layout.handle({ type: "commit", id, rect: { x: 700, y: 300, width: 300, height: 200 } }, false);
    expect(layout.view().items.find((item) => item.general)).toMatchObject({ ownPosition: true, placed: { width: 300 } });
    const moved = world.items[0]!.rect;
    layout.handle({ type: "game", gameId: "poe2" }, true);
    // The same record is in the other game's canvas, at the same place for its own shape.
    expect(layout.view().items.find((item) => item.general)!.rect).toEqual(moved);
    expect(layout.view().items.find((item) => item.general)!.placed.width).toBe(216);
    expect(layout.view().items.find((item) => item.general)!.ownPosition).toBe(false);
  });

  it("keeps an item on the canvas and above the smallest size", () => {
    const { layout } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "commit", id, rect: { x: -500, y: 5000, width: 3, height: 99999 } }, false);
    const placed = layout.view().items[0]!.placed;
    expect(placed.x).toBe(0);
    expect(placed.width).toBe(48);
    expect(placed.y + placed.height).toBe(1080);
    expect(placed.height).toBe(1080);
  });

  it("ignores a drop that changes nothing, and an item that isn't there", () => {
    const { layout } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const item = layout.view().items[0]!;
    layout.handle({ type: "commit", id: item.id, rect: item.placed }, false);
    expect(layout.view().canUndo).toBe(false);
    layout.handle({ type: "commit", id: "nothing", rect: { x: 1, y: 1, width: 100, height: 100 } }, false);
    expect(layout.view().canUndo).toBe(false);
  });
});

describe("undo and redo", () => {
  const SEEN = { elden: { width: 1920, height: 1080 } };

  it("takes a move back and does it again", () => {
    const { layout, world } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const first = world.items[0]!.rect;
    layout.handle({ type: "commit", id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    const second = world.items[0]!.rect;
    layout.handle({ type: "commit", id, rect: { x: 900, y: 100, width: 400, height: 200 } }, false);
    const third = world.items[0]!.rect;
    expect(layout.view()).toMatchObject({ canUndo: true, canRedo: false });
    layout.handle({ type: "undo" }, false);
    expect(world.items[0]!.rect).toEqual(second);
    layout.handle({ type: "undo" }, true);
    expect(world.items[0]!.rect).toEqual(first);
    expect(layout.view()).toMatchObject({ canUndo: false, canRedo: true, selection: id });
    layout.handle({ type: "redo" }, false);
    layout.handle({ type: "redo" }, false);
    expect(world.items[0]!.rect).toEqual(third);
    // Nothing left to do again, nothing happens.
    layout.handle({ type: "redo" }, false);
    expect(world.items[0]!.rect).toEqual(third);
  });

  it("forgets what could be done again after a new change", () => {
    const { layout } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "commit", id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    layout.handle({ type: "undo" }, false);
    expect(layout.view().canRedo).toBe(true);
    layout.handle({ type: "commit", id, rect: { x: 700, y: 300, width: 400, height: 200 } }, false);
    expect(layout.view().canRedo).toBe(false);
  });

  it("counts Reset position as a change that can be taken back, and keeps the size", () => {
    const { layout, world } = setup([clock("a", "elden", at(0.5, 0.5, 0.2, 0.3))], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "reset", id }, true);
    expect(world.items[0]!.rect).toEqual({ ...DEFAULT_RECT, width: 0.2, height: 0.3 });
    // The canvas shows it in the corner where a new one starts, at the size it had.
    expect(layout.view().items[0]!.placed).toMatchObject({ x: 39, y: 32, width: 216, height: 324 });
    layout.handle({ type: "undo" }, true);
    expect(world.items[0]!.rect).toEqual(at(0.5, 0.5, 0.2, 0.3));
    layout.handle({ type: "redo" }, true);
    expect(world.items[0]!.rect).toEqual({ ...DEFAULT_RECT, width: 0.2, height: 0.3 });
  });

  it("moves an item anchored to another corner back to the top left with Reset position, a panel too", () => {
    const { layout, world } = setup([clock("a", "elden", { h: "right", v: "bottom", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }), { ...clock("p", "elden", at(0.4, 0.4, 0.3, 0.5)), panel: true }], { seen: SEEN });
    layout.open("elden");
    for (const item of layout.view().items) layout.handle({ type: "reset", id: item.id }, true);
    expect(world.items[0]!.rect).toEqual({ ...DEFAULT_RECT, width: 0.2, height: 0.2 });
    expect(world.items[1]!.rect).toEqual({ ...DEFAULT_RECT, width: 0.3, height: 0.5 });
  });

  it("makes no undo step when Reset position changes nothing", () => {
    const { layout } = setup([clock("a", "elden", { ...DEFAULT_RECT })], { seen: SEEN });
    layout.open("elden");
    layout.handle({ type: "reset", id: layout.view().items[0]!.id }, true);
    expect(layout.view().canUndo).toBe(false);
  });

  it("resets the size to what a new item of its kind gets, where it is, and can be taken back", () => {
    const { layout, world } = setup([clock("a", "elden", { h: "right", v: "bottom", x: 0.05, y: 0.06, width: 0.1, height: 0.1 }), { ...clock("p", "elden", at(0.4, 0.2, 0.1, 0.1)), panel: true }], {
      seen: SEEN,
      startSizes: { overlay: { width: 0.407, height: 0.093 }, panel: { width: 0.333, height: 0.185 } },
    });
    layout.open("elden");
    const [overlay, panel] = layout.view().items;
    layout.handle({ type: "reset-size", id: overlay!.id }, true);
    layout.handle({ type: "reset-size", id: panel!.id }, true);
    expect(world.items[0]!.rect).toEqual({ h: "right", v: "bottom", x: 0.05, y: 0.06, width: 0.407, height: 0.093 });
    expect(world.items[1]!.rect).toEqual(at(0.4, 0.2, 0.333, 0.185));
    // Worked out on the game's window.
    expect(world.sizedOn[0]).toEqual({ width: 1920, height: 1080 });
    layout.handle({ type: "undo" }, true);
    expect(world.items[1]!.rect).toEqual(at(0.4, 0.2, 0.1, 0.1));
    layout.handle({ type: "undo" }, true);
    expect(world.items[0]!.rect).toEqual({ h: "right", v: "bottom", x: 0.05, y: 0.06, width: 0.1, height: 0.1 });
    layout.handle({ type: "redo" }, true);
    expect(world.items[0]!.rect.width).toBe(0.407);
  });

  it("works Reset size out on the main screen's size while the game's window was never seen", () => {
    const { layout, world } = setup([clock("a", "elden", at(0.1, 0.1, 0.1, 0.1))]);
    layout.open("elden");
    layout.handle({ type: "reset-size", id: layout.view().items[0]!.id }, true);
    expect(world.sizedOn).toEqual([{ width: 2560, height: 1440 }]);
  });

  it("does not undo over a place the item was given since (moved in the game), and drops that step", () => {
    const { layout, world } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const first = world.items[0]!.rect;
    layout.handle({ type: "commit", id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    const second = world.items[0]!.rect;
    layout.handle({ type: "commit", id, rect: { x: 900, y: 300, width: 400, height: 200 } }, false);
    // Moved in the game, not in the layout.
    const inGame = at(0.3, 0.3, 0.2, 0.2);
    world.items[0]!.rect = inGame;
    // The newest step (to the third place) is stale: it is dropped, and the one before it is tried: also stale (the item is not at its place either).
    layout.handle({ type: "undo" }, false);
    expect(world.items[0]!.rect).toEqual(inGame);
    expect(layout.view().canUndo).toBe(false);
    expect(layout.view().canRedo).toBe(false);
    expect(first).not.toEqual(second);
  });

  it("undoes the step the item is still at, and skips a stale one on the way", () => {
    const { layout, world } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const first = world.items[0]!.rect;
    layout.handle({ type: "commit", id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    const second = world.items[0]!.rect;
    layout.handle({ type: "undo" }, false);
    expect(world.items[0]!.rect).toEqual(first);
    // Moved elsewhere while the step could be done again: redo is dropped, not applied over that place.
    const elsewhere = at(0.3, 0.3, 0.2, 0.2);
    world.items[0]!.rect = elsewhere;
    layout.handle({ type: "redo" }, false);
    expect(world.items[0]!.rect).toEqual(elsewhere);
    expect(layout.view().canRedo).toBe(false);
    expect(second).not.toEqual(first);
  });

  it("forgets where an item was dragged to when the drag ends without a drop", () => {
    const { layout, lastPlace, bounds } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    bounds();
    const item = layout.view().items[0]!;
    const home = lastPlace().frames[0]!.bounds;
    layout.handle({ type: "drag", id: item.id, rect: { x: 600, y: 400, width: 384, height: 173 } }, false);
    expect(lastPlace().frames[0]!.bounds).not.toEqual(home);
    layout.handle({ type: "drag-end" }, false);
    expect(lastPlace().frames[0]!.bounds).toEqual(home);
    expect(layout.view().items[0]!.placed).toEqual(item.placed);
  });

  it("drops the steps of an item that was removed, and starts over for another game", () => {
    const { layout, world } = setup([clock("a"), clock("b", "poe2")], { seen: { ...SEEN, poe2: { width: 1920, height: 1080 } } });
    layout.open("elden");
    layout.handle({ type: "commit", id: layout.view().items[0]!.id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    world.items = world.items.filter((item) => item.key !== "a");
    layout.refresh();
    expect(layout.view().canUndo).toBe(false);
    world.items.push(clock("c", "poe2"));
    layout.handle({ type: "game", gameId: "poe2" }, true);
    layout.handle({ type: "commit", id: layout.view().items[0]!.id, rect: { x: 500, y: 500, width: 400, height: 200 } }, false);
    expect(layout.view().canUndo).toBe(true);
    layout.handle({ type: "game", gameId: "elden" }, true);
    expect(layout.view()).toMatchObject({ canUndo: false, canRedo: false });
  });
});

describe("selection", () => {
  it("selects from the list or the canvas, and lets go when the item is gone", () => {
    const { layout, world } = setup([clock("a"), clock("b")]);
    layout.open("elden");
    const ids = layout.view().items.map((item) => item.id);
    layout.handle({ type: "select", id: ids[1]! }, true);
    expect(layout.view().selection).toBe(ids[1]);
    layout.handle({ type: "select", id: ids[0]! }, false);
    expect(layout.view().selection).toBe(ids[0]);
    world.items = world.items.filter((item) => item.key !== "a");
    layout.refresh();
    expect(layout.view().selection).toBeNull();
    layout.handle({ type: "select", id: null }, false);
    expect(layout.view().selection).toBeNull();
  });
});

describe("what the pages are told", () => {
  it("sends a view only when it changed", () => {
    const { layout, sent } = setup([clock("a")]);
    layout.open("elden");
    const count = sent.length;
    layout.refresh();
    layout.refresh();
    expect(sent.length).toBe(count);
    layout.handle({ type: "grid", grid: "fine" }, true);
    expect(sent.length).toBe(count + 1);
  });

  it("says when Game overlays are off", () => {
    const { layout } = setup([clock("a")], { enabled: false });
    layout.open("elden");
    expect(layout.view().enabled).toBe(false);
  });
});

describe("the game picture", () => {
  const SEEN = { elden: { width: 1920, height: 1080 }, poe2: { width: 1920, height: 1080 } };

  it("takes it from the game's window by the handle seen, and shows it", async () => {
    const { layout, world, flush, pictures } = setup([clock("a")], { handles: { elden: "131416" }, seen: { elden: { width: 2560, height: 1440 } } });
    layout.open("elden");
    expect(layout.view().canTakePicture).toBe(true);
    layout.handle({ type: "take-picture" }, true);
    await flush();
    expect(world.captured).toEqual([{ handle: "131416", size: { width: 2560, height: 1440 } }]);
    expect(await pictures.has("elden")).toBe(true);
    expect(layout.view().picture).toMatch(/^overlay-pictures\/[0-9a-f]{24}\.png\?v=\d+$/);
    expect(layout.view().notice).toBeNull();
  });

  it("asks for the shape of the main screen when the game's window was never seen, like the canvas", async () => {
    const { layout, world, flush } = setup([clock("a")], { handles: { elden: "131416" } });
    layout.open("elden");
    expect(layout.view().canvas).toEqual({ width: 1920, height: 1080 });
    layout.handle({ type: "take-picture" }, true);
    await flush();
    // The screen of this test is 2560 x 1440.
    expect(world.captured).toEqual([{ handle: "131416", size: { width: 2560, height: 1440 } }]);
  });

  it("refuses with a short notice when the game isn't running", async () => {
    const none = setup([clock("a")]);
    none.layout.open("elden");
    expect(none.layout.view().canTakePicture).toBe(false);
    expect(none.layout.view().pictureHint).toBe("start");
    none.layout.handle({ type: "take-picture" }, true);
    await none.flush();
    expect(none.world.captured).toEqual([]);
    expect(none.layout.view().notice).toBe("Start the game first.");
    expect(none.layout.view().picture).toBeNull();
    none.layout.handle({ type: "dismiss-notice" }, true);
    expect(none.layout.view().notice).toBeNull();

    // The handle is old: the window is gone and nothing can be captured.
    for (const capture of [null, "throws"] as const) {
      const gone = setup([clock("a")], { handles: { elden: "5" }, capture });
      gone.layout.open("elden");
      gone.layout.handle({ type: "take-picture" }, true);
      await gone.flush();
      expect(gone.layout.view().notice).toBe("Couldn't take a picture.");
      expect(await gone.pictures.has("elden")).toBe(false);
    }
  });

  it("can take a picture only while the game chosen runs and its window was seen, whichever window is in front", () => {
    const { layout, world } = setup([clock("a"), clock("b", "poe2")], { seen: SEEN, handles: { elden: "131416", poe2: "77" }, running: ["elden"] });
    layout.open("elden");
    expect(layout.view()).toMatchObject({ canTakePicture: true, pictureHint: null });
    // Another game in the picker: its window was seen once, but it doesn't run now.
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view()).toMatchObject({ canTakePicture: false, pictureHint: "start" });
    // It runs but its window was never seen in front: asked to switch to it once.
    world.running.add("poe2");
    delete world.handles.poe2;
    layout.refresh();
    expect(layout.view()).toMatchObject({ canTakePicture: false, pictureHint: "switch" });
    // The window is seen later: the open window hears of it without anything else happening.
    world.handles.poe2 = "77";
    layout.refresh();
    expect(layout.view()).toMatchObject({ canTakePicture: true, pictureHint: null });
  });

  it("follows the game starting and stopping while the window is open", () => {
    const { layout, world, sent } = setup([clock("a")], { seen: SEEN });
    layout.open("elden");
    expect(sent.at(-1)).toMatchObject({ canTakePicture: false, pictureHint: "start" });
    world.handles.elden = "131416";
    world.running.add("elden");
    layout.refresh();
    expect(sent.at(-1)).toMatchObject({ canTakePicture: true });
    world.running.delete("elden");
    delete world.handles.elden;
    layout.refresh();
    expect(sent.at(-1)).toMatchObject({ canTakePicture: false, pictureHint: "start" });
  });

  it("has no picture to take for All games", () => {
    const { layout } = setup([{ ...clock("g", "elden"), scope: "all" }], { handles: { elden: "5" } });
    layout.open(LAYOUT_ALL_GAMES);
    expect(layout.view()).toMatchObject({ gameId: LAYOUT_ALL_GAMES, canTakePicture: false });
  });

  it("takes a picture only on the shell's click, never a message from the layer", async () => {
    const { layout, world, flush } = setup([clock("a")], { handles: { elden: "5" } });
    layout.open("elden");
    layout.handle({ type: "take-picture" }, false);
    layout.handle({ type: "choose-picture" }, false);
    layout.handle({ type: "remove-picture" }, false);
    await flush();
    expect(world.captured).toEqual([]);
  });

  it("keeps a picture the player chose, tells when it can't be used, and does nothing when they cancel", async () => {
    const chosen = setup([clock("a")], { choose: PNG });
    chosen.layout.open("elden");
    chosen.layout.handle({ type: "choose-picture" }, true);
    await chosen.flush();
    expect(chosen.layout.view().picture).not.toBeNull();

    const bad = setup([clock("a")], { choose: "bad" });
    bad.layout.open("elden");
    bad.layout.handle({ type: "choose-picture" }, true);
    await bad.flush();
    expect(bad.layout.view()).toMatchObject({ picture: null, notice: "Can't use this picture." });

    const notPng = setup([clock("a")], { choose: Buffer.from("this is text") });
    notPng.layout.open("elden");
    notPng.layout.handle({ type: "choose-picture" }, true);
    await notPng.flush();
    expect(notPng.layout.view()).toMatchObject({ picture: null, notice: "Can't use this picture." });

    const cancelled = setup([clock("a")], { choose: "cancelled" });
    cancelled.layout.open("elden");
    cancelled.layout.handle({ type: "choose-picture" }, true);
    await cancelled.flush();
    expect(cancelled.layout.view()).toMatchObject({ picture: null, notice: null });
  });

  it("removes it, and keeps one picture per game", async () => {
    const { layout, flush, pictures } = setup([clock("a"), clock("b", "poe2")], { choose: PNG });
    layout.open("elden");
    layout.handle({ type: "choose-picture" }, true);
    await flush();
    expect(layout.view().picture).not.toBeNull();
    layout.handle({ type: "game", gameId: "poe2" }, true);
    await flush();
    expect(layout.view().picture).toBeNull();
    layout.handle({ type: "game", gameId: "elden" }, true);
    await flush();
    expect(layout.view().picture).not.toBeNull();
    layout.handle({ type: "remove-picture" }, true);
    await flush();
    expect(layout.view().picture).toBeNull();
    expect(await pictures.has("elden")).toBe(false);
  });

  it("is removed with the game", async () => {
    const { layout, flush, pictures } = setup([clock("a")], { choose: PNG });
    layout.open("elden");
    layout.handle({ type: "choose-picture" }, true);
    await flush();
    layout.forgetGame("elden");
    await flush();
    expect(await pictures.has("elden")).toBe(false);
  });
});
