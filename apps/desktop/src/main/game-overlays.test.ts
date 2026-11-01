import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@tavora/sdk/protocol";
import { DEFAULT_PANEL_ANCHORED, DEFAULT_RECT, normalizeLegacy, placeAnchored, placeLegacy, type AnchoredRect } from "../shared/overlay-anchor";
import {
  ALL_GAMES,
  BEFORE_SETUPS_DIR,
  EVERYWHERE,
  FILE_VERSION,
  GAME_OVERLAYS_FILE,
  GameOverlayStore,
  MIN_OVERLAY_SIZE,
  PANEL_ARRANGE_INSET,
  allowedIn,
  dragRect,
  gameInFront,
  gameSetupFor,
  gestureCounts,
  isGameSetup,
  isLive,
  landingSetup,
  looksExclusive,
  overlayVisible,
  panelBounds,
  placeItem,
  scopeForKind,
  setupsOnScreen,
  startRect,
  type GameOverlaySubject,
  type OverlayScope,
  type VisibilityInput,
} from "./game-overlays";
import { moveToWorkspaces } from "./workspace-move";

let dir: string;
const stores: GameOverlayStore[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tavora-game-overlays-"));
});

afterEach(async () => {
  // The folder goes only after every store of the test has written what it still had waiting.
  await Promise.all(stores.splice(0).map((store) => store.save()));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A rectangle anchored to the top left corner, in units of the game window's height. */
const at = (x: number, y: number, width: number, height: number): AnchoredRect => ({ h: "left", v: "top", x, y, width, height });

/** Which workspaces are personal; the rest are game workspaces (a game workspace's id is its game's). */
const PERSONAL = new Set(["personal", "work"]);
const scopeOf = (workspaceId: string): OverlayScope => (PERSONAL.has(workspaceId) ? "all" : "game");

const subject = (key = "item-1", workspaceId = "poe2"): GameOverlaySubject => ({ owner: "official", moduleId: "tavora.clock-counter", workspaceId, key });
/** An overlay's subject as a file of version 3 or older kept it, before the workspace names. */
const oldSubject = (key = "item-1", gameId = "poe2") => ({ owner: "official", moduleId: "tavora.clock-counter", gameId, key });

const ID = "0a1b2c3d-0000-4000-8000-000000000001";
const ID2 = "0a1b2c3d-0000-4000-8000-000000000002";
const ID3 = "0a1b2c3d-0000-4000-8000-000000000003";
const panel = (instanceId = ID, workspaceId = "poe2") => ({ owner: "official", moduleId: "tavora.todos", workspaceId, instanceId });
/** A panel in game as a file of version 3 or older kept it. */
const oldPanel = (instanceId = ID, gameId = "poe2") => ({ owner: "official", moduleId: "tavora.todos", gameId, scope: "game" as const, instanceId });

/** Loads the file as Tavora does at start: moved to the workspace names first (workspace-move.ts). */
async function loadStore(userData: string, scopes: (workspaceId: string) => OverlayScope = scopeOf): Promise<GameOverlayStore> {
  await moveToWorkspaces(userData);
  return own(await GameOverlayStore.load(userData, scopes));
}

const own = (store: GameOverlayStore) => {
  stores.push(store);
  return store;
};

const readSaved = async () => JSON.parse(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8"));
const keys = (store: GameOverlayStore, setupId: string) => store.overlaysIn(setupId).map((overlay) => `${overlay.workspaceId}/${overlay.key}`);
const panelIds = (store: GameOverlayStore, setupId: string) => store.panelsIn(setupId).map((item) => item.instanceId);

describe("setups", () => {
  it("are Everywhere and All games from the start, each empty", async () => {
    const store = await loadStore(dir);
    expect(store.setupIds()).toEqual([EVERYWHERE, ALL_GAMES]);
    expect(store.empty).toBe(true);
    expect(store.moved).toBe(false);
    expect(store.migrated).toBe(false);
  });

  it("add an overlay with the usual settings once, and keep it across a restart", async () => {
    const store = await loadStore(dir);
    expect(store.add("poe2", subject())).toBe("added");
    expect(store.add("poe2", subject())).toBe("exists");
    expect(store.find(subject(), "poe2")).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    store.update(subject(), { mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.5, 0.25, 0.1, 0.1) }, "poe2");
    store.markExclusiveHintShown();
    await store.save();

    const again = await loadStore(dir);
    expect(again.setupIds()).toEqual([EVERYWHERE, ALL_GAMES, "poe2"]);
    expect(again.find(subject(), "poe2")).toEqual({ ...subject(), mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.5, 0.25, 0.1, 0.1) });
    expect(again.exclusiveHintShown).toBe(true);
  });

  it("hold at most LIMITS.maxGameOverlays items each, panels counted with overlays", async () => {
    const store = await loadStore(dir);
    for (let i = 0; i < LIMITS.maxGameOverlays - 1; i++) expect(store.add("poe2", subject(`item-${i}`))).toBe("added");
    expect(store.addPanel("poe2", panel())).toBe("added");
    expect(store.add("poe2", subject("one-more"))).toBe("full");
    expect(store.addPanel("poe2", panel(ID2))).toBe("full");
    // Existing ones still answer "exists", not "full"; another setup has room of its own.
    expect(store.add("poe2", subject("item-0"))).toBe("exists");
    expect(store.add("elden", subject("item-0", "elden"))).toBe("added");
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) expect(store.add(EVERYWHERE, subject(`e-${i}`, "personal"))).toBe("added");
    expect(store.add(EVERYWHERE, subject("e-more", "personal"))).toBe("full");
  });

  it("take a personal workspace's items into any setup, a game workspace's only into its game's", async () => {
    const store = await loadStore(dir);
    for (const setup of [EVERYWHERE, ALL_GAMES]) expect(store.add(setup, subject("notes", "personal"))).toBe("added");
    // A new game setup already has it, copied from All games.
    for (const setup of ["poe2", "elden"]) expect(store.add(setup, subject("notes", "personal"))).toBe("exists");
    expect(store.add(EVERYWHERE, subject("own", "poe2"))).toBe("refused");
    expect(store.add(ALL_GAMES, subject("own", "poe2"))).toBe("refused");
    expect(store.add("elden", subject("own", "poe2"))).toBe("refused");
    expect(store.addPanel(ALL_GAMES, panel(ID, "poe2"))).toBe("refused");
    expect(store.addPanel("poe2", panel(ID, "poe2"))).toBe("added");
    expect(store.setupsWith({ kind: "overlay", subject: subject("notes", "personal") })).toEqual([EVERYWHERE, ALL_GAMES, "poe2", "elden"]);
  });

  it("make a game's setup when something lands there, starting with copies of All games so nothing stops showing", async () => {
    const store = await loadStore(dir);
    store.add(ALL_GAMES, subject("timer", "personal"));
    store.update(subject("timer", "personal"), { opacity: 50, rect: at(0.4, 0.4, 0.2, 0.1) }, ALL_GAMES);
    store.addPanel(ALL_GAMES, panel(ID, "personal"));
    expect(store.add("poe2", subject("deaths"))).toBe("added");
    expect(keys(store, "poe2")).toEqual(["personal/timer", "poe2/deaths"]);
    expect(panelIds(store, "poe2")).toEqual([ID]);
    // A copy: changing it in one setup leaves the other.
    expect(store.find(subject("timer", "personal"), "poe2")).toMatchObject({ opacity: 50, rect: at(0.4, 0.4, 0.2, 0.1) });
    store.update(subject("timer", "personal"), { opacity: 25 }, "poe2");
    expect(store.find(subject("timer", "personal"), ALL_GAMES)!.opacity).toBe(50);
    // A full All games still leaves room for what the setup was made for.
    for (let i = 0; i < LIMITS.maxGameOverlays - 2; i++) store.add(ALL_GAMES, subject(`g-${i}`, "personal"));
    expect(store.count(ALL_GAMES)).toBe(LIMITS.maxGameOverlays);
    expect(store.addPanel("elden", panel(ID2, "elden"))).toBe("added");
    expect(store.count("elden")).toBe(LIMITS.maxGameOverlays);
    expect(panelIds(store, "elden")).toContain(ID2);
    expect(store.addSetup("elden")).toBe(false);
    expect(store.addSetup(EVERYWHERE)).toBe(false);
  });

  it("move a personal item between Everywhere and All games with its place and settings", async () => {
    const store = await loadStore(dir);
    store.addPanel(EVERYWHERE, panel(ID, "personal"));
    store.setRect(EVERYWHERE, { kind: "panel", instanceId: ID }, at(0.1, 0.1, 0.3, 0.3));
    store.updatePanelView(ID, { mode: "toggle", opacity: 25 }, EVERYWHERE);
    expect(store.moveItem({ kind: "panel", instanceId: ID }, EVERYWHERE, ALL_GAMES)).toBe("added");
    expect(panelIds(store, EVERYWHERE)).toEqual([]);
    expect(store.panelOf(ID, ALL_GAMES)).toMatchObject({ mode: "toggle", opacity: 25, rect: at(0.1, 0.1, 0.3, 0.3) });
    store.add(ALL_GAMES, subject("clock", "personal"));
    expect(store.moveItem({ kind: "overlay", subject: subject("clock", "personal") }, ALL_GAMES, EVERYWHERE)).toBe("added");
    expect(keys(store, ALL_GAMES)).toEqual([]);
    expect(keys(store, EVERYWHERE)).toEqual(["personal/clock"]);
  });

  it("move nothing that is missing, may not go there, or has no room, and let the one already there be", async () => {
    const store = await loadStore(dir);
    const ref = { kind: "panel" as const, instanceId: ID };
    expect(store.moveItem(ref, EVERYWHERE, ALL_GAMES)).toBe("missing");
    store.addPanel("poe2", panel(ID, "poe2"));
    // A game workspace's panel stays in its game's setup.
    expect(store.moveItem(ref, "poe2", ALL_GAMES)).toBe("refused");
    expect(store.moveItem(ref, "poe2", "poe2")).toBe("refused");
    expect(panelIds(store, "poe2")).toEqual([ID]);
    store.addPanel(EVERYWHERE, panel(ID2, "personal"));
    for (let i = 0; i < LIMITS.maxGameOverlays; i++) store.add(ALL_GAMES, subject(`g-${i}`, "personal"));
    expect(store.moveItem({ kind: "panel", instanceId: ID2 }, EVERYWHERE, ALL_GAMES)).toBe("full");
    expect(panelIds(store, EVERYWHERE)).toEqual([ID2]);
  });

  it("let an item that is in both setups already keep the other one's place", async () => {
    const store = await loadStore(dir);
    store.add(EVERYWHERE, subject("twice", "personal"));
    store.add(ALL_GAMES, subject("twice", "personal"));
    store.update(subject("twice", "personal"), { opacity: 50 }, ALL_GAMES);
    expect(store.moveItem({ kind: "overlay", subject: subject("twice", "personal") }, EVERYWHERE, ALL_GAMES)).toBe("exists");
    expect(keys(store, EVERYWHERE)).toEqual([]);
    expect(store.find(subject("twice", "personal"), ALL_GAMES)!.opacity).toBe(50);
  });

  it("keep their own place and settings for one panel in several setups", async () => {
    const store = await loadStore(dir);
    store.addPanel(EVERYWHERE, panel(ID, "personal"));
    store.addPanel(ALL_GAMES, panel(ID, "personal"));
    expect(store.setRect(EVERYWHERE, { kind: "panel", instanceId: ID }, at(0.1, 0.1, 0.3, 0.3))).toBe(true);
    expect(store.updatePanelView(ID, { mode: "toggle" }, ALL_GAMES)).toBe(true);
    expect(store.panelOf(ID, EVERYWHERE)).toMatchObject({ rect: at(0.1, 0.1, 0.3, 0.3), mode: "always" });
    expect(store.panelOf(ID, ALL_GAMES)).toMatchObject({ mode: "toggle" });
    expect(store.panelOf(ID, ALL_GAMES)!.rect).not.toEqual(at(0.1, 0.1, 0.3, 0.3));
    // Without a setup, a change goes to every setup that has it.
    store.updatePanelView(ID, { opacity: 25 });
    expect([store.panelOf(ID, EVERYWHERE)!.opacity, store.panelOf(ID, ALL_GAMES)!.opacity]).toEqual([25, 25]);
    expect(store.updatePanelView(ID, { mode: "toggle" }, "poe2")).toBe(false);
    await store.save();
    const again = await loadStore(dir);
    expect(again.panelOf(ID, EVERYWHERE)).toMatchObject({ rect: at(0.1, 0.1, 0.3, 0.3), mode: "always", opacity: 25 });
    expect(again.panelOf(ID, ALL_GAMES)).toMatchObject({ mode: "toggle", opacity: 25 });
  });

  it("forget items in one setup or in all, and a game's setup goes as a whole", async () => {
    const store = await loadStore(dir);
    store.add(ALL_GAMES, subject("a", "personal"));
    store.add("poe2", subject("b"));
    expect(keys(store, "poe2")).toEqual(["personal/a", "poe2/b"]);
    expect(store.forget((overlay, setup) => setup === "poe2" && overlay.key === "a")).toBe(true);
    expect(keys(store, ALL_GAMES)).toEqual(["personal/a"]);
    expect(store.forget((overlay) => overlay.key === "a")).toBe(true);
    expect(store.forget((overlay) => overlay.key === "a")).toBe(false);
    expect(store.all().map((overlay) => overlay.key)).toEqual(["b"]);
    expect(store.removeSetup("poe2")).toBe(true);
    expect(store.removeSetup("poe2")).toBe(false);
    expect(store.removeSetup(ALL_GAMES)).toBe(false);
    expect(store.setupIds()).toEqual([EVERYWHERE, ALL_GAMES]);
  });

  it("start a second item of a setup below the first, so it doesn't hide it", async () => {
    const store = await loadStore(dir);
    store.add("poe2", subject("a"));
    store.add("poe2", subject("b"));
    expect(store.find(subject("b"))!.rect.y).toBeGreaterThan(store.find(subject("a"))!.rect.y);
  });

  it("ignore values they don't take when changing an item", async () => {
    const store = await loadStore(dir);
    store.add("poe2", subject());
    store.update(subject(), { opacity: 33 as never, mode: "sideways" as never, rect: { ...at(0, 0, 1, 1), x: Number.NaN } });
    expect(store.find(subject())).toMatchObject({ opacity: 100, mode: "always", rect: DEFAULT_RECT });
    expect(store.update(subject("missing"), { mode: "toggle" })).toBe(false);
  });

  it("reset one position in one setup, for an overlay or a panel", async () => {
    const store = await loadStore(dir);
    store.add("poe2", subject("a"));
    store.addPanel("poe2", panel());
    expect(store.setRect("poe2", { kind: "overlay", subject: subject("a") }, DEFAULT_RECT)).toBe(true);
    expect(store.find(subject("a"))!.rect).toEqual(DEFAULT_RECT);
    expect(store.setRect("poe2", { kind: "panel", instanceId: ID }, at(0.2, 0.2, 0.3, 0.3))).toBe(true);
    expect(store.panelOf(ID)!.rect).toEqual(at(0.2, 0.2, 0.3, 0.3));
    expect(store.setRect("poe2", { kind: "overlay", subject: subject("missing") }, DEFAULT_RECT)).toBe(false);
    expect(store.setRect("elden", { kind: "panel", instanceId: ID }, DEFAULT_RECT)).toBe(false);
    expect(store.setRect("poe2", { kind: "overlay", subject: subject("a") }, { ...DEFAULT_RECT, width: Number.NaN })).toBe(false);
  });

  it("are written whole as version 5, so a crash leaves the old file or the new one", async () => {
    const store = await loadStore(dir);
    store.add("poe2", subject());
    store.addPanel(ALL_GAMES, panel(ID, "personal"));
    await store.save();
    const saved = await readSaved();
    expect(saved.version).toBe(FILE_VERSION);
    expect(saved).not.toHaveProperty("overlays");
    expect(saved.setups.map((setup: { id: string }) => setup.id)).toEqual([EVERYWHERE, ALL_GAMES, "poe2"]);
    expect(saved.setups[2].overlays[0]).toMatchObject({ key: "item-1", anchor: DEFAULT_RECT });
    expect(saved.setups[2].overlays[0]).not.toHaveProperty("rect");
    expect(saved.setups[1].panels[0]).toMatchObject({ instanceId: ID, workspaceId: "personal" });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("read a version 5 file carefully: Everywhere and All games always, a setup once, items they can't use skipped, eight at most", async () => {
    const overlay = (key: string, workspaceId = "poe2") => ({ ...subject(key, workspaceId), mode: "toggle", opacity: 75, hideFromCapture: true, anchor: at(0.1, 0.1, 0.2, 0.2) });
    await writeFile(
      path.join(dir, GAME_OVERLAYS_FILE),
      JSON.stringify({
        version: 5,
        setups: [
          { id: "poe2", overlays: [overlay("a"), overlay("a"), { ...overlay("bad key!") }, { ...overlay("no-place"), anchor: null }, "nonsense"], panels: [{ ...panel(), anchor: at(0, 0, 0.3, 0.3) }, { ...panel("not-an-id"), anchor: at(0, 0, 0.3, 0.3) }] },
          { id: "poe2", overlays: [overlay("second")], panels: [] },
          { id: ALL_GAMES, overlays: Array.from({ length: 10 }, (_, i) => overlay(`g-${i}`, "personal")), panels: [] },
          { id: "", overlays: [overlay("x")], panels: [] },
          null,
        ],
      }),
    );
    const store = await loadStore(dir);
    expect(store.moved).toBe(false);
    expect(store.setupIds()).toEqual([EVERYWHERE, ALL_GAMES, "poe2"]);
    expect(keys(store, "poe2")).toEqual(["poe2/a"]);
    expect(store.find(subject("a"))).toMatchObject({ mode: "toggle", opacity: 75, hideFromCapture: true, rect: at(0.1, 0.1, 0.2, 0.2) });
    expect(panelIds(store, "poe2")).toEqual([ID]);
    expect(store.count(ALL_GAMES)).toBe(LIMITS.maxGameOverlays);
  });

  it("set a bad file aside and start empty", async () => {
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), "{ not json");
    expect((await loadStore(dir)).empty).toBe(true);
    expect((await readdir(dir)).some((name) => name.startsWith(GAME_OVERLAYS_FILE) && name !== GAME_OVERLAYS_FILE)).toBe(true);
  });

  it("set a file of a newer version aside, start empty, and never write over it", async () => {
    const future = JSON.stringify({ version: FILE_VERSION + 1, setups: [{ id: ALL_GAMES, overlays: [{ ...subject(), anchor: DEFAULT_RECT }] }], somethingNew: true });
    await writeFile(path.join(dir, GAME_OVERLAYS_FILE), future);
    const store = await loadStore(dir);
    expect(store.empty).toBe(true);
    expect([store.migrated, store.moved]).toEqual([false, false]);
    const aside = (await readdir(dir)).filter((name) => name.startsWith(`${GAME_OVERLAYS_FILE}.corrupt-`));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(dir, aside[0]!), "utf8")).toBe(future);
    store.add("poe2", subject("n"));
    await store.save();
    expect((await readSaved()).version).toBe(FILE_VERSION);
    expect(await readFile(path.join(dir, aside[0]!), "utf8")).toBe(future);
  });

  it("keep the grid and the window size last seen for each game", async () => {
    const store = await loadStore(dir);
    expect(store.grid).toBe("normal");
    expect(store.seenSize("poe2")).toBeUndefined();
    store.setGrid("fine");
    store.setGrid("huge" as never);
    expect(store.setSeen("poe2", { width: 2560.4, height: 1440 })).toBe(true);
    expect(store.setSeen("poe2", { width: 2560, height: 1440 })).toBe(false);
    expect(store.setSeen("poe2", { width: 20, height: 20 })).toBe(false);
    expect(store.setSeen("poe2", { width: Number.NaN, height: 1080 })).toBe(false);
    await store.save();
    const again = await loadStore(dir);
    expect(again.grid).toBe("fine");
    expect(again.seenSize("poe2")).toEqual({ width: 2560, height: 1440 });
    again.forgetSeen("poe2");
    expect(again.seenSize("poe2")).toBeUndefined();
  });
});

// ── The move to setups ─────────────────────────────────────────────────

const anchor = at(0.05, 0.05, 0.2, 0.1);
const fractions = { x: 0.05, y: 0.05, width: 0.2, height: 0.1 };
const moved = at(0.6, 0.5, 0.2, 0.1);
const NOTES = "aaaaaaaa-0000-4000-8000-000000000001";
const PLANNER = "aaaaaaaa-0000-4000-8000-000000000002";
const MAP = "aaaaaaaa-0000-4000-8000-000000000003";

/** What Tavora 0.21.43 (the workspace names, before setups) wrote, field for field. */
const VERSION_4 = {
  version: 4,
  exclusiveHintShown: true,
  layout: {
    grid: "fine",
    window: { bounds: { x: 100, y: 80, width: 1200, height: 800 }, maximized: false },
    seen: { "elden-ring": { width: 2560, height: 1440 }, satisfactory: { width: 1920, height: 1080 } },
    // Elden Ring had its own place for the general timer; Satisfactory was customized as a whole.
    games: {
      "elden-ring": { detached: false, positions: { [`official\ntavora.clock-counter\npersonal\ntimer`]: moved } },
      satisfactory: { detached: true, positions: { [`official\ntavora.clock-counter\npersonal\ntimer`]: moved, [`panel\n${PLANNER}`]: moved } },
    },
  },
  overlays: [
    { owner: "official", moduleId: "tavora.clock-counter", workspaceId: "elden-ring", key: "deaths", scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: fractions, anchor },
    { owner: "official", moduleId: "tavora.clock-counter", workspaceId: "personal", key: "timer", scope: "all", mode: "toggle", opacity: 75, hideFromCapture: true, rect: fractions, anchor },
    { owner: "official", moduleId: "tavora.clock-counter", workspaceId: "satisfactory", key: "power", scope: "game", mode: "always", opacity: 50, hideFromCapture: false, rect: fractions, anchor },
  ],
  panels: [
    { owner: "official", moduleId: "tavora.todos", workspaceId: "personal", scope: "all", instanceId: PLANNER, rect: fractions, anchor, mode: "always", opacity: 100, hideFromCapture: false },
    { owner: "official", moduleId: "tavora.notes", workspaceId: "elden-ring", scope: "game", instanceId: NOTES, rect: fractions, anchor, mode: "toggle", opacity: 25, hideFromCapture: true },
    { owner: "wellbrained", moduleId: "wellbrained.satisfactory-planner", workspaceId: "satisfactory", scope: "game", instanceId: MAP, rect: fractions, mode: "always", opacity: 100, hideFromCapture: false },
  ],
};

const MOVED_SCOPES = (id: string): OverlayScope => (id === "personal" ? "all" : "game");

describe("the move to setups", () => {
  const writeOld = (body: unknown) => writeFile(path.join(dir, GAME_OVERLAYS_FILE), JSON.stringify(body));
  const backup = () => readFile(path.join(dir, "backups", BEFORE_SETUPS_DIR, GAME_OVERLAYS_FILE), "utf8");

  it("puts general items in All games, a game's own in its new setup with copies of the general ones, and keeps everything else", async () => {
    await writeOld(VERSION_4);
    const store = await loadStore(dir, MOVED_SCOPES);
    expect(store.moved).toBe(true);
    expect(store.migrated).toBe(false);
    expect(store.setupIds()).toEqual([EVERYWHERE, ALL_GAMES, "elden-ring", "satisfactory"]);
    // Nothing starts showing anywhere new.
    expect(store.count(EVERYWHERE)).toBe(0);
    expect(keys(store, ALL_GAMES)).toEqual(["personal/timer"]);
    expect(panelIds(store, ALL_GAMES)).toEqual([PLANNER]);
    expect(keys(store, "elden-ring")).toEqual(["elden-ring/deaths", "personal/timer"]);
    expect(panelIds(store, "elden-ring")).toEqual([NOTES, PLANNER]);
    expect(keys(store, "satisfactory")).toEqual(["satisfactory/power", "personal/timer"]);
    expect(panelIds(store, "satisfactory")).toEqual([MAP, PLANNER]);
    // Settings come along; customized per-game places of the general ones don't: the copies take the All games place.
    expect(store.find(subject("timer", "personal"), "elden-ring")).toEqual({ ...subject("timer", "personal"), mode: "toggle", opacity: 75, hideFromCapture: true, rect: anchor });
    expect(store.panelOf(PLANNER, "satisfactory")!.rect).toEqual(anchor);
    expect(store.panelOf(NOTES, "elden-ring")).toMatchObject({ mode: "toggle", opacity: 25, hideFromCapture: true, rect: anchor });
    // A position never converted stays the fractions of the window.
    expect(store.panelOf(MAP, "satisfactory")!.legacy).toEqual(fractions);
    expect(store.exclusiveHintShown).toBe(true);
    expect(store.grid).toBe("fine");
    expect(store.seenSize("elden-ring")).toEqual({ width: 2560, height: 1440 });
  });

  it("copies the old file to backups first, and writes the move only when asked (at start)", async () => {
    await writeOld(VERSION_4);
    const original = await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8");
    const store = await loadStore(dir, MOVED_SCOPES);
    expect(await backup()).toBe(original);
    // Loading alone leaves the file as it was.
    expect(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8")).toBe(original);
    await store.save();
    const saved = await readSaved();
    expect(saved.version).toBe(FILE_VERSION);
    expect(saved).not.toHaveProperty("overlays");
    expect(saved).not.toHaveProperty("panels");
    expect(saved.layout).not.toHaveProperty("games");
    expect(saved.setups[3].panels[0]).toMatchObject({ instanceId: MAP, rect: fractions });
    expect(saved.setups[3].panels[0]).not.toHaveProperty("anchor");
  });

  it("does the same move again after a start that stopped before writing, and none once written", async () => {
    await writeOld(VERSION_4);
    const first = await loadStore(dir, MOVED_SCOPES);
    // Tavora stopped here: nothing written. The next start finds the same file and moves it the same way.
    const second = await loadStore(dir, MOVED_SCOPES);
    expect(second.moved).toBe(true);
    for (const id of first.setupIds()) {
      expect(keys(second, id)).toEqual(keys(first, id));
      expect(panelIds(second, id)).toEqual(panelIds(first, id));
    }
    // One copy in backups, not one per start.
    expect(await readdir(path.join(dir, "backups", BEFORE_SETUPS_DIR))).toEqual([GAME_OVERLAYS_FILE]);
    await second.save();
    const third = await loadStore(dir, MOVED_SCOPES);
    expect(third.moved).toBe(false);
    for (const id of first.setupIds()) expect(keys(third, id)).toEqual(keys(first, id));
    expect(await readdir(path.join(dir, "backups", BEFORE_SETUPS_DIR))).toEqual([GAME_OVERLAYS_FILE]);
  });

  it("never writes over the old file when it can't be backed up", async () => {
    await writeOld(VERSION_4);
    const original = await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8");
    // A file where the backups folder should be: no copy can be made.
    await writeFile(path.join(dir, "backups"), "in the way");
    // The failed backup is reported to the log on purpose; keep it out of the test output.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = own(await GameOverlayStore.load(dir, MOVED_SCOPES));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("backing up game overlays"), expect.anything());
    logged.mockRestore();
    expect(store.moved).toBe(true);
    expect(keys(store, ALL_GAMES)).toEqual(["personal/timer"]);
    store.add("elden-ring", subject("new", "elden-ring"));
    await store.save();
    expect(await readFile(path.join(dir, GAME_OVERLAYS_FILE), "utf8")).toBe(original);
  });

  it("gives a game's setup its own first, then general ones while there is room", async () => {
    const overlay = (key: string, workspaceId: string, scope: OverlayScope) => ({ ...subject(key, workspaceId), scope, mode: "always", opacity: 100, hideFromCapture: false, rect: fractions, anchor });
    await writeOld({
      version: 4,
      overlays: [...Array.from({ length: 6 }, (_, i) => overlay(`own-${i}`, "poe2", "game")), ...Array.from({ length: 5 }, (_, i) => overlay(`g-${i}`, "personal", "all"))],
      panels: [],
    });
    const store = await loadStore(dir, MOVED_SCOPES);
    expect(store.count(ALL_GAMES)).toBe(5);
    expect(keys(store, "poe2")).toEqual([...Array.from({ length: 6 }, (_, i) => `poe2/own-${i}`), "personal/g-0", "personal/g-1"]);
  });

  it("moves a file of Tavora before the workspace names (version 3) the same way", async () => {
    await writeOld({
      version: 3,
      layout: { seen: { "elden-ring": { width: 2560, height: 1440 } }, games: {} },
      overlays: [
        { ...oldSubject("deaths", "elden-ring"), scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: fractions, anchor },
        { ...oldSubject("timer", "personal"), scope: "all", mode: "toggle", opacity: 75, hideFromCapture: true, rect: fractions, anchor },
      ],
      panels: [{ ...oldPanel(PLANNER, "personal"), scope: "all", rect: fractions, anchor, mode: "always", opacity: 100, hideFromCapture: false }],
    });
    const store = await loadStore(dir, MOVED_SCOPES);
    expect(keys(store, ALL_GAMES)).toEqual(["personal/timer"]);
    expect(keys(store, "elden-ring")).toEqual(["elden-ring/deaths", "personal/timer"]);
    expect(panelIds(store, "elden-ring")).toEqual([PLANNER]);
  });

  it("moves a file of version 1, with its scope from the workspace's kind and without its old panel- keys", async () => {
    const old = { mode: "always", opacity: 100, hideFromCapture: false, rect: fractions };
    await writeOld({ version: 1, overlays: [{ ...oldSubject("c", "personal"), ...old }, { ...oldSubject("d", "poe2"), ...old }, { ...oldSubject(`panel-${ID}`, "poe2"), ...old }], panels: [] });
    const store = await loadStore(dir, MOVED_SCOPES);
    expect([store.migrated, store.moved]).toEqual([true, true]);
    expect(keys(store, ALL_GAMES)).toEqual(["personal/c"]);
    expect(keys(store, "poe2")).toEqual(["poe2/d", "personal/c"]);
  });

  it("skips what an old file has that can't be used", async () => {
    const good = { ...oldSubject(), scope: "game", mode: "toggle", opacity: 75, hideFromCapture: false, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } };
    await writeOld({
      version: 2,
      overlays: [good, good, { ...good, key: "bad key!" }, { ...good, key: "no-rect", rect: null }, { ...good, key: "odd", mode: "sideways", opacity: 33, hideFromCapture: "yes", showOnStream: true }, "nonsense", null],
      panels: [{ ...oldPanel(), rect: fractions }, { ...oldPanel("not-an-id"), rect: fractions }, { ...oldPanel(ID2), rect: null }, "nonsense"],
    });
    const store = await loadStore(dir, MOVED_SCOPES);
    expect(keys(store, "poe2")).toEqual(["poe2/item-1", "poe2/odd"]);
    expect(store.find(subject("odd"))).toMatchObject({ mode: "always", opacity: 100, hideFromCapture: false });
    expect(store.find(subject("odd"))).not.toHaveProperty("showOnStream");
    expect(panelIds(store, "poe2")).toEqual([ID]);
  });

  it("keeps a version 2 file's fractions, and converts them per setup on the game's first real window", async () => {
    const legacy = { x: 0.7, y: 0.6, width: 0.25, height: 0.3 };
    const old = { mode: "always", opacity: 100, hideFromCapture: false, rect: legacy };
    await writeOld({ version: 2, overlays: [{ ...oldSubject("a"), scope: "game", ...old }, { ...oldSubject("g", "personal"), scope: "all", ...old }], panels: [{ ...oldPanel(ID3, "personal"), scope: "all", ...old }] });
    const store = await loadStore(dir, MOVED_SCOPES);
    const wide = { x: 0, y: 0, width: 3440, height: 1440 };
    const item = store.find(subject("a"), "poe2")!;
    expect(item.legacy).toEqual(legacy);
    expect(placeItem(item, wide)).toEqual(placeLegacy(legacy, wide));
    // A launcher's or splash screen's window is no size to go by.
    expect(store.convertLegacy("poe2", { width: 639, height: 480 })).toBe(false);
    expect(store.convertLegacy("poe2", wide)).toBe(true);
    for (const converted of [store.find(subject("a"), "poe2")!, store.find(subject("g", "personal"), "poe2")!, store.panelOf(ID3, "poe2")!]) {
      expect(converted.legacy).toBeUndefined();
      expect(placeAnchored(converted.rect, wide)).toEqual(placeLegacy(legacy, wide));
    }
    // It was anchored to its nearest corner, so it stays in it on a wider window.
    expect(store.find(subject("a"), "poe2")!.rect).toMatchObject({ h: "right", v: "bottom" });
    // All games' copies wait for a game that shows them; a second look changes nothing.
    expect(store.find(subject("g", "personal"), ALL_GAMES)!.legacy).toEqual(legacy);
    expect(store.convertLegacy("poe2", wide)).toBe(false);
    const full = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(store.convertLegacy("elden", full)).toBe(true);
    expect(placeItem(store.find(subject("g", "personal"), ALL_GAMES)!, full)).toEqual(placeLegacy(legacy, full));
  });

  it("converts on any real window size, to the pixel (a few shapes, and a window that is not at the screen's corner)", async () => {
    // One game per size and one item per shape in a single old file: one load and one save, not one of each per case.
    const shapes = [{ x: 0.7, y: 0.6, width: 0.25, height: 0.3 }, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, { x: 0.001, y: 0.9, width: 0.05, height: 0.02 }];
    const sizes = [[1920, 1080], [2560, 1440], [3440, 1440], [1280, 1024], [1366, 768], [5120, 1440], [800, 600]] as const;
    const old = (key: string, gameId: string, rect: unknown) => ({ ...oldSubject(key, gameId), scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect });
    await writeOld({ version: 2, overlays: sizes.flatMap((_, size) => shapes.map((rel, index) => old(`a${index}`, `game-${size}`, rel))), panels: [] });
    const store = await loadStore(dir, MOVED_SCOPES);
    sizes.forEach(([width, height], size) => {
      store.convertLegacy(`game-${size}`, { width, height });
      const game = { x: 120, y: 40, width, height };
      shapes.forEach((rel, index) => {
        expect(placeItem(store.find(subject(`a${index}`, `game-${size}`))!, game), `${width}x${height}`).toEqual(placeLegacy(normalizeLegacy(rel)!, game));
      });
    });
    // Its save lands before the folder goes.
    await store.save();
  });
});

// ── Rules ──────────────────────────────────────────────────────────────

describe("which setup shows", () => {
  const has = (id: string) => id === "poe2";

  it("is Everywhere, plus the game's own setup or else All games, never both", () => {
    expect(setupsOnScreen("poe2", false, has)).toEqual([EVERYWHERE, "poe2"]);
    expect(setupsOnScreen("elden", false, has)).toEqual([EVERYWHERE, ALL_GAMES]);
    expect(setupsOnScreen(null, false, has)).toEqual([EVERYWHERE]);
    expect(gameSetupFor("poe2", has)).toBe("poe2");
    expect(gameSetupFor("elden", has)).toBe(ALL_GAMES);
  });

  it("leaves Everywhere out while Tavora's own window is in front", () => {
    expect(setupsOnScreen(null, true, has)).toEqual([]);
    expect(setupsOnScreen("poe2", true, has)).toEqual(["poe2"]);
  });

  it("knows a game's setup from Everywhere and All games", () => {
    expect([isGameSetup("poe2"), isGameSetup(EVERYWHERE), isGameSetup(ALL_GAMES)]).toEqual([true, false, false]);
  });
});

describe("what may go where", () => {
  it("lets a personal workspace's items into any setup, a game workspace's into its own game's only", () => {
    for (const setup of [EVERYWHERE, ALL_GAMES, "poe2"]) expect(allowedIn(setup, "personal", "all")).toBe(true);
    expect(allowedIn("poe2", "poe2", "game")).toBe(true);
    expect(allowedIn("elden", "poe2", "game")).toBe(false);
    expect(allowedIn(ALL_GAMES, "poe2", "game")).toBe(false);
    expect(allowedIn(EVERYWHERE, "poe2", "game")).toBe(false);
  });

  it("lands a module overlay or a panel shown in game in its game's setup, or All games from a personal workspace", () => {
    expect(landingSetup("poe2", "game")).toBe("poe2");
    expect(landingSetup("personal", "all")).toBe(ALL_GAMES);
  });

  it("calls anything made outside a game general", () => {
    expect(scopeForKind("game")).toBe("game");
    expect(scopeForKind("personal")).toBe("all");
    expect(scopeForKind(undefined)).toBe("all");
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

  it("shows an Always overlay while its setup is on screen", () => {
    expect(visible({})).toBe(true);
  });

  it("hides everything when the switch is off or its setup isn't on screen, whatever else is set", () => {
    expect(visible({ enabled: false })).toBe(false);
    expect(visible({ gameInFront: false })).toBe(false);
    expect(visible({ gameInFront: false, toggledOn: true, layerOpen: true })).toBe(false);
    expect(visible({ enabled: false, layerOpen: true })).toBe(false);
  });

  it("shows a Toggle overlay only after its key switched it on", () => {
    expect(visible({ mode: "toggle" })).toBe(false);
    expect(visible({ mode: "toggle", toggledOn: true })).toBe(true);
  });

  it("shows every item on screen while the layer is open, so each can be placed", () => {
    expect(visible({ mode: "toggle", layerOpen: true })).toBe(true);
  });
});

describe("the game in front", () => {
  const isGame = (id: string) => id !== "personal";

  it("is the game that has a setup among the ones the front program belongs to", () => {
    expect(gameInFront(new Set(["a", "b"]), new Set(["b", "c"]), false, isGame)).toBe("b");
    expect(gameInFront(new Set(["a"]), new Set(["b"]), false, isGame)).toBeNull();
    expect(gameInFront(new Set(), new Set(["b"]), true, isGame)).toBeNull();
  });

  it("is any library game when All games has something, preferring one with its own setup", () => {
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
  it("take the keyboard and the user's clicks only while the layer is open", () => {
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
  it("shows when the panel is in a setup, or its module has an overlay that shows", () => {
    expect(isLive(true, 0)).toBe(true);
    expect(isLive(false, 2)).toBe(true);
    expect(isLive(false, 0)).toBe(false);
  });
});

describe("copying a setup to a game", () => {
  const always = () => true;

  /** Elden Ring's setup: its own overlay, a personal overlay and panel, and a panel of its own. */
  async function elden() {
    const store = await loadStore(dir);
    store.add("elden", subject("own", "elden"));
    store.add("elden", subject("clock", "personal"));
    store.update(subject("clock", "personal"), { mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.4, 0.3, 0.2, 0.1) }, "elden");
    store.addPanel("elden", panel(ID, "personal"));
    store.addPanel("elden", panel(ID2, "elden"));
    return store;
  }

  it("keeps place, mode, opacity and hide from capture of what can show in the game, and says what stayed behind", async () => {
    const store = await elden();
    const outcome = store.copySetup("elden", "valheim", "replace", always)!;
    expect(outcome).toEqual({ copied: 2, skipped: [{ reason: "game-only", workspaceId: "elden" }, { reason: "game-only", workspaceId: "elden" }], removed: { overlays: [], panels: [] } });
    expect(keys(store, "valheim")).toEqual(["personal/clock"]);
    expect(panelIds(store, "valheim")).toEqual([ID]);
    expect(store.find(subject("clock", "personal"), "valheim")).toEqual(store.find(subject("clock", "personal"), "elden"));
    expect(store.find(subject("clock", "personal"), "valheim")).toMatchObject({ mode: "toggle", opacity: 50, hideFromCapture: true, rect: at(0.4, 0.3, 0.2, 0.1) });
    // The source stays as it was, and the copy is its own: a change in one leaves the other.
    expect(keys(store, "elden")).toEqual(["elden/own", "personal/clock"]);
    store.update(subject("clock", "personal"), { opacity: 25 }, "valheim");
    expect(store.find(subject("clock", "personal"), "elden")!.opacity).toBe(50);
  });

  it("copies from Everywhere and All games too, and a game workspace's own items back into its game", async () => {
    const store = await loadStore(dir);
    store.add(ALL_GAMES, subject("timer", "personal"));
    store.add(EVERYWHERE, subject("note", "personal"));
    expect(store.copySetup(ALL_GAMES, "elden", "replace", always)!.copied).toBe(1);
    expect(store.copySetup(EVERYWHERE, "elden", "add", always)!.copied).toBe(1);
    expect(keys(store, "elden")).toEqual(["personal/timer", "personal/note"]);
    // poe2's setup starts with a copy of All games' timer, which Elden Ring has already; its own overlay can't go to Elden Ring.
    store.add("poe2", subject("own", "poe2"));
    expect(store.copySetup("poe2", "elden", "add", always)!.skipped).toEqual([{ reason: "game-only", workspaceId: "poe2" }, { reason: "exists", workspaceId: "personal" }]);
    expect(keys(store, "elden")).toEqual(["personal/timer", "personal/note"]);
  });

  it("replaces what the game had, and lists what it took out", async () => {
    const store = await elden();
    store.add("poe2", subject("old", "poe2"));
    store.add("poe2", subject("clock", "personal"));
    store.addPanel("poe2", panel(ID3, "personal"));
    const outcome = store.copySetup("elden", "poe2", "replace", always)!;
    expect(keys(store, "poe2")).toEqual(["personal/clock"]);
    expect(panelIds(store, "poe2")).toEqual([ID]);
    expect(outcome.removed.overlays.map((overlay) => overlay.key)).toEqual(["old", "clock"]);
    expect(outcome.removed.panels.map((item) => item.instanceId)).toEqual([ID3]);
    // The place and settings are Elden Ring's now, not what poe2 had for the same item.
    expect(store.find(subject("clock", "personal"), "poe2")).toMatchObject({ mode: "toggle", opacity: 50 });
  });

  it("adds after what the game has and keeps its own for an item both have", async () => {
    const store = await elden();
    store.add("poe2", subject("old", "poe2"));
    store.add("poe2", subject("clock", "personal"));
    store.update(subject("clock", "personal"), { opacity: 75 }, "poe2");
    const outcome = store.copySetup("elden", "poe2", "add", always)!;
    expect(outcome.copied).toBe(1);
    expect(outcome.skipped).toEqual([
      { reason: "game-only", workspaceId: "elden" },
      { reason: "game-only", workspaceId: "elden" },
      { reason: "exists", workspaceId: "personal" },
    ]);
    expect(keys(store, "poe2")).toEqual(["poe2/old", "personal/clock"]);
    expect(store.find(subject("clock", "personal"), "poe2")!.opacity).toBe(75);
    expect(panelIds(store, "poe2")).toEqual([ID]);
    expect(outcome.removed).toEqual({ overlays: [], panels: [] });
  });

  it("stops at the limit and says how many did not fit", async () => {
    const store = await loadStore(dir);
    // The game's setup is made first, so it doesn't start with copies of All games' items.
    for (let i = 0; i < LIMITS.maxGameOverlays - 1; i++) store.add("poe2", subject(`p-${i}`, "poe2"));
    for (let i = 0; i < 3; i++) store.add(ALL_GAMES, subject(`g-${i}`, "personal"));
    const outcome = store.copySetup(ALL_GAMES, "poe2", "add", always)!;
    expect(outcome.copied).toBe(1);
    expect(outcome.skipped.map((item) => item.reason)).toEqual(["full", "full"]);
    expect(store.count("poe2")).toBe(LIMITS.maxGameOverlays);
  });

  it("leaves out a panel whose type can't show over a game, and never empties a game for a copy with nothing in it", async () => {
    const store = await elden();
    store.add("poe2", subject("old", "poe2"));
    const outcome = store.copySetup("elden", "poe2", "replace", (item) => !("instanceId" in item));
    expect(outcome!.copied).toBe(1);
    expect(panelIds(store, "poe2")).toEqual([]);
    expect(outcome!.skipped.filter((item) => item.reason === "not-in-game")).toHaveLength(1);

    const own = await loadStore(dir);
    own.add("elden", subject("own", "elden"));
    own.add("poe2", subject("old", "poe2"));
    expect(own.copySetup("elden", "poe2", "replace", always)).toEqual({ copied: 0, skipped: [{ reason: "game-only", workspaceId: "elden" }], removed: { overlays: [], panels: [] } });
    expect(keys(own, "poe2")).toEqual(["poe2/old"]);
  });

  it("makes a setup for a game without one only when something goes in, and not with All games' items", async () => {
    const store = await loadStore(dir);
    store.add("elden", subject("own", "elden"));
    store.add(ALL_GAMES, subject("timer", "personal"));
    expect(store.copySetup("elden", "valheim", "add", always)!.copied).toBe(0);
    expect(store.hasSetup("valheim")).toBe(false);
    store.add("elden", subject("shared", "personal"));
    expect(store.copySetup("elden", "valheim", "add", always)!.copied).toBe(1);
    expect(keys(store, "valheim")).toEqual(["personal/shared"]);
  });

  it("refuses what is not a game, is the same setup, or has nothing to copy from", async () => {
    const store = await elden();
    expect(store.copySetup("elden", ALL_GAMES, "replace", always)).toBeNull();
    expect(store.copySetup("elden", EVERYWHERE, "replace", always)).toBeNull();
    expect(store.copySetup("elden", "elden", "replace", always)).toBeNull();
    expect(store.copySetup("nowhere", "poe2", "replace", always)).toBeNull();
  });

  it("is kept across a restart", async () => {
    const store = await elden();
    store.copySetup("elden", "valheim", "replace", always);
    await store.save();
    const again = await loadStore(dir);
    expect(keys(again, "valheim")).toEqual(["personal/clock"]);
    expect(again.find(subject("clock", "personal"), "valheim")).toMatchObject({ mode: "toggle", opacity: 50, hideFromCapture: true });
  });
});
