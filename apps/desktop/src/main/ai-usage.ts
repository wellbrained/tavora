import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AiUsageAccountInfo, AiUsageReading, JsonValue } from "@tavora/sdk/protocol";
import { LIMITS } from "@tavora/sdk/protocol";
import type { AiProvider, AiUsageView } from "../shared/host-api";
import { claudeAccessToken, claudePlan, codexPlan, parseEmail } from "./ai-usage-parse";
import { CodexMissingError, type CodexReading } from "./ai-usage-codex";
import { HostError } from "./errors";
import { isJsonValue } from "./json";
import { PlayerError } from "./messages";

// The AI Usage connector (docs/decisions.md, AI Usage rows of 2026-10-17): the Claude and Codex
// accounts the player set up in Settings > Integrations, and their usage read for a granted module.
// Claude: one request to Anthropic's usage address with the access token of the profile's login,
// held in memory for that request only. Codex: its own command line (ai-usage-codex.ts). Tokens
// never leave this process: a module gets the provider's answer, the plan and the email, nothing
// else. ai-usage.json holds only account names and folders. Each account is read at most once a
// minute for every module together, so no module can flood a provider with the player's login.

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const MAX_ACCOUNTS = 20;
export const MAX_LABEL = 60;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_WAIT_MS = 24 * 3_600_000;
const DEFAULT_RETRY_MS = 600_000;
/** A provider's answer is a few kilobytes; one far bigger is not passed on. */
export const MAX_ANSWER_BYTES = 256 * 1024;

interface StoredAccount {
  id: string;
  provider: AiProvider;
  label: string;
  directory: string;
}

interface Stored {
  version: 2;
  accounts: StoredAccount[];
}

/**
 * What version 1 of ai-usage.json kept for the built-in panel (before 0.16.10): handed to the AI
 * Usage module's settings once, then dropped from the file.
 */
export interface LegacyPanelData {
  refreshMinutes: number;
  style: "remaining" | "used";
  readings: Record<string, { fetchedAt: number; windows: JsonValue[] }>;
}

export interface AiUsageDeps {
  /** Where ai-usage.json lives. */
  file: string;
  /** Tavora's version, sent as the user agent. */
  version: string;
  /** Where Claude's usage is asked; only tests change it. */
  usageUrl?: string;
  fetch: typeof fetch;
  /** The text of a file, or null when it does not exist or can't be read. */
  readText(file: string): Promise<string | null>;
  isDirectory(directory: string): Promise<boolean>;
  writeText(file: string, text: string): Promise<void>;
  readCodex(directory: string, signal: AbortSignal): Promise<CodexReading>;
  /** Who is signed in to a Claude profile (ai-usage-claude.ts), or null. */
  readClaudeEmail(directory: string): Promise<string | null>;
  /** Profile folders found on this PC, offered the first time only. */
  detect(): Promise<{ provider: AiProvider; directory: string }[]>;
  now(): number;
  /** The accounts changed: Settings shows them anew and granted modules are told. */
  onChange(view: AiUsageView): void;
}

/** The last reading of an account, and what is under way for it. */
interface AccountState {
  reading?: AiUsageReading;
  /** When it was taken, for the once-a-minute limit. */
  at: number;
  pending?: Promise<AiUsageReading>;
  /** A provider's own wait time. */
  blockedUntil: number;
}

const sameFolder = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

function labelFor(directory: string, provider: AiProvider): string {
  const name = path.basename(directory).replace(/^\./, "");
  return (name === "" ? provider : name).slice(0, MAX_LABEL);
}

function parseAccounts(file: Record<string, unknown>): StoredAccount[] {
  const accounts: StoredAccount[] = [];
  for (const item of Array.isArray(file.accounts) ? file.accounts.slice(0, MAX_ACCOUNTS) : []) {
    const a = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof a.id !== "string" || a.id.length > 64 || (a.provider !== "claude" && a.provider !== "codex")) continue;
    if (typeof a.label !== "string" || a.label.trim() === "" || a.label.length > MAX_LABEL) continue;
    if (typeof a.directory !== "string" || !path.isAbsolute(a.directory) || a.directory.length > 500) continue;
    if (accounts.some((other) => other.id === a.id)) continue;
    accounts.push({ id: a.id, provider: a.provider, label: a.label, directory: a.directory });
  }
  return accounts;
}

/** What version 1 kept for the panel, or null when the file has none of it. */
function parseLegacy(file: Record<string, unknown>, accounts: StoredAccount[]): LegacyPanelData | null {
  if (file.version !== 1) return null;
  const minutes = file.refreshMinutes;
  const readings: LegacyPanelData["readings"] = {};
  const raw = (typeof file.readings === "object" && file.readings !== null ? file.readings : {}) as Record<string, unknown>;
  for (const account of accounts) {
    const r = raw[account.id] as Record<string, unknown> | undefined;
    if (!r || typeof r.fetchedAt !== "number" || !Number.isFinite(r.fetchedAt) || !Array.isArray(r.windows) || !isJsonValue(r.windows)) continue;
    readings[account.id] = { fetchedAt: r.fetchedAt, windows: r.windows.slice(0, 30) as JsonValue[] };
  }
  return {
    refreshMinutes: typeof minutes === "number" && Number.isInteger(minutes) ? Math.min(60, Math.max(1, minutes)) : 5,
    style: file.style === "used" ? "used" : "remaining",
    readings,
  };
}

/** Retry-After as milliseconds: seconds or a date; ten minutes when the provider gave nothing usable. */
function retryAfter(header: string | null, now: number): number {
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), MAX_WAIT_MS);
  }
  return DEFAULT_RETRY_MS;
}

/** A provider's answer as plain JSON within the size limit, or null. */
function cleanAnswer(value: unknown): JsonValue | null {
  if (!isJsonValue(value)) return null;
  return JSON.stringify(value).length <= MAX_ANSWER_BYTES ? value : null;
}

/** What one read found out; the rest of the reading is filled in by `reading`. */
interface Outcome {
  status: AiUsageReading["status"];
  retryAfterMs?: number;
  answer?: JsonValue;
  email?: string | null;
}

export class AiUsageConnector {
  private accounts: StoredAccount[] = [];
  private legacy: LegacyPanelData | null = null;
  private readonly plans = new Map<string, string | null>();
  private readonly states = new Map<string, AccountState>();
  private loaded: Promise<void> | undefined;

  constructor(private readonly deps: AiUsageDeps) {}

  /** Loads the saved accounts once; the first time ever, offers the profile folders found on this PC. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const text = await this.deps.readText(this.deps.file);
      let file: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = text === null ? null : JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) file = parsed as Record<string, unknown>;
      } catch {
        // A damaged file starts empty, like a missing one would not: nothing is offered again.
        file = {};
      }
      if (file) {
        this.accounts = parseAccounts(file);
        this.legacy = parseLegacy(file, this.accounts);
      } else {
        const found = await this.deps.detect().catch(() => []);
        this.accounts = found.slice(0, MAX_ACCOUNTS).map(({ provider, directory }) => ({ id: randomUUID(), provider, label: labelFor(directory, provider), directory }));
        await this.save();
      }
      await Promise.all(this.accounts.map((account) => this.refreshPlan(account)));
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    const stored: Stored = { version: 2, accounts: this.accounts };
    await this.deps.writeText(this.deps.file, JSON.stringify(stored, null, 2)).catch((error: unknown) => console.error("[tavora] ai-usage save failed", error));
  }

  private emit(): void {
    this.deps.onChange(this.snapshot());
  }

  private snapshot(): AiUsageView {
    return { accounts: this.accounts.map((account) => ({ ...account, plan: this.plans.get(account.id) ?? null })) };
  }

  /** The accounts as Settings shows them. */
  async view(): Promise<AiUsageView> {
    await this.load();
    return this.snapshot();
  }

  // ── Moving the built-in panel's settings ──────────────────────────────

  /** What the built-in panel kept (version 1 of the file), for the AI Usage module; null once handed over. */
  async legacyPanelData(): Promise<LegacyPanelData | null> {
    await this.load();
    return this.legacy;
  }

  /** The panel's settings are with the module now: the file keeps only the accounts. */
  async forgetLegacyPanelData(): Promise<void> {
    await this.load();
    if (!this.legacy) return;
    this.legacy = null;
    await this.save();
  }

  // ── For granted modules ──────────────────────────────────────────────

  /** The accounts, in the player's order, with no folders: a module never learns where a login lives. */
  async accountInfos(): Promise<AiUsageAccountInfo[]> {
    await this.load();
    return this.accounts.map((account) => ({ id: account.id, provider: account.provider, label: account.label, plan: this.plans.get(account.id) ?? null }));
  }

  /** Reads an account's usage, at most once a minute for every module together. */
  async read(accountId: string): Promise<AiUsageReading> {
    await this.load();
    const account = this.accounts.find((item) => item.id === accountId);
    if (!account) throw new HostError("INVALID_PARAMS", "there is no AI account with that id");
    const state = this.stateFor(account.id);
    const now = this.deps.now();
    if (state.pending) return state.pending;
    // The provider's own wait comes first, counted down from now rather than from the last reading.
    if (state.blockedUntil > now) return this.reading(account, { status: "rate-limited", retryAfterMs: state.blockedUntil - now });
    if (state.reading && now - state.at < LIMITS.aiUsageMinReadMs) return state.reading;
    const pending = this.readNow(account).then((reading) => {
      const current = this.accounts.find((item) => item.id === account.id);
      delete state.pending;
      // The account may have moved to another folder while it was read: that reading is not its own.
      if (current && sameFolder(current.directory, account.directory)) {
        state.reading = reading;
        state.at = this.deps.now();
        state.blockedUntil = reading.retryAfterMs !== null ? state.at + reading.retryAfterMs : 0;
      }
      return reading;
    });
    state.pending = pending;
    return pending;
  }

  private async readNow(account: StoredAccount): Promise<AiUsageReading> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return this.reading(account, account.provider === "claude" ? await this.readClaude(account, signal) : await this.readCodex(account, signal));
    } catch (error) {
      // Details can hold paths or provider text; only the kind of failure is passed on.
      return this.reading(account, { status: error instanceof CodexMissingError ? "cli-missing" : "unavailable" });
    }
  }

  private reading(account: StoredAccount, outcome: Outcome): AiUsageReading {
    return {
      status: outcome.status,
      retryAfterMs: outcome.retryAfterMs ?? null,
      answer: outcome.answer ?? null,
      email: outcome.email ?? null,
      plan: this.plans.get(account.id) ?? null,
      readAt: new Date(this.deps.now()).toISOString(),
    };
  }

  private async readClaude(account: StoredAccount, signal: AbortSignal): Promise<Outcome> {
    const credentials = await this.credentials(account);
    this.plans.set(account.id, claudePlan(credentials));
    const token = claudeAccessToken(credentials);
    if (!token) return { status: "sign-in" };
    const email = this.deps.readClaudeEmail(account.directory).catch(() => null);
    const response = await this.deps.fetch(this.deps.usageUrl ?? USAGE_URL, {
      signal,
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "x-app": "cli",
        "user-agent": `Tavora/${this.deps.version}`,
      },
    });
    if (response.status === 401 || response.status === 403) return { status: "sign-in" };
    if (response.status === 429) return { status: "rate-limited", retryAfterMs: retryAfter(response.headers.get("retry-after"), this.deps.now()) };
    if (!response.ok) return { status: "unavailable" };
    const text = await response.text();
    if (text.length > MAX_ANSWER_BYTES) return { status: "unavailable" };
    const answer = cleanAnswer(JSON.parse(text));
    return answer === null ? { status: "unavailable" } : { status: "ok", answer, email: await email };
  }

  private async readCodex(account: StoredAccount, signal: AbortSignal): Promise<Outcome> {
    this.plans.set(account.id, codexPlan(await this.credentials(account)));
    const reading = await this.deps.readCodex(account.directory, signal);
    const email = parseEmail(reading.email);
    if (!reading.signedIn) return { status: "sign-in" };
    if (reading.apiKey) return { status: "api-key", email };
    const answer = cleanAnswer(reading.limits);
    return answer === null ? { status: "unavailable", email } : { status: "ok", answer, email };
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
    this.plans.set(account.id, account.provider === "claude" ? claudePlan(credentials) : codexPlan(credentials));
  }

  private stateFor(id: string): AccountState {
    let state = this.states.get(id);
    if (!state) this.states.set(id, (state = { at: 0, blockedUntil: 0 }));
    return state;
  }

  // ── Accounts (Settings > Integrations) ───────────────────────────────

  private async checkAccount(label: string, directory: string, provider: AiProvider, except?: string): Promise<{ label: string; directory: string }> {
    const name = label.trim();
    // eslint-disable-next-line no-control-regex
    if (name === "" || name.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(name)) throw new PlayerError("aiUsage.error.label");
    if (!path.isAbsolute(directory) || directory.length > 500 || !(await this.deps.isDirectory(directory))) throw new PlayerError("aiUsage.error.directory");
    const normalized = path.resolve(directory);
    if (this.accounts.some((item) => item.id !== except && item.provider === provider && sameFolder(item.directory, normalized))) throw new PlayerError("aiUsage.error.duplicate");
    return { label: name, directory: normalized };
  }

  async add(provider: AiProvider, label: string, directory: string): Promise<void> {
    await this.load();
    if (this.accounts.length >= MAX_ACCOUNTS) throw new PlayerError("aiUsage.error.limit");
    const checked = await this.checkAccount(label, directory, provider);
    const account: StoredAccount = { id: randomUUID(), provider, ...checked };
    this.accounts.push(account);
    await this.refreshPlan(account);
    await this.save();
    this.emit();
  }

  async update(id: string, label: string, directory: string): Promise<void> {
    await this.load();
    const account = this.accounts.find((item) => item.id === id);
    if (!account) throw new PlayerError("aiUsage.error.unknown");
    const checked = await this.checkAccount(label, directory, account.provider, id);
    const moved = !sameFolder(account.directory, checked.directory);
    account.label = checked.label;
    account.directory = checked.directory;
    if (moved) {
      // Another folder is another login: the last reading does not apply.
      this.states.delete(id);
      await this.refreshPlan(account);
    }
    await this.save();
    this.emit();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((item) => item.id !== id);
    if (this.accounts.length === before) throw new PlayerError("aiUsage.error.unknown");
    this.states.delete(id);
    this.plans.delete(id);
    await this.save();
    this.emit();
  }
}
