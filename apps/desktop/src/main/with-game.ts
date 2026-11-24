// Panels that run hidden while their game runs (a panel type's `withGame`, owner-approved 2026-11-22): once the user
// allowed it, a module's panel keeps going while one of its games runs, so it can keep track of the game (watch its
// save folder, say) without being open. It runs in the game's workspace, from the moment the game watcher sees the
// game (also when it ran already as Tavora started) until it closes. A panel of that type in the workspace's layout
// is the one that runs; without one, a hidden panel that is never placed in the layout, with an id of its own that
// stays the same (withGameInstanceId), so what it saved per panel is there the next time. A page that crashes, or
// stays unresponsive (host.ts WITH_GAME_HUNG_MS), starts once more; a second time in the same game session leaves the
// module off for that game until it starts again, without a word. Tavora's own stops (clearing a module's storage,
// the user's Stop) are no crash.
//
// The plan is pure (withGamePlan); WithGameRunner keeps what runs and starts and stops it; WithGamePanels is the host's
// side of it (host.ts): the games running, the hidden panels' records and the watch on their pages' health.
import type { InstanceStatus } from "../shared/host-api";
import type { PanelViews } from "./panel-views";
import type { InstanceRecord } from "./workspace";
import { sha256Hex } from "./hash";

/** An installed module allowed to run its `withGame` panel type while its game runs. */
export interface WithGameModule {
  moduleId: string;
  /** Whose data it uses (its publisher's first key). */
  owner: string;
  /** Its `withGame` panel type. */
  panelType: string;
}

/** One panel running with its game. */
export interface WithGameRun {
  instanceId: string;
  /** The game's workspace. */
  workspaceId: string;
  moduleId: string;
  owner: string;
  panelType: string;
  /** A panel of the workspace's layout runs; false: the hidden one, never placed in the layout. */
  inLayout: boolean;
}

/** A panel of a workspace's layout, as far as the plan needs it. */
export interface LayoutPanel {
  instanceId: string;
  moduleId: string;
  panelType?: string;
}

/**
 * The id of a module's hidden panel in a game's workspace: the same every time (so the panel's own saved state is found
 * again), shaped like the random ids of other panels (ids.ts INSTANCE_ID), and its own for each publisher, so another
 * publisher's module under the same id reads none of it.
 */
export function withGameInstanceId(workspaceId: string, moduleId: string, owner: string): string {
  const hex = sha256Hex(`tavora.with-game\0${workspaceId}\0${moduleId}\0${owner}`);
  // A name-based UUID: version 5, RFC 4122 variant.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface WithGamePlanInput {
  /** The workspaces of the library games running now (game-watch.ts: one per game, the one opened last). */
  running: Iterable<string>;
  /** The modules allowed to run with their game. */
  modules: readonly WithGameModule[];
  /** Whether the module runs in this workspace: a live game workspace of one of the module's games. */
  fits(module: WithGameModule, workspaceId: string): boolean;
  /** The panels in a workspace's layout. */
  records(workspaceId: string): readonly LayoutPanel[];
}

/** What should run now: per running game's workspace, each fitting module's panel, the layout's own one first. */
export function withGamePlan({ running, modules, fits, records }: WithGamePlanInput): WithGameRun[] {
  const runs: WithGameRun[] = [];
  for (const workspaceId of running) {
    const layout = records(workspaceId);
    for (const module of modules) {
      if (!fits(module, workspaceId)) continue;
      const placed = layout.find((record) => record.moduleId === module.moduleId && record.panelType === module.panelType);
      runs.push({
        instanceId: placed?.instanceId ?? withGameInstanceId(workspaceId, module.moduleId, module.owner),
        workspaceId,
        moduleId: module.moduleId,
        owner: module.owner,
        panelType: module.panelType,
        inLayout: placed !== undefined,
      });
    }
  }
  return runs;
}

export interface WithGameRunnerDeps {
  /**
   * Starts the run's panel (hidden, kept running whatever workspace is shown). False when it couldn't start now (its
   * workspace or record is gone, the window is closing): it isn't counted as running, and the next sync tries again.
   */
  start(run: WithGameRun): boolean;
  /** Lets go of the run's panel (a panel of the shown workspace stays open). */
  stop(run: WithGameRun): void;
  /** The run's page crashed the first time this game session: it starts again. */
  restart(run: WithGameRun): void;
}

function sameRun(a: WithGameRun, b: WithGameRun): boolean {
  return a.instanceId === b.instanceId && a.workspaceId === b.workspaceId && a.moduleId === b.moduleId && a.owner === b.owner && a.panelType === b.panelType && a.inLayout === b.inLayout;
}

/**
 * Crashes count per game session and module (with its publisher), not per panel: a crashed layout panel that is closed
 * hands over to the hidden one, which starts with the count it left.
 */
function crashKey(run: Pick<WithGameRun, "workspaceId" | "moduleId" | "owner">): string {
  return `${run.workspaceId}\0${run.moduleId}\0${run.owner}`;
}

/** Keeps the panels that run with their game in step with the plan, and counts their crashes per game session. */
export class WithGameRunner {
  private readonly runs = new Map<string, WithGameRun>();
  /** Crashes this game session, by game workspace and module (crashKey), with the workspace whose game it is. */
  private readonly crashes = new Map<string, { workspaceId: string; count: number }>();

  constructor(private readonly deps: WithGameRunnerDeps) {}

  /**
   * `running`: the workspaces whose games run now; `plan`: what should run (withGamePlan). A game that closed ends its
   * session: its panels stop and their crashes are forgotten, so the next start runs them again.
   */
  sync(running: ReadonlySet<string>, plan: readonly WithGameRun[]): void {
    for (const [key, crash] of this.crashes) if (!running.has(crash.workspaceId)) this.crashes.delete(key);
    const wanted = new Map<string, WithGameRun>();
    for (const run of plan) if (running.has(run.workspaceId) && !this.isOff(run)) wanted.set(run.instanceId, run);
    for (const [instanceId, run] of [...this.runs]) {
      const next = wanted.get(instanceId);
      if (next && sameRun(run, next)) continue;
      this.runs.delete(instanceId);
      this.deps.stop(run);
    }
    for (const [instanceId, run] of wanted) {
      if (this.runs.has(instanceId)) continue;
      // Set first, so a sync the start sets off doesn't start it twice; taken out again when it didn't start.
      this.runs.set(instanceId, run);
      if (!this.deps.start(run) && this.runs.get(instanceId) === run) this.runs.delete(instanceId);
    }
  }

  /**
   * The page of a running panel crashed (or hung): it starts once more; a second time this game session leaves the
   * module off for that game.
   */
  crashed(instanceId: string): void {
    const run = this.runs.get(instanceId);
    if (!run) return;
    const key = crashKey(run);
    const count = (this.crashes.get(key)?.count ?? 0) + 1;
    this.crashes.set(key, { workspaceId: run.workspaceId, count });
    if (count === 1) return this.deps.restart(run);
    this.runs.delete(instanceId);
    this.deps.stop(run);
  }

  /** Left off after crashing twice, until its game starts again. */
  isOff(run: Pick<WithGameRun, "workspaceId" | "moduleId" | "owner">): boolean {
    return (this.crashes.get(crashKey(run))?.count ?? 0) >= 2;
  }

  /** Whether this panel runs with its game now. */
  has(instanceId: string): boolean {
    return this.runs.has(instanceId);
  }

  /** The panel running with its game in this workspace, by id; undefined when none does. */
  get(instanceId: string): WithGameRun | undefined {
    return this.runs.get(instanceId);
  }

  /** What runs now, in the order it started. */
  all(): WithGameRun[] {
    return [...this.runs.values()];
  }

  /** Stops everything and forgets the crashes (the window closes, host.ts). */
  clear(): void {
    for (const run of [...this.runs.values()]) {
      this.runs.delete(run.instanceId);
      this.deps.stop(run);
    }
    this.crashes.clear();
  }
}

// ── The host's side ─────────────────────────────────────────────────────

/** How long a page running only with its game may stay unresponsive before it counts as crashed. */
export const WITH_GAME_HUNG_MS = 10_000;

/** A panel's page, as far as WithGamePanels watches its health (module-view.ts ModuleView). */
export interface WithGamePage {
  readonly status: InstanceStatus;
  /** The page ended because Tavora stopped it (its storage was cleared, the user's Stop): no crash. */
  readonly stoppedByTavora: boolean;
  /** Ends the page (a hung one too); resolves once it is gone. */
  stop(): Promise<void>;
}

/** The panels as far as WithGamePanels needs them (panel-views.ts PanelViews). */
export type WithGamePanelViews = Pick<PanelViews, "keepRunning" | "stopKeeping" | "letGo" | "has" | "layOut" | "release" | "isLent">;

export interface WithGamePanelsDeps {
  /** Pages may start (the window is open and not closing). */
  ready(): boolean;
  /** A live (not trashed) game workspace of the library. */
  isGameWorkspace(workspaceId: string): boolean;
  /** The modules allowed to run with their game now. */
  modules(): WithGameModule[];
  /** Whether the module runs in this workspace: made for its game. */
  fits(module: WithGameModule, workspaceId: string): boolean;
  /** A workspace's layout. */
  records(workspaceId: string): readonly InstanceRecord[];
  /** The workspace shown now, if any. */
  shownWorkspaceId(): string | null;
  /** The panels (asked each time: the host makes them after this). */
  panels(): WithGamePanelViews;
  /** Starts a panel's page in that workspace (host.ts createView); it may not start (panels.has stays false). */
  createView(record: InstanceRecord, workspaceId: string): void;
  /**
   * Tavora is busy with that module's pages in that workspace (clearing its storage, host.ts purgeModuleStorage): a
   * stop or hang meanwhile is no crash, and nothing starts again until it is done (the purge starts them itself).
   */
  held(moduleId: string, workspaceId: string): boolean;
  /** Runs a crash's restart after the page's event is over (setImmediate in the host; tests run it at once). */
  later?(run: () => void): void;
  /** Timers, for tests. */
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

/**
 * The host's panels running with their game (host.ts): which games run, the hidden panels' records, the runner, and
 * the watch on their pages' health. Synced on the game watcher's report (whatever "When a game starts" says), a grant
 * change, a module reload and every state push.
 */
export class WithGamePanels {
  /** The library games running now as the watcher last said, whatever "When a game starts" says. */
  private gamesNow: ReadonlySet<string> = new Set();
  /** The hidden panels, by id: never placed in a layout, made again each run. */
  private readonly hidden = new Map<string, InstanceRecord>();
  /** Pages that went unresponsive while running only with their game, with the timer that ends them. */
  private readonly hung = new Map<string, unknown>();
  private readonly runner: WithGameRunner;

  constructor(private readonly deps: WithGamePanelsDeps) {
    this.runner = new WithGameRunner({
      start: (run) => this.start(run),
      stop: (run) => this.stop(run),
      restart: (run) => {
        this.deps.panels().release(run.instanceId);
        this.start(run);
      },
    });
  }

  /** The game watcher's report: the workspaces of the library games running now. */
  gamesRunning(running: Iterable<string>): void {
    this.gamesNow = new Set(running);
    this.sync();
  }

  /** Starts and stops the panels to match what runs and what is allowed now. */
  sync(): void {
    if (!this.deps.ready()) return;
    const running = new Set([...this.gamesNow].filter((id) => this.deps.isGameWorkspace(id)));
    // No game runs: nothing to plan, but the runner still ends the game sessions (and forgets their crashes).
    if (running.size === 0) return this.runner.sync(running, []);
    const plan = withGamePlan({ running, modules: this.deps.modules(), fits: (module, workspaceId) => this.deps.fits(module, workspaceId), records: (workspaceId) => this.deps.records(workspaceId) });
    this.runner.sync(running, plan);
  }

  /** Whether some module may run with its game, so the game watcher has to look. */
  wanted(): boolean {
    return this.deps.modules().length > 0;
  }

  /** The hidden panel running with its game (never placed in a layout). */
  isHidden(instanceId: string): boolean {
    return this.hidden.has(instanceId);
  }

  /** The panel runs now only with its game, out of sight: the hidden one, or one of a workspace not shown (not over the game). */
  runsOnlyWithGame(instanceId: string, workspaceId: string): boolean {
    if (this.hidden.has(instanceId)) return true;
    return this.runner.has(instanceId) && this.deps.shownWorkspaceId() !== workspaceId && !this.deps.panels().isLent(instanceId);
  }

  /** What runs now. */
  all(): WithGameRun[] {
    return this.runner.all();
  }

  /**
   * A panel's page changed how it is doing (ModuleView onStatus). Running only with its game, a crash starts it once
   * more, and so does a page unresponsive for WITH_GAME_HUNG_MS (it is ended first); Tavora's own stops and anything
   * while the module's pages are held are no crash.
   */
  status(instanceId: string, workspaceId: string, moduleId: string, page: WithGamePage, status: InstanceStatus): void {
    if (status !== "unresponsive") this.unwatch(instanceId);
    if (!this.runner.has(instanceId) || !this.runsOnlyWithGame(instanceId, workspaceId) || this.deps.held(moduleId, workspaceId)) return;
    if (status === "crashed" && !page.stoppedByTavora) (this.deps.later ?? setImmediate)(() => this.runner.crashed(instanceId));
    if (status !== "unresponsive" || this.hung.has(instanceId)) return;
    const timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.hung.delete(instanceId);
      if (page.status !== "unresponsive" || !this.runner.has(instanceId) || !this.runsOnlyWithGame(instanceId, workspaceId) || this.deps.held(moduleId, workspaceId)) return;
      // Ended first (Tavora's own stop, so it isn't counted twice), then counted as its crash.
      void page.stop().then(() => this.runner.crashed(instanceId));
    }, WITH_GAME_HUNG_MS);
    this.hung.set(instanceId, timer);
  }

  /** Stops everything and forgets the crashes (the window closes). */
  clear(): void {
    this.runner.clear();
    for (const instanceId of [...this.hung.keys()]) this.unwatch(instanceId);
    this.gamesNow = new Set();
  }

  private unwatch(instanceId: string): void {
    if (!this.hung.has(instanceId)) return;
    (this.deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.hung.get(instanceId));
    this.hung.delete(instanceId);
  }

  /** The record a run's panel goes by: the layout's own, or the hidden one (made once per run). */
  private record(run: WithGameRun): InstanceRecord | undefined {
    if (run.inLayout) return this.deps.records(run.workspaceId).find((record) => record.instanceId === run.instanceId);
    let record = this.hidden.get(run.instanceId);
    if (!record) {
      record = { instanceId: run.instanceId, moduleId: run.moduleId, panelType: run.panelType, owner: run.owner };
      this.hidden.set(run.instanceId, record);
    }
    return record;
  }

  /** Starts a run's panel, hidden and kept running whatever workspace is shown. A panel open already just stays. */
  private start(run: WithGameRun): boolean {
    const panels = this.deps.panels();
    if (!this.deps.ready() || !this.deps.isGameWorkspace(run.workspaceId)) return this.forget(run);
    const record = this.record(run);
    if (!record) return this.forget(run);
    panels.keepRunning(run.instanceId, "game");
    if (!panels.has(run.instanceId)) this.deps.createView(record, run.workspaceId);
    // Its page didn't start (its type is gone, its module asks first): not running; the next sync tries again.
    if (!panels.has(run.instanceId)) return this.forget(run);
    // Never placed: laid out here so it runs (a kept panel isn't paused for being out of sight).
    panels.layOut(run.instanceId);
    return true;
  }

  /** Undoes a start that couldn't happen. */
  private forget(run: WithGameRun): false {
    this.deps.panels().stopKeeping(run.instanceId, "game");
    if (!run.inLayout) this.hidden.delete(run.instanceId);
    return false;
  }

  /** Lets go of a run's panel: the hidden one goes; one of the layout stays while its workspace shows, it is over the game or the overlays keep it. */
  private stop(run: WithGameRun): void {
    this.unwatch(run.instanceId);
    this.deps.panels().letGo(run.instanceId, "game");
    if (!run.inLayout) this.hidden.delete(run.instanceId);
  }
}
