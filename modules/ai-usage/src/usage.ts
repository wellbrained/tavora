// What AI Usage reads from the providers' answers and how it shows them. Pure functions: the
// ai-usage connector hands over each answer as it came, and only numbers and a few short names are
// kept from it. Claude's usage answer is not documented and may change; anything unrecognised is
// dropped, never shown as zero.

import type { AiUsageAccountInfo } from "@tavora/sdk";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_NAME = 40;

/**
 * One allowance window of a subscription. `five-hour` and `weekly` are worded by the panel; `other`
 * windows (an odd duration) use `name` as their whole label.
 */
export interface UsageWindow {
  kind: "five-hour" | "weekly" | "other";
  /** The model or limit the window is for, such as "Sonnet"; null for the plain window. */
  name: string | null;
  /** 0 to 100, as the provider reported it. */
  usedPercent: number;
  /** Milliseconds since 1970, or null when the provider gave no reset time. */
  resetsAt: number | null;
}

/** Codex's manual resets: how many are left and when the first expires. */
export interface Resets {
  available: number;
  earliestExpiry: number | null;
}

/** A percentage the provider reported, or null when it is missing or out of range. */
function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** A short name from the provider, shown as plain text: control characters removed, length capped. */
function shortName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return cleaned === "" ? null : cleaned.slice(0, MAX_NAME);
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Unix seconds within the range a Date can hold, as milliseconds; null otherwise. */
function unixSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 253_402_300_799 ? value * 1000 : null;
}

/** Windows of Claude's usage answer: the self-describing `limits` list first, the older flat fields when it has none. */
export function parseClaudeWindows(root: unknown): UsageWindow[] {
  if (!isObject(root)) return [];
  const windows: UsageWindow[] = [];
  if (Array.isArray(root.limits)) {
    for (const limit of root.limits.slice(0, 30)) {
      if (!isObject(limit)) continue;
      const used = percent(limit.percent);
      if (used === null) continue;
      const model = isObject(limit.scope) && isObject(limit.scope.model) ? shortName(limit.scope.model.display_name) : null;
      const resetsAt = parseTime(limit.resets_at);
      // `is_active` marks the limit that binds right now, not whether a window exists, so inactive ones are kept.
      switch (limit.kind) {
        case "session":
          windows.push({ kind: "five-hour", name: model, usedPercent: used, resetsAt });
          break;
        case "weekly_all":
        case "weekly_scoped":
          windows.push({ kind: "weekly", name: model, usedPercent: used, resetsAt });
          break;
        default:
          windows.push({ kind: "other", name: shortName(limit.kind) ?? "?", usedPercent: used, resetsAt });
      }
    }
    if (windows.length > 0) return windows;
  }
  const flat: [string, UsageWindow["kind"], string | null][] = [
    ["five_hour", "five-hour", null],
    ["seven_day", "weekly", null],
    ["seven_day_sonnet", "weekly", "Sonnet"],
    ["seven_day_opus", "weekly", "Opus"],
  ];
  for (const [key, kind, name] of flat) {
    const bucket = root[key];
    if (!isObject(bucket)) continue;
    const used = percent(bucket.utilization);
    if (used === null) continue;
    windows.push({ kind, name, usedPercent: used, resetsAt: parseTime(bucket.resets_at) });
  }
  return windows;
}

function durationWindow(minutes: number, name: string | null): Pick<UsageWindow, "kind" | "name"> {
  if (minutes === 300) return { kind: "five-hour", name };
  if (minutes === 10_080) return { kind: "weekly", name };
  const size =
    minutes % 10_080 === 0 ? `${minutes / 10_080}-week` : minutes % 1_440 === 0 ? `${minutes / 1_440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
  return { kind: "other", name: name ? `${size} · ${name}` : size };
}

function codexBucket(windows: UsageWindow[], bucket: unknown, key: string): void {
  if (!isObject(bucket)) return;
  const title = shortName(bucket.limitName) ?? shortName(key);
  // The plain Codex limit needs no qualifier; extra limits (a model's own) keep theirs.
  const name = title !== null && title.toLowerCase() !== "codex" ? title : null;
  for (const slot of ["primary", "secondary"] as const) {
    const window = bucket[slot];
    if (!isObject(window)) continue;
    const used = percent(window.usedPercent);
    if (used === null) continue;
    const minutes = typeof window.windowDurationMins === "number" && Number.isInteger(window.windowDurationMins) && window.windowDurationMins > 0 ? window.windowDurationMins : 0;
    const shape = minutes > 0 ? durationWindow(minutes, name) : ({ kind: "other", name: name ?? slot } as const);
    windows.push({ ...shape, usedPercent: used, resetsAt: unixSeconds(window.resetsAt) });
  }
}

/** Windows of Codex's `account/rateLimits/read` answer: every bucket it lists, or the single older one. */
export function parseCodexWindows(root: unknown): UsageWindow[] {
  if (!isObject(root)) return [];
  const windows: UsageWindow[] = [];
  if (isObject(root.rateLimitsByLimitId)) {
    for (const [key, bucket] of Object.entries(root.rateLimitsByLimitId).slice(0, 20)) codexBucket(windows, bucket, key);
  }
  if (windows.length === 0) codexBucket(windows, root.rateLimits, "codex");
  return windows;
}

/** Codex's manual resets from the rate-limits answer; null when it says nothing usable, so unknown is never shown as zero. */
export function parseCodexResets(root: unknown): Resets | null {
  const reset = isObject(root) ? root.rateLimitResetCredits : null;
  if (!isObject(reset)) return null;
  const count = reset.availableCount;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 1_000_000) return null;
  let earliest: number | null = null;
  if (Array.isArray(reset.credits)) {
    for (const credit of reset.credits.slice(0, 100)) {
      if (!isObject(credit) || credit.status !== "available") continue;
      const expiry = unixSeconds(credit.expiresAt);
      if (expiry !== null && (earliest === null || expiry < earliest)) earliest = expiry;
    }
  }
  return { available: count, earliestExpiry: earliest };
}

/** The windows of a provider's answer. */
export function windowsOf(provider: AiUsageAccountInfo["provider"], answer: unknown): UsageWindow[] {
  return provider === "claude" ? parseClaudeWindows(answer) : parseCodexWindows(answer);
}

// ── Saved settings ──────────────────────────────────────────────────────

export type UsageStyle = "remaining" | "used";

export interface Settings {
  /** Minutes between readings, 1 to 60. */
  refreshMinutes: number;
  /** Whether bars and numbers show what is left or what is used. */
  style: UsageStyle;
}

export const DEFAULT_MINUTES = 5;
export const INTERVALS = [1, 5, 15, 30, 60] as const;

/** Settings as saved, with anything odd set back to the default. */
export function parseSettings(value: unknown): Settings {
  const saved = isObject(value) ? value : {};
  const minutes = saved.refreshMinutes;
  return {
    refreshMinutes: typeof minutes === "number" && Number.isInteger(minutes) ? Math.min(60, Math.max(1, minutes)) : DEFAULT_MINUTES,
    style: saved.style === "used" ? "used" : "remaining",
  };
}

/** The last good reading of an account, kept so it shows as Last known until the next one. */
export interface SavedReading {
  fetchedAt: number;
  windows: UsageWindow[];
}

export function isWindow(value: unknown): value is UsageWindow {
  if (!isObject(value)) return false;
  return (
    (value.kind === "five-hour" || value.kind === "weekly" || value.kind === "other") &&
    (value.name === null || (typeof value.name === "string" && value.name.length <= 80)) &&
    percent(value.usedPercent) !== null &&
    (value.resetsAt === null || (typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt)))
  );
}

/** Saved readings by account id; also what Tavora moved over from its built-in panel (before 0.16.10). */
export function parseReadings(value: unknown): Record<string, SavedReading> {
  const readings: Record<string, SavedReading> = {};
  if (!isObject(value)) return readings;
  for (const [id, raw] of Object.entries(value).slice(0, 50)) {
    if (!isObject(raw) || typeof raw.fetchedAt !== "number" || !Number.isFinite(raw.fetchedAt) || !Array.isArray(raw.windows)) continue;
    readings[id] = { fetchedAt: raw.fetchedAt, windows: raw.windows.filter(isWindow).slice(0, 30) };
  }
  return readings;
}

/** The saved order: account ids, each once. */
export function parseOrder(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length <= 64))].slice(0, 50) : [];
}

/** Accounts in the player's order; accounts not in it yet keep Tavora's order at the end. */
export function ordered<T extends { id: string }>(accounts: readonly T[], order: readonly string[]): T[] {
  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  return accounts.map((account, index) => ({ account, index })).sort((a, b) => rank(a.account.id) - rank(b.account.id) || a.index - b.index).map(({ account }) => account);
}

/** The order after moving one account up (-1) or down (+1); the full list, so new accounts get a place. */
export function moved(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const next = [...ids];
  const from = next.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

// ── Schedule ────────────────────────────────────────────────────────────

const MAX_WAIT_MS = 24 * 3_600_000;

/** How long to wait before reading an account again on its own: the interval, doubled after each failure, at least a provider's own wait. */
export function nextWait(refreshMinutes: number, failures: number, retryAfterMs: number | null): number {
  const wait = Math.min(refreshMinutes * 60_000 * 2 ** Math.min(failures, 6), MAX_WAIT_MS);
  return Math.max(wait, retryAfterMs ?? 0);
}

/** A reading older than this many intervals shows as Last known. */
export const STALE_INTERVALS = 2.5;

// ── Wording ─────────────────────────────────────────────────────────────

/** What is left of a window, as a whole percentage from 0 to 100. */
export function leftPercent(window: Pick<UsageWindow, "usedPercent">): number {
  return Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)));
}

/** The bar's colour: calm while plenty is left, warning when it runs low, red when nearly gone. */
export function barTone(left: number): "ok" | "low" | "empty" {
  if (left <= 10) return "empty";
  if (left <= 30) return "low";
  return "ok";
}

export type DurationKey = "time.less" | "time.dh" | "time.hm" | "time.m";

/** A length of time such as "2d 3h", "4h 5m" or "12m"; under a minute is "<1m". */
export function durationWording(ms: number): { key: DurationKey; params?: Record<string, number> } {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return { key: "time.less" };
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days >= 1) return { key: "time.dh", params: { d: days, h: hours } };
  if (hours >= 1) return { key: "time.hm", params: { h: hours, m: minutes % 60 } };
  return { key: "time.m", params: { m: minutes } };
}

/** What a window is called: "5-hour", "Weekly · Sonnet", or the provider's own name for other windows. */
export function windowLabel(
  window: UsageWindow,
  translate: (key: "window.fiveHour" | "window.weekly" | "window.named", params?: Record<string, string>) => string,
): string {
  if (window.kind === "other") return window.name ?? "?";
  const base = translate(window.kind === "five-hour" ? "window.fiveHour" : "window.weekly");
  return window.name ? translate("window.named", { window: base, name: window.name }) : base;
}
