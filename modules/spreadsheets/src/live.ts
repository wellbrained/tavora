// The live view: a range of a sheet, read-only over the game, on a plate like To-Dos'. The panel works out what each
// cell shows and hands it to Tavora (panel.setLive); the overlay page only draws it. Small on purpose: Tavora takes
// at most 16 KB, so long ranges are cut with "+N more".
import type { JsonValue } from "@tavora/sdk";
import { isColor, type ColorName } from "./model";

export const LIVE_SIZES = { xs: 12, s: 14, m: 16, l: 20, xl: 24 } as const;
export type LiveSize = keyof typeof LIVE_SIZES;
export const LIVE_SIZE_IDS = Object.keys(LIVE_SIZES) as LiveSize[];

/** How the live view looks; kept per panel. */
export interface LiveLook {
  [key: string]: JsonValue;
  /** Plate opacity in percent. */
  opacity: number;
  /** Space around the cells in px. */
  padding: number;
  size: LiveSize;
}

export const LIVE_DEFAULTS: LiveLook = { opacity: 33, padding: 8, size: "m" };
export const LIVE_RANGE = { opacity: [0, 100], padding: [0, 24] } as const;

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function parseLook(raw: unknown): LiveLook {
  const look = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    opacity: clamp(look.opacity, LIVE_RANGE.opacity, LIVE_DEFAULTS.opacity),
    padding: clamp(look.padding, LIVE_RANGE.padding, LIVE_DEFAULTS.padding),
    size: LIVE_SIZE_IDS.includes(look.size as LiveSize) ? (look.size as LiveSize) : LIVE_DEFAULTS.size,
  };
}

/** One cell on the plate. Short keys: the state has to stay small. */
export interface LiveCell {
  /** What it shows. */
  t: string;
  b?: true;
  i?: true;
  /** Align: centre or right (left when left out). */
  a?: "c" | "r";
  /** Text colour, by name. */
  c?: ColorName;
  /** Fill, by name. */
  f?: ColorName;
  /** A checkbox (with `v` ticked or not) or a dropdown pill (coloured by `p`). */
  k?: "check" | "pill";
  v?: boolean;
  p?: ColorName;
}

/** What the panel hands to panel.setLive (as JSON). */
export interface LiveState {
  rows: LiveCell[][];
  /** Column widths as the sheet has them, in px at medium size. */
  widths: number[];
  /** The first row is the sheet's header row. */
  header: boolean;
  /** Rows that didn't fit. */
  more: number;
  /** "+{count} more" in the panel's language. */
  moreText: string;
  look: LiveLook;
}

export const LIVE_MAX = { rows: 40, cols: 12, text: 80, bytes: 15 * 1024 } as const;

const shorten = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > LIVE_MAX.text ? `${chars.slice(0, LIVE_MAX.text - 1).join("")}…` : line;
};

/** Builds the state, cutting rows (then columns) until it fits Tavora's limit. */
export function buildLiveState(input: { rows: LiveCell[][]; widths: number[]; header: boolean; look: LiveLook; moreText: string }): LiveState {
  const cols = Math.min(LIVE_MAX.cols, input.widths.length);
  let rows = input.rows.map((row) => row.slice(0, cols).map((cell) => ({ ...cell, t: shorten(cell.t) })));
  let more = Math.max(0, rows.length - LIVE_MAX.rows);
  rows = rows.slice(0, LIVE_MAX.rows);
  const make = (): LiveState => ({ rows, widths: input.widths.slice(0, cols), header: input.header, more, moreText: input.moreText, look: input.look });
  let state = make();
  while (rows.length > 1 && new TextEncoder().encode(JSON.stringify(state)).length > LIVE_MAX.bytes) {
    rows = rows.slice(0, -1);
    more++;
    state = make();
  }
  return state;
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** A state as the overlay got it; anything odd is dropped rather than drawn. */
export function readLiveState(raw: unknown): LiveState | null {
  if (!isObject(raw) || !Array.isArray(raw.rows)) return null;
  const rows = raw.rows.filter(Array.isArray).map((row) =>
    (row as unknown[]).filter(isObject).map((cell): LiveCell => ({
      t: typeof cell.t === "string" ? cell.t : "",
      ...(cell.b === true ? { b: true as const } : {}),
      ...(cell.i === true ? { i: true as const } : {}),
      ...(cell.a === "c" || cell.a === "r" ? { a: cell.a } : {}),
      ...(isColor(cell.c) ? { c: cell.c } : {}),
      ...(isColor(cell.f) ? { f: cell.f } : {}),
      ...(cell.k === "check" || cell.k === "pill" ? { k: cell.k } : {}),
      ...(cell.v === true ? { v: true } : {}),
      ...(isColor(cell.p) ? { p: cell.p } : {}),
    })),
  );
  return {
    rows,
    widths: (Array.isArray(raw.widths) ? raw.widths : []).map((width) => (typeof width === "number" && Number.isFinite(width) ? Math.max(24, Math.min(800, width)) : 96)),
    header: raw.header === true,
    more: typeof raw.more === "number" ? Math.max(0, raw.more) : 0,
    moreText: typeof raw.moreText === "string" ? raw.moreText : "+{count}",
    look: parseLook(raw.look),
  };
}
