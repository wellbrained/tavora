import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import {
  DEFAULT_RELATIVE_RECT,
  GAME_OVERLAYS_FILE,
  GameOverlayStore,
  MIN_OVERLAY_SIZE,
  dragRect,
  gameInFront,
  looksExclusive,
  normalizeRelative,
  overlayVisible,
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
    expect(store.add(subject())).toBe("added");
    expect(store.add(subject())).toBe("exists");
    expect(store.find(subject())).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    store.update(subject(), { mode: "toggle", opacity: 50, hideFromCapture: true, rect: { x: 0.5, y: 0.25, width: 0.1, height: 0.1 } });
    store.markExclusiveHintShown();
    await store.save();

    const again = await GameOverlayStore.load(dir);
    expect(again.find(subject())).toEqual({ ...subject(), mode: "toggle", opacity: 50, hideFromCapture: true, rect: { x: 0.5, y: 0.25, width: 0.1, height: 0.1 } });
    expect(again.exclusiveHintShown).toBe(true);
  });

  it("lets a game have at most LIMITS.maxGameOverlays, and each game its own", async () => {
    const store = await GameOverlayStore.load(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(subject(`item-${i}`))).toBe("added");
    expect(store.add(subject("one-more"))).toBe("full");
    expect(store.add(subject("item-0", "other-game"))).toBe("added");
    // Existing ones still answer "exists", not "full".
    expect(store.add(subject("item-0"))).toBe("exists");
  });

  it("starts a second overlay of a game below the first, so it doesn't hide it", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject("a"));
    store.add(subject("b"));
    expect(store.find(subject("b"))!.rect.y).toBeGreaterThan(store.find(subject("a"))!.rect.y);
  });

  it("ignores values it doesn't take when changing an overlay", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject());
    store.update(subject(), { opacity: 33 as never, rect: { x: Number.NaN, y: 0, width: 1, height: 1 } });
    expect(store.find(subject())).toMatchObject({ opacity: 100, rect: DEFAULT_RELATIVE_RECT });
    expect(store.update(subject("missing"), { mode: "toggle" })).toBe(false);
  });

  it("forgets what matches, and says whether anything went", async () => {
    const store = await GameOverlayStore.load(dir);
    store.add(subject("a"));
    store.add(subject("b", "other-game"));
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
    store.add(subject());
    await store.save();
    expect(JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"))).toMatchObject({ version: 1, overlays: [{ key: "item-1" }] });
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
  const base: VisibilityInput = { enabled: true, gameInFront: true, mode: "always", toggledOn: false, arranging: false };
  const visible = (change: Partial<VisibilityInput>) => overlayVisible({ ...base, ...change });

  it("shows an Always overlay while its game is in front", () => {
    expect(visible({})).toBe(true);
  });

  it("hides everything when the switch is off or the game isn't in front, whatever else is set", () => {
    expect(visible({ enabled: false })).toBe(false);
    expect(visible({ gameInFront: false })).toBe(false);
    expect(visible({ gameInFront: false, toggledOn: true, arranging: true })).toBe(false);
    expect(visible({ enabled: false, arranging: true })).toBe(false);
  });

  it("shows a Toggle overlay only after its key switched it on", () => {
    expect(visible({ mode: "toggle" })).toBe(false);
    expect(visible({ mode: "toggle", toggledOn: true })).toBe(true);
  });

  it("shows all of a game's overlays while arranging, so each can be placed", () => {
    expect(visible({ mode: "toggle", arranging: true })).toBe(true);
  });
});

describe("the game in front", () => {
  it("is the game that has overlays among the ones the front program belongs to", () => {
    expect(gameInFront(new Set(["a", "b"]), new Set(["b", "c"]))).toBe("b");
    expect(gameInFront(new Set(["a"]), new Set(["b"]))).toBeNull();
    expect(gameInFront(new Set(), new Set(["b"]))).toBeNull();
  });

  it("knows exclusive full screen by Windows' D3D full screen state only", () => {
    expect(looksExclusive(3)).toBe(true);
    // Busy (a borderless game, a presentation) is not exclusive.
    expect(looksExclusive(2)).toBe(false);
    expect(looksExclusive(4)).toBe(false);
    expect(looksExclusive(null)).toBe(false);
  });
});
