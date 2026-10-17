// Excalidraw's toolbar (the drawing tools) at the top of the board, where Excalidraw puts it, or at the bottom, just
// above the zoom and undo buttons. Excalidraw has no setting for it, so the toolbar is moved down when it appears, and
// again when the panel is resized.

import { useEffect } from "react";

export type ToolbarPlace = "top" | "bottom";

/** Reads a stored choice; top unless it says bottom. */
export function toolbarPlace(value: unknown): ToolbarPlace {
  return value === "bottom" ? "bottom" : "top";
}

/** Space between the toolbar and the buttons below it, in pixels. */
const GAP = 8;

/** How far down the toolbar moves so its bottom sits `GAP` above `limit` (never up). */
export function toolbarShift(toolbarBottom: number, limit: number): number {
  return Math.max(0, Math.round(limit - GAP - toolbarBottom));
}

/**
 * Excalidraw's zoom to fit (Shift+1, …) keeps content below the toolbar by asking where the toolbar ends. Moved to the
 * bottom, it would squeeze everything into the strip under it, so it is told where the toolbar was at the top.
 */
function keepTopForZoom(section: HTMLElement, shift: number): void {
  const toolbar = section.querySelector<HTMLElement & { tavoraShift?: number }>(".App-toolbar");
  if (!toolbar) return;
  if (toolbar.tavoraShift === undefined) {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    toolbar.getBoundingClientRect = function (this: HTMLElement & { tavoraShift?: number }) {
      const rect = measure.call(this);
      return new DOMRect(rect.x, rect.y - (this.tavoraShift ?? 0), rect.width, rect.height);
    };
  }
  toolbar.tavoraShift = shift;
}

interface Props {
  /** The element Excalidraw is shown in. */
  board: HTMLElement | null;
  place: ToolbarPlace;
}

export default function Toolbar({ board, place }: Props) {
  useEffect(() => {
    if (!board) return;
    board.classList.toggle("toolbar-bottom", place === "bottom");
    let moved: HTMLElement | null = null;
    const apply = () => {
      const toolbar = board.querySelector<HTMLElement>(".App-menu_top .shapes-section");
      if (moved && moved !== toolbar) moved.style.transform = "";
      moved = toolbar;
      if (!toolbar) return;
      toolbar.style.transform = "";
      keepTopForZoom(toolbar, 0);
      if (place !== "bottom") return;
      const footer = board.querySelector(".layer-ui__wrapper__footer-left")?.getBoundingClientRect();
      const limit = footer && footer.height > 0 ? footer.top : board.getBoundingClientRect().bottom - GAP;
      const shift = toolbarShift(toolbar.getBoundingClientRect().bottom, limit);
      toolbar.style.transform = `translateY(${shift}px)`;
      keepTopForZoom(toolbar, shift);
    };
    apply();
    const resized = new ResizeObserver(apply);
    resized.observe(board);
    // Excalidraw builds the toolbar again now and then (switching boards, the panel getting narrow and wide again).
    const changed = new MutationObserver(() => {
      const toolbar = board.querySelector<HTMLElement>(".App-menu_top .shapes-section");
      const tools = toolbar?.querySelector<HTMLElement & { tavoraShift?: number }>(".App-toolbar");
      if (toolbar !== moved || (tools && tools.tavoraShift === undefined)) apply();
    });
    changed.observe(board, { childList: true, subtree: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
      if (moved) {
        moved.style.transform = "";
        keepTopForZoom(moved, 0);
      }
      board.classList.remove("toolbar-bottom");
    };
  }, [board, place]);
  return null;
}
