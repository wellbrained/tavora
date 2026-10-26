/**
 * The traffic of the system-info connector (systemInfo.traffic): what this PC received and sent this week, this month
 * and in the 3 months before. The numbers are Windows' own, the record behind Settings > Network > Data usage, which
 * Windows keeps whether Tavora runs or not (traffic-windows.ts reads it in the system-info worker). Windows keeps it
 * for 60 days only, so a month is written to traffic.json once it is over: from then on it is known for good, also
 * after its days have left Windows' record. Nothing is read until the System Monitor asks, so with its traffic
 * switched off nothing is read or kept. The TrafficBook below is pure; the reading and the file come in from outside.
 */
import type { SystemTraffic, SystemTrafficPeriod } from "@tavora/sdk/protocol";
import { readJsonOrSetAside } from "./json";
import { writeFileAtomic } from "./fsutil";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back Windows answers: a range that starts more than 60 days ago comes back empty. An hour less, to be safe. */
export const RECORD_MS = 60 * DAY_MS - 60 * 60 * 1000;
/** The months shown before this one. */
export const MONTHS_BEFORE = 3;
/** An answer is used again for this long: the numbers are for weeks and months, and each read takes Windows a moment. */
export const TRAFFIC_FRESH_MS = 5 * 60 * 1000;
/** A month is kept for good this long after it ended, once Windows has written its last hours. */
const SETTLED_MS = DAY_MS;
/** The months kept in the file. */
const KEEP_MONTHS = 12;

/** Bytes received and sent in one range. */
export interface TrafficBytes {
  downBytes: number;
  upBytes: number;
}

/** A range of time, in milliseconds since 1970. */
export interface TrafficRange {
  from: number;
  to: number;
}

/** Reads Windows' record for each range, in order: null for a range it has no record of. Throws when it can't be read. */
export type TrafficReader = (ranges: TrafficRange[]) => Promise<(TrafficBytes | null)[]>;

/** A month that is over, as kept in traffic.json. */
export interface StoredMonth {
  /** "2026-09", in local time. */
  month: string;
  downBytes: number | null;
  upBytes: number | null;
  countedFrom: number | null;
}

/** Where the months that are over live. */
export interface TrafficStore {
  load(): Promise<StoredMonth[]>;
  save(months: StoredMonth[]): void;
}

/** Monday 00:00 of the week `at` is in, local time. */
export function weekStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

/** The 1st, 00:00, of the month `back` months before the one `at` is in, local time. */
export function monthStart(at: number, back = 0): number {
  const day = new Date(at);
  return new Date(day.getFullYear(), day.getMonth() - back, 1).getTime();
}

/** "2026-09" for a time in September 2026, local time. */
export function monthKey(at: number): string {
  const day = new Date(at);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Reads traffic.json's months, keeping only what is well formed. */
export function sanitizeMonths(raw: unknown): StoredMonth[] {
  const list = (raw as { months?: unknown } | null)?.months;
  if (!Array.isArray(list)) return [];
  const months: StoredMonth[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { month, downBytes, upBytes, countedFrom } = item as Record<string, unknown>;
    if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) continue;
    const known = isCount(downBytes) && isCount(upBytes) && isCount(countedFrom);
    months.push(known ? { month, downBytes, upBytes, countedFrom } : { month, downBytes: null, upBytes: null, countedFrom: null });
  }
  return months;
}

/** traffic.json in the data folder. */
export class TrafficFile implements TrafficStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<StoredMonth[]> {
    return sanitizeMonths(await readJsonOrSetAside<unknown>(this.file).catch(() => null));
  }

  save(months: StoredMonth[]): void {
    const body = `${JSON.stringify({ version: 1, months }, null, 2)}\n`;
    this.writing = this.writing.then(() => writeFileAtomic(this.file, body)).catch(() => undefined);
  }

  /** Resolves when everything saved so far is written. */
  flush(): Promise<void> {
    return this.writing;
  }
}

/** One period to show, and how it is found. */
interface Planned {
  start: number;
  end: number;
  /** The month's key when it is over and should be kept. */
  keep: string | null;
  stored: StoredMonth | null;
  /** The range asked of Windows, or null when there is nothing to ask. */
  range: TrafficRange | null;
}

export interface TrafficBookOptions {
  read: TrafficReader;
  store: TrafficStore;
  now?: () => number;
}

/** Answers systemInfo.traffic: the months that are over from the file, the rest from Windows, read at most every 5 minutes. */
export class TrafficBook {
  private months: Map<string, StoredMonth> | null = null;
  private last: { at: number; traffic: SystemTraffic } | null = null;
  private pending: Promise<SystemTraffic> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: TrafficBookOptions) {
    this.now = options.now ?? Date.now;
  }

  read(): Promise<SystemTraffic> {
    const now = this.now();
    if (this.last && now - this.last.at < TRAFFIC_FRESH_MS && now >= this.last.at) return Promise.resolve(this.last.traffic);
    this.pending ??= this.readNow(now).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async readNow(now: number): Promise<SystemTraffic> {
    this.months ??= new Map((await this.options.store.load()).map((month) => [month.month, month]));
    const recordStart = now - RECORD_MS;
    const plan = (start: number, end: number, running: boolean): Planned => {
      const keep = !running && now - end >= SETTLED_MS ? monthKey(start) : null;
      const stored = keep ? (this.months!.get(keep) ?? null) : null;
      const range = stored || end <= recordStart ? null : { from: Math.max(start, recordStart), to: Math.min(end, now) };
      return { start, end: Math.min(end, now), keep, stored, range };
    };
    const planned = [plan(weekStart(now), now, true)];
    for (let back = 0; back <= MONTHS_BEFORE; back++) planned.push(plan(monthStart(now, back), back === 0 ? now : monthStart(now, back - 1), back === 0));

    const ranges = planned.flatMap((item) => (item.range ? [item.range] : []));
    const answers = ranges.length > 0 ? await this.options.read(ranges) : [];
    let next = 0;
    let changed = false;
    const periods = planned.map((item): SystemTrafficPeriod => {
      if (item.stored) return { start: item.start, end: item.end, downBytes: item.stored.downBytes, upBytes: item.stored.upBytes, countedFrom: item.stored.countedFrom };
      const bytes = item.range ? (answers[next++] ?? null) : null;
      const period: SystemTrafficPeriod = bytes
        ? { start: item.start, end: item.end, downBytes: bytes.downBytes, upBytes: bytes.upBytes, countedFrom: item.range!.from }
        : { start: item.start, end: item.end, downBytes: null, upBytes: null, countedFrom: null };
      // A month Windows still has but didn't answer for is asked again next time; one it no longer has stays unknown.
      if (item.keep && (bytes || !item.range)) {
        this.months!.set(item.keep, { month: item.keep, downBytes: period.downBytes, upBytes: period.upBytes, countedFrom: period.countedFrom });
        changed = true;
      }
      return period;
    });
    if (changed) {
      const kept = [...this.months.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, KEEP_MONTHS);
      this.months = new Map(kept.map((month) => [month.month, month]));
      this.options.store.save(kept);
    }
    const traffic: SystemTraffic = { week: periods[0]!, months: periods.slice(1) };
    this.last = { at: now, traffic };
    return traffic;
  }
}
