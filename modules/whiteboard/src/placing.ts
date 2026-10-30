// The rule for a new picture: it stays free while it is selected, so it can be dragged into place first. Once it is let
// go of (something else is selected, or nothing), it is locked, so scribbling on top of it does not drag it around.
// Pictures that were on the board when it opened, and picture cards (which lock as a group by themselves), never are.

export interface PlacingElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  /** Excalidraw gives a new picture its file a moment after the element; until then it is still changing. */
  fileId?: string | null;
  customData?: Record<string, unknown>;
}

export function createPlacing(existing: Iterable<PlacingElement>) {
  /** Pictures already on the board when it opened or seen once since; only a new one is locked. */
  const seen = new Set<string>();
  for (const element of existing) if (element.type === "image") seen.add(element.id);
  /** New pictures that are still being placed. */
  const waiting = new Set<string>();

  return {
    /** Looks at a change of the board; returns the pictures to lock now (each only once). */
    observe(elements: readonly PlacingElement[], selected: Readonly<Record<string, unknown>>): string[] {
      const live = elements.filter((element) => element.type === "image" && !element.isDeleted);
      for (const element of live) if (!seen.has(element.id) && element.customData?.whiteboardCard !== "picture") waiting.add(element.id);
      const placed = live.filter((element) => waiting.has(element.id) && element.fileId !== null && !selected[element.id]).map((element) => element.id);
      for (const id of placed) waiting.delete(id);
      for (const element of live) seen.add(element.id);
      return placed;
    },

    /** The user locked or freed this picture by hand: it is no longer waiting to be locked. */
    release(id: string): void {
      waiting.delete(id);
    },
  };
}
