import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GridSetting } from "../shared/layout-math";
import { LAYOUT_ALL_GAMES, LAYOUT_EVERYWHERE, type LayoutMessage, type LayoutView } from "../shared/layout-view";
import { DEFAULT_PANEL_ANCHORED, DEFAULT_RECT, placeAnchored, placeLegacy, type AnchoredRect, type LegacyRect } from "../shared/overlay-anchor";
import type { LayoutItemInfo, LayoutItemRef, LayoutSource } from "./game-overlay-service";
import type { SeenSize } from "./game-overlays";
import { LayoutPictures } from "./layout-pictures";
import { OverlayLayout, edgesToBounds, freeSpot, type LayoutFrame, type LayoutWindow, type SourcePanel } from "./overlay-layout";

let dir: string;
const layouts: OverlayLayout[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-overlay-layout-"));
});
afterEach(async () => {
  // The folder goes only after every picture write of the test has landed.
  await Promise.all(layouts.splice(0).map((layout) => layout.settled()));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("picture")]);
const SOURCE = { page: () => null, state: () => null, watch: () => null };
let setups = 0;
const at = (x: number, y: number, width: number, height: number): AnchoredRect => ({ h: "left", v: "top", x, y, width, height });

interface Item {
  key: string;
  /** The workspace the item was made in (a game workspace's id is its game's). */
  gameId: string;
  /** "all": made in a personal workspace. */
  scope: "game" | "all";
  /** The setup it is in: by default its game's, or All games for a general one. */
  setup?: string;
  rect: AnchoredRect;
  /** Not converted yet: the fractions of the window. */
  legacy?: LegacyRect;
  mode?: "always" | "toggle";
  toggledOn?: boolean;
  panel?: boolean;
  page?: boolean;
  opacity?: 100 | 75 | 50 | 25;
}

function setup(items: Item[], options: { seen?: Record<string, SeenSize>; handles?: Record<string, string>; running?: string[]; sources?: SourcePanel[]; startSizes?: { overlay?: { width: number; height: number }; panel?: { width: number; height: number } }; monitors?: { id: number; width: number; height: number }[]; capture?: Buffer | null | "throws"; choose?: Buffer | "cancelled" | "bad"; enabled?: boolean } = {}) {
  const sent: LayoutView[] = [];
  const placed: { frames: LayoutFrame[]; layer: { x: number; y: number; width: number; height: number } | null; covered: boolean }[] = [];
  const world = {
    items,
    grid: "normal" as GridSetting,
    /** The games that have a setup; one stays when its last item goes. */
    gameSetups: [...new Set(items.map((item) => setupOf(item)).filter((id) => id !== LAYOUT_ALL_GAMES && id !== LAYOUT_EVERYWHERE))],
    seen: { ...options.seen },
    opened: 0,
    destroyed: 0,
    left: 0,
    settingsOpened: [] as { workspaceId: string; moduleId: string; instanceId: string | null; key: string | null }[],
    overlaysAdded: [] as { setup: string; key: string }[],
    added: [] as { setup: string; instanceId: string }[],
    moved: [] as { from: string; to: string }[],
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
    const subject = { owner: "official", moduleId: "tavora.clock-counter", workspaceId: item.gameId, key: item.key };
    return {
      id: item.panel ? `panel\n${item.key}` : [subject.owner, subject.moduleId, subject.workspaceId, subject.key].join("\n"),
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
  const find = (setupId: string, ref: LayoutItemRef) =>
    world.items.find((item) => setupOf(item) === setupId && (ref.kind === "panel" ? item.panel && item.key === ref.instanceId : !item.panel && item.key === ref.subject.key && item.gameId === ref.subject.workspaceId));
  const source: LayoutSource = {
    items: (setupId) => world.items.filter((item) => setupOf(item) === setupId).map(info),
    setups: () => [LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES, ...world.gameSetups],
    seenSize: (gameId) => world.seen[gameId],
    handleOf: (gameId) => (world.running.has(gameId) ? (world.handles[gameId] ?? null) : null),
    gameRunning: (gameId) => world.running.has(gameId),
    gameWindow: () => null,
    grid: () => world.grid,
    setGrid: (grid) => void (world.grid = grid),
    running: () => [...world.running],
    addOverlay: (setupId, overlay) => {
      world.overlaysAdded.push({ setup: setupId, key: overlay.key });
      if (world.items.some((item) => setupOf(item) === setupId && !item.panel && item.key === overlay.key && item.gameId === overlay.workspaceId)) return "exists";
      world.items.push({ key: overlay.key, gameId: overlay.workspaceId, scope: overlay.workspaceId === "personal" ? "all" : "game", setup: setupId, rect: at(0.036, 0.03, 0.356, 0.16) });
      return "added";
    },
    addPanel: (setupId, panel) => {
      world.added.push({ setup: setupId, instanceId: panel.instanceId });
      world.items.push({ key: panel.instanceId, gameId: panel.workspaceId, scope: panel.workspaceId === "personal" ? "all" : "game", setup: setupId, rect: DEFAULT_PANEL_ANCHORED, panel: true });
      return "added";
    },
    move: (ref, from, to) => {
      const item = find(from, ref);
      if (!item) return "missing";
      world.moved.push({ from, to });
      item.setup = to;
      return "added";
    },
    setRect: (setupId, ref, rect) => {
      const item = find(setupId, ref);
      if (item) {
        item.rect = rect;
        delete item.legacy;
      }
      return item !== undefined;
    },
    startSize: (ref, size) => {
      world.sizedOn.push(size);
      return ref.kind === "panel" ? (options.startSizes?.panel ?? { width: DEFAULT_PANEL_ANCHORED.width, height: DEFAULT_PANEL_ANCHORED.height }) : (options.startSizes?.overlay ?? { width: DEFAULT_RECT.width, height: DEFAULT_RECT.height });
    },
    setOverlay: (_setup, _subject, change) => void world.changed.push({ overlay: change }),
    setPanel: (_setup, _id, change) => void world.changed.push({ panel: change }),
    remove: (_setup, ref) => void world.removed.push(ref),
    layerOpen: () => false,
  };
  const window: LayoutWindow = {
    destroy: () => void world.destroyed++,
    send: (view) => void sent.push(view),
    place: (frames, layer, covered) => void placed.push({ frames, layer, covered }),
  };
  const pictures = new LayoutPictures(path.join(dir, `pictures-${setups++}`));
  const layout = new OverlayLayout({
    source,
    pictures,
    workspaces: { name: (id) => ({ elden: "Elden Ring", poe2: "Path of Exile 2", personal: "Personal" })[id] ?? null },
    sources: () => options.sources ?? [],
    leave: () => void world.left++,
    openSettings: (target) => void world.settingsOpened.push(target),
    screen: () => ({ x: 0, y: 0, width: 2560, height: 1440 }),
    monitors: () => options.monitors ?? [],
    settings: {
      get gameOverlays() {
        return world.enabled;
      },
    },
    language: () => "en",
    keepRunning: (panels) => panels.map(() => true),
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
  layouts.push(layout);
  const last = () => sent.at(-1)!;
  const lastPlace = () => placed.at(-1)!;
  /** Lets the shell report where the canvas is: 1080 px high is the reference, so scale 1 for a 1920x1080 game. */
  const bounds = (height = 540, x = 300, y = 50) => layout.handle({ type: "bounds", bounds: { x, y, width: Math.round((height * 16) / 9), height } }, true);
  // The pictures are files: wait for the layout's own picture work, not for a guess of how long it takes.
  const flush = () => layout.settled();
  return { layout, world, sent, placed, last, lastPlace, bounds, flush, pictures };
}

/** The setup an item is in. */
const setupOf = (item: Item) => item.setup ?? (item.scope === "all" ? LAYOUT_ALL_GAMES : item.gameId);

const clock = (key: string, gameId = "elden", rect = at(0.036, 0.03, 0.356, 0.16)): Item => ({ key, gameId, scope: "game", rect });

describe("the views over the canvas", () => {
  it("never reach past the canvas by a rounding pixel", () => {
    const layer = { x: 97, y: 241, width: 918, height: 516 };
    const scale = layer.height / 1080;
    // 1536 + 384 is the canvas's right edge: the view ends where the layer ends, however the two numbers round.
    const bounds = edgesToBounds(layer, { x: 1536, y: 30, width: 384, height: 173 }, scale);
    expect(bounds.x + bounds.width).toBe(layer.x + Math.round(1920 * scale));
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(layer.x + layer.width);
    expect(edgesToBounds(layer, { x: 0, y: 0, width: 1, height: 1 }, scale)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("opening", () => {
  it("goes back to the workspace only when the page asks", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open();
    layout.handle({ type: "done" }, false);
    expect(world.left).toBe(0);
    layout.handle({ type: "done" }, true);
    expect(world.left).toBe(1);
  });
  it("offers All games alongside a game and shows only general items there", () => {
    const { layout } = setup([clock("own"), { ...clock("general", "personal"), scope: "all" }]);
    layout.open("elden");
    layout.handle({ type: "game", gameId: LAYOUT_ALL_GAMES }, true);
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES, "elden"]);
    expect(layout.view().items.map((item) => item.name)).toEqual(["general"]);
  });

  it("moves an item in the setup shown only, and undoes it there", () => {
    const general = { ...clock("general", "personal"), scope: "all" as const };
    const { layout, world } = setup([general, { ...general, rect: { ...general.rect }, setup: "elden" }]);
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    const base = { ...world.items[0]!.rect };
    layout.handle({ type: "commit", id, rect: { x: 600, y: 400, width: 300, height: 200 } }, false);
    expect(world.items[1]!.rect).not.toEqual(base);
    expect(world.items[0]!.rect).toEqual(base);
    layout.handle({ type: "undo" }, true);
    expect(world.items[1]!.rect).toEqual(base);
    layout.handle({ type: "redo" }, true);
    expect(world.items[1]!.rect).not.toEqual(base);
    expect(world.items[0]!.rect).toEqual(base);
    // Opened on another setup while open (from the rail, say): the steps of the one before stay with it.
    layout.handle({ type: "undo" }, true);
    layout.open("$all");
    expect(layout.view().gameId).toBe("$all");
    layout.handle({ type: "redo" }, true);
    expect(world.items[0]!.rect).toEqual(base);
    expect(world.items[1]!.rect).toEqual(base);
  });
  it("opens one canvas and only changes the setup when opened again", () => {
    const { layout, world } = setup([clock("a"), clock("b", "poe2")]);
    layout.open("elden");
    layout.open("poe2");
    expect(world.opened).toBe(1);
    expect(layout.view().gameId).toBe("poe2");
    expect(layout.isOpen).toBe(true);
  });

  it("opens on the running game's setup, else All games while a game runs, else Everywhere", () => {
    const own = setup([clock("a")], { running: ["elden"] });
    own.layout.open();
    expect(own.layout.view().gameId).toBe("elden");
    const other = setup([clock("a")], { running: ["poe2"] });
    other.layout.open();
    expect(other.layout.view().gameId).toBe(LAYOUT_ALL_GAMES);
    const none = setup([clock("a")]);
    none.layout.open();
    expect(none.layout.view().gameId).toBe(LAYOUT_EVERYWHERE);
  });

  it("stays on the setup it shows when opened again without one", () => {
    const { layout } = setup([clock("a")]);
    layout.open("elden");
    layout.open();
    expect(layout.view().gameId).toBe("elden");
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

describe("the setups of the picker", () => {
  it("lists Everywhere, All games and the games that have a setup, each with its own items", () => {
    const { layout } = setup([clock("a", "elden"), clock("b", "poe2"), { key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open("elden");
    const view = layout.view();
    expect(view.games).toEqual([{ id: LAYOUT_EVERYWHERE, name: "Everywhere" }, { id: LAYOUT_ALL_GAMES, name: "All games" }, { id: "elden", name: "Elden Ring" }, { id: "poe2", name: "Path of Exile 2" }]);
    expect(view.gameId).toBe("elden");
    expect(view.items.map((item) => item.name)).toEqual(["a"]);
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view().items.map((item) => item.name)).toEqual(["b"]);
    layout.handle({ type: "game", gameId: LAYOUT_ALL_GAMES }, true);
    expect(layout.view().items.map((item) => item.name)).toEqual(["g"]);
  });

  it("shows All games for a game that has no setup of its own: that is what shows over it", () => {
    const { layout } = setup([{ key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }, clock("b", "poe2")]);
    layout.open("elden");
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES, "poe2"]);
    expect(layout.view().gameId).toBe(LAYOUT_ALL_GAMES);
    expect(layout.view().items.map((item) => item.name)).toEqual(["g"]);
  });

  it("always lists Everywhere, on the main screen's shape", () => {
    const { layout, world } = setup([{ key: "e", gameId: "personal", scope: "all", setup: LAYOUT_EVERYWHERE, rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open(LAYOUT_EVERYWHERE);
    expect(layout.view().games).toEqual([{ id: LAYOUT_EVERYWHERE, name: "Everywhere" }, { id: LAYOUT_ALL_GAMES, name: "All games" }]);
    expect(layout.view()).toMatchObject({ gameId: LAYOUT_EVERYWHERE, canTakePicture: false, seen: false, canvas: { width: 1920, height: 1080 } });
    world.items = [];
    layout.refresh();
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES]);
  });

  it("shows All games with its general items and no picture to take", () => {
    const { layout } = setup([{ key: "g", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open(LAYOUT_ALL_GAMES);
    expect(layout.view().games).toEqual([{ id: LAYOUT_EVERYWHERE, name: "Everywhere" }, { id: LAYOUT_ALL_GAMES, name: "All games" }]);
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
    expect(layout.view().games.map((game) => game.id)).toEqual([LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES, "elden", "poe2"]);
  });

  it("shows All games when the setup asked for is not one it knows", () => {
    const { layout } = setup([clock("b", "poe2")]);
    layout.open("nowhere");
    expect(layout.view().gameId).toBe(LAYOUT_ALL_GAMES);
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

  it("keeps a move of an item in one game's setup apart from the same item in another setup", () => {
    const general = (setupId: string): Item => ({ key: "g", gameId: "personal", scope: "all", setup: setupId, rect: at(0.1, 0.1, 0.2, 0.2) });
    const { layout } = setup([general(LAYOUT_ALL_GAMES), general("elden"), general("poe2")], { seen: { elden: { width: 1920, height: 1080 }, poe2: { width: 2560, height: 1080 } } });
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "commit", id, rect: { x: 700, y: 300, width: 300, height: 200 } }, false);
    expect(layout.view().items[0]!.placed).toMatchObject({ x: 700, width: 300 });
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view().items[0]!.rect).toEqual(at(0.1, 0.1, 0.2, 0.2));
    expect(layout.view().items[0]!.placed.width).toBe(216);
    layout.handle({ type: "game", gameId: LAYOUT_ALL_GAMES }, true);
    expect(layout.view().items[0]!.rect).toEqual(at(0.1, 0.1, 0.2, 0.2));
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


describe("the toolbar and Del", () => {
  it("removes an item from the setup shown and lets go of the selection", () => {
    const { layout, world } = setup([clock("a"), clock("b")]);
    layout.open("elden");
    const ids = layout.view().items.map((item) => item.id);
    layout.handle({ type: "select", id: ids[0]! }, false);
    layout.handle({ type: "remove", id: ids[0]! }, false);
    expect(world.removed).toHaveLength(1);
    expect(layout.view().selection).toBeNull();
    // An id that is not in the setup changes nothing.
    layout.handle({ type: "remove", id: "nope" }, false);
    expect(world.removed).toHaveLength(1);
  });
  it("opens the settings of the thing an item shows", () => {
    const { layout, world } = setup([clock("a")]);
    layout.open("elden");
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "settings", id }, false);
    expect(world.settingsOpened).toEqual([{ workspaceId: "elden", moduleId: "tavora.clock-counter", instanceId: null, key: "a" }]);
    layout.handle({ type: "settings", id: "nope" }, false);
    expect(world.settingsOpened).toHaveLength(1);
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
    const { layout } = setup([{ ...clock("g", "personal"), scope: "all" }], { handles: { elden: "5" } });
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

  it("keeps a picture the user chose, tells when it can't be used, and does nothing when they cancel", async () => {
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
    layout.forgetWorkspace("elden");
    await flush();
    expect(await pictures.has("elden")).toBe(false);
  });
});

const panel = (instanceId: string, workspaceId: string, over: Partial<SourcePanel> = {}): SourcePanel => ({
  instanceId,
  name: instanceId,
  owner: "official",
  moduleId: "tavora.notes",
  workspaceId,
  workspaceName: workspaceId === "personal" ? "Personal" : workspaceId === "elden" ? "Elden Ring" : "Path of Exile 2",
  scope: workspaceId === "personal" ? "all" : "game",
  inGame: true,
  sources: null,
  ...over,
});

describe("a picture for every setup", () => {
  it("keeps one for Everywhere and one for All games, apart from each other and from the games'", async () => {
    const { layout, flush, pictures } = setup([clock("a")], { choose: PNG });
    layout.open(LAYOUT_EVERYWHERE);
    expect(layout.view().picture).toBeNull();
    layout.handle({ type: "choose-picture" }, true);
    await flush();
    expect(layout.view().picture).toMatch(/^overlay-pictures\/[0-9a-f]{24}\.png\?v=\d+$/);
    expect(await pictures.has(LAYOUT_EVERYWHERE)).toBe(true);
    expect(await pictures.has(LAYOUT_ALL_GAMES)).toBe(false);
    layout.handle({ type: "game", gameId: LAYOUT_ALL_GAMES }, true);
    await flush();
    expect(layout.view().picture).toBeNull();
    layout.handle({ type: "choose-picture" }, true);
    await flush();
    expect(layout.view().picture).not.toBeNull();
    layout.handle({ type: "game", gameId: "elden" }, true);
    await flush();
    expect(layout.view().picture).toBeNull();
    layout.handle({ type: "game", gameId: LAYOUT_EVERYWHERE }, true);
    await flush();
    layout.handle({ type: "remove-picture" }, true);
    await flush();
    expect(layout.view().picture).toBeNull();
    expect(await pictures.has(LAYOUT_EVERYWHERE)).toBe(false);
    expect(await pictures.has(LAYOUT_ALL_GAMES)).toBe(true);
  });

  it("takes no picture of the screen for Everywhere and All games", async () => {
    const { layout, world, flush } = setup([clock("a")], { handles: { elden: "5" } });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "take-picture" }, true);
    await flush();
    expect(world.captured).toEqual([]);
    expect(layout.view().picture).toBeNull();
  });
});

describe("Preview as", () => {
  const MONITORS = [
    { id: 7, width: 2560, height: 1440 },
    { id: 9, width: 3440, height: 1440 },
  ];
  const find = (view: LayoutView, choice: string) => view.preview.options.find((option) => option.id === choice);

  it("lists the setup's own shape, the usual ratios and every monitor", () => {
    const { layout } = setup([clock("a")], { seen: { elden: { width: 2560, height: 1080 } }, monitors: MONITORS });
    layout.open("elden");
    expect(layout.view().preview).toEqual({
      choice: "default",
      options: [
        { id: "default", label: "Game window · 21:9" },
        { id: "16:9", label: "16:9" },
        { id: "16:10", label: "16:10" },
        { id: "21:9", label: "21:9" },
        { id: "32:9", label: "32:9" },
        { id: "monitor:7", label: "Monitor 1 · 2560×1440" },
        { id: "monitor:9", label: "Monitor 2 · 3440×1440" },
      ],
    });
    layout.open(LAYOUT_EVERYWHERE);
    expect(layout.view().preview.options[0]).toEqual({ id: "default", label: "This screen · 16:9" });
  });

  it("changes only the canvas's shape, never what is saved", () => {
    const { layout, world } = setup([{ ...clock("a"), rect: { h: "right", v: "bottom", x: 0.05, y: 0.04, width: 0.2, height: 0.1 } }], { seen: { elden: { width: 1920, height: 1080 } }, monitors: MONITORS });
    layout.open("elden");
    const before = layout.view().items[0]!;
    expect(before.placed).toMatchObject({ x: 1920 - 216 - 54 });
    layout.handle({ type: "preview", choice: "32:9" }, true);
    const wide = layout.view();
    expect(wide.canvas).toEqual({ width: 3840, height: 1080 });
    expect(wide.preview.choice).toBe("32:9");
    // Anchored to the right and bottom edges: the frame follows them to the wider canvas.
    expect(wide.items[0]!.placed).toMatchObject({ x: 3840 - 216 - 54, y: 1080 - 108 - 43, width: 216, height: 108 });
    expect(wide.items[0]!.rect).toEqual(before.rect);
    expect(world.items[0]!.rect).toEqual(before.rect);
    layout.handle({ type: "preview", choice: "monitor:9" }, true);
    expect(layout.view().canvas).toEqual({ width: Math.round((1080 * 3440) / 1440), height: 1080 });
    layout.handle({ type: "preview", choice: "default" }, true);
    expect(layout.view().canvas).toEqual({ width: 1920, height: 1080 });
    expect(layout.view().items[0]!.placed).toEqual(before.placed);
  });

  it("saves a drag in another shape through the anchored rectangle, so it lands right in the real one", () => {
    const { layout, world } = setup([clock("a")], { seen: { elden: { width: 1920, height: 1080 } } });
    layout.open("elden");
    layout.handle({ type: "preview", choice: "21:9" }, true);
    const { id } = layout.view().items[0]!;
    // 2520 wide: dropped 40 from the right edge of the wide canvas, 100 from the top.
    layout.handle({ type: "commit", id, rect: { x: 2520 - 40 - 300, y: 100, width: 300, height: 200 } }, false);
    expect(world.items[0]!.rect).toMatchObject({ h: "right", v: "top", width: 300 / 1080, height: 200 / 1080 });
    expect(world.items[0]!.rect.x).toBeCloseTo(40 / 1080);
    expect(layout.view().items[0]!.placed).toEqual({ x: 2520 - 40 - 300, y: 100, width: 300, height: 200 });
    layout.handle({ type: "preview", choice: "default" }, true);
    expect(layout.view().items[0]!.placed).toEqual({ x: 1920 - 40 - 300, y: 100, width: 300, height: 200 });
    // And undo goes back through the same rectangle.
    layout.handle({ type: "undo" }, true);
    expect(layout.view().items[0]!.placed).toMatchObject({ x: 39, y: 32 });
  });

  it("saves a resize, Reset position and Reset size in another shape through the anchored rectangle, and undo takes them back", () => {
    const start: AnchoredRect = { h: "right", v: "bottom", x: 0.05, y: 0.06, width: 0.1, height: 0.1 };
    const { layout, world } = setup([{ ...clock("a"), rect: start }], { seen: { elden: { width: 1920, height: 1080 } }, startSizes: { overlay: { width: 0.2, height: 0.12 } } });
    layout.open("elden");
    layout.handle({ type: "preview", choice: "32:9" }, true);
    const { id, placed } = layout.view().items[0]!;
    expect(placed).toEqual({ x: 3840 - 108 - 54, y: 1080 - 108 - 65, width: 108, height: 108 });
    // Wider on its left side (the layer's resize handle): still anchored to the right and bottom, now 300 wide.
    layout.handle({ type: "commit", id, rect: { x: placed.x - 192, y: placed.y, width: 300, height: placed.height } }, false);
    expect(world.items[0]!.rect).toMatchObject({ h: "right", v: "bottom", width: 300 / 1080, height: 0.1 });
    expect(world.items[0]!.rect.x).toBeCloseTo(0.05);
    expect(layout.view().items[0]!.placed).toEqual({ x: 3840 - 300 - 54, y: placed.y, width: 300, height: 108 });
    layout.handle({ type: "reset-size", id }, true);
    expect(world.items[0]!.rect).toMatchObject({ h: "right", v: "bottom", width: 0.2, height: 0.12 });
    layout.handle({ type: "reset", id }, true);
    expect(world.items[0]!.rect).toEqual({ ...DEFAULT_RECT, width: 0.2, height: 0.12 });
    layout.handle({ type: "undo" }, true);
    layout.handle({ type: "undo" }, true);
    layout.handle({ type: "undo" }, true);
    expect(world.items[0]!.rect).toEqual(start);
    layout.handle({ type: "preview", choice: "default" }, true);
    expect(layout.view().items[0]!.placed).toEqual({ x: 1920 - 108 - 54, y: 1080 - 108 - 65, width: 108, height: 108 });
  });

  it("starts a frame added in another shape inside the setup's real window, as without the preview", () => {
    const things = [{ key: "d-1", name: "Countdown", size: { width: 120, height: 48 } }];
    const rects = [] as AnchoredRect[];
    for (const choice of ["default", "32:9"]) {
      const { layout, world } = setup([], { sources: [panel("cc", "personal", { moduleId: "tavora.clock-counter", sources: things })] });
      layout.open(LAYOUT_EVERYWHERE);
      layout.handle({ type: "preview", choice }, true);
      layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
      rects.push(world.items[0]!.rect);
    }
    expect(rects[1]).toEqual(rects[0]);
  });

  it("is remembered per setup, only from the page, and only for choices the setup has", () => {
    const { layout } = setup([clock("a"), clock("b", "poe2")], { seen: { elden: { width: 1920, height: 1080 } }, monitors: MONITORS });
    layout.open("elden");
    layout.handle({ type: "preview", choice: "21:9" }, false);
    expect(layout.view().preview.choice).toBe("default");
    layout.handle({ type: "preview", choice: "4:3" }, true);
    layout.handle({ type: "preview", choice: "monitor:99" }, true);
    expect(layout.view().preview.choice).toBe("default");
    layout.handle({ type: "preview", choice: "21:9" }, true);
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view().preview.choice).toBe("default");
    layout.handle({ type: "preview", choice: "16:10" }, true);
    layout.handle({ type: "game", gameId: "elden" }, true);
    expect(layout.view()).toMatchObject({ preview: { choice: "21:9" }, canvas: { width: 2520 } });
    layout.handle({ type: "game", gameId: "poe2" }, true);
    expect(layout.view().preview.choice).toBe("16:10");
  });

  it("falls back to the setup's own shape when the monitor is unplugged", () => {
    const monitors = [...MONITORS];
    const { layout } = setup([clock("a")], { monitors });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "preview", choice: "monitor:9" }, true);
    expect(find(layout.view(), "monitor:9")).toBeDefined();
    monitors.pop();
    layout.refresh();
    expect(layout.view()).toMatchObject({ preview: { choice: "default" }, canvas: { width: 1920, height: 1080 } });
  });

  it("places an item that isn't converted yet by its real shape, then anchors it", () => {
    const { layout } = setup([{ ...clock("a"), legacy: { x: 0.75, y: 0.1, width: 0.2, height: 0.2 } }], { seen: { elden: { width: 1920, height: 1080 } } });
    layout.open("elden");
    const real = layout.view().items[0]!;
    expect(real.placed).toMatchObject({ x: 1440, width: 384 });
    layout.handle({ type: "preview", choice: "32:9" }, true);
    // It was nearest the right edge in the real shape, so it stays 96 from it.
    expect(layout.view().items[0]!.placed).toMatchObject({ x: 3840 - 384 - 96, y: 108, width: 384, height: 216 });
    expect(layout.view().items[0]!.rect).toEqual(real.rect);
  });
});

describe("the sources", () => {
  const sources = [panel("notes", "personal"), panel("map", "elden"), panel("build", "poe2"), panel("timer", "personal", { inGame: false })];

  it("lists every panel of every workspace with its workspace and why one cannot be added", () => {
    const { layout } = setup([clock("a", "elden"), clock("b", "poe2")], { sources });
    layout.open("elden");
    expect(layout.view().sources).toEqual([
      { id: "notes", name: "notes", moduleId: "tavora.notes", from: "Personal", game: null, block: null, children: null },
      { id: "map", name: "map", moduleId: "tavora.notes", from: "Elden Ring", game: "Elden Ring", block: null, children: null },
      { id: "build", name: "build", moduleId: "tavora.notes", from: "Path of Exile 2", game: "Path of Exile 2", block: "game-only", children: null },
      { id: "timer", name: "timer", moduleId: "tavora.notes", from: "Personal", game: null, block: "not-in-game", children: null },
    ]);
  });

  it("lets a personal panel go into Everywhere and All games, and a game panel only into its own setup", () => {
    const { layout } = setup([clock("a", "elden")], { sources });
    for (const setupId of [LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES]) {
      layout.open(setupId);
      const blocks = Object.fromEntries(layout.view().sources.map((source) => [source.id, source.block]));
      expect(blocks).toEqual({ notes: null, map: "game-only", build: "game-only", timer: "not-in-game" });
    }
  });

  it("marks a panel the setup holds and a setup that is full", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ ...clock(`c${index}`, "elden"), ...(index === 0 ? { key: "notes", panel: true } : {}) }));
    const { layout } = setup(items, { sources });
    layout.open("elden");
    const blocks = Object.fromEntries(layout.view().sources.map((source) => [source.id, source.block]));
    expect(blocks).toMatchObject({ notes: "in-setup", map: "full" });
    expect(layout.view().limit).toBe(8);
  });

  it("adds a panel to the setup shown and selects it", () => {
    const { layout, world } = setup([clock("a", "elden")], { sources });
    layout.open("elden");
    layout.handle({ type: "add-source", id: "map" }, true);
    expect(world.added).toEqual([{ setup: "elden", instanceId: "map" }]);
    expect(layout.view().items.map((item) => item.name)).toEqual(["a", "map"]);
    expect(layout.view().selection).toBe("panel\nmap");
  });

  it("adds a personal panel to Everywhere", () => {
    const { layout, world } = setup([], { sources });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "add-source", id: "notes" }, true);
    expect(world.added).toEqual([{ setup: LAYOUT_EVERYWHERE, instanceId: "notes" }]);
  });

  it("adds nothing that cannot go there, that is unknown, or on the layer's word", () => {
    const { layout, world } = setup([clock("a", "elden")], { sources });
    layout.open("elden");
    for (const id of ["build", "timer", "nothing"]) layout.handle({ type: "add-source", id }, true);
    layout.handle({ type: "add-source", id: "map" }, false);
    expect(world.added).toEqual([]);
  });

  it("says so when the setup is full", () => {
    const items = Array.from({ length: 8 }, (_, index) => clock(`c${index}`, "elden"));
    const { layout, world } = setup(items, { sources });
    layout.open("elden");
    layout.handle({ type: "add-source", id: "map" }, true);
    expect(world.added).toEqual([]);
    expect(layout.view().notice).toMatch(/room/i);
  });
});

describe("what a panel lists", () => {
  const things = [
    { key: "d-1", name: "Countdown", size: { width: 120, height: 48 } },
    { key: "g-1", name: "7 Deaths", group: true, size: { width: 200, height: 48 } },
  ];
  const counter = (over: Partial<SourcePanel> = {}) => panel("cc", "personal", { moduleId: "tavora.clock-counter", sources: things, ...over });
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("makes the panel a header over its things, in the panel's order", () => {
    const { layout } = setup([], { sources: [counter(), panel("notes", "elden")] });
    layout.open(LAYOUT_EVERYWHERE);
    const [header, notes] = layout.view().sources;
    expect(header).toMatchObject({
      id: "cc",
      block: null,
      children: [
        { key: "d-1", name: "Countdown", group: false, item: null, block: null },
        { key: "g-1", name: "7 Deaths", group: true, item: null, block: null },
      ],
    });
    expect(notes!.children).toBeNull();
  });

  it("adds a thing by its key, never the panel as a whole", () => {
    const { layout, world } = setup([], { sources: [counter()] });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "add-source", id: "cc" }, true);
    layout.handle({ type: "add-source", id: "cc", key: "nope" }, true);
    expect(world.overlaysAdded).toEqual([]);
    expect(world.added).toEqual([]);
    layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
    expect(world.overlaysAdded).toEqual([{ setup: LAYOUT_EVERYWHERE, key: "d-1" }]);
    const view = layout.view();
    expect(view.items.map((item) => item.name)).toEqual(["Countdown"]);
    expect(view.selection).toBe(view.items[0]!.id);
    expect(view.sources[0]!.children![0]).toMatchObject({ key: "d-1", item: view.items[0]!.id, block: "in-setup" });
    expect(view.sources[0]!.block).toBe("in-setup");
    // Again: it is selected, not added a second time.
    layout.handle({ type: "select", id: null }, true);
    layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
    expect(world.overlaysAdded).toHaveLength(1);
    expect(layout.view().selection).toBe(view.items[0]!.id);
  });

  it("starts a new frame at the size its content needs, on the grid, and where no other frame is", () => {
    const { layout } = setup([], { sources: [counter()] });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
    layout.handle({ type: "add-source", id: "cc", key: "g-1" }, true);
    const [first, second] = layout.view().items.map((item) => item.placed);
    // The content and a little room around it, snapped up to the grid: not the size a panel starts with.
    expect(first!.width).toBeGreaterThanOrEqual(136);
    expect(first!.width).toBeLessThan(180);
    expect(first!.height).toBeGreaterThanOrEqual(64);
    expect(first!.height).toBeLessThan(110);
    expect(second!.width).toBeGreaterThanOrEqual(216);
    expect(overlaps(first!, second!)).toBe(false);
  });

  it("leaves a frame its panel said nothing about at the size it starts with", () => {
    const { layout } = setup([], { sources: [counter({ sources: [{ key: "d-1", name: "Countdown" }] })] });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
    expect(layout.view().items[0]!.placed.width).toBeGreaterThan(300);
  });

  it("puts Reset size back to what the content needs, where the frame is", () => {
    const { layout } = setup([], { sources: [counter()] });
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "add-source", id: "cc", key: "d-1" }, true);
    const item = layout.view().items[0]!;
    layout.handle({ type: "commit", id: item.id, rect: { x: 400, y: 300, width: 500, height: 400 } }, false);
    expect(layout.view().items[0]!.placed.width).toBe(500);
    layout.handle({ type: "reset-size", id: item.id }, false);
    expect(layout.view().items[0]!.placed).toMatchObject({ x: 400, y: 300, width: item.placed.width, height: item.placed.height });
  });
});

describe("freeSpot", () => {
  const canvas = { width: 1920, height: 1080 };
  it("is the corner where new items start while nothing is there", () => {
    expect(freeSpot({ width: 100, height: 50 }, canvas, [], 0)).toEqual({ x: 39, y: 32 });
  });
  it("goes down past what is there, then across", () => {
    const first = { x: 39, y: 32, width: 100, height: 50 };
    expect(freeSpot({ width: 100, height: 50 }, canvas, [first], 0).y).toBeGreaterThanOrEqual(90);
    const column = Array.from({ length: 20 }, (_, index) => ({ x: 39, y: 32 + index * 58, width: 100, height: 50 }));
    const spot = freeSpot({ width: 100, height: 50 }, canvas, column, 0);
    expect(spot.x).toBeGreaterThanOrEqual(147);
  });
  it("snaps to the grid", () => {
    expect(freeSpot({ width: 100, height: 50 }, canvas, [], 24)).toEqual({ x: 48, y: 24 });
  });
});

describe("adding and moving", () => {
  it("has no way to add a game's setup: that is only on the rail", () => {
    const { layout, world } = setup([clock("a", "elden")]);
    layout.open("elden");
    layout.handle({ type: "add-setup", gameId: "poe2" } as unknown as LayoutMessage, true);
    expect(world.gameSetups).toEqual(["elden"]);
    expect(layout.view().gameId).toBe("elden");
  });

  it("offers a personal item every other setup, and a game's own item none", () => {
    const personal = (setupId: string): Item => ({ key: "p", gameId: "personal", scope: "all", setup: setupId, rect: at(0.1, 0.1, 0.2, 0.2) });
    const everywhere = setup([personal(LAYOUT_EVERYWHERE), clock("own", "elden")]);
    everywhere.layout.open(LAYOUT_EVERYWHERE);
    expect(everywhere.layout.view().items[0]!.moveTargets.map((target) => target.id)).toEqual([LAYOUT_ALL_GAMES, "elden"]);
    expect(everywhere.layout.view().items[0]!.moveTargets[1]!.name).toBe("Elden Ring");
    const all = setup([personal(LAYOUT_ALL_GAMES), clock("own", "elden")]);
    all.layout.open(LAYOUT_ALL_GAMES);
    expect(all.layout.view().items[0]!.moveTargets.map((target) => target.id)).toEqual([LAYOUT_EVERYWHERE, "elden"]);
    all.layout.open("elden");
    expect(all.layout.view().items.map((item) => item.moveTargets)).toEqual([[]]);
  });

  it("does not offer a game's own item a move, nor a game's setup's item another game's", () => {
    const { layout } = setup([{ key: "p", gameId: "personal", scope: "all", setup: "elden", rect: at(0.1, 0.1, 0.2, 0.2) }, clock("own", "elden")]);
    layout.open("elden");
    const [personal, own] = layout.view().items;
    expect(own!.moveTargets).toEqual([]);
    expect(personal!.moveTargets.map((target) => target.id)).toEqual([LAYOUT_EVERYWHERE, LAYOUT_ALL_GAMES]);
  });

  it("moves an item to the other setup and lets go of the selection", () => {
    const { layout, world } = setup([{ key: "p", gameId: "personal", scope: "all", setup: LAYOUT_EVERYWHERE, rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open(LAYOUT_EVERYWHERE);
    const id = layout.view().items[0]!.id;
    layout.handle({ type: "select", id }, true);
    layout.handle({ type: "move", id, to: LAYOUT_ALL_GAMES }, true);
    expect(world.moved).toEqual([{ from: LAYOUT_EVERYWHERE, to: LAYOUT_ALL_GAMES }]);
    expect(layout.view().items).toEqual([]);
    expect(layout.view().selection).toBeNull();
  });

  it("moves nothing that cannot move, or on the layer's word", () => {
    const { layout, world } = setup([clock("own", "elden"), { key: "p", gameId: "personal", scope: "all", setup: LAYOUT_EVERYWHERE, rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open("elden");
    layout.handle({ type: "move", id: layout.view().items[0]!.id, to: LAYOUT_EVERYWHERE }, true);
    layout.open(LAYOUT_EVERYWHERE);
    layout.handle({ type: "move", id: layout.view().items[0]!.id, to: LAYOUT_ALL_GAMES }, false);
    // Nor to a setup it may not go to.
    layout.handle({ type: "move", id: layout.view().items[0]!.id, to: "nowhere" }, true);
    expect(world.moved).toEqual([]);
  });

  it("names the workspace an item comes from", () => {
    const { layout } = setup([clock("own", "elden"), { key: "p", gameId: "personal", scope: "all", rect: at(0.1, 0.1, 0.2, 0.2) }]);
    layout.open("elden");
    expect(layout.view().items[0]!.from).toBe("Elden Ring");
    layout.open(LAYOUT_ALL_GAMES);
    expect(layout.view().items[0]!.from).toBe("Personal");
  });
});
