import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerScene, LiveItem, LiveLook, OverlayItem, PanelItem, SceneItem } from "./game-layer";
import { IDLE_CLOSE_MS, LayerWindows, MAX_CRASHES, type LayerWindowsPlatform, type OverlayWindow, type OverlayWindowRequest, type PanelWindowMaker } from "./game-layer-windows";
import type { LayerCard, LayerCardRequest } from "./game-layer-card";
import type { VeilWindow } from "./game-veil-window";
import type { OverlayPanel } from "./game-overlay-window";
import type { Rect, WindowMode } from "./game-overlays";
import type { PanelInGame } from "./panel-views";

const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

/** Every call made of a window, the veil or the card, in order. */
let calls: string[];
let handles: number;

class Window implements OverlayWindow {
  dragging = false;
  readonly handle = ++handles;
  placed: Rect | null = null;
  constructor(readonly id: string) {}
  private log(what: string) {
    calls.push(`${this.id} ${what}`);
  }
  setRect(rect: Rect) {
    this.placed = rect;
    this.log("rect");
  }
  setShown(shown: boolean) {
    this.log(shown ? "show" : "hide");
  }
  setMode(mode: WindowMode) {
    this.log(mode);
  }
  setHideFromCapture(hide: boolean) {
    this.log(`capture ${hide}`);
  }
  setOpacity(opacity: number) {
    this.log(`opacity ${opacity}`);
  }
  setZoom(zoom: number) {
    this.log(`zoom ${zoom}`);
  }
  setVeiled(veiled: boolean) {
    this.log(veiled ? "veil" : "unveil");
  }
  setTopmost(on: boolean) {
    this.log(on ? "top" : "among");
  }
  raise() {
    this.log("raise");
  }
  focusPanel() {
    this.log("focus");
  }
  destroy() {
    this.log("destroy");
  }
}

function rig() {
  const windows: Window[] = [];
  const cards: (LayerCard & { request: LayerCardRequest })[] = [];
  const stacked: { game: number; windows: number[] }[] = [];
  const used = new Map<string, number>();
  const platform: LayerWindowsPlatform = {
    openWindow: (request) => {
      const window = new Window(request.id);
      windows.push(window);
      calls.push(`${request.id} made`);
      return window;
    },
    openVeil: (): VeilWindow => {
      calls.push("veil made");
      return { place: () => void calls.push("veil place"), destroy: () => void calls.push("veil destroy") };
    },
    openCard: (request: LayerCardRequest): LayerCard => {
      const card = {
        request,
        focused: false,
        items: [] as readonly Rect[],
        show: (_area: Rect, _content: unknown, items: readonly Rect[] = []) => {
          card.items = items;
          calls.push("card show");
        },
        raise: () => void calls.push("card raise"),
        refresh: () => {},
        destroy: () => void calls.push("card destroy"),
      };
      cards.push(card);
      return card;
    },
    stackAboveGame: (game, handles) => (stacked.push({ game, windows: [...handles] }), true),
    gameOnTop: () => false,
  };
  const layer = new LayerWindows({ platform, setMode: () => {}, close: () => {}, usedAt: (instanceId) => used.get(instanceId) ?? 0 });
  return { layer, windows, cards, stacked, used };
}

const request = (id: string) => ({ id }) as OverlayWindowRequest;
const look = (change: Partial<LiveLook> = {}): LiveLook => ({ rect: { x: 10, y: 10, width: 100, height: 50 }, zoom: 1, mode: "off", z: null, opacity: 100, hideFromCapture: false, veiled: false, ...change });
/** Shown from "elden" as `look()` says, unless `change` says otherwise (`look` null: hidden). */
type Change = { setup?: string | null; look?: LiveLook | null };
function placement(id: string, change: Change) {
  const setup = change.setup === undefined ? "elden" : change.setup;
  const shown = change.look === undefined ? look() : change.look;
  return shown && setup !== null ? { setup, look: shown, make: () => ({ request: request(id) }) } : { setup, look: null };
}
const overlay = (id: string, change: Change = {}): OverlayItem => ({ id, kind: "overlay", ...placement(id, change) });
/** A panel lent into its window; `lent` counts the lends and returns. */
function panel(id: string, lent: string[], change: Partial<Pick<PanelItem, "look" | "make">> = {}): PanelItem {
  const make = (): PanelWindowMaker => ({
    request: request(id),
    lend: (open) => {
      lent.push(`lend ${id}`);
      const window = open({} as OverlayPanel);
      const loan: PanelInGame<OverlayWindow> = {
        window,
        end: () => {
          window.destroy();
          lent.push(`end ${id}`);
        },
        giveBack: () => void lent.push(`back ${id}`),
      };
      return loan;
    },
  });
  const { opacity: _opacity, hideFromCapture: _capture, veiled: _veiled, ...panelLook } = look({ mode: "use" });
  return { id, kind: "panel", instanceId: id, setup: "elden", look: panelLook, make, ...change };
}
const scene = (items: SceneItem[], change: Partial<LayerScene> = {}): LayerScene => ({ layer: null, awayHandle: 0, items, ...change });
const LAYER = { area: AREA, card: {} as never };

beforeEach(() => {
  calls = [];
  handles = 100;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("an item's window", () => {
  it("is made once, placed and put on top before it shows, and takes its mode only after", () => {
    const { layer } = rig();
    layer.show(scene([overlay("a", { look: look({ opacity: 50, zoom: 1.5, mode: "arrange" }) })]));
    expect(calls).toEqual(["a made", "a opacity 50", "a rect", "a zoom 1.5", "a top", "a show", "a arrange", "a top"]);
    calls.length = 0;
    // The same again changes only what is asked again each time: the place and staying on top.
    layer.show(scene([overlay("a", { look: look({ opacity: 50, zoom: 1.5, mode: "arrange" }) })]));
    expect(calls).toEqual(["a rect", "a top", "a top"]);
    expect(layer.anyShown).toBe(true);
  });

  it("isn't moved while the user drags it", () => {
    const { layer, windows } = rig();
    layer.show(scene([overlay("a")]));
    windows[0]!.dragging = true;
    calls.length = 0;
    layer.show(scene([overlay("a")]));
    expect(calls).not.toContain("a rect");
  });

  it("hides with its mode off, waits while its setup is on screen, and goes after a while once it isn't", () => {
    const { layer } = rig();
    layer.show(scene([overlay("a", { look: look({ mode: "arrange" }) })]));
    calls.length = 0;
    layer.show(scene([overlay("a", { look: null })]));
    expect(calls).toEqual(["a off", "a hide"]);
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    layer.show(scene([overlay("a", { look: null })]));
    expect(calls).not.toContain("a destroy");
    // Its setup left the screen: the time starts now.
    layer.show(scene([overlay("a", { setup: null, look: null })]));
    vi.advanceTimersByTime(IDLE_CLOSE_MS - 1);
    layer.show(scene([overlay("a", { setup: null, look: null })]));
    expect(calls).not.toContain("a destroy");
    vi.advanceTimersByTime(1);
    layer.show(scene([overlay("a", { setup: null, look: null })]));
    expect(calls).toContain("a destroy");
    expect(layer.setupOf("a")).toBeUndefined();
  });

  it("goes at once when the scene has no item for it", () => {
    const { layer } = rig();
    layer.show(scene([overlay("a")]));
    layer.show(scene([]));
    expect(calls.at(-1)).toBe("a destroy");
    expect(layer.anyShown).toBe(false);
  });

  it("tells which setup it shows from, for the window's own requests", () => {
    const { layer } = rig();
    layer.show(scene([overlay("a", { setup: "$all" })]));
    expect(layer.setupOf("a")).toBe("$all");
  });
});

describe("panels", () => {
  it("are lent into their window once, and the window ends the lend when it goes", () => {
    const { layer } = rig();
    const lent: string[] = [];
    layer.show(scene([panel("p", lent)], { layer: LAYER }));
    layer.show(scene([panel("p", lent)], { layer: LAYER }));
    expect(lent).toEqual(["lend p"]);
    layer.show(scene([]));
    expect(lent).toEqual(["lend p", "end p"]);
    expect(calls).toContain("p destroy");
  });

  it("wait for the next look while Panel views can't lend them", () => {
    const { layer } = rig();
    const item = panel("p", [], { make: () => ({ request: request("p"), lend: () => null }) });
    layer.show(scene([item], { layer: LAYER }));
    expect(calls.filter((call) => call.startsWith("p "))).toEqual([]);
    expect(layer.anyShown).toBe(false);
  });

  it("give the keyboard to the one used last, once, as it comes up in Use", () => {
    const { layer, used } = rig();
    used.set("p1", 1);
    used.set("p2", 2);
    layer.show(scene([panel("p1", []), panel("p2", [])], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("focus"))).toEqual(["p2 focus"]);
    calls.length = 0;
    layer.show(scene([panel("p1", []), panel("p2", [])], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("focus"))).toEqual([]);
    // Back from Arrange, again.
    layer.show(scene([panel("p1", [], { look: look({ mode: "arrange" }) }), panel("p2", [], { look: look({ mode: "arrange" }) })], { layer: LAYER }));
    layer.show(scene([panel("p1", []), panel("p2", [])], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("focus"))).toEqual(["p2 focus"]);
  });

  it("whose page ended give the view back, forget the dead window and are lent into a new one at the next look", () => {
    const { layer } = rig();
    const lent: string[] = [];
    layer.show(scene([panel("p", lent)], { layer: LAYER }));
    expect(layer.ended("p")).toBe("panel");
    expect(lent).toEqual(["lend p", "back p"]);
    // Its page may be gone while the window isn't: it goes, once.
    expect(calls.filter((call) => call === "p destroy")).toHaveLength(1);
    layer.show(scene([panel("p", lent)], { layer: LAYER }));
    layer.show(scene([panel("p", lent)], { layer: LAYER }));
    expect(lent).toEqual(["lend p", "back p", "lend p"]);
    // Any other window just goes.
    layer.show(scene([panel("p", lent), overlay("a")], { layer: LAYER }));
    expect(layer.ended("a")).toBe("window");
    expect(calls).toContain("a destroy");
  });
});

describe("live views", () => {
  const live = (id: string, change: Change = {}): LiveItem => ({ id, kind: "live", instanceId: id, ...placement(id, change) });

  it("stay see-through behind their panel while the layer is open, only when already on screen", () => {
    const { layer } = rig();
    // Not on screen yet: none is made for the open layer.
    layer.show(scene([live("l", { look: look({ veiled: true }) })], { layer: LAYER }));
    expect(calls.filter((call) => call.startsWith("l "))).toEqual([]);
    layer.show(scene([live("l")]));
    calls.length = 0;
    layer.show(scene([live("l", { look: look({ veiled: true }) })], { layer: LAYER }));
    // The veil is new, so the view is raised over it.
    expect(calls.filter((call) => call.startsWith("l "))).toEqual(["l rect", "l veil", "l top", "l raise", "l top"]);
    calls.length = 0;
    layer.show(scene([live("l", { look: null })]));
    expect(calls.filter((call) => call.startsWith("l "))).toEqual(["l unveil", "l hide"]);
  });
});

describe("the layer's veil and card", () => {
  it("puts the veil first and raises the windows over a new veil, with the card on top", () => {
    const { layer } = rig();
    layer.show(scene([overlay("a")]));
    calls.length = 0;
    layer.show(scene([overlay("a")], { layer: LAYER }));
    expect(calls).toEqual(["veil made", "veil place", "a rect", "a top", "card show", "a raise", "a top", "card raise"]);
    calls.length = 0;
    layer.show(scene([overlay("a")]));
    expect(calls).toEqual(["veil destroy", "card destroy", "a rect", "a top", "a top"]);
  });

  it("keeps the card off the items you see, and in place while one is dragged", () => {
    const { layer, windows, cards } = rig();
    layer.show(scene([overlay("a")], { layer: LAYER }));
    const card = cards[0] as unknown as { items: readonly Rect[] };
    expect(card.items).toEqual([{ x: 10, y: 10, width: 100, height: 50 }]);
    layer.show(scene([overlay("a")], { layer: LAYER }));
    expect(card.items).toEqual([{ x: 10, y: 10, width: 100, height: 50 }]);
    windows[0]!.dragging = true;
    windows[0]!.placed = { x: 500, y: 500, width: 100, height: 50 };
    layer.show(scene([overlay("a")], { layer: LAYER }));
    expect(card.items).toEqual([{ x: 10, y: 10, width: 100, height: 50 }]);
  });

  it("keeps a new card off a panel that comes up with it, from its first look", () => {
    const { layer, cards } = rig();
    layer.show(scene([panel("p", [])], { layer: LAYER }));
    // Before the panel's window had its place, the card was placed with nothing to keep off and came up over it.
    expect((cards[0] as unknown as { items: readonly Rect[] }).items).toEqual([{ x: 10, y: 10, width: 100, height: 50 }]);
  });

  it("makes no new card after its page crashed too often", () => {
    const { layer, cards } = rig();
    for (let i = 0; i < MAX_CRASHES; i++) {
      layer.show(scene([], { layer: LAYER }));
      cards.at(-1)!.request.ended();
    }
    layer.show(scene([], { layer: LAYER }));
    expect(cards).toHaveLength(MAX_CRASHES);
  });

  it("closes the veil, the card and every window, panels given back", () => {
    const { layer } = rig();
    const lent: string[] = [];
    layer.show(scene([overlay("a"), panel("p", lent)], { layer: LAYER }));
    calls.length = 0;
    layer.closeAll();
    expect(calls).toEqual(["veil destroy", "card destroy", "a destroy", "p destroy"]);
    expect(lent).toEqual(["lend p", "end p"]);
    expect(layer.anyShown).toBe(false);
  });
});

describe("stacking", () => {
  it("raises windows in their arranged order only when it changes, overlays below panels where none was arranged", () => {
    const { layer } = rig();
    const lent: string[] = [];
    layer.show(scene([overlay("a", { look: look({ z: 2 }) }), overlay("b", { look: look({ z: 1 }) }), panel("p", lent)], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("raise"))).toEqual(["b raise", "a raise", "p raise", "card raise"]);
    calls.length = 0;
    layer.show(scene([overlay("a", { look: look({ z: 2 }) }), overlay("b", { look: look({ z: 1 }) }), panel("p", lent)], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("raise"))).toEqual([]);
    layer.show(scene([overlay("a", { look: look({ z: 0 }) }), overlay("b", { look: look({ z: 1 }) }), panel("p", lent)], { layer: LAYER }));
    expect(calls.filter((call) => call.endsWith("raise"))).toEqual(["a raise", "b raise", "p raise", "card raise"]);
  });

  it("puts a game's items right above the game the user left, Everywhere's on top", () => {
    const { layer, stacked } = rig();
    const answer = layer.show(scene([overlay("a"), overlay("e", { setup: "$everywhere" })], { awayHandle: 4242 }));
    expect(answer).toBe(true);
    expect(stacked).toEqual([{ game: 4242, windows: [101] }]);
    expect(calls).toContain("a among");
    expect(calls.filter((call) => call.startsWith("e ")).every((call) => call !== "e among")).toBe(true);
  });
});
