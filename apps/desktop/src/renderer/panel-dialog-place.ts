/** Where a panel's dialog goes: centred over the workspace area, with this much room kept to each of its edges. */
export const DIALOG_INSET = 16;

/** A box in window pixels (the workspace area's, from getBoundingClientRect). */
export interface Room {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The frame's centre and its largest size, so it sits in the middle of the workspace and never covers the rail or the
 * header. Null without a workspace area (the frame then centres on the window).
 */
export function dialogPlace(room: Room | null): { top: string; left: string; maxWidth: string; maxHeight: string } | null {
  if (!room || room.width <= 0 || room.height <= 0) return null;
  return {
    top: `${room.top + room.height / 2}px`,
    left: `${room.left + room.width / 2}px`,
    maxWidth: `${Math.max(0, room.width - 2 * DIALOG_INSET)}px`,
    maxHeight: `${Math.max(0, room.height - 2 * DIALOG_INSET)}px`,
  };
}
