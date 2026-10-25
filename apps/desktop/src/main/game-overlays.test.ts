import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import {
  DEFAULT_PANEL_RECT,
  DEFAULT_RELATIVE_RECT,
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
  normalizeRelative,
  overlayVisible,
  panelBounds,
  scopeForKind,
  placeRelative,
  relativeTo,
  type GameOverlaySubject,
  type VisibilityInput,
} from "./game-overlays";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-game-overlays-"));
});

afterEach(async () => {
  // Saves run in the background; let the last one land first.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const subject = (key = "item-1", gameId = "poe2"): GameOverlaySubject => ({ owner: "official", moduleId: "tavora.clock-counter", gameId, key });

describe("GameOverlayStore", () => {
  it("adds an overlay with the usual settings once, and keeps it across a restart", async () => {
    const store = await GameOverlayStore.load(dir);
    expect(store.add(subject(), "game")).toBe("added");
    expect(store.add(subject(), "game")).toBe("exists");
    expect(store.find(subject())).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    store.update(subject(), { mode: "toggle", opacity: 50, hideFromCapture: true, rect: { x: 0.5, y: 0.25, width: 0.1, height: 0.1 } });
    store.markExclusiveHintShown();
    await store.save();

    const again = await GameOverlayStore.load(dir);
    expect(again.find(subject())).toEqual({ ...subject(), scope: "game", mode: "toggle", opacity: 50, hideFromCapture: true, rect: { x: 0.5, y: 0.25, width: 0.1, height: 0.1 } });
    expect(again.exclusiveHintShown).toBe(true);
  });

  it("lets a game have at most LIMITS.maxGameOverlays, and each game its own", async () => {
    const store = await GameOverlayStore.load(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(subject(`item-${i}`), "game")).toBe("added");
    expect(store.add(subject("one-more"), "game")).toBe("full");
    expect(store.add(subject("item-0", "other-game"), "game")).toBe("added");
    // Existing ones still answer "exists", not "full".
    expect(store.add(subject("item-0"), "game")).toBe("exists");
  });

  it("starts a second overlay of a game below the first, so it doesn't hide it", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject("a"), "game");
    store.add(subject("b"), "game");
    expect(store.find(subject("b"))!.rect.y).toBeGreaterThan(store.find(subject("a"))!.rect.y);
  });

  it("ignores values it doesn't take when changing an overlay", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject(), "game");
    store.update(subject(), { opacity: 33 as never, rect: { x: Number.NaN, y: 0, width: 1, height: 1 } });
    expect(store.find(subject())).toMatchObject({ opacity: 100, rect: DEFAULT_RELATIVE_RECT });
    expect(store.update(subject("missing"), { mode: "toggle" })).toBe(false);
  });

  it("forgets what matches, and says whether anything went", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject("a"), "game");
    store.add(subject("b", "other-game"), "game");
    expect(store.forget((overlay) => overlay.gameId === "poe2")).toBe(true);
    expect(store.forget((overlay) => overlay.gameId === "poe2")).toBe(false);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["b"]);
  });

  it("sets a bad file aside and starts empty, and skips entries it can't use", async () => {
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), "{ not json");
    expect((await GameOverlayStore.load(dir)).all()).toEqual([]);
    expect((await readdir(dir)).some((name) => name.startsWith(GAME_OVERLAYS_FILE) && name !== GAME_OVERLAYS_FILE)).toBe(true);

    const good = { ...subject(), mode: "toggle", opacity: 75, hideFromCapture: false, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({
        version: 1,
        overlays: [good, good, { ...good, key: "bad key!" }, { ...good, key: "no-rect", rect: null }, { ...good, key: "odd", mode: "sideways", opacity: 33, hideFromCapture: "yes" }, "nonsense", null],
      }),
    );
    const store = await GameOverlayStore.load(dir);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["item-1", "odd"]);
    expect(store.find(subject("odd"))).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
  });

  it("starts every stored overlay with capture hiding off, whatever the old Show on stream said", async () => {
    const old = { ...subject(), mode: "always", opacity: 100, showOnStream: true, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [old, { ...old, key: "item-2", showOnStream: false, hideFromCapture: true }] }));
    const store = await GameOverlayStore.load(dir);
    expect(store.find(subject("item-1"))?.hideFromCapture).toBe(false);
    expect(store.find(subject("item-2"))?.hideFromCapture).toBe(true);
    expect(store.find(subject("item-1"))).not.toHaveProperty("showOnStream");
  });

  it("writes the file whole, so a crash leaves the old one or the new one", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject(), "game");
    await store.save();
    expect(JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"))).toMatchObject({ version: 2, overlays: [{ key: "item-1" }], panels: [] });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("where an overlay sits", () => {
  const game = { x: 100, y: 50, width: 1920, height: 1080 };

  it("places a relative rectangle in the game's window", () => {
    expect(placeRelative({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, game)).toEqual({ x: 100 + 960, y: 50 + 270, width: 480, height: 540 });
  });

  it("keeps the same place when the resolution changes", () => {
    const rel = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
    const small = placeRelative(rel, { x: 0, y: 0, width: 1280, height: 720 });
    const big = placeRelative(rel, { x: 0, y: 0, width: 2560, height: 1440 });
    expect(big).toEqual({ x: small.x * 2, y: small.y * 2, width: small.width * 2, height: small.height * 2 });
  });

  it("follows the game's window to another monitor", () => {
    const rel = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const second = { x: 2560, y: 0, width: 1920, height: 1080 };
    const placed = placeRelative(rel, second);
    expect(placed.x).toBeGreaterThanOrEqual(second.x);
    expect(placed.x + placed.width).toBeLessThanOrEqual(second.x + second.width);
  });

  it("never lets it get smaller than a sliver or leave the window", () => {
    expect(placeRelative({ x: 0, y: 0, width: 0.02, height: 0.02 }, { x: 0, y: 0, width: 400, height: 300 })).toMatchObject({ width: MIN_OVERLAY_SIZE, height: MIN_OVERLAY_SIZE });
    const edge = placeRelative({ x: 0.95, y: 0.95, width: 0.2, height: 0.2 }, game);
    expect(edge.x + edge.width).toBeLessThanOrEqual(game.x + game.width);
    expect(edge.y + edge.height).toBeLessThanOrEqual(game.y + game.height);
    // A window smaller than the sliver is filled, not overflowed.
    expect(placeRelative({ x: 0, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0, width: 30, height: 30 })).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });

  it("turns a rectangle on screen back into fractions", () => {
    const rel = { x: 0.25, y: 0.5, width: 0.125, height: 0.25 };
    expect(relativeTo(placeRelative(rel, game), game)).toEqual(rel);
    expect(relativeTo({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual(DEFAULT_RELATIVE_RECT);
  });

  it("clamps saved fractions and refuses what isn't numbers", () => {
    expect(normalizeRelative({ x: -1, y: 2, width: 5, height: 0 })).toEqual({ x: 0, y: 0.98, width: 1, height: 0.02 });
    expect(normalizeRelative({ x: 0.9, y: 0, width: 0.5, height: 0.5 })).toMatchObject({ x: 0.5 });
    expect(normalizeRelative({ x: "0", y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeRelative(null)).toBeNull();
    expect(normalizeRelative({ x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 })).toBeNull();
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
    expect(scopeForKind("workspace")).toBe("all");
    expect(scopeForKind(undefined)).toBe("all");
  });

  it("matches a game's own things to that game, and general ones to every game", () => {
    expect(appliesTo({ scope: "game", gameId: "a" }, "a")).toBe(true);
    expect(appliesTo({ scope: "game", gameId: "a" }, "b")).toBe(false);
    expect(appliesTo({ scope: "all", gameId: "personal" }, "b")).toBe(true);
  });

  it("keeps the scope across a restart, and takes it from the workspace's kind for files without one", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject("a", "personal"), "all");
    store.add(subject("b", "poe2"), "game");
    await store.save();
    const again = await GameOverlayStore.load(dir);
    expect(again.find(subject("a", "personal"))?.scope).toBe("all");
    expect(again.find(subject("b", "poe2"))?.scope).toBe("game");
    expect(again.of("elden").map((overlay) => overlay.key)).toEqual(["a"]);
    expect(again.of("poe2").map((overlay) => overlay.key)).toEqual(["a", "b"]);

    const old = { ...subject("c", "personal"), mode: "always", opacity: 100, hideFromCapture: false, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [old, { ...old, key: "d", gameId: "poe2" }] }));
    const migrated = await GameOverlayStore.load(dir, (gameId) => (gameId === "personal" ? "all" : "game"));
    expect(migrated.all().map((overlay) => [overlay.key, overlay.scope])).toEqual([["c", "all"], ["d", "game"]]);
  });

  it("allows eight of a game's own and eight general ones, panels counted with overlays", async () => {
    const store = await GameOverlayStore.load(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(subject(`item-${i}`, "poe2"), "game")).toBe("added");
    expect(store.add(subject("more", "poe2"), "game")).toBe("full");
    expect(store.addPanel({ owner: "official", moduleId: "m", gameId: "poe2", scope: "game", instanceId: ID })).toBe("full");
    // The general ones have their own eight, whichever workspace they were made in.
    for (let i = 0; i < LIMITS.maxGameOverlays - 1; i++) expect(store.add(subject(`g-${i}`, "personal"), "all")).toBe("added");
    expect(store.addPanel({ owner: "official", moduleId: "m", gameId: "personal", scope: "all", instanceId: ID })).toBe("added");
    expect(store.add(subject("g-more", "other-workspace"), "all")).toBe("full");
    // Another game still has room.
    expect(store.add(subject("x", "elden"), "game")).toBe("added");
  });
});

const ID = "0a1b2c3d-0000-4000-8000-000000000001";
const ID2 = "0a1b2c3d-0000-4000-8000-000000000002";
const panel = (instanceId = ID, gameId = "poe2") => ({ owner: "official", moduleId: "tavora.todos", gameId, scope: "game" as const, instanceId });

describe("panels in the game", () => {
  it("are kept by instance id across a restart, with where the player put them", async () => {
    const store = await GameOverlayStore.load(dir);
    expect(store.addPanel(panel())).toBe("added");
    expect(store.addPanel(panel())).toBe("exists");
    expect(store.panelOf(ID)!.rect.height).toBeGreaterThanOrEqual(DEFAULT_PANEL_RECT.height);
    store.updatePanel(ID, { x: 0.5, y: 0.25, width: 0.2, height: 0.3 });
    await store.save();
    const again = await GameOverlayStore.load(dir);
    expect(again.panels()).toEqual([{ ...panel(), rect: { x: 0.5, y: 0.25, width: 0.2, height: 0.3 } }]);
    expect(again.panelsOf("poe2")).toHaveLength(1);
    expect(again.panelsOf("elden")).toHaveLength(0);
  });

  it("forgets the ones that match", async () => {
    const store = await GameOverlayStore.load(dir);
    store.addPanel(panel(ID));
    store.addPanel(panel(ID2));
    expect(store.forgetPanels((item) => item.instanceId === ID)).toBe(true);
    expect(store.forgetPanels((item) => item.instanceId === ID)).toBe(false);
    expect(store.panels().map((item) => item.instanceId)).toEqual([ID2]);
  });

  it("skips entries it can't use, and drops the permanent panel overlays of 0.20.54", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...subject("item-1"), mode: "always", opacity: 100, hideFromCapture: false, rect };
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({
        version: 1,
        overlays: [overlay, { ...overlay, key: `panel-${ID}` }],
        panels: [{ ...panel(), rect }, { ...panel("not-an-id"), rect }, { ...panel(ID2), rect: null }, "nonsense"],
      }),
    );
    const store = await GameOverlayStore.load(dir);
    expect(store.all().map((item) => item.key)).toEqual(["item-1"]);
    expect(store.panels().map((item) => item.instanceId)).toEqual([ID]);
    expect(store.migrated).toBe(true);
  });

  it("cleans the panel- keys out of a file of version 1 only, and a new file is not a migration", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...subject("item-1"), scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect };
    expect((await GameOverlayStore.load(dir)).migrated).toBe(false);
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 2, overlays: [overlay, { ...overlay, key: `panel-${ID}` }], panels: [] }));
    const current = await GameOverlayStore.load(dir);
    expect(current.migrated).toBe(false);
    expect(current.all().map((item) => item.key)).toEqual(["item-1", `panel-${ID}`]);
  });

  it("gives an old overlay the scope scopeOf says", async () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const overlay = { ...subject("item-1"), mode: "always", opacity: 100, hideFromCapture: false, rect };
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify({ version: 1, overlays: [overlay, { ...overlay, gameId: "personal" }] }));
    const store = await GameOverlayStore.load(dir, (gameId) => (gameId === "personal" ? "all" : "game"));
    expect(store.all().map((item) => [item.gameId, item.scope])).toEqual([[overlay.gameId, "game"], ["personal", "all"]]);
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
