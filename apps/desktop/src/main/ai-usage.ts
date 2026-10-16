import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AiProvider, AiUsageAccount, AiUsageState, AiUsageStyle, AiUsageView, AiUsageWindow } from "../shared/host-api";
import { claudeAccessToken, claudePlan, codexPlan, parseClaudeWindows, parseCodexResets, parseCodexWindows, parseEmail } from "./ai-usage-parse";
import { CodexMissingError, type CodexReading } from "./ai-usage-codex";
import { PlayerError } from "./messages";

// The AI usage panel's data: how much of each Claude and Codex subscription's
// allowance is left. Tavora's main process reads it, because modules have no
// network and no files. Claude: one request to Anthropic's usage address with
// the access token of the profile's login, held in memory for that request
// only. Codex: its own command line (ai-usage-codex.ts). Tokens never reach the
// host UI and are never saved; ai-usage.json holds only account names, folders
// and the last readings. Readings are taken only while a panel is open.

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const MAX_ACCOUNTS = 20;
export const MAX_LABEL = 60;
export const DEFAULT_MINUTES = 5;
/** How often the schedule looks for accounts that are due. */
export const TICK_MS = 30_000;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_BACKOFF_MS = 24 * 3_600_000;
const DEFAULT_RETRY_MS = 600_000;

interface StoredAccount {
  id: string;
  provider: AiProvider;
  label: string;
  directory: string;
}

interface StoredReading {
  fetchedAt: number;
  windows: AiUsageWindow[];
}

interface Stored {
  version: 1;
  refreshMinutes: number;
  style: AiUsageStyle;
  accounts: StoredAccount[];
  readings: Record<string, StoredReading>;
}

interface Runtime {
  state: AiUsageState;
  plan: string | null;
  /** Kept in memory only, never saved. */
  email: string | null;
  resets: { available: number; earliestExpiry: number | null } | null;
  failures: number;
  /** When the account may be read again on its own. */
  next: number;
  /** A provider's own wait time; a manual refresh respects it too. */
  blockedUntil: number;
}

export interface AiUsageDeps {
  /** Where ai-usage.json lives. */
  file: string;
  /** Tavora's version, sent as the user agent and to Codex. */
  version: string;
  fetch: typeof fetch;
  /** The text of a file, or null when it does not exist or can't be read. */
  readText(file: string): Promise<string | null>;
  isDirectory(directory: string): Promise<boolean>;
  writeText(file: string, text: string): Promise<void>;
  readCodex(directory: string, signal: AbortSignal): Promise<CodexReading>;
  /** Profile folders found on this PC, offered the first time only. */
  detect(): Promise<{ provider: AiProvider; directory: string }[]>;
  now(): number;
  onChange(view: AiUsageView): void;
}

const clampMinutes = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? Math.min(60, Math.max(1, value)) : DEFAULT_MINUTES);
const sameFolder = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

function labelFor(directory: string, provider: AiProvider): string {
  const name = path.basename(directory).replace(/^\./, "");
  return (name === "" ? provider : name).slice(0, MAX_LABEL);
}

function parseStored(text: string | null): Stored | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const file = raw as Record<string, unknown>;
  const accounts: StoredAccount[] = [];
  for (const item of Array.isArray(file.accounts) ? file.accounts.slice(0, MAX_ACCOUNTS) : []) {
    const a = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof a.id !== "string" || a.id.length > 64 || (a.provider !== "claude" && a.provider !== "codex")) continue;
    if (typeof a.label !== "string" || a.label.trim() === "" || a.label.length > MAX_LABEL) continue;
    if (typeof a.directory !== "string" || !path.isAbsolute(a.directory) || a.directory.length > 500) continue;
    accounts.push({ id: a.id, provider: a.provider, label: a.label, directory: a.directory });
  }
  const readings: Record<string, StoredReading> = {};
  const rawReadings = (typeof file.readings === "object" && file.readings !== null ? file.readings : {}) as Record<string, unknown>;
  for (const account of accounts) {
    const r = rawReadings[account.id] as Record<string, unknown> | undefined;
    if (!r || typeof r.fetchedAt !== "number" || !Number.isFinite(r.fetchedAt) || !Array.isArray(r.windows)) continue;
    const windows = r.windows.filter(isWindow).slice(0, 30);
    readings[account.id] = { fetchedAt: r.fetchedAt, windows };
  }
  return { version: 1, refreshMinutes: clampMinutes(file.refreshMinutes), style: file.style === "used" ? "used" : "remaining", accounts, readings };
}

function isWindow(value: unknown): value is AiUsageWindow {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    (w.kind === "five-hour" || w.kind === "weekly" || w.kind === "other") &&
    (w.name === null || (typeof w.name === "string" && w.name.length <= 80)) &&
    typeof w.usedPercent === "number" &&
    w.usedPercent >= 0 &&
    w.usedPercent <= 100 &&
    (w.resetsAt === null || (typeof w.resetsAt === "number" && Number.isFinite(w.resetsAt)))
  );
}

/** The result of reading one account once. */
interface Outcome {
  state: AiUsageState;
  windows?: AiUsageWindow[];
  /** Milliseconds to wait at least, when the provider asked. */
  retryAfter?: number;
}

export class AiUsage {
  private stored: Stored = { version: 1, refreshMinutes: DEFAULT_MINUTES, style: "remaining", accounts: [], readings: {} };
  private readonly runtime = new Map<string, Runtime>();
  private loaded: Promise<void> | undefined;
  private wanted = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing = false;
  private abort: AbortController | undefined;

  constructor(private readonly deps: AiUsageDeps) {}

  /** Loads the saved accounts once; the first time ever, offers the profile folders found on this PC. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = parseStored(await this.deps.readText(this.deps.file));
      if (saved) {
        this.stored = saved;
      } else {
        const found = await this.deps.detect().catch(() => []);
        this.stored.accounts = found.slice(0, MAX_ACCOUNTS).map(({ provider, directory }) => ({ id: randomUUID(), provider, label: labelFor(directory, provider), directory }));
        await this.save();
      }
      await Promise.all(this.stored.accounts.map((account) => this.refreshPlan(account)));
      this.emit();
    })();
    return this.loaded;
  }

  /** The accounts and what is known about them. Loads the saved accounts first. */
  async view(): Promise<AiUsageView> {
    await this.load();
    return this.snapshot();
  }

  private snapshot(): AiUsageView {
    const now = this.deps.now();
    const overdue = this.stored.refreshMinutes * 60_000 * 2.5;
    return {
      refreshMinutes: this.stored.refreshMinutes,
      refreshing: this.refreshing,
      style: this.stored.style,
      accounts: this.stored.accounts.map((account): AiUsageAccount => {
        const state = this.runtime.get(account.id);
        const reading = this.stored.readings[account.id];
        const current = state?.state ?? "waiting";
        return {
          id: account.id,
          provider: account.provider,
          label: account.label,
          directory: account.directory,
          plan: state?.plan ?? null,
          state: current,
          fetchedAt: reading?.fetchedAt ?? null,
          // Last known usage, not a current promise: older than expected, or the newest try failed.
          stale: reading !== undefined && (current !== "ready" || now - reading.fetchedAt > overdue),
          windows: reading?.windows ?? [],
          email: state?.email ?? null,
          // Only a fresh reading says how many resets there are; an old one would be a guess.
          resets: current === "ready" ? (state?.resets ?? null) : null,
        };
      }),
    };
  }

  private emit(): void {
    this.deps.onChange(this.snapshot());
  }

  private async save(): Promise<void> {
    await this.deps.writeText(this.deps.file, JSON.stringify(this.stored, null, 2)).catch((error) => console.error("[tavora] ai-usage save failed", error));
  }

  // ── Panels ───────────────────────────────────────────────────────────

  /** Readings are taken only while an AI usage panel is open. */
  async setWanted(wanted: boolean): Promise<void> {
    if (this.wanted === wanted) return;
    this.wanted = wanted;
    if (!wanted) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abort?.abort();
      return;
    }
    await this.load();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  dispose(): void {
    this.wanted = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.abort?.abort();
  }

  // ── Reading ──────────────────────────────────────────────────────────

  /** Reads every account that is due. Accounts are read one after the other. */
  async tick(): Promise<void> {
    await this.load();
    const now = this.deps.now();
    await this.readAll((id) => (this.runtime.get(id)?.next ?? 0) <= now);
  }

  /** The refresh button: reads every account now, except those a provider asked Tavora to leave alone for a while. */
  async refreshNow(): Promise<void> {
    await this.load();
    const now = this.deps.now();
    await this.readAll((id) => (this.runtime.get(id)?.blockedUntil ?? 0) <= now);
  }

  private async readAll(due: (id: string) => boolean): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.abort = new AbortController();
    this.emit();
    try {
      for (const account of [...this.stored.accounts]) {
        if (this.abort.signal.aborted) break;
        if (!this.stored.accounts.some((item) => item.id === account.id) || !due(account.id)) continue;
        await this.readOne(account);
        this.emit();
      }
    } finally {
      this.refreshing = false;
      this.abort = undefined;
      this.emit();
    }
  }

  private async readOne(account: StoredAccount): Promise<void> {
    const signal = AbortSignal.any([this.abort!.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    let outcome: Outcome;
    try {
      outcome = account.provider === "claude" ? await this.readClaude(account, signal) : await this.readCodex(account, signal);
    } catch (error) {
      // Details can hold paths or provider text; only the kind of failure is kept.
      outcome = { state: error instanceof CodexMissingError ? "cli-missing" : "unavailable" };
    }
    // The account may have been removed or changed while the request was out.
    const current = this.stored.accounts.find((item) => item.id === account.id);
    if (!current || current.directory !== account.directory) return;
    const now = this.deps.now();
    const runtime = this.runtimeFor(account.id);
    runtime.state = outcome.state;
    runtime.failures = outcome.state === "ready" ? 0 : Math.min(runtime.failures + 1, 6);
    const wait = Math.min(this.stored.refreshMinutes * 60_000 * 2 ** runtime.failures, MAX_BACKOFF_MS);
    runtime.next = now + Math.max(wait, outcome.retryAfter ?? 0);
    runtime.blockedUntil = outcome.retryAfter ? now + outcome.retryAfter : 0;
    // A failure keeps the last good reading, which then shows as stale.
    if (outcome.state === "ready" && outcome.windows) this.stored.readings[account.id] = { fetchedAt: now, windows: outcome.windows };
    await this.save();
  }

  private async readClaude(account: StoredAccount, signal: AbortSignal): Promise<Outcome> {
    const credentials = await this.credentials(account);
    this.runtimeFor(account.id).plan = claudePlan(credentials);
    const token = claudeAccessToken(credentials);
    if (!token) return { state: "sign-in" };
    const response = await this.deps.fetch(USAGE_URL, {
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "x-app": "cli",
        "user-agent": `Tavora/${this.deps.version}`,
      },
    });
    if (response.status === 401 || response.status === 403) return { state: "sign-in" };
    if (response.status === 429) return { state: "rate-limited", retryAfter: retryAfter(response.headers.get("retry-after"), this.deps.now()) };
    if (!response.ok) return { state: "unavailable" };
    const windows = parseClaudeWindows(await response.json());
    return windows.length > 0 ? { state: "ready", windows } : { state: "unavailable" };
  }

  private async readCodex(account: StoredAccount, signal: AbortSignal): Promise<Outcome> {
    this.runtimeFor(account.id).plan = codexPlan(await this.credentials(account));
    const reading = await this.deps.readCodex(account.directory, signal);
    const runtime = this.runtimeFor(account.id);
    runtime.email = parseEmail(reading.email);
    runtime.resets = parseCodexResets(reading.limits);
    if (!reading.signedIn) return { state: "sign-in" };
    if (reading.apiKey) return { state: "unavailable" };
    const windows = parseCodexWindows(reading.limits);
    return windows.length > 0 ? { state: "ready", windows } : { state: "unavailable" };
  }

  /** The profile's saved login file, parsed. Only this process reads it; nothing from it is kept but the plan. */
  private async credentials(account: StoredAccount): Promise<unknown> {
    const text = await this.deps.readText(path.join(account.directory, account.provider === "claude" ? ".credentials.json" : "auth.json"));
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private async refreshPlan(account: StoredAccount): Promise<void> {
    const credentials = await this.credentials(account);
    this.runtimeFor(account.id).plan = account.provider === "claude" ? claudePlan(credentials) : codexPlan(credentials);
  }

  private runtimeFor(id: string): Runtime {
    let runtime = this.runtime.get(id);
    if (!runtime) {
      runtime = { state: "waiting", plan: null, email: null, resets: null, failures: 0, next: 0, blockedUntil: 0 };
      this.runtime.set(id, runtime);
    }
    return runtime;
  }

  // ── Accounts ─────────────────────────────────────────────────────────

  private async checkAccount(label: string, directory: string, provider: AiProvider, except?: string): Promise<{ label: string; directory: string }> {
    const name = label.trim();
    // eslint-disable-next-line no-control-regex
    if (name === "" || name.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(name)) throw new PlayerError("aiUsage.error.label");
    if (!path.isAbsolute(directory) || directory.length > 500 || !(await this.deps.isDirectory(directory))) throw new PlayerError("aiUsage.error.directory");
    const normalized = path.resolve(directory);
    if (this.stored.accounts.some((item) => item.id !== except && item.provider === provider && sameFolder(item.directory, normalized))) throw new PlayerError("aiUsage.error.duplicate");
    return { label: name, directory: normalized };
  }

  async add(provider: AiProvider, label: string, directory: string): Promise<void> {
    await this.load();
    if (this.stored.accounts.length >= MAX_ACCOUNTS) throw new PlayerError("aiUsage.error.limit");
    const checked = await this.checkAccount(label, directory, provider);
    const account: StoredAccount = { id: randomUUID(), provider, ...checked };
    this.stored.accounts.push(account);
    await this.refreshPlan(account);
    await this.save();
    this.emit();
    if (this.wanted) void this.tick();
  }

  async update(id: string, label: string, directory: string): Promise<void> {
    await this.load();
    const account = this.stored.accounts.find((item) => item.id === id);
    if (!account) throw new PlayerError("aiUsage.error.unknown");
    const checked = await this.checkAccount(label, directory, account.provider, id);
    const moved = !sameFolder(account.directory, checked.directory);
    account.label = checked.label;
    account.directory = checked.directory;
    if (moved) {
      // Another folder is another login: the old reading does not apply.
      delete this.stored.readings[id];
      this.runtime.delete(id);
      await this.refreshPlan(account);
    }
    await this.save();
    this.emit();
    if (moved && this.wanted) void this.tick();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    const before = this.stored.accounts.length;
    this.stored.accounts = this.stored.accounts.filter((item) => item.id !== id);
    if (this.stored.accounts.length === before) throw new PlayerError("aiUsage.error.unknown");
    delete this.stored.readings[id];
    this.runtime.delete(id);
    await this.save();
    this.emit();
  }

  async setStyle(style: AiUsageStyle): Promise<void> {
    await this.load();
    this.stored.style = style === "used" ? "used" : "remaining";
    await this.save();
    this.emit();
  }

  async setInterval(minutes: number): Promise<void> {
    await this.load();
    this.stored.refreshMinutes = clampMinutes(minutes);
    await this.save();
    this.emit();
  }
}

/** Retry-After as milliseconds: seconds or a date; ten minutes when the provider gave nothing usable. */
function retryAfter(header: string | null, now: number): number {
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), MAX_BACKOFF_MS);
  }
  return DEFAULT_RETRY_MS;
}
