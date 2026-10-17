// Excalidraw's style palette (stroke, background, width, …) gets a handle: drag it anywhere on the board, or fold it
// away to just its handle. Excalidraw builds the palette itself and shows it only while something is selected or
// drawn, so the handle is put into it each time it appears, and where it sits is kept for the panel.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "./i18n";

export interface PalettePlace {
  /** How far the palette is moved from where Excalidraw puts it, in pixels. */
  x: number;
  y: number;
  collapsed: boolean;
  /** Whether the less used options (sloppiness, edges, opacity, align, actions, …) are shown too. */
  more: boolean;
}

export const DEFAULT_PALETTE: PalettePlace = { x: 0, y: 0, collapsed: false, more: false };

/** Reads a stored place, falling back to the default for anything that is not one. */
export function palettePlace(value: unknown): PalettePlace {
  if (!value || typeof value !== "object") return DEFAULT_PALETTE;
  const { x, y, collapsed, more } = value as Record<string, unknown>;
  return {
    x: typeof x === "number" && Number.isFinite(x) ? x : 0,
    y: typeof y === "number" && Number.isFinite(y) ? y : 0,
    collapsed: collapsed === true,
    more: more === true,
  };
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
function sortOptions(palette: HTMLElement, column: HTMLElement, more: HTMLElement): void {
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
  if (label?.nodeType === Node.TEXT_NODE && label.nodeValue !== t("palette.color")) label.nodeValue = t("palette.color");
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How much of the palette stays on the board at least, so its handle can always be grabbed again. */
const KEEP = 40;

/**
 * The offset moved so the palette stays on the board: all of its width when it fits, and its handle at the top.
 * `home` is where the palette is without any offset.
 */
export function clampPlace(x: number, y: number, home: Box, board: Box): { x: number; y: number } {
  const width = home.right - home.left;
  const minX = board.left - home.left;
  const maxX = Math.max(minX, board.right - width - home.left);
  const minY = board.top - home.top;
  const maxY = Math.max(minY, board.bottom - KEEP - home.top);
  return { x: Math.round(Math.min(maxX, Math.max(minX, x))), y: Math.round(Math.min(maxY, Math.max(minY, y))) };
}

interface Props {
  /** The element Excalidraw is shown in. */
  board: HTMLElement | null;
  place: PalettePlace;
  onPlace(place: PalettePlace): void;
}

export default function Palette({ board, place, onPlace }: Props) {
  /** The palette Excalidraw shows right now, and the handle put into it. */
  const [shown, setShown] = useState<{ palette: HTMLElement; handle: HTMLElement } | null>(null);
  /** Where the More options toggle is put, at the end of the options. */
  const [moreHost, setMoreHost] = useState<HTMLElement | null>(null);
  const current = useRef(place);
  current.current = place;
  const drag = useRef<{ pointer: number; startX: number; startY: number; from: PalettePlace; moved: boolean } | null>(null);

  // Finds the palette whenever Excalidraw shows it, and puts the handle at its top.
  useEffect(() => {
    if (!board) return;
    let known: { palette: HTMLElement; handle: HTMLElement } | null = null;
    const find = () => {
      const palette = board.querySelector<HTMLElement>(".App-menu__left");
      if (!(known && known.palette === palette && palette.firstElementChild === known.handle)) {
        known?.handle.remove();
        if (palette) {
          const handle = document.createElement("div");
          handle.className = "palette-handle";
          palette.prepend(handle);
          known = { palette, handle };
        } else known = null;
        setShown(known);
      }
      const column = palette?.querySelector<HTMLElement>(".panelColumn") ?? null;
      if (!column) {
        if (more) {
          more.remove();
          more = null;
          setMoreHost(null);
        }
        return;
      }
      if (!more || more.parentElement !== column) {
        more?.remove();
        more = document.createElement("div");
        more.className = "palette-more";
        column.append(more);
        setMoreHost(more);
      }
      sortOptions(palette!, column, more);
    };
    let more: HTMLElement | null = null;
    find();
    const observer = new MutationObserver(find);
    // Text too: Excalidraw names the options again when the language changes.
    observer.observe(board, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      more?.remove();
      setShown(null);
      setMoreHost(null);
    };
  }, [board]);

  // Moves the palette to its place, kept on the board, also when the panel is resized.
  useEffect(() => {
    if (!board || !shown) return;
    const { palette } = shown;
    const apply = () => {
      const { x, y } = current.current;
      palette.style.transform = "";
      const home = palette.getBoundingClientRect();
      const kept = clampPlace(x, y, home, board.getBoundingClientRect());
      palette.style.transform = kept.x || kept.y ? `translate(${kept.x}px, ${kept.y}px)` : "";
      palette.classList.toggle("palette-collapsed", current.current.collapsed);
      palette.classList.toggle("palette-more-open", current.current.more);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(board);
    return () => observer.disconnect();
  }, [board, shown, place]);

  if (!shown) return null;

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, from: current.current, moved: false };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId || !board || !shown) return;
    gesture.moved = true;
    const { palette } = shown;
    const transform = palette.style.transform;
    palette.style.transform = "";
    const home = palette.getBoundingClientRect();
    palette.style.transform = transform;
    const kept = clampPlace(gesture.from.x + event.clientX - gesture.startX, gesture.from.y + event.clientY - gesture.startY, home, board.getBoundingClientRect());
    // Only on the page while dragging; stored when the palette is let go of.
    current.current = { ...current.current, ...kept };
    palette.style.transform = `translate(${kept.x}px, ${kept.y}px)`;
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    drag.current = null;
    if (gesture.moved) onPlace(current.current);
  }

  const label = t(place.collapsed ? "palette.expand" : "palette.collapse");
  const moreToggle = moreHost
    ? createPortal(
        <button
          type="button"
          className="palette-more-toggle"
          aria-expanded={place.more}
          data-testid="palette-more"
          onClick={() => onPlace({ ...current.current, more: !current.current.more })}
        >
          <span>{t(place.more ? "palette.less" : "palette.more")}</span>
          <span aria-hidden="true">{place.more ? "▾" : "▸"}</span>
        </button>,
        moreHost,
      )
    : null;
  const handle = createPortal(
    <div
      className="palette-grip"
      title={t("palette.move")}
      data-testid="palette-handle"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) onPlace(DEFAULT_PALETTE);
      }}
    >
      <svg className="palette-dots" viewBox="0 0 10 16" width="8" height="12" aria-hidden="true" fill="currentColor">
        <circle cx="2.5" cy="3" r="1.5" />
        <circle cx="7.5" cy="3" r="1.5" />
        <circle cx="2.5" cy="8" r="1.5" />
        <circle cx="7.5" cy="8" r="1.5" />
        <circle cx="2.5" cy="13" r="1.5" />
        <circle cx="7.5" cy="13" r="1.5" />
      </svg>
      <span className="palette-title">{t("palette.title")}</span>
      <button
        type="button"
        className="palette-toggle"
        aria-label={label}
        title={label}
        aria-expanded={!place.collapsed}
        data-testid="palette-toggle"
        onClick={() => onPlace({ ...current.current, collapsed: !current.current.collapsed })}
      >
        {place.collapsed ? "▸" : "▾"}
      </button>
    </div>,
    shown.handle,
  );
  return (
    <>
      {handle}
      {moreToggle}
    </>
  );
}
