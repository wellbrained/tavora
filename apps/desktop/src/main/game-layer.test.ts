import { describe, expect, it } from "vitest";
import { DEFAULT_RECT } from "../shared/overlay-anchor";
import { LAYER_CLOSED, WATCH_START, awayOf, frontOf, layerScene, layerStep, watchStep, type FrontGame, type LayerEvent, type LayerLook, type LayerState, type SceneInput, type Watch, type WatchEvent } from "./game-layer";
import { ALL_GAMES, EVERYWHERE, liveWindowId, overlayId, panelWindowId, type GameOverlay, type InGamePanel, type Rect } from "./game-overlays";

const GAME: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const SCREEN: Rect = { x: 0, y: 0, width: 2560, height: 1440 };

const look = (change: Partial<LayerLook> = {}): LayerLook => ({ front: "elden", frontWindow: "w1", foregroundWindow: "w1", exclusive: false, ...change });
const open = (change: Partial<Extract<LayerState, { status: "open" }>> = {}): LayerState => ({ status: "open", game: "elden", window: "w1", mode: "use", ...change });

describe("layerStep", () => {
  const cases: { name: string; state: LayerState; event: LayerEvent; next: LayerState; effect: string; refocus?: boolean }[] = [
    { name: "the key opens it over the game in front, in Use, bound to its window", state: LAYER_CLOSED, event: { type: "key", look: look() }, next: open(), effect: "opened" },
    {
      name: "the key opens it over the screen with no game in front, bound to the window in front",
      state: LAYER_CLOSED,
      event: { type: "key", look: look({ front: null, frontWindow: null, foregroundWindow: "desk" }) },
      next: open({ game: null, window: "desk" }),
      effect: "opened",
    },
    { name: "the key says why instead over a game that owns the screen", state: LAYER_CLOSED, event: { type: "key", look: look({ exclusive: true }) }, next: LAYER_CLOSED, effect: "exclusive" },
    { name: "the key closes an open layer and gives the game the keyboard", state: open({ mode: "arrange" }), event: { type: "key", look: look() }, next: LAYER_CLOSED, effect: "closed", refocus: true },
    { name: "Esc closes it and gives the game the keyboard", state: open(), event: { type: "close", refocus: true }, next: LAYER_CLOSED, effect: "closed", refocus: true },
    { name: "Tavora coming in front closes it, keyboard to nobody", state: open(), event: { type: "close", refocus: false }, next: LAYER_CLOSED, effect: "closed", refocus: false },
    { name: "closing a closed layer does nothing", state: LAYER_CLOSED, event: { type: "close", refocus: true }, next: LAYER_CLOSED, effect: "none" },
    { name: "the card switches to Arrange", state: open(), event: { type: "mode", mode: "arrange" }, next: open({ mode: "arrange" }), effect: "changed" },
    { name: "the same mode again changes nothing", state: open(), event: { type: "mode", mode: "use" }, next: open(), effect: "none" },
    { name: "a mode while closed is ignored", state: LAYER_CLOSED, event: { type: "mode", mode: "arrange" }, next: LAYER_CLOSED, effect: "none" },
    { name: "a look with the same game and window keeps it", state: open(), event: { type: "look", look: look(), tavoraFront: false, showing: true }, next: open(), effect: "none" },
    { name: "it ends when the game leaves the front", state: open(), event: { type: "look", look: look({ front: null }), tavoraFront: false, showing: true }, next: LAYER_CLOSED, effect: "closed", refocus: false },
    { name: "it ends when another window of the game is in front", state: open(), event: { type: "look", look: look({ frontWindow: "w2" }), tavoraFront: false, showing: true }, next: LAYER_CLOSED, effect: "closed" },
    { name: "a layer opened before the window was known stays with any", state: open({ window: null }), event: { type: "look", look: look({ frontWindow: "w2" }), tavoraFront: false, showing: true }, next: open({ window: null }), effect: "none" },
    { name: "it ends when the game goes exclusive full screen", state: open(), event: { type: "look", look: look({ exclusive: true }), tavoraFront: false, showing: true }, next: LAYER_CLOSED, effect: "closed" },
    { name: "it ends when nothing shows for the keys any more", state: open(), event: { type: "look", look: look(), tavoraFront: false, showing: false }, next: LAYER_CLOSED, effect: "closed" },
    {
      name: "one over the screen ends when Tavora's window comes in front",
      state: open({ game: null, window: "desk" }),
      event: { type: "look", look: look({ front: null, foregroundWindow: "desk" }), tavoraFront: true, showing: true },
      next: LAYER_CLOSED,
      effect: "closed",
    },
    {
      name: "one over the game stays while Tavora's window is in front (a panel took the keyboard)",
      state: open(),
      event: { type: "look", look: look(), tavoraFront: true, showing: true },
      next: open(),
      effect: "none",
    },
    { name: "a look while closed does nothing", state: LAYER_CLOSED, event: { type: "look", look: look(), tavoraFront: false, showing: true }, next: LAYER_CLOSED, effect: "none" },
    { name: "a reset closes it quietly", state: open(), event: { type: "reset" }, next: LAYER_CLOSED, effect: "ended" },
  ];
  for (const one of cases) {
    it(one.name, () => {
      const { state, effect } = layerStep(one.state, one.event);
      expect(state).toEqual(one.next);
      expect(effect.type).toBe(one.effect);
      if (one.refocus !== undefined) expect(effect).toMatchObject({ refocus: one.refocus });
    });
  }

  it("never changes the state it is given", () => {
    const state = open();
    layerStep(state, { type: "mode", mode: "arrange" });
    expect(state).toEqual(open());
  });
});

const settings = { mode: "always" as const, opacity: 100 as const, hideFromCapture: false, rect: { ...DEFAULT_RECT } };
const overlay = (key: string, change: Partial<GameOverlay> = {}): GameOverlay => ({ owner: "official", moduleId: "tavora.clock-counter", workspaceId: "elden", key, ...settings, ...change });
const panel = (instanceId: string, change: Partial<InGamePanel> = {}): InGamePanel => ({ owner: "official", moduleId: "tavora.todos", workspaceId: "elden", instanceId, ...settings, ...change });

/** A scene's input over setups held in memory: `setups` maps a setup's id to its overlays and panels. */
function input(setups: Record<string, { overlays?: GameOverlay[]; panels?: InGamePanel[] }>, change: Partial<SceneInput> = {}): SceneInput {
  const of = (id: string) => setups[id] ?? {};
  return {
    active: true,
    layer: LAYER_CLOSED,
    front: "elden",
    game: GAME,
    setups: Object.keys(setups),
    areaOf: (id) => (id === EVERYWHERE ? SCREEN : GAME),
    store: {
      all: () => Object.values(setups).flatMap((setup) => setup.overlays ?? []),
      panels: () => Object.values(setups).flatMap((setup) => setup.panels ?? []),
      overlaysIn: (id) => of(id).overlays ?? [],
      panelsIn: (id) => of(id).panels ?? [],
    },
    toggled: new Set(),
    stopped: new Set(),
    usable: () => true,
    hasLive: () => true,
    card: (mode) => ({ mode }) as never,
    awayHandle: 0,
    make: { overlay: () => ({}) as never, panel: () => ({}) as never, live: () => ({}) as never },
    ...change,
  };
}

const shownIds = (scene: ReturnType<typeof layerScene>) => scene.items.filter((item) => item.look !== null).map((item) => item.id);

describe("watchStep", () => {
  const FRONT: FrontGame = { game: "elden", bounds: GAME, window: "w1", notification: 2 };
  const KEPT: Rect = { x: 100, y: 100, width: 1280, height: 720 };
  const watch = (change: Partial<Watch> = {}): Watch => ({ ...WATCH_START, hidden: false, ...change });
  const at = (front: FrontGame = FRONT): Watch => watch({ seen: { status: "front", ...front }, foregroundWindow: "w1", lastGame: front.bounds });
  const looked = (change: Partial<Extract<WatchEvent, { type: "look" }>> = {}): WatchEvent => ({ type: "look", front: null, foregroundWindow: "w9", tavoraFront: false, stay: true, kept: () => KEPT, ...change });
  const cases: { name: string; watch: Watch; event: WatchEvent; next: Watch }[] = [
    { name: "starts hidden, with nothing seen", watch: WATCH_START, event: { type: "hide", hidden: false }, next: watch() },
    { name: "hiding keeps what was seen", watch: at(), event: { type: "hide", hidden: true }, next: { ...at(), hidden: true } },
    { name: "a game in front is seen with its window, and its window is remembered", watch: watch(), event: looked({ front: FRONT, foregroundWindow: "w1" }), next: at() },
    {
      name: "leaving the game, overlays stay over its window while it is open",
      watch: at(),
      event: looked(),
      next: { ...at(), seen: { status: "away", game: "elden", bounds: KEPT }, foregroundWindow: "w9" },
    },
    { name: "its window gone (closed or minimized), the game is forgotten", watch: at(), event: looked({ kept: () => null }), next: { ...at(), seen: { status: "none", left: null }, foregroundWindow: "w9" } },
    {
      name: "without the stay setting the game is still remembered, so overlays stay once it is on",
      watch: at(),
      event: looked({ stay: false, kept: () => KEPT }),
      next: { ...at(), seen: { status: "none", left: "elden" }, foregroundWindow: "w9" },
    },
    {
      name: "a game remembered without the setting is stayed over once it is on",
      watch: watch({ seen: { status: "none", left: "elden" } }),
      event: looked(),
      next: watch({ seen: { status: "away", game: "elden", bounds: KEPT }, foregroundWindow: "w9" }),
    },
    { name: "with no game seen yet nothing stays", watch: watch(), event: looked(), next: watch({ foregroundWindow: "w9" }) },
    { name: "Tavora's own window in front is noted", watch: at(), event: looked({ front: FRONT, foregroundWindow: "w1", tavoraFront: true }), next: { ...at(), tavoraFront: true } },
    { name: "off (or nothing to show): no game, none left to stay over", watch: at(), event: { type: "off" }, next: { ...at(), seen: { status: "none", left: null } } },
    { name: "the probe failing: no game in front from now on, the one seen last remembered", watch: at(), event: { type: "failed" }, next: { ...at(), failed: true, seen: { status: "none", left: "elden" } } },
    {
      name: "the probe failing while overlays stay keeps where they were",
      watch: watch({ seen: { status: "away", game: "elden", bounds: KEPT } }),
      event: { type: "failed" },
      next: watch({ failed: true, seen: { status: "away", game: "elden", bounds: KEPT } }),
    },
    { name: "quitting: no game in front or stayed over, and Tavora's window in front", watch: watch({ seen: { status: "away", game: "elden", bounds: KEPT } }), event: { type: "quit" }, next: watch({ tavoraFront: true, seen: { status: "none", left: "elden" } }) },
  ];
  for (const one of cases) {
    it(one.name, () => {
      expect(watchStep(one.watch, one.event)).toEqual(one.next);
    });
  }

  it("asks for the window left only when overlays may stay over it", () => {
    let asked = 0;
    const kept = () => (asked++, KEPT);
    watchStep(at(), looked({ front: FRONT, kept }));
    watchStep(at(), looked({ stay: false, kept }));
    watchStep(watch(), looked({ kept }));
    expect(asked).toBe(0);
    watchStep(at(), looked({ kept }));
    expect(asked).toBe(1);
  });

  it("finds the game in front and the one stayed over", () => {
    expect(frontOf(at())).toMatchObject({ game: "elden", bounds: GAME, window: "w1" });
    expect(awayOf(at())).toBeNull();
    const away = watchStep(at(), looked());
    expect(frontOf(away)).toBeNull();
    expect(awayOf(away)).toEqual({ status: "away", game: "elden", bounds: KEPT });
  });
});

describe("layerScene", () => {
  it("shows an Always overlay of the game in front, click-through, zoomed to the game's height", () => {
    const clock = overlay("a");
    const scene = layerScene(input({ elden: { overlays: [clock] } }));
    expect(scene.layer).toBeNull();
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ id: overlayId(clock), kind: "overlay", setup: "elden", look: { mode: "off", zoom: 1, z: null, opacity: 100, hideFromCapture: false } });
    expect(scene.items[0]!.look!.rect.width).toBeGreaterThan(0);
  });

  it("keeps an item of a setup that isn't on screen, hidden and with no setup (its window goes after a while)", () => {
    const clock = overlay("a");
    const scene = layerScene(input({ elden: { overlays: [clock] } }, { setups: [] }));
    expect(scene.items).toMatchObject([{ id: overlayId(clock), setup: null, look: null }]);
  });

  it("hides a Toggle overlay until its key turned it on, and everything while overlays are off", () => {
    const toggle = overlay("t", { mode: "toggle" });
    expect(shownIds(layerScene(input({ elden: { overlays: [toggle] } })))).toEqual([]);
    expect(shownIds(layerScene(input({ elden: { overlays: [toggle] } }, { toggled: new Set([overlayId(toggle)]) })))).toEqual([overlayId(toggle)]);
    expect(shownIds(layerScene(input({ elden: { overlays: [overlay("a")] } }, { active: false })))).toEqual([]);
  });

  it("hides an overlay whose module is gone or whose page crashed too often", () => {
    const clock = overlay("a");
    expect(shownIds(layerScene(input({ elden: { overlays: [clock] } }, { usable: () => false })))).toEqual([]);
    expect(shownIds(layerScene(input({ elden: { overlays: [clock] } }, { stopped: new Set([overlayId(clock)]) })))).toEqual([]);
  });

  it("shows an item in two setups once, as the game's setup has it", () => {
    const everywhere = overlay("a", { opacity: 50 });
    const game = overlay("a", { opacity: 25 });
    const scene = layerScene(input({ [EVERYWHERE]: { overlays: [everywhere] }, elden: { overlays: [game] } }));
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ setup: "elden", look: { opacity: 25 } });
  });

  it("opens the layer over the game: the veil's area and the card, overlays with their frame in Arrange", () => {
    const clock = overlay("t", { mode: "toggle" });
    const use = layerScene(input({ elden: { overlays: [clock] } }, { layer: open() }));
    expect(use.layer).toEqual({ area: GAME, card: { mode: "use" } });
    // A Toggle overlay shows while the layer is open, click-through in Use.
    expect(use.items[0]!.look).toMatchObject({ mode: "off" });
    const arrange = layerScene(input({ elden: { overlays: [clock] } }, { layer: open({ mode: "arrange" }) }));
    expect(arrange.items[0]!.look).toMatchObject({ mode: "arrange" });
  });

  it("opens the layer over the screen with no game in front, and not over a game whose window isn't known", () => {
    expect(layerScene(input({ [EVERYWHERE]: { overlays: [overlay("a")] } }, { front: null, game: null, layer: open({ game: null }) })).layer?.area).toEqual(SCREEN);
    expect(layerScene(input({ elden: {} }, { game: null, layer: open() })).layer).toBeNull();
    // Nor over a game that isn't the one it opened over.
    expect(layerScene(input({ elden: {} }, { layer: open({ game: "other" }) })).layer).toBeNull();
  });

  it("has panels only while the layer is open: taking input in Use, framed in Arrange", () => {
    const todos = panel("p1");
    const ids = (scene: ReturnType<typeof layerScene>) => scene.items.map((item) => `${item.kind} ${item.look?.mode ?? "hidden"}`);
    expect(ids(layerScene(input({ elden: { panels: [todos] } })))).toEqual(["live off"]);
    expect(ids(layerScene(input({ elden: { panels: [todos] } }, { layer: open() })))).toEqual(["panel use", "live off"]);
    expect(ids(layerScene(input({ elden: { panels: [todos] } }, { layer: open({ mode: "arrange" }) })))).toEqual(["panel arrange", "live off"]);
    expect(layerScene(input({ elden: { panels: [todos] } }, { layer: open() })).items[0]).toMatchObject({ id: panelWindowId("p1"), instanceId: "p1", setup: "elden" });
  });

  it("shows a panel's live view only with something to show, veiled behind the panel while the layer is open", () => {
    const todos = panel("p1");
    expect(layerScene(input({ elden: { panels: [todos] } })).items).toMatchObject([{ id: liveWindowId("p1"), kind: "live", look: { veiled: false } }]);
    expect(layerScene(input({ elden: { panels: [todos] } }, { hasLive: () => false })).items).toMatchObject([{ kind: "live", look: null }]);
    expect(layerScene(input({ elden: { panels: [todos] } }, { layer: open() })).items[1]).toMatchObject({ kind: "live", look: { veiled: true } });
  });

  it("lists overlays, then panels, then live views, with each one's stacking place", () => {
    const scene = layerScene(input({ [ALL_GAMES]: { overlays: [overlay("b", { z: 1 })] }, elden: { overlays: [overlay("a", { z: 2 })], panels: [panel("p1", { z: 0 })] } }, { layer: open() }));
    expect(scene.items.map((item) => [item.kind, item.look?.z])).toEqual([
      ["overlay", 1],
      ["overlay", 2],
      ["panel", 0],
      ["live", 0],
    ]);
  });

  it("passes on the game the user left, for the windows to stack right above it", () => {
    expect(layerScene(input({}, { awayHandle: 4242 })).awayHandle).toBe(4242);
  });
});
