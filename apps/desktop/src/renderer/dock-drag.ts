// The drop preview's drag as a union (dock-preview.ts), so nothing of one drag outlives it or is there without it.
// No DOM: the dock's measurements are whatever the caller keeps (`measured`). What the pointer does to the dock as a whole is in dock-gesture.ts.
import type { SerializedDockview } from "dockview-vue";
import { assertNever } from "../shared/assert-never";
import { sameTarget } from "./dock-aim";
import type { Dragged, DropPlan, DropTarget } from "./dock-model";

/**
 * The drop preview's drag: nothing, or a panel (or group) aimed over the dock. While aiming, everything belongs to that
 * one drag: the layout and the dock's measurements read when it started (`measured`), the target under the pointer
 * (null over a gap, or outside the dock), and the plan for it.
 */
export type DragSession<M> = { phase: "idle" } | { phase: "aiming"; dragged: Dragged; layout: SerializedDockview; measured: M; target: DropTarget | null; plan: DropPlan | null };

export type Planner = (layout: SerializedDockview, dragged: Dragged, target: DropTarget) => DropPlan;

export const NO_DRAG = { phase: "idle" } as const satisfies DragSession<never>;

export function startDrag<M>(dragged: Dragged, layout: SerializedDockview, measured: M): Extract<DragSession<M>, { phase: "aiming" }> {
  return { phase: "aiming", dragged, layout, measured, target: null, plan: null };
}

/** The pointer is over `target` now (null: nothing to drop on). The same session back when nothing changed. */
export function aimDrag<M>(session: DragSession<M>, target: DropTarget | null, plan: Planner): DragSession<M> {
  switch (session.phase) {
    case "idle":
      return session;
    case "aiming":
      if (sameTarget(target, session.target)) return session;
      return { ...session, target, plan: target ? plan(session.layout, session.dragged, target) : null };
    default:
      return assertNever(session);
  }
}

export type Drop = { dragged: Dragged; target: DropTarget; plan: Extract<DropPlan, { ok: true }> };

/** Let go over the dock: the drop to make, if the target takes it. The session ends either way. */
export function dropDrag<M>(session: DragSession<M>): Drop | null {
  switch (session.phase) {
    case "idle":
      return null;
    case "aiming":
      return session.target && session.plan?.ok ? { dragged: session.dragged, target: session.target, plan: session.plan } : null;
    default:
      return assertNever(session);
  }
}
