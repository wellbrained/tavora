// Clock formats: a pattern the user types, such as `h:mm:ss` or `m:ss "min"`. Tokens are runs of h, m or s; the
// number of letters is the least number of digits (`mm` pads to two). Text in double quotes, and anything that is
// not h, m or s, is kept as typed. The largest unit in the pattern takes the rest: without an hours token the
// minutes go on past 59, so nothing is lost. Seconds are the smallest unit.

export type Unit = "h" | "m" | "s";
type Part = { kind: "text"; text: string } | { kind: "unit"; unit: Unit; digits: number };

export const MAX_FORMAT = 40;
/** Formats the Format field offers, with the one a new clock gets first. */
export const FORMAT_PRESETS = ["m:ss", "h:mm:ss", "hh:mm:ss", "mm:ss", "s"] as const;
export const DEFAULT_FORMAT = FORMAT_PRESETS[0];

export function parseFormat(pattern: string): Part[] {
  const parts: Part[] = [];
  let text = "";
  const flush = () => {
    if (text) parts.push({ kind: "text", text });
    text = "";
  };
  for (let i = 0; i < pattern.length; ) {
    const char = pattern[i]!;
    if (char === '"') {
      const end = pattern.indexOf('"', i + 1);
      text += end === -1 ? pattern.slice(i + 1) : pattern.slice(i + 1, end);
      i = end === -1 ? pattern.length : end + 1;
    } else if (char === "h" || char === "m" || char === "s") {
      flush();
      let run = 1;
      while (pattern[i + run] === char) run++;
      parts.push({ kind: "unit", unit: char, digits: run });
      i += run;
    } else {
      text += char;
      i++;
    }
  }
  flush();
  return parts;
}

/** Whether a pattern shows any time at all; one without a token falls back to the default. */
export function isFormat(pattern: unknown): pattern is string {
  return typeof pattern === "string" && pattern.length > 0 && pattern.length <= MAX_FORMAT && parseFormat(pattern).some((part) => part.kind === "unit");
}

/** Whole seconds as the pattern shows them. */
export function formatSeconds(totalSeconds: number, pattern: string): string {
  const parts = parseFormat(isFormat(pattern) ? pattern : DEFAULT_FORMAT);
  const has = (unit: Unit) => parts.some((part) => part.kind === "unit" && part.unit === unit);
  const total = Math.max(0, Math.floor(totalSeconds));
  const values: Record<Unit, number> = { h: 0, m: 0, s: 0 };
  let rest = total;
  if (has("h")) {
    values.h = Math.floor(rest / 3600);
    rest -= values.h * 3600;
  }
  if (has("m")) {
    values.m = Math.floor(rest / 60);
    rest -= values.m * 60;
  }
  values.s = rest;
  // A pattern with hours and seconds but no minutes keeps the minutes in the seconds.
  return parts.map((part) => (part.kind === "text" ? part.text : String(values[part.unit]).padStart(part.digits, "0"))).join("");
}
