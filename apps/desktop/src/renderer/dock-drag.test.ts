import { describe, expect, it } from "vitest";
import { dockDragStep, type DockDrag, type DockDragEvent, type DockDragStep } from "./dock-drag";
import type { Dragged, DropPlan, DropTarget } from "./dock-model";

// The steps of one drag over the dock. The scene stands for what dock-preview.ts reads of the dock's DOM.
type Scene = { id: string };
const SCENE: Scene = { id: "the dock as it was" };
const DRAGGED: Dragged = { groupId: "g1", panelId: "notes" };
const OK: DropPlan = { ok: true, layout: {} as never, rects: {}, group: "g2", landing: { x: 0, y: 0, width: 10, height: 10 }, tabIndex: 0, newGroup: false };
const SAME: DropPlan = { ok: false, reason: "same-spot" };
const INTO_G2: DropTarget = { kind: "tab", group: "g2" };
const BESIDE_G2: DropTarget = { kind: "split", group: "g2", side: "right" };

/** Runs the events from idle and answers with the drag after each, what each dropped, and how often it planned. */
function run(events: DockDragEvent<Scene>[]) {
  let drag: DockDrag<Scene> = { phase: "idle" };
  const phases: string[] = [];
  const drops: unknown[] = [];
  for (const event of events) {
    const step: DockDragStep<Scene> = dockDragStep(drag, event);
    drag = step.drag;
    phases.push(drag.phase);
    if (step.drop) drops.push(step.drop);
  }
  return { drag, phases, drops };
}

let planned = 0;
const aim = (target: DropTarget | null, plan: DropPlan = OK): DockDragEvent<Scene> => ({
  type: "aim",
  target,
  plan: () => {
    planned++;
    return plan;
  },
});
const start: DockDragEvent<Scene> = { type: "start", dragged: DRAGGED, scene: SCENE };

describe("a drag over the dock", () => {
  it("starts on its first drag event, lifted and aimed at no place; later drag events don't start it again", () => {
    const first = dockDragStep<Scene>({ phase: "idle" }, start);
    expect(first).toEqual({ drag: { phase: "lifted", dragged: DRAGGED, scene: SCENE }, changed: true, drop: null });
    const again = dockDragStep(first.drag, { type: "start", dragged: { groupId: "other", panelId: null }, scene: { id: "read again" } });
    expect(again).toEqual({ drag: first.drag, changed: false, drop: null });
  });

  it("aims at a place with its plan; the same place again is no change and isn't planned again", () => {
    planned = 0;
    const { drag, phases } = run([start, aim(INTO_G2), aim(INTO_G2), aim({ ...INTO_G2 })]);
    expect(drag).toEqual({ phase: "aiming", dragged: DRAGGED, scene: SCENE, target: INTO_G2, plan: OK });
    expect(phases).toEqual(["lifted", "aiming", "aiming", "aiming"]);
    expect(planned).toBe(1);
    expect(dockDragStep(drag, aim(INTO_G2)).changed).toBe(false);
    // Another place is planned anew; no place (a gap, a sash, outside the dock) is lifted again.
    expect(dockDragStep(drag, aim(BESIDE_G2, SAME))).toMatchObject({ drag: { phase: "aiming", target: BESIDE_G2, plan: SAME }, changed: true });
    expect(dockDragStep(drag, aim(null))).toEqual({ drag: { phase: "lifted", dragged: DRAGGED, scene: SCENE }, changed: true, drop: null });
  });

  it("drops where it aims when the plan allows it, and ends", () => {
    const { drag, phases, drops } = run([start, aim(BESIDE_G2), aim(INTO_G2), { type: "drop" }]);
    expect(drag).toEqual({ phase: "idle" });
    expect(phases).toEqual(["lifted", "aiming", "aiming", "idle"]);
    expect(drops).toEqual([{ dragged: DRAGGED, target: INTO_G2, plan: OK }]);
  });

  it("drops nothing on a refused place, or on no place, and still ends", () => {
    expect(run([start, aim(INTO_G2, { ok: false, reason: "too-small" }), { type: "drop" }])).toMatchObject({ drag: { phase: "idle" }, drops: [] });
    expect(run([start, aim(INTO_G2, SAME), { type: "drop" }])).toMatchObject({ drag: { phase: "idle" }, drops: [] });
    expect(run([start, aim(INTO_G2), aim(null), { type: "drop" }])).toMatchObject({ drag: { phase: "idle" }, drops: [] });
  });

  it("cancelled with Escape: dragend without a drop ends it, nothing dropped", () => {
    const { drag, phases, drops } = run([start, aim(INTO_G2), { type: "end" }]);
    expect(drag).toEqual({ phase: "idle" });
    expect(phases).toEqual(["lifted", "aiming", "idle"]);
    expect(drops).toEqual([]);
  });

  it("let go outside the window: the pointer left the dock (no place), then dragend ends it, nothing dropped", () => {
    const { drag, phases, drops } = run([start, aim(INTO_G2), aim(null), { type: "end" }]);
    expect(drag).toEqual({ phase: "idle" });
    expect(phases).toEqual(["lifted", "aiming", "lifted", "idle"]);
    expect(drops).toEqual([]);
    // Straight from aiming too: the window may not see the pointer leave.
    expect(run([start, aim(INTO_G2), { type: "end" }]).drops).toEqual([]);
  });

  it("does nothing while nothing is dragged: aiming, dropping and dragend from elsewhere", () => {
    const idle: DockDrag<Scene> = { phase: "idle" };
    for (const event of [aim(INTO_G2), { type: "drop" } as const, { type: "end" } as const]) expect(dockDragStep(idle, event)).toEqual({ drag: idle, changed: false, drop: null });
  });

  it("a drop or dragend after the drag ended (dockview's drop, then its dragend) changes nothing", () => {
    const ended = run([start, aim(INTO_G2), { type: "drop" }]).drag;
    expect(dockDragStep(ended, { type: "end" })).toEqual({ drag: ended, changed: false, drop: null });
    expect(dockDragStep(ended, { type: "drop" }).drop).toBeNull();
  });
});
