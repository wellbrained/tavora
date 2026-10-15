import type { MessageKey } from "../shared/i18n";
import { PlayerError } from "./messages";
import type { DiscordChannel, DiscordMember, DiscordStatus, DiscordView } from "../shared/host-api";
import { AUTHORIZE_TIMEOUT_MS, RpcClient, RpcError, type RpcEvents } from "./discord-rpc";
import {
  avatarUrl,
  isSnowflake,
  parseChannel,
  parseGuild,
  parseUser,
  parseGuilds,
  parseScopes,
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
/** Reading voice, joining and leaving a channel, and muting or deafening the player. Tavora can't speak or read messages. */
export const SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"];
/** The scope that lets Tavora mute and deafen the player; sign-ins made before 0.5.11 lack it. */
const WRITE_SCOPE = "rpc.voice.write";
const MAX_GAMES = 200;
const VOICE_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"];
/** How often Tavora looks for the Discord app while it is not running. */
export const RETRY_MS = 10_000;
/** How often the browsed server's voice channels are read again (5 minutes). */
export const OTHERS_MS = 300_000;
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
/** The voice channel the player was last in on a server, so it can be joined again from the panel. */
export interface DiscordLast {
  channelId: string;
  guildId: string;
  name: string;
  serverName: string | null;
}

/** The server a game remembers, and the channel the player was last in there. */
export interface DiscordGame {
  guildId: string | null;
  serverName: string | null;
  channelId: string | null;
  channelName: string | null;
}

export interface DiscordSecrets {
  secret: string | null;
  token: DiscordToken | null;
  last?: DiscordLast | null;
  /** By game id; a game with an entry has "Remember the server on this game" ticked. */
  games?: Record<string, DiscordGame>;
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

export class DiscordError extends PlayerError {}

export class DiscordConnection {
  private secrets: DiscordSecrets = { secret: null, token: null };
  private loaded: Promise<void>;
  private client: RpcClient | null = null;
  private wanted = false;
  /** Bumped whenever a connection attempt should give up (stop, sign out, a newer attempt). */
  private attempt = 0;
  private status: DiscordStatus = "off";
  private error: MessageKey | null = null;
  private user: { id: string; name: string } | null = null;
  private readonly guilds = new Map<string, Guild>();
  private gameId: string | null = null;
  private granted: string[] = [];
  private servers: { id: string; name: string }[] = [];
  /** The voice channels of the browsed server, with who is in them. */
  private browse: VoiceChannel[] = [];
  private browseGuildId: string | null = null;
  private call: VoiceChannel | null = null;
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
    const server = (guildId: string | null | undefined, fallback: string | null) => {
      if (!guildId) return null;
      const guild = this.guilds.get(guildId);
      if (guild) return { id: guildId, name: guild.name, icon: this.guildIcons.get(guildId) ?? null };
      return fallback ? { id: guildId, name: fallback, icon: null } : null;
    };
    const connected = this.status === "connected";
    const game = this.gameId ? this.secrets.games?.[this.gameId] : undefined;
    const last = game ? (game.channelId && game.channelName ? { channelId: game.channelId, name: game.channelName, serverName: game.serverName } : null) : this.secrets.last ? { channelId: this.secrets.last.channelId, name: this.secrets.last.name, serverName: this.secrets.last.serverName } : null;
    const me = this.user && this.call ? this.call.people.find((person) => person.id === this.user!.id) : undefined;
    return {
      status: this.status,
      error: this.error,
      secretSaved: this.secrets.secret !== null,
      canSaveSecret: this.deps.canSaveSecret,
      user: this.user,
      server: connected ? server(this.call?.guildId, null) : null,
      browseServer: connected ? server(this.browseGuildId, game?.guildId === this.browseGuildId ? game?.serverName ?? null : null) : null,
      call: connected && this.call ? channel(this.call) : null,
      others: connected ? this.browse.filter((other) => other.id !== this.call?.id).map(channel) : [],
      last,
      game: { remember: game !== undefined, serverId: game?.guildId ?? null },
      servers: connected ? this.servers : [],
      canControl: this.granted.includes(WRITE_SCOPE),
      self: connected && me ? { mute: me.selfMute, deaf: me.selfDeaf } : null,
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
    if (!this.secrets.secret) throw new DiscordError("discord.error.noSecret");
    void this.start(true);
  }

  async setSecret(secret: string | null): Promise<void> {
    await this.loaded;
    if (secret !== null && !this.deps.canSaveSecret) throw new DiscordError("discord.error.cantSave");
    this.secrets = secret === null ? { secret, token: null, last: null, games: {} } : { ...this.secrets, secret };
    await this.deps.save(this.secrets);
    if (secret === null) this.stop(this.wanted ? "no-secret" : "off");
    else if (this.wanted && (this.status === "no-secret" || this.status === "error" || this.status === "off")) void this.start(false);
    this.emitNow();
  }

  async signOut(): Promise<void> {
    await this.loaded;
    this.secrets = { ...this.secrets, token: null, last: null, games: {} };
    await this.deps.save(this.secrets);
    this.user = null;
    this.stop(this.wanted ? (this.secrets.secret ? "signed-out" : "no-secret") : "off");
  }

  /**
   * Joins a voice channel in the Discord app: the one the player was last in,
   * or one of the server's channels the panel lists. The only command Tavora
   * sends that changes anything in Discord, and only after the player asked.
   */
  async join(channelId: string): Promise<void> {
    await this.loaded;
    const client = this.client;
    if (!client || this.status !== "connected") throw new DiscordError("discord.error.joinNotConnected");
    const game = this.gameId ? this.secrets.games?.[this.gameId] : undefined;
    if (channelId !== this.secrets.last?.channelId && channelId !== game?.channelId && !this.browse.some((other) => other.id === channelId)) throw new DiscordError("discord.error.joinUnknown");
    try {
      await client.command("SELECT_VOICE_CHANNEL", { channel_id: channelId, force: true });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new DiscordError("discord.error.joinFailed");
      throw error;
    }
  }

  /** Leaves the voice channel in the Discord app. */
  async leave(): Promise<void> {
    await this.loaded;
    const client = this.client;
    if (!client || this.status !== "connected") throw new DiscordError("discord.error.joinNotConnected");
    try {
      await client.command("SELECT_VOICE_CHANNEL", { channel_id: null });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new DiscordError("discord.error.leaveFailed");
      throw error;
    }
  }

  /** Mutes or deafens the player in the Discord app, if the player approved it. */
  async setVoice(settings: { mute?: boolean; deaf?: boolean }): Promise<void> {
    await this.loaded;
    const client = this.client;
    if (!client || this.status !== "connected") throw new DiscordError("discord.error.joinNotConnected");
    if (!this.granted.includes(WRITE_SCOPE)) throw new DiscordError("discord.error.needsControl");
    try {
      await client.command("SET_VOICE_SETTINGS", { ...(settings.mute === undefined ? {} : { mute: settings.mute }), ...(settings.deaf === undefined ? {} : { deaf: settings.deaf }) });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new DiscordError("discord.error.voiceFailed");
      throw error;
    }
  }

  /** The player pressed Allow muting: Discord is asked to approve the new permission. */
  async allowControl(): Promise<void> {
    await this.loaded;
    if (!this.secrets.secret) throw new DiscordError("discord.error.noSecret");
    void this.start(true, true);
  }

  /** The game the host is showing; its remembered server is the one browsed. */
  setGame(gameId: string | null): void {
    if (gameId === this.gameId) return;
    this.gameId = gameId;
    const client = this.client;
    if (client && this.status === "connected") void this.loadBrowse(client);
    this.emit();
  }

  /** The tick box: remember the server on this game (taking the one the player is in), or forget it. */
  async rememberGame(gameId: string, remember: boolean): Promise<void> {
    await this.loaded;
    const games = { ...this.secrets.games };
    if (!remember) delete games[gameId];
    else if (!games[gameId]) {
      const call = this.call;
      const guildId = call?.guildId ?? null;
      games[gameId] = { guildId, serverName: guildId ? this.guilds.get(guildId)?.name ?? null : null, channelId: guildId ? call!.id : null, channelName: guildId ? call!.name : null };
      const keys = Object.keys(games);
      if (keys.length > MAX_GAMES) delete games[keys[0]!];
    }
    await this.saveGames(games, gameId);
  }

  /** The player chose a server for a game from the list of the servers they are on. */
  async setGameServer(gameId: string, guildId: string): Promise<void> {
    await this.loaded;
    const known = this.servers.find((server) => server.id === guildId);
    if (!known) throw new DiscordError("discord.error.serverUnknown");
    const games = { ...this.secrets.games, [gameId]: { guildId, serverName: known.name, channelId: null, channelName: null } };
    await this.saveGames(games, gameId);
  }

  /** Reads the server list and the browsed server again now. */
  async reload(): Promise<void> {
    await this.loaded;
    const client = this.client;
    if (!client || this.status !== "connected") return;
    await this.loadServers(client);
    await this.loadBrowse(client);
  }

  private async saveGames(games: Record<string, DiscordGame>, gameId: string): Promise<void> {
    this.secrets = { ...this.secrets, games };
    await this.deps.save(this.secrets).catch(() => undefined);
    const client = this.client;
    if (gameId === this.gameId && client && this.status === "connected") await this.loadBrowse(client);
    this.emitNow();
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
    this.browse = [];
    this.browseGuildId = null;
    this.speaking.clear();
    this.set(status, null);
  }

  private set(status: DiscordStatus, error: MessageKey | null): void {
    this.status = status;
    this.error = error;
    this.emit();
  }

  private async start(interactive: boolean, reauthorize = false): Promise<void> {
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
      this.user = await this.signIn(client, interactive, live, reauthorize);
      if (!live()) return;
      await client.subscribe("VOICE_CHANNEL_SELECT");
      this.set("connected", null);
      await this.loadServers(client);
      await this.followSelected();
    } catch (error) {
      if (!live()) return;
      // Closing must not count as Discord going away, which would retry.
      this.attempt++;
      client.close();
      this.client = null;
      if (error instanceof SignedOut) return this.set("signed-out", null);
      this.set("error", error instanceof DiscordError ? error.key : "discord.error.generic");
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
    let code: unknown;
    try {
      ({ code } = (await client.command("AUTHORIZE", { client_id: this.deps.clientId, scopes: SCOPES }, undefined, AUTHORIZE_TIMEOUT_MS)) as { code?: unknown });
    } catch (error) {
      if (error instanceof RpcError && error.code !== 0) throw new DiscordError("discord.error.notApproved");
      throw error;
    }
    if (typeof code !== "string" || !code || code.length > 200) throw new DiscordError("discord.error.noCode");
    const fresh = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
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

  /** Asks Discord for a token with the Client Secret. Only discord.com is ever sent the secret. */
  private async exchange(grant: Record<string, string>): Promise<DiscordToken> {
    const secret = this.secrets.secret;
    if (!secret) throw new DiscordError("discord.error.noSecret");
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
      throw new DiscordError("discord.error.offline");
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 401 || body.error === "invalid_client") throw new DiscordError("discord.error.badSecret");
    const { access_token: access, refresh_token: refresh, expires_in: expires } = body;
    if (!response.ok || typeof access !== "string" || typeof refresh !== "string" || access.length > 500 || refresh.length > 500) {
      throw new DiscordError("discord.error.noSignIn");
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
    if (!channel) {
      await this.loadBrowse(client);
      return this.emit();
    }
    this.loadAvatars(channel.people);
    if (previous?.id !== channel.id) {
      for (const evt of VOICE_EVENTS) await client.subscribe(evt, { channel_id: channel.id }).catch(() => undefined);
    }
    this.emit();
    if (channel.guildId && !this.guilds.has(channel.guildId)) await this.loadGuild(client, channel.guildId);
    void this.learn(channel);
    await this.loadBrowse(client);
    this.emit();
  }

  private async loadGuild(client: RpcClient, guildId: string): Promise<void> {
    const guild = parseGuild(await client.command("GET_GUILD", { guild_id: guildId }).catch(() => null));
    if (client !== this.client || !guild) return;
    this.guilds.set(guildId, guild);
    if (guild.iconUrl && !this.guildIcons.has(guildId)) {
      this.guildIcons.set(guildId, null);
      void this.image(guild.iconUrl).then((icon) => {
        this.guildIcons.set(guildId, icon);
        this.emit();
      });
    }
  }

  /** The servers the player is on, for choosing one for a game. */
  private async loadServers(client: RpcClient): Promise<void> {
    const servers = parseGuilds(await client.command("GET_GUILDS").catch(() => null));
    if (client !== this.client) return;
    this.servers = servers;
    this.emit();
  }

  /** The server to browse: the open game's remembered one, else the one the player is in a call on. */
  private browseTarget(): string | null {
    const game = this.gameId ? this.secrets.games?.[this.gameId] : undefined;
    return game?.guildId ?? this.call?.guildId ?? null;
  }

  /** The browsed server's voice channels and who is in them; read again every OTHERS_MS while connected. */
  private async loadBrowse(client: RpcClient): Promise<void> {
    if (this.othersTimer) this.clearTimer(this.othersTimer);
    this.othersTimer = undefined;
    const guildId = this.browseTarget();
    if (!guildId) {
      this.browse = [];
      this.browseGuildId = null;
      return this.emit();
    }
    if (!this.guilds.has(guildId)) await this.loadGuild(client, guildId);
    const ids = parseVoiceChannelIds(await client.command("GET_CHANNELS", { guild_id: guildId }).catch(() => null));
    const channels: VoiceChannel[] = [];
    for (const id of ids) {
      const channel = parseChannel(await client.command("GET_CHANNEL", { channel_id: id }).catch(() => null));
      if (channel) channels.push(channel);
    }
    // The player moved on to another server meanwhile: that change reads its own.
    if (client !== this.client || this.browseTarget() !== guildId) return;
    this.browse = channels.sort((a, b) => a.position - b.position);
    this.browseGuildId = guildId;
    for (const channel of channels) this.loadAvatars(channel.people);
    this.emit();
    if (this.othersTimer) this.clearTimer(this.othersTimer);
    this.othersTimer = this.setTimer(() => {
      this.othersTimer = undefined;
      if (client === this.client) void this.loadBrowse(client);
    }, OTHERS_MS);
  }

  /** Keeps where the player is as the channel to rejoin: for any game, and for the open game when it remembers a server. */
  private async learn(channel: VoiceChannel): Promise<void> {
    const guildId = channel.guildId;
    if (!guildId || this.call?.id !== channel.id) return;
    const known = this.secrets.last;
    const serverName = this.guilds.get(guildId)?.name ?? (known?.guildId === guildId ? known.serverName : null);
    let changed = false;
    let last = known ?? null;
    if (!(known && known.channelId === channel.id && known.name === channel.name && known.serverName === serverName)) {
      last = { channelId: channel.id, guildId, name: channel.name, serverName };
      changed = true;
    }
    let games = this.secrets.games;
    const game = this.gameId ? games?.[this.gameId] : undefined;
    // A game that has a server keeps it; a call on another server doesn't replace it.
    if (this.gameId && game && (game.guildId === null || game.guildId === guildId)) {
      const next = { guildId, serverName: serverName ?? game.serverName, channelId: channel.id, channelName: channel.name };
      if (JSON.stringify(next) !== JSON.stringify(game)) {
        games = { ...games, [this.gameId]: next };
        changed = true;
      }
    }
    if (!changed) return;
    this.secrets = { ...this.secrets, last, games: games ?? {} };
    await this.deps.save(this.secrets).catch(() => undefined);
    this.emit();
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
