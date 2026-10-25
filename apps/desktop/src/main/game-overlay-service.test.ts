import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import type { Foreground, ForegroundProbe } from "./foreground";
import { GameOverlays, isOverlayAction, layerBinding, toggleBinding, type OverlayWindow, type OverlayWindowRequest } from "./game-overlay-service";
import type { VeilWindow } from "./game-veil-window";
import { ALL_GAMES, GameOverlayStore, OVERLAY_LAYER_ACTION, OVERLAY_TOGGLE_ACTION, type OverlayScope, type Rect } from "./game-overlays";
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import { OverlayStore } from "./overlays";
import type { StreamingModule } from "./streaming";

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
  if (file !== undefined) await writeFile(path.join(dir, "game-overlays.json"), JSON.stringify(file));
  const world = {
    enabled,
    modules: new Map<string, StreamingModule>([[CLOCK.manifest.id, CLOCK], [TODOS.manifest.id, TODOS]]),
    foreground: { program: GAME_EXE, bounds: { ...SCREEN }, notification: 0 } as Foreground | null,
    opened: [] as string[],
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
  };
  const probe: ForegroundProbe = {
    look: () => {
      world.probeCalls++;
      if (world.broken) throw new Error("no koffi");
      return world.foreground;
    },
    focus: () => void world.focused++,
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
    gameName: (id) => (id === "elden" ? "Elden Ring" : id === "personal" ? "Personal" : null),
    scopeOf: (id) => world.kinds.get(id) ?? "game",
    gamesOf: (program) => new Set(program === GAME_EXE ? ["elden"] : program.startsWith("D:\\Games\\Other\\") ? ["other"] : []),
    panels: {
      name: (instanceId) => world.panelNames.get(instanceId) ?? null,
      exists: (_gameId, instanceId) => !world.gone.has(instanceId),
      allowed: (_gameId, instanceId) => !world.notAllowed.has(instanceId),
      usedAt: (instanceId) => world.panelUsed.get(instanceId) ?? 0,
      openWindow: (request) => {
        if (!world.panelNames.has(request.instanceId)) return null;
        const window = new FakeWindow(request);
        world.windows.push(window);
        return window;
      },
    },
    probe: () => probe,
    toDip: (rect) => rect,
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

const show = (service: GameOverlays, module = CLOCK, gameId = "elden", key = "item-1") => service.show(module, gameId, key);

describe("showOverGame", () => {
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
    expect(service.view().groups).toEqual([]);
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
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { mode: "toggle" });
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }));
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
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }));
    expect(service.wants(record)).toBe(false);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { mode: "toggle" });
    world.enabled = false;
    expect(service.wants(record)).toBe(false);
    expect(service.wants(key(layerBinding()))).toBe(false);
  });

  it("applies opacity and Hide from capture to the window", async () => {
    const { service, live } = await setup();
    show(service);
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { opacity: 50, hideFromCapture: true });
    expect(live()[0]).toMatchObject({ opacity: 50, hideFromCapture: true });
  });

  it("removes an overlay with its window and its key", async () => {
    const { service, live, key, world } = await setup();
    show(service);
    const record = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }));
    service.remove({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" });
    expect(live()).toHaveLength(0);
    expect(world.removedKeys).toEqual([record]);
    expect(service.view().groups).toEqual([]);
  });

  it("lists overlays by game for Settings", async () => {
    const { service } = await setup();
    show(service);
    show(service, CLOCK, "elden", "item-2");
    expect(service.view()).toMatchObject({
      supported: true,
      enabled: true,
      hidden: false,
      panels: [],
      groups: [{ id: "elden", name: "Elden Ring", overlays: [{ name: "Clock & Counter · item-1", mode: "always" }, { name: "Clock & Counter · item-2" }] }],
    });
  });
});

const layerKey = (key: (binding: ReturnType<typeof layerBinding>) => HotkeyRecord) => key(layerBinding());

describe("the in-game layer", () => {
  it("makes every overlay of the game visible with its frame, behind a veil, and back again with the key or Esc", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    show(service, CLOCK, "elden", "item-2");
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-2" }, { mode: "toggle" });
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

  it("saves where the player left an overlay, relative to the game, and leaves a window being dragged alone", async () => {
    const { service, live, world } = await setup();
    show(service);
    const window = live()[0]!;
    window.request.moved({ x: 960, y: 540, width: 480, height: 270 });
    expect(service.view().groups[0]!.overlays).toHaveLength(1);
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
    expect(service.view().groups).toEqual([]);
  });
});

describe("general overlays", () => {
  it("made in a workspace that is no game show over every library game in front", async () => {
    const { service, world, live } = await setup();
    show(service, CLOCK, "personal");
    expect(service.view().groups).toMatchObject([{ id: ALL_GAMES, name: null, overlays: [{ gameId: "personal" }] }]);
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
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "personal", key: "item-1" }, { mode: "toggle" });
    const toggle = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "personal", key: "item-1" }));
    expect(service.wants(toggle)).toBe(true);
    expect(service.wants(layerKey(key))).toBe(true);
    world.foreground = { program: "D:\\Games\\Other\\other.exe", bounds: { ...SCREEN }, notification: 0 };
    service.tick();
    expect(service.wants(toggle)).toBe(true);
    service.pressed(toggle);
    service.pressed(layerKey(key));
    expect(service.layerOpen).toBe(true);
  });

  it("count toward eight general ones, apart from a game's own eight", async () => {
    const { service } = await setup();
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(show(service, CLOCK, "personal", `item-${i}`)).toBe("shown");
    expect(show(service, CLOCK, "personal", "one-more")).toBe("full");
    expect(show(service, CLOCK, "elden", "item-0")).toBe("shown");
  });
});

describe("hiding everything", () => {
  it("closes every overlay, the veil and the panels at once when Game overlays are switched off", async () => {
    const { service, world, live, key } = await setup();
    service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, gameId: "elden", instanceId: PANEL });
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
    service.forgetGame("other");
    expect(service.view().groups.map((game) => game.id)).toEqual(["elden"]);
    service.forgetModule(CLOCK.manifest.id, "official");
    expect(service.view().groups).toEqual([]);
    expect(live()).toHaveLength(0);
  });

  it("leaves another publisher's module with the same id alone when asked about one owner", async () => {
    const { service } = await setup();
    show(service);
    service.forgetModule(CLOCK.manifest.id, "someone-else");
    expect(service.view().groups).toHaveLength(1);
  });

  it("forgets the overlays of a module another publisher's module replaced, and never serves its page", async () => {
    const { service, world, live } = await setup();
    show(service);
    const request = live()[0]!.request;
    expect(request.page()).toEqual({ root: "/nowhere", entry: "dist/overlay.html" });
    world.modules.set(CLOCK.manifest.id, { ...CLOCK, owner: "someone-else" });
    expect(request.page()).toBeNull();
    service.tick();
    expect(service.view().groups).toEqual([]);
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
    overlays.publish({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { value: 7 });
    expect(state()).toEqual({ value: 7 });
    expect(heard).toEqual([{ value: 7 }]);
    stop!();
    overlays.publish({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { value: 8 });
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
    // Told once, in the player's words.
    expect(world.notices).toEqual(["This overlay stopped working."]);
  });

  it("gets another chance when the player shows it again, or toggles it", async () => {
    const { service, world, live, key } = await setup();
    show(service);
    for (let i = 0; i < 3; i++) {
      crash(live);
      service.tick();
    }
    expect(live()).toHaveLength(0);
    expect(show(service)).toBe("shown");
    expect(live()).toHaveLength(1);

    const subject = { owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" };
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
    const subject = (key: string) => ({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key });
    for (let i = 0; i < LIMITS.maxOverlays; i++) overlays.link(subject("k" + i));
    expect(() => show(service)).toThrowError(expect.objectContaining({ code: "QUOTA_EXCEEDED" }));
    expect(service.has(subject("item-1"))).toBe(false);
    expect(service.view().groups).toEqual([]);
    expect(world.windows).toHaveLength(0);
  });

  it("takes away the per-game arrange keys and the keys of panels over the game of Tavora 0.21.0 and before, when it starts", async () => {
    const { service, world, key } = await setup({ file: { version: 1, overlays: [] } });
    const arrange = key({ owner: "tavora", moduleId: "tavora", gameId: "elden", action: "$arrange", target: "arrange" });
    const panelToggle = key({ owner: "official", moduleId: TODOS.manifest.id, gameId: "elden", action: OVERLAY_TOGGLE_ACTION, target: `panel-${PANEL}` });
    const keep = key(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }));
    service.start();
    expect(world.removedKeys).toEqual([arrange, panelToggle]);
    expect(world.removedKeys).not.toContain(keep);
    await service.shutdown();
  });

  it("hands the arrange key set last to the layer key when migrating, and does nothing for a file of version 2", async () => {
    const old = await setup({ file: { version: 1, overlays: [] } });
    old.key({ owner: "tavora", moduleId: "tavora", gameId: "elden", action: "$arrange", target: "arrange" });
    const newest = old.key({ owner: "tavora", moduleId: "tavora", gameId: "other", action: "$arrange", target: "arrange" });
    old.service.start();
    expect(old.world.movedKeys).toEqual([{ from: newest, to: layerBinding() }]);
    await old.service.shutdown();

    const current = await setup({ file: { version: 2, overlays: [], panels: [] } });
    current.key({ owner: "tavora", moduleId: "tavora", gameId: "elden", action: "$arrange", target: "arrange" });
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
    service.update({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }, { mode: "toggle" });
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
    expect(service.dialogNames(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: "item-1" }))).toEqual({
      label: "Clock & Counter",
      module: "Elden Ring",
      action: "Show or hide",
    });
    expect(service.dialogNames(toggleBinding({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "personal", key: "item-1" })).module).toBe("All games");
  });
});

describe("a panel in the game", () => {
  const add = (service: GameOverlays, instanceId = PANEL, gameId = "elden") => service.showPanel({ owner: "official", moduleId: TODOS.manifest.id, gameId, instanceId });
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
    // Still one the player shows in the game: it comes up again with the next layer.
    expect(service.hasPanel(PANEL)).toBe(true);
    service.pressed(layerKey(key));
    expect(panelWindows(world)).toHaveLength(2);
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

  it("is kept where the player put it, relative to the game, and closing its frame stops showing it in game", async () => {
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
    expect(panelWindows(world)[0]!.request.frameText()).toEqual({ name: "To-Dos", closeLabel: "Stop showing this panel in game" });
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
    expect(service.view().panels).toEqual([
      { instanceId: PANEL, owner: "official", moduleId: TODOS.manifest.id, gameId: "personal", name: "To-Dos", gameName: null, mode: "always", opacity: 100, hideFromCapture: false, hotkey: null, live: false },
    ]);
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
    service.forgetGame("elden");
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
    expect(again.panelOf(PANEL)).toMatchObject({ instanceId: PANEL, gameId: "elden", scope: "game" });
  });
});

describe("a panel's live view", () => {
  // A panel of a module with an overlay page, shown in the game.
  const add = (service: GameOverlays, module = CLOCK, instanceId = PANEL) => service.showPanel({ owner: module.owner, moduleId: module.manifest.id, gameId: "elden", instanceId });
  const liveWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.id.startsWith("live\n") && !window.destroyed);
  const panelWindows = (world: { windows: FakeWindow[] }) => world.windows.filter((window) => window.request.instanceId !== undefined);

  it("shows nothing until the panel passes a state, then the overlay page in the panel's spot with that state", async () => {
    const { service, world } = await setup();
    add(service);
    expect(liveWindows(world)).toHaveLength(0);
    service.setLive(PANEL, { hp: 3 });
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
    service.setLive(PANEL, 1);
    const [window] = liveWindows(world);
    const heard: unknown[] = [];
    const stop = window!.request.watch((state) => heard.push(state));
    service.setLive(PANEL, 2);
    expect(heard).toEqual([2]);
    expect(window!.request.state()).toBe(2);
    stop?.();
    service.setLive(PANEL, 3);
    expect(heard).toEqual([2]);
    service.setLive(PANEL, null);
    expect(window!.shown).toBe(false);
    service.setLive(PANEL, 4);
    expect(window!.shown).toBe(true);
  });

  it("gives way to the full panel while the layer is open, and returns in the new spot", async () => {
    const { service, world, key } = await setup();
    add(service);
    service.setLive(PANEL, "x");
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
    service.setLive(PANEL, "x");
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
    service.setLive(PANEL, "x");
    service.updatePanelView(PANEL, { mode: "toggle" });
    expect(liveWindows(world).every((window) => !window.shown)).toBe(true);
    const subject = service.panelSubject(PANEL)!;
    expect(subject).toEqual({ owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", key: PANEL });
    expect(service.has(subject)).toBe(true);
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

  it("applies opacity and Hide from capture, and lists them in the settings view", async () => {
    const { service, world } = await setup();
    add(service);
    service.setLive(PANEL, "x");
    service.updatePanelView(PANEL, { opacity: 50, hideFromCapture: true });
    expect(liveWindows(world)[0]).toMatchObject({ opacity: 50, hideFromCapture: true });
    expect(service.view().panels).toEqual([
      { instanceId: PANEL, owner: "official", moduleId: CLOCK.manifest.id, gameId: "elden", name: "To-Dos", gameName: "Elden Ring", mode: "always", opacity: 50, hideFromCapture: true, hotkey: null, live: true },
    ]);
  });

  it("is not there for a module without an overlay page", async () => {
    const { service, world } = await setup();
    world.modules.set(NO_OVERLAY.manifest.id, NO_OVERLAY);
    add(service, NO_OVERLAY);
    service.setLive(PANEL, "x");
    expect(liveWindows(world)).toHaveLength(0);
    expect(service.view().panels[0]!.live).toBe(false);
  });

  it("is not there when the game is not in front, or Game overlays are off", async () => {
    const { service, world } = await setup();
    add(service);
    service.setLive(PANEL, "x");
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
    service.setLive(PANEL, "x");
    key(toggleBinding(service.panelSubject(PANEL)!));
    service.stopPanel(PANEL);
    expect(liveWindows(world)).toHaveLength(0);
    expect(world.removedKeys.map((record) => record.target)).toEqual([PANEL]);
    // Shown in the game again later: nothing until the panel passes a state again.
    service.forgetLive(PANEL);
    add(service);
    expect(liveWindows(world)).toHaveLength(0);
    service.setLive(PANEL, "y");
    expect(liveWindows(world)).toHaveLength(1);
    service.forgetLive(PANEL);
    expect(liveWindows(world).every((window) => !window.shown)).toBe(true);
  });
});
