// What the panel tells Tavora it can show over the game on its own (overlay.setSources): each clock and counter, and each
// linked group that shows as one line, with how big it needs to be. The Overlay page lists them under the panel and
// sizes a new frame from `size`. A group's counters are not listed again: the group is their one overlay. A linked group
// that is not shown as a whole has no line of its own, so its counters are listed one by one.
import type { OverlaySource } from "@tavora/sdk";
import { counterShown, groupSegments, itemSegments, linkedGroups, NUMBER_SCALE, readClock, visualOrder, WORDS_SCALE, type Font, type Item, type ItemList, type OverlayLook } from "./items";
import type { Segment } from "./template";
import { formatSeconds } from "./time";

/** The most sources a panel lists; Tavora takes at most LIMITS.maxOverlaySources (64). */
export const MAX_SOURCES = 64;

/** How big the value is at the overlay's natural size, in pixels of a 1080 px high game window. */
export const VALUE_PX = 48;
/** The last lap under the time, as a share of the number's size. */
export const LAP_SHARE = 0.32;
/** The line height of the overlay's text. */
export const LINE_HEIGHT = 1.05;
/**
 * The room the overlay keeps around its text on every side, in pixels of the 1080 px high window it is laid out in. Tavora gives a new
 * frame the same room around the size listed here (FIT_PADDING in main/overlay-layout.ts), so the text comes out at its natural size.
 */
export const FIT_PADDING = 8;

/** The width of `text` in pixels at this size and weight, in this font. */
export type Measure = (text: string, px: number, weight: number, font: Font) => number;

const FAMILY: Record<Font, string> = {
  inter: '"Inter Variable", system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", ui-monospace, Consolas, monospace',
  system: '"Segoe UI", system-ui, sans-serif',
};

/** A measure that asks the browser's canvas (the page's fonts are loaded by then); a guess where there is none. */
export function canvasMeasure(): Measure {
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    context = null;
  }
  return (text, px, weight, font) => {
    if (!context) return text.length * px * (font === "mono" ? 0.6 : 0.58);
    context.font = `${weight} ${px}px ${FAMILY[font]}`;
    return context.measureText(text).width;
  };
}

/** The value as the overlay draws it for a clock at `now`: its time, or the text it shows at 0. */
function valueText(item: Extract<Item, { kind: "countdown" | "stopwatch" }>, now: number): string {
  const reading = readClock(item, now);
  if (reading.done && item.doneText) return item.doneText;
  // A countdown that has not run yet is as wide as its whole time; a running one only shrinks.
  const seconds = item.kind === "countdown" ? Math.max(reading.seconds, Math.floor(item.duration / 1000)) : reading.seconds;
  return formatSeconds(seconds, item.format);
}

/** How big a line of words and values needs to be: the runs side by side, each at the size its style gives it. */
function lineSize(line: Segment[], look: OverlayLook, measure: Measure, lap: { text: string } | null): { width: number; height: number } {
  const number = VALUE_PX * NUMBER_SCALE[look.numberSize];
  const words = VALUE_PX * WORDS_SCALE[look.wordsSize];
  const width = line.reduce((total, part) => total + measure(part.text, part.value ? number : words, part.value ? 700 : 600, look.font), 0);
  const tallest = Math.max(line.some((part) => part.value) ? number : 0, line.some((part) => !part.value) ? words : 0);
  const lapWidth = lap ? measure(lap.text, number * LAP_SHARE, 500, look.font) : 0;
  return { width: Math.ceil(Math.max(width, lapWidth)), height: Math.ceil(tallest * LINE_HEIGHT + (lap ? number * LAP_SHARE * LINE_HEIGHT : 0)) };
}

/** How big one clock or counter needs to be, as the overlay draws its text (words and value on one baseline). */
export function itemSize(item: Item, measure: Measure, now: number): { width: number; height: number } {
  const value = item.kind === "counter" ? counterShown(item.value, item.goal) : valueText(item, now);
  const lap = item.kind === "stopwatch" && item.laps && item.showLastLap && item.lapTimes.length > 0 ? { text: formatSeconds(Math.floor((item.lapTimes.at(-1) ?? 0) / 1000), item.format) } : null;
  return lineSize(itemSegments(item, value), item.look, measure, lap);
}

/** The panel's sources in the order the panel shows them. `nameOf`: an item's name as the panel shows it (its label, or its kind). */
export function buildSources(list: ItemList, measure: Measure, nameOf: (item: Item) => string, now = Date.now()): OverlaySource[] {
  const groups = linkedGroups(list);
  const whole = new Map<string, (typeof groups)[number]>();
  for (const group of groups) if (group.stream.whole) for (const member of group.members) whole.set(member.id, group);
  const sources: OverlaySource[] = [];
  const done = new Set<string>();
  for (const item of visualOrder(list)) {
    const group = item.kind === "counter" ? whole.get(item.id) : undefined;
    if (group) {
      if (done.has(group.key)) continue;
      done.add(group.key);
      const line = groupSegments(group, nameOf);
      const size = lineSize(line, group.stream.look, measure, null);
      sources.push({ key: group.key, name: line.map((part) => part.text).join("") || nameOf(item), group: true, size: { width: size.width || 1, height: size.height || 1 } });
    } else {
      sources.push({ key: item.id, name: nameOf(item), size: itemSize(item, measure, now) });
    }
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

/** The overlay key an item's own overlay lives under: its group's when the group shows as a whole. */
export function overlayKey(list: ItemList, item: Item): string {
  if (item.kind !== "counter") return item.id;
  const group = linkedGroups(list).find((one) => one.members.some((member) => member.id === item.id));
  return group?.stream.whole ? group.key : item.id;
}

/** The first item (in the panel's order) whose overlay is `key`: the item itself, or a whole group's first counter. */
export function itemForKey(list: ItemList, key: string): Item | undefined {
  return visualOrder(list).find((item) => overlayKey(list, item) === key);
}

