// Everything that reaches into Excalidraw's own DOM lives here, and nowhere else. Excalidraw has no setting for where
// its toolbar sits or for what its style palette shows, so both are found by their class names and adjusted in place:
// the palette gets a handle and a More options fold, the toolbar can move to the bottom. Excalidraw builds these parts
// again now and then (switching boards, the panel getting narrow and wide again), so each is looked for whenever the
// board's DOM changes, at most once per frame. If an Excalidraw update renames a class, this is the file to fix.

import { clampPlace, type PalettePlace } from "./palette";
import { TOOLBAR_GAP, toolbarShift, type ToolbarPlace } from "./toolbar";

/** Runs `work` once on the next frame, however often it is asked for before then. */
function perFrame(work: () => void): { run(): void; cancel(): void } {
  let frame = 0;
  return {
    run() {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          work();
        });
    },
    cancel() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

// --- The style palette -------------------------------------------------------------------------------------------

export interface PaletteParts {
  /** Excalidraw's palette. */
  palette: HTMLElement;
  /** Put at the palette's top, for the page to fill with the drag handle. */
  handle: HTMLElement;
  /** Put at the end of the options, for the page to fill with the More options toggle. */
  more: HTMLElement;
}

/**
 * The options that always show: colour, background, fill, stroke width and style, font family and size, arrowheads.
 * Recognised by what is inside them, so it works in every language. Everything else goes under More options.
 */
const MAIN_OPTIONS = [
  '[data-testid^="color-top-pick-"]',
  '[data-testid^="fill-"]',
  '[data-testid^="strokeWidth-"]',
  'input[name="strokeStyle"]',
  '[data-testid^="font-family-"]',
  '[data-testid^="fontSize-"]',
  ".iconSelectList",
].join(",");

/** Sorts Excalidraw's options into the main ones and the more ones, and calls the stroke colour plain Color. */
function sortOptions(palette: HTMLElement, column: HTMLElement, more: HTMLElement, colorLabel: string): void {
  let extra = 0;
  for (const child of column.children) {
    if (child === more) continue;
    const isExtra = !child.querySelector(MAIN_OPTIONS);
    child.classList.toggle("palette-extra", isExtra);
    if (isExtra && !child.querySelector(".zIndexButton")) extra++;
  }
  palette.classList.toggle("palette-has-extra", extra > 0);
  // The stroke colour is the one picker without a transparent choice (the background has one). Its text node is
  // changed in place, so Excalidraw keeps owning it.
  const stroke = [...column.children].find((child) => child.querySelector('[data-testid^="color-top-pick-"]') && !child.querySelector('[data-testid="color-top-pick-transparent"]'));
  const label = stroke?.querySelector("h3, legend")?.firstChild;
  if (label?.nodeType === Node.TEXT_NODE && label.nodeValue !== colorLabel) label.nodeValue = colorLabel;
}

/**
 * Calls `onChange` with the palette Excalidraw shows right now (null while it shows none), and again whenever Excalidraw
 * builds a new one. Returns how to stop. `colorLabel` is read each time the options are sorted.
 */
export function watchPalette(board: HTMLElement, colorLabel: () => string, onChange: (parts: PaletteParts | null) => void): () => void {
  let known: PaletteParts | null = null;
  let texts: MutationObserver | null = null;

  const drop = () => {
    known?.handle.remove();
    known?.more.remove();
    known = null;
    texts?.disconnect();
  };

  const find = () => {
    const palette = board.querySelector<HTMLElement>(".App-menu__left");
    const column = palette?.querySelector<HTMLElement>(".panelColumn") ?? null;
    if (!palette || !column) {
      if (known) {
        drop();
        onChange(null);
      }
      return;
    }
    const alive = known && known.palette === palette && palette.firstElementChild === known.handle && known.more.parentElement === column;
    if (!alive) {
      drop();
      const handle = document.createElement("div");
      handle.className = "palette-handle";
      palette.prepend(handle);
      const more = document.createElement("div");
      more.className = "palette-more";
      column.append(more);
      known = { palette, handle, more };
      // Excalidraw names the options again when the language changes; only the palette's own text is watched for that.
      texts = new MutationObserver(() => sorting.run());
      texts.observe(palette, { characterData: true, subtree: true });
      onChange(known);
    }
    sortOptions(palette, column, known!.more, colorLabel());
  };
  const sorting = perFrame(find);
  const changed = new MutationObserver(() => sorting.run());
  changed.observe(board, { childList: true, subtree: true });
  find();

  return () => {
    changed.disconnect();
    sorting.cancel();
    drop();
  };
}

/** Where the palette would be without any move: its box with the transform taken off for a moment. */
export function paletteHome(palette: HTMLElement): DOMRect {
  const transform = palette.style.transform;
  palette.style.transform = "";
  const home = palette.getBoundingClientRect();
  palette.style.transform = transform;
  return home;
}

/** Moves the palette to its place (kept on the board) and folds it as asked. Returns where it ended up. */
export function placePalette(palette: HTMLElement, board: HTMLElement, place: PalettePlace): { x: number; y: number } {
  const kept = clampPlace(place.x, place.y, paletteHome(palette), board.getBoundingClientRect());
  palette.style.transform = kept.x || kept.y ? `translate(${kept.x}px, ${kept.y}px)` : "";
  palette.classList.toggle("palette-collapsed", place.collapsed);
  palette.classList.toggle("palette-more-open", place.more);
  return kept;
}

// --- The toolbar -------------------------------------------------------------------------------------------------

type Shifted = HTMLElement & { tavoraShift?: number };

/**
 * Excalidraw's zoom to fit (Shift+1, …) keeps content below the toolbar by asking where the toolbar ends. Moved to the
 * bottom, it would squeeze everything into the strip under it, so it is told where the toolbar was at the top.
 */
function keepTopForZoom(section: HTMLElement, shift: number): void {
  const toolbar = section.querySelector<Shifted>(".App-toolbar");
  if (!toolbar) return;
  if (toolbar.tavoraShift === undefined) {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    toolbar.getBoundingClientRect = function (this: Shifted) {
      const rect = measure.call(this);
      return new DOMRect(rect.x, rect.y - (this.tavoraShift ?? 0), rect.width, rect.height);
    };
  }
  toolbar.tavoraShift = shift;
}

/** Puts Excalidraw's toolbar at the top (where Excalidraw has it) or just above the zoom and undo buttons. Returns how to stop. */
export function watchToolbar(board: HTMLElement, place: ToolbarPlace): () => void {
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
    const limit = footer && footer.height > 0 ? footer.top : board.getBoundingClientRect().bottom - TOOLBAR_GAP;
    const shift = toolbarShift(toolbar.getBoundingClientRect().bottom, limit);
    toolbar.style.transform = `translateY(${shift}px)`;
    keepTopForZoom(toolbar, shift);
  };
  const moving = perFrame(apply);
  apply();
  const resized = new ResizeObserver(() => moving.run());
  resized.observe(board);
  // Only a toolbar Excalidraw built anew needs moving again; the rest of the board changing does not.
  const changed = new MutationObserver(() => {
    const toolbar = board.querySelector<HTMLElement>(".App-menu_top .shapes-section");
    const tools = toolbar?.querySelector<Shifted>(".App-toolbar");
    // At once, not on the next frame, so a rebuilt toolbar is never seen at the top for a moment.
    if (toolbar !== moved || (tools && tools.tavoraShift === undefined)) apply();
  });
  changed.observe(board, { childList: true, subtree: true });
  return () => {
    resized.disconnect();
    changed.disconnect();
    moving.cancel();
    if (moved) {
      moved.style.transform = "";
      keepTopForZoom(moved, 0);
    }
    board.classList.remove("toolbar-bottom");
  };
}

// --- The hint under the toolbar ---------------------------------------------------------------------------------

/** Excalidraw's own hint for moving the canvas, in the languages the board uses. Only this hint is replaced. */
const PANNING_HINTS = new Set([
  "To move canvas, hold mouse wheel or spacebar while dragging, or use the hand tool",
  "Um die Zeichenfläche zu verschieben, halte das Mausrad oder die Leertaste während des Ziehens, oder verwende das Hand-Werkzeug",
]);

/**
 * Says Excalidraw's hint for moving the canvas in Tavora's words. Excalidraw has no setting for one sentence, only for
 * whole languages, so its text node is changed in place whenever Excalidraw writes the hint again. Its other hints stay.
 */
export function watchHints(board: HTMLElement, panning: () => string): () => void {
  const apply = () => {
    const hint = board.querySelector(".HintViewer");
    if (!hint) return;
    const walker = document.createTreeWalker(hint, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (PANNING_HINTS.has(text.data.trim())) text.data = panning();
    }
  };
  apply();
  const changed = new MutationObserver(apply);
  changed.observe(board, { childList: true, characterData: true, subtree: true });
  return () => changed.disconnect();
}

// --- What covers a picture's lock --------------------------------------------------------------------------------

/** Whether the drawing itself (not one of Excalidraw's menus) is what shows at this point; `ignore` matches the page's own overlays. */
export function isCanvasAt(x: number, y: number, ignore: string): boolean {
  return (
    document
      .elementsFromPoint(x, y)
      .find((element) => !element.closest(ignore))
      ?.matches("canvas") ?? false
  );
}
