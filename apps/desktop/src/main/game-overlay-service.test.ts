import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, type JsonValue } from "@tavora/sdk/protocol";
import { placeLegacy } from "../shared/overlay-anchor";
import type { Foreground, ForegroundProbe } from "./foreground";
import { GameOverlays, isOverlayAction, layerBinding, toggleBinding, type OverlayWindow, type OverlayWindowRequest } from "./game-overlay-service";
import type { VeilWindow } from "./game-veil-window";
import { ALL_GAMES, GameOverlayStore, OVERLAY_LAYER_ACTION, OVERLAY_TOGGLE_ACTION, type OverlayScope, type Rect } from "./game-overlays";
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import { OverlayStore } from "./overlays";
import type { StreamingModule } from "./streaming";
import { moveToWorkspaces } from "./workspace-move";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-game-overlay-service-"));
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const CLOCK: StreamingModule = {
  owner: "official",
  root: "/nowhere",
  manifest: { id: "tavora.clock-counter", name: "Clock & Counter", overlay: "dist/overlay.html", permissions: { network: [], connectors: [] } },
};
const NO_OVERLAY: StreamingModule = { ...CLOCK, manifest: { id: "tavora.notes", name: "Notes", permissions: { network: [] } } };

const GAME_EXE = "D:\\Games\\Elden Ring\\eldenring.exe";
const PANEL = "0a1b2c3d-0000-4000-8000-000000000001";
const TODOS: StreamingModule = { owner: "official", root: "/nowhere", manifest: { id: "tavora.todos", name: "To-Dos", permissions: { network: [] } } };
const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

class FakeWindow implements OverlayWindow {
  rect: Rect | null = null;
  shown = false;
  arranging = false;
  hideFromCapture = false;
  opacity = 100;
  dragging = false;
  destroyed = false;
  focused = false;
  zoom = 1;
  /** What the service asked of it, in order. */
  log: string[] = [];
  focusedPanel = 0;
  constructor(readonly request: OverlayWindowRequest & { instanceId?: string }) {}
  setRect(rect: Rect) {
    this.rect = rect;
    this.log.push("rect");
  }
  setShown(shown: boolean) {
    this.shown = shown;
    this.log.push(shown ? "show" : "hide");
  }
  setArranging(arranging: boolean) {
    this.arranging = arranging;
    this.log.push(arranging ? "arrange" : "stop");
  }
  focusPanel() {
    this.focusedPanel++;
    this.log.push("focus");
  }
  setHideFromCapture(show: boolean) {
    this.hideFromCapture = show;
  }
  setOpacity(opacity: 100 | 75 | 50 | 25) {
    this.opacity = opacity;
  }
  raise() {
    this.log.push("raise");
  }
  setZoom(factor: number) {
    this.zoom = factor;
  }
  destroy() {
    this.destroyed = true;
  }
}

class FakeVeil implements VeilWindow {
  rect: Rect | null = null;
  destroyed = false;
  place(rect: Rect) {
    this.rect = rect;
  }
  destroy() {
    this.destroyed = true;
  }
}

async function setup({ supported = true, enabled = true, file }: { supported?: boolean; enabled?: boolean; file?: unknown } = {}) {
  // A file as an older Tavora left it is moved to the workspace names first, as at start (workspace-move.ts).
  if (file !== undefined) {
    await writeFile(path.join(dir, "game-overlays.json"), JSON.stringify(file));
    await moveToWorkspaces(dir);
  }
  const world = {
    enabled,
    /** One of Tavora's own windows has the keyboard. */
    tavora: false,
    /** Settings > Overlays: Keep when you switch windows. */
    stay: false,
    /** The game window kept by the probe, where it is now; null once it is minimized or closed. */
    kept: null as Rect | null,
    modules: new Map<string, StreamingModule>([[CLOCK.manifest.id, CLOCK], [TODOS.manifest.id, TODOS]]),
    foreground: { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 } as Foreground | null,
    opened: [] as string[],
    layouts: [] as (string | null)[],
    notices: [] as string[],
    removedKeys: [] as HotkeyRecord[],
    movedKeys: [] as { from: HotkeyRecord | undefined; to: unknown }[],
    /** Panel instances whose type no longer allows being in the game. */
    notAllowed: new Set<string>(),
    changes: 0,
    focused: 0,
    registered: new Map<string, () => void>(),
    windows: [] as FakeWindow[],
    veils: [] as FakeVeil[],
    /** Which library entries are games; the rest are workspaces such as Personal. */
    kinds: new Map<string, OverlayScope>([["personal", "all"]]),
    panelUsed: new Map<string, number>(),
    /** Panel instances that still exist. */
    gone: new Set<string>(),
    probeCalls: 0,
    broken: false,
    /** The panels there are (instance id to the name of their tab). */
    panelNames: new Map<string, string>([[PANEL, "To-Dos"]]),
    /** The size each panel's module prefers (its viewport, in pixels). */
    preferred: new Map<string, { width: number; height: number }>(),
    /** How often the Overlay layout was asked to look at the games' windows again. */
    windowsChanged: 0,
  };
  const probe: ForegroundProbe = {
    look: () => {
      world.probeCalls++;
      if (world.broken) throw new Error("no koffi");
      return world.foreground;
    },
    focus: () => void world.focused++,
    keep: () => void (world.kept = world.foreground ? { ...world.foreground.bounds } : null),
    kept: () => world.kept,
  };
  const shortcuts: ShortcutRegistry = {
    register: (accelerator, callback) => (world.registered.set(accelerator, callback), true),
    unregister: (accelerator) => void world.registered.delete(accelerator),
  };
  const overlays = await OverlayStore.load(dir);
  const service = await GameOverlays.create({
    userData: dir,
    overlays,
    supported,
    enabled: () => world.enabled,
    module: (id) => world.modules.get(id),
    workspaceName: (id) => (id === "elden" ? "Elden Ring" : id === "personal" ? "Personal" : null),
    scopeOf: (id) => world.kinds.get(id) ?? "game",
    gamesOf: (program) => new Set(program === GAME_EXE ? ["elden"] : program.startsWith("D:\\Games\\Other\\") ? ["other"] : []),
    panels: {
      name: (instanceId) => world.panelNames.get(instanceId) ?? null,
      exists: (_workspaceId, instanceId) => !world.gone.has(instanceId),
      allowed: (_workspaceId, instanceId) => !world.notAllowed.has(instanceId),
      usedAt: (instanceId) => world.panelUsed.get(instanceId) ?? 0,
      preferred: (_workspaceId, instanceId) => world.preferred.get(instanceId) ?? null,
      openWindow: (request) => {
        if (!world.panelNames.has(request.instanceId)) return null;
        const window = new FakeWindow(request);
        world.windows.push(window);
        return window;
      },
    },
    probe: () => probe,
    toDip: (rect) => rect,
    screen: () => ({ ...SCREEN }),
    tavoraInFront: () => world.tavora,
    stay: () => world.stay,
    openWindow: (request) => {
      const window = new FakeWindow(request);
      world.windows.push(window);
      return window;
    },
    openVeil: () => {
      const veil = new FakeVeil();
      world.veils.push(veil);
      return veil;
    },
    shortcuts,
    openSetting: (setting) => void world.opened.push(setting),
    openLayout: (gameId) => void world.layouts.push(gameId),
    notify: (message) => void world.notices.push(message),
    removeKeys: (test) => {
      for (const record of [...keys]) if (test(record)) world.removedKeys.push(record);
    },
    moveKey: (test, to) => {
      const matches = keys.filter(test);
      world.movedKeys.push({ from: matches.at(-1), to });
      for (const record of matches) world.removedKeys.push(record);
    },
    keyOf: () => null,
    language: () => "en",
    changed: () => void world.changes++,
    windowsChanged: () => void world.windowsChanged++,
  });
  const keys: HotkeyRecord[] = [];
  const key = (binding: ReturnType<typeof toggleBinding> | ReturnType<typeof layerBinding>): HotkeyRecord => {
    const record = { ...binding, label: "x", accelerator: "F9" };
    keys.push(record);
    return record;
  };
  const live = () => world.windows.filter((window) => !window.destroyed);
  return { service, world, overlays, key, live };
}

const show = (service: GameOverlays, module = CLOCK, workspaceId = "elden", key = "item-1") => service.show(module, workspaceId, key);

describe("showOverGame", () => {
  it("keeps an item's own place in each setup, also for moves in the layer", async () => {
    const { service, world, live } = await setup();
    show(service, CLOCK, "personal");
    // Elden Ring's setup is made for its own overlay, with a copy of the general one.
    show(service, CLOCK, "elden", "own");
    const item = service.layout.items("$all")[0]!;
    expect(service.layout.items("elden").map((info) => info.id)).toEqual([item.id, expect.any(String)]);
    const shared = { ...live()[0]!.rect! };
    const own = { h: "left", v: "top", x: 0.5, y: 0.3, width: 0.2, height: 0.1 } as const;
    service.layout.setRect("elden", item.ref, own);
    expect(live()[0]!.rect).toEqual({ x: 540, y: 324, width: 216, height: 108 });
    // Another game has no setup of its own: All games shows, with its place.
    world.foreground = { program: "D:\\Games\\Other\\game.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.rect).toEqual(shared);
    live()[0]!.request.moved({ x: 700, y: 100, width: 300, height: 150 });
    service.tick();
    expect(live()[0]!.rect).toEqual({ x: 700, y: 100, width: 300, height: 150 });
    expect(service.layout.items("$all")[0]!.rect).not.toEqual(item.rect);
    expect(service.layout.items("elden")[0]!.rect).toEqual(own);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.rect).toEqual({ x: 540, y: 324, width: 216, height: 108 });
    await service.shutdown();
  });
  it("puts the overlay over the game right away when the game is in front", async () => {
    const { service, live } = await setup();
    expect(show(service)).toBe("shown");
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ shown: true, arranging: false, hideFromCapture: false, opacity: 100 });
    expect(live()[0]!.rect).toMatchObject({ width: expect.any(Number) });
  });

  it("says shown again for an overlay already shown, without a second window", async () => {
    const { service, live } = await setup();
    show(service);
    expect(show(service)).toBe("shown");
    expect(live()).toHaveLength(1);
  });

  it("says off and opens Settings > Overlays while the switch is off, and adds nothing", async () => {
    const { service, world } = await setup({ enabled: false });
    expect(show(service)).toBe("off");
    expect(world.opened).toEqual(["game-overlays"]);
    expect(service.layout.setups()).toEqual(["$everywhere", "$all"]);
    expect(world.windows).toHaveLength(0);
  });

  it("says off without opening a setting that isn't there where overlays can't be drawn", async () => {
    const { service, world } = await setup({ supported: false });
    expect(show(service)).toBe("off");
    expect(world.opened).toEqual([]);
  });

  it("says full when the game already has eight", async () => {
    const { service } = await setup();
    for (let i = 0; i < 8; i++) expect(show(service, CLOCK, "elden", `item-${i}`)).toBe("shown");
    expect(show(service, CLOCK, "elden", "item-8")).toBe("full");
    expect(show(service, CLOCK, "other", "item-8")).toBe("shown");
  });

  it("starts at the module's overlaySize, else at the usual size", async () => {
    const { service, live } = await setup();
    show(service, { ...CLOCK, manifest: { ...CLOCK.manifest, overlaySize: { width: 440, height: 100 } } });
    expect(live()[0]!.rect).toMatchObject({ width: 440, height: 100 });
    show(service, CLOCK, "elden", "item-2");
    expect(live()[1]!.rect!.width).toBe(Math.round(SCREEN.width * 0.2));
  });

  it("refuses a module that has no overlay page", async () => {
    const { service } = await setup();
    expect(() => show(service, NO_OVERLAY)).toThrow(/no overlay page/);
  });
});

describe("which window is in front", () => {
  it("shows the overlay only while its game is in front, and hides it when you leave, Tavora included", async () => {
    const { service, world, live } = await setup();
    show(service);
    const window = live()[0]!;
    expect(window.shown).toBe(true);
    world.foreground = { program: "C:\\Program Files\\Tavora\\Tavora.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(window.shown).toBe(false);
    expect(service.frontGame()).toBeNull();
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(window.shown).toBe(true);
    expect(service.frontGame()).toBe("elden");
  });

  it("tells the view whether anything shows now, and says so when that changes", async () => {
    const { service, world } = await setup();
    show(service);
    expect(service.view().showing).toBe(true);
    const before = world.changes;
    world.foreground = { program: "C:\\Program Files\\Tavora\\Tavora.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.view().showing).toBe(false);
    expect(world.changes).toBeGreaterThan(before);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.setHidden(true);
    expect(service.view()).toMatchObject({ hidden: true, showing: false });
  });

  it("keeps it over the game's spot when you switch windows and Keep is on, until the game is minimized; the keys don't stay", async () => {
    const { service, world, live, key } = await setup();
    world.stay = true;
    show(service);
    const window = live()[0]!;
    world.foreground = { program: "C:\Program Files\Browser\browser.exe", bounds: { x: 100, y: 100, width: 800, height: 600 }, notification: 0 };
    service.tick();
    expect(window.shown).toBe(true);
    // Where it was over the game, not over the browser.
    expect(window.rect!.x).toBeLessThan(100);
    expect(service.frontGame()).toBeNull();
    // The keys are the browser's: the layer key is neither taken nor opens anything there.
    const layer = layerKey(key);
    expect(service.showing()).toBe(false);
    expect(service.wants(layer)).toBe(false);
    service.pressed(layer);
    expect(service.layerOpen).toBe(false);
    expect(world.veils).toHaveLength(0);
    world.kept = null;
    service.tick();
    expect(window.shown).toBe(false);
    // Back in the game it shows again, and is kept again.
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(window.shown).toBe(true);
    world.foreground = null;
    service.tick();
    expect(window.shown).toBe(true);
  });

  it("hides it for another game's window and for no window at all", async () => {
    const { service, world, live } = await setup();
    show(service);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.shown).toBe(false);
    world.foreground = null;
    service.tick();
    expect(live()[0]!.shown).toBe(false);
  });

  it("moves it with the game's window, keeping its place relative to it", async () => {
    const { service, world, live } = await setup();
    show(service);
    const full = { ...live()[0]!.rect! };
    world.foreground = { program: GAME_EXE, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, notification: 0 };
    service.tick();
    const small = live()[0]!.rect!;
    expect(small.x).toBeGreaterThanOrEqual(1920);
    expect(small.width / 1280).toBeCloseTo(full.width / 1920, 1);
  });

  it("shows the exclusive full screen hint once", async () => {
    const { service, world } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 3 };
    service.tick();
    service.tick();
    expect(world.notices).toEqual(["Switch the game to borderless to see overlays."]);
  });

  it("doesn't look at anything while the switch is off, and closes what was open", async () => {
    const { service, world, live } = await setup();
    show(service);
    world.enabled = false;
    const looks = world.probeCalls;
    service.tick();
    expect(world.probeCalls).toBe(looks);
    expect(live()).toHaveLength(0);
    expect(service.needsWatcher()).toBe(false);
  });

  it("closes everything when Windows can't be asked", async () => {
    const { service, world, live } = await setup();
    show(service);
    world.broken = true;
    service.tick();
    expect(live()).toHaveLength(0);
    expect(service.frontGame()).toBeNull();
  });
});

describe("modes and settings", () => {
  it("shows a Toggle overlay only after its key, and the key follows the game in front", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { mode: "toggle" });
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }));
    expect(live()[0]!.shown).toBe(false);
    expect(service.wants(record)).toBe(true);
    service.pressed(record);
    expect(live()[0]!.shown).toBe(true);
    service.pressed(record);
    expect(live()[0]!.shown).toBe(false);
    // A press that arrives after the game lost the front does nothing.
    world.foreground = null;
    service.tick();
    service.pressed(record);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.shown).toBe(false);
  });

  it("has no key for an Always overlay or while the switch is off", async () => {
    const { service, world, key } = await setup();
    show(service);
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }));
    expect(service.wants(record)).toBe(false);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { mode: "toggle" });
    world.enabled = false;
    expect(service.wants(record)).toBe(false);
    expect(service.wants(key(layerBinding()))).toBe(false);
  });

  it("applies opacity and Hide from capture to the window", async () => {
    const { service, live } = await setup();
    show(service);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { opacity: 50, hideFromCapture: true });
    expect(live()[0]).toMatchObject({ opacity: 50, hideFromCapture: true });
  });

  it("removes an overlay with its window and its key", async () => {
    const { service, live, key, world } = await setup();
    show(service);
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }));
    service.remove({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" });
    expect(live()).toHaveLength(0);
    expect(world.removedKeys).toEqual([record]);
    // The game keeps its setup, now empty.
    expect(service.layout.setups()).toEqual(["$everywhere", "$all", "elden"]);
    expect(service.layout.items("elden")).toEqual([]);
  });

  it("tells Settings the switches, and the Overlay layout the items by setup", async () => {
    const { service } = await setup();
    show(service);
    show(service, CLOCK, "elden", "item-2");
    expect(service.view()).toEqual({ supported: true, enabled: true, stay: false, hidden: false, showing: true, layerKey: null });
    expect(service.layout.setups()).toEqual(["$everywhere", "$all", "elden"]);
    expect(service.layout.items("elden")).toMatchObject([
      { name: "Clock & Counter · item-1", mode: "always", scope: "game", source: expect.anything() },
      { name: "Clock & Counter · item-2" },
    ]);
    // Another game has no setup, All games none of them.
    expect(service.layout.items("other")).toEqual([]);
    expect(service.layout.items("$all")).toEqual([]);
  });
});

const layerKey = (key: (binding: ReturnType<typeof layerBinding>) => HotkeyRecord) => key(layerBinding());

describe("the in-game layer", () => {
  it("makes every overlay of the game visible with its frame, behind a veil, and back again with the key or Esc", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    show(service, CLOCK, "elden", "item-2");
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-2" }, { mode: "toggle" });
    expect(live().map((window) => window.shown)).toEqual([true, false]);
    const layer = layerKey(key);
    expect(service.wants(layer)).toBe(true);
    expect(world.veils).toHaveLength(0);

    service.pressed(layer);
    expect(service.layerOpen).toBe(true);
    expect(live().map((window) => [window.shown, window.arranging])).toEqual([[true, true], [true, true]]);
    expect(world.veils).toHaveLength(1);
    expect(world.veils[0]).toMatchObject({ rect: SCREEN, destroyed: false });
    expect(world.registered.has("Escape")).toBe(true);

    world.registered.get("Escape")!();
    expect(live().map((window) => [window.shown, window.arranging])).toEqual([[true, false], [false, false]]);
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(world.registered.has("Escape")).toBe(false);
    expect(world.focused).toBe(1);

    service.pressed(layer);
    service.pressed(layer);
    expect(live().every((window) => !window.arranging)).toBe(true);
    expect(world.veils).toHaveLength(2);
    expect(world.veils[1]!.destroyed).toBe(true);
    expect(world.focused).toBe(2);
  });

  it("puts the veil under everything else: overlays shown before it are raised after it", async () => {
    const { service, live, key } = await setup();
    show(service);
    service.pressed(layerKey(key));
    expect(live()[0]!.log).toContain("raise");
  });

  it("only opens for a game in front that has something to show, and ignores the key anywhere else", async () => {
    const { service, world, key } = await setup();
    show(service);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(false);
    expect(world.veils).toHaveLength(0);
    expect(service.wants(layerKey(key))).toBe(false);
  });

  it("closes without giving the game the keyboard when the game leaves the front", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    service.pressed(layerKey(key));
    world.foreground = null;
    service.tick();
    expect(live()[0]).toMatchObject({ shown: false, arranging: false });
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(world.registered.has("Escape")).toBe(false);
    expect(world.focused).toBe(0);
  });

  it("closes, giving the keyboard to nobody, when the game window it opened over is another one, or minimized", async () => {
    const { service, world, key } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, handle: "0x10", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(true);
    // The same window stays open.
    service.tick();
    expect(service.layerOpen).toBe(true);
    // A new window of the same program (the game restarted): not the one the layer opened over.
    world.foreground = { program: GAME_EXE, handle: "0x20", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.layerOpen).toBe(false);
    expect(world.veils[0]!.destroyed).toBe(true);
    // Minimized (the probe finds no window).
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(true);
    world.foreground = null;
    service.tick();
    expect(service.layerOpen).toBe(false);
    expect(world.focused).toBe(0);
  });

  it("doesn't open for a game that owns the screen exclusively, and says why instead", async () => {
    const { service, world, key } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 3 };
    service.tick();
    world.notices.length = 0;
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(false);
    expect(world.veils).toHaveLength(0);
    expect(world.notices).toEqual(["Switch the game to borderless to see overlays."]);
  });

  it("closes the layer when the game goes exclusive full screen", async () => {
    const { service, world, key } = await setup();
    show(service);
    service.pressed(layerKey(key));
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 3 };
    service.tick();
    expect(service.layerOpen).toBe(false);
  });

  it("follows the game's window with the veil", async () => {
    const { service, world, key } = await setup();
    show(service);
    service.pressed(layerKey(key));
    world.foreground = { program: GAME_EXE, bounds: { x: 100, y: 50, width: 1280, height: 720 }, notification: 0 };
    service.tick();
    expect(world.veils[0]!.rect).toEqual({ x: 100, y: 50, width: 1280, height: 720 });
  });

  it("saves where the user left an overlay, relative to the game, and leaves a window being dragged alone", async () => {
    const { service, live, world } = await setup();
    show(service);
    const window = live()[0]!;
    window.request.moved({ x: 960, y: 540, width: 480, height: 270 });
    expect(service.layout.items("elden")).toHaveLength(1);
    window.dragging = true;
    window.rect = { x: 1, y: 2, width: 3, height: 4 };
    service.tick();
    expect(window.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    window.dragging = false;
    service.tick();
    expect(window.rect).toEqual({ x: 960, y: 540, width: 480, height: 270 });
    // The game's window shrinks: the overlay keeps its place in it.
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 960, height: 540 }, notification: 0 };
    service.tick();
    expect(window.rect).toEqual({ x: 480, y: 270, width: 240, height: 135 });
  });

  it("closing an overlay in the frame removes it", async () => {
    const { service, live } = await setup();
    show(service);
    live()[0]!.request.closeRequested();
    expect(live()).toHaveLength(0);
    expect(service.layout.items("elden")).toEqual([]);
  });
});

describe("general overlays", () => {
  it("made in a workspace that is no game land in All games and show over every library game in front", async () => {
    const { service, world, live } = await setup();
    show(service, CLOCK, "personal");
    expect(service.layout.setups()).toEqual(["$everywhere", "$all"]);
    expect(service.layout.items("$all")).toMatchObject([{ scope: "all" }]);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.shown).toBe(true);
    expect(service.frontGame()).toBe("elden");
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.frontGame()).toBe("other");
    expect(live()[0]!.shown).toBe(true);
    // Not over a program that is no library game.
    world.foreground = { program: "C:\\Windows\\notepad.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.shown).toBe(false);
  });

  it("a game's own overlay stays over its own game only", async () => {
    const { service, world, live } = await setup();
    show(service, CLOCK, "elden");
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()[0]!.shown).toBe(false);
  });

  it("have their toggle key over any game, and the layer key works over any game", async () => {
    const { service, world, key } = await setup();
    show(service, CLOCK, "personal");
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "item-1" }, { mode: "toggle" });
    const toggle = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "item-1" }));
    expect(service.wants(toggle)).toBe(true);
    expect(service.wants(layerKey(key))).toBe(true);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.wants(toggle)).toBe(true);
    service.pressed(toggle);
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(true);
  });

  it("count toward All games' eight; a game's new setup copies them and keeps room for the one that made it", async () => {
    const { service } = await setup();
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(show(service, CLOCK, "personal", `item-${i}`)).toBe("shown");
    expect(show(service, CLOCK, "personal", "one-more")).toBe("full");
    expect(show(service, CLOCK, "elden", "item-0")).toBe("shown");
  });
});

describe("hiding everything", () => {
  it("closes every overlay, the veil and the panels at once when Game overlays are switched off", async () => {
    const { service, world, live, key } = await setup();
    service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, workspaceId: "elden", instanceId: PANEL });
    show(service);
    service.pressed(layerKey(key));
    const windows = [...world.windows];
    expect(windows.length).toBeGreaterThan(1);
    expect(world.veils[0]!.destroyed).toBe(false);
    world.enabled = false;
    service.tick();
    expect(windows.every((window) => window.destroyed)).toBe(true);
    expect(live()).toHaveLength(0);
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(world.registered.has("Escape")).toBe(false);
    expect(service.layerOpen).toBe(false);
  });

  it("hides all for now, takes no keys, and shows again when asked; it is not remembered", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    const layer = layerKey(key);
    service.setHidden(true);
    expect(live()).toHaveLength(0);
    expect(service.view().hidden).toBe(true);
    expect(service.wants(layer)).toBe(false);
    expect(service.needsWatcher()).toBe(false);
    service.pressed(layer);
    expect(service.layerOpen).toBe(false);
    expect(world.veils).toHaveLength(0);
    service.setHidden(false);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.shown).toBe(true);
    expect(service.view().hidden).toBe(false);
  });

  it("hiding while the layer is open closes the layer", async () => {
    const { service, world, key } = await setup();
    show(service);
    service.pressed(layerKey(key));
    service.setHidden(true);
    expect(service.layerOpen).toBe(false);
    expect(world.veils[0]!.destroyed).toBe(true);
  });

  it("closeNow closes every window and the veil without waiting, and drops Esc", async () => {
    const { service, world, key } = await setup();
    service.start();
    show(service);
    service.pressed(layerKey(key));
    const windows = [...world.windows];
    service.closeNow();
    expect(windows.every((window) => window.destroyed)).toBe(true);
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(world.registered.has("Escape")).toBe(false);
    // Safe to call again (a signal after quitting).
    service.closeNow();
  });
});

describe("what goes with a game or a module", () => {
  it("removes the overlays of a deleted game and of a removed module", async () => {
    const { service, live } = await setup();
    show(service);
    show(service, CLOCK, "other", "item-1");
    service.forgetWorkspace("other");
    // The deleted game's setup goes with it.
    expect(service.layout.setups()).toEqual(["$everywhere", "$all", "elden"]);
    service.forgetModule(CLOCK.manifest.id, "official");
    expect(service.layout.items("elden")).toEqual([]);
    expect(live()).toHaveLength(0);
  });

  it("leaves another publisher's module with the same id alone when asked about one owner", async () => {
    const { service } = await setup();
    show(service);
    service.forgetModule(CLOCK.manifest.id, "someone-else");
    expect(service.layout.items("elden")).toHaveLength(1);
  });

  it("forgets the overlays of a module another publisher's module replaced, and never serves its page", async () => {
    const { service, world, live } = await setup();
    show(service);
    const request = live()[0]!.request;
    expect(request.page()).toEqual({ root: "/nowhere", entry: "dist/overlay.html" });
    world.modules.set(CLOCK.manifest.id, { ...CLOCK, owner: "someone-else" });
    expect(request.page()).toBeNull();
    service.tick();
    expect(service.layout.items("elden")).toEqual([]);
    expect(live()).toHaveLength(0);
  });

  it("doesn't show the overlay of a module that isn't installed, and shows it again when it is back", async () => {
    const { service, world, live } = await setup();
    show(service);
    world.modules.delete(CLOCK.manifest.id);
    service.tick();
    expect(live()[0]!.shown).toBe(false);
    world.modules.set(CLOCK.manifest.id, CLOCK);
    service.tick();
    expect(live()[0]!.shown).toBe(true);
  });
});

describe("what the page is given", () => {
  it("is what the module published for the key, read from the same store Stream overlays use", async () => {
    const { service, live, overlays } = await setup();
    show(service);
    const { state, watch } = live()[0]!.request;
    expect(state()).toBeNull();
    const heard: unknown[] = [];
    const stop = watch((next) => void heard.push(next));
    overlays.publish({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { value: 7 });
    expect(state()).toEqual({ value: 7 });
    expect(heard).toEqual([{ value: 7 }]);
    stop!();
    overlays.publish({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { value: 8 });
    expect(heard).toHaveLength(1);
  });

  it("tells the stream its link is gone when the links are reset, so the page asks again", async () => {
    const { service, live, overlays } = await setup();
    show(service);
    const heard: unknown[] = [];
    live()[0]!.request.watch((next) => void heard.push(next));
    overlays.resetAll();
    expect(heard).toEqual([undefined]);
  });

  it("has nothing to listen to without a link, so the page's stream ends and it asks again", async () => {
    const { service, live, overlays } = await setup();
    show(service);
    overlays.forget(() => true);
    expect(live()[0]!.request.watch(() => {})).toBeNull();
  });
});

describe("a page that crashes", () => {
  const crash = (live: () => FakeWindow[]) => live()[0]!.request.ended();

  it("is made again with the same name, until it crashes three times in a few minutes", async () => {
    const { service, world, live } = await setup();
    show(service);
    const id = live()[0]!.request.id;
    for (let i = 0; i < 2; i++) {
      crash(live);
      expect(live()).toHaveLength(0);
      service.tick();
      expect(live()).toHaveLength(1);
      expect(live()[0]!.request.id).toBe(id);
    }
    expect(world.notices).toEqual([]);
    crash(live);
    for (let i = 0; i < 3; i++) service.tick();
    expect(live()).toHaveLength(0);
    // Told once, in the user's words.
    expect(world.notices).toEqual(["This overlay stopped working."]);
  });

  it("gets another chance when the user shows it again, or toggles it", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    for (let i = 0; i < 3; i++) {
      crash(live);
      service.tick();
    }
    expect(live()).toHaveLength(0);
    expect(show(service)).toBe("shown");
    expect(live()).toHaveLength(1);

    const subject = { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" };
    service.update(subject, { mode: "toggle" });
    const toggle = key(toggleBinding(subject));
    service.pressed(toggle);
    for (let i = 0; i < 3; i++) {
      crash(live);
      service.tick();
    }
    expect(live()).toHaveLength(0);
    service.pressed(toggle);
    service.pressed(toggle);
    expect(live()).toHaveLength(1);
    expect(world.notices).toHaveLength(2);
  });

  it("forgets old crashes after a few minutes", async () => {
    const { service, world, live } = await setup();
    show(service);
    const now = vi.spyOn(Date, "now");
    try {
      const start = Date.now();
      for (let i = 0; i < 4; i++) {
        now.mockReturnValue(start + i * 10 * 60_000);
        crash(live);
        service.tick();
      }
      expect(live()).toHaveLength(1);
      expect(world.notices).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });
});

describe("leftovers", () => {
  it("leaves no overlay behind when its link can't be made", async () => {
    const { service, overlays, world } = await setup();
    const subject = (key: string) => ({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key });
    for (let i = 0; i < LIMITS.maxOverlays; i++) overlays.link(subject("k" + i));
    expect(() => show(service)).toThrowError(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
    expect(service.has(subject("item-1"))).toBe(false);
    // Nor the setup made for it.
    expect(service.layout.setups()).toEqual(["$everywhere", "$all"]);
    expect(world.windows).toHaveLength(0);
  });

  it("takes away the per-game arrange keys and the keys of panels over the game of Tavora 0.21.0 and before, when it starts", async () => {
    const { service, world, key } = await setup({ file: { version: 1, overlays: [] } });
    const arrange = key({ owner: "tavora", moduleId: "tavora", workspaceId: "elden", action: "$arrange", target: "arrange" });
    const panelToggle = key({ owner: "official", moduleId: TODOS.manifest.id, workspaceId: "elden", action: OVERLAY_TOGGLE_ACTION, target: `panel-${PANEL}` });
    const keep = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }));
    service.start();
    expect(world.removedKeys).toEqual([arrange, panelToggle]);
    expect(world.removedKeys).not.toContain(keep);
    await service.shutdown();
  });

  it("hands the arrange key set last to the layer key when migrating, and does nothing for a file of version 2", async () => {
    const old = await setup({ file: { version: 1, overlays: [] } });
    old.key({ owner: "tavora", moduleId: "tavora", workspaceId: "elden", action: "$arrange", target: "arrange" });
    const newest = old.key({ owner: "tavora", moduleId: "tavora", workspaceId: "other", action: "$arrange", target: "arrange" });
    old.service.start();
    expect(old.world.movedKeys).toEqual([{ from: newest, to: layerBinding() }]);
    await old.service.shutdown();

    const current = await setup({ file: { version: 2, overlays: [], panels: [] } });
    current.key({ owner: "tavora", moduleId: "tavora", workspaceId: "elden", action: "$arrange", target: "arrange" });
    current.service.start();
    expect(current.world.movedKeys).toEqual([]);
    expect(current.world.removedKeys).toEqual([]);
    await current.service.shutdown();
  });

  it("refuses overlay keys behind the reserved panel- prefix", async () => {
    const { service, world } = await setup();
    expect(() => show(service, CLOCK, "elden", `panel-${PANEL}`)).toThrow(/reserved/);
    expect(world.windows).toHaveLength(0);
  });

  const OTHER: StreamingModule = { ...CLOCK, manifest: { ...CLOCK.manifest, id: "tavora.other" } };

  it("hides one overlay of the module and lists the module's keys in its workspace scope", async () => {
    const { service } = await setup();
    show(service);
    show(service, CLOCK, "elden", "item-2");
    show(service, CLOCK, "personal", "item-9");
    show(service, OTHER, "elden", "other-module");
    expect(service.keysOf(CLOCK, "elden")).toEqual(["item-1", "item-2"]);
    expect(service.keysOf(CLOCK, "personal")).toEqual(["item-9"]);
    service.hide(CLOCK, "elden", "item-1");
    service.hide(CLOCK, "elden", "never-there");
    expect(service.keysOf(CLOCK, "elden")).toEqual(["item-2"]);
    expect(service.keysOf(OTHER, "elden")).toEqual(["other-module"]);
  });

  it("closes the window of a game that stays out of the front for 30 seconds, and makes it again when it is back", async () => {
    const { service, world, live } = await setup();
    show(service);
    const now = vi.spyOn(Date, "now");
    try {
      const start = Date.now();
      now.mockReturnValue(start);
      world.foreground = null;
      service.tick();
      expect(world.windows[0]).toMatchObject({ shown: false, destroyed: false });
      now.mockReturnValue(start + 29_000);
      service.tick();
      expect(live()).toHaveLength(1);
      now.mockReturnValue(start + 31_000);
      service.tick();
      expect(live()).toHaveLength(0);
      world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
      service.tick();
      expect(live()).toHaveLength(1);
      expect(live()[0]!.shown).toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  it("keeps the window of a toggled-off overlay while its game is in front", async () => {
    const { service, live } = await setup();
    show(service);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }, { mode: "toggle" });
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(Date.now() + 10 * 60_000);
      service.tick();
      expect(live()).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });
});

describe("hotkey actions", () => {
  it("tells overlay actions from a module's", () => {
    expect(isOverlayAction(OVERLAY_TOGGLE_ACTION)).toBe(true);
    expect(isOverlayAction(OVERLAY_LAYER_ACTION)).toBe(true);
    expect(isOverlayAction("start-pause")).toBe(false);
  });

  it("names them for the hotkey dialog", async () => {
    const { service } = await setup();
    show(service);
    show(service, CLOCK, "personal", "item-1");
    expect(service.dialogNames(layerBinding())).toEqual({ label: "Tavora over game", module: "Tavora", action: "Open or close" });
    expect(service.dialogNames(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" }))).toEqual({
      label: "Clock & Counter",
      module: "Elden Ring",
      action: "Show or hide",
    });
    expect(service.dialogNames(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "item-1" })).module).toBe("All games");
  });
});

describe("a panel in the game", () => {
  const add = (service: GameOverlays, instanceId = PANEL, workspaceId = "elden") => service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, workspaceId, instanceId });
  const panelWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.instanceId !== undefined);
  const SECOND = "0a1b2c3d-0000-4000-8000-000000000002";

  it("is not over the game until the layer opens, and goes back to its slot when it closes", async () => {
    const { service, world, key } = await setup();
    expect(add(service)).toBe("shown");
    expect(service.hasPanel(PANEL)).toBe(true);
    expect(panelWindows(world)).toHaveLength(0);
    expect(service.panelOpen(PANEL)).toBe(false);

    service.pressed(layerKey(key));
    const [window] = panelWindows(world);
    expect(window).toMatchObject({ shown: true, arranging: true, destroyed: false });
    expect(service.panelOpen(PANEL)).toBe(true);
    expect(window!.focusedPanel).toBe(1);

    world.registered.get("Escape")!();
    expect(window!.destroyed).toBe(true);
    expect(service.panelOpen(PANEL)).toBe(false);
    // Still one the user shows in the game: it comes up again with the next layer.
    expect(service.hasPanel(PANEL)).toBe(true);
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(2);
  });

  it("starts at the size its module prefers", async () => {
    const { service, world, key } = await setup();
    show(service);
    service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, workspaceId: "elden", instanceId: PANEL }, { width: 360, height: 200 });
    service.pressed(layerKey(key));
    expect(panelWindows(world)[0]!.rect).toMatchObject({ width: 360, height: 200 });
  });

  it("opens the layer even with only a panel, and puts the panel above the veil and the frames", async () => {
    const { service, world, key } = await setup();
    add(service);
    show(service);
    service.pressed(layerKey(key));
    const [panel] = panelWindows(world);
    const overlay = world.windows.find((window) => window.request.instanceId === undefined)!;
    expect(world.veils).toHaveLength(1);
    // Overlays are raised first, panels last.
    expect(overlay.log).toContain("raise");
    expect(panel!.log.at(-1)).toBe("focus");
    expect(panel!.log.indexOf("raise")).toBeGreaterThan(-1);
  });

  it("gives the keyboard to the panel used last, only once; a panel is placed and shown before it arranges and takes the keyboard", async () => {
    const { service, world, key } = await setup();
    world.panelNames.set(SECOND, "Notes");
    add(service);
    add(service, SECOND);
    world.panelUsed.set(PANEL, 100);
    world.panelUsed.set(SECOND, 50);
    service.pressed(layerKey(key));
    const [first, second] = panelWindows(world);
    expect(first!.focusedPanel).toBe(1);
    expect(second!.focusedPanel).toBe(0);
    expect(first!.log.filter((step, at) => first!.log.indexOf(step) === at)).toEqual(["rect", "show", "arrange", "raise", "focus"]);
  });

  it("is kept where the user put it, relative to the game, and closing its frame stops showing it in game", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.pressed(layerKey(key));
    const [window] = panelWindows(world);
    window!.request.moved({ x: 960, y: 540, width: 480, height: 270 });
    world.registered.get("Escape")!();
    service.pressed(layerKey(key));
    expect(panelWindows(world)[1]!.rect).toEqual({ x: 960, y: 540, width: 480, height: 270 });
    panelWindows(world)[1]!.request.closeRequested();
    expect(service.hasPanel(PANEL)).toBe(false);
    expect(panelWindows(world)[1]!.destroyed).toBe(true);
  });

  it("says the right close label for the frame, and the panel's tab for its name", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.pressed(layerKey(key));
    expect(panelWindows(world)[0]!.request.frameText()).toEqual({ name: "To-Dos", closeLabel: "Stop showing this panel in game", layoutLabel: "Open the Overlay layout" });
  });

  it("stopPanel keeps it in its slot, forgets it in the game", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.stopPanel(PANEL);
    expect(service.hasPanel(PANEL)).toBe(false);
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(0);
  });

  it("says off and opens Settings > Overlays while the switch is off, and where overlays can't be drawn says off and nothing else", async () => {
    const off = await setup({ enabled: false });
    expect(add(off.service)).toBe("off");
    expect(off.world.opened).toEqual(["game-overlays"]);
    expect(off.service.hasPanel(PANEL)).toBe(false);
    const unsupported = await setup({ supported: false });
    expect(add(unsupported.service)).toBe("off");
    expect(unsupported.world.opened).toEqual([]);
  });

  it("counts toward the game's eight with module overlays, and general panels toward the general eight", async () => {
    const { service } = await setup();
    for (let i = 0; i < LIMITS.maxGameOverlays - 1; i++) show(service, CLOCK, "elden", `item-${i}`);
    expect(add(service)).toBe("shown");
    expect(add(service, SECOND)).toBe("full");
    expect(add(service, SECOND, "personal")).toBe("shown");
  });

  it("is over any library game in front when it comes from a workspace that is no game", async () => {
    const { service, world, key } = await setup();
    add(service, PANEL, "personal");
    expect(service.layout.items("$all")).toMatchObject([{ name: "To-Dos", scope: "all", mode: "always", opacity: 100, hideFromCapture: false, hotkey: null, source: null, ref: { kind: "panel", instanceId: PANEL } }]);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(1);
  });

  it("is a game's own panel only over its own game", async () => {
    const { service, world, key } = await setup();
    add(service);
    show(service, CLOCK, "other");
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(0);
  });

  it("is dropped when the panel is gone, and has no window when it can't be made", async () => {
    const { service, world, key } = await setup();
    add(service);
    world.gone.add(PANEL);
    service.tick();
    expect(service.hasPanel(PANEL)).toBe(false);
    world.gone.delete(PANEL);
    world.panelNames.delete(PANEL);
    add(service);
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(0);
    expect(service.hasPanel(PANEL)).toBe(false);
  });

  it("goes with a removed module, a deleted game, and a module another publisher replaced", async () => {
    const { service, world } = await setup();
    add(service);
    service.forgetModule(TODOS.manifest.id, "official");
    expect(service.hasPanel(PANEL)).toBe(false);
    add(service);
    service.forgetWorkspace("elden");
    expect(service.hasPanel(PANEL)).toBe(false);
    add(service);
    world.modules.set(TODOS.manifest.id, { ...TODOS, owner: "someone-else" });
    service.tick();
    expect(service.hasPanel(PANEL)).toBe(false);
  });

  it("drops a panel whose type no longer allows being shown in the game", async () => {
    const { service, world } = await setup();
    add(service);
    add(service, SECOND);
    service.tick();
    expect(service.hasPanel(PANEL)).toBe(true);
    world.notAllowed.add(PANEL);
    service.tick();
    expect(service.hasPanel(PANEL)).toBe(false);
    expect(service.hasPanel(SECOND)).toBe(true);
  });

  it("shows the Live badge when it is in the game or its module has an overlay over the game", async () => {
    const { service } = await setup();
    expect(service.liveFor(PANEL, "official", TODOS.manifest.id, "elden")).toBe(false);
    add(service);
    expect(service.liveFor(PANEL, "official", TODOS.manifest.id, "elden")).toBe(true);
    // A tab of the clock: no panel in the game, but the module has an overlay.
    expect(service.liveFor(SECOND, "official", CLOCK.manifest.id, "elden")).toBe(false);
    show(service);
    expect(service.liveFor(SECOND, "official", CLOCK.manifest.id, "elden")).toBe(true);
    // Another game's overlay doesn't count; a general one does.
    expect(service.liveFor(SECOND, "official", CLOCK.manifest.id, "other")).toBe(false);
    show(service, CLOCK, "personal", "item-9");
    expect(service.liveFor(SECOND, "official", CLOCK.manifest.id, "other")).toBe(true);
  });

  it("keeps the game in front while its window has the keyboard, and ends the layer when Tavora's window is in front with no panel focused", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.pressed(layerKey(key));
    panelWindows(world)[0]!.focused = true;
    world.foreground = { program: "C:\\Program Files\\Tavora\\Tavora.exe", bounds: { x: 5, y: 5, width: 300, height: 200 }, notification: 0, own: true };
    service.tick();
    expect(service.frontGame()).toBe("elden");
    expect(service.layerOpen).toBe(true);
    panelWindows(world)[0]!.focused = false;
    service.tick();
    expect(service.layerOpen).toBe(false);
    expect(panelWindows(world)[0]!.destroyed).toBe(true);
  });

  it("closes the layer when the game exits while a panel has the keyboard", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.pressed(layerKey(key));
    panelWindows(world)[0]!.focused = true;
    world.foreground = null;
    service.tick();
    expect(service.layerOpen).toBe(false);
    expect(world.registered.has("Escape")).toBe(false);
  });

  it("gives the game the keyboard back before the panels go, so the panel that had it doesn't hide for a moment", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.pressed(layerKey(key));
    panelWindows(world)[0]!.focused = true;
    world.focused = 0;
    world.registered.get("Escape")!();
    expect(world.focused).toBe(1);
  });

  it("closes every window and the veil, unregisters Escape and stops looking on shutdown", async () => {
    const { service, world, live, key } = await setup();
    service.start();
    add(service);
    show(service);
    service.pressed(layerKey(key));
    const windows = [...world.windows];
    await service.shutdown();
    expect(windows.every((window) => window.destroyed)).toBe(true);
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(live()).toHaveLength(0);
    expect(world.registered.has("Escape")).toBe(false);
    expect(service.frontGame()).toBe(null);
  });

  it("is kept across a restart by its instance id", async () => {
    const { service } = await setup();
    add(service);
    await service.shutdown();
    const again = await GameOverlayStore.load(dir);
    expect(again.panelOf(PANEL, "elden")).toMatchObject({ instanceId: PANEL, workspaceId: "elden" });
  });
});

describe("a panel's live view", () => {
  // A panel of a module with an overlay page, shown in the game.
  const add = (service: GameOverlays, module = CLOCK, instanceId = PANEL) => service.showPanel({ owner: module.owner, moduleId: module.manifest.id, workspaceId: "elden", instanceId });
  const liveWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.id.startsWith("live\n") && !window.destroyed);
  const panelWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.instanceId !== undefined);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 5));
  const feed = async (service: GameOverlays, state: JsonValue | null, owner = "official") => {
    service.setLive(PANEL, owner, state);
    await flush();
  };

  it("shows nothing until the panel passes a state, then the overlay page in the panel's spot with that state", async () => {
    const { service, world } = await setup();
    add(service);
    expect(liveWindows(world)).toHaveLength(0);
    await feed(service, { hp: 3 });
    const [window] = liveWindows(world);
    expect(window).toMatchObject({ shown: true, arranging: false, opacity: 100, hideFromCapture: false });
    expect(window!.rect).toEqual({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    expect(window!.request.page()).toEqual({ root: "/nowhere", entry: "dist/overlay.html" });
    expect(window!.request.state()).toEqual({ hp: 3 });
    expect(window!.request.gameBounds()).toEqual(SCREEN);
  });

  it("feeds the page every new state, and hides the view when the state goes", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, 1);
    const [window] = liveWindows(world);
    const heard: unknown[] = [];
    const stop = window!.request.watch((state) => heard.push(state));
    await feed(service, 2);
    expect(heard).toEqual([2]);
    expect(window!.request.state()).toBe(2);
    stop?.();
    await feed(service, 3);
    expect(heard).toEqual([2]);
    await feed(service, null);
    expect(window!.shown).toBe(false);
    await feed(service, 4);
    expect(window!.shown).toBe(true);
  });

  it("gives way to the full panel while the layer is open, and returns in the new spot", async () => {
    const { service, world, key } = await setup();
    add(service);
    await feed(service, "x");
    const [view] = liveWindows(world);
    service.pressed(layerKey(key));
    expect(view!.shown).toBe(false);
    expect(panelWindows(world)).toHaveLength(1);
    panelWindows(world)[0]!.request.moved({ x: 960, y: 540, width: 480, height: 270 });
    world.registered.get("Escape")!();
    expect(liveWindows(world)).toEqual([view]);
    expect(view!.shown).toBe(true);
    expect(view!.rect).toEqual({ x: 960, y: 540, width: 480, height: 270 });
  });

  it("is click-through and read-only: it is never arranged and has no frame actions", async () => {
    const { service, world, key } = await setup();
    add(service);
    await feed(service, "x");
    const [view] = liveWindows(world);
    service.pressed(layerKey(key));
    world.registered.get("Escape")!();
    expect(view!.log).not.toContain("arrange");
    view!.request.closeRequested();
    view!.request.moved({ x: 1, y: 1, width: 10, height: 10 });
    expect(service.hasPanel(PANEL)).toBe(true);
    expect(view!.rect).not.toEqual({ x: 1, y: 1, width: 10, height: 10 });
  });

  it("shows only with the toggle key in toggle mode, and the key belongs to the panel", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x");
    service.updatePanelView(PANEL, { mode: "toggle" });
    expect(liveWindows(world).every((window) => !window.shown)).toBe(true);
    const subject = service.panelSubject(PANEL)!;
    expect(subject).toEqual({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: PANEL });
    expect(service.hasKey(subject)).toBe(true);
    expect(service.has(subject)).toBe(false);
    const record: HotkeyRecord = { ...toggleBinding(subject), label: "x", accelerator: "F8" };
    expect(service.wants(record)).toBe(true);
    expect(service.general(record)).toBe(false);
    expect(service.dialogNames(toggleBinding(subject))).toEqual({ label: "To-Dos", module: "Elden Ring", action: "Show or hide" });
    service.pressed(record);
    expect(liveWindows(world)[0]!.shown).toBe(true);
    service.pressed(record);
    expect(liveWindows(world)[0]!.shown).toBe(false);
    service.updatePanelView(PANEL, { mode: "always" });
    expect(liveWindows(world)[0]!.shown).toBe(true);
    expect(service.wants(record)).toBe(false);
  });

  it("applies opacity and Hide from capture, and lists them in the layout", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x");
    service.updatePanelView(PANEL, { opacity: 50, hideFromCapture: true });
    expect(liveWindows(world)[0]).toMatchObject({ opacity: 50, hideFromCapture: true });
    expect(service.layout.items("elden")).toMatchObject([{ name: "To-Dos", scope: "game", mode: "always", opacity: 50, hideFromCapture: true, hotkey: null, source: expect.anything() }]);
  });

  it("is not there for a module without an overlay page", async () => {
    const { service, world } = await setup();
    world.modules.set(NO_OVERLAY.manifest.id, NO_OVERLAY);
    add(service, NO_OVERLAY);
    await feed(service, "x");
    expect(liveWindows(world)).toHaveLength(0);
    expect(service.layout.items("elden")[0]!.source).toBeNull();
  });

  it("is not there when the game is not in front, or Game overlays are off", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x");
    world.enabled = false;
    service.tick();
    expect(liveWindows(world)).toHaveLength(0);
    world.enabled = true;
    service.tick();
    expect(liveWindows(world)).toHaveLength(1);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(liveWindows(world).every((window) => !window.shown)).toBe(true);
  });

  it("goes with the panel: stop showing or closing for good, with its key and its state", async () => {
    const { service, world, key } = await setup();
    add(service);
    await feed(service, "x");
    key(toggleBinding(service.panelSubject(PANEL)!));
    service.stopPanel(PANEL);
    expect(liveWindows(world)).toHaveLength(0);
    expect(world.removedKeys.map((record) => record.target)).toEqual([PANEL]);
    // Shown in the game again later: nothing until the panel passes a state again.
    service.forgetLive(PANEL);
    add(service);
    expect(liveWindows(world)).toHaveLength(0);
    await feed(service, "y");
    expect(liveWindows(world)).toHaveLength(1);
    service.forgetLive(PANEL);
    await flush();
    expect(liveWindows(world).every((window) => !window.shown)).toBe(true);
  });

  it("goes with its key and state for every reason a panel is pruned", async () => {
    const reasons: [string, (world: Awaited<ReturnType<typeof setup>>["world"]) => void][] = [
      ["the panel is gone", (world) => world.gone.add(PANEL)],
      ["its type no longer allows being in game", (world) => world.notAllowed.add(PANEL)],
      ["its module was replaced by another publisher's", (world) => world.modules.set(CLOCK.manifest.id, { ...CLOCK, owner: "someone-else" })],
    ];
    for (const [, apply] of reasons) {
      const { service, world, key } = await setup();
      add(service);
      await feed(service, "x");
      key(toggleBinding(service.panelSubject(PANEL)!));
      apply(world);
      service.tick();
      expect(service.hasPanel(PANEL)).toBe(false);
      expect(world.removedKeys.map((record) => record.target)).toEqual([PANEL]);
      expect(liveWindows(world)).toHaveLength(0);
      // Back to normal and shown again: the old state doesn't come back.
      world.gone.clear();
      world.notAllowed.clear();
      world.modules.set(CLOCK.manifest.id, CLOCK);
      add(service);
      expect(liveWindows(world)).toHaveLength(0);
    }
  });

  it("goes with a removed module or game, and with it the state", async () => {
    const module = await setup();
    add(module.service);
    await feed(module.service, "x");
    module.key(toggleBinding(module.service.panelSubject(PANEL)!));
    module.service.forgetModule(CLOCK.manifest.id);
    expect(liveWindows(module.world)).toHaveLength(0);
    expect(module.world.removedKeys.map((record) => record.target)).toEqual([PANEL]);
    add(module.service);
    expect(liveWindows(module.world)).toHaveLength(0);
    const game = await setup();
    add(game.service);
    await feed(game.service, "x");
    game.service.forgetWorkspace("elden");
    expect(liveWindows(game.world)).toHaveLength(0);
    add(game.service);
    expect(liveWindows(game.world)).toHaveLength(0);
  });

  it("looks once for any number of calls in a row", async () => {
    const { service, world } = await setup();
    add(service);
    const before = world.probeCalls;
    for (let i = 0; i < 50; i++) {
      service.setLive(PANEL, "official", i % 2 === 0 ? "x" : null);
      service.setLive(PANEL, "official", i % 2 === 0 ? null : "y");
    }
    expect(world.probeCalls).toBe(before);
    await flush();
    expect(world.probeCalls).toBe(before + 1);
    expect(liveWindows(world)).toHaveLength(1);
  });

  it("keeps showing the last state, also when the panel isn't running", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x");
    await flush();
    service.tick();
    expect(liveWindows(world)[0]!.shown).toBe(true);
    expect(liveWindows(world)[0]!.request.state()).toBe("x");
  });

  it("ignores a state from another publisher's module, and never serves it to a page", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x", "someone-else");
    expect(liveWindows(world)).toHaveLength(0);
    await feed(service, "mine");
    expect(liveWindows(world)[0]!.request.state()).toBe("mine");
  });

  it("gives a view whose page crashed too often another chance when the user shows the panel again", async () => {
    const { service, world } = await setup();
    add(service);
    await feed(service, "x");
    for (let i = 0; i < 3; i++) {
      liveWindows(world)[0]!.request.ended();
      service.tick();
    }
    expect(liveWindows(world)).toHaveLength(0);
    expect(world.notices).toEqual(["This overlay stopped working."]);
    add(service);
    expect(liveWindows(world)).toHaveLength(1);
  });
});

describe("positions that scale with the game window", () => {
  const subject = { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "item-1" };

  it("gives the content the zoom of the game window's height, and follows when the window changes", async () => {
    const { service, world, live } = await setup();
    show(service);
    expect(live()[0]!.zoom).toBe(1);
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, notification: 0 };
    service.tick();
    expect(live()[0]!.zoom).toBeCloseTo(1440 / 1080, 5);
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 640, height: 360 }, notification: 0 };
    service.tick();
    // A tiny window doesn't make the content unreadable.
    expect(live()[0]!.zoom).toBe(0.5);
  });

  it("keeps a corner overlay in its corner at the same size when the window gets wider", async () => {
    const { service, world, live } = await setup();
    show(service);
    const narrow = { ...live()[0]!.rect! };
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 2520, height: 1080 }, notification: 0 };
    service.tick();
    expect(live()[0]!.rect).toEqual(narrow);
  });

  it("remembers the size of the game's window as last seen, and says so", async () => {
    const { service, world } = await setup();
    show(service);
    expect(service.layout.seenSize("elden")).toEqual({ width: 1920, height: 1080 });
    const before = world.changes;
    service.tick();
    expect(world.changes).toBe(before);
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 2560, height: 1080 }, notification: 0 };
    service.tick();
    expect(service.layout.seenSize("elden")).toEqual({ width: 2560, height: 1080 });
    expect(world.changes).toBeGreaterThan(before);
    await service.shutdown();
    const again = await GameOverlayStore.load(dir);
    expect(again.seenSize("elden")).toEqual({ width: 2560, height: 1080 });
    service.forgetWorkspace("elden");
    expect(service.layout.seenSize("elden")).toBeUndefined();
  });

  it("places a version 2 file's items the old way on a window of any shape, and converts them to the pixel on the first real size", async () => {
    // Older Tavoras never wrote a window size.
    const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
    const old = { owner: "official", moduleId: "tavora.clock-counter", gameId: "elden", key: "item-1", scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: legacy };
    const { service, world, live } = await setup({ file: { version: 2, overlays: [old], panels: [] } });
    const wide = { x: 0, y: 0, width: 3440, height: 1440 };
    world.foreground = { program: GAME_EXE, bounds: wide, notification: 0 };
    service.tick();
    // On the same pixels as before, and anchored now.
    expect(live()[0]!.rect).toEqual(placeLegacy(legacy, wide));
    expect(service.layout.items("elden")[0]!.legacy).toBeUndefined();
    expect(service.layout.seenSize("elden")).toEqual({ width: 3440, height: 1440 });
    // On another window it follows the anchor, not the fractions.
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 2560, height: 1080 }, notification: 0 };
    service.tick();
    // 860 x 432 of the 1440 high window is 645 x 324 of a 1080 high one; its right edge is 129 from the window's.
    expect(live()[0]!.rect).toMatchObject({ width: 645, height: 324, x: 2560 - 645 - 129 });
  });

  it("does not convert on a launcher's window, and places the old way on it", async () => {
    const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
    const old = { owner: "official", moduleId: "tavora.clock-counter", gameId: "elden", key: "item-1", scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: legacy };
    const { service, world, live } = await setup({ file: { version: 2, overlays: [old], panels: [] } });
    const splash = { x: 100, y: 100, width: 600, height: 400 };
    world.foreground = { program: GAME_EXE, bounds: splash, notification: 0 };
    service.tick();
    expect(live()[0]!.rect).toEqual(placeLegacy(legacy, splash));
    expect(service.layout.items("elden")[0]!.legacy).toEqual(legacy);
    expect(service.layout.seenSize("elden")).toBeUndefined();
    // The real window comes: converted for it, the very same place as the old way.
    const real = { x: 0, y: 0, width: 2560, height: 1440 };
    world.foreground = { program: GAME_EXE, bounds: real, notification: 0 };
    service.tick();
    expect(live()[0]!.rect).toEqual(placeLegacy(legacy, real));
    expect(service.layout.items("elden")[0]!.legacy).toBeUndefined();
    await service.shutdown();
    const saved = await GameOverlayStore.load(dir);
    expect(saved.find({ owner: "official", moduleId: "tavora.clock-counter", workspaceId: "elden", key: "item-1" })!.legacy).toBeUndefined();
  });

  it("writes where the user left it in the frame as an anchored place", async () => {
    const { service, live } = await setup();
    show(service);
    live()[0]!.request.moved({ x: 1400, y: 700, width: 480, height: 270 });
    const rect = service.layout.items("elden")[0]!.rect;
    expect(rect).toMatchObject({ h: "right", v: "bottom" });
    expect(rect.width).toBeCloseTo(480 / 1080, 5);
  });

  it("opens the Overlay layout from the frame's button, on the game in front", async () => {
    const { service, world, live } = await setup();
    show(service);
    live()[0]!.request.layoutRequested();
    expect(world.layouts).toEqual(["elden"]);
  });

  it("takes a new place from the layout at once", async () => {
    const { service, live } = await setup();
    show(service);
    const ref = service.layout.items("elden")[0]!.ref;
    expect(service.layout.setRect("elden", ref, { h: "right", v: "bottom", x: 0.05, y: 0.05, width: 0.3, height: 0.2 })).toBe(true);
    expect(live()[0]!.rect).toEqual({ x: 1920 - 324 - 54, y: 1080 - 216 - 54, width: 324, height: 216 });
    expect(service.layout.setRect("elden", { kind: "overlay", subject: { ...subject, key: "gone" } }, { h: "left", v: "top", x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(false);
    // Not in that setup: All games has nothing.
    expect(service.layout.setRect("$all", ref, { h: "left", v: "top", x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(false);
  });

  it("gives the size a new overlay or panel starts with, as when it was made, for Reset size", async () => {
    const { service, world } = await setup();
    const sizedModule = { ...CLOCK, manifest: { ...CLOCK.manifest, overlaySize: { width: 440, height: 100 } } };
    show(service, sizedModule);
    world.modules.set(CLOCK.manifest.id, sizedModule);
    service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, workspaceId: "elden", instanceId: PANEL }, { width: 360, height: 200 });
    world.preferred.set(PANEL, { width: 360, height: 200 });
    const [sized, panel] = service.layout.items("elden");
    const window = { width: 1920, height: 1080 };
    expect(service.layout.startSize(sized!.ref, window)).toEqual({ width: 440 / 1080, height: 100 / 1080 });
    // Without a size of its own an overlay gets the usual one, a panel the usual panel size.
    world.modules.set(CLOCK.manifest.id, CLOCK);
    expect(service.layout.startSize(sized!.ref, window)).toEqual({ width: 0.356, height: 0.16 });
    world.modules.set(CLOCK.manifest.id, sizedModule);
    expect(service.layout.startSize(panel!.ref, window)).toEqual({ width: 360 / 1080, height: 200 / 1080 });
    world.preferred.clear();
    expect(service.layout.startSize(panel!.ref, window)).toEqual({ width: 0.39, height: 0.4 });
    // A window of another height: the same pixels are a different share of it.
    expect(service.layout.startSize(sized!.ref, { width: 2560, height: 1440 })).toEqual({ width: 440 / 1440, height: 100 / 1440 });
  });

  it("knows the window of each game as last seen in front, to take its picture on a click, while the game runs", async () => {
    const { service, world } = await setup();
    expect(service.layout.handleOf("elden")).toBeNull();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0, handle: "123456" };
    service.tick();
    // Seen in front, but the watcher doesn't say the game runs (yet): no picture.
    expect(service.layout.handleOf("elden")).toBeNull();
    expect(service.layout.gameRunning("elden")).toBe(false);
    service.gamesRunning(new Set(["elden"]));
    expect(service.layout.gameRunning("elden")).toBe(true);
    expect(service.layout.handleOf("elden")).toBe("123456");
    service.forgetWorkspace("elden");
    expect(service.layout.handleOf("elden")).toBeNull();
  });

  it("still has the window of a running game when another window (Tavora's own layout) is in front", async () => {
    const { service, world } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0, handle: "123456" };
    service.gamesRunning(new Set(["elden"]));
    service.tick();
    world.foreground = { program: "C:\Tavora\Tavora.exe", bounds: { x: 100, y: 100, width: 1200, height: 800 }, notification: 0, handle: "999", own: true };
    service.tick();
    service.tick();
    expect(service.layout.handleOf("elden")).toBe("123456");
  });

  it("asks the layout to look again when a game's window is first seen, and when games start or stop", async () => {
    const { service, world } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0, handle: "123456" };
    const before = world.windowsChanged;
    service.tick();
    expect(world.windowsChanged).toBe(before + 1);
    // Looking at the same window again changes nothing.
    service.tick();
    expect(world.windowsChanged).toBe(before + 1);
    service.gamesRunning(new Set(["elden"]));
    expect(world.windowsChanged).toBe(before + 2);
    service.gamesRunning(new Set());
    expect(world.windowsChanged).toBe(before + 3);
  });

  it("forgets a game's window when the watcher reports the game stopped", async () => {
    const { service, world } = await setup();
    show(service);
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0, handle: "123456" };
    service.tick();
    service.gamesRunning(new Set(["elden"]));
    expect(service.layout.handleOf("elden")).toBe("123456");
    service.gamesRunning(new Set());
    expect(service.layout.handleOf("elden")).toBeNull();
  });

  it("tells the layout when a toggle key switched an overlay on or off", async () => {
    const { service, world, key } = await setup();
    show(service);
    service.update(subject, { mode: "toggle" });
    expect(service.layout.items("elden")[0]).toMatchObject({ mode: "toggle", toggledOn: false });
    const before = world.changes;
    service.pressed(key(toggleBinding(subject)));
    expect(service.layout.items("elden")[0]!.toggledOn).toBe(true);
    expect(world.changes).toBeGreaterThan(before);
  });
});

describe("setups on screen", () => {
  const NOTEPAD = "C:\\Windows\\notepad.exe";
  const TAVORA = "C:\\Program Files\\Tavora\\Tavora.exe";
  const anchored = (x = 0.05, y = 0.05) => ({ h: "left", v: "top", x, y, width: 0.2, height: 0.1 });
  const item = (key: string, workspaceId = "personal", extra: object = {}) => ({ owner: "official", moduleId: CLOCK.manifest.id, workspaceId, key, mode: "always", opacity: 100, hideFromCapture: false, anchor: anchored(), ...extra });
  const panelItem = (instanceId = PANEL, workspaceId = "personal", extra: object = {}) => ({ owner: "official", moduleId: TODOS.manifest.id, workspaceId, instanceId, mode: "always", opacity: 100, hideFromCapture: false, anchor: anchored(), ...extra });
  const file = (setups: { id: string; overlays?: unknown[]; panels?: unknown[] }[]) => ({ version: 5, setups: setups.map((setup) => ({ overlays: [], panels: [], ...setup })) });
  const byKey = (windows: FakeWindow[], key: string) => windows.find((window) => window.request.id.endsWith(`\n${key}`));
  const panelWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.instanceId !== undefined && !window.destroyed);

  it("shows Everywhere over any app and the desktop, on the main screen, and hides it while Tavora's own window is in front", async () => {
    const { service, world, live } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }]) });
    world.foreground = { program: NOTEPAD, bounds: { x: 300, y: 200, width: 800, height: 600 }, notification: 0 };
    service.tick();
    expect(live()).toHaveLength(1);
    // On the screen, not on the app's window.
    expect(live()[0]).toMatchObject({ shown: true, rect: { x: 54, y: 54, width: 216, height: 108 } });
    world.foreground = null;
    service.tick();
    expect(live()[0]!.shown).toBe(true);
    world.foreground = { program: GAME_EXE, bounds: { x: 0, y: 0, width: 1280, height: 720 }, notification: 0 };
    service.tick();
    expect(live()[0]).toMatchObject({ shown: true, rect: { x: 54, y: 54 } });
    world.tavora = true;
    service.tick();
    expect(live()[0]!.shown).toBe(false);
    world.tavora = false;
    service.tick();
    expect(live()[0]!.shown).toBe(true);
    // Nothing of it needs the game watcher.
    expect(service.needsWatcher()).toBe(false);
  });

  it("shows Everywhere next to the game's own setup or else All games, never All games next to a game's own", async () => {
    const { service, world, live } = await setup({
      file: file([
        { id: "$everywhere", overlays: [item("everywhere")] },
        { id: "$all", overlays: [item("general")] },
        { id: "elden", overlays: [item("own", "elden")] },
      ]),
    });
    const shown = () => ["everywhere", "general", "own"].filter((key) => byKey(live(), key)?.shown);
    service.tick();
    expect(shown()).toEqual(["everywhere", "own"]);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(shown()).toEqual(["everywhere", "general"]);
    world.foreground = { program: NOTEPAD, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(shown()).toEqual(["everywhere"]);
    expect(service.needsWatcher()).toBe(true);
  });

  it("shows an item in Everywhere and in the game's setup once, as the game's setup has it", async () => {
    const { service, world, live, key } = await setup({
      file: file([
        { id: "$everywhere", overlays: [item("clock")], panels: [panelItem()] },
        { id: "elden", overlays: [item("clock", "personal", { anchor: anchored(0.5, 0.5), opacity: 50 })], panels: [panelItem(PANEL, "personal", { anchor: anchored(0.5, 0.5) })] },
      ]),
    });
    service.tick();
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ opacity: 50, rect: { x: 540, y: 540 } });
    world.foreground = { program: NOTEPAD, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ opacity: 100, rect: { x: 54, y: 54 } });
    // The panel too: one window in the layer, where the game's setup has it.
    world.foreground = { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(1);
    expect(panelWindows(world)[0]!.rect).toMatchObject({ x: 540, y: 540 });
  });

  it("opens the layer over the screen with only Everywhere, Esc closes it, and the keys rest while Tavora's window is in front", async () => {
    const { service, world, live, key } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")], panels: [panelItem()] }]) });
    world.foreground = { program: NOTEPAD, handle: "0x1", bounds: { x: 300, y: 200, width: 800, height: 600 }, notification: 0 };
    service.tick();
    const layer = layerKey(key);
    expect(service.wants(layer)).toBe(true);
    service.pressed(layer);
    expect(service.layerOpen).toBe(true);
    expect(world.veils[0]).toMatchObject({ rect: SCREEN, destroyed: false });
    expect(live().find((window) => window.request.instanceId === undefined)).toMatchObject({ shown: true, arranging: true });
    expect(panelWindows(world)).toHaveLength(1);
    expect(panelWindows(world)[0]).toMatchObject({ shown: true, arranging: true, rect: { x: 54, y: 54 } });
    // A panel that took the keyboard keeps the layer open.
    panelWindows(world)[0]!.focused = true;
    world.foreground = { program: TAVORA, bounds: { ...SCREEN }, notification: 0, own: true, handle: "0x1" };
    world.tavora = true;
    service.tick();
    expect(service.layerOpen).toBe(true);
    world.registered.get("Escape")!();
    expect(service.layerOpen).toBe(false);
    expect(world.veils[0]!.destroyed).toBe(true);
    expect(panelWindows(world)).toHaveLength(0);
    // Tavora's own window in front: nothing shows, so the keys rest.
    world.foreground = { program: TAVORA, bounds: { ...SCREEN }, notification: 0, own: true };
    service.tick();
    expect(service.wants(layer)).toBe(false);
    service.pressed(layer);
    expect(service.layerOpen).toBe(false);
  });

  it("opens the layer over the screen with Everywhere only while a game's items stay over its spot", async () => {
    const { service, world, key } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }, { id: "elden", panels: [panelItem(PANEL, "elden")] }]) });
    world.stay = true;
    service.tick();
    world.foreground = { program: NOTEPAD, handle: "0x1", bounds: { x: 300, y: 200, width: 800, height: 600 }, notification: 0 };
    service.tick();
    const layer = layerKey(key);
    expect(service.wants(layer)).toBe(true);
    service.pressed(layer);
    expect(service.layerOpen).toBe(true);
    expect(world.veils[0]).toMatchObject({ rect: SCREEN });
    // Elden Ring's panel isn't brought over the notepad.
    expect(panelWindows(world)).toHaveLength(0);
    world.registered.get("Escape")!();
    expect(service.layerOpen).toBe(false);
  });

  it("closes the layer over the screen when another window, a game or Tavora's own comes in front", async () => {
    const { service, world, key } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }, { id: "$all", overlays: [item("general")] }]) });
    const layer = layerKey(key);
    const open = () => {
      world.foreground = { program: NOTEPAD, handle: "0x1", bounds: { ...SCREEN }, notification: 0 };
      world.tavora = false;
      service.tick();
      service.pressed(layer);
      expect(service.layerOpen).toBe(true);
    };
    open();
    world.foreground = { program: "C:\\Browser\\browser.exe", handle: "0x2", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.layerOpen).toBe(false);
    open();
    world.foreground = { program: GAME_EXE, handle: "0x3", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.layerOpen).toBe(false);
    open();
    world.foreground = { program: TAVORA, handle: "0x1", bounds: { ...SCREEN }, notification: 0, own: true };
    world.tavora = true;
    service.tick();
    expect(service.layerOpen).toBe(false);
    expect(world.focused).toBe(0);
  });

  it("tells the hotkeys when something starts or stops showing", async () => {
    const { service, world } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }]) });
    world.foreground = { program: NOTEPAD, bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.showing()).toBe(true);
    const before = world.changes;
    world.tavora = true;
    service.tick();
    expect(service.showing()).toBe(false);
    expect(world.changes).toBeGreaterThan(before);
    const after = world.changes;
    service.tick();
    expect(world.changes).toBe(after);
  });

  it("lands a game workspace's overlay in its game's setup and a personal one in All games, never in Everywhere", async () => {
    const { service } = await setup();
    show(service, CLOCK, "personal", "general");
    show(service, CLOCK, "elden", "own");
    expect(service.layout.setups()).toEqual(["$everywhere", "$all", "elden"]);
    expect(service.layout.items("$all").map((info) => info.name)).toEqual(["Clock & Counter"]);
    expect(service.layout.items("elden").map((info) => info.ref)).toEqual([
      { kind: "overlay", subject: { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "general" } },
      { kind: "overlay", subject: { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "elden", key: "own" } },
    ]);
    expect(service.layout.items("$everywhere")).toEqual([]);
    // Shown again: it stays where it is, wherever that is.
    expect(show(service, CLOCK, "personal", "general")).toBe("shown");
    expect(service.layout.items("$all")).toHaveLength(1);
  });

  it("takes an item out of one setup from the layout or its frame, and out of every setup when its panel closes or its module hides it", async () => {
    const { service, world, key } = await setup({
      file: file([
        { id: "$everywhere", overlays: [item("clock")], panels: [panelItem()] },
        { id: "$all", overlays: [item("clock")], panels: [panelItem()] },
      ]),
    });
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    service.pressed(layerKey(key));
    // The frame of the panel shown from All games.
    panelWindows(world)[0]!.request.closeRequested();
    expect(service.layout.items("$all").map((info) => info.ref.kind)).toEqual(["overlay"]);
    expect(service.hasPanel(PANEL)).toBe(true);
    service.layout.remove("$everywhere", { kind: "overlay", subject: { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "clock" } });
    expect(service.layout.items("$all")).toHaveLength(1);
    expect(service.layout.items("$everywhere").map((info) => info.ref.kind)).toEqual(["panel"]);
    service.stopPanel(PANEL);
    expect(service.hasPanel(PANEL)).toBe(false);
    service.hide(CLOCK, "personal", "clock");
    expect(service.layout.items("$all")).toEqual([]);
  });

  it("keeps an item's key while another setup still has it, and takes it when the last one lets go", async () => {
    const { service, world, key } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }, { id: "$all", overlays: [item("clock")] }]) });
    const subject = { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "clock" };
    const record = key(toggleBinding(subject));
    expect(service.general(record)).toBe(true);
    service.layout.remove("$all", { kind: "overlay", subject });
    expect(world.removedKeys).toEqual([]);
    service.layout.remove("$everywhere", { kind: "overlay", subject });
    expect(world.removedKeys).toEqual([record]);
  });

  it("takes the key of an item whose last setup goes with its game workspace", async () => {
    const { service, world, key } = await setup({ file: file([{ id: "$all", overlays: [item("clock")] }, { id: "elden", overlays: [item("clock")] }]) });
    const subject = { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "clock" };
    const record = key(toggleBinding(subject));
    service.layout.remove("$all", { kind: "overlay", subject });
    expect(world.removedKeys).toEqual([]);
    service.forgetWorkspace("elden");
    expect(world.removedKeys).toEqual([record]);
    expect(service.has(subject)).toBe(false);
  });

  it("changes an item in the setup the layout shows only", async () => {
    const { service, live } = await setup({ file: file([{ id: "$everywhere", overlays: [item("clock")] }, { id: "elden", overlays: [item("clock")] }]) });
    service.tick();
    const subject = { owner: "official", moduleId: CLOCK.manifest.id, workspaceId: "personal", key: "clock" };
    service.layout.setOverlay("$everywhere", subject, { opacity: 25 });
    expect(live()[0]!.opacity).toBe(100);
    service.layout.setOverlay("elden", subject, { opacity: 50 });
    expect(live()[0]!.opacity).toBe(50);
    expect(service.layout.items("$everywhere")[0]!.opacity).toBe(25);
  });
});
