// A drag of a panel or group over the dock, from its first drag event to its end, as dock-preview.ts runs it. Only the
// steps are here; reading the dock's DOM, aiming (dock-aim.ts), planning (dock-model.ts) and the drop itself are not.
import { assertNever } from "../shared/assert-never";
import { sameTarget } from "./dock-aim";
import type { Dragged, DropPlan, DropTarget } from "./dock-model";

/**
 * Nothing dragged; picked up and aimed at no place (outside the dock, a gap, a sash); or aimed at a place, with what
 * dropping there would do. `S` is what the drag read of the dock when it started.
 */
export type DockDrag<S> =
  | { phase: "idle" }
  | { phase: "lifted"; dragged: Dragged; scene: S }
  | { phase: "aiming"; dragged: Dragged; scene: S; target: DropTarget; plan: DropPlan };

/**
 * The first drag event over the window starts it; the pointer moving aims (null: no place); a drop on the dock lets go
 * there; `end` is dragend without a drop on the dock (Escape, or let go anywhere else, outside the window too).
 */
export type DockDragEvent<S> =
  | { type: "start"; dragged: Dragged; scene: S }
  | { type: "aim"; target: DropTarget | null; plan: (dragged: Dragged, scene: S, target: DropTarget) => DropPlan }
  | { type: "drop" }
  | { type: "end" };

export interface DockDragStep<S> {
  drag: DockDrag<S>;
  /** The drag changed: what shows of it is drawn again. */
  changed: boolean;
  /** A drop the dock carries out: the place and the plan it was shown with. */
  drop: { dragged: Dragged; target: DropTarget; plan: Extract<DropPlan, { ok: true }> } | null;
}

export function dockDragStep<S>(drag: DockDrag<S>, event: DockDragEvent<S>): DockDragStep<S> {
  const stay: DockDragStep<S> = { drag, changed: false, drop: null };
  switch (event.type) {
    case "start":
      // Every drag event checks it is started; only the first one starts it.
      return drag.phase === "idle" ? { drag: { phase: "lifted", dragged: event.dragged, scene: event.scene }, changed: true, drop: null } : stay;
    case "aim": {
      if (drag.phase === "idle") return stay;
      if (sameTarget(event.target, drag.phase === "aiming" ? drag.target : null)) return stay;
      const { dragged, scene } = drag;
      const next: DockDrag<S> = event.target ? { phase: "aiming", dragged, scene, target: event.target, plan: event.plan(dragged, scene, event.target) } : { phase: "lifted", dragged, scene };
      return { drag: next, changed: true, drop: null };
    }
    case "drop":
      switch (drag.phase) {
        case "idle":
          return stay;
        case "lifted":
          return { drag: { phase: "idle" }, changed: true, drop: null };
        case "aiming":
          // A refused place (too small, the same spot) lets go without a change.
          return { drag: { phase: "idle" }, changed: true, drop: drag.plan.ok ? { dragged: drag.dragged, target: drag.target, plan: drag.plan } : null };
        default:
          return assertNever(drag);
      }
    case "end":
      return drag.phase === "idle" ? stay : { drag: { phase: "idle" }, changed: true, drop: null };
    default:
      return assertNever(event);
  }
}
