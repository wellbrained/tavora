import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import { DEFAULT_PANEL_ANCHORED, DEFAULT_RECT, normalizeLegacy, placeAnchored, placeLegacy, type AnchoredRect } from "../shared/overlay-anchor";
import {
  DEFAULT_GAME_SIZE,
  startRect,
  GAME_OVERLAYS_FILE,
  GameOverlayStore,
  MIN_OVERLAY_SIZE,
  PANEL_ARRANGE_INSET,
  dragRect,
  gameInFront,
  appliesTo,
  gestureCounts,
  isLive,
  looksExclusive,
  overlayVisible,
  panelBounds,
  placeItem,
  scopeForKind,
  overlayId,
  panelWindowId,
  type GameOverlaySubject,
  type OverlayScope,
  type VisibilityInput,
} from "./game-overlays";
import { moveToWorkspaces } from "./workspace-move";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-game-overlays-"));
});

afterEach(async () => {
  // Saves run in the background; let the last one land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A rectangle anchored to the top left corner, in units of the game window's height. */
const at = (x: number, y: number, width: number, height: number): AnchoredRect => ({ h: "left", v: "top", x, y, width, height });

const subject = (key = "item-1", workspaceId = "poe2"): GameOverlaySubject => ({ owner: "official", moduleId: "tavora.clock-counter", workspaceId, key });
/** An overlay's subject as a file of version 3 or older kept it, before the workspace names. */
const oldSubject = (key = "item-1", gameId = "poe2") => ({ owner: "official", moduleId: "tavora.clock-counter", gameId, key });

/** Loads the file as Tavora does at start: moved to the workspace names first (workspace-move.ts). */
async function loadStore(userData: string, scopeOf?: (workspaceId: string) => OverlayScope): Promise<GameOverlayStore> {
  await moveToWorkspaces(userData);
  return GameOverlayStore.load(userData, scopeOf);
}

describe("GameOverlayStore", () => {
  it("overrides one general item per game, while settings stay shared across a restart", async () => {
    const store = await loadStore(dir);
    const timer = subject("timer", "personal");
    const clock = subject("clock", "personal");
    store.add(timer, "all");
    store.add(clock, "all");
    const own = at(0.3, 0.2, 0.2, 0.1);
    store.setRect(timer, own, "poe2");
    store.setRect(timer, at(0.1, 0.1, 0.3, 0.2));
    store.update(timer, { mode: "toggle", opacity: 50, hideFromCapture: true });
    expect(store.of("poe2").find((item) => item.key === "timer")).toMatchObject({ rect: own, mode: "toggle", opacity: 50, hideFromCapture: true });
    expect(store.of("elden").find((item) => item.key === "timer")!.rect).toEqual(store.find(timer)!.rect);
    expect(store.ownPosition("poe2", overlayId(clock))).toBe(false);
    await store.save();
    const loaded = await loadStore(dir);
    expect(loaded.of("poe2").find((item) => item.key === "timer")!.rect).toEqual(own);
    loaded.follow("poe2", overlayId(timer));
    expect(loaded.of("poe2").find((item) => item.key === "timer")!.rect).toEqual(loaded.find(timer)!.rect);
    await loaded.save();
  });

  it("detaches a whole layout, includes later general items, and can follow All games again", async () => {
    const store = await loadStore(dir);
    const timer = subject("timer", "personal");
    const clock = subject("clock", "personal");
    store.add(timer, "all");
    const before = { ...store.find(timer)!.rect };
    store.customize("poe2");
    store.setRect(timer, at(0.6, 0.1, 0.2, 0.2));
    expect(store.of("poe2")[0]!.rect).toEqual(before);
    store.add(clock, "all");
    const clockBefore = { ...store.find(clock)!.rect };
    store.setRect(clock, at(0.5, 0.1, 0.3, 0.2));
    expect(store.of("poe2").find((item) => item.key === "clock")!.rect).toEqual(clockBefore);
    await store.save();
    const loaded = await loadStore(dir);
    expect(loaded.layoutState("poe2").detached).toBe(true);
    loaded.follow("poe2");
    expect(loaded.of("poe2").map((item) => item.rect)).toEqual(loaded.of("elden").map((item) => item.rect));
    await loaded.save();
  });

  it("overrides panels too, leaves game-owned items local, and prunes removed items and games", async () => {
    const store = await loadStore(dir);
    const instanceId = "11111111-1111-4111-8111-111111111111";
    store.addPanel({ ...subject(), instanceId, scope: "all" });
    store.add(subject("own"), "game");
    const rect = at(0.4, 0.2, 0.3, 0.2);
    store.setRect({ instanceId }, rect, "elden");
    expect(store.panelsOf("elden")[0]!.rect).toEqual(rect);
    expect(store.panelsOf("poe2")[0]!.rect).not.toEqual(rect);
    store.setRect(subject("own"), rect, "poe2");
    expect(store.layoutState("poe2").positions).toEqual({});
    store.forgetPanels(() => true);
    expect(store.ownPosition("elden", panelWindowId(instanceId))).toBe(false);
    store.customize("elden");
    store.forgetSeen("elden");
    expect(store.layoutState("elden")).toEqual({ detached: false, positions: {} });
    await store.save();
  });

  it("ignores invalid saved overrides without losing the shared layout", async () => {
    const store = await loadStore(dir);
    const item = subject("timer", "personal");
    store.add(item, "all");
    await store.save();
    const file = path.join(dir, GAME_OVERLAYS_FILE);
    const body = JSON.parse(await readFile(file, "utf8"));
    body.layout.games = { poe2: { detached: false, positions: { [overlayId(item)]: { x: "bad" }, missing: DEFAULT_RECT } }, elden: null };
    await writeFile(file, JSON.stringify(body));
    const loaded = await loadStore(dir);
    expect(loaded.layoutState("poe2").positions).toEqual({});
    expect(loaded.of("poe2")[0]!.rect).toEqual(store.find(item)!.rect);
    await loaded.save();
  });
  it("adds an overlay with the usual settings once, and keeps it across a restart", async () => {
    const store = await loadStore(dir);
    expect(store.add(subject(), "game")).toBe("added");
    expect(store.add(subject(), "game")).toBe("exists");
    expect(store.find(subject())).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    store.update(subject(), { mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.5, 0.25, 0.1, 0.1) });
    store.markExclusiveHintShown();
    await store.save();

    const again = await loadStore(dir);
    expect(again.find(subject())).toEqual({ ...subject(), scope: "game", mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.5, 0.25, 0.1, 0.1) });
    expect(again.exclusiveHintShown).toBe(true);
  });

  it("lets a game have at most LIMITS.maxGameOverlays, and each game its own", async () => {
    const store = await loadStore(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(subject(`item-${i}`), "game")).toBe("added");
    expect(store.add(subject("one-more"), "game")).toBe("full");
    expect(store.add(subject("item-0", "other-game"), "game")).toBe("added");
    // Existing ones still answer "exists", not "full".
    expect(store.add(subject("item-0"), "game")).toBe("exists");
  });

  it("starts a second overlay of a game below the first, so it doesn't hide it", async () => {
    const store = await loadStore(dir);
    store.add(subject("a"), "game");
    store.add(subject("b"), "game");
    expect(store.find(subject("b"))!.rect.y).toBeGreaterThan(store.find(subject("a"))!.rect.y);
  });

  it("ignores values it doesn't take when changing an overlay", async () => {
    const store = await loadStore(dir);
    store.add(subject(), "game");
    store.update(subject(), { opacity: 33 as never, rect: { ...at(0, 0, 1, 1), x: Number.NaN } });
    expect(store.find(subject())).toMatchObject({ opacity: 100, rect: DEFAULT_RECT });
    expect(store.update(subject("missing"), { mode: "toggle" })).toBe(false);
  });

  it("forgets what matches, and says whether anything went", async () => {
    const store = await loadStore(dir);
    store.add(subject("a"), "game");
    store.add(subject("b", "other-game"), "game");
    expect(store.forget((overlay) => overlay.workspaceId === "poe2")).toBe(true);
    expect(store.forget((overlay) => overlay.workspaceId === "poe2")).toBe(false);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["b"]);
  });

  it("sets a bad file aside and starts empty, and skips entries it can't use", async () => {
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), "{ not json");
    expect((await loadStore(dir)).all()).toEqual([]);
    expect((await readdir(dir)).some((name) => name.startsWith(GAME_OVERLAYS_FILE) && name !== GAME_OVERLAYS_FILE)).toBe(true);

    const good = { ...oldSubject(), mode: "toggle", opacity: 75, hideFromCapture: false, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({
        version: 1,
        overlays: [good, good, { ...good, key: "bad key!" }, { ...good, key: "no-rect", rect: null }, { ...good, key: "odd", mode: "sideways", opacity: 33, hideFromCapture: "yes" }, "nonsense", null],
      }),
    );
    const store = await loadStore(dir);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["item-1", "odd"]);
    expect(store.find(subject("odd"))).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
  });

  it("starts every stored overlay with capture hiding off, whatever the old Show on stream said", async () => {
    const old = { ...oldSubject(), mode: "always", opacity: 100, showOnStream: true, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [old, { ...old, key: "item-2", showOnStream: false, hideFromCapture: true }] }));
    const store = await loadStore(dir);
    expect(store.find(subject("item-1"))?.hideFromCapture).toBe(false);
    expect(store.find(subject("item-2"))?.hideFromCapture).toBe(true);
    expect(store.find(subject("item-1"))).not.toHaveProperty("showOnStream");
  });

  it("writes the file whole, so a crash leaves the old one or the new one", async () => {
    const store = await loadStore(dir);
    store.add(subject(), "game");
    await store.save();
    expect(JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"))).toMatchObject({ version: 4, overlays: [{ key: "item-1" }], panels: [] });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("version 3: where an overlay sits", () => {
  const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
  const file = (version: number, overlays: unknown[], extra: object = {}) => writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version, overlays, panels: [], ...extra }));
  const old = { ...oldSubject("a"), scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: legacy };

  it("keeps a version 2 file's fractions as they are, placing them the old way, until the game's real window is seen", async () => {
    // Older Tavoras never wrote a window size, so a real version 2 file has none.
    await file(2, [old]);
    const store = await loadStore(dir);
    expect(store.upgraded).toBe(true);
    expect(store.migrated).toBe(false);
    const item = store.find(subject("a"))!;
    expect(item.legacy).toEqual(legacy);
    const wide = { x: 0, y: 0, width: 3440, height: 1440 };
    expect(placeItem(item, wide)).toEqual(placeLegacy(legacy, wide));
    // Saved like that, the file still has the fractions, and no anchor.
    await store.save();
    const saved = JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"));
    expect(saved.version).toBe(4);
    expect(saved.overlays[0]).toMatchObject({ rect: legacy });
    expect(saved.overlays[0]).not.toHaveProperty("anchor");
  });

  it("converts them on the first real window size of the game, onto the very same pixels", async () => {
    await file(2, [old, { ...old, key: "b", gameId: "elden" }]);
    const store = await loadStore(dir);
    const wide = { x: 0, y: 0, width: 3440, height: 1440 };
    // A launcher's or splash screen's window is no size to go by.
    expect(store.convertLegacy("poe2", { width: 639, height: 480 })).toBe(false);
    expect(store.convertLegacy("poe2", { width: 640, height: 479 })).toBe(false);
    expect(store.find(subject("a"))!.legacy).toEqual(legacy);
    expect(store.convertLegacy("poe2", wide)).toBe(true);
    const item = store.find(subject("a"))!;
    expect(item.legacy).toBeUndefined();
    expect(placeItem(item, wide)).toEqual(placeLegacy(legacy, wide));
    expect(placeAnchored(item.rect, wide)).toEqual(placeLegacy(legacy, wide));
    // It was anchored to its nearest corner, so it stays in it on a wider window.
    expect(item.rect).toMatchObject({ h: "right", v: "bottom" });
    // Another game's item waits for its own game; a second look changes nothing.
    expect(store.find(subject("b", "elden"))!.legacy).toEqual(legacy);
    expect(store.convertLegacy("poe2", wide)).toBe(false);
    const full = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(store.convertLegacy("elden", full)).toBe(true);
    expect(placeItem(store.find(subject("b", "elden"))!, full)).toEqual(placeLegacy(legacy, full));
  });

  it("converts on any real window size, to the pixel (a few shapes, and a window that is not at the screen's corner)", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3440, 1440], [1280, 1024], [1366, 768], [5120, 1440], [800, 600]] as const) {
      for (const rel of [legacy, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, { x: 0.001, y: 0.9, width: 0.05, height: 0.02 }]) {
        await file(2, [{ ...old, rect: rel }]);
        const store = await loadStore(dir);
        store.convertLegacy("poe2", { width, height });
        const game = { x: 120, y: 40, width, height };
        expect(placeItem(store.find(subject("a"))!, game), `${width}x${height}`).toEqual(placeLegacy(normalizeLegacy(rel)!, game));
        // Writes now: a save still pending from this round must not land on the next round's file.
        await store.save();
      }
    }
  });

  it("converts the general overlays and panels on the first real window of any game", async () => {
    const general = "0a1b2c3d-0000-4000-8000-000000000009";
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({ version: 2, overlays: [{ ...old, gameId: "personal", scope: "all" }], panels: [{ ...oldPanel(general, "personal"), scope: "all", rect: legacy }, { ...oldPanel(), rect: legacy }] }),
    );
    const store = await loadStore(dir);
    expect(store.convertLegacy("elden", { width: 2560, height: 1440 })).toBe(true);
    expect(store.find(subject("a", "personal"))!.legacy).toBeUndefined();
    expect(store.panelOf(general)!.legacy).toBeUndefined();
    // The panel of poe2 is not elden's.
    expect(store.panelOf(ID)!.legacy).toEqual(legacy);
  });

  it("converts the panels in game of an older file the same way", async () => {
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 2, overlays: [], panels: [{ ...oldPanel(), rect: legacy }] }));
    const store = await loadStore(dir);
    const game = { x: 0, y: 0, width: 2560, height: 1440 };
    expect(placeItem(store.panelOf(ID)!, game)).toEqual(placeLegacy(legacy, game));
    store.convertLegacy("poe2", game);
    expect(store.panelOf(ID)!.legacy).toBeUndefined();
    expect(placeItem(store.panelOf(ID)!, game)).toEqual(placeLegacy(legacy, game));
  });

  it("moving an unconverted one anchors it at once", async () => {
    await file(2, [old, { ...old, key: "b" }, { ...old, key: "c" }]);
    const store = await loadStore(dir);
    store.update(subject("a"), { rect: at(0.1, 0.1, 0.2, 0.2) });
    expect(store.setRect(subject("b"), at(0.2, 0.2, 0.2, 0.2))).toBe(true);
    expect(store.find(subject("a"))!.legacy).toBeUndefined();
    expect(store.find(subject("b"))!.legacy).toBeUndefined();
    expect(store.find(subject("c"))!.legacy).toEqual(legacy);
  });

  it("keeps the fractions of the window next to the anchor, so an older Tavora still places things right", async () => {
    await file(2, [old]);
    const store = await loadStore(dir);
    store.setSeen("poe2", { width: 3440, height: 1440 });
    store.convertLegacy("poe2", { width: 3440, height: 1440 });
    store.add(subject("n", "elden"), "game");
    await store.save();
    const saved = JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"));
    const wide = { x: 0, y: 0, width: 3440, height: 1440 };
    // On the size last seen, the fractions are the very same place as the anchor.
    expect(placeLegacy(saved.overlays[0].rect, wide)).toEqual(placeAnchored(saved.overlays[0].anchor, wide));
    // No size seen for the game: the fractions are computed on 1080p.
    const full = { x: 0, y: 0, ...DEFAULT_GAME_SIZE };
    expect(saved.overlays[1].key).toBe("n");
    expect(placeLegacy(saved.overlays[1].rect, full)).toEqual(placeAnchored(saved.overlays[1].anchor, full));
    // Loading it again keeps the anchor (and no longer waits for a window).
    const again = await loadStore(dir);
    expect(again.find(subject("a"))!.rect).toEqual(saved.overlays[0].anchor);
    expect(again.find(subject("a"))!.legacy).toBeUndefined();
    expect(again.upgraded).toBe(false);
  });

  it("reads a version 3 file's anchors as they are; without a usable anchor the fractions wait to be converted; without either the entry is dropped", async () => {
    const good = { h: "center", v: "middle", x: 0.1, y: -0.05, width: 0.3, height: 0.2 };
    await file(3, [
      { ...old, anchor: good },
      { ...old, key: "b" },
      { ...old, key: "c", anchor: { ...good, h: "diagonal" } },
      { ...old, key: "d", rect: null, anchor: { ...good, v: "nowhere" } },
    ]);
    const store = await loadStore(dir);
    expect(store.upgraded).toBe(false);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["a", "b", "c"]);
    expect(store.find(subject("a"))!.rect).toEqual(good);
    expect(store.find(subject("a"))!.legacy).toBeUndefined();
    expect(store.find(subject("b"))!.legacy).toEqual(legacy);
    expect(store.find(subject("c"))!.legacy).toEqual(legacy);
  });

  it("sets a file of a newer version aside, starts empty, and never writes over it", async () => {
    const future = JSON.stringify({ version: 5, overlays: [{ ...old, anchor: { h: "left", v: "top", x: 0, y: 0, width: 0.1, height: 0.1 } }], panels: [], somethingNew: true });
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), future);
    const store = await loadStore(dir);
    expect(store.all()).toEqual([]);
    expect(store.migrated).toBe(false);
    const aside = (await readdir(dir)).filter((name) => name.startsWith(`${GAME_OVERLAYS_FILE}.corrupt-`));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(dir, aside[0]!), "utf8")).toBe(future);
    // The new file is its own: saving it leaves the set-aside copy alone.
    store.add(subject("n"), "game");
    await store.save();
    expect(JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8")).version).toBe(4);
    expect(await readFile(path.join(dir, aside[0]!), "utf8")).toBe(future);
  });

  it("treats only versions 1 and 2 as old: version 3 (moved to version 4) is current", async () => {
    for (const [version, upgraded] of [[1, true], [2, true], [3, false]] as const) {
      await file(version, [old]);
      expect((await loadStore(dir)).upgraded).toBe(upgraded);
    }
  });

  it("converts a version 1 file too, with the clean-up of its old keys", async () => {
    await file(1, [old, { ...old, key: `panel-${ID}` }]);
    const store = await loadStore(dir);
    expect(store.migrated).toBe(true);
    expect(store.upgraded).toBe(true);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["a"]);
  });

  it("keeps the grid, the layout window's place and the window size last seen for each game", async () => {
    const store = await loadStore(dir);
    expect(store.grid).toBe("normal");
    expect(store.seenSize("poe2")).toBeUndefined();
    store.setGrid("fine");
    store.setGrid("huge" as never);
    store.setLayoutWindow({ bounds: { x: 10, y: 20, width: 900, height: 600 }, maximized: false });
    expect(store.setSeen("poe2", { width: 2560.4, height: 1440 })).toBe(true);
    expect(store.setSeen("poe2", { width: 2560, height: 1440 })).toBe(false);
    expect(store.setSeen("poe2", { width: 20, height: 20 })).toBe(false);
    expect(store.setSeen("poe2", { width: Number.NaN, height: 1080 })).toBe(false);
    await store.save();
    const again = await loadStore(dir);
    expect(again.grid).toBe("fine");
    expect(again.layoutWindow).toEqual({ bounds: { x: 10, y: 20, width: 900, height: 600 }, maximized: false });
    expect(again.seenSize("poe2")).toEqual({ width: 2560, height: 1440 });
    again.forgetSeen("poe2");
    expect(again.seenSize("poe2")).toBeUndefined();
  });

  it("resets one position, for an overlay or a panel", async () => {
    const store = await loadStore(dir);
    store.add(subject("a"), "game");
    store.addPanel(panel());
    store.update(subject("a"), { rect: at(0.5, 0.5, 0.1, 0.1) });
    expect(store.setRect(subject("a"), DEFAULT_RECT)).toBe(true);
    expect(store.find(subject("a"))!.rect).toEqual(DEFAULT_RECT);
    expect(store.setRect({ instanceId: ID }, at(0.2, 0.2, 0.3, 0.3))).toBe(true);
    expect(store.panelOf(ID)!.rect).toEqual(at(0.2, 0.2, 0.3, 0.3));
    expect(store.setRect(subject("missing"), DEFAULT_RECT)).toBe(false);
    expect(store.setRect({ instanceId: ID2 }, DEFAULT_RECT)).toBe(false);
    expect(store.setRect(subject("a"), { ...DEFAULT_RECT, width: Number.NaN })).toBe(false);
  });
});

describe("dragging and resizing", () => {
  const game = { x: 0, y: 0, width: 1000, height: 600 };
  const rect = { x: 100, y: 100, width: 200, height: 100 };

  it("moves it, but not out of the game's window", () => {
    expect(dragRect(rect, game, null, 50, -20)).toEqual({ x: 150, y: 80, width: 200, height: 100 });
    expect(dragRect(rect, game, null, 5000, 5000)).toEqual({ x: 800, y: 500, width: 200, height: 100 });
    expect(dragRect(rect, game, null, -5000, -5000)).toMatchObject({ x: 0, y: 0 });
  });

  it("pulls the edges it is given", () => {
    expect(dragRect(rect, game, { right: true, bottom: true }, 40, 30)).toEqual({ x: 100, y: 100, width: 240, height: 130 });
    expect(dragRect(rect, game, { left: true, top: true }, -40, -30)).toEqual({ x: 60, y: 70, width: 240, height: 130 });
  });

  it("stops at the smallest size and at the window's edge", () => {
    expect(dragRect(rect, game, { right: true }, -5000, 0).width).toBe(MIN_OVERLAY_SIZE);
    expect(dragRect(rect, game, { left: true }, 5000, 0)).toMatchObject({ x: 300 - MIN_OVERLAY_SIZE, width: MIN_OVERLAY_SIZE });
    expect(dragRect(rect, game, { right: true, bottom: true }, 5000, 5000)).toMatchObject({ width: 900, height: 500 });
  });
});

describe("when an overlay shows", () => {
  const base: VisibilityInput = { enabled: true, gameInFront: true, mode: "always", toggledOn: false, layerOpen: false };
  const visible = (change: Partial<VisibilityInput>) => overlayVisible({ ...base, ...change });

  it("shows an Always overlay while its game is in front", () => {
    expect(visible({})).toBe(true);
  });

  it("hides everything when the switch is off or the game isn't in front, whatever else is set", () => {
    expect(visible({ enabled: false })).toBe(false);
    expect(visible({ gameInFront: false })).toBe(false);
    expect(visible({ gameInFront: false, toggledOn: true, layerOpen: true })).toBe(false);
    expect(visible({ enabled: false, layerOpen: true })).toBe(false);
  });

  it("shows a Toggle overlay only after its key switched it on", () => {
    expect(visible({ mode: "toggle" })).toBe(false);
    expect(visible({ mode: "toggle", toggledOn: true })).toBe(true);
  });

  it("shows all of a game's overlays while the layer is open, so each can be placed", () => {
    expect(visible({ mode: "toggle", layerOpen: true })).toBe(true);
  });
});

describe("the game in front", () => {
  const isGame = (id: string) => id !== "personal";

  it("is the game that has overlays or panels among the ones the front program belongs to", () => {
    expect(gameInFront(new Set(["a", "b"]), new Set(["b", "c"]), false, isGame)).toBe("b");
    expect(gameInFront(new Set(["a"]), new Set(["b"]), false, isGame)).toBeNull();
    expect(gameInFront(new Set(), new Set(["b"]), true, isGame)).toBeNull();
  });

  it("is any library game when something is general, preferring one with its own", () => {
    expect(gameInFront(new Set(["a"]), new Set(), true, isGame)).toBe("a");
    expect(gameInFront(new Set(["a", "b"]), new Set(["b"]), true, isGame)).toBe("b");
    // Not a workspace that is no game.
    expect(gameInFront(new Set(["personal"]), new Set(), true, isGame)).toBeNull();
  });

  it("knows exclusive full screen by Windows' D3D full screen state only", () => {
    expect(looksExclusive(3)).toBe(true);
    // Busy (a borderless game, a presentation) is not exclusive.
    expect(looksExclusive(2)).toBe(false);
    expect(looksExclusive(4)).toBe(false);
    expect(looksExclusive(null)).toBe(false);
  });
});

describe("scope", () => {
  it("is general for anything made outside a game", () => {
    expect(scopeForKind("game")).toBe("game");
    expect(scopeForKind("personal")).toBe("all");
    expect(scopeForKind(undefined)).toBe("all");
  });

  it("matches a game's own things to that game, and general ones to every game", () => {
    expect(appliesTo({ scope: "game", workspaceId: "a" }, "a")).toBe(true);
    expect(appliesTo({ scope: "game", workspaceId: "a" }, "b")).toBe(false);
    expect(appliesTo({ scope: "all", workspaceId: "personal" }, "b")).toBe(true);
  });

  it("keeps the scope across a restart, and takes it from the workspace's kind for files without one", async () => {
    const store = await loadStore(dir);
    store.add(subject("a", "personal"), "all");
    store.add(subject("b", "poe2"), "game");
    await store.save();
    const again = await loadStore(dir);
    expect(again.find(subject("a", "personal"))?.scope).toBe("all");
    expect(again.find(subject("b", "poe2"))?.scope).toBe("game");
    expect(again.of("elden").map((overlay) => overlay.key)).toEqual(["a"]);
    expect(again.of("poe2").map((overlay) => overlay.key)).toEqual(["a", "b"]);

    const old = { ...oldSubject("c", "personal"), mode: "always", opacity: 100, hideFromCapture: false, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [old, { ...old, key: "d", gameId: "poe2" }] }));
    const migrated = await loadStore(dir, (workspaceId) => (workspaceId === "personal" ? "all" : "game"));
    expect(migrated.all().map((overlay) => [overlay.key, overlay.scope])).toEqual([["c", "all"], ["d", "game"]]);
  });

  it("allows eight of a game's own and eight general ones, panels counted with overlays", async () => {
    const store = await loadStore(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(subject(`item-${i}`, "poe2"), "game")).toBe("added");
    expect(store.add(subject("more", "poe2"), "game")).toBe("full");
    expect(store.addPanel({ owner: "official", moduleId: "m", workspaceId: "poe2", scope: "game", instanceId: ID })).toBe("full");
    // The general ones have their own eight, whichever workspace they were made in.
    for (let i = 0; i < LIMITS.maxGameOverlays - 1; i++) expect(store.add(subject(`g-${i}`, "personal"), "all")).toBe("added");
    expect(store.addPanel({ owner: "official", moduleId: "m", workspaceId: "personal", scope: "all", instanceId: ID })).toBe("added");
    expect(store.add(subject("g-more", "other-workspace"), "all")).toBe("full");
    // Another game still has room.
    expect(store.add(subject("x", "elden"), "game")).toBe("added");
  });
});

const ID = "0a1b2c3d-0000-4000-8000-000000000001";
const ID2 = "0a1b2c3d-0000-4000-8000-000000000002";
const panel = (instanceId = ID, workspaceId = "poe2") => ({ owner: "official", moduleId: "tavora.todos", workspaceId, scope: "game" as const, instanceId });
/** A panel in game as a file of version 3 or older kept it. */
const oldPanel = (instanceId = ID, gameId = "poe2") => ({ owner: "official", moduleId: "tavora.todos", gameId, scope: "game" as const, instanceId });

describe("startRect", () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };

  it("gives the size the module prefers, in the corner", () => {
    expect(startRect({ width: 360, height: 216 }, screen)).toEqual({ ...DEFAULT_PANEL_ANCHORED, width: 360 / 1080, height: 0.2 });
  });

  it("keeps the usual size for what the module leaves out, or with no window to measure", () => {
    expect(startRect({ width: 360 }, screen).height).toBe(DEFAULT_PANEL_ANCHORED.height);
    expect(startRect(null, screen)).toEqual(DEFAULT_PANEL_ANCHORED);
    expect(startRect({ width: 360, height: 200 }, null)).toEqual(DEFAULT_PANEL_ANCHORED);
  });

  it("starts an overlay at the size its module asks for, from the usual place of an overlay", () => {
    expect(startRect({ width: 440, height: 100 }, screen, DEFAULT_RECT)).toEqual({ ...DEFAULT_RECT, width: 440 / 1080, height: 100 / 1080 });
    // On the screen it was sized for, that is the very pixels asked for.
    const placed = placeAnchored(startRect({ width: 440, height: 100 }, screen, DEFAULT_RECT), screen);
    expect([placed.width, placed.height]).toEqual([440, 100]);
    expect(startRect(null, screen, DEFAULT_RECT)).toEqual(DEFAULT_RECT);
    expect(startRect({ width: 440, height: 100 }, null, DEFAULT_RECT)).toEqual(DEFAULT_RECT);
  });

  it("gives the same size on screen as the fractions of the window did, on a window of any shape", () => {
    for (const [width, height] of [[1920, 1080], [3440, 1440], [1280, 720], [1024, 768]] as const) {
      const area = { x: 0, y: 0, width, height };
      const placed = placeAnchored(startRect({ width: 360, height: 216 }, area), area);
      expect([placed.width, placed.height]).toEqual([360, 216]);
    }
  });

  it("never gets bigger than the window", () => {
    expect(startRect({ width: 4000, height: 4000 }, screen)).toEqual({ ...DEFAULT_PANEL_ANCHORED, width: 1920 / 1080 - DEFAULT_PANEL_ANCHORED.x, height: 1 - DEFAULT_PANEL_ANCHORED.y });
    // The same panel in a 21:9 window has room for more width, not more height.
    expect(startRect({ width: 4000, height: 4000 }, { x: 0, y: 0, width: 2520, height: 1080 }).width).toBeGreaterThan(2);
  });
});

describe("panels in the game", () => {
  it("are kept by instance id across a restart, with where the player put them", async () => {
    const store = await loadStore(dir);
    expect(store.addPanel(panel())).toBe("added");
    expect(store.addPanel(panel())).toBe("exists");
    expect(store.panelOf(ID)!.rect.height).toBeGreaterThanOrEqual(DEFAULT_PANEL_ANCHORED.height);
    store.updatePanel(ID, at(0.5, 0.25, 0.2, 0.3));
    await store.save();
    const again = await loadStore(dir);
    expect(again.panels()).toEqual([{ ...panel(), mode: "always", opacity: 100, hideFromCapture: false, rect: at(0.5, 0.25, 0.2, 0.3) }]);
    expect(again.panelsOf("poe2")).toHaveLength(1);
    expect(again.panelsOf("elden")).toHaveLength(0);
  });

  it("keeps the live view's mode, opacity and Hide from capture, and gives old records the defaults", async () => {
    const store = await loadStore(dir);
    store.addPanel(panel());
    expect(store.panelOf(ID)).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    expect(store.updatePanelView(ID, { mode: "toggle", opacity: 25, hideFromCapture: true })).toBe(true);
    expect(store.updatePanelView(ID, { opacity: 33 as never })).toBe(true);
    expect(store.updatePanelView(ID2, { mode: "toggle" })).toBe(false);
    await store.save();
    expect((await loadStore(dir)).panelOf(ID)).toMatchObject({ mode: "toggle", opacity: 25, hideFromCapture: true });
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 2, overlays: [], panels: [{ ...oldPanel(), rect }, { ...oldPanel(ID2), rect, mode: "hold", opacity: 12, hideFromCapture: "yes" }] }));
    const old = await loadStore(dir);
    expect(old.panels().map(({ mode, opacity, hideFromCapture }) => ({ mode, opacity, hideFromCapture }))).toEqual([
      { mode: "always", opacity: 100, hideFromCapture: false },
      { mode: "always", opacity: 100, hideFromCapture: false },
    ]);
  });

  it("forgets the ones that match", async () => {
    const store = await loadStore(dir);
    store.addPanel(panel(ID));
    store.addPanel(panel(ID2));
    expect(store.forgetPanels((item) => item.instanceId === ID)).toBe(true);
    expect(store.forgetPanels((item) => item.instanceId === ID)).toBe(false);
    expect(store.panels().map((item) => item.instanceId)).toEqual([ID2]);
  });

  it("skips entries it can't use, and drops the permanent panel overlays of 0.20.54", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...oldSubject("item-1"), mode: "always", opacity: 100, hideFromCapture: false, rect };
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({
        version: 1,
        overlays: [overlay, { ...overlay, key: `panel-${ID}` }],
        panels: [{ ...oldPanel(), rect }, { ...oldPanel("not-an-id"), rect }, { ...oldPanel(ID2), rect: null }, "nonsense"],
      }),
    );
    const store = await loadStore(dir);
    expect(store.all().map((item) => item.key)).toEqual(["item-1"]);
    expect(store.panels().map((item) => item.instanceId)).toEqual([ID]);
    expect(store.migrated).toBe(true);
  });

  it("cleans the panel- keys out of a file of version 1 only, and a new file is not a migration", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...oldSubject("item-1"), scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect };
    expect((await loadStore(dir)).migrated).toBe(false);
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 2, overlays: [overlay, { ...overlay, key: `panel-${ID}` }], panels: [] }));
    const current = await loadStore(dir);
    expect(current.migrated).toBe(false);
    expect(current.all().map((item) => item.key)).toEqual(["item-1", `panel-${ID}`]);
  });

  it("gives an old overlay the scope scopeOf says", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...oldSubject("item-1"), mode: "always", opacity: 100, hideFromCapture: false, rect };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [overlay, { ...overlay, gameId: "personal" }] }));
    const store = await loadStore(dir, (workspaceId) => (workspaceId === "personal" ? "all" : "game"));
    expect(store.all().map((item) => [item.workspaceId, item.scope])).toEqual([[overlay.gameId, "game"], ["personal", "all"]]);
  });

  it("take the keyboard and the player's clicks only while the layer is open", () => {
    expect(gestureCounts(false, false)).toBe(true);
    expect(gestureCounts(true, false)).toBe(false);
    expect(gestureCounts(true, true)).toBe(true);
  });

  it("fill their window, and sit inside the frame while the layer is open", () => {
    expect(panelBounds({ width: 300, height: 200 }, false)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    const { top, side } = PANEL_ARRANGE_INSET;
    expect(panelBounds({ width: 300, height: 200 }, true)).toEqual({ x: side, y: top, width: 300 - 2 * side, height: 200 - top - side });
    expect(panelBounds({ width: 4, height: 4 }, true)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("the Live badge", () => {
  it("shows when the panel is in the game, or its module has an overlay over the game", () => {
    expect(isLive(true, 0)).toBe(true);
    expect(isLive(false, 2)).toBe(true);
    expect(isLive(false, 0)).toBe(false);
  });
});
