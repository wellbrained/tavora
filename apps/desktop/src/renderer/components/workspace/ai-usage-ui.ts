import type { MessageKey, Params } from "../../../shared/i18n";
import type { AiUsageState, AiUsageWindow } from "../../../shared/host-api";

// Wording and colours for the AI usage panel, kept apart from the component so
// they can be tested. Percentages are what is left, not what is used.

/** What is left of a window, as a whole percentage from 0 to 100. */
export function leftPercent(window: Pick<AiUsageWindow, "usedPercent">): number {
  return Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)));
}

/** The bar's colour: calm while plenty is left, warning when it runs low, red when nearly gone. */
export function barTone(left: number): "ok" | "low" | "empty" {
  if (left <= 10) return "empty";
  if (left <= 30) return "low";
  return "ok";
}

export interface Wording {
  key: MessageKey;
  params?: Params;
}

/** A length of time such as "2d 3h", "4h 05m" or "12m"; under a minute is "<1m". */
export function durationWording(ms: number): Wording {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return { key: "aiUsage.time.less" };
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days >= 1) return { key: "aiUsage.time.dh", params: { d: days, h: hours } };
  if (hours >= 1) return { key: "aiUsage.time.hm", params: { h: hours, m: minutes % 60 } };
  return { key: "aiUsage.time.m", params: { m: minutes } };
}

/** What a window is called: "5-hour", "Weekly · Sonnet", or the provider's own name for other windows. */
export function windowLabel(window: AiUsageWindow, translate: (key: MessageKey, params?: Params) => string): string {
  if (window.kind === "other") return window.name ?? "?";
  const base = translate(window.kind === "five-hour" ? "aiUsage.window.fiveHour" : "aiUsage.window.weekly");
  return window.name ? translate("aiUsage.window.named", { window: base, name: window.name }) : base;
}

export const STATE_TEXT: Readonly<Record<Exclude<AiUsageState, "ready">, MessageKey>> = {
  waiting: "aiUsage.state.waiting",
  "sign-in": "aiUsage.state.signIn",
  "rate-limited": "aiUsage.state.rateLimited",
  unavailable: "aiUsage.state.unavailable",
  "cli-missing": "aiUsage.state.cliMissing",
};
