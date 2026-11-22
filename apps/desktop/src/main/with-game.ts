// Panels that run hidden while their game runs (a panel type's `withGame`, owner-approved 2026-11-22): once the user
// allowed it, a module's panel keeps going while one of its games runs, so it can keep track of the game (watch its
// save folder, say) without being open. It runs in the game's workspace, from the moment the game watcher sees the
// game (also when it ran already as Tavora started) until it closes. A panel of that type in the workspace's layout
// is the one that runs; without one, a hidden panel that is never placed in the layout, with an id of its own that
// stays the same (withGameInstanceId), so what it saved per panel is there the next time. A page that crashes starts
// once more; a second crash in the same game session leaves it off until the game starts again, without a word.
//
// The plan is pure (withGamePlan); WithGameRunner keeps what runs and starts and stops it through the host.
import { createHash } from "node:crypto";

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
  const hex = createHash("sha256").update(`tavora.with-game\0${workspaceId}\0${moduleId}\0${owner}`).digest("hex");
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
  /** Starts the run's panel (hidden, kept running whatever workspace is shown). */
  start(run: WithGameRun): void;
  /** Lets go of the run's panel (a panel of the shown workspace stays open). */
  stop(run: WithGameRun): void;
  /** The run's page crashed the first time this game session: it starts again. */
  restart(run: WithGameRun): void;
}

function sameRun(a: WithGameRun, b: WithGameRun): boolean {
  return a.instanceId === b.instanceId && a.workspaceId === b.workspaceId && a.moduleId === b.moduleId && a.owner === b.owner && a.panelType === b.panelType && a.inLayout === b.inLayout;
}

/** Keeps the panels that run with their game in step with the plan, and counts their crashes per game session. */
export class WithGameRunner {
  private readonly runs = new Map<string, WithGameRun>();
  /** Crashes this game session, by panel, with the workspace whose game it is. */
  private readonly crashes = new Map<string, { workspaceId: string; count: number }>();

  constructor(private readonly deps: WithGameRunnerDeps) {}

  /**
   * `running`: the workspaces whose games run now; `plan`: what should run (withGamePlan). A game that closed ends its
   * session: its panels stop and their crashes are forgotten, so the next start runs them again.
   */
  sync(running: ReadonlySet<string>, plan: readonly WithGameRun[]): void {
    for (const [instanceId, crash] of this.crashes) if (!running.has(crash.workspaceId)) this.crashes.delete(instanceId);
    const wanted = new Map<string, WithGameRun>();
    for (const run of plan) if (running.has(run.workspaceId) && !this.isOff(run.instanceId)) wanted.set(run.instanceId, run);
    for (const [instanceId, run] of [...this.runs]) {
      const next = wanted.get(instanceId);
      if (next && sameRun(run, next)) continue;
      this.runs.delete(instanceId);
      this.deps.stop(run);
    }
    for (const [instanceId, run] of wanted) {
      if (this.runs.has(instanceId)) continue;
      this.runs.set(instanceId, run);
      this.deps.start(run);
    }
  }

  /** The page of a running panel crashed: it starts once more; a second crash this game session leaves it off. */
  crashed(instanceId: string): void {
    const run = this.runs.get(instanceId);
    if (!run) return;
    const count = (this.crashes.get(instanceId)?.count ?? 0) + 1;
    this.crashes.set(instanceId, { workspaceId: run.workspaceId, count });
    if (count === 1) return this.deps.restart(run);
    this.runs.delete(instanceId);
    this.deps.stop(run);
  }

  /** Left off after crashing twice, until its game starts again. */
  isOff(instanceId: string): boolean {
    return (this.crashes.get(instanceId)?.count ?? 0) >= 2;
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

  /** Stops everything (the window closes). */
  clear(): void {
    for (const run of [...this.runs.values()]) {
      this.runs.delete(run.instanceId);
      this.deps.stop(run);
    }
    this.crashes.clear();
  }
}
