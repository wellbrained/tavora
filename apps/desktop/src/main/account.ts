import { readFile, rm } from "node:fs/promises";
import type { AccountDevice, AccountPending, AccountView, DeviceOs } from "../shared/host-api";
import type { Language } from "../shared/i18n";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import { PlayerError } from "./messages";

// The player's Tavora account (decided 2026-10-16): an email address, signed
// into with a code mailed to it. The main process talks to the service; the
// host UI only sees the address, the devices and what step a sign-in is at.
// The sign-in token is kept in account.json, encrypted like the Discord sign-in;
// where that is not possible it is kept in memory until Tavora quits. It is not
// part of backups or diagnostic info. Modules learn nothing about the account.

export const ACCOUNT_TIMEOUT_MS = 10_000;

export interface SavedAccount {
  token: string;
  email: string;
  createdAt: string;
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(value);

function savedAccount(value: unknown): SavedAccount | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return isToken(raw.token) && isText(raw.email, 254) && isText(raw.createdAt, 40) ? { token: raw.token, email: raw.email, createdAt: raw.createdAt } : null;
}

export async function loadAccount(file: string, encryptor: Encryptor): Promise<SavedAccount | null> {
  if (!encryptor.isAvailable()) return null;
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { v?: unknown; data?: unknown };
    if (saved.v !== 1 || typeof saved.data !== "string") return null;
    return savedAccount(JSON.parse(encryptor.decrypt(Buffer.from(saved.data, "base64"))));
  } catch {
    // Missing, damaged, or encrypted by another user or PC: signed out.
    return null;
  }
}

export async function saveAccount(file: string, encryptor: Encryptor, account: SavedAccount | null): Promise<void> {
  if (!account) {
    await rm(file, { force: true });
    return;
  }
  if (!encryptor.isAvailable()) return;
  await writeFileAtomic(file, JSON.stringify({ v: 1, data: encryptor.encrypt(JSON.stringify(account)).toString("base64") }));
}

export function deviceOs(platform: NodeJS.Platform): DeviceOs {
  return platform === "win32" ? "windows" : platform === "linux" ? "linux" : platform === "darwin" ? "macos" : "other";
}

export interface AccountClientOptions {
  /** False in release builds until accounts go live: nothing is loaded or sent. */
  enabled: boolean;
  baseUrl: string;
  fetch: typeof fetch;
  os: DeviceOs;
  language: () => Language;
  canKeepSignIn: () => boolean;
  load: () => Promise<SavedAccount | null>;
  save: (account: SavedAccount | null) => Promise<void>;
  onChange: (view: AccountView) => void;
  timeoutMs?: number;
}

/** What the service said went wrong, as a message for the player. */
const REASONS: Record<string, "account.error.badEmail" | "account.error.wrongCode" | "account.error.mailFailed" | "account.error.unavailable" | "account.error.emailTaken" | "account.error.sameEmail"> = {
  "bad-email": "account.error.badEmail",
  "wrong-code": "account.error.wrongCode",
  "mail-failed": "account.error.mailFailed",
  unavailable: "account.error.unavailable",
  "email-taken": "account.error.emailTaken",
  "same-email": "account.error.sameEmail",
};

function device(value: unknown): AccountDevice | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const os = (["windows", "linux", "macos"] as const).find((name) => name === raw.os) ?? "other";
  return isText(raw.id, 40) && isText(raw.createdAt, 40) && isText(raw.lastUsedAt, 40) && typeof raw.current === "boolean"
    ? { id: raw.id, os, createdAt: raw.createdAt, lastUsedAt: raw.lastUsedAt, current: raw.current }
    : null;
}

export class AccountClient {
  private saved: SavedAccount | null = null;
  private devices: AccountDevice[] | null = null;
  private pending: AccountPending | null = null;
  /** The right code for an address with no account yet, kept until the player says yes or no. */
  private pendingCode: string | null = null;
  private readonly baseUrl: string;

  constructor(private readonly options: AccountClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async init(): Promise<void> {
    if (!this.options.enabled) return;
    this.saved = await this.options.load();
    this.changed();
  }

  view(): AccountView {
    return {
      enabled: this.options.enabled,
      canKeepSignIn: this.options.canKeepSignIn(),
      account: this.saved ? { email: this.saved.email, createdAt: this.saved.createdAt } : null,
      devices: this.saved ? this.devices : null,
      pending: this.pending,
    };
  }

  // ── Signing in ─────────────────────────────────────────────────────────

  async sendCode(email: string): Promise<void> {
    this.ensure(false);
    const address = email.trim();
    await this.call("POST", "/code", { email: address, language: this.options.language() });
    this.pending = { kind: "sign-in", email: address, step: "code" };
    this.pendingCode = null;
    this.changed();
  }

  /** Checks the code; for a new address the player is asked before an account is made. */
  async verify(code: string): Promise<void> {
    const pending = this.pending;
    if (pending?.kind !== "sign-in") throw new PlayerError("account.error.noCode");
    const answer = await this.call("POST", "/verify", { email: pending.email, code, os: this.options.os });
    if (answer.status === "no-account") {
      this.pending = { ...pending, step: "create" };
      this.pendingCode = code;
      this.changed();
      return;
    }
    await this.signedIn(answer);
  }

  async create(): Promise<void> {
    const pending = this.pending;
    if (pending?.kind !== "sign-in" || pending.step !== "create" || !this.pendingCode) throw new PlayerError("account.error.noCode");
    await this.signedIn(await this.call("POST", "/verify", { email: pending.email, code: this.pendingCode, os: this.options.os, create: true }));
  }

  cancel(): void {
    this.pending = null;
    this.pendingCode = null;
    this.changed();
  }

  // ── Signed in ──────────────────────────────────────────────────────────

  /** Reads the account and its devices again (when the Account page opens). */
  async refresh(): Promise<void> {
    if (!this.options.enabled || !this.saved) return;
    const answer = await this.call("GET", "/", undefined, true);
    const account = (answer.account ?? {}) as Record<string, unknown>;
    if (isText(account.email, 254) && account.email !== this.saved.email) {
      this.saved = { ...this.saved, email: account.email };
      await this.keep();
    }
    this.devices = Array.isArray(answer.devices) ? answer.devices.map(device).filter((item): item is AccountDevice => item !== null) : [];
    this.changed();
  }

  /** Signs this PC out. Everything on the PC stays; if the service cannot be reached the sign-in is still forgotten here. */
  async signOut(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/sign-out", {}, true).catch(() => undefined);
    await this.forget();
  }

  async signOutDevice(id: string): Promise<void> {
    this.ensure(true);
    await this.call("DELETE", `/devices/${encodeURIComponent(id)}`, undefined, true);
    await this.refresh();
  }

  async sendEmailCode(email: string): Promise<void> {
    this.ensure(true);
    const address = email.trim();
    await this.call("POST", "/email/code", { email: address, language: this.options.language() }, true);
    this.pending = { kind: "change-email", email: address };
    this.changed();
  }

  async changeEmail(code: string): Promise<void> {
    const pending = this.pending;
    if (pending?.kind !== "change-email" || !this.saved) throw new PlayerError("account.error.noCode");
    const answer = await this.call("POST", "/email", { email: pending.email, code, language: this.options.language() }, true);
    const email = (answer.account as Record<string, unknown> | undefined)?.email;
    this.saved = { ...this.saved, email: isText(email, 254) ? email : pending.email };
    this.pending = null;
    await this.keep();
    this.changed();
  }

  async sendDeleteCode(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/delete/code", { language: this.options.language() }, true);
    this.pending = { kind: "delete" };
    this.changed();
  }

  /** Deletes the account on the service. Everything on the PC stays. */
  async deleteAccount(code: string): Promise<void> {
    if (this.pending?.kind !== "delete") throw new PlayerError("account.error.noCode");
    await this.call("POST", "/delete", { code }, true);
    await this.forget();
  }

  // ── Inside ─────────────────────────────────────────────────────────────

  private ensure(signedIn: boolean): void {
    if (!this.options.enabled) throw new PlayerError("error.notAllowed");
    if (signedIn && !this.saved) throw new PlayerError("account.error.signedOut");
  }

  private async signedIn(answer: Record<string, unknown>): Promise<void> {
    const account = (answer.account ?? {}) as Record<string, unknown>;
    const saved = savedAccount({ token: answer.token, email: account.email, createdAt: account.createdAt });
    if (!saved) throw new PlayerError("error.generic");
    this.saved = saved;
    this.pending = null;
    this.pendingCode = null;
    this.devices = null;
    await this.keep();
    this.changed();
    await this.refresh().catch(() => undefined);
  }

  private async keep(): Promise<void> {
    if (this.options.canKeepSignIn()) await this.options.save(this.saved);
  }

  private async forget(): Promise<void> {
    this.saved = null;
    this.devices = null;
    this.pending = null;
    this.pendingCode = null;
    await this.options.save(null);
    this.changed();
  }

  private changed(): void {
    this.options.onChange(this.view());
  }

  /**
   * One request to the service. Its own errors become messages for the player;
   * a sign-in the service no longer knows (signed out from another device,
   * unused for a year, account deleted) is forgotten here too.
   */
  private async call(method: string, path: string, body?: unknown, auth = false): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? ACCOUNT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.options.fetch(`${this.baseUrl}/v1/account${path === "/" ? "" : path}`, {
        method,
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(auth && this.saved ? { Authorization: `Bearer ${this.saved.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new PlayerError("account.error.unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 204) return {};
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return json;
    if (response.status === 401 && auth) {
      await this.forget();
      throw new PlayerError("account.error.signedOut");
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new PlayerError("account.error.tooMany", { minutes: Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 60) / 60)) });
    }
    const key = typeof json.reason === "string" ? REASONS[json.reason] : undefined;
    if (key) throw new PlayerError(key);
    if (response.status === 503) throw new PlayerError("account.error.unavailable");
    throw new PlayerError("error.generic");
  }
}
