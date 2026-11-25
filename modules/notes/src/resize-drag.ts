// A drag that changes a size: it follows the pointer, is kept when the pointer is let go, and is put back (nothing stored) when
// the system takes the pointer away (a pointercancel). Plain functions, so the sidebar's edge is tested without a page.

export interface ResizeDrag {
  /** The pointer went down at `x`, with the size at that moment. */
  start(x: number, size: number): void;
  /** The pointer moved to `x`. */
  move(x: number): void;
  /** The pointer was let go: the size is kept (`commit`). */
  end(): void;
  /** The system took the pointer away: the size goes back to what it was and nothing is stored. */
  cancel(): void;
}

export function createResizeDrag(options: {
  /** The size for a pointer that moved `by` pixels from where it went down, from the size it started at. */
  sizeAt(started: number, by: number): number;
  /** Shows a size while dragging. */
  show(size: number): void;
  /** Keeps the size the drag ended at. */
  commit(size: number): void;
}): ResizeDrag {
  let drag: { x: number; size: number; at: number } | null = null;
  return {
    start(x, size) {
      drag = { x, size, at: size };
    },
    move(x) {
      if (!drag) return;
      drag.at = options.sizeAt(drag.size, x - drag.x);
      options.show(drag.at);
    },
    end() {
      if (!drag) return;
      const { at } = drag;
      drag = null;
      options.commit(at);
    },
    cancel() {
      if (!drag) return;
      const { size } = drag;
      drag = null;
      options.show(size);
    },
  };
}
