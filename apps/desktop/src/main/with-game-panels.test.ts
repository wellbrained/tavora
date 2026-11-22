// The host's side of panels running with their game (with-game.ts WithGamePanels, wired in host.ts): when they start,
// that there is never more than one per game and module, and what counts as a crash. The panels and pages are fakes
// that keep a log; timers are vitest's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceStatus } from "../shared/host-api";
import { WITH_GAME_HUNG_MS, withGameInstanceId, WithGamePanels, type WithGameModule, type WithGamePage, type WithGamePanelViews } from "./with-game";
import type { InstanceRecord } from "./workspace";

/** A publisher id of the right shape (not a secret). */
const PUBLISHER = "b".repeat(32);
const KINGS: WithGameModule = { moduleId: "wellbrained.nine-kings", owner: PUBLISHER, panelType: "history" };
const HIDDEN = withGameInstanceId("kings", KINGS.moduleId, PUBLISHER);

/** A page whose status the test sets, and whose stop the host may call. */
function page(): WithGamePage & { status: InstanceStatus; stoppedByTavora: boolean; stops: number } {
  const made = {
    status: "ready" as InstanceStatus,
    stoppedByTavora: false,
    stops: 0,
    stop: async () => {
      made.stops++;
      made.stoppedByTavora = true;
      made.status = "crashed";
    },
  };
  return made;
}

function rig() {
  const log: string[] = [];
  const open = new Set<string>();
  const kept = new Map<string, Set<string>>();
  const pages = new Map<string, ReturnType<typeof page>>();
  const layouts: Record<string, InstanceRecord[]> = {};
  const world = { ready: true, shown: null as string | null, held: false, modules: [KINGS] };
  const panels: WithGamePanelViews = {
    keepRunning: (id, why = "overlay") => void (kept.get(id) ?? kept.set(id, new Set()).get(id)!).add(why),
    stopKeeping: (id, why = "overlay") => void kept.get(id)?.delete(why),
    // As Panel views does (its own tests check it): the view goes once nothing keeps it and its workspace isn't shown.
    letGo: (id, why = "overlay") => {
      kept.get(id)?.delete(why);
      const shownHere = world.shown !== null && (layouts[world.shown] ?? []).some((record) => record.instanceId === id);
      if (!shownHere && (kept.get(id)?.size ?? 0) === 0) panels.release(id);
    },
    has: (id) => open.has(id),
    release: (id) => {
      open.delete(id);
      log.push(`release ${id === HIDDEN ? "hidden" : id}`);
    },
    layOut: (id) => void log.push(`lay out ${id === HIDDEN ? "hidden" : id}`),
    isLent: () => false,
  };
  const withGame = new WithGamePanels({
    ready: () => world.ready,
    isGameWorkspace: (id) => id === "kings" || id === "kings-2",
    modules: () => world.modules,
    fits: (_, id) => id === "kings" || id === "kings-2",
    records: (id) => layouts[id] ?? [],
    shownWorkspaceId: () => world.shown,
    panels: () => panels,
    createView: (record) => {
      open.add(record.instanceId);
      pages.set(record.instanceId, page());
      log.push(`create ${record.instanceId === HIDDEN ? "hidden" : record.instanceId}`);
    },
    held: () => world.held,
    moduleName: (id) => (id === KINGS.moduleId ? "9 Kings Companion" : null),
    changed: () => undefined,
    later: (run) => run(),
  });
  /** The page reports how it is doing, as ModuleView's onStatus does. */
  const report = (id: string, status: InstanceStatus, workspaceId = "kings") => {
    const view = pages.get(id)!;
    view.status = status;
    withGame.status(id, workspaceId, KINGS.moduleId, view, status);
  };
  return { log, open, pages, layouts, world, withGame, report };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("WithGamePanels", () => {
  it("starts for a game that ran already when Tavora started, once its pages may start", () => {
    const { log, world, withGame } = rig();
    world.ready = false;
    // The watcher's first report comes in before the window is up.
    withGame.gamesRunning(["kings"]);
    expect(log).toEqual([]);
    world.ready = true;
    // The next state push syncs.
    withGame.sync();
    expect(log).toEqual(["create hidden", "lay out hidden"]);
    expect(withGame.all()).toHaveLength(1);
    expect(withGame.runsOnlyWithGame(HIDDEN, "kings")).toBe(true);
  });

  it("hands over to a panel of that type added to the layout while the game runs: never two", () => {
    const { log, open, layouts, world, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    // The user opens the game's workspace and adds the panel there.
    world.shown = "kings";
    layouts.kings = [{ instanceId: "placed", moduleId: KINGS.moduleId, panelType: "history" }];
    open.add("placed");
    withGame.sync();
    expect(log).toEqual(["create hidden", "lay out hidden", "release hidden", "lay out placed"]);
    expect([...open]).toEqual(["placed"]);
    expect(withGame.all().map((run) => run.instanceId)).toEqual(["placed"]);
    // In sight it is the user's panel: it may ask for things again.
    expect(withGame.runsOnlyWithGame("placed", "kings")).toBe(false);
    world.shown = "personal";
    expect(withGame.runsOnlyWithGame("placed", "kings")).toBe(true);
    // Removed from the layout: the hidden one runs again.
    layouts.kings = [];
    withGame.sync();
    expect(log.slice(4)).toEqual(["release placed", "create hidden", "lay out hidden"]);
  });

  it("doesn't count a panel that couldn't start, and tries again at the next sync", () => {
    const { log, withGame, world } = rig();
    world.ready = true;
    const unstarted = new WithGamePanels({
      ready: () => true,
      isGameWorkspace: () => true,
      modules: () => world.modules,
      fits: () => true,
      records: () => [],
      shownWorkspaceId: () => null,
      panels: () => ({ keepRunning: () => undefined, stopKeeping: () => undefined, letGo: () => undefined, has: () => false, layOut: () => undefined, release: () => undefined, isLent: () => false }),
      createView: () => void log.push("create"),
      held: () => false,
      moduleName: () => null,
      changed: () => undefined,
    });
    unstarted.gamesRunning(["kings"]);
    unstarted.sync();
    expect(log).toEqual(["create", "create"]);
    expect(unstarted.all()).toEqual([]);
    expect(withGame.all()).toEqual([]);
  });

  it("starts a crashed page once more, and leaves the module off for that game after a second crash", () => {
    const { log, report, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    report(HIDDEN, "crashed");
    expect(log.slice(2)).toEqual(["release hidden", "create hidden", "lay out hidden"]);
    report(HIDDEN, "crashed");
    expect(log.slice(5)).toEqual(["release hidden"]);
    expect(withGame.all()).toEqual([]);
    // The game closes and starts again: it runs again.
    withGame.gamesRunning([]);
    withGame.gamesRunning(["kings"]);
    expect(withGame.all()).toHaveLength(1);
  });

  it("doesn't count Tavora's own stop, or anything while the module's storage is cleared, as a crash", () => {
    const { log, pages, report, world, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    // Clearing its storage: the page is stopped (Tavora's own), and nothing starts it meanwhile.
    world.held = true;
    void pages.get(HIDDEN)!.stop();
    report(HIDDEN, "crashed");
    report(HIDDEN, "unresponsive");
    vi.advanceTimersByTime(WITH_GAME_HUNG_MS * 2);
    world.held = false;
    withGame.sync();
    expect(log).toEqual(["create hidden", "lay out hidden"]);
    // Still running: the purge loads the page again itself.
    expect(withGame.all()).toHaveLength(1);
    // A stop of Tavora's own after it is no crash either.
    report(HIDDEN, "ready");
    pages.get(HIDDEN)!.stoppedByTavora = true;
    report(HIDDEN, "crashed");
    expect(log).toHaveLength(2);
    // Two real crashes after that still start it once.
    pages.get(HIDDEN)!.stoppedByTavora = false;
    report(HIDDEN, "crashed");
    expect(log.slice(2)).toEqual(["release hidden", "create hidden", "lay out hidden"]);
  });

  it("treats a page unresponsive for a while as crashed: ended, started once more", async () => {
    const { log, pages, report, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    const hung = pages.get(HIDDEN)!;
    report(HIDDEN, "unresponsive");
    await vi.advanceTimersByTimeAsync(WITH_GAME_HUNG_MS - 1);
    expect(hung.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.stops).toBe(1);
    expect(log.slice(2)).toEqual(["release hidden", "create hidden", "lay out hidden"]);
    // A second hang this game session leaves it off.
    report(HIDDEN, "unresponsive");
    await vi.advanceTimersByTimeAsync(WITH_GAME_HUNG_MS);
    expect(log.slice(5)).toEqual(["release hidden"]);
    expect(withGame.all()).toEqual([]);
  });

  it("doesn't end a page that answers again in time", async () => {
    const { log, pages, report, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    report(HIDDEN, "unresponsive");
    await vi.advanceTimersByTimeAsync(WITH_GAME_HUNG_MS / 2);
    report(HIDDEN, "ready");
    await vi.advanceTimersByTimeAsync(WITH_GAME_HUNG_MS);
    expect(pages.get(HIDDEN)!.stops).toBe(0);
    expect(log).toEqual(["create hidden", "lay out hidden"]);
  });

  it("leaves a crash of a panel in sight to the user", () => {
    const { log, layouts, open, pages, report, world, withGame } = rig();
    world.shown = "kings";
    layouts.kings = [{ instanceId: "placed", moduleId: KINGS.moduleId, panelType: "history" }];
    open.add("placed");
    pages.set("placed", page());
    withGame.gamesRunning(["kings"]);
    const before = log.length;
    // The panel shows in the open workspace: it says it crashed there, with Reload; nothing starts it by itself.
    report("placed", "crashed");
    expect(log.slice(before)).toEqual([]);
  });

  it("names the modules running with each game for the rail, whatever game start says and whichever workspace shows", () => {
    const { world, withGame } = rig();
    // Nothing about "When a game starts" reaches it: the watcher reports the games either way.
    world.shown = "kings";
    withGame.gamesRunning(["kings", "kings-2"]);
    expect(withGame.lines()).toEqual([
      { workspaceId: "kings", names: ["9 Kings Companion"] },
      { workspaceId: "kings-2", names: ["9 Kings Companion"] },
    ]);
    withGame.gamesRunning([]);
    expect(withGame.lines()).toEqual([]);
  });

  it("stops everything when the window closes", () => {
    const { log, withGame } = rig();
    withGame.gamesRunning(["kings"]);
    withGame.clear();
    expect(log.at(-1)).toBe("release hidden");
    expect(withGame.all()).toEqual([]);
  });
});
