import type { SerializedDockview } from "dockview-vue";
import { describe, expect, it } from "vitest";
import { aimDrag, dropDrag, NO_DRAG, startDrag, type DragSession, type Planner } from "./dock-drag";
import { hidesViews, nextGesture, NO_GESTURE, type DockGesture, type GestureEvent } from "./dock-gesture";
import type { DropPlan, DropTarget } from "./dock-model";

const LAYOUT = { grid: { root: { type: "branch", data: [], size: 600 }, width: 1200, height: 600, orientation: "HORIZONTAL" }, panels: {} } as unknown as SerializedDockview;
const DRAGGED = { groupId: "g1", panelId: "a" };
const OK = { ok: true, layout: LAYOUT, rects: {}, landing: { x: 0, y: 0, width: 1, height: 1 }, group: "g2", newGroup: false } as unknown as DropPlan;
const REFUSED: DropPlan = { ok: false, reason: "too-small" };

/** Plans every target but the one called "tight", which is too small; counts how often it is asked. */
function planner(): Planner & { calls: number } {
  const plan = ((_layout, _dragged, target) => {
    plan.calls++;
    return target.kind === "tab" && target.group === "tight" ? REFUSED : OK;
  }) as Planner & { calls: number };
  plan.calls = 0;
  return plan;
}

const tab = (group: string, index?: number): DropTarget => ({ kind: "tab", group, ...(index === undefined ? {} : { index }) });

describe("the drop preview's drag", () => {
  it("starts aiming at nothing, with what was measured kept for that drag", () => {
    const session = startDrag(DRAGGED, LAYOUT, { box: "dock" });
    expect(session).toEqual({ phase: "aiming", dragged: DRAGGED, layout: LAYOUT, measured: { box: "dock" }, target: null, plan: null });
  });

  it("plans the target under the pointer, once per target", () => {
    const plan = planner();
    let session: DragSession<null> = startDrag(DRAGGED, LAYOUT, null);
    session = aimDrag(session, tab("g2", 0), plan);
    expect(session).toMatchObject({ phase: "aiming", target: tab("g2", 0), plan: OK });
    // The same spot again: the same session, not planned again (no redraw).
    expect(aimDrag(session, tab("g2", 0), plan)).toBe(session);
    session = aimDrag(session, { kind: "split", group: "g2", side: "left" }, plan);
    expect(session).toMatchObject({ target: { kind: "split", group: "g2", side: "left" }, plan: OK });
    expect(plan.calls).toBe(2);
  });

  it("drops on a target that takes it, and on nothing else", () => {
    const plan = planner();
    const over = aimDrag(startDrag(DRAGGED, LAYOUT, null), tab("g2"), plan);
    expect(dropDrag(over)).toEqual({ dragged: DRAGGED, target: tab("g2"), plan: OK });
    // A refused target, or a gap with no target: nothing is dropped.
    expect(dropDrag(aimDrag(over, tab("tight"), plan))).toBeNull();
    expect(dropDrag(aimDrag(over, null, plan))).toBeNull();
    expect(dropDrag(NO_DRAG)).toBeNull();
  });

  it("drops nothing when the drag ends outside the window: leaving the dock clears the target first", () => {
    const plan = planner();
    let session: DragSession<null> = aimDrag(startDrag(DRAGGED, LAYOUT, null), tab("g2"), plan);
    // dragover outside the dock's box aims at nothing.
    session = aimDrag(session, null, plan);
    expect(session).toMatchObject({ phase: "aiming", target: null, plan: null });
    expect(dropDrag(session)).toBeNull();
  });

  it("does nothing once no drag is aimed (after Escape or a drop)", () => {
    const plan = planner();
    expect(aimDrag(NO_DRAG, tab("g2"), plan)).toBe(NO_DRAG);
    expect(plan.calls).toBe(0);
  });
});

describe("what the pointer does to the dock", () => {
  const run = (...events: GestureEvent[]) => events.reduce<DockGesture>(nextGesture, NO_GESTURE);

  it("hides the module views from a drag's start until it is dropped", () => {
    expect(run("drag-start")).toEqual({ kind: "dragging" });
    expect(hidesViews(run("drag-start"))).toBe(true);
    expect(run("drag-start", "drop")).toEqual(NO_GESTURE);
    expect(hidesViews(NO_GESTURE)).toBe(false);
  });

  it("ends a drag cancelled with Escape or let go outside the window: both end with dragend", () => {
    expect(run("drag-start", "drag-end")).toEqual(NO_GESTURE);
  });

  it("keeps a drag through Chromium's pointercancel at its start, but ends a resize with it", () => {
    expect(run("drag-start", "pointercancel")).toEqual({ kind: "dragging" });
    expect(run("sash-down")).toEqual({ kind: "resizing" });
    expect(run("sash-down", "pointercancel")).toEqual(NO_GESTURE);
    expect(run("sash-down", "pointerup")).toEqual(NO_GESTURE);
  });

  it("ends whatever runs when the page goes away", () => {
    expect(run("drag-start", "unmount")).toEqual(NO_GESTURE);
    expect(run("sash-down", "unmount")).toEqual(NO_GESTURE);
  });
});
