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
      label: t("overlays.card.label"),
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

/** The card's window for a card of `extent` (the card's own box) at the top centre of `area`, kept inside it. */
export function cardWindowRect(area: Rect, extent: { width: number; height: number }): Rect {
  const width = Math.min(area.width, Math.ceil(extent.width) + 2 * CARD_ROOM.side);
  const height = Math.min(Math.max(0, area.height - CARD_TOP_GAP), Math.ceil(extent.height) + CARD_ROOM.top + CARD_ROOM.below);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + CARD_TOP_GAP, width, height };
}
