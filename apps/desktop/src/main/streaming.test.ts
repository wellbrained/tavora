import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HotkeyBinding } from "@tavora/sdk/protocol";
import type { ShortcutRegistry } from "./hotkeys";
import { Streaming, type HotkeyListener, type StreamingModule } from "./streaming";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-streaming-"));
});

afterEach(async () => {
  // Saves run in the background; let the last one land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const MODULE: StreamingModule = {
  owner: "official",
  root: "/nowhere",
  manifest: {
    id: "tavora.clock-counter",
    name: "Clock & Counter",
    overlay: "dist/overlay.html",
    actions: [{ id: "start-pause", name: "Start/Pause" }, { id: "reset", name: "Reset" }],
    permissions: { network: [], connectors: ["stream-overlay"], onRequest: ["stream-overlay"] },
  },
};

async function setup({ held = [] as string[] } = {}) {
  const registered = new Map<string, () => void>();
  const shortcuts: ShortcutRegistry = {
    register: (accelerator, callback) => {
      if (held.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => void registered.delete(accelerator),
  };
  const heard: HotkeyBinding[] = [];
  const panel: HotkeyListener = { moduleId: MODULE.manifest.id, usedAt: 1, hotkeyPressed: (binding) => heard.push(binding) };
  const world = { gameId: "poe2" as string | null, panels: [panel], clipboard: "", opened: [] as string[], settings: { streamOverlays: false, overlayPort: 47820 }, granted: true, asked: 0, answer: true };
  const streaming = await Streaming.create({
    userData: dir,
    settings: () => world.settings,
    saveSettings: (next) => Object.assign(world.settings, next),
    module: (id) => (id === MODULE.manifest.id ? MODULE : undefined),
    overlayGranted: () => world.granted,
    askConnector: async () => {
      world.asked++;
      world.granted = world.answer;
      return world.answer;
    },
    gameId: () => world.gameId,
    gameName: (id) => (id === "poe2" ? "Path of Exile 2" : null),
    panels: () => world.panels,
    shortcuts,
    writeClipboard: (text) => (world.clipboard = text),
    openSetting: (setting) => world.opened.push(setting),
    focus: () => {},
    language: () => "en",
    changed: () => {},
  });
  return { streaming, registered, heard, world, hotkeys: streaming.hotkeysFor(MODULE, "poe2"), overlay: streaming.overlayFor(MODULE, "poe2") };
}

describe("the hotkey dialog", () => {
  it("sets a key, which then reaches the module's panels in that game", async () => {
    const { streaming, registered, heard, hotkeys } = await setup();
    const asked = hotkeys.set("start-pause", "item-1", "Boss timer");
    const request = streaming.request()!;
    expect(request).toMatchObject({ moduleName: "Clock & Counter", actionName: "Start/Pause", label: "Boss timer", current: null, error: null });
    streaming.answer(request.id, "set", "Ctrl+Alt+1");
    expect(await asked).toBe("set");
    expect(streaming.request()).toBeNull();
    expect(hotkeys.list()).toEqual([{ action: "start-pause", target: "item-1" }]);
    streaming.sync();
    registered.get("Ctrl+Alt+1")!();
    expect(heard).toEqual([{ action: "start-pause", target: "item-1" }]);
  });

  it("sends a press to one panel only, the one used last", async () => {
    const { streaming, registered, heard, world, hotkeys } = await setup();
    const other: HotkeyBinding[] = [];
    world.panels.push({ moduleId: MODULE.manifest.id, usedAt: 5, hotkeyPressed: (binding) => other.push(binding) });
    const asked = hotkeys.set("reset", "item-1", "Deaths");
    streaming.answer(streaming.request()!.id, "set", "F7");
    await asked;
    streaming.sync();
    registered.get("F7")!();
    expect(other).toEqual([{ action: "reset", target: "item-1" }]);
    expect(heard).toEqual([]);
  });

  it("refuses a key used in the same game and keeps the dialog open", async () => {
    const { streaming, hotkeys } = await setup();
    const first = hotkeys.set("start-pause", "item-1", "Boss timer");
    streaming.answer(streaming.request()!.id, "set", "F9");
    await first;
    void hotkeys.set("reset", "item-2", "Deaths");
    const { id } = streaming.request()!;
    streaming.answer(id, "set", "F9");
    expect(streaming.request()).toMatchObject({ id, error: "Already used for Boss timer (Start/Pause) in this game." });
  });

  it("refuses a key another program holds", async () => {
    const { streaming, hotkeys } = await setup({ held: ["F8"] });
    void hotkeys.set("start-pause", "item-1", "Boss timer");
    streaming.answer(streaming.request()!.id, "set", "F8");
    expect(streaming.request()?.error).toBe("Another app uses this key. Pick another one.");
  });

  it("frees every key while it is open, so a key set already can be pressed again", async () => {
    const { streaming, registered, hotkeys } = await setup();
    const first = hotkeys.set("start-pause", "item-1", "Boss timer");
    streaming.answer(streaming.request()!.id, "set", "F9");
    await first;
    streaming.sync();
    expect(registered.has("F9")).toBe(true);
    const again = hotkeys.set("start-pause", "item-1", "Boss timer");
    expect(registered.size).toBe(0);
    expect(streaming.request()?.current).toBe("F9");
    streaming.answer(streaming.request()!.id, "remove");
    expect(await again).toBe("removed");
    expect(hotkeys.list()).toEqual([]);
  });

  it("closes when the player leaves the game", async () => {
    const { streaming, world, hotkeys } = await setup();
    const asked = hotkeys.set("start-pause", "item-1", "Boss timer");
    world.gameId = "elden-ring";
    streaming.sync();
    expect(await asked).toBe("cancelled");
  });

  it("only opens for the game shown now", async () => {
    const { streaming, world } = await setup();
    world.gameId = "elden-ring";
    expect(() => streaming.hotkeysFor(MODULE, "poe2").set("reset", "item-1", "X")).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });
});

describe("which hotkeys work", () => {
  it("only the game shown now's, while the module has a panel there", async () => {
    const { streaming, registered, world, hotkeys } = await setup();
    const asked = hotkeys.set("start-pause", "item-1", "Boss timer");
    streaming.answer(streaming.request()!.id, "set", "F9");
    await asked;
    streaming.sync();
    expect(registered.has("F9")).toBe(true);
    world.panels = [];
    streaming.sync();
    expect(registered.has("F9")).toBe(false);
    world.panels = [{ moduleId: MODULE.manifest.id, usedAt: 2, hotkeyPressed: () => {} }];
    world.gameId = "elden-ring";
    streaming.sync();
    expect(registered.has("F9")).toBe(false);
  });

  it("go with their game", async () => {
    const { streaming, hotkeys } = await setup();
    const asked = hotkeys.set("start-pause", "item-1", "Boss timer");
    streaming.answer(streaming.request()!.id, "set", "F9");
    await asked;
    streaming.forgetGame("poe2");
    expect(hotkeys.list()).toEqual([]);
  });
});

describe("overlay links", () => {
  it("ask for stream overlays on the first copy when the module asks for them on request", async () => {
    const { overlay, world } = await setup();
    world.granted = false;
    world.answer = false;
    expect(await overlay.copyLink("item-1")).toBe("denied");
    expect(world.asked).toBe(1);
    world.answer = true;
    expect(await overlay.copyLink("item-1")).toBe("off");
    expect(await overlay.copyLink("item-1")).toBe("off");
    expect(world.asked).toBe(2);
  });

  it("refuse a module that asks for them up front and wasn't granted them", async () => {
    const { streaming, world } = await setup();
    world.granted = false;
    const upFront = { ...MODULE, manifest: { ...MODULE.manifest, permissions: { network: [], connectors: ["stream-overlay" as const] } } };
    await expect(streaming.overlayFor(upFront, "poe2").copyLink("item-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(world.asked).toBe(0);
  });

  it("open the setting while Stream overlays are off, and copy the link once they are on", async () => {
    const { streaming, overlay, world } = await setup();
    expect(await overlay.copyLink("item-1")).toBe("off");
    expect(world.opened).toEqual(["stream-overlays"]);
    let port = 48100 + Math.floor(Math.random() * 500);
    for (world.settings.overlayPort = port; (await streaming.setOverlays(true), streaming.view().overlays.status) !== "running"; ) await streaming.setPort(++port);
    try {
      expect(await overlay.copyLink("item-1")).toBe("copied");
      expect(world.clipboard).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/overlay/[0-9a-f]{32}/$`));
    } finally {
      await streaming.shutdown();
    }
  });
});

describe("keys of game overlays", () => {
  const toggle = { owner: "official", moduleId: MODULE.manifest.id, gameId: "elden", action: "$overlay", target: "item-1" };
  const arrange = { owner: "tavora", moduleId: "tavora", gameId: "elden", action: "$arrange", target: "arrange" };
  const words = { module: "Elden Ring", action: "Show or hide" };

  async function withKeys() {
    const made = await setup();
    const heard: string[] = [];
    let front: string | null = null;
    made.streaming.useOverlayKeys({ frontGame: () => front, wants: () => true, pressed: (record) => void heard.push(`${record.action}:${record.target}`) });
    return { ...made, heard, front: (id: string | null) => (front = id) };
  }

  it("opens the dialog for a game that isn't the one shown, with the words of overlays", async () => {
    const { streaming } = await withKeys();
    const asked = streaming.askOverlayKey(toggle, "Clock & Counter", words);
    expect(streaming.request()).toMatchObject({ moduleName: "Elden Ring", actionName: "Show or hide", label: "Clock & Counter", current: null });
    streaming.answer(streaming.request()!.id, "set", "F8");
    expect(await asked).toBe("set");
    expect(streaming.keyOf(toggle)).toEqual({ accelerator: "F8", taken: false });
  });

  it("stays open when the game shown changes, unlike a module's own dialog", async () => {
    const { streaming, world } = await withKeys();
    void streaming.askOverlayKey(arrange, "Overlays", words);
    world.gameId = "elsewhere";
    world.panels.length = 0;
    streaming.sync();
    expect(streaming.request()).not.toBeNull();
  });

  it("registers a key only while its game is in front, and a press goes to game overlays", async () => {
    const { streaming, registered, heard, front } = await withKeys();
    const asked = streaming.askOverlayKey(toggle, "Clock & Counter", words);
    streaming.answer(streaming.request()!.id, "set", "F8");
    await asked;
    streaming.sync();
    expect(registered.has("F8")).toBe(false);
    front("elden");
    streaming.sync();
    registered.get("F8")!();
    expect(heard).toEqual(["$overlay:item-1"]);
    front("other");
    streaming.sync();
    expect(registered.has("F8")).toBe(false);
  });

  it("shares the game's keys with module hotkeys, so one key can't do both", async () => {
    const { streaming, world } = await withKeys();
    world.gameId = "elden";
    const asked = streaming.askOverlayKey(arrange, "Overlays", { module: "Elden Ring", action: "Arrange overlays" });
    streaming.answer(streaming.request()!.id, "set", "F9");
    await asked;
    const other = streaming.askOverlayKey(toggle, "Clock & Counter", words);
    streaming.answer(streaming.request()!.id, "set", "F9");
    expect(streaming.request()!.error).toContain("Arrange overlays");
    streaming.answer(streaming.request()!.id, "cancel");
    expect(await other).toBe("cancelled");
  });

  it("leaves them out of the hotkeys Settings > Streaming lists, and takes them away on request", async () => {
    const { streaming } = await withKeys();
    const asked = streaming.askOverlayKey(toggle, "Clock & Counter", words);
    streaming.answer(streaming.request()!.id, "set", "F8");
    await asked;
    expect(streaming.view().hotkeys).toEqual([]);
    streaming.removeKeys((record) => record.action === "$overlay");
    expect(streaming.keyOf(toggle)).toBeNull();
  });

  it("go with their game", async () => {
    const { streaming } = await withKeys();
    const asked = streaming.askOverlayKey(arrange, "Overlays", words);
    streaming.answer(streaming.request()!.id, "set", "F8");
    await asked;
    streaming.forgetGame("elden");
    expect(streaming.keyOf(arrange)).toBeNull();
  });
});

describe("publishing without the connector", () => {
  it("keeps what a module publishes for a game overlay, whether or not the connector was granted", async () => {
    const { streaming, world, overlay } = await setup();
    world.granted = false;
    overlay.publish("item-1", { value: 4 });
    expect(streaming.overlayStore.peek({ owner: "official", moduleId: MODULE.manifest.id, gameId: "poe2", key: "item-1" })?.state).toEqual({ value: 4 });
    overlay.remove("item-1");
    expect(streaming.overlayStore.peek({ owner: "official", moduleId: MODULE.manifest.id, gameId: "poe2", key: "item-1" })?.state).toBeNull();
  });
});
