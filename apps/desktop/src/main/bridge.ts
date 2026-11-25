import {
  checkActionId,
  checkBlobId,
  checkDialogTitle,
  checkDiscordImage,
  checkFileReference,
  checkHotkeyLabel,
  checkModuleKey,
  checkOverlaySources,
  checkPickReadOnly,
  isPanelTypeId,
  LIMITS,
  PROTOCOL_VERSION,
  type ParamCheck,
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
  type OverlaySource,
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
  type TavoraTheme,
  type TavoraViewport,
  type TavoraWorkspace,
} from "@tavora/sdk/protocol";
import { isFolderPath, MAX_PANEL_TYPES } from "@tavora/module-schema";
import { measureWire } from "../shared/wire";
import { HostError } from "./errors";
import { serializeJson } from "./json";
import { discordCommand, discordSubscription } from "./discord-commands";
import { checkMenu, type CheckedMenu } from "./module-menu";
import {checkTooltip,checkTooltipAnchor,tooltipId} from "./tooltip-content";
import {checkSkinRequest} from "./tooltip-skin";
import type {TooltipRequest,TooltipAnchor,TooltipSkin} from "@tavora/sdk/protocol";
import { checkPanelContent } from "./panel-content";
import { parseConnectionSettings, parseWatch, type ConnectionSettingsChange, type WatchRequest } from "./system-info-parse";
import { parseControlParams, parseWatchParams } from "./media-parse";
import type { ModuleData, ModuleStore, PanelStateAccess } from "./storage";
import type { BlobStore } from "./blobs";
import { checkGrant, grantAfterParams, type GrantedCall } from "./panel-gate";

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
 * What a panel's calls hold in the main process: requests, network.fetch calls and the bytes of the requests being
 * handled. The panel's view keeps one for as long as it lives and hands it to every port, so a page that asks for a new
 * port starts with what its old one still runs, not with nothing.
 */
export interface BridgeBudget {
  inFlight: number;
  networkInFlight: number;
  bytes: number;
}

/** The most request bytes a panel has in the main process at once: as much as its own renderer lets through (preload/relay.ts). */
export const MAX_IN_FLIGHT_BYTES = 2 * LIMITS.maxMessageBytes;

export const newBridgeBudget = (): BridgeBudget => ({ inFlight: 0, networkInFlight: 0, bytes: 0 });

/**
 * Everything a module may learn about itself. Built by the host from the
 * view that owns the port, never from anything the module sends.
 */
export interface BridgeContext {
  /** The view's budget, shared by every port of the panel (BridgeBudget); a session alone gets its own. */
  budget?: BridgeBudget;
  /**
   * Folders of permissions.folders (main/folder-access.ts). Each call names the folder by its manifest path and checks
   * the user's grant again; none of them ever says where the folder is.
   */
  folders?: {
    state(folder: string): Promise<import('@tavora/sdk/protocol').FolderState>;
    list(folder: string): Promise<import('@tavora/sdk/protocol').FolderListing>;
    watch(folder: string, on: boolean): Promise<void>;
    choose(folder: string): Promise<boolean>;
    showInFolder(folder: string, path: string): Promise<void>;
  };
  /** Files the user linked to the module (files.pickReadOnly), as the panel's session keeps them (panel-session.ts). */
  readOnlyFiles: {
    pick(extensions: string[], multiple: boolean, near?: import('@tavora/sdk/protocol').PickNear): Promise<import('@tavora/sdk/protocol').ReadOnlyFile[]>;
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
  /** Whether the panel is over the game now: lent to the in-game layer while the user holds it open. */
  isOverGame(): boolean;
  /** panel.setMaximized: true throws PERMISSION_DENIED unless the panel just got a click or key press. */
  setMaximized(maximized: boolean): Promise<void>;
  /** panel.setDialog: opening throws PERMISSION_DENIED unless the panel just got a click or key press. */
  setDialog(open: boolean, size: PanelDialogSize): Promise<void>;
  /** panel.setDialogTitle (already checked): the title in the frame of the panel's open dialog; null is the module's name. Needs no click. */
  setDialogTitle(title: string | null): void;
  /** panel.setLive: what the panel's live view shows over the game (already size-checked); null shows nothing. Needs no click. */
  setLive(state: JsonValue | null): void;
  /** The workspace the panel is in. */
  workspace: TavoraWorkspace;
  data: ModuleData;
  /** The module's settings shared by every workspace (storage.app). */
  appSettings: ModuleStore;
  /** The module's files shared by every workspace (blobs.app). */
  appBlobs: BlobStore;
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
  panelState: PanelStateAccess;
  /** What the user has granted this module right now; asked on every gated call, so a revoke takes effect at once. */
  capabilities(): ReadonlySet<Capability>;
  getViewport(): TavoraViewport;
  getTheme(): TavoraTheme;
  getLanguage(): string;
  /** Whether the panel is hidden right now. */
  isSuspended(): boolean;
  /** Whether Tavora's window is behind another program (the game) and this panel is not over the game. Optional: a context without it is never behind. */
  isBehind?(): boolean;
  /** Opens a web address in a Browser panel. Throws a HostError when the panel did not just get a click or key press, or the address is not a web address. */
  openLink(url: string): void | Promise<void>;
  /** ui.showMenu: Tavora draws the checked menu above every panel; the chosen id, or null. Throws PERMISSION_DENIED without a click or key press first. */
  showMenu(menu: CheckedMenu): Promise<string | null>;
  tooltip: {
    show(request:TooltipRequest):Promise<boolean>;
    move(anchor:TooltipAnchor):void;
    close(id:string,hoverOnly:boolean):void;
    /** ui.tooltip.defineSkin, its shape already checked: reads and checks the skin's files and keeps it for the module. */
    defineSkin(name:string,skin:TooltipSkin):Promise<void>;
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
    /** overlay.setSources: what this panel can show over the game, by key (already checked); the list the Overlay page shows under the panel. */
    setSources(sources: OverlaySource[]): void;
    /** Throws PERMISSION_DENIED unless the panel just got a click or key press, and INVALID_PARAMS without an overlay in the manifest. */
    preview(key: string): Promise<void>;
    /** overlay.openPage: shows Tavora's Overlay page and closes this panel's dialog. Needs a click (PERMISSION_DENIED otherwise). */
    openPage(): Promise<void>;
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

/** Longest address links.open accepts. */
const LINK_MAX = 2048;

/** The params as a shared check (@tavora/sdk/protocol) took them, or its refusal as a HostError. */
function checked<T>(result: ParamCheck<T>): T {
  if (!result.ok) throw new HostError(result.code, result.message);
  return result.value;
}

/** An overlay key or hotkey target: the module's own id, like a document id. */
function moduleKey(params: Record<string, unknown>, name: "key" | "target"): string {
  return checked(checkModuleKey(required(params, name), name));
}

/** The id of a file the module linked (files.pickReadOnly). */
function fileReference(params: unknown): string {
  return checked(checkFileReference(object(params).id));
}

/** The host's folders, or UNKNOWN_METHOD from a host that has none. */
function folderContext(s: BridgeSession): NonNullable<BridgeContext["folders"]> {
  if (!s.context.folders) throw new HostError('UNKNOWN_METHOD','Update Tavora to read folders.');
  return s.context.folders;
}

/** The folder a folders.* call names: a permissions.folders path, checked against the grant by the host. */
function folderParam(params: unknown): string {
  const folder = object(params).folder;
  if (!isFolderPath(folder)) throw new HostError('INVALID_PARAMS','folder must be a path of permissions.folders, such as Documents/My Game.');
  return folder;
}

/**
 * A call the user grants (panel-gate.ts GATED_CALLS `grant`): its params, checked, and what it does with them. The
 * session asks the grant before the params or after them, as the table says (`BridgeSession.granted`); no handler asks
 * it itself.
 */
interface GrantedHandler<P> {
  params(params: unknown): P;
  run(s: BridgeSession, params: P): Promise<unknown> | unknown;
}

const granted = <P>(params: (params: unknown) => P, run: (s: BridgeSession, params: P) => Promise<unknown> | unknown): GrantedHandler<P> => ({ params, run });
/** For a call that takes no params. */
const none = (params: unknown): void => noParams(params);
/** For a call whose params its context checks. */
const asIs = (params: unknown): unknown => params;

/** Every call the gate asks the grant of has its handler here, and nothing else does (the type says so). */
const grantedHandlers: { readonly [K in GrantedCall]: GrantedHandler<unknown> } = {
  "folders.state": granted(folderParam, (s, folder) => folderContext(s).state(folder)),
  "folders.list": granted(folderParam, (s, folder) => folderContext(s).list(folder)),
  "folders.watch": granted(
    (params) => {
      const folder = folderParam(params), on = object(params).on;
      if (typeof on !== 'boolean') throw new HostError('INVALID_PARAMS','on must be true or false.');
      return { folder, on };
    },
    async (s, { folder, on }) => {
      await folderContext(s).watch(folder, on);
      return null;
    },
  ),
  "folders.choose": granted(folderParam, (s, folder) => folderContext(s).choose(folder)),
  "folders.showInFolder": granted(
    (params) => {
      const folder = folderParam(params), file = object(params).path;
      if (typeof file !== 'string' || file.length === 0 || file.length > 2600) throw new HostError('INVALID_PARAMS','path must be a file path inside the folder, such as Replays/Game.SC2Replay.');
      return { folder, file };
    },
    async (s, { folder, file }) => {
      await folderContext(s).showInFolder(folder, file);
      return null;
    },
  ),

  "network.readPage": granted(asIs, (s, params) => s.context.readPage(params)),
  "network.fetch": granted(asIs, async (s, params) => {
    if (s.budget.networkInFlight >= LIMITS.maxNetworkInFlight) throw new HostError("BAD_REQUEST", `at most ${LIMITS.maxNetworkInFlight} network requests at once`);
    s.budget.networkInFlight++;
    try {
      return await s.context.fetch(params);
    } finally {
      s.budget.networkInFlight--;
    }
  }),

  "aiUsage.accounts": granted(none, (s) => s.context.aiUsage.accounts()),
  "aiUsage.read": granted(
    (params) => {
      const accountId = required(object(params), "accountId");
      if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 64) throw new HostError("INVALID_PARAMS", "params.accountId must be an account id");
      return accountId;
    },
    (s, accountId) => s.context.aiUsage.read(accountId),
  ),

  "systemInfo.info": granted(none, (s) => s.context.systemInfo.info()),
  "systemInfo.watch": granted(parseWatch, (s, request) => (s.context.systemInfo.watch(request), null)),
  "systemInfo.connectionLog": granted(none, (s) => s.context.systemInfo.connectionLog()),
  "systemInfo.clearConnectionLog": granted(none, async (s) => (await s.context.systemInfo.clearConnectionLog(), null)),
  "systemInfo.connectionSettings": granted(none, (s) => s.context.systemInfo.connectionSettings()),
  "systemInfo.setConnectionSettings": granted(parseConnectionSettings, async (s, change) => await s.context.systemInfo.setConnectionSettings(change)),
  "systemInfo.apps": granted(none, (s) => s.context.systemInfo.apps()),
  "systemInfo.traffic": granted(none, (s) => s.context.systemInfo.traffic()),

  "media.watch": granted(parseWatchParams, (s, on) => s.context.media.watch(on)),
  "media.control": granted(parseControlParams, (s, { session, action }) => s.context.media.control(session, action)),

  "leaderboards.status": granted(none, (s) => s.context.leaderboards.status()),
  "leaderboards.show": granted(none, (s) => s.context.leaderboards.show()),
  "leaderboards.hide": granted(none, (s) => s.context.leaderboards.hide()),
  "leaderboards.submit": granted(object, (s, params) => s.context.leaderboards.submit(params)),
  "leaderboards.top": granted(object, (s, params) => s.context.leaderboards.top(params)),
  "leaderboards.mine": granted(object, (s, params) => s.context.leaderboards.mine(params)),

  "discord.state": granted(none, (s) => s.context.discord.state()),
  "discord.connect": granted(none, async (s) => (await s.context.discord.connect(), null)),
  "discord.allowControl": granted(none, async (s) => (await s.context.discord.allowControl(), null)),
  "discord.command": granted((params) => discordCommand(object(params)), (s, { command, args }) => s.context.discord.command(command, args)),
  "discord.subscribe": granted(
    (params) => discordSubscription(object(params)),
    async (s, { event, channelId }) => {
      await s.context.discord.subscribe(event, channelId);
      return null;
    },
  ),
  "discord.unsubscribe": granted(
    (params) => discordSubscription(object(params)),
    async (s, { event, channelId }) => {
      await s.context.discord.unsubscribe(event, channelId);
      return null;
    },
  ),
  "discord.image": granted(
    (params) => checked(checkDiscordImage(required(object(params), "url"))),
    (s, url) => s.context.discord.image(url),
  ),

  "overlay.resetLink": granted((params) => moduleKey(object(params), "key"), (s, key) => (s.context.overlay.resetLink(key), null)),
};

/** The calls the session asks the grant of before it serves them (the gate's table, panel-gate.ts). */
export const grantedCalls = (): string[] => Object.keys(grantedHandlers);

const handlers = new Map<string, Handler>([
  ['files.pickReadOnly', async (s,params) => {
    const { extensions, multiple, near } = checked(checkPickReadOnly(params));
    const picked = await s.context.readOnlyFiles.pick(extensions, multiple, near);
    return multiple ? picked : (picked[0] ?? null);
  }],
  ['files.forget', async (s,params) => {
    const id = fileReference(params);
    await s.context.readOnlyFiles.forget(id); return null;
  }],
  ['files.check', async (s,params) => {
    const id = fileReference(params);
    return s.context.readOnlyFiles.check(id);
  }],
  ['files.showInFolder', async (s,params) => {
    const id = fileReference(params);
    await s.context.readOnlyFiles.showInFolder(id); return null;
  }],
  ["workspace.getCurrent", (s, params) => (noParams(params), { ...s.context.workspace })],

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
      await s.context.data.blobs.delete(checked(checkBlobId(object(params).id)));
      return null;
    },
  ],
  ["blobs.app.list", (s, params) => (noParams(params), s.context.appBlobs.list())],
  ["blobs.app.usage", (s, params) => (noParams(params), s.context.appBlobs.usage())],
  [
    "blobs.app.delete",
    async (s, params) => {
      await s.context.appBlobs.delete(checked(checkBlobId(object(params).id)));
      return null;
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
  // Needs neither a capability nor a click: it only names what this panel can show; Tavora draws the names as plain text.
  ["overlay.setSources", (s, params) => (s.context.overlay.setSources(checked(checkOverlaySources(required(object(params), "sources")))), null)],
  // Needs no capability: a window of Tavora's own shows the page, only after a click.
  // Shows Tavora's Overlay page (the module's panel dialog closes); the gesture is taken where the context is made (module-view.ts).
  ["overlay.openPage", async (s) => (await s.context.overlay.openPage(), null)],
  ["overlay.preview", async (s, params) => (await s.context.overlay.preview(moduleKey(object(params), "key")), null)],
  // A module that asks for the connector on request may call it without the grant: Tavora asks the user then.
  ["overlay.copyLink", (s, params) => s.context.overlay.copyLink(moduleKey(object(params), "key"))],

  ["hotkeys.list", (s, params) => (noParams(params), s.context.hotkeys.list())],
  [
    "hotkeys.set",
    (s, params) => {
      const p = object(params);
      const action = checked(checkActionId(required(p, "action")));
      const target = moduleKey(p, "target");
      const label = checked(checkHotkeyLabel(required(p, "label")));
      return s.context.hotkeys.set(action, target, label);
    },
  ],
  [
    "hotkeys.remove",
    (s, params) => {
      const p = object(params);
      const target = moduleKey(p, "target");
      s.context.hotkeys.remove(target, p.action === undefined ? null : checked(checkActionId(p.action)));
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
  ["panel.isOverGame", (s, params) => (noParams(params), s.context.isOverGame())],
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
    "panel.setDialogTitle",
    (s, params) => {
      s.context.setDialogTitle(checked(checkDialogTitle(required(object(params), "title"))));
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
  ["ui.tooltip.defineSkin",async(s,p)=>{const {name,skin}=checkSkinRequest(p);await s.context.tooltip.defineSkin(name,skin);return null;}],
]);

/** What a page whose panel was closed may still call while it saves (`BridgeSession.closing`): its data, and nothing on screen. */
export function servedWhileClosing(method: string): boolean {
  return /^(storage|documents|blobs)\./.test(method) || method === "panel.getState" || method === "panel.setState";
}

/** Serves one module panel over one port. */
export class BridgeSession {
  private inFlight = 0;
  private served = 0;
  private closed = false;
  /** The panel was closed: the port stays open a moment longer, for the page's saves only. */
  private closingDown = false;
  private handshakeDone = false;
  /** What the panel's calls hold now, this port's and those of its earlier ports still running. */
  readonly budget: BridgeBudget;

  constructor(
    private readonly port: BridgePort,
    readonly context: BridgeContext,
    private readonly onClosed: () => void = () => {},
  ) {
    this.budget = context.budget ?? newBridgeBudget();
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

  /** The panel was closed but its page may still save: from now on only its saves are answered, until `close`. */
  closing(): void {
    this.closingDown = true;
  }

  /** Requests started and not answered yet. */
  get busy(): boolean {
    return this.inFlight > 0;
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
    // A closed port starts nothing more: whatever still arrives on it is dropped.
    if (this.closed) return;

    // The handshake holds nothing and ends at once: a new page always gets through it, whatever its old one still runs.
    const budget = (raw as { method?: unknown }).method === "bridge.handshake" ? newBridgeBudget() : this.budget;
    if (budget.inFlight >= LIMITS.maxInFlight) {
      return this.fail(requestId, new HostError("BAD_REQUEST", "too many concurrent requests"));
    }
    budget.inFlight++;
    if (this.inFlight++ === 0) this.context.onBusy?.(true, this.served);
    let handshake = false;
    let held = 0;
    try {
      // Measured as the module's renderer measured it (preload/relay.ts), so what it let through counts the same here.
      const measured = measureWire(raw, LIMITS.maxMessageBytes);
      if (!measured.ok) throw measured.reason === "too-large" ? new HostError("BAD_REQUEST", "message is too large") : new HostError("INVALID_PARAMS", "message must be plain JSON data");
      if (budget.bytes + measured.bytes > MAX_IN_FLIGHT_BYTES) throw new HostError("BAD_REQUEST", "too many concurrent requests");
      budget.bytes += held = measured.bytes;

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
      } else if (this.closingDown && !servedWhileClosing(method)) {
        throw new HostError("BAD_REQUEST", `${method} is not available while the panel closes; only saves are`);
      } else if (Object.hasOwn(RESERVED_METHODS, method)) {
        const capability = RESERVED_METHODS[method]!;
        // Nothing can grant these yet; the check is here so the error shape
        // stays the same once something can.
        if (!this.context.capabilities().has(capability)) {
          throw new HostError("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
        }
        throw new HostError("UNKNOWN_METHOD", `${method} is not available in this host version`);
      } else if (Object.hasOwn(grantedHandlers, method)) {
        result = await this.granted(method as GrantedCall, params);
      } else {
        const handler = handlers.get(method);
        if (!handler) throw new HostError("UNKNOWN_METHOD", `unknown method ${method}`);
        result = await handler(this, params);
      }
      if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id: requestId, ok: true, result });
      // A panel that connects while hidden learns so right after connecting.
      if (method === "bridge.handshake" && this.context.isSuspended()) this.emit("lifecycle.suspend", null);
      if (method === "bridge.handshake" && this.context.isBehind?.()) this.emit("lifecycle.behind", { behind: true });
    } catch (error) {
      if (error instanceof HostError) {
        this.fail(requestId, error);
      } else {
        console.error(`[tavora] bridge error in ${this.context.moduleId}`, error);
        this.fail(requestId, new HostError("INTERNAL", "internal error"));
      }
    } finally {
      budget.inFlight--;
      budget.bytes -= held;
      if (!handshake) this.served++;
      if (--this.inFlight === 0) this.context.onBusy?.(false, this.served);
    }
  }

  /**
   * Serves a call the user grants: the grant is asked on every call (G9), before anything else, or for a call that names
   * its folder, once that name is checked (GATED_CALLS `grantAfterParams`).
   */
  private granted(call: GrantedCall, raw: unknown): Promise<unknown> | unknown {
    const handler = grantedHandlers[call];
    const afterParams = grantAfterParams(call);
    if (!afterParams) checkGrant(call, this.context.capabilities());
    const params = handler.params(raw);
    if (afterParams) checkGrant(call, this.context.capabilities());
    return handler.run(this, params);
  }

  private fail(id: number, error: HostError): void {
    if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id, ok: false, error: error.toPayload() });
  }
}
