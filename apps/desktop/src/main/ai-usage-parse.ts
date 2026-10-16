import type { AiUsageWindow } from "../shared/host-api";

// Reads what the Claude usage endpoint and the Codex app-server answer, and the
// plan from a profile's saved login. Pure functions: nothing here touches the
// disk or the network, and nothing from an answer is kept but numbers and a few
// short names. The Claude endpoint is not documented and may change; anything
// unrecognised is dropped, never shown as zero.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_NAME = 40;

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

/** Windows of the usage answer: the self-describing `limits` list first, the older flat fields when it has none. */
export function parseClaudeWindows(root: unknown): AiUsageWindow[] {
  if (!isObject(root)) return [];
  const windows: AiUsageWindow[] = [];
  if (Array.isArray(root.limits)) {
    for (const limit of root.limits) {
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
  const flat: [string, AiUsageWindow["kind"], string | null][] = [
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

function durationWindow(minutes: number, name: string | null): Pick<AiUsageWindow, "kind" | "name"> {
  if (minutes === 300) return { kind: "five-hour", name };
  if (minutes === 10_080) return { kind: "weekly", name };
  const size =
    minutes % 10_080 === 0 ? `${minutes / 10_080}-week` : minutes % 1_440 === 0 ? `${minutes / 1_440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
  return { kind: "other", name: name ? `${size} · ${name}` : size };
}

function codexBucket(windows: AiUsageWindow[], bucket: unknown, key: string): void {
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
    const seconds = window.resetsAt;
    // Unix seconds, within the range a Date can hold.
    const resetsAt = typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0 && seconds <= 253_402_300_799 ? seconds * 1000 : null;
    const shape = minutes > 0 ? durationWindow(minutes, name) : ({ kind: "other", name: name ?? slot } as const);
    windows.push({ ...shape, usedPercent: used, resetsAt });
  }
}

/** Windows of Codex's `account/rateLimits/read` answer: every bucket it lists, or the single older one. */
export function parseCodexWindows(root: unknown): AiUsageWindow[] {
  if (!isObject(root)) return [];
  const windows: AiUsageWindow[] = [];
  if (isObject(root.rateLimitsByLimitId)) {
    for (const [key, bucket] of Object.entries(root.rateLimitsByLimitId).slice(0, 20)) codexBucket(windows, bucket, key);
  }
  if (windows.length === 0) codexBucket(windows, root.rateLimits, "codex");
  return windows;
}

const PLAN_NAMES: Readonly<Record<string, string>> = {
  free: "Free",
  pro: "Pro",
  plus: "Plus",
  max: "Max",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  go: "Go",
};

function planName(value: unknown): string | null {
  return typeof value === "string" ? (PLAN_NAMES[value.toLowerCase()] ?? null) : null;
}

/** The plan in a Claude profile's `.credentials.json`; only a fixed list of names is ever shown. */
export function claudePlan(credentials: unknown): string | null {
  const oauth = isObject(credentials) && isObject(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null;
  if (!oauth) return null;
  if (typeof oauth.subscriptionType === "string" && oauth.subscriptionType.toLowerCase() === "max") {
    if (oauth.rateLimitTier === "default_claude_max_5x") return "Max 5×";
    if (oauth.rateLimitTier === "default_claude_max_20x") return "Max 20×";
    return "Max";
  }
  return planName(oauth.subscriptionType);
}

/**
 * The plan in a Codex profile's `auth.json`: the plan claim of the saved ID
 * token. This is only a label. The token is not checked or sent anywhere.
 */
export function codexPlan(auth: unknown): string | null {
  if (!isObject(auth)) return null;
  if (auth.auth_mode === "apikey") return "API key";
  const token = isObject(auth.tokens) ? auth.tokens.id_token : null;
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const claim = isObject(claims) ? claims["https://api.openai.com/auth"] : null;
    return isObject(claim) ? planName(claim.chatgpt_plan_type) : null;
  } catch {
    return null;
  }
}

/** The access token of a Claude profile's `.credentials.json`, or null. It is used for one request and never stored. */
export function claudeAccessToken(credentials: unknown): string | null {
  const oauth = isObject(credentials) && isObject(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null;
  const token = oauth?.accessToken;
  return typeof token === "string" && token.trim() !== "" && token.length <= 4096 ? token : null;
}
