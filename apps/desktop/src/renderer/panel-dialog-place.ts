/** Where a panel's dialog goes: centred over the workspace area, with this much room kept to each of its edges. */
export const DIALOG_INSET = 16;

/** The frame of the usual module dialog (a 960 × 680 page under the 48px header and its 1px line): shorter dialogs hang from the same top edge. */
export const DIALOG_USUAL_HEIGHT = 680 + 49;

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
 *
 * With the frame's `height`, the top edge is the one a usual dialog has: a shorter dialog hangs from that edge instead of
 * being centred, so dialogs don't jump up and down when they differ in height. A taller one is centred, as ever.
 */
export function dialogPlace(room: Room | null, height?: number): { top: string; left: string; maxWidth: string; maxHeight: string } | null {
  if (!room || room.width <= 0 || room.height <= 0) return null;
  const maxHeight = Math.max(0, room.height - 2 * DIALOG_INSET);
  let centre = room.height / 2;
  if (height !== undefined) {
    const own = Math.min(height, maxHeight);
    const usual = Math.min(DIALOG_USUAL_HEIGHT, maxHeight);
    centre = (room.height - Math.max(own, usual)) / 2 + own / 2;
  }
  return {
    top: `${room.top + centre}px`,
    left: `${room.left + room.width / 2}px`,
    maxWidth: `${Math.max(0, room.width - 2 * DIALOG_INSET)}px`,
    maxHeight: `${maxHeight}px`,
  };
}
