// @tavora/sdk: thin typed client for modules running inside Tavora Desktop.
// The host enforces every check; this package only marshals typed calls.
import type { TooltipAnchor, TooltipRequest } from "./tooltip-types.js";
export type { TooltipAnchor, TooltipRequest, TooltipContent } from "./tooltip-types.js";
// Protocol reference: apps/docs/reference/protocol.md.

import {
  BLOB_PATH,
  CLIPBOARD_PATH,
  PICTURES_PATH,
  JSON_EXPORT_PATH,
  JSON_SAVE_PATH,
  JSON_OPEN_PATH,
  READ_ONLY_FILE_PATH,
  type ReadOnlyFile,
  HELLO_MESSAGE,
  LIMITS,
  OVERLAY_STATE_PATH,
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type AiUsageAccountInfo,
  type AiUsageReading,
  type SystemInfo,
  type SystemSnapshot,
  type SystemWatchBlocks,
  type SystemInterval,
  type BlobInfo,
  type BlobUsage,
  type Capability,
  type DiscordCommand,
  type DiscordCommands,
  type DiscordEvent,
  type DiscordEventName,
  type DiscordResult,
  type DiscordState,
  type DocumentChange,
  type DocumentSummary,
  type ErrorCode,
  type ErrorPayload,
  type EventName,
  type Events,
  type HandshakeResult,
  type HostMessage,
  type HotkeyBinding,
  type HotkeySetResult,
  type JsonValue,
  type MenuRequest,
  type MethodName,
  type Methods,
  type NetworkRequest,
  type NetworkResponse,
  type OverlayLinkResult,
  type GameOverlayResult,
  type PageResponse,
  type PanelContent,
  type PanelLaunch,
  type PanelOpenResult,
  type PutDocumentParams,
  type TavoraDocument,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
} from "./protocol.js";

export type {
  ReadOnlyFile,
  HotkeyBinding,
  HotkeySetResult,
  OverlayLinkResult,
  GameOverlayResult,
  AiUsageAccountInfo,
  AiUsageReading,
  SystemInfo,
  SystemSnapshot,
  SystemWatchBlocks,
  SystemInterval,
  SystemDriveKind,
  BlobInfo,
  BlobType,
  BlobUsage,
  Capability,
  DiscordCommand,
  DiscordCommands,
  DiscordEvent,
  DiscordEventName,
  DiscordResult,
  DiscordState,
  DocumentChange,
  DocumentSummary,
  ErrorCode,
  HandshakeResult,
  JsonValue,
  MenuEntry,
  MenuRequest,
  NetworkRequest,
  NetworkResponse,
  PageResponse,
  PanelContent,
  PanelLaunch,
  PanelOpenResult,
  PutDocumentParams,
  TavoraDocument,
  TavoraGame,
  TavoraTheme,
  TavoraViewport,
  ThemeToken,
} from "./protocol.js";
export { BLOB_ID, BLOB_TYPES, DISCORD_COMMANDS, DISCORD_EVENTS, LIMITS, OVERLAY_KEY, PROTOCOL_VERSION, SYSTEM_INTERVALS_MS, SYSTEM_MAX_DRIVES, THEME_TOKENS } from "./protocol.js";

/** How long a menu may stay open; the host closes it itself when its panel goes. */
const MENU_TIMEOUT_MS = 60 * 60_000;

/** Version of this SDK package, sent to the host during the handshake. */
export const SDK_VERSION = "0.2.11";

/**
 * The oldest Tavora that has everything this SDK version offers. Put it in your manifest as
 * `minTavora`, so an older Tavora says it needs an update instead of loading a module it cannot run
 * (the starter, `npm create @tavora/module`, does). The changelog names it for every version.
 */
export const MIN_TAVORA = "0.19.32";

export class TavoraError extends Error {
  readonly code: ErrorCode;
  /** Set for PERMISSION_DENIED. */
  readonly capability: Capability | undefined;
  /** Set for CONFLICT: the document's current revision. */
  readonly revision: number | undefined;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.name = "TavoraError";
    this.code = payload.code;
    this.capability = payload.capability;
    this.revision = payload.revision;
  }
}

type Unsubscribe = () => void;

/** Small key/value settings: at most 5 MB of keys and values together, values plain JSON. */
export interface KeyValueStore {
  /** T is not checked at runtime; the host only guarantees the value is JSON. */
  get<T = JsonValue>(key: string): Promise<T | null>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface TavoraSDK {
  /** What the host reported when this module connected. */
  readonly host: HandshakeResult;
  game: {
    getCurrent(): Promise<TavoraGame>;
  };
  /** Small key/value settings, private to this module in the current game. */
  storage: KeyValueStore & {
    /** The same, shared by every game: settings that should not change from game to game. */
    app: KeyValueStore;
  };
  /**
   * Named documents (builds, plans, checklists), private to this module in
   * the current game and shared by all of its panels.
   */
  documents: {
    list(): Promise<DocumentSummary[]>;
    get<T = JsonValue>(id: string): Promise<(TavoraDocument & { data: T }) | null>;
    /** Creates or replaces a document. Pass ifRevision to avoid overwriting another panel's change. */
    put(document: PutDocumentParams): Promise<DocumentSummary>;
    delete(id: string, options?: { ifRevision?: number }): Promise<void>;
    /** Fires when another panel of this module changes a document. */
    onChange(fn: (change: DocumentChange) => void): Unsubscribe;
  };
  /** UI state for this one panel (selection, scroll, open tab). Cleared when the panel is closed. */
  panel: {
    /** Which of the manifest's `panels` this panel is, by id; null for a module without panel types (or an older Tavora). */
    readonly type: string | null;
    getState<T = JsonValue>(): Promise<T | null>;
    setState(value: JsonValue | null): Promise<void>;
    /**
     * Why this page is loading: `{ reason: "add" }` for a panel the player just added (pick its content
     * yourself, such as the last one used, or show a picker), or `{ reason: "restore", content }` for a panel
     * that was open before, with what it last showed. Needs Tavora 0.17.17 or newer.
     */
    getLaunch(): Promise<PanelLaunch>;
    /**
     * Tells Tavora what this panel shows now, such as the build picked in your toolbar's selector, or null for
     * nothing. Tavora keeps it with the panel, shows the title when the player hovers the tab, and gives it
     * back through getLaunch after a restart. Needs Tavora 0.17.17 or newer.
     */
    setContent(content: PanelContent | null): Promise<void>;
    /**
     * Lets another panel of this module switch this one to other content (`panels.open`). The handler saves any
     * pending edits and switches, then resolves; it throws (or rejects) when it cannot, and the panel keeps what it
     * showed. It has 5 seconds. One handler per page: a new one replaces the last. Without one, Tavora opens a new
     * panel instead of switching this one. Needs Tavora 0.17.18 or newer.
     */
    onNavigate(fn: (content: PanelContent) => void | Promise<void>): Unsubscribe;
    /** Whether this panel fills the workspace now (Maximize in its menu). Needs Tavora 0.20.20 or newer. */
    isMaximized(): Promise<boolean>;
    /**
     * Makes this panel fill the workspace (true), as Maximize in its menu does, or puts it back (false). Call true
     * from the click or key press that asked for it: the host refuses it otherwise. Nothing happens while the panel
     * is the only one, as it fills the workspace already. Needs Tavora 0.20.20 or newer.
     */
    setMaximized(maximized: boolean): Promise<void>;
    /** Fires when this panel starts or stops filling the workspace, whoever did it. Needs Tavora 0.20.20 or newer. */
    onMaximizedChange(fn: (maximized: boolean) => void): Unsubscribe;
    /**
     * What this panel's live view shows: while the player shows the panel in their game and the in-game layer is closed,
     * Tavora shows the module's overlay page (the manifest's `overlay`) read-only and click-through in the panel's spot,
     * with this state. Any JSON up to LIMITS.maxOverlayStateBytes; null shows nothing. Tavora keeps showing the last
     * state while the panel isn't running, e.g. while you look at another game in Tavora; after a restart nothing shows
     * until the panel runs again and calls setLive. Needs no click or permission. Tavora 0.21.9 and newer.
     */
    setLive(state: JsonValue | null): Promise<void>;
  };
  /** The module's other panels. */
  panels: {
    /**
     * Opens one of this module's own panel types in the current game, on `content` when given. Tavora brings
     * forward a panel of that type already showing the content, else switches the one used last
     * (`panel.onNavigate`), else opens a new one. Call it from the click or key press that asked for it: the host
     * refuses it otherwise (PERMISSION_DENIED). Needs Tavora 0.17.18 or newer.
     */
    open(type: string, options?: { content?: PanelContent }): Promise<PanelOpenResult>;
  };
  workspace: {
    getViewport(): Promise<TavoraViewport>;
    onResize(fn: (viewport: TavoraViewport) => void): Unsubscribe;
  };
  ui: {
    getTheme(): Promise<TavoraTheme>;
    onThemeChange(fn: (theme: TavoraTheme) => void): Unsubscribe;
    /** The language Tavora shows its own texts in, as a code such as "en" or "de". Show yours in it, or in English when you have no translation. */
    getLanguage(): Promise<string>;
    /** Fires when the player changes the language. */
    onLanguageChange(fn: (language: string) => void): Unsubscribe;
    /**
     * Shows a menu that Tavora draws above every panel, so it is never cut off at the panel's edge. Call it from
     * the click, right-click or key press that asked for it: the host refuses it otherwise (PERMISSION_DENIED).
     * Resolves with the chosen item's id, or null when the player closed the menu without choosing.
     */
    showMenu(request: MenuRequest): Promise<string | null>;
    /** One shared tooltip above the workspace (Tavora 0.19.3+). A pin needs a real click/key press. */
    tooltip: {
      show(request: TooltipRequest): Promise<boolean>;
      move(anchor: TooltipAnchor): Promise<void>;
      /** Ends hover only; a pin remains until close, Escape, or a lifecycle change. */
      hide(id: string): Promise<void>;
      close(id: string): Promise<void>;
      onClose(fn: (event: { id: string }) => void): Unsubscribe;
    };
  };
  /**
   * Files (pictures) this module keeps in the current game, shared by all of its panels. They live
   * in a folder Tavora manages, not in a document, so they can be large: up to 50 MB each and
   * 500 MB together. Only PNG, JPEG, GIF and WebP are accepted, judged by the file itself.
   */
  blobs: {
    /** Stores a file and returns its id. Rejects with QUOTA_EXCEEDED, or INVALID_PARAMS for another kind of file. */
    put(file: Blob): Promise<BlobInfo>;
    /** The address to show a stored file from, for example as an image source. */
    url(id: string): string;
    list(): Promise<BlobInfo[]>;
    usage(): Promise<BlobUsage>;
    /** Deletes a file; nothing happens when it does not exist. */
    delete(id: string): Promise<void>;
  };
  clipboard: {
    /**
     * Puts a picture on the system clipboard, so the player can paste it anywhere. Call it from the click or key
     * press that asked for it: the host refuses it otherwise (PERMISSION_DENIED), and one press copies one
     * picture. PNG only, a complete one, at most 20 MB and 16384 pixels on a side (INVALID_PARAMS, QUOTA_EXCEEDED).
     */
    writeImage(png: Blob): Promise<void>;
  };
  files: {
    /** Opens Tavora's native picker after a real click and remembers read-only access on this PC. */
    pickReadOnly(options: { extensions: string[] }): Promise<ReadOnlyFile | null>;
    /** Rereads only a file previously picked by this module in this game. At most 32 MiB. */
    read(id: string): Promise<Uint8Array>;
    /** Revokes a remembered file reference; never deletes the player's file. */
    forget(id: string): Promise<void>;
    /**
     * Saves JSON (up to 8 MiB) in Downloads/Tavora after a click or key press, without asking. Never replaces a file. Tavora 0.19.17+.
     * @deprecated Use {@link files.saveJson}, which shows Tavora's save dialog. Kept for modules made for older Tavora versions.
     */
    exportJson(value: JsonValue, name?: string): Promise<{ fileName: string }>;
    /**
     * Saves JSON (up to 8 MiB) as a .json file where the player says: Tavora's save dialog opens in the folder they
     * last saved a file to or opened one from for this module, at first Documents\Tavora. `name` suggests the file
     * name: Tavora makes it safe and adds " (2)" and so on when it is taken. Resolves with the name it was saved
     * under, or null when the player closed the dialog; the module never learns the folder. Replacing a file needs
     * the player's OK in the dialog.
     * Call it from the click or key press that asked for it: the host refuses it otherwise (PERMISSION_DENIED), and
     * one press saves one file.
     */
    saveJson(value: JsonValue, name?: string): Promise<{ fileName: string } | null>;
    /**
     * Opens a .json file the player picks in Tavora's open dialog, which starts in the same folder as saveJson.
     * Resolves with the file's name and its parsed content (at most 8 MiB), or null when the player closed the dialog;
     * a file that is not JSON is INVALID_PARAMS. The module never learns the folder.
     * Call it from the click or key press that asked for it (PERMISSION_DENIED otherwise); one press opens one file.
     */
    openJson(): Promise<{ fileName: string; value: JsonValue } | null>;
  };
  pictures: {
    /**
     * Saves a picture as a .png file where the player says: Tavora's save dialog opens in the folder they last saved a
     * picture to, at first Pictures\Tavora. `name` suggests the file name: Tavora makes it safe and adds " (2)" and so
     * on when it is taken. Resolves with the name it was saved under, or null when the player closed the dialog; the
     * module never learns the folder. Tavora 0.20.16 and older save in Pictures\Tavora without asking.
     * Call it from the click or key press that asked for it: the host refuses it otherwise (PERMISSION_DENIED), and
     * one press saves one picture. The same PNG limits as clipboard.writeImage apply.
     */
    save(png: Blob, name?: string): Promise<{ fileName: string } | null>;
  };
  links: {
    /**
     * Opens a web address (http or https) in a Browser panel of this game, as a new tab or in a new
     * panel. Call it from the click or key press that asked for it: the host refuses it otherwise
     * (PERMISSION_DENIED). The module learns nothing about the page.
     */
    open(url: string): Promise<void>;
  };
  network: {
    /**
     * Makes a web request through Tavora, to a host listed in `permissions.network` that the player
     * granted (PERMISSION_DENIED otherwise). HTTPS only, no cookies, at most 5 MB back and 15 seconds.
     * Error statuses such as 404 are answers, not errors; NETWORK_ERROR means no answer came.
     */
    fetch(url: string, init?: Omit<NetworkRequest, "url">): Promise<NetworkResponse>;
    /** Render a public HTTPS page in a temporary session, with the same granted domains.
     * No browser logins, module scripts or interactions. Up to 5 MB / 30 seconds.
     * Requires Tavora 0.19.3. Login and verification pages fail with NETWORK_ERROR. */
    readPage(url: string): Promise<PageResponse>;
  };
  /** Parts of Tavora that hold a sign-in, used without seeing it. Each needs its connector in `permissions.connectors` and the player's grant (PERMISSION_DENIED otherwise). */
  connectors: {
    /** `ai-usage`: the usage of the Claude and Codex accounts the player set up in Settings > Integrations > AI usage. */
    aiUsage: {
      accounts(): Promise<AiUsageAccountInfo[]>;
      /** Reads one account. Tavora reads each account at most once a minute; asking sooner gives the last reading. */
      read(accountId: string): Promise<AiUsageReading>;
      /** Fires when the player adds, renames or removes an account. */
      onAccountsChange(fn: () => void): Unsubscribe;
    };
    /**
     * `system-info`: this PC's hardware and how busy it is, read by Tavora while a panel shows it. Nothing is read
     * while no panel watches, and a hidden panel gets no snapshots. Names and numbers only, never paths or serial numbers.
     */
    systemInfo: {
      /** The processor, memory, graphics cards and drives. Read once and kept; ask again after onDrivesChange. */
      info(): Promise<SystemInfo>;
      /**
       * Sets what this panel watches, replacing what it watched before; empty `blocks` stop it. A first snapshot comes
       * at once, then one every `intervalMs` (1000, 2000, 5000, 15000 or 60000). The panel's watch ends with the page.
       */
      watch(options: { blocks: SystemWatchBlocks; intervalMs: SystemInterval }): Promise<void>;
      /** Fires with each snapshot of what the panel watches. */
      onSnapshot(fn: (snapshot: SystemSnapshot) => void): Unsubscribe;
      /** Fires when a drive is plugged in or removed; ask info() again. */
      onDrivesChange(fn: () => void): Unsubscribe;
    };
    /**
     * `discord`: the Discord app on this PC, through Tavora's Discord sign-in. The connection runs while a
     * panel has asked for state(); Tavora keeps the sign-in and sends only the commands in DISCORD_COMMANDS.
     */
    discord: {
      /** The connection now. The first call starts it for this panel. */
      state(): Promise<DiscordState>;
      onStateChange(fn: (state: DiscordState) => void): Unsubscribe;
      /** Signs in, asking for approval in Discord the first time. Call it from a click or key press handler. */
      connect(): Promise<void>;
      /** Asks Discord to approve muting and deafening, for a sign-in that can't yet (canControl false). From a click or key press. */
      allowControl(): Promise<void>;
      /** Sends one command; resolves with Discord's answer as it came, or why there is none. SELECT_VOICE_CHANNEL and SET_VOICE_SETTINGS only from a click or key press. */
      command<C extends DiscordCommand>(command: C, args: DiscordCommands[C]): Promise<DiscordResult>;
      /** Starts sending an event to this panel (VOICE_CHANNEL_SELECT without a channel, the others for one voice channel). Kept across reconnects. */
      subscribe(event: DiscordEventName, channelId?: string): Promise<void>;
      unsubscribe(event: DiscordEventName, channelId?: string): Promise<void>;
      onEvent(fn: (event: DiscordEvent) => void): Unsubscribe;
      /** A picture from cdn.discordapp.com (an avatar or server icon address) as a small PNG data address, or null. */
      image(url: string): Promise<string | null>;
    };
  };
  /**
   * Pages for streaming software such as OBS (the manifest's `overlay`), one per key: an item, a scoreboard, whatever
   * the module shows on stream. Needs `"stream-overlay"` in `permissions.connectors` and the player's grant
   * (PERMISSION_DENIED otherwise). Tavora 0.19.26 and newer.
   */
  overlay: {
    /** What the overlay for `key` shows now. Tavora keeps it, so the overlay goes on showing it while no panel runs. */
    publish(key: string, state: JsonValue): Promise<void>;
    /** The overlay for `key` shows nothing until it is published again. Its link stays the same. */
    remove(key: string): Promise<void>;
    /**
     * Puts the overlay's link on the clipboard, for the player to paste into OBS as a Browser Source. Call it from
     * the click or key press that asked for it. Resolves with `"off"` when Stream overlays are off in Tavora: Tavora
     * then opens that setting.
     */
    copyLink(key: string): Promise<OverlayLinkResult>;
    /** Gives the overlay a new link; the old one stops working. */
    resetLink(key: string): Promise<void>;
    /**
     * Shows the overlay for `key` over the player's game, in a Tavora window above it, only while that game is in
     * front. Call it from the click or key press that asked for it; it needs no permission. Resolves with `"off"` when
     * Game overlays are off in Tavora (Tavora then opens that setting) and `"full"` when the game has no room for
     * another. Tavora 0.20.51 and newer.
     */
    showOverGame(key: string): Promise<GameOverlayResult>;
    /** Takes this module's game overlay for `key` away in the panel's workspace scope. No click or permission needed; nothing happens when there is none. Tavora 0.21.3 and newer. */
    hideOverGame(key: string): Promise<void>;
    /** The keys of this module's game overlays in the panel's workspace scope. Tavora 0.21.3 and newer. */
    overGame(): Promise<string[]>;
    /**
     * Opens a small Tavora window with the overlay for `key` at its real size, on a dark, light or checkered background,
     * so the player can see what it looks like. Call it from the click or key press that asked for it; it needs no
     * permission, but the module needs an `overlay` in its manifest. It works whether or not Game overlays and Stream
     * overlays are on. Tavora 0.21.3 and newer.
     */
    preview(key: string): Promise<void>;
  };
  /**
   * Hotkeys for the manifest's `actions`. The player picks the keys in a Tavora dialog, for this game; the module
   * only hears which action fired, for which target, in its panel used last in the game shown now. Tavora 0.19.26 and newer.
   */
  hotkeys: {
    list(): Promise<HotkeyBinding[]>;
    /** Opens Tavora's dialog to set a key for `action` on `target`, named `label` there. Call it from a click or key press. */
    set(action: string, target: string, label: string): Promise<HotkeySetResult>;
    /** Removes the hotkeys for `target`: all of them, or the one for `action`. */
    remove(target: string, action?: string): Promise<void>;
    onPress(fn: (binding: HotkeyBinding) => void): Unsubscribe;
  };
  lifecycle: {
    /** The panel is hidden; pause timers and animations. Called immediately if already suspended. */
    onSuspend(fn: () => void): Unsubscribe;
    onResume(fn: () => void): Unsubscribe;
    /** Best effort only: autosave must not depend on this firing. */
    onDispose(fn: () => void): Unsubscribe;
  };
}

export interface ConnectOptions {
  /** How long to wait for the host to hand over a port. Default 5000 ms. */
  connectTimeoutMs?: number;
  /** How long to wait for each request. Default 10000 ms. */
  requestTimeoutMs?: number;
}

let connection: Promise<TavoraSDK> | undefined;

/**
 * Connects to the Tavora host. Safe to call more than once: every call
 * returns the same connection for this window. Rejects with a TavoraError
 * (HOST_UNAVAILABLE, INCOMPATIBLE) if the module cannot run here.
 */
export function connect(options: ConnectOptions = {}): Promise<TavoraSDK> {
  connection ??= openPort(options.connectTimeoutMs ?? 5000)
    .then((port) => createClient(port, options.requestTimeoutMs ?? 10_000))
    .catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
  return connection;
}

/**
 * For the manifest's `overlay` page, which runs in streaming software rather than in Tavora: calls `fn` with what the
 * module published for this overlay (overlay.publish), straight away and on every change, and with null while there is
 * nothing to show. It reconnects by itself when Tavora restarts. Returns a function that stops it.
 */
export function watchOverlay(fn: (state: JsonValue | null) => void): Unsubscribe {
  const source = new EventSource(new URL(OVERLAY_STATE_PATH, window.location.href));
  source.onmessage = (event: MessageEvent<string>) => {
    let message: { state?: JsonValue | null };
    try {
      message = JSON.parse(event.data) as { state?: JsonValue | null };
    } catch {
      return;
    }
    try {
      fn(message.state ?? null);
    } catch (error) {
      console.error("[tavora] watchOverlay listener failed", error);
    }
  };
  return () => source.close();
}

function openPort(timeoutMs: number): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new TavoraError({
          code: "HOST_UNAVAILABLE",
          message: "Tavora host did not respond. Is this module running inside Tavora?",
        }),
      );
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== PORT_MESSAGE || !event.ports[0]) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.ports[0]);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: HELLO_MESSAGE, v: PROTOCOL_VERSION }, window.location.origin);
  });
}

async function createClient(port: MessagePort, requestTimeoutMs: number): Promise<TavoraSDK> {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: TavoraError): void; timer: ReturnType<typeof setTimeout> }
  >();
  const listeners = new Map<EventName, Set<(data: unknown) => void>>();
  let suspended = false;

  port.onmessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;
    if (typeof message !== "object" || message === null || message.v !== PROTOCOL_VERSION) return;

    if ("event" in message) {
      if (message.event === "lifecycle.suspend") suspended = true;
      if (message.event === "lifecycle.resume") suspended = false;
      for (const fn of listeners.get(message.event) ?? []) {
        try {
          fn(message.data);
        } catch (error) {
          console.error(`[tavora] ${message.event} listener failed`, error);
        }
      }
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new TavoraError(message.error));
  };
  port.start();

  function call<M extends MethodName>(method: M, params?: Methods[M]["params"], timeoutMs = requestTimeoutMs): Promise<Methods[M]["result"]> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TavoraError({ code: "TIMEOUT", message: `${method} timed out` }));
      }, Math.max(timeoutMs, requestTimeoutMs));
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      port.postMessage({ v: PROTOCOL_VERSION, id, method, params });
    });
  }

  function on<E extends EventName>(event: E, fn: (data: Events[E]) => void): Unsubscribe {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    // Initial suspension can arrive before connect() callers register listeners.
    if (event === "lifecycle.suspend" && suspended) {
      try {
        listener(null);
      } catch (error) {
        console.error(`[tavora] ${event} listener failed`, error);
      }
    }
    return () => set.delete(listener);
  }

  const host = await call("bridge.handshake", { protocol: PROTOCOL_VERSION, sdkVersion: SDK_VERSION });

  // panel.onNavigate: Tavora asks, the handler saves and switches, and the answer says how it went.
  let navigate: ((content: PanelContent) => void | Promise<void>) | null = null;
  on("panel.navigate", ({ requestId, content }) => {
    const handler = navigate;
    void (async () => {
      let ok = false;
      if (handler) {
        try {
          await handler(content);
          ok = true;
        } catch (error) {
          console.error("[tavora] panel.onNavigate handler failed", error);
        }
      }
      await call("panel.navigated", { requestId, handled: handler !== null, ok }).catch(() => {});
    })();
  });

  return {
    host,
    game: {
      getCurrent: () => call("game.getCurrent"),
    },
    storage: {
      get: <T = JsonValue>(key: string) => call("storage.get", { key }) as Promise<T | null>,
      set: async (key, value) => {
        await call("storage.set", { key, value });
      },
      delete: async (key) => {
        await call("storage.delete", { key });
      },
      keys: () => call("storage.keys"),
      app: {
        get: <T = JsonValue>(key: string) => call("storage.app.get", { key }) as Promise<T | null>,
        set: async (key, value) => {
          await call("storage.app.set", { key, value });
        },
        delete: async (key) => {
          await call("storage.app.delete", { key });
        },
        keys: () => call("storage.app.keys"),
      },
    },
    documents: {
      list: () => call("documents.list"),
      get: <T = JsonValue>(id: string) =>
        call("documents.get", { id }) as Promise<(TavoraDocument & { data: T }) | null>,
      put: (document) => call("documents.put", document),
      delete: async (id, options = {}) => {
        await call("documents.delete", { id, ...options });
      },
      onChange: (fn) => on("documents.changed", fn),
    },
    panel: {
      type: host.panel?.type ?? null,
      getState: <T = JsonValue>() => call("panel.getState") as Promise<T | null>,
      setState: async (value) => {
        await call("panel.setState", { value });
      },
      getLaunch: () => call("panel.getLaunch"),
      setLive: async (state) => {
        await call("panel.setLive", { state });
      },
      setContent: async (content) => {
        await call("panel.setContent", { content });
      },
      isMaximized: () => call("panel.isMaximized"),
      setMaximized: async (maximized) => {
        await call("panel.setMaximized", { maximized });
      },
      onMaximizedChange: (fn) => on("panel.maximized", ({ maximized }) => fn(maximized)),
      onNavigate: (fn) => {
        navigate = fn;
        return () => {
          if (navigate === fn) navigate = null;
        };
      },
    },
    panels: {
      // Tavora may wait for another panel to save first.
      open: (type, options = {}) =>
        call("panels.open", { type, ...(options.content ? { content: options.content } : {}) }, LIMITS.navigateTimeoutMs + 5_000),
    },
    workspace: {
      getViewport: () => call("workspace.getViewport"),
      onResize: (fn) => on("workspace.resize", fn),
    },
    ui: {
      getTheme: () => call("ui.getTheme"),
      onThemeChange: (fn) => on("ui.theme", fn),
      getLanguage: () => call("ui.getLanguage"),
      onLanguageChange: (fn) => on("ui.language", fn),
      // The player may take their time choosing.
      showMenu: (request) => call("ui.showMenu", request, MENU_TIMEOUT_MS),
      tooltip: {
        show: request => call("ui.tooltip.show",request),
        move: async anchor => { await call("ui.tooltip.move",anchor); },
        hide: async id => { await call("ui.tooltip.hide",{id}); },
        close: async id => { await call("ui.tooltip.close",{id}); },
        onClose: fn => on("ui.tooltipClosed",fn),
      },
    },
    blobs: {
      put: async (file) => {
        let response: Response;
        try {
          response = await fetch(new URL(BLOB_PATH, window.location.href), {
            method: "POST",
            body: file,
            headers: { "Content-Type": file.type || "application/octet-stream" },
          });
        } catch {
          throw new TavoraError({ code: "INTERNAL", message: "could not store the file" });
        }
        const body = (await response.json().catch(() => null)) as (BlobInfo & { error?: ErrorPayload }) | null;
        if (!response.ok || !body || body.error) {
          throw new TavoraError(body?.error ?? { code: "INTERNAL", message: `could not store the file (${response.status})` });
        }
        return body;
      },
      url: (id) => new URL(`${BLOB_PATH}${encodeURIComponent(id)}`, window.location.href).href,
      list: () => call("blobs.list"),
      usage: () => call("blobs.usage"),
      delete: async (id) => {
        await call("blobs.delete", { id });
      },
    },
    clipboard: {
      writeImage: async (png) => {
        if (png.type !== "image/png") throw new TavoraError({ code: "INVALID_PARAMS", message: "only a PNG picture can be copied" });
        let response: Response;
        try {
          response = await fetch(new URL(CLIPBOARD_PATH, window.location.href), { method: "POST", body: png, headers: { "Content-Type": "image/png" } });
        } catch {
          throw new TavoraError({ code: "INTERNAL", message: "could not copy the picture" });
        }
        if (response.ok) return;
        const body = (await response.json().catch(() => null)) as { error?: ErrorPayload } | null;
        throw new TavoraError(body?.error ?? { code: "INTERNAL", message: `could not copy the picture (${response.status})` });
      },
    },
    files: {
      pickReadOnly: options => call('files.pickReadOnly',options,MENU_TIMEOUT_MS),
      forget: async id => { await call('files.forget',{id}); },
      read: async id => {
        if (!/^[a-f0-9]{32}$/.test(id)) throw new TavoraError({code:'INVALID_PARAMS',message:'Invalid file reference.'});
        const response = await fetch(new URL(READ_ONLY_FILE_PATH+id,window.location.href),{method:'POST'});
        if (!response.ok) { const body = await response.json() as {error:ErrorPayload}; throw new TavoraError(body.error); }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if(bytes.byteLength>32*1024*1024) throw new TavoraError({code:'QUOTA_EXCEEDED',message:'File is too large.'});
        return bytes;
      },
      exportJson: async (value, name = 'Build') => {
        const address = new URL(JSON_EXPORT_PATH, window.location.href);
        address.searchParams.set('name', name);
        const body = JSON.stringify(value);
        if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) throw new TavoraError({code:'QUOTA_EXCEEDED',message:'JSON exports may be at most 8 MiB'});
        let response: Response;
        try { response = await fetch(address, {method:'POST',headers:{'Content-Type':'application/json'},body}); }
        catch { throw new TavoraError({code:'INTERNAL',message:'could not export the JSON file'}); }
        const result = await response.json().catch(() => null) as {fileName?:string;error?:ErrorPayload}|null;
        if(response.ok && typeof result?.fileName === 'string') return {fileName:result.fileName};
        throw new TavoraError(result?.error ?? {code:'INTERNAL',message:'could not export the JSON file'});
      },
      saveJson: async (value, name = '') => {
        const address = new URL(JSON_SAVE_PATH, window.location.href);
        if (name) address.searchParams.set('name', name);
        const body = JSON.stringify(value);
        if (body === undefined) throw new TavoraError({code:'INVALID_PARAMS',message:'only JSON can be saved'});
        if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) throw new TavoraError({code:'QUOTA_EXCEEDED',message:'JSON files may be at most 8 MiB'});
        let response: Response;
        try { response = await fetch(address, {method:'POST',headers:{'Content-Type':'application/json'},body}); }
        catch { throw new TavoraError({code:'INTERNAL',message:'could not save the file'}); }
        const result = await response.json().catch(() => null) as {fileName?:string|null;error?:ErrorPayload}|null;
        if(response.ok && result?.fileName === null) return null;
        if(response.ok && typeof result?.fileName === 'string') return {fileName:result.fileName};
        throw new TavoraError(result?.error ?? {code:'INTERNAL',message:`could not save the file (${response.status})`});
      },
      openJson: async () => {
        let response: Response;
        try { response = await fetch(new URL(JSON_OPEN_PATH, window.location.href), {method:'POST'}); }
        catch { throw new TavoraError({code:'INTERNAL',message:'could not open the file'}); }
        const result = await response.json().catch(() => null) as {fileName?:string;value?:JsonValue;error?:ErrorPayload}|null;
        if(response.ok && result === null) return null;
        if(response.ok && typeof result?.fileName === 'string' && result.value !== undefined) return {fileName:result.fileName,value:result.value};
        throw new TavoraError(result?.error ?? {code:'INTERNAL',message:`could not open the file (${response.status})`});
      },
    },
    pictures: {
      save: async (png, name = "") => {
        if (png.type !== "image/png") throw new TavoraError({ code: "INVALID_PARAMS", message: "only a PNG picture can be saved" });
        const address = new URL(PICTURES_PATH, window.location.href);
        if (name) address.searchParams.set("name", name);
        let response: Response;
        try {
          response = await fetch(address, { method: "POST", body: png, headers: { "Content-Type": "image/png" } });
        } catch {
          throw new TavoraError({ code: "INTERNAL", message: "could not save the picture" });
        }
        const body = (await response.json().catch(() => null)) as { fileName?: string; error?: ErrorPayload } | null;
        if (response.ok && body?.fileName === null) return null;
        if (response.ok && typeof body?.fileName === "string") return { fileName: body.fileName };
        throw new TavoraError(body?.error ?? { code: "INTERNAL", message: `could not save the picture (${response.status})` });
      },
    },
    links: {
      open: async (url) => {
        await call("links.open", { url });
      },
    },
    network: {
      // The host gives up after its own limit; this waits a little longer so its answer arrives first.
      fetch: (url, init = {}) => call("network.fetch", { ...init, url }, LIMITS.networkTimeoutMs + 5000),
      readPage: (url) => call("network.readPage", { url }, LIMITS.pageTimeoutMs + 5000),
    },
    connectors: {
      aiUsage: {
        accounts: () => call("aiUsage.accounts"),
        read: (accountId) => call("aiUsage.read", { accountId }, LIMITS.aiUsageTimeoutMs + 5000),
        onAccountsChange: (fn) => on("aiUsage.accountsChanged", () => fn()),
      },
      systemInfo: {
        info: () => call("systemInfo.info"),
        watch: async (options) => {
          await call("systemInfo.watch", options);
        },
        onSnapshot: (fn) => on("systemInfo.snapshot", fn),
        onDrivesChange: (fn) => on("systemInfo.drivesChanged", () => fn()),
      },
      discord: {
        state: () => call("discord.state"),
        onStateChange: (fn) => on("discord.state", fn),
        connect: async () => {
          await call("discord.connect");
        },
        allowControl: async () => {
          await call("discord.allowControl");
        },
        command: (command, args) => call("discord.command", { command, args }, LIMITS.discordTimeoutMs + 5000),
        subscribe: async (event, channelId) => {
          await call("discord.subscribe", channelId === undefined ? { event } : { event, channelId });
        },
        unsubscribe: async (event, channelId) => {
          await call("discord.unsubscribe", channelId === undefined ? { event } : { event, channelId });
        },
        onEvent: (fn) => on("discord.event", fn),
        image: (url) => call("discord.image", { url }),
      },
    },
    overlay: {
      publish: async (key, state) => {
        await call("overlay.publish", { key, state });
      },
      remove: async (key) => {
        await call("overlay.remove", { key });
      },
      copyLink: (key) => call("overlay.copyLink", { key }),
      showOverGame: (key) => call("overlay.showOverGame", { key }),
      hideOverGame: async (key) => {
        await call("overlay.hideOverGame", { key });
      },
      overGame: () => call("overlay.overGame", undefined),
      preview: async (key) => {
        await call("overlay.preview", { key });
      },
      resetLink: async (key) => {
        await call("overlay.resetLink", { key });
      },
    },
    hotkeys: {
      list: () => call("hotkeys.list"),
      // The player may take their time pressing a key.
      set: (action, target, label) => call("hotkeys.set", { action, target, label }, MENU_TIMEOUT_MS),
      remove: async (target, action) => {
        await call("hotkeys.remove", action === undefined ? { target } : { target, action });
      },
      onPress: (fn) => on("hotkeys.pressed", fn),
    },
    lifecycle: {
      onSuspend: (fn) => on("lifecycle.suspend", fn),
      onResume: (fn) => on("lifecycle.resume", fn),
      onDispose: (fn) => on("lifecycle.dispose", fn),
    },
  };
}
