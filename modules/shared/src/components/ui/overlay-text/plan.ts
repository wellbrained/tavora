// What an overlay text does in its box, worked out without the page: how much it is scaled, and whether it fits, scrolls,
// shrinks or is cut off. The DOM part (overlay-text.ts) measures, asks this and draws the answer, so the rules are tested here.
//
// Two ways to size it, as in OBS Studio:
// - "grow": the box is as big as the text (Tavora keeps the frame around it). The text is scaled with the box: dragging a
//   corner of the frame makes it bigger or smaller, and it is always drawn at the real size, so it stays sharp.
// - "fixed": the box has its own size. The text keeps its natural size and alignment and is never made bigger to fill it;
//   when it is too long it scrolls, shrinks or is cut off with "…".

export const OVERLAY_TEXT_MODES = ["grow", "fixed"] as const;
export type OverlayTextMode = (typeof OVERLAY_TEXT_MODES)[number];
export const OVERLAY_TEXT_OVERFLOWS = ["scroll", "shrink", "clip"] as const;
export type OverlayTextOverflow = (typeof OVERLAY_TEXT_OVERFLOWS)[number];
export const OVERLAY_TEXT_SPEEDS = ["slow", "normal", "fast"] as const;
export type OverlayTextSpeed = (typeof OVERLAY_TEXT_SPEEDS)[number];
export type OverlayTextAlign = "left" | "center" | "right";

/** The pauses at the start of each round, in seconds: off, or 0.5 to 5 in steps of 0.5. */
export const OVERLAY_TEXT_PAUSES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

/** How fast a scrolling text runs, in pixels a second at its natural size. */
export const SCROLL_SPEED: Record<OverlayTextSpeed, number> = { slow: 40, normal: 80, fast: 160 };

/** The settings of an overlay text a user can change (OverlayTextSettings.vue shows them). */
// A type, not an interface, so it can be saved as JSON (JsonValue).
export type OverlayTextSettings = {
  mode: OverlayTextMode;
  overflow: OverlayTextOverflow;
  speed: OverlayTextSpeed;
  /** Seconds the text stands at the start of each round; 0 for none. */
  pause: number;
  /** The text fades out at the box's edges while it scrolls. */
  softEdges: boolean;
};

export const OVERLAY_TEXT_DEFAULTS: Readonly<OverlayTextSettings> = { mode: "grow", overflow: "scroll", speed: "normal", pause: 2, softEdges: true };

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

/** The nearest pause step to `value` (seconds); the default where it isn't a number. */
export function pauseStep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return OVERLAY_TEXT_DEFAULTS.pause;
  return OVERLAY_TEXT_PAUSES.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), OVERLAY_TEXT_PAUSES[0]);
}

/** Settings read from saved data: each field that is missing or can't be used takes its default. */
export function readOverlayTextSettings(raw: unknown): OverlayTextSettings {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    mode: oneOf(OVERLAY_TEXT_MODES, value.mode, OVERLAY_TEXT_DEFAULTS.mode),
    overflow: oneOf(OVERLAY_TEXT_OVERFLOWS, value.overflow, OVERLAY_TEXT_DEFAULTS.overflow),
    speed: oneOf(OVERLAY_TEXT_SPEEDS, value.speed, OVERLAY_TEXT_DEFAULTS.speed),
    pause: pauseStep(value.pause),
    softEdges: typeof value.softEdges === "boolean" ? value.softEdges : OVERLAY_TEXT_DEFAULTS.softEdges,
  };
}

type Size = { width: number; height: number };

/** What the text does in its box. */
export type TextPlan =
  /** It is drawn at `scale` times its natural size and fits (grow, a fixed box it fits in, or shrunk to fit). */
  | { kind: "fit"; scale: number }
  /** It runs through the box in a loop, at its natural size. */
  | { kind: "scroll"; scale: 1 }
  /** It is cut off at the box's end with "…". */
  | { kind: "clip"; scale: 1 };

/** A little slack, so a text exactly as wide as its box (after rounding) counts as fitting. */
const SLACK = 0.5;

/**
 * What a text of `natural` size does in a box with `room` inside. `reducedMotion`: the user asked for less motion, so a
 * text that would scroll is cut off instead.
 */
export function planText(input: { mode: OverlayTextMode; overflow: OverlayTextOverflow; room: Size; natural: Size; reducedMotion: boolean }): TextPlan {
  const { room, natural } = input;
  if (!(natural.width > 0) || !(natural.height > 0)) return { kind: "fit", scale: 1 };
  const width = Math.max(room.width, 1) / natural.width;
  const height = Math.max(room.height, 1) / natural.height;
  if (input.mode === "grow") return { kind: "fit", scale: Math.min(width, height) };
  // A box lower than the text only shrinks it when the user chose Shrink; otherwise the text keeps its size.
  if (natural.width <= room.width + SLACK) return { kind: "fit", scale: input.overflow === "shrink" ? Math.min(1, height) : 1 };
  if (input.overflow === "shrink") return { kind: "fit", scale: Math.min(1, width, height) };
  if (input.overflow === "scroll" && !input.reducedMotion) return { kind: "scroll", scale: 1 };
  return { kind: "clip", scale: 1 };
}

/** One round of a scrolling text: how long it is, and the share of it the text stands still at the start. */
export function scrollRound(distance: number, speed: OverlayTextSpeed, pause: number): { duration: number; still: number } {
  const run = (Math.max(distance, 1) / SCROLL_SPEED[speed]) * 1000;
  const wait = Math.max(0, pause) * 1000;
  return { duration: run + wait, still: wait / (run + wait) };
}

/**
 * Where a new round goes on from, in ms, when the scroll is set up again (the text, the box or a setting changed).
 * `restart` (a new text, such as the next song) starts at the beginning; otherwise it keeps its place in the round, so a
 * counter that ticks doesn't jump back to the start.
 */
export function carryOn(previous: { time: number; duration: number } | null, duration: number, restart: boolean): number {
  if (restart || !previous || !(previous.duration > 0) || !(duration > 0)) return 0;
  const share = (previous.time % previous.duration) / previous.duration;
  return share * duration;
}

/**
 * The scale of a growing text while its box catches up: when the text got wider but the box hasn't followed yet (Tavora
 * resizes the frame a moment later), it keeps the scale it had instead of shrinking for that moment. `held` says whether
 * it is still in that moment.
 */
export function holdScale(plan: number, previous: number | null, heightScale: number, held: boolean): number {
  if (!held || previous === null) return plan;
  // Only a box that is too narrow for the same height waits; a box that got smaller or bigger shows it at once.
  return plan < previous && Math.abs(heightScale - previous) < 1e-3 ? previous : plan;
}
