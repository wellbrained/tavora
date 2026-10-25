// The Discord panel's logic: which voice channel the player is in, who else is there, who is
// talking and who is muted, and the voice channels of the server this game remembers. Everything
// comes from the Discord app on this PC through Tavora's discord connector, which keeps the sign-in;
// this module only ever sees what Discord answers. The channel to rejoin is kept in the settings
// shared by every game (storage.app), the server a game remembers in that game's settings.

import { TavoraError, type DiscordCommand, type DiscordCommands, type DiscordEvent, type DiscordEventName, type DiscordState, type GameOverlayResult, type JsonValue, type OverlayLinkResult, type TavoraSDK } from "@tavora/sdk";
import { shallowRef } from "vue";
import { shrinkAvatar } from "./avatar";
import { buildOverlayState, OVERLAY_KEY, type OverlayMember, type OverlayState } from "./overlay-state";
import {
  avatarUrl,
  eventChannel,
  MAX_MEMBERS,
  parseChannel,
  parseGameServer,
  parseGuild,
  parseGuilds,
  parseLast,
  parseVoiceChannelIds,
  parseVoiceState,
  speakingUser,
  type GameServer,
  type Guild,
  type LastChannel,
  type VoiceChannel,
  type VoicePerson,
} from "./voice";

/** How often the browsed server's voice channels are read again (5 minutes). */
export const OTHERS_MS = 300_000;
/** After leaving, Discord is asked again this much later, in case it did not leave after all. */
export const RECHECK_MS = 1500;
const VOICE_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"] as const satisfies readonly DiscordEventName[];
const MAX_PICTURES = 300;

/** Keys of the module's settings: `last` is shared by every game, `server` belongs to the game. */
export const KEYS = { last: "last", server: "server", names: "overlayNames" } as const;

/** The voice overlay is published at most this often (5 times a second), because talking can flicker. */
export const PUBLISH_MS = 200;
/** The sample shown by Preview when the player is in no voice channel lasts this long (30 seconds). */
export const SAMPLE_MS = 30_000;
/** Two made-up people for the Preview sample: one talking, one muted. Only used while `sampleActive` is set. */
const SAMPLE_MEMBERS: OverlayMember[] = [
  { id: "1", name: "Alex", tiny: null, speaking: true, muted: false, deafened: false },
  { id: "2", name: "Sam", tiny: null, speaking: false, muted: true, deafened: false },
];

/** Someone in a voice channel, as the panel shows them. Names come from Discord and are shown as text only. */
export interface Member {
  id: string;
  name: string;
  /** Their Discord picture as a data address, or null until it is loaded (or when they have none). */
  avatar: string | null;
  speaking: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  volume: number;
  mutedForMe: boolean;
}

export interface Channel {
  id: string;
  name: string;
  members: Member[];
}

export interface Server {
  id: string;
  name: string;
  icon: string | null;
}

/** What went wrong with something the player did; the panel words it. */
export type ActionError = "joinFailed" | "notConnected" | "joinUnknown" | "leaveFailed" | "needsControl" | "voiceFailed" | "serverUnknown" | "personGone";

export interface PanelView {
  /** The connection to the Discord app; null until the connector answered. */
  state: DiscordState | null;
  /** The player has not allowed this module to use Discord. */
  denied: boolean;
  /** The server of the voice channel the player is in; null in a direct or group call. */
  server: Server | null;
  /** The voice channel or call the player is in, or null. */
  call: Channel | null;
  /** The server whose channels are listed: this game's remembered server, else the one of the call. */
  browseServer: Server | null;
  /** All of that server's voice channels in the server's own order. The panel shows the call's channel live, in its place. */
  channels: Channel[];
  /** The channel offered to join again: this game's last one when it remembers a server, else the last one anywhere. */
  last: { channelId: string; name: string; serverName: string | null } | null;
  /** "Remember the server on this game", and the server it remembers. */
  game: { remember: boolean; serverId: string | null };
  /** The servers the player is on, to choose one for this game. */
  servers: { id: string; name: string }[];
  /** Tavora may mute and deafen the player. */
  canControl: boolean;
  /** The player's own mute and deafen state while in a call. */
  self: { mute: boolean; deaf: boolean } | null;
  /** The player's Discord id, so the panel offers no menu for the player. */
  userId: string | null;
}

export type Panel = ReturnType<typeof createPanel>;

/** Thrown for something the player did that did not work; `key` says what. */
export class PanelError extends Error {
  constructor(readonly key: ActionError) {
    super(key);
  }
}

export interface PanelOptions {
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  /** Timer for the throttled overlay publishing, apart from the others. */
  publishTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Makes the tiny picture the overlay carries from a Discord picture. */
  shrink?: (source: string) => Promise<string | null>;
  now?: () => number;
}

export function createPanel(sdk: TavoraSDK, options: PanelOptions = {}) {
  const discord = sdk.connectors.discord;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const publishTimer = options.publishTimer ?? setTimeout;
  const shrink = options.shrink ?? shrinkAvatar;
  const now = options.now ?? Date.now;

  let state: DiscordState | null = null;
  let denied = false;
  let last: LastChannel | null = null;
  let game: GameServer | null = null;
  let servers: { id: string; name: string }[] = [];
  const guilds = new Map<string, Guild>();
  const guildIcons = new Map<string, string | null>();
  const avatars = new Map<string, string | null>();
  /** The same pictures shrunk for the overlay, with the address they were made from. */
  const tinies = new Map<string, { from: string; tiny: string | null }>();
  /** The voice overlay's settings: names on it. */
  let overlayNames = true;
  /** True while the panel isn't running (suspended or closing): the overlay then shows nobody talking. */
  let suspended = false;
  /** True while Preview's sample is shown (not in a voice channel); it ends on joining or after SAMPLE_MS. */
  let sampleActive = false;
  let sampleTimer: ReturnType<typeof setTimeout> | undefined;
  let published = "";
  let lastPublish = 0;
  let publishPending: ReturnType<typeof setTimeout> | undefined;
  const speaking = new Set<string>();
  let call: VoiceChannel | null = null;
  let browse: VoiceChannel[] = [];
  let browseGuildId: string | null = null;
  let othersTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every new connection or loss of one, so answers from before are dropped. */
  let epoch = 0;
  const cleanup: (() => void)[] = [];

  const view = shallowRef<PanelView>(build());
  /** What the settings for the voice overlay show. */
  const overlay = shallowRef({ names: true, overGame: false });
  let queued = false;

  function build(): PanelView {
    const member = (person: VoicePerson): Member => ({
      id: person.id,
      name: person.name,
      avatar: avatars.get(person.id) ?? null,
      speaking: speaking.has(person.id),
      selfMute: person.selfMute,
      selfDeaf: person.selfDeaf,
      serverMute: person.serverMute,
      serverDeaf: person.serverDeaf,
      volume: person.volume,
      mutedForMe: person.mutedForMe,
    });
    const channel = (voice: VoiceChannel): Channel => ({ id: voice.id, name: voice.name, members: voice.people.map(member) });
    const server = (guildId: string | null | undefined, fallback: string | null): Server | null => {
      if (!guildId) return null;
      const guild = guilds.get(guildId);
      if (guild) return { id: guildId, name: guild.name, icon: guildIcons.get(guildId) ?? null };
      return fallback ? { id: guildId, name: fallback, icon: null } : null;
    };
    const connected = state?.status === "connected";
    const rejoin = game ? (game.channelId && game.channelName ? { channelId: game.channelId, name: game.channelName, serverName: game.serverName } : null) : last ? { channelId: last.channelId, name: last.name, serverName: last.serverName } : null;
    const userId = state?.user?.id ?? null;
    const me = userId && call ? call.people.find((person) => person.id === userId) : undefined;
    return {
      state,
      denied,
      server: connected ? server(call?.guildId, null) : null,
      browseServer: connected ? server(browseGuildId, game?.guildId === browseGuildId ? (game?.serverName ?? null) : null) : null,
      call: connected && call ? channel(call) : null,
      channels: connected ? browse.map(channel) : [],
      last: rejoin,
      game: { remember: game !== null, serverId: game?.guildId ?? null },
      servers: connected ? servers : [],
      canControl: state?.canControl ?? false,
      self: connected && me ? { mute: me.selfMute, deaf: me.selfDeaf } : null,
      userId,
    };
  }

  /** Changes come in bursts (speaking, several people moving): the view is built once per burst. */
  function emit(): void {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      view.value = build();
      schedulePublish();
    });
  }

  // ── The voice overlay ────────────────────────────────────────────────

  /** The state the overlay shows now; null when the player is in no voice channel. */
  function overlayState(): OverlayState | null {
    if (connected() && call) sampleActive = false;
    const clear = (built: OverlayState): OverlayState => (suspended ? { ...built, people: built.people.map(({ s: _s, ...rest }) => rest) } : built);
    if (sampleActive) return clear(buildOverlayState(SAMPLE_MEMBERS, { names: overlayNames }));
    if (!connected() || !call) return null;
    const members: OverlayMember[] = call.people.map((person) => {
      const picture = avatars.get(person.id) ?? null;
      const made = tinies.get(person.id);
      const tiny = picture && made?.from === picture ? made.tiny : null;
      return { id: person.id, name: person.name, tiny, speaking: speaking.has(person.id), muted: person.selfMute || person.serverMute, deafened: person.selfDeaf || person.serverDeaf };
    });
    return clear(buildOverlayState(members, { names: overlayNames }));
  }

  /** Sends the overlay what it shows if that changed, at most every PUBLISH_MS; the last change always goes out. */
  function schedulePublish(force = false): void {
    if (!sdk.overlay) return;
    if (force) published = "";
    if (publishPending) return;
    const wait = Math.max(0, lastPublish + PUBLISH_MS - now());
    publishPending = publishTimer(() => {
      publishPending = undefined;
      publishNow();
    }, wait);
  }

  /** Sends the overlay what it shows now, if that changed. */
  function publishNow(): void {
    if (!sdk.overlay) return;
    const state = overlayState();
    const text = JSON.stringify(state);
    if (text === published) return;
    published = text;
    lastPublish = now();
    const sent = state ? sdk.overlay.publish(OVERLAY_KEY, state as unknown as JsonValue) : sdk.overlay.remove(OVERLAY_KEY);
    sent.catch(() => {
      // Not sent (no grant yet, say): the next change tries again.
      published = "";
    });
  }

  /** The panel stops running: the overlay gets the state with nobody talking, right away (a timer may never fire). */
  function freeze(): void {
    suspended = true;
    if (publishPending) clearTimer(publishPending);
    publishPending = undefined;
    publishNow();
  }

  /** Reads from Tavora whether the voice overlay is over the game, which is what the switch shows. */
  async function refreshOverGame(): Promise<void> {
    try {
      const keys = await sdk.overlay.overGame();
      overlay.value = { ...overlay.value, overGame: keys.includes(OVERLAY_KEY) };
    } catch {
      // Keep what the switch shows.
    }
  }

  function resume(): void {
    suspended = false;
    void refreshOverGame();
    schedulePublish(true);
  }

  /** Makes the tiny overlay picture of someone whose Discord picture just arrived. */
  function makeTiny(id: string, picture: string): void {
    void shrink(picture).then(
      (tiny) => {
        tinies.set(id, { from: picture, tiny });
        if (tiny) emit();
      },
      () => undefined,
    );
  }

  const connected = () => state?.status === "connected";

  /** Reads something from Discord; its answer, or null when there is none. */
  async function run<C extends DiscordCommand>(command: C, args: DiscordCommands[C]): Promise<JsonValue | null> {
    const result = await discord.command(command, args);
    return result.ok ? result.data : null;
  }

  // ── Starting ─────────────────────────────────────────────────────────

  async function start(): Promise<void> {
    last = parseLast(await sdk.storage.app.get(KEYS.last));
    game = parseGameServer(await sdk.storage.get(KEYS.server));
    overlayNames = (await sdk.storage.app.get(KEYS.names)) !== false;
    overlay.value = { names: overlayNames, overGame: false };
    await refreshOverGame();
    cleanup.push(
      discord.onStateChange((next) => onState(next)),
      discord.onEvent((event) => onEvent(event)),
    );
    if (sdk.lifecycle) cleanup.push(sdk.lifecycle.onSuspend(freeze), sdk.lifecycle.onResume(resume));
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", freeze);
      cleanup.push(() => window.removeEventListener("pagehide", freeze));
    }
    try {
      onState(await discord.state());
    } catch (error) {
      if (error instanceof TavoraError && error.code === "PERMISSION_DENIED" && error.capability === "discord") {
        denied = true;
        emit();
        return;
      }
      throw error;
    }
  }

  function stop(): void {
    cleanup.splice(0).forEach((fn) => fn());
    if (publishPending) clearTimer(publishPending);
    publishPending = undefined;
    if (othersTimer) clearTimer(othersTimer);
    othersTimer = undefined;
    if (sampleTimer) clearTimer(sampleTimer);
    sampleTimer = undefined;
    epoch++;
  }

  function onState(next: DiscordState): void {
    const was = connected();
    state = next;
    if (next.status === "connected" && !was) {
      epoch++;
      void onConnected(epoch).catch(() => undefined);
    } else if (next.status !== "connected" && was) {
      epoch++;
      call = null;
      browse = [];
      browseGuildId = null;
      speaking.clear();
      if (othersTimer) clearTimer(othersTimer);
      othersTimer = undefined;
    }
    emit();
  }

  async function onConnected(at: number): Promise<void> {
    // The connector keeps subscriptions across reconnects; asking again does nothing twice.
    await discord.subscribe("VOICE_CHANNEL_SELECT");
    await loadServers(at);
    await followSelected(at);
  }

  // ── Voice ────────────────────────────────────────────────────────────

  async function followSelected(at = epoch): Promise<void> {
    const data = await run("GET_SELECTED_VOICE_CHANNEL", {});
    if (at !== epoch) return;
    const channel = parseChannel(data);
    const previous = call;
    if (previous && previous.id !== channel?.id) for (const event of VOICE_EVENTS) void discord.unsubscribe(event, previous.id).catch(() => undefined);
    speaking.clear();
    call = channel;
    if (!channel) {
      await loadBrowse(at);
      return emit();
    }
    loadAvatars(channel.people);
    if (previous?.id !== channel.id) for (const event of VOICE_EVENTS) await discord.subscribe(event, channel.id).catch(() => undefined);
    emit();
    if (channel.guildId && !guilds.has(channel.guildId)) await loadGuild(channel.guildId, at);
    void learn(channel);
    await loadBrowse(at);
    emit();
  }

  async function loadGuild(guildId: string, at = epoch): Promise<void> {
    const guild = parseGuild(await run("GET_GUILD", { guild_id: guildId }));
    if (at !== epoch || !guild) return;
    guilds.set(guildId, guild);
    if (guild.iconUrl && !guildIcons.has(guildId)) {
      guildIcons.set(guildId, null);
      void discord.image(guild.iconUrl).then(
        (icon) => {
          guildIcons.set(guildId, icon);
          emit();
        },
        () => undefined,
      );
    }
  }

  /** The servers the player is on, for choosing one for this game. */
  async function loadServers(at = epoch): Promise<void> {
    const list = parseGuilds(await run("GET_GUILDS", {}));
    if (at !== epoch) return;
    servers = list;
    emit();
  }

  /** The server to browse: this game's remembered one, else the one the player is in a call on. */
  const browseTarget = () => game?.guildId ?? call?.guildId ?? null;

  /** The browsed server's voice channels and who is in them; read again every OTHERS_MS while connected. */
  async function loadBrowse(at = epoch): Promise<void> {
    if (othersTimer) clearTimer(othersTimer);
    othersTimer = undefined;
    const guildId = browseTarget();
    if (!guildId) {
      browse = [];
      browseGuildId = null;
      return emit();
    }
    if (!guilds.has(guildId)) await loadGuild(guildId, at);
    const ids = parseVoiceChannelIds(await run("GET_CHANNELS", { guild_id: guildId }));
    const channels: VoiceChannel[] = [];
    for (const id of ids) {
      const channel = parseChannel(await run("GET_CHANNEL", { channel_id: id }));
      if (channel) channels.push(channel);
    }
    // The connection changed, or the player moved on to another server meanwhile: that reads its own.
    if (at !== epoch || browseTarget() !== guildId) return;
    browse = channels.sort((a, b) => a.position - b.position);
    browseGuildId = guildId;
    for (const channel of channels) loadAvatars(channel.people);
    emit();
    if (othersTimer) clearTimer(othersTimer);
    othersTimer = setTimer(() => {
      othersTimer = undefined;
      if (at === epoch) void loadBrowse(at).catch(() => undefined);
    }, OTHERS_MS);
  }

  /** Keeps where the player is as the channel to rejoin: for any game, and for this game when it remembers a server. */
  async function learn(channel: VoiceChannel): Promise<void> {
    const guildId = channel.guildId;
    if (!guildId || call?.id !== channel.id) return;
    const serverName = guilds.get(guildId)?.name ?? (last?.guildId === guildId ? last.serverName : null);
    if (!(last && last.channelId === channel.id && last.name === channel.name && last.serverName === serverName)) {
      last = { channelId: channel.id, guildId, name: channel.name, serverName };
      await sdk.storage.app.set(KEYS.last, { ...last }).catch(() => undefined);
    }
    // A game that has a server keeps it; a call on another server doesn't replace it.
    if (game && (game.guildId === null || game.guildId === guildId)) {
      const next: GameServer = { guildId, serverName: serverName ?? game.serverName, channelId: channel.id, channelName: channel.name };
      if (JSON.stringify(next) !== JSON.stringify(game)) {
        game = next;
        await sdk.storage.set(KEYS.server, { ...game }).catch(() => undefined);
      }
    }
    emit();
  }

  function onEvent({ event, data }: DiscordEvent): void {
    if (event === "VOICE_CHANNEL_SELECT") {
      void followSelected().catch(() => undefined);
      return;
    }
    const current = call;
    if (!current) return;
    // Events name their channel; ones for a channel the panel no longer shows are ignored.
    const channelId = eventChannel(data);
    if (channelId && channelId !== current.id) return;
    switch (event) {
      case "VOICE_STATE_CREATE":
      case "VOICE_STATE_UPDATE": {
        const person = parseVoiceState(data);
        if (!person) return;
        const index = current.people.findIndex((other) => other.id === person.id);
        if (index >= 0) current.people[index] = person;
        else if (current.people.length < MAX_MEMBERS) current.people.push(person);
        loadAvatars([person]);
        break;
      }
      case "VOICE_STATE_DELETE": {
        const person = parseVoiceState(data);
        if (!person) return;
        current.people = current.people.filter((other) => other.id !== person.id);
        speaking.delete(person.id);
        break;
      }
      case "SPEAKING_START":
      case "SPEAKING_STOP": {
        const id = speakingUser(data);
        if (!id) return;
        if (event === "SPEAKING_START") speaking.add(id);
        else speaking.delete(id);
        break;
      }
    }
    emit();
  }

  function loadAvatars(people: VoicePerson[]): void {
    for (const person of people) {
      const url = person.avatarHash ? avatarUrl(person.id, person.avatarHash) : null;
      if (!url || avatars.has(person.id)) continue;
      if (avatars.size >= MAX_PICTURES) avatars.delete(avatars.keys().next().value!);
      avatars.set(person.id, null);
      void discord.image(url).then(
        (image) => {
          if (!avatars.has(person.id) || !image) return;
          avatars.set(person.id, image);
          makeTiny(person.id, image);
          emit();
        },
        () => undefined,
      );
    }
  }

  // ── What the player does ─────────────────────────────────────────────

  /** Connect: Tavora signs in, asking for approval in Discord the first time. From a click. */
  const connect = () => discord.connect();

  /** Allow muting: Discord is asked to approve the new permission. From a click. */
  const allowControl = () => discord.allowControl();

  /** Joins a voice channel in the Discord app: the one to rejoin, or one of the listed channels. From a click. */
  async function join(channelId: string): Promise<void> {
    if (!connected()) throw new PanelError("notConnected");
    if (channelId !== last?.channelId && channelId !== game?.channelId && !browse.some((other) => other.id === channelId)) throw new PanelError("joinUnknown");
    const result = await discord.command("SELECT_VOICE_CHANNEL", { channel_id: channelId });
    if (!result.ok) throw new PanelError(result.reason === "not-connected" ? "notConnected" : "joinFailed");
  }

  /** Leaves the voice channel in the Discord app. From a click. */
  async function leave(): Promise<void> {
    if (!connected()) throw new PanelError("notConnected");
    // Shown at once: Discord can take a few seconds to answer.
    markLeft();
    const result = await discord.command("SELECT_VOICE_CHANNEL", { channel_id: null });
    if (!result.ok) {
      void followSelected().catch(() => undefined);
      throw new PanelError(result.reason === "not-connected" ? "notConnected" : "leaveFailed");
    }
    const at = epoch;
    setTimer(() => {
      if (at === epoch) void followSelected(at).catch(() => undefined);
    }, RECHECK_MS);
  }

  function markLeft(): void {
    const previous = call;
    if (!previous) return;
    for (const event of VOICE_EVENTS) void discord.unsubscribe(event, previous.id).catch(() => undefined);
    call = null;
    speaking.clear();
    emit();
    void loadBrowse().catch(() => undefined);
  }

  /** Mutes or deafens the player in the Discord app, if the player allowed it. */
  async function setVoice(settings: { mute?: boolean; deaf?: boolean }): Promise<void> {
    if (!connected()) throw new PanelError("notConnected");
    if (!state?.canControl) throw new PanelError("needsControl");
    const result = await discord.command("SET_VOICE_SETTINGS", settings);
    if (!result.ok) throw new PanelError("voiceFailed");
  }

  /**
   * Sets how loud a person in the player's call is and/or mutes them for the player only (Discord's
   * own per-person settings). Shown at once; if Discord refuses, what Discord says is read again.
   */
  async function setUserVoice(userId: string, settings: { volume?: number; mute?: boolean }): Promise<void> {
    if (!connected()) throw new PanelError("notConnected");
    const person = userId === state?.user?.id ? undefined : call?.people.find((other) => other.id === userId);
    if (!person) throw new PanelError("personGone");
    if (settings.volume !== undefined) person.volume = settings.volume;
    if (settings.mute !== undefined) person.mutedForMe = settings.mute;
    emit();
    const result = await discord.command("SET_USER_VOICE_SETTINGS", { user_id: userId, ...settings });
    if (!result.ok) {
      void followSelected().catch(() => undefined);
      throw new PanelError("voiceFailed");
    }
  }

  /** The tick box: remember the server on this game (taking the one the player is in), or forget it. */
  async function rememberGame(remember: boolean): Promise<void> {
    if (!remember) {
      game = null;
      await sdk.storage.delete(KEYS.server);
    } else if (!game) {
      const guildId = call?.guildId ?? null;
      game = { guildId, serverName: guildId ? (guilds.get(guildId)?.name ?? null) : null, channelId: guildId ? call!.id : null, channelName: guildId ? call!.name : null };
      await sdk.storage.set(KEYS.server, { ...game });
    }
    emit();
    if (connected()) await loadBrowse();
  }

  /** The player chose a server for this game from the servers they are on. */
  async function setGameServer(guildId: string): Promise<void> {
    const known = servers.find((server) => server.id === guildId);
    if (!known) throw new PanelError("serverUnknown");
    game = { guildId, serverName: known.name, channelId: null, channelName: null };
    await sdk.storage.set(KEYS.server, { ...game });
    emit();
    if (connected()) await loadBrowse();
  }

  /** Reads the server list and the browsed server again now. */
  async function reload(): Promise<void> {
    if (!connected()) return;
    await loadServers();
    await loadBrowse();
  }

  // ── The voice overlay's settings (from clicks) ───────────────────────

  /** Names on the overlay, on or off. */
  async function setOverlayNames(on: boolean): Promise<void> {
    overlayNames = on;
    overlay.value = { ...overlay.value, names: on };
    await sdk.storage.app.set(KEYS.names, on);
    schedulePublish();
  }

  /**
   * Over game: puts the voice overlay over the game, or takes it away. "off" means Game overlays are off in Tavora
   * (which then opens that setting), "full" that the game has no room for another.
   */
  async function setOverGame(on: boolean): Promise<GameOverlayResult | "removed"> {
    if (!on) {
      await sdk.overlay.hideOverGame(OVERLAY_KEY);
      await refreshOverGame();
      return "removed";
    }
    const result = await sdk.overlay.showOverGame(OVERLAY_KEY);
    await refreshOverGame();
    // The overlay shows what is going on from the start, before the next change.
    if (result === "shown") schedulePublish(true);
    return result;
  }

  /** Preview: a small Tavora window with the overlay. */
  async function previewOverlay(): Promise<void> {
    // Not in a voice channel: a short sample, so there is something to see.
    if (!(connected() && call)) {
      sampleActive = true;
      if (sampleTimer) clearTimer(sampleTimer);
      sampleTimer = setTimer(() => {
        sampleTimer = undefined;
        sampleActive = false;
        schedulePublish();
      }, SAMPLE_MS);
    }
    schedulePublish(true);
    await sdk.overlay.preview(OVERLAY_KEY);
  }

  /** Copy OBS link: "off" when Stream overlays are off in Tavora, "denied" when the player didn't allow it. */
  async function copyOverlayLink(): Promise<OverlayLinkResult> {
    try {
      const result = await sdk.overlay.copyLink(OVERLAY_KEY);
      if (result === "copied") schedulePublish(true);
      return result;
    } catch (reason) {
      if (reason instanceof TavoraError && reason.code === "PERMISSION_DENIED") return "denied";
      throw reason;
    }
  }

  return { view, overlay, start, stop, connect, allowControl, join, leave, setVoice, setUserVoice, rememberGame, setGameServer, reload, setOverlayNames, setOverGame, previewOverlay, copyOverlayLink };
}
