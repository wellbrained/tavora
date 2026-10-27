import { createHash, randomBytes } from "node:crypto";
import { DISCORD_EVENTS, LIMITS, type DiscordCommand, type DiscordEvent, type DiscordEventName, type DiscordResult, type DiscordState, type JsonValue } from "@tavora/sdk/protocol";
import type { MessageKey } from "../shared/i18n";
import type { DiscordStatus, DiscordView } from "../shared/host-api";
import { HostError } from "./errors";
import { AUTHORIZE_TIMEOUT_MS, RpcClient, RpcError, type RpcEvents } from "./discord-rpc";
import { imageUrl, isSnowflake, MAX_IMAGE, parseScopes, parseUser, pngDataUrl } from "./discord-parse";
import type { DiscordGame, DiscordLast, DiscordSecrets, DiscordToken } from "./discord-store";

// The Discord connector (decision log, module grants row of 2026-10-16, point 8):
// the connection to the Discord desktop app on this PC, Tavora's Discord sign-in
// (PKCE, no Client Secret) and its token. Modules granted the `discord` connector
// send a fixed list of RPC commands and subscribe to a fixed list of events
// through it; what Discord answers goes to them as it came, and they never see
// the token. Nothing goes through Tavora's service; audio never goes through
// Tavora at all. See the threat model (D1–D9).

/**
 * Tavora's application in the Discord Developer Portal. Its id is public. The
 * application is a public client: sign-in uses PKCE (a one-time code verifier
 * made on this PC for each sign-in), so no Client Secret exists on any PC.
 */
export const DISCORD_CLIENT_ID = "1560388687370387610";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const REDIRECT_URI = "http://localhost";
/** Reading voice, joining and leaving a channel, and muting or deafening the user. Tavora can't speak or read messages. */
export const SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"];
/** The scope that lets Tavora mute and deafen the user; sign-ins made before 0.5.11 lack it. */
const WRITE_SCOPE = "rpc.voice.write";
/** How often Tavora looks for the Discord app while it is not running. */
export const RETRY_MS = 10_000;
/** Changes are told at most this often. */
const EMIT_MS = 50;
/** Pictures kept in memory for every module together. */
const MAX_IMAGES = 300;

type SignInErrorCode = NonNullable<DiscordState["error"]>;

/** Settings > Integrations > Discord says what went wrong in the host's words. */
const ERROR_KEYS: Record<SignInErrorCode, MessageKey> = {
  "not-approved": "discord.error.notApproved",
  "no-code": "discord.error.noCode",
  offline: "discord.error.offline",
  "no-sign-in": "discord.error.noSignIn",
  failed: "discord.error.generic",
};

export interface DiscordDeps {
  clientId: string;
  connect(events: RpcEvents): Promise<RpcClient | null>;
  /** Tests only: where tokens are asked for instead of discord.com. */
  tokenUrl?: string;
  fetch: typeof fetch;
  load(): Promise<DiscordSecrets>;
  save(secrets: DiscordSecrets): Promise<void>;
  /** False where this PC can't encrypt, so the sign-in lasts only until Tavora closes. */
  canSaveSignIn: boolean;
  /** For Settings > Integrations > Discord. */
  onChange(view: DiscordView): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** A panel using the connector: how it hears about the connection and the events it subscribed to. */
export interface DiscordListener {
  state(state: DiscordState): void;
  event(event: DiscordEvent): void;
}

class SignInError extends Error {
  constructor(readonly code: SignInErrorCode) {
    super(code);
  }
}

class SignedOut extends Error {}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Discord's data as plain JSON, or null when it is larger than a module is given. */
function passOn(data: unknown): { json: JsonValue } | null {
  const json = (data ?? null) as JsonValue;
  return Buffer.byteLength(JSON.stringify(json)) > LIMITS.maxDiscordAnswerBytes ? null : { json };
}

/** A subscription as one string: the event, and its channel when it has one. */
const keyOf = (event: DiscordEventName, channelId: string | null): string => (channelId ? `${event}:${channelId}` : event);

function argsOf(key: string): { event: DiscordEventName; args: Record<string, unknown> } {
  const [event, channelId] = key.split(":") as [DiscordEventName, string | undefined];
  return { event, args: channelId ? { channel_id: channelId } : {} };
}

export class DiscordConnector {
  private secrets: DiscordSecrets = { token: null };
  private loaded: Promise<void>;
  private client: RpcClient | null = null;
  /** Bumped whenever a connection attempt should give up (stop, sign out, a newer attempt). */
  private attempt = 0;
  private status: DiscordStatus = "off";
  private error: SignInErrorCode | null = null;
  private user: { id: string; name: string } | null = null;
  private granted: string[] = [];
  /** Panels that use the connection, by instance id. It runs while there is one. */
  private readonly listeners = new Map<string, DiscordListener>();
  /** What each panel subscribed to (keyOf). Discord is asked once per subscription, whoever wants it. */
  private readonly subscribed = new Map<string, Set<string>>();
  private readonly images = new Map<string, Promise<string | null>>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private emitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly deps: DiscordDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
    this.loaded = deps.load().then(
      (secrets) => void (this.secrets = secrets),
      () => undefined,
    );
  }

  /** For Settings > Integrations > Discord. */
  view(): DiscordView {
    return { status: this.status, error: this.error ? ERROR_KEYS[this.error] : null, canSaveSignIn: this.deps.canSaveSignIn, user: this.user };
  }

  /** What a module is told. A panel only asks while it uses the connection, so "off" is still starting for it. */
  state(): DiscordState {
    return {
      status: this.status === "off" ? "connecting" : this.status,
      error: this.status === "error" ? this.error : null,
      user: this.user,
      canControl: this.status === "connected" && this.granted.includes(WRITE_SCOPE),
      canSaveSignIn: this.deps.canSaveSignIn,
    };
  }

  private get wanted(): boolean {
    return this.listeners.size > 0;
  }

  /** A panel uses the connection from now on; the first one starts it. */
  async use(instanceId: string, listener: DiscordListener): Promise<void> {
    const first = !this.listeners.has(instanceId);
    this.listeners.set(instanceId, listener);
    if (!first) return;
    await this.loaded;
    if (this.wanted && this.status === "off") void this.start(false);
  }

  /** The panel closed or started again: its subscriptions end, and the connection with the last panel. */
  release(instanceId: string): void {
    if (!this.listeners.delete(instanceId)) return;
    const keys = this.subscribed.get(instanceId) ?? new Set<string>();
    this.subscribed.delete(instanceId);
    if (!this.wanted) return this.stop("off");
    for (const key of keys) if (!this.isSubscribed(key)) void this.client?.unsubscribe(argsOf(key).event, argsOf(key).args).catch(() => undefined);
  }

  /** The user pressed Connect: approval in Discord may be asked for. */
  async connectNow(): Promise<void> {
    await this.loaded;
    void this.start(true);
  }

  /** The user pressed Allow muting: Discord is asked to approve the new permission. */
  async allowControl(): Promise<void> {
    await this.loaded;
    void this.start(true, true);
  }

  async signOut(): Promise<void> {
    await this.loaded;
    this.secrets = { token: null };
    await this.deps.save(this.secrets);
    this.user = null;
    this.stop(this.wanted ? "signed-out" : "off");
  }

  /**
   * Sends one RPC command a module asked for. The bridge has checked the command and its arguments
   * (discord-commands.ts), and that SELECT_VOICE_CHANNEL follows a click; Discord's answer goes back
   * as it came.
   */
  async command(command: DiscordCommand, args: Record<string, unknown>): Promise<DiscordResult> {
    await this.loaded;
    const client = this.client;
    if (!client || this.status !== "connected") return { ok: false, reason: "not-connected", code: null, message: null };
    if (command === "SET_VOICE_SETTINGS" && !this.granted.includes(WRITE_SCOPE)) {
      return { ok: false, reason: "refused", code: null, message: "Tavora's Discord sign-in may not mute or deafen yet; ask allowControl()." };
    }
    // Joining takes the user out of a call they are in, as Discord's own channel list does.
    const sent = command === "SELECT_VOICE_CHANNEL" && args.channel_id !== null ? { ...args, force: true } : args;
    try {
      const answer = passOn(await client.command(command, sent, undefined, LIMITS.discordTimeoutMs));
      return answer ? { ok: true, data: answer.json } : { ok: false, reason: "no-answer", code: null, message: "Discord's answer was too large." };
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) return { ok: false, reason: "refused", code: error.code, message: error.message };
      return { ok: false, reason: "no-answer", code: null, message: error instanceof Error ? error.message.slice(0, 200) : null };
    }
  }

  /** Sends a Discord event to the panel from now on; Discord is asked to send it when no panel wanted it yet. */
  async subscribe(instanceId: string, event: DiscordEventName, channelId: string | null): Promise<void> {
    const key = keyOf(event, channelId);
    const keys = this.subscribed.get(instanceId) ?? new Set<string>();
    if (keys.has(key)) return;
    if (keys.size >= LIMITS.maxDiscordSubscriptions) throw new HostError("BAD_REQUEST", `at most ${LIMITS.maxDiscordSubscriptions} Discord subscriptions per panel`);
    const fresh = !this.isSubscribed(key);
    keys.add(key);
    this.subscribed.set(instanceId, keys);
    const client = this.client;
    if (fresh && client && this.status === "connected") await client.subscribe(event, argsOf(key).args).catch(() => undefined);
  }

  async unsubscribe(instanceId: string, event: DiscordEventName, channelId: string | null): Promise<void> {
    const key = keyOf(event, channelId);
    if (!this.subscribed.get(instanceId)?.delete(key)) return;
    const client = this.client;
    if (!this.isSubscribed(key) && client && this.status === "connected") await client.unsubscribe(event, argsOf(key).args).catch(() => undefined);
  }

  private isSubscribed(key: string): boolean {
    for (const keys of this.subscribed.values()) if (keys.has(key)) return true;
    return false;
  }

  /** A picture from Discord's image server as a small PNG data address; null for any other address or on any problem. */
  image(url: string): Promise<string | null> {
    const address = imageUrl(url);
    if (!address) return Promise.resolve(null);
    let picture = this.images.get(address);
    if (!picture) {
      if (this.images.size >= MAX_IMAGES) this.images.delete(this.images.keys().next().value!);
      picture = this.fetchImage(address);
      this.images.set(address, picture);
    }
    return picture;
  }

  /**
   * What Discord panels before 0.16.11 kept with the sign-in: the channel to rejoin and each game's
   * server. The host moves it into the Discord module once.
   */
  async legacyPanelData(): Promise<{ last: DiscordLast | null; games: Record<string, DiscordGame> } | null> {
    await this.loaded;
    const games = this.secrets.games ?? {};
    return this.secrets.last || Object.keys(games).length > 0 ? { last: this.secrets.last ?? null, games } : null;
  }

  async forgetLegacyPanelData(): Promise<void> {
    await this.loaded;
    this.secrets = { token: this.secrets.token };
    await this.deps.save(this.secrets);
  }

  dispose(): void {
    this.listeners.clear();
    this.subscribed.clear();
    this.stop("off");
    if (this.emitTimer) this.clearTimer(this.emitTimer);
  }

  // ── Connecting ───────────────────────────────────────────────────────

  private stop(status: DiscordStatus): void {
    this.attempt++;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    const client = this.client;
    this.client = null;
    client?.close();
    this.set(status, null);
  }

  private set(status: DiscordStatus, error: SignInErrorCode | null): void {
    this.status = status;
    this.error = error;
    this.emit();
  }

  private async start(interactive: boolean, reauthorize = false): Promise<void> {
    this.stop(this.status);
    const attempt = this.attempt;
    const live = () => attempt === this.attempt && this.wanted;
    if (!this.wanted) return;
    if (!this.secrets.token && !interactive) return this.set("signed-out", null);
    this.set("connecting", null);
    const client = await this.deps.connect({
      onEvent: (evt, data) => attempt === this.attempt && this.onEvent(evt, data),
      onClose: () => {
        if (attempt !== this.attempt) return;
        this.client = null;
        this.retry("not-running");
      },
    });
    if (!live()) return void client?.close();
    if (!client) return this.retry("not-running");
    this.client = client;
    try {
      this.user = await this.signIn(client, interactive, live, reauthorize);
      if (!live()) return;
      // What panels subscribed to while not connected, or before Discord restarted.
      const keys = new Set([...this.subscribed.values()].flatMap((set) => [...set]));
      for (const key of keys) await client.subscribe(argsOf(key).event, argsOf(key).args).catch(() => undefined);
      if (!live()) return;
      this.set("connected", null);
    } catch (error) {
      if (!live()) return;
      // Closing must not count as Discord going away, which would retry.
      this.attempt++;
      client.close();
      this.client = null;
      if (error instanceof SignedOut) return this.set("signed-out", null);
      this.set("error", error instanceof SignInError ? error.code : "failed");
    }
  }

  private retry(status: DiscordStatus): void {
    this.set(status, null);
    if (!this.wanted) return;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      if (this.wanted && this.status === status) void this.start(false);
    }, RETRY_MS);
  }

  /** AUTHENTICATE with the saved token, refreshing it if needed; asks for approval only when the user pressed Connect. */
  private async signIn(client: RpcClient, interactive: boolean, live: () => boolean, reauthorize: boolean): Promise<{ id: string; name: string } | null> {
    let token = reauthorize ? null : this.secrets.token;
    if (token && token.expiresAt - this.now() < 60_000) token = await this.refresh(token).catch(() => null);
    if (token) {
      try {
        return await this.authenticate(client, token.accessToken);
      } catch (error) {
        if (!(error instanceof RpcError) || error.code === 0) throw error;
        // Discord refused the token (revoked or expired); try a fresh one once.
        const fresh = await this.refresh(token).catch(() => null);
        if (fresh) return await this.authenticate(client, fresh.accessToken);
        await this.saveToken(null);
      }
    }
    if (!interactive || !live()) throw new SignedOut();
    this.set("approving", null);
    // PKCE: Discord keeps the challenge and gives a token only to whoever shows the verifier.
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let code: unknown;
    try {
      ({ code } = (await client.command("AUTHORIZE", { client_id: this.deps.clientId, scopes: SCOPES, code_challenge: challenge, code_challenge_method: "S256" }, undefined, AUTHORIZE_TIMEOUT_MS)) as { code?: unknown });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new SignInError("not-approved");
      throw error;
    }
    if (typeof code !== "string" || !code || code.length > 200) throw new SignInError("no-code");
    const fresh = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
    if (!live()) throw new SignedOut();
    return await this.authenticate(client, fresh.accessToken);
  }

  private async authenticate(client: RpcClient, accessToken: string): Promise<{ id: string; name: string } | null> {
    const answer = await client.command("AUTHENTICATE", { access_token: accessToken });
    this.granted = parseScopes(answer);
    return parseUser(answer);
  }

  private refresh(token: DiscordToken): Promise<DiscordToken> {
    return this.exchange({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  }

  /** Asks Discord for a token. Only discord.com is ever sent the code, the verifier or a refresh token. */
  private async exchange(grant: Record<string, string>): Promise<DiscordToken> {
    let response: Response;
    try {
      response = await this.deps.fetch(this.deps.tokenUrl ?? TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.deps.clientId, ...grant }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SignInError("offline");
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const { access_token: access, refresh_token: refresh, expires_in: expires } = body;
    if (!response.ok || typeof access !== "string" || typeof refresh !== "string" || access.length > 500 || refresh.length > 500) {
      throw new SignInError("no-sign-in");
    }
    const token = { accessToken: access, refreshToken: refresh, expiresAt: this.now() + (typeof expires === "number" && expires > 0 ? expires * 1000 : 3_600_000) };
    await this.saveToken(token);
    return token;
  }

  private async saveToken(token: DiscordToken | null): Promise<void> {
    this.secrets = { ...this.secrets, token };
    await this.deps.save(this.secrets).catch(() => undefined);
  }

  // ── Events ───────────────────────────────────────────────────────────

  /**
   * Passes an event on to the panels that subscribed to it. Voice events name their channel; one
   * that does not goes to every panel that subscribed to that event for any channel.
   */
  private onEvent(evt: string, data: unknown): void {
    if (!(DISCORD_EVENTS as readonly string[]).includes(evt)) return;
    const event = evt as DiscordEventName;
    const channelId = record(data).channel_id;
    const wants = (keys: Set<string>) =>
      event === "VOICE_CHANNEL_SELECT" ? keys.has(event) : isSnowflake(channelId) ? keys.has(keyOf(event, channelId)) : [...keys].some((key) => key.startsWith(`${event}:`));
    const targets = [...this.subscribed].filter(([, keys]) => wants(keys)).map(([instanceId]) => instanceId);
    if (targets.length === 0) return;
    const answer = passOn(data);
    if (!answer) return;
    for (const instanceId of targets) this.listeners.get(instanceId)?.event({ event, data: answer.json });
  }

  // ── Pictures ─────────────────────────────────────────────────────────

  /** Fetches a small PNG from Discord's image server; null on any problem. No cookies or referrer are sent. */
  private async fetchImage(url: string): Promise<string | null> {
    try {
      const response = await this.deps.fetch(url, { redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10_000) });
      if (!response.ok || !response.body) return null;
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_IMAGE) return null;
      // Counted while it streams in, so an answer without a length cannot grow past the limit either.
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > MAX_IMAGE) return null;
        parts.push(Buffer.from(chunk));
      }
      return pngDataUrl(Buffer.concat(parts));
    } catch {
      return null;
    }
  }

  // ── Telling ──────────────────────────────────────────────────────────

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = this.setTimer(() => this.emitNow(), EMIT_MS);
  }

  private emitNow(): void {
    if (this.emitTimer) this.clearTimer(this.emitTimer);
    this.emitTimer = undefined;
    this.deps.onChange(this.view());
    const state = this.state();
    for (const listener of this.listeners.values()) listener.state(state);
  }
}
