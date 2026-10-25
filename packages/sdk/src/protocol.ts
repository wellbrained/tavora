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
  /**
   * A game, or a personal workspace the player made for modules that belong to no game, such as notes.
   * Tavora older than 0.18.1 leaves it out, which means a game.
   */
  kind?: "game" | "workspace";
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

/**
 * What a panel shows, as the module names it: a build, a character, a run, a document. Tavora keeps it
 * with the panel and shows the title when the player hovers the panel's tab.
 */
export interface PanelContent {
  /** The module's own id for it, at most 200 characters. */
  id: string;
  /** Its full name, at most 200 characters on one line. */
  title: string;
}

/**
 * Why this page of the panel is loading.
 * - `add`: the player just added the panel. Pick the content yourself, such as the last one used, or show a picker.
 * - `restore`: the panel was open before (a restart, a game switch back, a reload). `content` is what it last
 *   showed through `panel.setContent`, or null.
 * - `open`: another panel of this module opened it with `panels.open`. Show `content`, or pick yourself when it is null.
 */
export type PanelLaunch =
  | { reason: "add" }
  | { reason: "restore"; content: PanelContent | null }
  | { reason: "open"; content: PanelContent | null };

/**
 * What `panels.open` did.
 * - `shown`: a panel of that type already showed the content (or none was asked for), and Tavora brought it to the front.
 * - `switched`: an open panel of that type switched to the content (its `panel.onNavigate` handler succeeded).
 * - `opened`: Tavora opened a new panel of that type.
 * - `failed`: the panel that should switch could not save or did not answer in time. It keeps what it showed, and
 *   Tavora offers the player to open the content in a new panel.
 */
export type PanelOpenResult = "shown" | "switched" | "opened" | "failed";

/** Tavora asks this panel to show other content (the `panel.navigate` event); answer with `panel.navigated`. */
export interface PanelNavigateRequest {
  requestId: number;
  content: PanelContent;
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

/** A public page rendered in a new, hidden, isolated browser session. */
export interface PageResponse { url: string; status: number; title: string; html: string }

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
 * the `discord` connector; `overlay`: the `stream-overlay` connector); calling a gated method without it fails
 * with PERMISSION_DENIED. The others cannot be granted yet.
 */
export type Capability = "network" | "aiUsage" | "discord" | "overlay" | "files" | "clipboard" | "sharedData";

/**
 * What overlay.copyLink did. `copied`: the link is on the clipboard, ready to paste into OBS as a Browser Source.
 * `off`: Stream overlays are off in Tavora; Tavora opened the setting so the player can turn them on. `denied`: the
 * module asks for the connector on request (permissions.onRequest) and the player said no in Tavora's dialog.
 */
export type OverlayLinkResult = "copied" | "off" | "denied";

/**
 * What overlay.showOverGame did. `shown`: the overlay is over the game now (or already was). `off`: Game overlays are
 * off in Tavora; Tavora opened the setting so the player can turn them on. `full`: this game already has the most game
 * overlays it may have (LIMITS.maxGameOverlays); the player can remove one in Settings > Overlays.
 */
export type GameOverlayResult = "shown" | "off" | "full";

/** A hotkey the player set for this module in the current game: which action, for what. Never the key itself. */
export interface HotkeyBinding {
  /** One of the manifest's `actions` ids. */
  action: string;
  /** The module's own id for what the action works on, such as an item id. */
  target: string;
}

/** What the player did in Tavora's hotkey dialog (hotkeys.set): set a key, removed the one set, or closed it. */
export type HotkeySetResult = "set" | "removed" | "cancelled";

/** Request methods and their params/result types. */
export interface ReadOnlyFile { id: string; name: string; size: number }
export const READ_ONLY_FILE_PATH = '/_read-only-files/';
export interface Methods {
  "files.pickReadOnly": { params: { extensions: string[] }; result: ReadOnlyFile | null };
  "files.forget": { params: { id: string }; result: null };
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
  /** Why this page is loading; the same answer for every call until the page loads again. Tavora 0.17.17 and newer. */
  "panel.getLaunch": { params: undefined; result: PanelLaunch };
  /** What the panel shows now, or null for nothing. Tavora 0.17.17 and newer. */
  "panel.setContent": { params: { content: PanelContent | null }; result: null };
  /**
   * The answer to a `panel.navigate` event: `handled` is false when the page takes no navigation (no handler), `ok`
   * whether it now shows the content. Tavora 0.17.18 and newer.
   */
  "panel.navigated": { params: { requestId: number; handled: boolean; ok: boolean }; result: null };
  /** Whether the panel fills the workspace now (Maximize). Tavora 0.20.20 and newer. */
  "panel.isMaximized": { params: undefined; result: boolean };
  /**
   * Makes the panel fill the workspace (true), as Maximize in its menu does, or puts it back (false). Filling it
   * only right after a click or key press in the panel. Tavora 0.20.20 and newer.
   */
  "panel.setMaximized": { params: { maximized: boolean }; result: null };
  /**
   * Opens one of this module's own panel types in the current game, optionally on some content. Only right after a
   * click or key press in the panel, once per click. Tavora 0.17.18 and newer.
   */
  "panels.open": { params: { type: string; content?: PanelContent }; result: PanelOpenResult };
  "workspace.getViewport": { params: undefined; result: TavoraViewport };
  "ui.getTheme": { params: undefined; result: TavoraTheme };
  /** The language of Tavora's own texts, as a code such as "en" or "de". */
  "ui.getLanguage": { params: undefined; result: string };
  /** Shows a menu drawn by Tavora above every panel. Only right after a click, right-click or key press in the panel. The chosen item's id, or null. */
  "ui.showMenu": { params: MenuRequest; result: string | null };
  "ui.tooltip.show": { params: TooltipRequest; result: boolean };
  "ui.tooltip.move": { params: TooltipAnchor; result: null };
  "ui.tooltip.hide": { params: { id: string }; result: null };
  "ui.tooltip.close": { params: { id: string }; result: null };
  /** Opens a web address in the game's Browser panel. Only right after a click or key press in the panel; http and https only. */
  "links.open": { params: { url: string }; result: null };
  "blobs.list": { params: undefined; result: BlobInfo[] };
  "blobs.usage": { params: undefined; result: BlobUsage };
  "blobs.delete": { params: { id: string }; result: null };
  /** A web request to a granted host (capability `network`). */
  "network.fetch": { params: NetworkRequest; result: NetworkResponse };
  "network.readPage": { params: { url: string }; result: PageResponse };
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
  /**
   * What the overlay page for `key` shows now (capability `overlay`): any JSON, at most LIMITS.maxOverlayStateBytes.
   * Tavora keeps it, so the overlay shows it while no panel runs. Tavora 0.19.26 and newer.
   */
  "overlay.publish": { params: { key: string; state: JsonValue }; result: null };
  /** The overlay for `key` shows nothing until it is published again; its link stays the same (capability `overlay`). */
  "overlay.remove": { params: { key: string }; result: null };
  /**
   * Puts the link of the overlay for `key` on the clipboard. Only right after a click or key press (capability `overlay`;
   * a module that asks for it on request gets Tavora's consent dialog first).
   */
  "overlay.copyLink": { params: { key: string }; result: OverlayLinkResult };
  /** Gives the overlay for `key` a new link; the old one stops working (capability `overlay`). */
  "overlay.resetLink": { params: { key: string }; result: null };
  /**
   * Shows the overlay page for `key` over the player's game, in a Tavora window above it. Only right after a click or
   * key press in the panel; needs no capability. Tavora 0.20.44 and newer.
   */
  "overlay.showOverGame": { params: { key: string }; result: GameOverlayResult };
  /** The hotkeys the player set for this module in the current game. Tavora 0.19.26 and newer. */
  "hotkeys.list": { params: undefined; result: HotkeyBinding[] };
  /**
   * Opens Tavora's dialog to set the key for one of the manifest's `actions` on `target`; `label` names the target
   * there, such as an item's name. Only right after a click or key press.
   */
  "hotkeys.set": { params: { action: string; target: string; label: string }; result: HotkeySetResult };
  /** Removes the hotkeys for `target`: all of them, or only the one for `action`. */
  "hotkeys.remove": { params: { target: string; action?: string }; result: null };
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
  "ui.tooltipClosed": { id: string };
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
  /** Another panel of this module asked this one to show other content; answer with `panel.navigated` within navigateTimeoutMs. */
  "panel.navigate": PanelNavigateRequest;
  /** The panel started or stopped filling the workspace (Maximize and Restore, by the player or panel.setMaximized). */
  "panel.maximized": { maximized: boolean };
  /** The player pressed a hotkey set for this module (hotkeys.set). Sent to one panel of the module in the game shown now, the one used last. */
  "hotkeys.pressed": HotkeyBinding;
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
  /** A network request failed, timed out or was cancelled. readPage also refuses login/verification pages; fetch returns HTTP error statuses as answers. */
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
  /** A panel content's id (panel.setContent); its title has maxTitleLength. */
  maxContentIdLength: 200,
  /** How long a panel has to save and switch after a panel.navigate event before Tavora counts it as failed. */
  navigateTimeoutMs: 5_000,
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
  /** Deadline for an isolated page import, including cleanup. */
  pageTimeoutMs: 30_000,
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
  /** What one overlay shows (overlay.publish), as JSON. */
  maxOverlayStateBytes: 16 * 1024,
  /** Overlays one module may have in one game; publishing more fails with QUOTA_EXCEEDED. */
  maxOverlays: 200,
  /** Game overlays (overlay.showOverGame) one game may have at once. */
  maxGameOverlays: 8,
  /** Hotkeys one module may have in one game. */
  maxHotkeys: 100,
  /** Characters of the label hotkeys.set shows for its target. */
  maxHotkeyLabel: 60,
} as const;

/** Overlay keys and hotkey targets: the module's own ids, like document ids. */
export const OVERLAY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * An overlay page reads what the module published from this address next to it, as server-sent events: each
 * message is `{ "state": <JSON or null> }`, the first one straight away (see watchOverlay).
 */
export const OVERLAY_STATE_PATH = "_state";

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

export type { TooltipContent, TooltipAnchor, TooltipRequest } from "./tooltip-types.js";
import type { TooltipRequest, TooltipAnchor } from "./tooltip-types.js";

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

/**
 * POST a PNG here, from the module's own page, to save it as a file where the player picks in Tavora's save dialog
 * (see pictures.save). `?name=` suggests the file name; the answer is `{ fileName }`, the name it was saved under,
 * or `{ fileName: null }` when the player closed the dialog.
 */
export const PICTURES_PATH = "/_pictures/";

/** Document ids: host-generated UUIDs or module-chosen slugs. */
export const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * POST a JSON document here, from the module's own page, to save it as a file where the player picks in Tavora's save
 * dialog (see files.saveJson). `?name=` suggests the file name; the answer is `{ fileName }`, or `{ fileName: null }`
 * when the player closed the dialog.
 */
export const JSON_SAVE_PATH = "/_files/json/save/";

/**
 * POST here, from the module's own page, to open a JSON file the player picks in Tavora's open dialog (see
 * files.openJson). The answer is `{ fileName, value }`, or `null` when the player closed the dialog.
 */
export const JSON_OPEN_PATH = "/_files/json/open/";

/** POST a bounded JSON document after a gesture; saves a new .json in Downloads/Tavora. */
export const JSON_EXPORT_PATH = "/_exports/json/";
