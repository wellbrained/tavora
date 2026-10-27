// What Clock & Counter keeps for a workspace: one document with every clock and counter, in the order shown. Clocks keep
// real time: a running clock stores when it started (`since`, epoch ms) and what it had counted before (`counted`, ms),
// so it goes on through restarts and needs no saving while it runs. Every change here is a plain function of the
// list, so a change made twice (after a save conflict) gives the same result.
import type { JsonValue } from "@tavora/sdk";
import { DEFAULT_FORMAT, formatSeconds, isFormat } from "./time";

export const LIST_ID = "items";
export const LIST_TITLE = "Clocks and counters";

export const MAX = { items: 100, label: 60, doneText: 40, laps: 99, links: 8, value: 1_000_000_000, durationMs: 100 * 3600_000 - 1000 } as const;

export const FONTS = ["inter", "mono", "system"] as const;
export type Font = (typeof FONTS)[number];
export const ALIGNS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNS)[number];
/** Text colours for the overlay. */
export const COLORS = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#f472b6", "#a78bfa", "#60a5fa", "#2dd4bf", "#4ade80", "#111111"] as const;

/** How an item looks on stream. */
export type OverlayLook = {
  showLabel: boolean;
  color: string;
  outline: boolean;
  font: Font;
  align: Align;
};

type Base = {
  id: string;
  label: string;
  look: OverlayLook;
};

export type Clock = Base & {
  kind: "countdown" | "stopwatch";
  format: string;
  /** When it started running, or null while it stands. */
  since: number | null;
  /** What it counted before `since`, in ms. */
  counted: number;
  /** Countdown: how long, in ms. */
  duration: number;
  /** Countdown: starts again at 0. */
  repeat: boolean;
  /** Countdown: shown at 0 instead of the time; empty shows 0:00 flashing. */
  doneText: string;
  /** Stopwatch: the Lap button and laps. */
  laps: boolean;
  /** Stopwatch: the overlay shows the last lap under the time. */
  showLastLap: boolean;
  /** Stopwatch: the time of each lap, from the start, oldest first. */
  lapTimes: number[];
};

export type CounterLink = {
  /** The counter that gets more. */
  target: string;
  /** How much each step adds to it. */
  amount: number;
};

export type Counter = Base & {
  kind: "counter";
  value: number;
  step: number;
  /** It may go below 0. */
  negative: boolean;
  /** Shown as `12 / 50`; reaching it marks the counter done. */
  goal: number | null;
  /** "5 sit-ups per death": each step here also adds to these counters. */
  links: CounterLink[];
};

export type Item = Clock | Counter;
export type ItemKind = Item["kind"];

export type ItemList = {
  items: Item[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number, fallback = "") => (typeof value === "string" ? value.slice(0, max) : fallback);
const whole = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

export function defaultLook(): OverlayLook {
  return { showLabel: true, color: COLORS[0], outline: true, font: "inter", align: "center" };
}

function parseLook(raw: unknown): OverlayLook {
  const look = isRecord(raw) ? raw : {};
  const color = typeof look.color === "string" && /^#[0-9a-f]{6}$/.test(look.color) ? look.color : COLORS[0];
  return { showLabel: bool(look.showLabel, true), color, outline: bool(look.outline, true), font: oneOf(FONTS, look.font, "inter"), align: oneOf(ALIGNS, look.align, "center") };
}

function parseItem(raw: unknown): Item | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return null;
  const base = { id: raw.id, label: text(raw.label, MAX.label), look: parseLook(raw.look) };
  if (raw.kind === "counter") {
    const links = (Array.isArray(raw.links) ? raw.links : [])
      .filter(isRecord)
      .filter((link) => typeof link.target === "string" && link.target !== raw.id)
      .map((link) => ({ target: link.target as string, amount: whole(link.amount, -MAX.value, MAX.value, 1) }))
      .slice(0, MAX.links);
    const negative = bool(raw.negative, false);
    return {
      ...base,
      kind: "counter",
      value: whole(raw.value, negative ? -MAX.value : 0, MAX.value, 0),
      step: whole(raw.step, 1, MAX.value, 1),
      negative,
      goal: raw.goal === null || raw.goal === undefined ? null : whole(raw.goal, 1, MAX.value, 10),
      links,
    };
  }
  if (raw.kind !== "countdown" && raw.kind !== "stopwatch") return null;
  return {
    ...base,
    kind: raw.kind,
    format: isFormat(raw.format) ? raw.format : DEFAULT_FORMAT,
    since: typeof raw.since === "number" && Number.isFinite(raw.since) ? raw.since : null,
    counted: whole(raw.counted, 0, Number.MAX_SAFE_INTEGER, 0),
    duration: whole(raw.duration, 1000, MAX.durationMs, 5 * 60_000),
    repeat: bool(raw.repeat, false),
    doneText: text(raw.doneText, MAX.doneText),
    laps: bool(raw.laps, false),
    showLastLap: bool(raw.showLastLap, false),
    lapTimes: (Array.isArray(raw.lapTimes) ? raw.lapTimes : []).filter((lap): lap is number => typeof lap === "number" && Number.isFinite(lap) && lap >= 0).slice(-MAX.laps),
  };
}

/** The stored list, with anything it can't read left out. */
export function parseList(raw: JsonValue | null): ItemList {
  const items = isRecord(raw) && Array.isArray(raw.items) ? raw.items.map(parseItem).filter((item): item is Item => item !== null) : [];
  const seen = new Set<string>();
  const unique = items.filter((item) => !seen.has(item.id) && seen.add(item.id)).slice(0, MAX.items);
  const ids = new Set(unique.map((item) => item.id));
  // Links only to counters that are still there.
  for (const item of unique) if (item.kind === "counter") item.links = item.links.filter((link) => ids.has(link.target) && unique.find((other) => other.id === link.target)?.kind === "counter");
  return { items: unique };
}

export function newItem(kind: ItemKind, id: string, label: string): Item {
  const base = { id, label: label.slice(0, MAX.label), look: defaultLook() };
  if (kind === "counter") return { ...base, kind, value: 0, step: 1, negative: false, goal: null, links: [] };
  return { ...base, kind, format: DEFAULT_FORMAT, since: null, counted: 0, duration: 5 * 60_000, repeat: false, doneText: "", laps: false, showLastLap: false, lapTimes: [] };
}

// ── Clocks ─────────────────────────────────────────────────────────────

/** How long a clock has run, in ms, at `now`. */
export function elapsed(clock: Clock, now: number): number {
  return clock.counted + (clock.since === null ? 0 : Math.max(0, now - clock.since));
}

export type ClockReading = {
  /** The seconds to show. */
  seconds: number;
  running: boolean;
  /** A countdown that reached 0 (never one that repeats). */
  done: boolean;
};

/** What a clock shows at `now`. A countdown shows the seconds left, rounded up, so it reads 0:01 until it ends. */
export function readClock(clock: Clock, now: number): ClockReading {
  const ms = elapsed(clock, now);
  if (clock.kind === "stopwatch") return { seconds: Math.floor(ms / 1000), running: clock.since !== null, done: false };
  if (clock.repeat) {
    const left = clock.duration - (ms % clock.duration);
    return { seconds: Math.ceil(left / 1000), running: clock.since !== null, done: false };
  }
  const left = Math.max(0, clock.duration - ms);
  return { seconds: Math.ceil(left / 1000), running: clock.since !== null && left > 0, done: left === 0 };
}

/** The clock's time as its format shows it. */
export function clockText(clock: Clock, now: number): string {
  return formatSeconds(readClock(clock, now).seconds, clock.format);
}

/** A finished countdown starts over from the full time; anything else starts or pauses. */
export function startPause(clock: Clock, now: number): void {
  if (clock.kind === "countdown" && !clock.repeat && readClock(clock, now).done) {
    clock.counted = 0;
    clock.since = now;
    return;
  }
  if (clock.since === null) clock.since = now;
  else {
    clock.counted = elapsed(clock, now);
    clock.since = null;
  }
}

export function resetClock(clock: Clock): void {
  clock.since = null;
  clock.counted = 0;
  clock.lapTimes = [];
}

/** Notes a lap while the stopwatch runs; the oldest go past MAX.laps. */
export function lap(clock: Clock, now: number): void {
  if (clock.kind !== "stopwatch" || !clock.laps || clock.since === null) return;
  clock.lapTimes = [...clock.lapTimes, elapsed(clock, now)].slice(-MAX.laps);
}

/** Each lap's own time, oldest first. */
export function lapSplits(clock: Clock): number[] {
  return clock.lapTimes.map((time, index) => time - (clock.lapTimes[index - 1] ?? 0));
}

// ── Counters ───────────────────────────────────────────────────────────

function addTo(counter: Counter, amount: number): void {
  counter.value = Math.min(MAX.value, Math.max(counter.negative ? -MAX.value : 0, counter.value + amount));
}

/**
 * Counts up (`direction` 1) or down (-1) one step, and its linked counters with it: a −1 takes back what a +1 added.
 * Links go one level only, so a linked counter's own links don't fire. A counter that can't go below 0 stops at 0;
 * once it doesn't move, its links don't either.
 */
export function count(list: ItemList, counterId: string, direction: 1 | -1): void {
  const counter = list.items.find((item): item is Counter => item.id === counterId && item.kind === "counter");
  if (!counter) return;
  const before = counter.value;
  addTo(counter, direction * counter.step);
  if (counter.value === before) return;
  for (const link of counter.links) {
    const target = list.items.find((item): item is Counter => item.id === link.target && item.kind === "counter");
    if (target) addTo(target, direction * link.amount);
  }
}

/** Back to 0. Linked counters keep what they have. */
export function resetCounter(counter: Counter): void {
  counter.value = 0;
}

export function goalReached(counter: Counter): boolean {
  return counter.goal !== null && counter.value >= counter.goal;
}

// ── The list ───────────────────────────────────────────────────────────

export function find(list: ItemList, id: string): Item | undefined {
  return list.items.find((item) => item.id === id);
}

export function insert(list: ItemList, item: Item, index = list.items.length): void {
  if (list.items.some((other) => other.id === item.id) || list.items.length >= MAX.items) return;
  list.items.splice(Math.min(index, list.items.length), 0, item);
}

/** Removes an item, and the links to it. */
export function remove(list: ItemList, id: string): void {
  list.items = list.items.filter((item) => item.id !== id);
  for (const item of list.items) if (item.kind === "counter") item.links = item.links.filter((link) => link.target !== id);
}

export function move(list: ItemList, id: string, by: -1 | 1): void {
  const index = list.items.findIndex((item) => item.id === id);
  const to = index + by;
  if (index < 0 || to < 0 || to >= list.items.length) return;
  const [item] = list.items.splice(index, 1);
  list.items.splice(to, 0, item!);
}

// ── On stream ──────────────────────────────────────────────────────────

/** What the overlay of an item gets (overlay.publish): enough to draw it, and to keep a running clock going itself. */
export type OverlayState =
  | { kind: "clock"; label: string; look: OverlayLook; clock: Pick<Clock, "kind" | "format" | "since" | "counted" | "duration" | "repeat" | "doneText">; lastLap: number | null }
  | { kind: "counter"; label: string; look: OverlayLook; value: number; goal: number | null };

export function overlayState(item: Item): OverlayState {
  if (item.kind === "counter") return { kind: "counter", label: item.label, look: { ...item.look }, value: item.value, goal: item.goal };
  const { kind, format, since, counted, duration, repeat, doneText } = item;
  const lastLap = item.kind === "stopwatch" && item.laps && item.showLastLap ? (lapSplits(item).at(-1) ?? null) : null;
  return { kind: "clock", label: item.label, look: { ...item.look }, clock: { kind, format, since, counted, duration, repeat, doneText }, lastLap };
}

