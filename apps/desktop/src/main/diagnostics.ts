// What "Copy diagnostic info" puts on the clipboard, so a tester can paste it to
// whoever is helping. Nothing here is sent anywhere: it is text the player
// copies and shares on purpose. It holds versions, counts, timings and the
// last errors, never game or module names, notes or the player's folders.
import os from "node:os";

/** Lines kept: enough to see what went wrong lately, little enough to paste. */
const ERRORS_KEPT = 20;
const SAMPLES_KEPT = 20;
const LINE_MAX = 400;

/** Replaces the player's folders and user name, so the report can be shared. */
export function scrub(text: string, folders: { home?: string; userData?: string } = {}): string {
  let out = text;
  // Longest first: the data folder usually sits inside the home folder.
  const known = [folders.userData, folders.home].filter((folder): folder is string => !!folder && folder.length > 3).sort((a, b) => b.length - a.length);
  for (const folder of known) {
    const label = folder === folders.userData ? "<data>" : "<home>";
    for (const variant of new Set([folder, folder.replaceAll("\\", "/"), folder.replaceAll("\\", "\\\\")])) out = out.split(variant).join(label);
  }
  return out
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"')\]]+/gi, "<home>")
    .replace(/\/(?:Users|home)\/[^/\s"')\]]+/g, "<home>");
}

function describe(value: unknown): string {
  if (value instanceof Error) return [`${value.name}: ${value.message}`, ...(value.stack ?? "").split("\n").slice(1, 4).map((line) => line.trim())].join(" | ");
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The last few errors and warnings of this run, oldest first. */
export class ErrorLog {
  private lines: string[] = [];

  add(level: "error" | "warn", args: unknown[], now = new Date()): void {
    const text = args.map(describe).join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    this.lines.push(`${now.toISOString()} ${level} ${text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)}…` : text}`);
    if (this.lines.length > ERRORS_KEPT) this.lines.shift();
  }

  recent(): string[] {
    return [...this.lines];
  }

  /** Records what console.error and console.warn print, from now on. */
  capture(target: Pick<Console, "error" | "warn"> = console): void {
    for (const level of ["error", "warn"] as const) {
      const original = target[level].bind(target);
      target[level] = (...args: unknown[]) => {
        this.add(level, args);
        original(...args);
      };
    }
  }
}

export interface TimingSummary {
  name: string;
  count: number;
  last: number;
  median: number;
  max: number;
}

/** How long the things a player waits for took, in milliseconds. */
export class Timings {
  private samples = new Map<string, number[]>();

  record(name: string, ms: number): void {
    const list = this.samples.get(name) ?? [];
    list.push(Math.round(ms));
    if (list.length > SAMPLES_KEPT) list.shift();
    this.samples.set(name, list);
  }

  summary(): TimingSummary[] {
    return [...this.samples].map(([name, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return { name, count: list.length, last: list[list.length - 1]!, median: sorted[Math.floor(sorted.length / 2)]!, max: sorted[sorted.length - 1]! };
    });
  }
}

export const errorLog = new ErrorLog();
export const timings = new Timings();

export interface ReportInput {
  version: string;
  packaged: boolean;
  electron: string;
  chrome: string;
  locale: string;
  osName?: string;
  /** Counts only. */
  games: number;
  panels: number;
  /** The update log's last lines, oldest first. */
  updateLog: string[];
  errors: string[];
  timings: TimingSummary[];
  uptimeSeconds: number;
  folders: { home?: string; userData?: string };
}

/** The text to copy. */
export function buildReport(input: ReportInput): string {
  const lines = [
    "Tavora diagnostic info",
    `Version: ${input.version}${input.packaged ? "" : " (development run)"}`,
    `System: ${input.osName ?? `${os.version()} ${os.release()}`} (${os.arch()}), language ${input.locale}`,
    `Electron ${input.electron}, Chrome ${input.chrome}`,
    `Games: ${input.games}, panels open: ${input.panels}, running for ${Math.round(input.uptimeSeconds)} s`,
    "",
    "Timings in ms (median, latest, slowest, count):",
    ...(input.timings.length ? input.timings.map((t) => `  ${t.name}: ${t.median}, ${t.last}, ${t.max}, ${t.count}x`) : ["  none yet"]),
    "",
    "Updates:",
    ...(input.updateLog.length ? input.updateLog.map((line) => `  ${line}`) : ["  nothing logged"]),
    "",
    "Last errors:",
    ...(input.errors.length ? input.errors.map((line) => `  ${line}`) : ["  none"]),
    "",
  ];
  return scrub(lines.join("\n"), input.folders);
}
