// Where Excalidraw's toolbar (the drawing tools) sits: at the top of the board, or at the bottom above the zoom and
// undo buttons. Moving it is in excalidrawDom.ts.

export type ToolbarPlace = "top" | "bottom";

/** Reads a stored choice; top unless it says bottom. */
export function toolbarPlace(value: unknown): ToolbarPlace {
  return value === "bottom" ? "bottom" : "top";
}

/** Space between the toolbar and the buttons below it, in pixels. */
export const TOOLBAR_GAP = 8;

/** How far down the toolbar moves so its bottom sits `TOOLBAR_GAP` above `limit` (never up). */
export function toolbarShift(toolbarBottom: number, limit: number): number {
  return Math.max(0, Math.round(limit - TOOLBAR_GAP - toolbarBottom));
}
