import {
  LIMITS,
  OVERLAY_KEY,
  PROTOCOL_VERSION,
  RESERVED_METHODS,
  type Capability,
  type DocumentChange,
  type EventName,
  type Events,
  type AiUsageAccountInfo,
  type AiUsageReading,
  type DiscordCommand,
  type DiscordEventName,
  type DiscordResult,
  type DiscordState,
  type HandshakeResult,
  type HotkeyBinding,
  type HotkeySetResult,
  type JsonValue,
  type LeaderboardStatus,
  type LeaderboardSubmitResult,
  type LeaderboardMine,
  type LeaderboardTop,
  type NetworkResponse,
  type GameOverlayResult,
  type OverlayLinkResult,
  type SystemConnectionLog,
  type SystemConnectionSettings,
  type SystemApps,
  type SystemTraffic,
  type SystemInfo,
  type MediaAction,
  type MediaState,
  type PageResponse,
  type PanelContent,
  type PanelLaunch,
  type PanelOpenManyResult,
  type PanelOpenResult,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
  type TavoraWorkspace,
} from "@tavora/sdk/protocol";
import { isActionId, isPanelTypeId, MAX_PANEL_TYPES } from "@tavora/module-schema";
import { HostError } from "./errors";
import { serializeJson } from "./json";
import { discordCommand, discordSubscription } from "./discord-commands";
import { checkMenu, type CheckedMenu } from "./module-menu";
import {checkTooltip,checkTooltipAnchor,tooltipId} from "./tooltip-content";
import type {TooltipRequest,TooltipAnchor} from "@tavora/sdk/protocol";
import { checkPanelContent } from "./panel-content";
import { parseConnectionSettings, parseWatch, type ConnectionSettingsChange, type WatchRequest } from "./system-info-parse";
import { parseControlParams, parseWatchParams } from "./media-parse";
import type { ModuleData, ModuleStore, PanelStateStore } from "./storage";

/** The parts of Electron's MessagePortMain the bridge uses. */
export interface BridgePort {
  on(event: "message", listener: (event: { data: unknown; ports: { close(): void }[] }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

/** How big a module would like its dialog (panel.setDialog), in CSS pixels; Tavora makes it fit the window. */
export interface PanelDialogSize {
  width: number;
  height: number;
}

/** panel.setDialog's size range and default. */
export const PANEL_DIALOG = { min: 240, max: 2000, width: 560, height: 640 } as const;

/**
 * Everything a module may learn about itself. Built by the host from the
 * view that owns the port, never from anything the module sends.
 */
export interface BridgeContext {
  readOnlyFiles?: {
    pick(extensions: string[], multiple: boolean): Promise<import('@tavora/sdk/protocol').ReadOnlyFile[]>;
    forget(id:string):Promise<void>;
    check(id:string):Promise<import('@tavora/sdk/protocol').ReadOnlyFileState>;
    showInFolder(id:string):Promise<void>;
  };
  hostVersion: string;
  moduleId: string;
  moduleVersion: string;
  instanceId: string;
  /** The panel type this panel shows (one of the manifest's `panels` ids), or null for a module without types. */
  panelType: string | null;
  /** Why this page is loading (panel.getLaunch); the same for the whole page load. */
  launch: PanelLaunch;
  /** panel.setContent, with the content already checked: Tavora keeps it with the panel and shows its title on the tab. */
  setContent(content: PanelContent | null): void;
  /**
   * panels.open with a checked panel type id and content: opens or switches one of this module's own panels in the
   * current workspace. Throws PERMISSION_DENIED unless the panel just got a click or key press, INVALID_PARAMS for a type
   * the module does not have.
   */
  openPanel(type: string, content: PanelContent | null): Promise<PanelOpenResult>;
  /**
   * panels.openMany with checked, distinct panel type ids: opens several of this module's own panels from one press, in the
   * current workspace. Throws PERMISSION_DENIED unless the panel just got a click or key press, INVALID_PARAMS for a type
   * the module does not have.
   */
  openPanels(types: string[]): Promise<Record<string, PanelOpenManyResult>>;
  /** The page's answer to a panel.navigate event. */
  navigated(requestId: number, handled: boolean, ok: boolean): void;
  /** Whether the panel fills the workspace now (Maximize). */
  isMaximized(): boolean;
  /** panel.setMaximized: true throws PERMISSION_DENIED unless the panel just got a click or key press. */
  setMaximized(maximized: boolean): Promise<void>;
  /** panel.setDialog: opening throws PERMISSION_DENIED unless the panel just got a click or key press. */
  setDialog(open: boolean, size: PanelDialogSize): Promise<void>;
  /** panel.setLive: what the panel's live view shows over the game (already size-checked); null shows nothing. Needs no click. */
  setLive(state: JsonValue | null): void;
  /** The workspace the panel is in. */
  workspace: TavoraWorkspace;
  data: ModuleData;
  /** The module's settings shared by every workspace (storage.app). */
  appSettings: ModuleStore;
  /** The ai-usage connector (ai-usage.ts); only reached with the `aiUsage` capability. */
  aiUsage: { accounts(): Promise<AiUsageAccountInfo[]>; read(accountId: string): Promise<AiUsageReading> };
  /**
   * The system-info connector (system-info.ts) for this panel; only reached with the `systemInfo` capability. `watch`
   * gets the request already checked (system-info-parse.ts); it replaces what this panel watched before. `apps` and
   * `traffic` refuse every module but Tavora's own System Monitor.
   */
  systemInfo: {
    info(): SystemInfo | Promise<SystemInfo>;
    watch(request: WatchRequest): void;
    /** The connection watcher's log, settings and the change of settings (connection.ts); the change comes already checked. */
    connectionLog(): SystemConnectionLog;
    connectionSettings(): SystemConnectionSettings;
    /** These two change something for the whole PC: only for the official System Monitor, and right after a click or key press. */
    clearConnectionLog(): void | Promise<void>;
    setConnectionSettings(change: ConnectionSettingsChange): SystemConnectionSettings | Promise<SystemConnectionSettings>;
    apps(): Promise<SystemApps>;
    traffic(): Promise<SystemTraffic>;
  };
  /**
   * The media connector (media.ts) for this panel; only reached with the `media` capability. `watch(false)` answers
   * null. `control` throws PERMISSION_DENIED unless the panel just got a click or key press, or one of the module's
   * hotkeys was just pressed.
   */
  media: { watch(on: boolean): MediaState | null; control(session: string, action: MediaAction): Promise<boolean> };
  /**
   * The discord connector (discord.ts) for this panel; only reached with the `discord` capability. Commands
   * and subscriptions arrive checked (discord-commands.ts); connect, allowControl, SELECT_VOICE_CHANNEL and
   * SET_VOICE_SETTINGS throw PERMISSION_DENIED unless the panel just got a click or key press.
   */
  discord: {
    state(): Promise<DiscordState>;
    connect(): Promise<void>;
    allowControl(): Promise<void>;
    command(command: DiscordCommand, args: Record<string, unknown>): Promise<DiscordResult>;
    subscribe(event: DiscordEventName, channelId: string | null): Promise<void>;
    unsubscribe(event: DiscordEventName, channelId: string | null): Promise<void>;
    image(url: string): Promise<string | null>;
  };
  /**
   * The leaderboards connector (leaderboards.ts) for this module; only reached with the `leaderboards` capability. The
   * params of submit and top are checked there, against the manifest's boards. `show` and `hide` throw
   * PERMISSION_DENIED unless the panel just got a click or key press; `show` resolves once the user answered.
   */
  leaderboards: {
    status(): Promise<LeaderboardStatus>;
    show(): Promise<LeaderboardStatus>;
    hide(): Promise<LeaderboardStatus>;
    submit(params: unknown): Promise<LeaderboardSubmitResult>;
    top(params: unknown): Promise<LeaderboardTop>;
    mine(params: unknown): Promise<LeaderboardMine>;
  };
  panelState: PanelStateStore;
  /** What the user has granted this module right now; asked on every gated call, so a revoke takes effect at once. */
  capabilities(): ReadonlySet<Capability>;
  getViewport(): TavoraViewport;
  getTheme(): TavoraTheme;
  getLanguage(): string;
  /** Whether the panel is hidden right now. */
  isSuspended(): boolean;
  /** Opens a web address in a Browser panel. Throws a HostError when the panel did not just get a click or key press, or the address is not a web address. */
  openLink(url: string): void | Promise<void>;
  /** ui.showMenu: Tavora draws the checked menu above every panel; the chosen id, or null. Throws PERMISSION_DENIED without a click or key press first. */
  showMenu(menu: CheckedMenu): Promise<string | null>;
  tooltip: {
    show(request:TooltipRequest):Promise<boolean>;
    move(anchor:TooltipAnchor):void;
    close(id:string,hoverOnly:boolean):void;
  };
  /** Overlays of this module in this workspace (overlays.ts, game-overlays.ts); keys already checked, and the `overlay` capability for copyLink and resetLink. */
  overlay: {
    publish(key: string, state: JsonValue): void;
    remove(key: string): void;
    /** Throws PERMISSION_DENIED unless the panel just got a click or key press. */
    copyLink(key: string): Promise<OverlayLinkResult>;
    resetLink(key: string): void;
    /** Throws PERMISSION_DENIED unless the panel just got a click or key press. */
    showOverGame(key: string): Promise<GameOverlayResult>;
    /** Removes this module's game overlay for `key` in the panel's workspace scope; no error when there is none. */
    hideOverGame(key: string): void;
    /** The keys of this module's game overlays in the panel's workspace scope. */
    overGame(): string[];
    /** Throws PERMISSION_DENIED unless the panel just got a click or key press, and INVALID_PARAMS without an overlay in the manifest. */
    preview(key: string): Promise<void>;
  };
  /** Hotkeys of this module in this workspace (hotkeys.ts); actions and targets already checked. */
  hotkeys: {
    list(): HotkeyBinding[];
    /** Opens Tavora's hotkey dialog. Throws PERMISSION_DENIED unless the panel just got a click or key press. */
    set(action: string, target: string, label: string): Promise<HotkeySetResult>;
    remove(target: string, action: string | null): void;
  };
  /** network.fetch: checks the grant on every hop and makes the request (network.ts). Throws HostErrors. */
  fetch(params: unknown): Promise<NetworkResponse>;
  readPage(params: unknown): Promise<PageResponse>;
  /**
   * The module started (true) or finished (false) having requests answered; `served` counts the
   * answered ones apart from the handshake. The host uses it to tell when a page has its data.
   */
  onBusy?(busy: boolean, served: number): void;
}

type Handler = (session: BridgeSession, params: unknown) => Promise<unknown> | unknown;

function object(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new HostError("INVALID_PARAMS", "params must be an object");
  }
  return params as Record<string, unknown>;
}

function noParams(params: unknown): void {
  if (params !== undefined) throw new HostError("INVALID_PARAMS", "this method takes no params");
}

function required(params: Record<string, unknown>, name: string): unknown {
  if (!(name in params)) throw new HostError("INVALID_PARAMS", `params.${name} is required`);
  return params[name];
}

/** Refuses a gated method when the user has not granted its capability (G9), before anything else is looked at. */
function needs(s: BridgeSession, capability: Capability, method: string): void {
  if (!s.context.capabilities().has(capability)) throw new HostError("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
}

/** Longest address links.open accepts. */
const LINK_MAX = 2048;

/** An overlay key or hotkey target: the module's own id, like a document id. */
function moduleKey(params: Record<string, unknown>, name: "key" | "target"): string {
  const value = required(params, name);
  if (typeof value !== "string" || !OVERLAY_KEY.test(value)) throw new HostError("INVALID_PARAMS", `params.${name} must be 1 to 64 letters, digits, - and _`);
  return value;
}

function actionId(value: unknown): string {
  if (!isActionId(value)) throw new HostError("INVALID_PARAMS", "params.action must be one of the manifest's actions ids");
  return value;
}

/** The id of a file the module linked (files.pickReadOnly). */
function fileReference(params: unknown): string {
  const id = object(params).id;
  if (typeof id!=='string'|| !/^[a-f0-9]{32}$/.test(id)) throw new HostError('INVALID_PARAMS','Invalid file reference.');
  return id;
}

/** A workspace as game.getCurrent says it. */
function legacyGame({ id, displayName, kind }: TavoraWorkspace): TavoraGame {
  return { id, displayName, kind: kind === "personal" ? "workspace" : "game" };
}

const handlers = new Map<string, Handler>([
  ['files.pickReadOnly', async (s,params) => {
    const extensions = object(params).extensions;
    if (!Array.isArray(extensions) || !extensions.length || extensions.length>10 || extensions.some(e=>typeof e!=='string'|| !/^[a-z0-9]{1,12}$/.test(e))) throw new HostError('INVALID_PARAMS','Choose up to ten file extensions.');
    const multiple = object(params).multiple;
    if (multiple !== undefined && typeof multiple !== 'boolean') throw new HostError('INVALID_PARAMS','multiple must be true or false.');
    if (!s.context.readOnlyFiles) throw new HostError('UNKNOWN_METHOD','Update Tavora to remember files.');
    const picked = await s.context.readOnlyFiles.pick(extensions, multiple === true);
    return multiple === true ? picked : (picked[0] ?? null);
  }],
  ['files.forget', async (s,params) => {
    const id = fileReference(params);
    if (!s.context.readOnlyFiles) throw new HostError('UNKNOWN_METHOD','Update Tavora to remember files.');
    await s.context.readOnlyFiles.forget(id); return null;
  }],
  ['files.check', async (s,params) => {
    const id = fileReference(params);
    if (!s.context.readOnlyFiles) throw new HostError('UNKNOWN_METHOD','Update Tavora to check files.');
    return s.context.readOnlyFiles.check(id);
  }],
  ['files.showInFolder', async (s,params) => {
    const id = fileReference(params);
    if (!s.context.readOnlyFiles) throw new HostError('UNKNOWN_METHOD','Update Tavora to show files in their folder.');
    await s.context.readOnlyFiles.showInFolder(id); return null;
  }],
  ["workspace.getCurrent", (s, params) => (noParams(params), { ...s.context.workspace })],
  // Deprecated: the same in the words of Tavora before 0.21.43 (a personal workspace's kind was "workspace"). Answered
  // until the 1.0 preparation, so modules made before it keep working.
  ["game.getCurrent", (s, params) => (noParams(params), legacyGame(s.context.workspace))],

  ["storage.get", (s, params) => s.context.data.settings.get(object(params).key)],
  ["storage.keys", (s, params) => (noParams(params), s.context.data.settings.keys())],
  [
    "storage.compareAndSet",
    (s, params) => {
      const p = object(params);
      return s.context.data.settings.compareAndSet(p.key, required(p, "expected"), required(p, "value"));
    },
  ],
  [
    "storage.set",
    async (s, params) => {
      const p = object(params);
      await s.context.data.settings.set(p.key, required(p, "value"));
      return null;
    },
  ],
  [
    "storage.delete",
    async (s, params) => {
      await s.context.data.settings.delete(object(params).key);
      return null;
    },
  ],

  ["storage.app.get", (s, params) => s.context.appSettings.get(object(params).key)],
  ["storage.app.keys", (s, params) => (noParams(params), s.context.appSettings.keys())],
  [
    "storage.app.compareAndSet",
    (s, params) => {
      const p = object(params);
      return s.context.appSettings.compareAndSet(p.key, required(p, "expected"), required(p, "value"));
    },
  ],
  [
    "storage.app.set",
    async (s, params) => {
      const p = object(params);
      await s.context.appSettings.set(p.key, required(p, "value"));
      return null;
    },
  ],
  [
    "storage.app.delete",
    async (s, params) => {
      await s.context.appSettings.delete(object(params).key);
      return null;
    },
  ],

  ["documents.list", (s, params) => (noParams(params), s.context.data.documents.list())],
  ["documents.get", (s, params) => s.context.data.documents.get(object(params).id)],
  ["documents.put", (s, params) => s.context.data.documents.put(object(params), s)],
  [
    "documents.delete",
    async (s, params) => {
      const p = object(params);
      await s.context.data.documents.delete(p.id, p.ifRevision, s);
      return null;
    },
  ],

  [
    "links.open",
    async (s, params) => {
      const url = required(object(params), "url");
      if (typeof url !== "string" || url.length === 0 || url.length > LINK_MAX) throw new HostError("INVALID_PARAMS", "params.url must be a web address");
      await s.context.openLink(url);
      return null;
    },
  ],

  ["blobs.list", (s, params) => (noParams(params), s.context.data.blobs.list())],
  ["blobs.usage", (s, params) => (noParams(params), s.context.data.blobs.usage())],
  [
    "blobs.delete",
    async (s, params) => {
      await s.context.data.blobs.delete(object(params).id);
      return null;
    },
  ],

  [
    "network.readPage",
    async (s, params) => {
      needs(s, "network", "network.readPage");
      return s.context.readPage(params);
    },
  ],
  [
    "network.fetch",
    async (s, params) => {
      // Without any granted host the answer is the same as for every other capability not granted (G9).
      needs(s, "network", "network.fetch");
      if (s.networkInFlight >= LIMITS.maxNetworkInFlight) throw new HostError("BAD_REQUEST", `at most ${LIMITS.maxNetworkInFlight} network requests at once`);
      s.networkInFlight++;
      try {
        return await s.context.fetch(params);
      } finally {
        s.networkInFlight--;
      }
    },
  ],

  ["aiUsage.accounts", (s, params) => (needs(s, "aiUsage", "aiUsage.accounts"), noParams(params), s.context.aiUsage.accounts())],
  [
    "aiUsage.read",
    (s, params) => {
      needs(s, "aiUsage", "aiUsage.read");
      const accountId = required(object(params), "accountId");
      if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 64) throw new HostError("INVALID_PARAMS", "params.accountId must be an account id");
      return s.context.aiUsage.read(accountId);
    },
  ],

  ["systemInfo.info", (s, params) => (needs(s, "systemInfo", "systemInfo.info"), noParams(params), s.context.systemInfo.info())],
  [
    "systemInfo.watch",
    (s, params) => {
      needs(s, "systemInfo", "systemInfo.watch");
      s.context.systemInfo.watch(parseWatch(params));
      return null;
    },
  ],
  ["systemInfo.connectionLog", (s, params) => (needs(s, "systemInfo", "systemInfo.connectionLog"), noParams(params), s.context.systemInfo.connectionLog())],
  ["systemInfo.clearConnectionLog", async (s, params) => (needs(s, "systemInfo", "systemInfo.clearConnectionLog"), noParams(params), await s.context.systemInfo.clearConnectionLog(), null)],
  ["systemInfo.connectionSettings", (s, params) => (needs(s, "systemInfo", "systemInfo.connectionSettings"), noParams(params), s.context.systemInfo.connectionSettings())],
  [
    "systemInfo.setConnectionSettings",
    async (s, params) => {
      needs(s, "systemInfo", "systemInfo.setConnectionSettings");
      return await s.context.systemInfo.setConnectionSettings(parseConnectionSettings(params));
    },
  ],
  ["systemInfo.apps", (s, params) => (needs(s, "systemInfo", "systemInfo.apps"), noParams(params), s.context.systemInfo.apps())],
  ["systemInfo.traffic", (s, params) => (needs(s, "systemInfo", "systemInfo.traffic"), noParams(params), s.context.systemInfo.traffic())],

  ["media.watch", (s, params) => (needs(s, "media", "media.watch"), s.context.media.watch(parseWatchParams(params)))],
  [
    "media.control",
    async (s, params) => {
      needs(s, "media", "media.control");
      const { session, action } = parseControlParams(params);
      return s.context.media.control(session, action);
    },
  ],

  ["leaderboards.status", (s, params) => (needs(s, "leaderboards", "leaderboards.status"), noParams(params), s.context.leaderboards.status())],
  ["leaderboards.show", (s, params) => (needs(s, "leaderboards", "leaderboards.show"), noParams(params), s.context.leaderboards.show())],
  ["leaderboards.hide", (s, params) => (needs(s, "leaderboards", "leaderboards.hide"), noParams(params), s.context.leaderboards.hide())],
  ["leaderboards.submit", (s, params) => (needs(s, "leaderboards", "leaderboards.submit"), s.context.leaderboards.submit(object(params)))],
  ["leaderboards.top", (s, params) => (needs(s, "leaderboards", "leaderboards.top"), s.context.leaderboards.top(object(params)))],
  ["leaderboards.mine", (s, params) => (needs(s, "leaderboards", "leaderboards.mine"), s.context.leaderboards.mine(object(params)))],

  ["discord.state", (s, params) => (needs(s, "discord", "discord.state"), noParams(params), s.context.discord.state())],
  ["discord.connect", async (s, params) => (needs(s, "discord", "discord.connect"), noParams(params), await s.context.discord.connect(), null)],
  ["discord.allowControl", async (s, params) => (needs(s, "discord", "discord.allowControl"), noParams(params), await s.context.discord.allowControl(), null)],
  [
    "discord.command",
    (s, params) => {
      needs(s, "discord", "discord.command");
      const { command, args } = discordCommand(object(params));
      return s.context.discord.command(command, args);
    },
  ],
  [
    "discord.subscribe",
    async (s, params) => {
      needs(s, "discord", "discord.subscribe");
      const { event, channelId } = discordSubscription(object(params));
      await s.context.discord.subscribe(event, channelId);
      return null;
    },
  ],
  [
    "discord.unsubscribe",
    async (s, params) => {
      needs(s, "discord", "discord.unsubscribe");
      const { event, channelId } = discordSubscription(object(params));
      await s.context.discord.unsubscribe(event, channelId);
      return null;
    },
  ],
  [
    "discord.image",
    (s, params) => {
      needs(s, "discord", "discord.image");
      const url = required(object(params), "url");
      if (typeof url !== "string" || url.length === 0 || url.length > 300) throw new HostError("INVALID_PARAMS", "params.url must be an address on cdn.discordapp.com");
      return s.context.discord.image(url);
    },
  ],

  [
    "overlay.publish",
    // Needs no capability: it only sets what a link or a game overlay shows. Copying a link does.
    (s, params) => {
      const p = object(params);
      const key = moduleKey(p, "key");
      const state = required(p, "state");
      if (Buffer.byteLength(serializeJson(state, "params.state"), "utf8") > LIMITS.maxOverlayStateBytes) throw new HostError("QUOTA_EXCEEDED", `an overlay's state may be at most ${LIMITS.maxOverlayStateBytes} bytes`);
      s.context.overlay.publish(key, state as JsonValue);
      return null;
    },
  ],
  ["overlay.remove", (s, params) => (s.context.overlay.remove(moduleKey(object(params), "key")), null)],
  // Needs no capability either: a window of Tavora's own shows the page, only after a click, and the user can turn it off.
  ["overlay.showOverGame", (s, params) => s.context.overlay.showOverGame(moduleKey(object(params), "key"))],
  // Needs neither a capability nor a click: it only takes this module's own overlay away, or lists it.
  ["overlay.hideOverGame", (s, params) => (s.context.overlay.hideOverGame(moduleKey(object(params), "key")), null)],
  ["overlay.overGame", (s) => s.context.overlay.overGame()],
  // Needs no capability: a window of Tavora's own shows the page, only after a click.
  ["overlay.preview", async (s, params) => (await s.context.overlay.preview(moduleKey(object(params), "key")), null)],
  // A module that asks for the connector on request may call it without the grant: Tavora asks the user then.
  ["overlay.copyLink", (s, params) => s.context.overlay.copyLink(moduleKey(object(params), "key"))],
  ["overlay.resetLink", (s, params) => (needs(s, "overlay", "overlay.resetLink"), s.context.overlay.resetLink(moduleKey(object(params), "key")), null)],

  ["hotkeys.list", (s, params) => (noParams(params), s.context.hotkeys.list())],
  [
    "hotkeys.set",
    (s, params) => {
      const p = object(params);
      const action = actionId(required(p, "action"));
      const target = moduleKey(p, "target");
      const label = required(p, "label");
      if (typeof label !== "string" || label.trim() === "" || label.length > LIMITS.maxHotkeyLabel || /[\u0000-\u001f]/.test(label)) {
        throw new HostError("INVALID_PARAMS", `params.label must be 1 to ${LIMITS.maxHotkeyLabel} characters on one line`);
      }
      return s.context.hotkeys.set(action, target, label.trim());
    },
  ],
  [
    "hotkeys.remove",
    (s, params) => {
      const p = object(params);
      const target = moduleKey(p, "target");
      s.context.hotkeys.remove(target, p.action === undefined ? null : actionId(p.action));
      return null;
    },
  ],

  ["panel.getState", (s, params) => (noParams(params), s.context.panelState.get(s.context.instanceId))],
  [
    "panel.setState",
    async (s, params) => {
      await s.context.panelState.set(s.context.instanceId, required(object(params), "value"));
      return null;
    },
  ],

  ["panel.getLaunch", (s, params) => (noParams(params), structuredClone(s.context.launch))],
  [
    "panel.setContent",
    (s, params) => {
      const raw = required(object(params), "content");
      const content = raw === null ? null : checkPanelContent(raw);
      if (raw !== null && content === null) {
        throw new HostError(
          "INVALID_PARAMS",
          `params.content must be null or { id, title }: an id of 1 to ${LIMITS.maxContentIdLength} characters and a title of 1 to ${LIMITS.maxTitleLength}`,
        );
      }
      s.context.setContent(content);
      return null;
    },
  ],

  ["panel.isMaximized", (s, params) => (noParams(params), s.context.isMaximized())],
  [
    "panel.setMaximized",
    async (s, params) => {
      const maximized = required(object(params), "maximized");
      if (typeof maximized !== "boolean") throw new HostError("INVALID_PARAMS", "params.maximized must be a boolean");
      await s.context.setMaximized(maximized);
      return null;
    },
  ],

  [
    "panel.setDialog",
    async (s, params) => {
      const p = object(params);
      const open = required(p, "open");
      if (typeof open !== "boolean") throw new HostError("INVALID_PARAMS", "params.open must be a boolean");
      const side = (key: "width" | "height") => {
        const value = p[key];
        if (value === undefined) return PANEL_DIALOG[key];
        if (!Number.isSafeInteger(value) || (value as number) < PANEL_DIALOG.min || (value as number) > PANEL_DIALOG.max) {
          throw new HostError("INVALID_PARAMS", `params.${key} must be a whole number from ${PANEL_DIALOG.min} to ${PANEL_DIALOG.max}`);
        }
        return value as number;
      };
      await s.context.setDialog(open, { width: side("width"), height: side("height") });
      return null;
    },
  ],

  [
    "panel.setLive",
    (s, params) => {
      const state = required(object(params), "state");
      if (Buffer.byteLength(serializeJson(state, "params.state"), "utf8") > LIMITS.maxOverlayStateBytes) throw new HostError("QUOTA_EXCEEDED", `a live view's state may be at most ${LIMITS.maxOverlayStateBytes} bytes`);
      s.context.setLive(state as JsonValue | null);
      return null;
    },
  ],

  [
    "panel.navigated",
    (s, params) => {
      const p = object(params);
      const requestId = required(p, "requestId");
      const handled = required(p, "handled");
      const ok = required(p, "ok");
      if (!Number.isSafeInteger(requestId) || typeof handled !== "boolean" || typeof ok !== "boolean") {
        throw new HostError("INVALID_PARAMS", "params must be { requestId: integer, handled: boolean, ok: boolean }");
      }
      s.context.navigated(requestId as number, handled, ok);
      return null;
    },
  ],
  [
    "panels.open",
    (s, params) => {
      const p = object(params);
      const type = required(p, "type");
      if (!isPanelTypeId(type)) throw new HostError("INVALID_PARAMS", "params.type must be a panel type id of this module");
      let content: PanelContent | null = null;
      if (p.content !== undefined) {
        content = checkPanelContent(p.content);
        if (!content) throw new HostError("INVALID_PARAMS", "params.content must be { id, title }, as for panel.setContent");
      }
      return s.context.openPanel(type, content);
    },
  ],
  [
    "panels.openMany",
    (s, params) => {
      const types = required(object(params), "types");
      if (!Array.isArray(types) || types.length === 0 || types.length > MAX_PANEL_TYPES || !types.every(isPanelTypeId)) {
        throw new HostError("INVALID_PARAMS", `params.types must be 1 to ${MAX_PANEL_TYPES} panel type ids of this module`);
      }
      if (new Set(types).size !== types.length) throw new HostError("INVALID_PARAMS", "params.types names a panel type twice");
      return s.context.openPanels(types as string[]);
    },
  ],

  ["workspace.getViewport", (s, params) => (noParams(params), s.context.getViewport())],
  ["ui.getTheme", (s, params) => (noParams(params), s.context.getTheme())],
  ["ui.getLanguage", (s, params) => (noParams(params), s.context.getLanguage())],
  ["ui.showMenu", (s, params) => s.context.showMenu(checkMenu(params))],
  ["ui.tooltip.show",(s,p)=>s.context.tooltip.show(checkTooltip(p))],
  ["ui.tooltip.move",(s,p)=>{s.context.tooltip.move(checkTooltipAnchor(p));return null;}],
  ["ui.tooltip.hide",(s,p)=>{s.context.tooltip.close(tooltipId(p),true);return null;}],
  ["ui.tooltip.close",(s,p)=>{s.context.tooltip.close(tooltipId(p),false);return null;}],
]);

/** Serves one module panel over one port. */
export class BridgeSession {
  private inFlight = 0;
  private served = 0;
  private closed = false;
  private handshakeDone = false;
  /** network.fetch calls of this panel still running. */
  networkInFlight = 0;

  constructor(
    private readonly port: BridgePort,
    readonly context: BridgeContext,
    private readonly onClosed: () => void = () => {},
  ) {
    port.on("message", (event) => {
      // Modules have no reason to hand ports to the host; drop them.
      for (const extra of event.ports) extra.close();
      void this.handle(event.data);
    });
    port.on("close", () => this.markClosed());
    context.data.documents.on("change", this.onDocumentChange);
    port.start();
  }

  /** The page connected and has not gone away, so events reach it. */
  get ready(): boolean {
    return !this.closed && this.handshakeDone;
  }

  emit<E extends EventName>(event: E, data: Events[E]): void {
    if (!this.closed && this.handshakeDone) this.port.postMessage({ v: PROTOCOL_VERSION, event, data });
  }

  close(): void {
    if (this.closed) return;
    this.port.close();
    this.markClosed();
  }

  private readonly onDocumentChange = (change: DocumentChange, origin: unknown) => {
    if (origin !== this) this.emit("documents.changed", change);
  };

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.context.data.documents.off("change", this.onDocumentChange);
    this.onClosed();
  }

  private handshake(params: unknown): HandshakeResult {
    const p = object(params);
    if (p.protocol !== PROTOCOL_VERSION) {
      throw new HostError("INCOMPATIBLE", `this host speaks protocol ${PROTOCOL_VERSION}, not ${String(p.protocol)}`, {
        supported: [PROTOCOL_VERSION],
      });
    }
    this.handshakeDone = true;
    return {
      protocol: PROTOCOL_VERSION,
      host: { name: "tavora-desktop", version: this.context.hostVersion },
      module: { id: this.context.moduleId, version: this.context.moduleVersion },
      capabilities: [...this.context.capabilities()],
      panel: { type: this.context.panelType },
    };
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) return;
    const id = (raw as { id?: unknown }).id;
    // Without a usable id there is nobody to answer.
    if (!Number.isSafeInteger(id) || (id as number) < 1) return;
    const requestId = id as number;

    if (this.inFlight >= LIMITS.maxInFlight) {
      return this.fail(requestId, new HostError("BAD_REQUEST", "too many concurrent requests"));
    }
    if (this.inFlight++ === 0) this.context.onBusy?.(true, this.served);
    let handshake = false;
    try {
      let size: number;
      try {
        size = JSON.stringify(raw)?.length ?? 0;
      } catch {
        throw new HostError("BAD_REQUEST", "message must be plain JSON data");
      }
      if (size > LIMITS.maxMessageBytes) throw new HostError("BAD_REQUEST", "message is too large");

      const { v, method, params } = raw as { v?: unknown; method?: unknown; params?: unknown };
      if (v !== PROTOCOL_VERSION) {
        throw new HostError("BAD_REQUEST", `unsupported protocol version ${String(v)}`, { supported: [PROTOCOL_VERSION] });
      }
      if (typeof method !== "string") throw new HostError("UNKNOWN_METHOD", "method must be a string");

      let result: unknown;
      if (method === "bridge.handshake") {
        handshake = true;
        result = this.handshake(params);
      } else if (!this.handshakeDone) {
        throw new HostError("BAD_REQUEST", "call bridge.handshake first");
      } else if (Object.hasOwn(RESERVED_METHODS, method)) {
        const capability = RESERVED_METHODS[method]!;
        // Nothing can grant these yet; the check is here so the error shape
        // stays the same once something can.
        if (!this.context.capabilities().has(capability)) {
          throw new HostError("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
        }
        throw new HostError("UNKNOWN_METHOD", `${method} is not available in this host version`);
      } else {
        const handler = handlers.get(method);
        if (!handler) throw new HostError("UNKNOWN_METHOD", `unknown method ${method}`);
        result = await handler(this, params);
      }
      if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id: requestId, ok: true, result });
      // A panel that connects while hidden learns so right after connecting.
      if (method === "bridge.handshake" && this.context.isSuspended()) this.emit("lifecycle.suspend", null);
    } catch (error) {
      if (error instanceof HostError) {
        this.fail(requestId, error);
      } else {
        console.error(`[tavora] bridge error in ${this.context.moduleId}`, error);
        this.fail(requestId, new HostError("INTERNAL", "internal error"));
      }
    } finally {
      if (!handshake) this.served++;
      if (--this.inFlight === 0) this.context.onBusy?.(false, this.served);
    }
  }

  private fail(id: number, error: HostError): void {
    if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id, ok: false, error: error.toPayload() });
  }
}
