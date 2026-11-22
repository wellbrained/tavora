import { describe, expect, it } from "vitest";
import { runningGames } from "./game-watch";
import { INSTANCE_ID } from "./ids";
import { addWorkspace, emptyLibrary, liveWorkspaces, markOpened } from "./library";
import { withGameInstanceId, withGamePlan, WithGameRunner, type LayoutPanel, type WithGameModule, type WithGameRun } from "./with-game";

/** A publisher id of the right shape (not a secret). */
const PUBLISHER = "a".repeat(32);
const KINGS: WithGameModule = { moduleId: "wellbrained.nine-kings", owner: PUBLISHER, panelType: "history" };
const KINGS_APP = 2784470;

/** The host's side, as a log of what it was told to do. */
function rig() {
  const log: string[] = [];
  const runner = new WithGameRunner({
    start: (run) => log.push(`start ${run.workspaceId} ${run.inLayout ? run.instanceId : "hidden"}`),
    stop: (run) => log.push(`stop ${run.workspaceId} ${run.inLayout ? run.instanceId : "hidden"}`),
    restart: (run) => log.push(`restart ${run.workspaceId} ${run.inLayout ? run.instanceId : "hidden"}`),
  });
  return { log, runner };
}

/** The plan for these running workspaces, with the game workspaces' layouts given by hand. */
function plan(running: string[], layouts: Record<string, LayoutPanel[]> = {}, modules = [KINGS], games = new Set(["kings", "kings-2"])): WithGameRun[] {
  return withGamePlan({ running, modules, fits: (_, workspaceId) => games.has(workspaceId), records: (workspaceId) => layouts[workspaceId] ?? [] });
}

describe("withGameInstanceId", () => {
  it("is the same every time, looks like a panel id, and is its own per workspace, module and publisher", () => {
    const id = withGameInstanceId("kings", KINGS.moduleId, PUBLISHER);
    expect(id).toMatch(INSTANCE_ID);
    expect(withGameInstanceId("kings", KINGS.moduleId, PUBLISHER)).toBe(id);
    expect(new Set([id, withGameInstanceId("kings-2", KINGS.moduleId, PUBLISHER), withGameInstanceId("kings", "wellbrained.other", PUBLISHER), withGameInstanceId("kings", KINGS.moduleId, "local")]).size).toBe(4);
  });
});

describe("withGamePlan", () => {
  it("runs the hidden panel in the game's workspace when its layout has none of that type", () => {
    expect(plan(["kings"])).toEqual([{ instanceId: withGameInstanceId("kings", KINGS.moduleId, PUBLISHER), workspaceId: "kings", moduleId: KINGS.moduleId, owner: PUBLISHER, panelType: "history", inLayout: false }]);
  });

  it("runs the layout's own panel of that type instead, never a second one", () => {
    const layouts = { kings: [{ instanceId: "other-type", moduleId: KINGS.moduleId, panelType: "stats" }, { instanceId: "placed", moduleId: KINGS.moduleId, panelType: "history" }] };
    expect(plan(["kings"], layouts)).toEqual([expect.objectContaining({ instanceId: "placed", inLayout: true })]);
  });

  it("runs nothing for a game without a workspace, or one the module isn't for", () => {
    expect(plan(["personal"])).toEqual([]);
    expect(plan(["kings"], {}, [KINGS], new Set())).toEqual([]);
    expect(plan(["kings"], {}, [])).toEqual([]);
  });

  it("runs in the workspace opened last when the game is in the library twice", () => {
    const library = emptyLibrary();
    const first = addWorkspace(library, { name: "9 Kings", steamAppId: KINGS_APP }, new Date("2026-11-01"));
    const second = addWorkspace(library, { name: "9 Kings (hardcore)", steamAppId: KINGS_APP }, new Date("2026-11-02"));
    markOpened(library, first, new Date("2026-11-20"));
    markOpened(library, second, new Date("2026-11-10"));
    const running = runningGames(liveWorkspaces(library), [], [], KINGS_APP);
    expect([...running]).toEqual([first]);
    expect(plan([...running], {}, [KINGS], new Set([first, second])).map((run) => run.workspaceId)).toEqual([first]);
  });
});

describe("WithGameRunner", () => {
  it("starts with the game, also when it ran already, and stops when it closes", () => {
    const { log, runner } = rig();
    runner.sync(new Set(["kings"]), plan(["kings"]));
    runner.sync(new Set(["kings"]), plan(["kings"]));
    expect(log).toEqual(["start kings hidden"]);
    expect(runner.all()).toHaveLength(1);
    runner.sync(new Set(), plan([]));
    expect(log).toEqual(["start kings hidden", "stop kings hidden"]);
    expect(runner.all()).toEqual([]);
  });

  it("hands over to a panel of that type added to the layout, and back when it is closed", () => {
    const { log, runner } = rig();
    const running = new Set(["kings"]);
    runner.sync(running, plan(["kings"]));
    runner.sync(running, plan(["kings"], { kings: [{ instanceId: "placed", moduleId: KINGS.moduleId, panelType: "history" }] }));
    runner.sync(running, plan(["kings"]));
    expect(log).toEqual(["start kings hidden", "stop kings hidden", "start kings placed", "stop kings placed", "start kings hidden"]);
  });

  it("stops a module no longer allowed, and runs one per game for several games", () => {
    const { log, runner } = rig();
    runner.sync(new Set(["kings", "kings-2"]), plan(["kings", "kings-2"]));
    expect(log).toEqual(["start kings hidden", "start kings-2 hidden"]);
    runner.sync(new Set(["kings", "kings-2"]), plan(["kings", "kings-2"], {}, []));
    expect(log.slice(2)).toEqual(["stop kings hidden", "stop kings-2 hidden"]);
  });

  it("starts a crashed page again once, leaves it off after a second crash, and runs it again at the next game start", () => {
    const { log, runner } = rig();
    const running = new Set(["kings"]);
    const [run] = plan(["kings"]);
    runner.sync(running, [run!]);
    runner.crashed(run!.instanceId);
    expect(log).toEqual(["start kings hidden", "restart kings hidden"]);
    runner.crashed(run!.instanceId);
    expect(log.slice(2)).toEqual(["stop kings hidden"]);
    expect(runner.isOff(run!.instanceId)).toBe(true);
    // Still the same game session: it stays off.
    runner.sync(running, [run!]);
    expect(log).toHaveLength(3);
    // The game closed and started again.
    runner.sync(new Set(), []);
    runner.sync(running, [run!]);
    expect(log.slice(3)).toEqual(["start kings hidden"]);
    runner.crashed(run!.instanceId);
    expect(log.slice(4)).toEqual(["restart kings hidden"]);
  });

  it("ignores a crash of a panel that doesn't run with its game", () => {
    const { log, runner } = rig();
    runner.crashed("someone-else");
    expect(log).toEqual([]);
  });

  it("stops everything at once", () => {
    const { log, runner } = rig();
    runner.sync(new Set(["kings"]), plan(["kings"]));
    runner.clear();
    expect(log).toEqual(["start kings hidden", "stop kings hidden"]);
    expect(runner.all()).toEqual([]);
  });
});
