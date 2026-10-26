// How the panel writes numbers. Pure, so it is tested on its own. Sizes use 1024 steps like Windows does, so a
// 16 GB memory reads "16 GB" and a "1 TB" drive reads "931 GB", the same as Explorer.
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const formats = new Map<string, Intl.NumberFormat>();

/** A number with a fixed count of decimals in this language (a comma in German). Formatters are kept: they are slow to make. */
export function num(value: number, decimals: number, language = "en"): string {
  const key = `${language}:${decimals}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false });
    formats.set(key, format);
  }
  return format.format(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "42", from 41.6: no decimals in the panel. */
export function percent(value: number, language = "en"): string {
  return num(Math.round(clamp(value, 0, 100)), 0, language);
}

/** "7.5 GB", "120 GB", "1.5 TB": one decimal under 10. */
export function size(bytes: number, language = "en"): string {
  const gb = bytes / GB;
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${num(tb, tb < 10 ? 1 : 0, language)} TB`;
  }
  return `${num(gb, gb < 10 && gb > 0 ? 1 : 0, language)} GB`;
}

/** "3.2 MB/s", "120 MB/s". */
export function speed(bytesPerSec: number, language = "en"): string {
  const mb = bytesPerSec / MB;
  return `${num(mb, mb < 10 ? 1 : 0, language)} MB/s`;
}

/** Tavora's own memory: "180 MB", or "1.2 GB" from a gigabyte on. */
export function memory(bytes: number, language = "en"): string {
  return bytes >= GB ? size(bytes, language) : `${num(bytes / MB, 0, language)} MB`;
}

export type DriveTone = "ok" | "warning" | "danger";

const LOW_BYTES = 20 * GB;

/** Yellow under 10 % or 20 GB free, red under 5 % free. A drive of unknown size has no colour. */
export function driveTone(freeBytes: number | null, totalBytes: number | null): DriveTone {
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return "ok";
  const free = (freeBytes / totalBytes) * 100;
  if (free < 5) return "danger";
  if (free < 10 || freeBytes < LOW_BYTES) return "warning";
  return "ok";
}

/** The share used, 0 to 100, for a bar. */
export function usedPercent(freeBytes: number | null, totalBytes: number | null): number {
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return 0;
  return clamp(100 - (freeBytes / totalBytes) * 100, 0, 100);
}

/** "72": whole degrees Celsius for the temperature next to the usage. */
export function degrees(celsius: number, language = "en"): string {
  return num(Math.round(celsius), 0, language);
}

export type TemperatureTone = "ok" | "warning" | "danger";

/** Yellow from 80 °C, red from 90 °C. */
export function temperatureTone(celsius: number | null): TemperatureTone {
  if (celsius === null) return "ok";
  if (celsius >= 90) return "danger";
  if (celsius >= 80) return "warning";
  return "ok";
}

/** "310 W": whole watts. */
export function watts(value: number, language = "en"): string {
  return `${num(Math.round(value), 0, language)} W`;
}

/** "1905 MHz". */
export function megahertz(value: number, language = "en"): string {
  return `${num(Math.round(value), 0, language)} MHz`;
}

/** "14": whole milliseconds of a ping; "<1" when the answer came faster than Windows can tell. */
export function pingMs(ms: number, language = "en"): string {
  return ms < 1 ? "<1" : num(Math.round(ms), 0, language);
}

/** Yellow from 100 ms. A lost ping has no colour of its own: the panel shows a dash. */
export function pingTone(ms: number | null): DriveTone {
  return ms !== null && ms >= 100 ? "warning" : "ok";
}

/** "0", "1.5", "12": two decimals are too many for a speed that moves every second. */
export function mbit(value: number, language = "en"): string {
  return num(value, value < 10 && value > 0 ? 1 : 0, language);
}

/** "0", "2.5": the share of pings lost; one decimal under 10. */
export function lossPercent(value: number, language = "en"): string {
  return num(value, value < 10 && value > 0 ? 1 : 0, language);
}

/** Yellow from 2 % of the pings lost. */
export function lossTone(value: number): DriveTone {
  return value >= 2 ? "warning" : "ok";
}

export type Verdict = "smooth" | "laggy" | "unstable";

/**
 * How the connection is for playing, from the ping to the internet and the loss of the last 100 pings. Smooth: under
 * 60 ms and under 1 % lost. Laggy: under 120 ms and under 3 %. Unstable: worse. A lost last ping (null) is already in
 * the loss, so then only the loss counts.
 */
export function verdict(internetMs: number | null, loss: number): Verdict {
  const ping = internetMs ?? 0;
  if (ping < 60 && loss < 1) return "smooth";
  if (ping < 120 && loss < 3) return "laggy";
  return "unstable";
}

/** When the last drop in the log ended, or null when there is none (or one still goes on). */
export function lastDropEnd(outages: readonly { end: number | null }[]): number | null {
  let last: number | null = null;
  for (const outage of outages) {
    if (outage.end === null) return null;
    if (last === null || outage.end > last) last = outage.end;
  }
  return last;
}

/** How long a drop lasted: "40 s", "3 min", "1 h 5 min". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

const clocks = new Map<string, Intl.DateTimeFormat>();

/** The time of day in this language: "14:05". */
export function clock(at: number, language = "en"): string {
  let format = clocks.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" });
    clocks.set(language, format);
  }
  return format.format(at);
}

/** Day and time for a drop that was not today: "24 Oct, 14:05". */
export function dayAndClock(at: number, language = "en"): string {
  return `${new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(at)}, ${clock(at, language)}`;
}

/** A month's name in this language: "October", "Oktober". */
export function monthName(at: number, language = "en"): string {
  return new Intl.DateTimeFormat(language, { month: "long" }).format(at);
}

/** A day in this language: "Aug 27", "27. Aug.". */
export function shortDay(at: number, language = "en"): string {
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(at);
}

/** The drops that began today (since midnight on this PC), including one that goes on. */
export function dropsToday(outages: readonly { start: number }[], now: number): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return outages.filter((outage) => outage.start >= midnight.getTime()).length;
}
