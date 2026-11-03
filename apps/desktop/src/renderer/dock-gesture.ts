// What the pointer does to the dock, as a union instead of two flags (WorkspacePage.vue hides the module views meanwhile).
// Pure, and free of dockview, so host.ts can hold it.
import { assertNever } from "../shared/assert-never";

/** What the pointer does to the dock: nothing, resizing a split (its sash), or dragging a panel or a group. */
export type DockGesture = { kind: "idle" } | { kind: "resizing" } | { kind: "dragging" };

/**
 * What can happen to a gesture: a sash pressed, dockview starting a panel or group drag, the pointer let go, Chromium's
 * pointercancel (sent when a drag starts, so it ends only a resize), a drag ending (dragend: dropped, Escape, or let go
 * outside the window) or dropped, and the page going away.
 */
export type GestureEvent = "sash-down" | "drag-start" | "pointerup" | "pointercancel" | "drag-end" | "drop" | "unmount";

export const NO_GESTURE: DockGesture = { kind: "idle" };

export function nextGesture(gesture: DockGesture, event: GestureEvent): DockGesture {
  switch (event) {
    case "sash-down":
      return { kind: "resizing" };
    case "drag-start":
      return { kind: "dragging" };
    case "pointercancel":
      return gesture.kind === "resizing" ? NO_GESTURE : gesture;
    case "pointerup":
    case "drag-end":
    case "drop":
    case "unmount":
      return NO_GESTURE;
    default:
      return assertNever(event);
  }
}

/** Module views are hidden while anything is dragged or resized: they are drawn above the page and would swallow the pointer. */
export function hidesViews(gesture: DockGesture): boolean {
  switch (gesture.kind) {
    case "idle":
      return false;
    case "resizing":
    case "dragging":
      return true;
    default:
      return assertNever(gesture);
  }
}
