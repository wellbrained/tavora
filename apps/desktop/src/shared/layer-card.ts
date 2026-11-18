// The card at the top of the in-game layer (main/game-layer-card.ts draws it in a window of Tavora's own; the page is
// renderer/components/LayerCard.vue): Tavora's mark, "Overlay", Use | Arrange and Close with the layer key. This is what
// goes between the main process and that page, and where its window goes over the layer's area.
import { translate, type Language } from "./i18n";
import { hotkeyKeys } from "./hotkey-keys";

/**
 * What the open layer is for. `use`: the panels take clicks and keys, nothing has a frame. `arrange`: every item has
 * its frame to move, resize or close it, and the items' content takes no input.
 */
export type LayerMode = "use" | "arrange";

export const LAYER_MODES: readonly LayerMode[] = ["use", "arrange"];

export function isLayerMode(value: unknown): value is LayerMode {
  return typeof value === "string" && (LAYER_MODES as readonly string[]).includes(value);
}

/** The card's words, in the user's language. */
export interface LayerCardTexts {
  label: string;
  title: string;
  mode: string;
  use: string;
  useHint: string;
  arrange: string;
  arrangeHint: string;
  close: string;
  closeHint: string;
}

/** What the card shows: the mode, its words and the layer key's caps (empty without a key). */
export interface LayerCardContent {
  mode: LayerMode;
  texts: LayerCardTexts;
  keys: string[];
}

/** The theme the card is drawn in, as the toast page gets it. */
export interface LayerCardLook {
  /** The theme's mode (`mode` is the layer's). */
  scheme: "dark" | "light";
  /** The theme's colours by name (`card`, `card-foreground`, `border`, …). */
  colors: Record<string, string>;
  radius: number;
  /** The CSS font-family of the interface font the user picked. */
  font: string;
  language: string;
}

export type LayerCardState = LayerCardContent & LayerCardLook;

/** What the card's page can do: show what it is given, say how big the card is and where the pointer is, and ask for a mode or Close. */
export interface TavoraLayerCardApi {
  ready(): void;
  onState(listener: (state: LayerCardState) => void): void;
  extent(size: { width: number; height: number }): void;
  /** The pointer is over the card (true) or left it: only then does the card's window take the mouse. */
  hover(over: boolean): void;
  setMode(mode: LayerMode): void;
  close(): void;
}

/** The card's content for the layer in `mode`, with the layer key `accelerator` (null: none set). */
export function layerCardContent(language: Language, mode: LayerMode, accelerator: string | null): LayerCardContent {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  return {
    mode,
    texts: {
      label: t("overlays.layerLabel"),
      title: t("overlays.card.title"),
      mode: t("overlays.card.mode"),
      use: t("overlays.card.use"),
      useHint: t("overlays.card.useHint"),
      arrange: t("overlays.card.arrange"),
      arrangeHint: t("overlays.card.arrangeHint"),
      close: t("overlays.card.close"),
      closeHint: t("overlays.card.closeHint"),
    },
    keys: accelerator ? hotkeyKeys(accelerator) : [],
  };
}

/** Around the card the window keeps room: a little on top and at the sides for its shadow, and below for its tooltips. */
export const CARD_ROOM = { top: 8, side: 24, below: 56 } as const;
/** How far below the area's top edge the window starts (the card itself a little lower, by CARD_ROOM.top). */
export const CARD_TOP_GAP = 4;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The card's window for a card of `extent` (the card's own box) in `area`, kept inside it: at the top centre, unless the
 * card would cover one of the items on screen (`items`, their places); then the nearest free spot along the top, else at
 * the bottom centre, else the top centre after all.
 */
export function cardWindowRect(area: Rect, extent: { width: number; height: number }, items: readonly Rect[] = []): Rect {
  const width = Math.min(area.width, Math.ceil(extent.width) + 2 * CARD_ROOM.side);
  const height = Math.min(Math.max(0, area.height - CARD_TOP_GAP), Math.ceil(extent.height) + CARD_ROOM.top + CARD_ROOM.below);
  const centre = area.x + Math.round((area.width - width) / 2);
  const top = area.y + CARD_TOP_GAP;
  const window = (x: number, y: number) => ({ x, y, width, height });
  // Only the card itself counts, not the room kept around it.
  const card = (rect: Rect) => ({ x: rect.x + CARD_ROOM.side, y: rect.y + CARD_ROOM.top, width: Math.ceil(extent.width), height: Math.ceil(extent.height) });
  const free = (rect: Rect) => !items.some((item) => overlaps(card(rect), item));
  const candidates = [window(centre, top)];
  const step = Math.max(40, Math.round(width / 2));
  for (let offset = step; offset <= area.width; offset += step) {
    for (const x of [centre + offset, centre - offset]) if (x >= area.x && x + width <= area.x + area.width) candidates.push(window(x, top));
  }
  const bottom = area.y + area.height - CARD_TOP_GAP - Math.ceil(extent.height) - CARD_ROOM.top - CARD_ROOM.below;
  if (bottom > top) candidates.push(window(centre, bottom));
  return candidates.find(free) ?? candidates[0]!;
}
