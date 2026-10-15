import type { DiscordChannel, DiscordMember, DiscordStatus, DiscordView } from "../shared/host-api";
import { AUTHORIZE_TIMEOUT_MS, RpcClient, RpcError, type RpcEvents } from "./discord-rpc";
import {
  avatarUrl,
  isSnowflake,
  parseChannel,
  parseGuild,
  parseUser,
  parseVoiceChannelIds,
  parseVoiceState,
  pngDataUrl,
  speakingUser,
  MAX_IMAGE,
  MAX_MEMBERS,
  type Guild,
  type VoiceChannel,
  type VoicePerson,
} from "./discord-voice";

// The Discord panel's connection: the Discord desktop app on this PC tells
// Tavora which voice channel the player is in, who else is there, who is
// talking and who is muted. Nothing goes through Tavora's service; audio
// never goes through Tavora at all. See docs/threat-model.md (D1–D7).

/** Tavora's application in the Discord Developer Portal. Its id is public; its secret is not. */
export const DISCORD_CLIENT_ID = "1560388687370387610";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const REDIRECT_URI = "http://localhost";
/** Only reading voice: Tavora can't speak, read messages or change anything. */
export const SCOPES = ["rpc", "rpc.voice.read", "identify"];
const VOICE_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"];
/** How often Tavora looks for the Discord app while it is not running. */
export const RETRY_MS = 10_000;
/** How often the server's other voice channels are read again. */
export const OTHERS_MS = 10_000;
/** Changes are sent to the host UI at most this often; speaking changes come quickly. */
const EMIT_MS = 50;
const MAX_AVATARS = 300;

export interface DiscordToken {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970. */
  expiresAt: number;
}

/** What Tavora keeps on this PC, encrypted by the host (safeStorage). */
export interface DiscordSecrets {
  secret: string | null;
  token: DiscordToken | null;
}

export interface DiscordDeps {
  clientId: string;
  connect(events: RpcEvents): Promise<RpcClient | null>;
  /** Tests only: where tokens are asked for instead of discord.com. */
  tokenUrl?: string;
  fetch: typeof fetch;
  load(): Promise<DiscordSecrets>;
  save(secrets: DiscordSecrets): Promise<void>;
  canSaveSecret: boolean;
  onChange(view: DiscordView): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class DiscordError extends Error {}

export class DiscordConnection {
  private secrets: DiscordSecrets = { secret: null, token: null };
  private loaded: Promise<void>;
  private client: RpcClient | null = null;
  private wanted = false;
  /** Bumped whenever a connection attempt should give up (stop, sign out, a newer attempt). */
  private attempt = 0;
  private status: DiscordStatus = "off";
  private error: string | null = null;
  private user: { id: string; name: string } | null = null;
  private guild: Guild | null = null;
  private call: VoiceChannel | null = null;
  private others: VoiceChannel[] = [];
  private readonly speaking = new Set<string>();
  private readonly avatars = new Map<string, string | null>();
  private readonly guildIcons = new Map<string, string | null>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private othersTimer: ReturnType<typeof setTimeout> | undefined;
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

  view(): DiscordView {
    const member = (person: VoicePerson): DiscordMember => ({
      id: person.id,
      name: person.name,
      avatar: this.avatars.get(person.id) ?? null,
      speaking: this.speaking.has(person.id),
      selfMute: person.selfMute,
      selfDeaf: person.selfDeaf,
      serverMute: person.serverMute,
      serverDeaf: person.serverDeaf,
    });
    const channel = (voice: VoiceChannel): DiscordChannel => ({ id: voice.id, name: voice.name, members: voice.people.map(member) });
    const connected = this.status === "connected";
    return {
      status: this.status,
      error: this.error,
      secretSaved: this.secrets.secret !== null,
      canSaveSecret: this.deps.canSaveSecret,
      user: this.user,
      server: connected && this.guild && this.call?.guildId === this.guild.id ? { id: this.guild.id, name: this.guild.name, icon: this.guildIcons.get(this.guild.id) ?? null } : null,
      call: connected && this.call ? channel(this.call) : null,
      others: connected && this.call?.guildId ? this.others.map(channel) : [],
    };
  }

  /** True while a Discord panel is open; the connection only runs then. */
  async setWanted(wanted: boolean): Promise<void> {
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    if (!wanted) {
      this.stop("off");
      return;
    }
    await this.loaded;
    if (this.wanted && this.status === "off") void this.start(false);
  }

  /** The player pressed Connect: approval in Discord may be asked for. */
  async connectNow(): Promise<void> {
    await this.loaded;
    if (!this.secrets.secret) throw new DiscordError("Add the Client Secret in Settings > Discord first.");
    void this.start(true);
  }

  async setSecret(secret: string | null): Promise<void> {
    await this.loaded;
    if (secret !== null && !this.deps.canSaveSecret) throw new DiscordError("This PC can't keep secrets encrypted, so Tavora won't save the Client Secret.");
    this.secrets = { secret, token: secret === null ? null : this.secrets.token };
    await this.deps.save(this.secrets);
    if (secret === null) this.stop(this.wanted ? "no-secret" : "off");
    else if (this.wanted && (this.status === "no-secret" || this.status === "error" || this.status === "off")) void this.start(false);
    this.emitNow();
  }

  async signOut(): Promise<void> {
    await this.loaded;
    this.secrets = { ...this.secrets, token: null };
    await this.deps.save(this.secrets);
    this.user = null;
    this.stop(this.wanted ? (this.secrets.secret ? "signed-out" : "no-secret") : "off");
  }

  dispose(): void {
    this.wanted = false;
    this.stop("off");
    if (this.emitTimer) this.clearTimer(this.emitTimer);
  }

  // ── Connecting ───────────────────────────────────────────────────────

  private stop(status: DiscordStatus): void {
    this.attempt++;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    if (this.othersTimer) this.clearTimer(this.othersTimer);
    this.retryTimer = this.othersTimer = undefined;
    const client = this.client;
    this.client = null;
    client?.close();
    this.call = null;
    this.others = [];
    this.guild = null;
    this.speaking.clear();
    this.set(status, null);
  }

  private set(status: DiscordStatus, error: string | null): void {
    this.status = status;
    this.error = error;
    this.emit();
  }

  private async start(interactive: boolean): Promise<void> {
    this.stop(this.status);
    const attempt = this.attempt;
    const live = () => attempt === this.attempt && this.wanted;
    if (!this.wanted) return;
    if (!this.secrets.secret) return this.set("no-secret", null);
    if (!this.secrets.token && !interactive) return this.set("signed-out", null);
    this.set("connecting", null);
    const client = await this.deps.connect({
      onEvent: (evt, data) => attempt === this.attempt && this.onEvent(evt, data),
      onClose: () => {
        if (attempt !== this.attempt) return;
        this.client = null;
        this.call = null;
        this.speaking.clear();
        this.retry("not-running");
      },
    });
    if (!live()) return void client?.close();
    if (!client) return this.retry("not-running");
    this.client = client;
    try {
      this.user = await this.signIn(client, interactive, live);
      if (!live()) return;
      await client.subscribe("VOICE_CHANNEL_SELECT");
      this.set("connected", null);
      await this.followSelected();
    } catch (error) {
      if (!live()) return;
      // Closing must not count as Discord going away, which would retry.
      this.attempt++;
      client.close();
      this.client = null;
      if (error instanceof SignedOut) return this.set("signed-out", null);
      const message = error instanceof DiscordError || error instanceof RpcError ? error.message : "Tavora could not connect to Discord.";
      this.set("error", message);
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

  /** AUTHENTICATE with the saved token, refreshing it if needed; asks for approval only when the player pressed Connect. */
  private async signIn(client: RpcClient, interactive: boolean, live: () => boolean): Promise<{ id: string; name: string } | null> {
    let token = this.secrets.token;
    if (token && token.expiresAt - this.now() < 60_000) token = await this.refresh(token).catch(() => null);
    if (token) {
      try {
        return parseUser(await client.command("AUTHENTICATE", { access_token: token.accessToken }));
      } catch (error) {
        if (!(error instanceof RpcError) || error.code === 0) throw error;
        // Discord refused the token (revoked or expired); try a fresh one once.
        const fresh = await this.refresh(token).catch(() => null);
        if (fresh) return parseUser(await client.command("AUTHENTICATE", { access_token: fresh.accessToken }));
        await this.saveToken(null);
      }
    }
    if (!interactive || !live()) throw new SignedOut();
    this.set("approving", null);
    let code: unknown;
    try {
      ({ code } = (await client.command("AUTHORIZE", { client_id: this.deps.clientId, scopes: SCOPES }, undefined, AUTHORIZE_TIMEOUT_MS)) as { code?: unknown });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new DiscordError("Discord was not approved. Press Connect to try again.");
      throw error;
    }
    if (typeof code !== "string" || !code || code.length > 200) throw new DiscordError("Discord did not approve Tavora.");
    const fresh = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
    if (!live()) throw new SignedOut();
    return parseUser(await client.command("AUTHENTICATE", { access_token: fresh.accessToken }));
  }

  private refresh(token: DiscordToken): Promise<DiscordToken> {
    return this.exchange({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  }

  /** Asks Discord for a token with the Client Secret. Only discord.com is ever sent the secret. */
  private async exchange(grant: Record<string, string>): Promise<DiscordToken> {
    const secret = this.secrets.secret;
    if (!secret) throw new DiscordError("Add the Client Secret in Settings > Discord first.");
    let response: Response;
    try {
      response = await this.deps.fetch(this.deps.tokenUrl ?? TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.deps.clientId, client_secret: secret, ...grant }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new DiscordError("Discord could not be reached. Check your internet connection.");
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 401 || body.error === "invalid_client") throw new DiscordError("Discord does not accept the Client Secret. Check it in Settings > Discord.");
    const { access_token: access, refresh_token: refresh, expires_in: expires } = body;
    if (!response.ok || typeof access !== "string" || typeof refresh !== "string" || access.length > 500 || refresh.length > 500) {
      throw new DiscordError("Discord did not sign Tavora in. Press Connect to try again.");
    }
    const token = { accessToken: access, refreshToken: refresh, expiresAt: this.now() + (typeof expires === "number" && expires > 0 ? expires * 1000 : 3_600_000) };
    await this.saveToken(token);
    return token;
  }

  private async saveToken(token: DiscordToken | null): Promise<void> {
    this.secrets = { ...this.secrets, token };
    await this.deps.save(this.secrets).catch(() => undefined);
  }

  // ── Voice ────────────────────────────────────────────────────────────

  private async followSelected(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const channel = parseChannel(await client.command("GET_SELECTED_VOICE_CHANNEL"));
    if (client !== this.client) return;
    const previous = this.call;
    if (previous && previous.id !== channel?.id) {
      for (const evt of VOICE_EVENTS) void client.unsubscribe(evt, { channel_id: previous.id }).catch(() => undefined);
    }
    this.speaking.clear();
    this.call = channel;
    if (this.othersTimer) this.clearTimer(this.othersTimer);
    this.othersTimer = undefined;
    if (!channel) {
      this.others = [];
      return this.emit();
    }
    this.loadAvatars(channel.people);
    if (previous?.id !== channel.id) {
      for (const evt of VOICE_EVENTS) await client.subscribe(evt, { channel_id: channel.id }).catch(() => undefined);
    }
    this.emit();
    if (channel.guildId) {
      if (this.guild?.id !== channel.guildId) await this.loadGuild(client, channel.guildId);
      await this.loadOthers(client);
    } else this.others = [];
    this.emit();
  }

  private async loadGuild(client: RpcClient, guildId: string): Promise<void> {
    const guild = parseGuild(await client.command("GET_GUILD", { guild_id: guildId }).catch(() => null));
    if (client !== this.client) return;
    this.guild = guild ?? { id: guildId, name: "Server", iconUrl: null };
    if (guild?.iconUrl && !this.guildIcons.has(guild.id)) {
      this.guildIcons.set(guild.id, null);
      void this.image(guild.iconUrl).then((icon) => {
        this.guildIcons.set(guild.id, icon);
        this.emit();
      });
    }
  }

  /** The server's other voice channels and who is in them; read again every OTHERS_MS while connected. */
  private async loadOthers(client: RpcClient): Promise<void> {
    const guildId = this.call?.guildId;
    if (!guildId) return;
    const ids = parseVoiceChannelIds(await client.command("GET_CHANNELS", { guild_id: guildId }).catch(() => null));
    const channels: VoiceChannel[] = [];
    for (const id of ids) {
      if (id === this.call?.id) continue;
      const channel = parseChannel(await client.command("GET_CHANNEL", { channel_id: id }).catch(() => null));
      if (channel) channels.push(channel);
    }
    if (client !== this.client || this.call?.guildId !== guildId) return;
    this.others = channels.sort((a, b) => a.position - b.position);
    for (const channel of channels) this.loadAvatars(channel.people);
    this.emit();
    if (this.othersTimer) this.clearTimer(this.othersTimer);
    this.othersTimer = this.setTimer(() => {
      this.othersTimer = undefined;
      if (client === this.client) void this.loadOthers(client);
    }, OTHERS_MS);
  }

  private onEvent(evt: string, data: unknown): void {
    if (evt === "VOICE_CHANNEL_SELECT") {
      void this.followSelected().catch(() => undefined);
      return;
    }
    const call = this.call;
    if (!call) return;
    // Events name their channel; ones for a channel Tavora no longer shows are ignored.
    const channelId = (data as { channel_id?: unknown } | null)?.channel_id;
    if (isSnowflake(channelId) && channelId !== call.id) return;
    switch (evt) {
      case "VOICE_STATE_CREATE":
      case "VOICE_STATE_UPDATE": {
        const person = parseVoiceState(data);
        if (!person) return;
        const index = call.people.findIndex((other) => other.id === person.id);
        if (index >= 0) call.people[index] = person;
        else if (call.people.length < MAX_MEMBERS) call.people.push(person);
        this.loadAvatars([person]);
        break;
      }
      case "VOICE_STATE_DELETE": {
        const person = parseVoiceState(data);
        if (!person) return;
        call.people = call.people.filter((other) => other.id !== person.id);
        this.speaking.delete(person.id);
        break;
      }
      case "SPEAKING_START":
      case "SPEAKING_STOP": {
        const id = speakingUser(data);
        if (!id) return;
        if (evt === "SPEAKING_START") this.speaking.add(id);
        else this.speaking.delete(id);
        break;
      }
      default:
        return;
    }
    this.emit();
  }

  // ── Pictures ─────────────────────────────────────────────────────────

  private loadAvatars(people: VoicePerson[]): void {
    for (const person of people) {
      if (!person.avatarHash) continue;
      const key = person.id;
      const url = avatarUrl(person.id, person.avatarHash);
      if (!url || this.avatars.has(key)) continue;
      if (this.avatars.size >= MAX_AVATARS) this.avatars.delete(this.avatars.keys().next().value!);
      this.avatars.set(key, null);
      void this.image(url).then((image) => {
        if (!this.avatars.has(key)) return;
        this.avatars.set(key, image);
        if (image) this.emit();
      });
    }
  }

  /** Fetches a small PNG from Discord's image server; null on any problem. No cookies or referrer are sent. */
  private async image(url: string): Promise<string | null> {
    try {
      const response = await this.deps.fetch(url, { redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_IMAGE) return null;
      return pngDataUrl(Buffer.from(await response.arrayBuffer()));
    } catch {
      return null;
    }
  }

  // ── Telling the host UI ──────────────────────────────────────────────

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = this.setTimer(() => this.emitNow(), EMIT_MS);
  }

  private emitNow(): void {
    if (this.emitTimer) this.clearTimer(this.emitTimer);
    this.emitTimer = undefined;
    this.deps.onChange(this.view());
  }
}

class SignedOut extends Error {}
