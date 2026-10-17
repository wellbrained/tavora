// Wire protocol v1 between a module and the Tavora host, carried over a
// MessagePort. Specified in apps/docs/reference/protocol.md.
//
// Identity (which module, which game, which panel) is never part of a
// message. The host binds it to the port when it creates the channel.

/** Major protocol version. Every message carries it as `v`. */
export const PROTOCOL_VERSION = 1;

/** Posted by the SDK on its own window to ask the host for a bridge port. */
export const HELLO_MESSAGE = "tavora:hello";
/** Posted by the host preload on the module window, carrying the port. */
export const PORT_MESSAGE = "tavora:port";

export interface TavoraGame {
  id: string;
  displayName: string;
}

export interface TavoraViewport {
  width: number;
  height: number;
}

export interface TavoraTheme {
  mode: "dark" | "light";
  /** A short summary of the palette, for modules that only need a few colours. */
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
  };
  /**
   * The full semantic palette as CSS colours, named like the CSS variables
   * of shadcn-vue plus Tavora's extras (see THEME_TOKENS). Set each one as
   * `--<name>` to match the host UI.
   */
  tokens: Record<ThemeToken, string>;
  /** Corner radius for buttons, inputs and cards, in CSS pixels. */
  radius: number;
}

/** Names of the semantic colour tokens in TavoraTheme.tokens. */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-hover",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "rail",
  "success",
  "warning",
  "info",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface HandshakeResult {
  protocol: typeof PROTOCOL_VERSION;
  host: { name: "tavora-desktop"; version: string };
  module: { id: string; version: string };
  /** Capabilities this module has been granted. */
  capabilities: Capability[];
  /**
   * The panel this page runs in: its panel type, one of the manifest's `panels` ids, or null for a module
   * without panel types. Tavora 0.17.12 and newer send it.
   */
  panel?: { type: string | null };
}

export interface DocumentSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  bytes: number;
}

export interface TavoraDocument extends DocumentSummary {
  data: JsonValue;
}

export interface PutDocumentParams {
  /** Omit to create a new document with a host-generated id. */
  id?: string;
  title: string;
  data: JsonValue;
  /** Reject with CONFLICT unless the stored revision still matches. */
  ifRevision?: number;
}

/**
 * A web request the host makes for the module (network.fetch). Only to a host the module names in
 * `permissions.network` and the player granted, only over HTTPS; the host sends no cookies and
 * follows redirects only to granted hosts.
 */
export interface NetworkRequest {
  url: string;
  /** Default GET. */
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Cookie, Host, Origin, Referer, Proxy-*, Sec-* and the transfer headers are set by the host and refused here. */
  headers?: Record<string, string>;
  /** Text only; send binary data as base64 or JSON. */
  body?: string;
  /** "base64" for pictures and other binary answers. Default "text" (read as UTF-8). */
  responseType?: "text" | "base64";
}

export interface NetworkResponse {
  status: number;
  /** The address that answered, after any redirects. */
  url: string;
  /** Lowercase names; Set-Cookie is left out. */
  headers: Record<string, string>;
  /** The answer as text, or base64 when the request asked for it. */
  body: string;
}

/** An AI account the player set up in Settings > Integrations > AI usage, as the ai-usage connector shows it. */
export interface AiUsageAccountInfo {
  /** Chosen by Tavora; stays the same while the account exists. */
  id: string;
  provider: "claude" | "codex";
  /** The player's name for it. */
  label: string;
  /** The subscription plan from the profile's saved login, from a fixed list of names (Pro, Max 5×, Plus, ...), or null. */
  plan: string | null;
}

/**
 * One reading of an account's usage through the ai-usage connector. Tavora reads the login itself
 * and hands over only the provider's answer, never the token. An account is read at most once a
 * minute (LIMITS.aiUsageMinReadMs); asking sooner gives the last reading again.
 */
export interface AiUsageReading {
  /**
   * ok: `answer` holds the provider's answer. sign-in: the profile has no usable subscription login.
   * rate-limited: the provider asked to wait (`retryAfterMs`). api-key: the login is an API key,
   * which has no subscription allowance. cli-missing: the Codex command line is not installed.
   * unavailable: anything else.
   */
  status: "ok" | "sign-in" | "rate-limited" | "api-key" | "cli-missing" | "unavailable";
  /** For rate-limited: how long to wait at least, in milliseconds; otherwise null. */
  retryAfterMs: number | null;
  /**
   * The provider's answer as it came, for status ok: Claude's usage answer (undocumented, may change)
   * or the Codex app-server's `account/rateLimits/read` result. Null otherwise.
   */
  answer: JsonValue | null;
  /** The signed-in email the provider reports, or null. */
  email: string | null;
  plan: string | null;
  /** When Tavora took this reading (ISO 8601). */
  readAt: string;
}

/**
 * The discord connector's connection to the Discord app on this PC, with Tavora's Discord sign-in.
 * The connection runs while a panel of a module granted the connector has asked for it.
 */
export interface DiscordState {
  /**
   * connecting: looking for the Discord app and signing in. not-running: no Discord app was found;
   * Tavora keeps looking. signed-out: Tavora was never approved in Discord, or the player signed out;
   * connect() asks. approving: Discord shows its approval pop-up. connected: commands and events work.
   * error: the last sign-in failed (see `error`); connect() tries again.
   */
  status: "connecting" | "not-running" | "signed-out" | "approving" | "connected" | "error";
  /**
   * For error: not-approved (the player declined in Discord), no-code (Discord gave no sign-in code),
   * offline (discord.com could not be reached), no-sign-in (discord.com refused the sign-in), failed.
   */
  error: "not-approved" | "no-code" | "offline" | "no-sign-in" | "failed" | null;
  /** Who Tavora is signed in to Discord as, once connected. Names come from Discord; show them as text only. */
  user: { id: string; name: string } | null;
  /** The sign-in may mute and deafen the player (SET_VOICE_SETTINGS). Sign-ins made before Tavora 0.5.11 can't until allowControl(). */
  canControl: boolean;
  /** False where this PC can't keep the sign-in safely, so it lasts only until Tavora closes. */
  canSaveSignIn: boolean;
}

/**
 * The Discord RPC commands a module may send through the discord connector, and their arguments.
 * Tavora checks every argument and sends exactly these fields; Discord's answer comes back as it came.
 */
export interface DiscordCommands {
  /** The voice channel the player is in, with its `voice_states`, or null. */
  GET_SELECTED_VOICE_CHANNEL: Record<string, never>;
  /** The servers the player is on. */
  GET_GUILDS: Record<string, never>;
  GET_GUILD: { guild_id: string };
  /** A server's channels (ids, names and types; voice channels are type 2, stage channels 13). */
  GET_CHANNELS: { guild_id: string };
  /** One channel, with who is in it when it is a voice channel. */
  GET_CHANNEL: { channel_id: string };
  /** Joins a voice channel (an id) or leaves (null). Only right after a click or key press in the panel, one per click. */
  SELECT_VOICE_CHANNEL: { channel_id: string | null };
  /** Mutes or deafens the player. Needs DiscordState.canControl. */
  SET_VOICE_SETTINGS: { mute?: boolean; deaf?: boolean };
  /** How loud someone is for the player (0 to 200) and/or muted for the player only: Discord's own per-person settings. */
  SET_USER_VOICE_SETTINGS: { user_id: string; volume?: number; mute?: boolean };
}

export type DiscordCommand = keyof DiscordCommands;
export const DISCORD_COMMANDS = [
  "GET_SELECTED_VOICE_CHANNEL",
  "GET_GUILDS",
  "GET_GUILD",
  "GET_CHANNELS",
  "GET_CHANNEL",
  "SELECT_VOICE_CHANNEL",
  "SET_VOICE_SETTINGS",
  "SET_USER_VOICE_SETTINGS",
] as const satisfies readonly DiscordCommand[];

/**
 * Discord's answer to a command. not-connected: the connection is not `connected` right now.
 * refused: Discord answered with an error (`code` and `message` are Discord's). no-answer: Discord
 * did not answer in time, the connection ended, or the answer was too large (LIMITS.maxDiscordAnswerBytes).
 */
export type DiscordResult =
  | { ok: true; data: JsonValue }
  | { ok: false; reason: "not-connected" | "refused" | "no-answer"; code: number | null; message: string | null };

/**
 * Discord RPC events a module may subscribe to. VOICE_CHANNEL_SELECT (the player joined, moved or left)
 * takes no channel; the others are for one voice channel and need its id.
 */
export const DISCORD_EVENTS = ["VOICE_CHANNEL_SELECT", "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP"] as const;
export type DiscordEventName = (typeof DISCORD_EVENTS)[number];

/** One Discord event, with its data as Discord sent it. */
export interface DiscordEvent {
  event: DiscordEventName;
  data: JsonValue;
}

export interface DocumentChange {
  id: string;
  revision: number;
  deleted: boolean;
}

/**
 * Capabilities gate methods beyond the always-available core. A module has a
 * capability once the player granted one of its permissions for it (`network`:
 * a host in `permissions.network`; `aiUsage`: the `ai-usage` connector; `discord`:
 * the `discord` connector); calling a gated method without it fails with
 * PERMISSION_DENIED. The others cannot be granted yet.
 */
export type Capability = "network" | "aiUsage" | "discord" | "files" | "clipboard" | "sharedData";

/** Request methods and their params/result types. */
export interface Methods {
  "bridge.handshake": { params: { protocol: number; sdkVersion: string }; result: HandshakeResult };
  "game.getCurrent": { params: undefined; result: TavoraGame };
  "storage.get": { params: { key: string }; result: JsonValue | null };
  "storage.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.delete": { params: { key: string }; result: null };
  "storage.keys": { params: undefined; result: string[] };
  /** The same calls for settings shared by every game: this module's own, in all games. */
  "storage.app.get": { params: { key: string }; result: JsonValue | null };
  "storage.app.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.app.delete": { params: { key: string }; result: null };
  "storage.app.keys": { params: undefined; result: string[] };
  "documents.list": { params: undefined; result: DocumentSummary[] };
  "documents.get": { params: { id: string }; result: TavoraDocument | null };
  "documents.put": { params: PutDocumentParams; result: DocumentSummary };
  "documents.delete": { params: { id: string; ifRevision?: number }; result: null };
  "panel.getState": { params: undefined; result: JsonValue | null };
  "panel.setState": { params: { value: JsonValue | null }; result: null };
  "workspace.getViewport": { params: undefined; result: TavoraViewport };
  "ui.getTheme": { params: undefined; result: TavoraTheme };
  /** The language of Tavora's own texts, as a code such as "en" or "de". */
  "ui.getLanguage": { params: undefined; result: string };
  /** Shows a menu drawn by Tavora above every panel. Only right after a click, right-click or key press in the panel. The chosen item's id, or null. */
  "ui.showMenu": { params: MenuRequest; result: string | null };
  /** Opens a web address in the game's Browser panel. Only right after a click or key press in the panel; http and https only. */
  "links.open": { params: { url: string }; result: null };
  "blobs.list": { params: undefined; result: BlobInfo[] };
  "blobs.usage": { params: undefined; result: BlobUsage };
  "blobs.delete": { params: { id: string }; result: null };
  /** A web request to a granted host (capability `network`). */
  "network.fetch": { params: NetworkRequest; result: NetworkResponse };
  /** The AI accounts the player set up, in their order (capability `aiUsage`). */
  "aiUsage.accounts": { params: undefined; result: AiUsageAccountInfo[] };
  /** Reads one account's usage (capability `aiUsage`). */
  "aiUsage.read": { params: { accountId: string }; result: AiUsageReading };
  /** The connection to the Discord app; starts it for this panel (capability `discord`). */
  "discord.state": { params: undefined; result: DiscordState };
  /** Signs in, asking for approval in Discord when needed. Only right after a click or key press (capability `discord`). */
  "discord.connect": { params: undefined; result: null };
  /** Asks Discord to approve muting and deafening for an older sign-in. Only right after a click or key press (capability `discord`). */
  "discord.allowControl": { params: undefined; result: null };
  /** One Discord RPC command from DISCORD_COMMANDS (capability `discord`). */
  "discord.command": { params: { command: DiscordCommand; args: DiscordCommands[DiscordCommand] }; result: DiscordResult };
  /** Starts sending one Discord event to this panel; kept across reconnects until unsubscribed (capability `discord`). */
  "discord.subscribe": { params: { event: DiscordEventName; channelId?: string }; result: null };
  "discord.unsubscribe": { params: { event: DiscordEventName; channelId?: string }; result: null };
  /** A picture from Discord's image server (someone's avatar, a server icon) as a small PNG data address, or null (capability `discord`). */
  "discord.image": { params: { url: string }; result: string | null };
}

export type MethodName = keyof Methods;

/** Methods reserved for later milestones, and the capability each needs. */
export const RESERVED_METHODS: Readonly<Record<string, Capability>> = {
  "files.open": "files",
  "files.save": "files",
  "clipboard.writeText": "clipboard",
  "clipboard.readText": "clipboard",
  "sharedData.publish": "sharedData",
  "sharedData.read": "sharedData",
  "sharedData.subscribe": "sharedData",
};

/** Events the host pushes to the module. */
export interface Events {
  "workspace.resize": TavoraViewport;
  "ui.theme": TavoraTheme;
  "ui.language": string;
  "documents.changed": DocumentChange;
  /** The player added, renamed or removed an AI account; ask aiUsage.accounts again. Only with capability `aiUsage`. */
  "aiUsage.accountsChanged": null;
  /** The connection to the Discord app changed. Only with capability `discord`, after discord.state. */
  "discord.state": DiscordState;
  /** A Discord event this panel subscribed to. Only with capability `discord`. */
  "discord.event": DiscordEvent;
  "lifecycle.suspend": null;
  "lifecycle.resume": null;
  "lifecycle.dispose": null;
}

export type EventName = keyof Events;

export type ErrorCode =
  /** Malformed message, wrong protocol version or over a limit. */
  | "BAD_REQUEST"
  /** The method is not part of the protocol. */
  | "UNKNOWN_METHOD"
  /** Params are missing or have the wrong shape. */
  | "INVALID_PARAMS"
  /** The method exists but this module has not been granted its capability. */
  | "PERMISSION_DENIED"
  /** A storage, document or panel-state limit would be exceeded, or a network answer was too large. */
  | "QUOTA_EXCEEDED"
  /** network.fetch got no answer: the host could not be found or reached, the connection failed or it took too long. An answer with an error status (404, 500) is not this; it is returned. */
  | "NETWORK_ERROR"
  /** `ifRevision` did not match the stored revision. */
  | "CONFLICT"
  /** The SDK and host speak different protocol versions. */
  | "INCOMPATIBLE"
  /** Something failed inside the host. Details are logged there, not sent. */
  | "INTERNAL"
  // Raised by the SDK itself, never sent by the host:
  /** The host did not answer in time. */
  | "TIMEOUT"
  /** connect() found no Tavora host, e.g. the page was opened in a normal browser. */
  | "HOST_UNAVAILABLE";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Present for PERMISSION_DENIED. */
  capability?: Capability;
  /** Present for CONFLICT. */
  revision?: number;
  /** Present for INCOMPATIBLE and BAD_REQUEST version errors. */
  supported?: number[];
}

export interface RequestMessage {
  v: typeof PROTOCOL_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

export type ResponseMessage =
  | { v: typeof PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | { v: typeof PROTOCOL_VERSION; id: number; ok: false; error: ErrorPayload };

export interface EventMessage {
  v: typeof PROTOCOL_VERSION;
  event: EventName;
  data: unknown;
}

export type HostMessage = ResponseMessage | EventMessage;

export const LIMITS = {
  /** Largest serialized request the host accepts. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Requests a module may have waiting at once. */
  maxInFlight: 64,
  maxKeyLength: 256,
  /** Settings storage per module and game. */
  maxStoreBytes: 5 * 1024 * 1024,
  /** One document's data. */
  maxDocumentBytes: 4 * 1024 * 1024,
  /** All documents of one module in one game. */
  maxDocumentsBytes: 50 * 1024 * 1024,
  maxDocuments: 1000,
  maxTitleLength: 200,
  /** UI state for one panel. */
  maxPanelStateBytes: 256 * 1024,
  /** One stored file (see Blobs). */
  maxBlobBytes: 50 * 1024 * 1024,
  /** All stored files of one module in one game. */
  maxBlobsBytes: 500 * 1024 * 1024,
  /** A PNG a module puts on the clipboard. */
  maxClipboardImageBytes: 20 * 1024 * 1024,
  /** The body of one network.fetch answer, before any base64. A longer answer fails with QUOTA_EXCEEDED. */
  maxNetworkResponseBytes: 5 * 1024 * 1024,
  /** How long one network.fetch may take, redirects included. */
  networkTimeoutMs: 15_000,
  /** Redirects one network.fetch follows; each must go to a granted host. */
  maxNetworkRedirects: 5,
  /** network.fetch calls one panel may have running at once; more fail with BAD_REQUEST. */
  maxNetworkInFlight: 6,
  /** How often Tavora reads one AI account at most, for every module together; asking sooner gives the last reading. */
  aiUsageMinReadMs: 60_000,
  /** How long one aiUsage.read may take; the Codex command line can be slow to start. */
  aiUsageTimeoutMs: 40_000,
  /** How long one discord.command may take; a slower answer is `no-answer`. */
  discordTimeoutMs: 15_000,
  /** Largest Discord answer or event passed on, as JSON; a larger one is `no-answer` (or dropped, for an event). */
  maxDiscordAnswerBytes: 512 * 1024,
  /** Discord events one panel may subscribe to at once. */
  maxDiscordSubscriptions: 32,
  /** Entries in one menu, submenus included. */
  maxMenuEntries: 100,
  /** Characters of a menu label or heading. */
  maxMenuLabel: 80,
  /** Characters of the hint on the right of a menu item, such as a shortcut. */
  maxMenuHint: 30,
} as const;

/**
 * One entry of a menu drawn by Tavora (ui.showMenu). Text only; Tavora draws it in the current theme.
 * An item list where any item sets `checked` keeps a column for the mark, so labels line up.
 */
export type MenuEntry =
  | {
      type: "item";
      /** Returned when the player picks it; unique within the menu, at most 64 characters. */
      id: string;
      label: string;
      /** Small grey text on the right, such as a shortcut ("Ctrl+D"). */
      hint?: string;
      /** A colour dot before the label, as a CSS colour: `#rgb`, `#rrggbb`, `rgb()`, `hsl()`, `oklch()` and the like, or `transparent` for an empty ring. */
      color?: string;
      /** Shows a check mark (or a dot, with `radio`) when true, and keeps the mark's column when false. */
      checked?: boolean;
      /** The mark is a dot: one choice of several. */
      radio?: boolean;
      disabled?: boolean;
      /** Red, for something that deletes or cannot be undone. */
      danger?: boolean;
    }
  | { type: "separator" }
  | { type: "heading"; label: string }
  | {
      type: "submenu";
      label: string;
      color?: string;
      disabled?: boolean;
      /** Items, separators and headings; a submenu holds no further submenus. */
      items: MenuEntry[];
    };

/** What ui.showMenu shows, and where. */
export interface MenuRequest {
  items: MenuEntry[];
  /**
   * Where, in the panel's CSS pixels from its top left corner: a point for a context menu (the pointer's
   * position), or a rectangle (a button) the menu opens next to. Tavora keeps the menu inside the window.
   */
  at: { x: number; y: number; width?: number; height?: number };
  /** Which side of `at` the menu opens on, when there is room. Default "bottom". */
  side?: "bottom" | "top" | "right" | "left";
  /** How the menu lines up with `at` along that side. Default "start". */
  align?: "start" | "center" | "end";
}

/** The kinds of file a module can keep with blobs.put, found by looking at the file itself. */
export const BLOB_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type BlobType = (typeof BLOB_TYPES)[number];

/** A stored file. */
export interface BlobInfo {
  /** 32 lowercase hex characters, chosen by the host. */
  id: string;
  bytes: number;
  type: BlobType;
  createdAt: string;
}

/** How much of the limits a module's files in the current game use. */
export interface BlobUsage {
  bytes: number;
  count: number;
  /** All files together. */
  maxBytes: number;
  /** One file. */
  maxFileBytes: number;
}

/**
 * Files are sent to and shown from the module's own address, not over the
 * bridge: POST /_blobs/ stores the request body and answers with a BlobInfo,
 * GET /_blobs/<id> serves a file. Both only work from the module's own page.
 */
export const BLOB_PATH = "/_blobs/";
export const BLOB_ID = /^[a-f0-9]{32}$/;

/** POST a PNG here, from the module's own page, to put it on the clipboard (see clipboard.writeImage). */
export const CLIPBOARD_PATH = "/_clipboard/";

/** Document ids: host-generated UUIDs or module-chosen slugs. */
export const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
