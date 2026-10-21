import type { KeyObject } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { linkRequest, publishSignature, publishZip, type Published } from "@tavora/pack";
import type { AccountDevice, AccountPending, AccountPrefix, AccountPublishToken, AccountView, DeviceOs, KeyRequestView, PrefixState } from "../shared/host-api";
import type { Language, MessageKey } from "../shared/i18n";
import { isIdPrefix } from "../shared/id-prefix";
import type { Encryptor } from "./discord-store";
import { writeFileAtomic } from "./fsutil";
import type { DiscordLoginResult } from "./discord-login";
import { PlayerError } from "./messages";

// The player's Tavora account (decided 2026-10-16): signed into with an email
// code, a Discord login (the browser, see discord-login.ts) or both. The main process talks to the service; the
// host UI only sees the address, the devices and what step a sign-in is at.
// The sign-in token is kept in account.json, encrypted like the Discord sign-in;
// where that is not possible it is kept in memory until Tavora quits. It is not
// part of backups or diagnostic info. Modules learn nothing about the account.

export const ACCOUNT_TIMEOUT_MS = 10_000;
/** An upload to the catalog may take longer: a zip is up to a few MB. */
export const UPLOAD_TIMEOUT_MS = 120_000;

const PREFIX_STATES: readonly PrefixState[] = ["held", "free", "taken", "reserved", "too-many", "invalid"];

/** The command a developer runs with a link code, as the app shows and copies it ("ABCD-EFGH"). */
export const linkCommand = (code: string) => `npx @tavora/pack link ${code.slice(0, 4)}-${code.slice(4)}`;

export interface SavedAccount {
  token: string;
  /** Null for an account that signs in with Discord only. */
  email: string | null;
  /** The Discord username shown as "connected as @name", or null without a Discord login. */
  discord: string | null;
  createdAt: string;
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(value);

function savedAccount(value: unknown): SavedAccount | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const email = isText(raw.email, 254) ? raw.email : null;
  // A file from 0.16.x has no Discord field; it reads as none.
  const discord = isText(raw.discord, 32) ? raw.discord : null;
  return isToken(raw.token) && isText(raw.createdAt, 40) && (email || discord) ? { token: raw.token, email, discord, createdAt: raw.createdAt } : null;
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

/** The player's profile as it travels between the PC and the account. `picture` is a base64 PNG. */
export interface ProfileData {
  name: string;
  initials: string;
  picture: string | null;
  /** When it was last changed; null for a profile never changed on this PC. */
  updatedAt: string | null;
}

const isEmptyProfile = (profile: ProfileData) => !profile.name && !profile.initials && !profile.picture;
const sameProfile = (a: ProfileData, b: ProfileData) => a.name === b.name && a.initials === b.initials && a.picture === b.picture;
const timeOf = (profile: ProfileData) => (profile.updatedAt ? Date.parse(profile.updatedAt) || 0 : 0);

function remoteProfile(value: unknown): (ProfileData & { updatedAt: string }) | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof raw.name !== "string" || typeof raw.initials !== "string" || !isText(raw.updatedAt, 40)) return null;
  if (raw.picture !== null && typeof raw.picture !== "string") return null;
  return { name: raw.name, initials: raw.initials, picture: raw.picture, updatedAt: raw.updatedAt };
}

export interface AccountClientOptions {
  /** False in release builds until accounts go live: nothing is loaded or sent. */
  enabled: boolean;
  baseUrl: string;
  fetch: typeof fetch;
  os: DeviceOs;
  /** This PC's name (its computer name), which a new sign-in goes by until the player renames it. */
  deviceName?: string;
  language: () => Language;
  canKeepSignIn: () => boolean;
  load: () => Promise<SavedAccount | null>;
  save: (account: SavedAccount | null) => Promise<void>;
  onChange: (view: AccountView) => void;
  /** The profile on this PC, and how the account's profile is put in its place. */
  profile: {
    get: () => Promise<ProfileData>;
    apply: (profile: ProfileData & { updatedAt: string }) => Promise<void>;
  };
  /** Runs Discord's browser sign-in (discord-login.ts); absent where Discord login is not offered. */
  discordLogin?: () => Promise<DiscordLoginResult>;
  timeoutMs?: number;
}

/** What the service said went wrong, as a message for the player. */
const REASONS: Record<string, MessageKey> = {
  "discord-refused": "account.error.discordRefused",
  "discord-unreachable": "account.error.discordUnreachable",
  "discord-taken": "account.error.discordTaken",
  "discord-connected": "account.error.discordConnected",
  "discord-expired": "account.error.discordExpired",
  "discord-mismatch": "account.error.discordMismatch",
  "last-method": "account.error.lastMethod",
  "no-email": "account.error.noEmail",
  "no-discord": "account.error.noDiscord",
  "bad-email": "account.error.badEmail",
  "wrong-code": "account.error.wrongCode",
  "mail-failed": "account.error.mailFailed",
  unavailable: "account.error.unavailable",
  "email-taken": "account.error.emailTaken",
  "same-email": "account.error.sameEmail",
  "bad-name": "account.error.badName",
  "name-taken": "account.error.nameTaken",
  "name-reserved": "account.error.nameReserved",
  "no-developer-name": "account.error.noDeveloperName",
  "not-found": "account.error.keyGone",
  "key-taken": "account.error.keyTaken",
  "too-many-keys": "account.error.tooManyKeys",
  "key-in-request": "account.error.keyInRequest",
  "too-many-tokens": "account.error.tooManyTokens",
  // Publishing from Tavora, and claiming an id prefix.
  "prefix-taken": "publish.error.prefixTaken",
  "prefix-reserved": "publish.error.prefixReserved",
  "too-many-prefixes": "publish.error.tooManyPrefixes",
  "key-not-linked": "publish.error.keyNotLinked",
  "wrong-account": "publish.error.wrongAccount",
  "key-revoked": "publish.error.keyRevoked",
  "key-leaked": "publish.error.keyLeaked",
  "bad-signature": "publish.error.badSignature",
  "account-full": "publish.error.accountFull",
  "catalog-full": "publish.error.catalogFull",
  "too-big": "publish.error.tooBig",
};

/** The prefixes the account holds as the service answers them; null for anything off. */
function heldPrefixes(value: unknown): { held: AccountPrefix[]; max: number } | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (!Array.isArray(raw.prefixes) || !Number.isSafeInteger(raw.max) || (raw.max as number) < 0) return null;
  const held = raw.prefixes
    .slice(0, 100)
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}))
    .filter((item) => isIdPrefix(item.prefix) && Number.isSafeInteger(item.claimedAt) && typeof item.published === "boolean")
    .map((item) => ({ prefix: item.prefix as string, claimedAt: item.claimedAt as number, published: item.published as boolean }));
  return { held, max: raw.max as number };
}

/** The account's developer side as the service answers it; null for anything off. */
function developerSide(value: unknown): { developer: { name: string; nextChangeAt: string } | null; keys: { fingerprint: string; linkedAt: string }[]; tokens: AccountPublishToken[]; requests: KeyRequestView[] } | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (!Array.isArray(raw.keys)) return null;
  const developer = (typeof raw.developer === "object" && raw.developer !== null ? raw.developer : null) as Record<string, unknown> | null;
  const keys = raw.keys
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}))
    .filter((item) => typeof item.fingerprint === "string" && /^[0-9a-f]{32}$/.test(item.fingerprint) && isText(item.linkedAt, 40))
    .map((item) => ({ fingerprint: item.fingerprint as string, linkedAt: item.linkedAt as string }));
  // Older services send no requests: there are none then.
  const requests = (Array.isArray(raw.requests) ? raw.requests : [])
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}))
    .filter(
      (item) =>
        typeof item.old === "string" &&
        /^[0-9a-f]{32}$/.test(item.old) &&
        typeof item.new === "string" &&
        /^[0-9a-f]{32}$/.test(item.new) &&
        typeof item.leaked === "boolean" &&
        isText(item.requestedAt, 40) &&
        (item.status === "waiting" || item.status === "done" || item.status === "declined"),
    )
    .map((item) => ({ old: item.old as string, new: item.new as string, leaked: item.leaked as boolean, requestedAt: item.requestedAt as string, status: item.status as KeyRequestView["status"] }));
  const tokens = (Array.isArray(raw.publishTokens) ? raw.publishTokens : [])
    .map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}))
    .filter((item) => isText(item.id, 40) && isText(item.name, 40) && isText(item.createdAt, 40) && isText(item.expiresAt, 40))
    .map((item) => ({ id: item.id as string, name: item.name as string, createdAt: item.createdAt as string, expiresAt: item.expiresAt as string, lastUsedAt: isText(item.lastUsedAt, 40) ? item.lastUsedAt : null }));
  return {
    developer: developer && isText(developer.name, 32) && isText(developer.nextChangeAt, 40) ? { name: developer.name, nextChangeAt: developer.nextChangeAt } : null,
    keys,
    tokens,
    requests,
  };
}

function device(value: unknown): AccountDevice | null {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const os = (["windows", "linux", "macos"] as const).find((name) => name === raw.os) ?? "other";
  return isText(raw.id, 40) && isText(raw.createdAt, 40) && isText(raw.lastUsedAt, 40) && typeof raw.current === "boolean"
    ? { id: raw.id, os, name: isText(raw.name, 40) ? raw.name : null, createdAt: raw.createdAt, lastUsedAt: raw.lastUsedAt, current: raw.current }
    : null;
}

export class AccountClient {
  private saved: SavedAccount | null = null;
  private devices: AccountDevice[] | null = null;
  private pending: AccountPending | null = null;
  /** The right code for an address with no account yet, kept until the player says yes or no. */
  private pendingCode: string | null = null;
  /** The service's ticket for a checked Discord login with no account yet, kept until the player says yes or no. */
  private pendingTicket: string | null = null;
  /** The account's profile when it differs from this PC's on the first sign-in here: the player chooses once. */
  private profileChoice: (ProfileData & { updatedAt: string }) | null = null;
  /** The developer side as last read: the public name and the linked publisher keys. */
  private developer: AccountView["developer"] = null;
  private publisherKeys: AccountView["publisherKeys"] = null;
  private keyRequests: AccountView["keyRequests"] = null;
  /** The code for `tavora-pack link` the player asked for, until it runs out. */
  private linkCode: AccountView["linkCode"] = null;
  private publishTokens: AccountView["publishTokens"] = null;
  /** A publish token just made, shown once until the developer closes it. */
  private newPublishToken: AccountView["newPublishToken"] = null;
  private prefixes: AccountView["prefixes"] = null;
  private prefixCheck: AccountView["prefixCheck"] = null;
  private readonly baseUrl: string;

  constructor(private readonly options: AccountClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async init(): Promise<void> {
    if (!this.options.enabled) return;
    this.saved = await this.options.load();
    this.changed();
    // Once at each start: the profile comes down or goes up, whichever is newer. Quietly; offline is fine.
    if (this.saved) void this.syncProfile(false).catch(() => undefined);
  }

  /** The sign-in token, for another call to the service that needs a signed-in player (sharing icons); null when signed out. */
  token(): string | null {
    return this.options.enabled ? (this.saved?.token ?? null) : null;
  }

  view(): AccountView {
    return {
      enabled: this.options.enabled,
      canKeepSignIn: this.options.canKeepSignIn(),
      account: this.saved ? { email: this.saved.email, discord: this.saved.discord ? { name: this.saved.discord } : null, createdAt: this.saved.createdAt } : null,
      discordLogin: Boolean(this.options.discordLogin),
      devices: this.saved ? this.devices : null,
      pending: this.pending,
      profileChoice: this.saved && this.profileChoice ? { name: this.profileChoice.name, initials: this.profileChoice.initials, picture: this.profileChoice.picture !== null } : null,
      developer: this.saved ? this.developer : null,
      publisherKeys: this.saved ? this.publisherKeys : null,
      keyRequests: this.saved ? this.keyRequests : null,
      linkCode: this.saved && this.linkCode && Date.parse(this.linkCode.expiresAt) > Date.now() ? this.linkCode : null,
      publishTokens: this.saved ? this.publishTokens : null,
      newPublishToken: this.saved ? this.newPublishToken : null,
      prefixes: this.saved ? this.prefixes : null,
      prefixCheck: this.saved ? this.prefixCheck : null,
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
    const answer = await this.call("POST", "/verify", { email: pending.email, code, ...this.device() });
    if (answer.status === "no-account") {
      this.pending = { ...pending, step: "create" };
      this.pendingCode = code;
      this.changed();
      return;
    }
    await this.signedIn(answer);
  }

  /** Makes the account, only once the player confirmed the minimum age (13, and 16 or a parent's permission; decided 2026-10-16). Nothing about the age is kept. */
  async create(ageConfirmed: boolean): Promise<void> {
    const pending = this.pending;
    if (pending?.kind === "discord-create" && this.pendingTicket) {
      if (!ageConfirmed) throw new PlayerError("account.error.ageRequired");
      await this.signedIn(await this.call("POST", "/discord/create", { ticket: this.pendingTicket, ...this.device() }));
      return;
    }
    if (pending?.kind !== "sign-in" || pending.step !== "create" || !this.pendingCode) throw new PlayerError("account.error.noCode");
    if (!ageConfirmed) throw new PlayerError("account.error.ageRequired");
    await this.signedIn(await this.call("POST", "/verify", { email: pending.email, code: this.pendingCode, ...this.device(), create: true }));
  }

  cancel(): void {
    this.pending = null;
    this.pendingCode = null;
    this.pendingTicket = null;
    this.changed();
  }

  // ── Discord login ──────────────────────────────────────────────────────

  /** Signs in with Discord in the browser; a Discord login with no account yet asks first, like a new address. */
  async discordSignIn(): Promise<void> {
    this.ensure(false);
    const answer = await this.call("POST", "/discord/sign-in", { ...(await this.discord()), ...this.device() });
    if (answer.status === "no-account" && typeof answer.ticket === "string") {
      const name = (answer.discord as Record<string, unknown> | undefined)?.name;
      this.pending = { kind: "discord-create", name: isText(name, 32) ? name : "" };
      this.pendingTicket = answer.ticket;
      this.pendingCode = null;
      this.changed();
      return;
    }
    await this.signedIn(answer);
  }

  /**
   * Connecting Discord starts with a code sent to the account's address, so a stolen sign-in cannot add a way in
   * that it controls; the player then types the code and approves in Discord (connectDiscord).
   */
  async sendConnectDiscordCode(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/discord/code", { language: this.options.language() }, true);
    this.pending = { kind: "connect-discord" };
    this.changed();
  }

  /** Connects Discord to the signed-in account: the code from the email, then a fresh Discord sign-in in the browser. */
  async connectDiscord(emailCode: string): Promise<void> {
    if (this.pending?.kind !== "connect-discord") throw new PlayerError("account.error.noCode");
    const login = await this.discord();
    const answer = await this.call("POST", "/discord", { ...login, emailCode }, true);
    this.pending = null;
    await this.updated(answer);
  }

  /**
   * Disconnecting Discord needs a code sent to the account's address, so the owner can always remove a Discord login,
   * also one they lost or one someone else connected, and a stolen sign-in cannot.
   */
  async sendDisconnectDiscordCode(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/discord/remove/code", { language: this.options.language() }, true);
    this.pending = { kind: "remove-discord" };
    this.changed();
  }

  async disconnectDiscord(code: string): Promise<void> {
    if (this.pending?.kind !== "remove-discord") throw new PlayerError("account.error.noCode");
    const answer = await this.call("POST", "/discord/remove", { code }, true);
    this.pending = null;
    await this.updated(answer);
  }

  /** Removing the email needs a code sent to it, so a stolen sign-in cannot cut the owner out. */
  async sendRemoveEmailCode(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/email/remove/code", { language: this.options.language() }, true);
    this.pending = { kind: "remove-email" };
    this.changed();
  }

  async removeEmail(code: string): Promise<void> {
    if (this.pending?.kind !== "remove-email") throw new PlayerError("account.error.noCode");
    const answer = await this.call("POST", "/email/remove", { code }, true);
    this.pending = null;
    await this.updated(answer);
  }

  /** Deletes the account by a fresh sign-in with its Discord login. Everything on the PC stays. */
  async deleteWithDiscord(): Promise<void> {
    this.ensure(true);
    const login = await this.discord();
    await this.call("POST", "/delete/discord", login, true);
    await this.forget();
  }

  private async discord(): Promise<DiscordLoginResult> {
    if (!this.options.discordLogin) throw new PlayerError("account.error.unavailable");
    return this.options.discordLogin();
  }

  /** Takes the sign-in methods the service now reports for the account. */
  private async updated(answer: Record<string, unknown>): Promise<void> {
    if (!this.saved) return;
    const account = (answer.account ?? {}) as Record<string, unknown>;
    const discord = account.discord as Record<string, unknown> | null | undefined;
    const email = account.email === null ? null : isText(account.email, 254) ? account.email : this.saved.email;
    const name = discord === null ? null : isText(discord?.name, 32) ? discord.name : this.saved.discord;
    if (email !== this.saved.email || name !== this.saved.discord) {
      this.saved = { ...this.saved, email, discord: name };
      await this.keep();
    }
    this.changed();
  }

  // ── Signed in ──────────────────────────────────────────────────────────

  /** Reads the account and its devices again (when the Account page opens). */
  async refresh(): Promise<void> {
    if (!this.options.enabled || !this.saved) return;
    const answer = await this.call("GET", "/", undefined, true);
    this.devices = Array.isArray(answer.devices) ? answer.devices.map(device).filter((item): item is AccountDevice => item !== null) : [];
    // A sign-in from before devices had names gets this PC's.
    const unnamed = this.devices.find((item) => item.current && item.name === null);
    const name = this.options.deviceName?.trim().slice(0, 40);
    if (unnamed && name) {
      await this.call("PUT", `/devices/${encodeURIComponent(unnamed.id)}/name`, { name }, true).then(
        () => (unnamed.name = name),
        () => undefined,
      );
    }
    // The email or Discord may have changed on another PC.
    await this.updated(answer);
    // The developer side too; a service without it yet leaves it unknown.
    this.takeDeveloper(await this.call("GET", "/developer", undefined, true).catch(() => ({})));
    await this.readPrefixes();
  }

  // ── Developer side ─────────────────────────────────────────────────────

  /** Sets the public name players see on the modules of the account's linked keys. */
  async setDeveloperName(name: string): Promise<void> {
    this.ensure(true);
    this.takeDeveloper(await this.call("PUT", "/developer", { name: name.trim() }, true));
  }

  /** A one-time code the developer types into `tavora-pack link`, valid for 10 minutes. */
  async newLinkCode(): Promise<void> {
    this.ensure(true);
    const answer = await this.call("POST", "/keys/code", {}, true);
    if (typeof answer.code !== "string" || !/^[A-Z0-9]{8}$/.test(answer.code) || !isText(answer.expiresAt, 40)) throw new PlayerError("error.generic");
    this.linkCode = { code: answer.code, expiresAt: answer.expiresAt };
    this.changed();
  }

  /** Links a publisher key Tavora keeps to the account, the way `tavora-pack link` does with a key file. */
  async linkPublisherKey(key: KeyObject): Promise<void> {
    this.ensure(true);
    const answer = await this.call("POST", "/keys/code", {}, true);
    if (typeof answer.code !== "string" || !/^[A-Z0-9]{8}$/.test(answer.code)) throw new PlayerError("error.generic");
    await this.call("POST", "/link", linkRequest(key, answer.code), false, "/v1/publishers");
    this.takeDeveloper(await this.call("GET", "/developer", undefined, true));
  }

  /** A publish token for CI, limited to the account's id prefixes. Its secret is shown once. */
  async createPublishToken(name: string): Promise<void> {
    this.ensure(true);
    const answer = await this.call("POST", "/publish-tokens", { name: name.trim() }, true);
    if (typeof answer.token !== "string" || !/^tvp_[A-Za-z0-9_-]{20,100}$/.test(answer.token)) throw new PlayerError("error.generic");
    this.newPublishToken = { name: name.trim(), token: answer.token };
    this.takeDeveloper(answer);
  }

  /** The new token's secret leaves the screen. */
  publishTokenSaved(): void {
    this.newPublishToken = null;
    this.changed();
  }

  /** The token the shown one is, for copying it. */
  newPublishTokenText(): string | null {
    return this.newPublishToken?.token ?? null;
  }

  async deletePublishToken(id: string): Promise<void> {
    this.ensure(true);
    this.takeDeveloper(await this.call("DELETE", `/publish-tokens/${encodeURIComponent(id)}`, undefined, true));
  }

  /**
   * Uploads a module zip to the catalog for the pack command, with this sign-in: the catalog checks the
   * account owns both the key and the id prefix. Its errors are the pack command's (PublishError).
   */
  async publishModule(key: KeyObject, zip: Buffer): Promise<Published> {
    if (!this.saved) throw new PlayerError("account.error.signedOut");
    return publishZip({ key, zip, token: this.saved.token, language: this.options.language(), apiUrl: this.baseUrl, fetch: this.options.fetch });
  }

  /**
   * Uploads a module zip Tavora packed, after the developer's click on the review screen: signed with
   * the key that signed the zip, and sent with this sign-in. The catalog checks the account owns both
   * the key and the id prefix. Its refusals are messages for the player.
   */
  async uploadModule(key: KeyObject, zip: Buffer): Promise<Published> {
    this.ensure(true);
    const answer = await this.call("POST", "/publish", zip, true, "/v1/catalog", {
      headers: { "X-Tavora-Signature": publishSignature(key, zip), "Accept-Language": this.options.language() },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    if (typeof answer.id !== "string" || typeof answer.version !== "string" || typeof answer.sha256 !== "string") throw new PlayerError("error.generic");
    // The upload reserved the prefix when it was new.
    await this.readPrefixes();
    return { id: answer.id, version: answer.version, sha256: answer.sha256 };
  }

  // ── Id prefixes ────────────────────────────────────────────────────────

  /** What the catalog says about an id prefix for this account; kept as prefixCheck for the screen. */
  async checkPrefix(prefix: string): Promise<PrefixState> {
    this.ensure(true);
    let state: PrefixState = "invalid";
    if (isIdPrefix(prefix)) {
      const answer = await this.call("GET", `/prefixes/${prefix}`, undefined, true);
      state = PREFIX_STATES.find((item) => item === answer.state) ?? "invalid";
    }
    this.prefixCheck = { prefix, state };
    // Held but not in the list read before (the service didn't list prefixes then): read it again.
    if (state === "held" && !this.prefixes?.held.some((item) => item.prefix === prefix)) await this.readPrefixes();
    this.changed();
    return state;
  }

  /** Claims a free id prefix for the account right away, before anything is published under it. */
  async claimPrefix(prefix: string): Promise<void> {
    this.ensure(true);
    if (!isIdPrefix(prefix)) throw new PlayerError("publish.error.prefixInvalid");
    try {
      await this.call("POST", `/prefixes/${prefix}`, {}, true);
    } catch (error) {
      // Taken meanwhile, or the account holds as many as it may: the screen shows it as checked.
      await this.checkPrefix(prefix).catch(() => undefined);
      throw error;
    }
    this.prefixCheck = { prefix, state: "held" };
    await this.readPrefixes();
    this.changed();
  }

  /** The prefixes the account holds. Quietly: a service without them yet leaves them unknown. */
  private async readPrefixes(): Promise<void> {
    const answer = await this.call("GET", "/prefixes", undefined, true).catch(() => null);
    const prefixes = heldPrefixes(answer);
    if (!prefixes) return;
    this.prefixes = prefixes;
    this.changed();
  }

  async unlinkKey(fingerprint: string): Promise<void> {
    this.ensure(true);
    this.takeDeveloper(await this.call("DELETE", `/keys/${encodeURIComponent(fingerprint)}`, undefined, true));
  }

  /** "I lost this key": asks Tavora to move what `old` owns to `next`, another key linked to the account. */
  async replaceKey(old: string, next: string, leaked: boolean): Promise<void> {
    this.ensure(true);
    this.takeDeveloper(await this.call("POST", `/keys/${encodeURIComponent(old)}/replace`, { new: next, leaked, language: this.options.language() }, true));
  }

  private takeDeveloper(answer: Record<string, unknown>): void {
    const side = developerSide(answer);
    if (!side) return;
    this.developer = side.developer;
    // A key linked meanwhile used the code up.
    if (this.publisherKeys && side.keys.length > this.publisherKeys.length) this.linkCode = null;
    this.publisherKeys = side.keys;
    this.keyRequests = side.requests;
    this.publishTokens = side.tokens;
    this.changed();
  }

  /** Signs this PC out. Everything on the PC stays; if the service cannot be reached the sign-in is still forgotten here. */
  async signOut(): Promise<void> {
    this.ensure(true);
    await this.call("POST", "/sign-out", {}, true).catch(() => undefined);
    await this.forget();
  }

  /** What a sign-in tells the service about this PC. */
  private device(): { os: DeviceOs; name?: string } {
    const name = this.options.deviceName?.trim().slice(0, 40);
    return { os: this.options.os, ...(name ? { name } : {}) };
  }

  async renameDevice(id: string, name: string): Promise<void> {
    this.ensure(true);
    await this.call("PUT", `/devices/${encodeURIComponent(id)}/name`, { name: name.trim() }, true);
    await this.refresh();
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
    this.pending = null;
    await this.updated({ account: { email: pending.email, ...(answer.account as Record<string, unknown> | undefined) } });
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

  // ── Profile ────────────────────────────────────────────────────────────

  /** The player changed the profile on this PC: send it up. A failure is caught up at the next start. */
  async profileChanged(): Promise<void> {
    if (!this.options.enabled || !this.saved) return;
    this.profileChoice = null;
    await this.push(await this.options.profile.get()).catch(() => undefined);
  }

  /** The answer to the one question on a first sign-in: the account's profile, or this PC's. */
  async chooseProfile(keep: "account" | "pc"): Promise<void> {
    this.ensure(true);
    const choice = this.profileChoice;
    this.profileChoice = null;
    if (choice && keep === "account") await this.options.profile.apply(choice);
    // This PC's profile becomes the newest, so every other PC takes it.
    else await this.push({ ...(await this.options.profile.get()), updatedAt: new Date().toISOString() });
    this.changed();
  }

  /**
   * Brings the profile on this PC and the account's together. A new account
   * takes this PC's; a PC with the empty default takes the account's; on a first
   * sign-in here with two different profiles the player is asked; otherwise
   * the newer one wins.
   */
  private async syncProfile(firstSignIn: boolean): Promise<void> {
    const remote = remoteProfile((await this.call("GET", "/profile", undefined, true)).profile);
    const local = await this.options.profile.get();
    if (!remote) {
      if (!isEmptyProfile(local)) await this.push(local);
      return;
    }
    if (sameProfile(local, remote)) return;
    if (isEmptyProfile(local)) return this.options.profile.apply(remote);
    if (firstSignIn) {
      this.profileChoice = remote;
      this.changed();
      return;
    }
    if (timeOf(remote) > timeOf(local)) await this.options.profile.apply(remote);
    else await this.push(local);
  }

  private async push(local: ProfileData): Promise<void> {
    const body = { name: local.name, initials: local.initials, picture: local.picture, updatedAt: local.updatedAt ?? new Date().toISOString() };
    const kept = remoteProfile((await this.call("PUT", "/profile", body, true)).profile);
    // The account had a newer one (changed on another PC meanwhile): that one wins here too.
    if (kept && !sameProfile(kept, local)) await this.options.profile.apply(kept);
  }

  // ── Inside ─────────────────────────────────────────────────────────────

  private ensure(signedIn: boolean): void {
    if (!this.options.enabled) throw new PlayerError("error.notAllowed");
    if (signedIn && !this.saved) throw new PlayerError("account.error.signedOut");
  }

  private async signedIn(answer: Record<string, unknown>): Promise<void> {
    const account = (answer.account ?? {}) as Record<string, unknown>;
    const saved = savedAccount({ token: answer.token, email: account.email, discord: (account.discord as Record<string, unknown> | null | undefined)?.name, createdAt: account.createdAt });
    if (!saved) throw new PlayerError("error.generic");
    this.saved = saved;
    this.pending = null;
    this.pendingCode = null;
    this.pendingTicket = null;
    this.devices = null;
    await this.keep();
    this.changed();
    await this.refresh().catch(() => undefined);
    await this.syncProfile(true).catch(() => undefined);
  }

  private async keep(): Promise<void> {
    if (this.options.canKeepSignIn()) await this.options.save(this.saved);
  }

  private async forget(): Promise<void> {
    this.saved = null;
    this.devices = null;
    this.pending = null;
    this.pendingCode = null;
    this.pendingTicket = null;
    this.profileChoice = null;
    this.developer = null;
    this.publisherKeys = null;
    this.keyRequests = null;
    this.linkCode = null;
    this.publishTokens = null;
    this.newPublishToken = null;
    this.prefixes = null;
    this.prefixCheck = null;
    await this.options.save(null);
    this.changed();
  }

  private changed(): void {
    this.options.onChange(this.view());
  }

  /**
   * One request to the service. Its own errors become messages for the player;
   * a sign-in the service no longer knows (signed out from another device,
   * unused for a year, account deleted) is forgotten here too. A Buffer body goes as a zip.
   */
  private async call(
    method: string,
    path: string,
    body?: unknown,
    auth = false,
    root = "/v1/account",
    extra: { headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), extra.timeoutMs ?? this.options.timeoutMs ?? ACCOUNT_TIMEOUT_MS);
    const zip = Buffer.isBuffer(body);
    let response: Response;
    try {
      response = await this.options.fetch(`${this.baseUrl}${root}${path === "/" ? "" : path}`, {
        method,
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": zip ? "application/zip" : "application/json" }),
          ...(auth && this.saved ? { Authorization: `Bearer ${this.saved.token}` } : {}),
          ...extra.headers,
        },
        ...(body === undefined ? {} : { body: zip ? new Uint8Array(body) : JSON.stringify(body) }),
        ...(zip ? { redirect: "error" as const } : {}),
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
    // The catalog's uploads for today are used up; it says nothing about when, so: tomorrow.
    if (json.reason === "daily-limit" && root === "/v1/catalog") throw new PlayerError("publish.error.dailyLimit");
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new PlayerError("account.error.tooMany", { minutes: Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 60) / 60)) });
    }
    if (json.reason === "name-too-soon") {
      const at = typeof json.nextChangeAt === "string" ? new Date(json.nextChangeAt) : null;
      if (at && Number.isFinite(at.getTime())) throw new PlayerError("account.error.nameTooSoon", { date: new Intl.DateTimeFormat(this.options.language(), { dateStyle: "long" }).format(at) });
    }
    if (json.reason === "daily-limit") {
      // The service's emails for today are used up: say when sending works again, in the player's own time.
      const at = typeof json.retryAt === "string" ? new Date(json.retryAt) : null;
      if (at && Number.isFinite(at.getTime())) throw new PlayerError("account.error.dailyLimit", { time: new Intl.DateTimeFormat(this.options.language(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(at) });
      throw new PlayerError("account.error.dailyLimitSoon");
    }
    const key = typeof json.reason === "string" ? REASONS[json.reason] : undefined;
    if (key) throw new PlayerError(key);
    // A zip the catalog refused comes with the catalog's own sentence about it.
    if ((json.reason === "invalid" || json.reason === "conflict") && typeof json.error === "string" && json.error.trim()) {
      throw new PlayerError("publish.error.refused", { message: json.error.replace(/\s+/g, " ").trim().slice(0, 300) });
    }
    // 503: switched off on the service; 404: a service that has no accounts at all yet.
    if (response.status === 503 || response.status === 404) throw new PlayerError("account.error.unavailable");
    throw new PlayerError("error.generic");
  }
}
