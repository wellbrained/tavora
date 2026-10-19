// @tavora/sdk: thin typed client for modules running inside Tavora Desktop.
// The host enforces every check; this package only marshals typed calls.
import type { TooltipAnchor, TooltipRequest } from "./tooltip-types.js";
export type { TooltipAnchor, TooltipRequest, TooltipContent } from "./tooltip-types.js";
// Protocol reference: apps/docs/reference/protocol.md.

import {
  BLOB_PATH,
  CLIPBOARD_PATH,
  PICTURES_PATH,
  HELLO_MESSAGE,
  LIMITS,
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type AiUsageAccountInfo,
  type AiUsageReading,
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
  type JsonValue,
  type MenuRequest,
  type MethodName,
  type Methods,
  type NetworkRequest,
  type NetworkResponse,
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
  AiUsageAccountInfo,
  AiUsageReading,
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
export { BLOB_ID, BLOB_TYPES, DISCORD_COMMANDS, DISCORD_EVENTS, LIMITS, PROTOCOL_VERSION, THEME_TOKENS } from "./protocol.js";

/** How long a menu may stay open; the host closes it itself when its panel goes. */
const MENU_TIMEOUT_MS = 60 * 60_000;

/** Version of this SDK package, sent to the host during the handshake. */
export const SDK_VERSION = "0.2.8";

/**
 * The oldest Tavora that has everything this SDK version offers. Put it in your manifest as
 * `minTavora`, so an older Tavora says it needs an update instead of loading a module it cannot run
 * (the starter, `npm create @tavora/module`, does). The changelog names it for every version.
 */
export const MIN_TAVORA = "0.18.18";

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
    /** One shared tooltip above the workspace (Tavora 0.18.18+). A pin needs a real click/key press. */
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
  pictures: {
    /**
     * Saves a picture as a .png file in Tavora's folder in the player's Pictures (Pictures\Tavora), right away,
     * without a dialog. `name` suggests the file name: Tavora makes it safe and adds " (2)" and so on rather than
     * replace a file. Resolves with the name it was saved under; the module never learns where the folder is.
     * Call it from the click or key press that asked for it: the host refuses it otherwise (PERMISSION_DENIED), and
     * one press saves one picture. The same PNG limits as clipboard.writeImage apply.
     */
    save(png: Blob, name?: string): Promise<{ fileName: string }>;
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
      setContent: async (content) => {
        await call("panel.setContent", { content });
      },
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
    },
    connectors: {
      aiUsage: {
        accounts: () => call("aiUsage.accounts"),
        read: (accountId) => call("aiUsage.read", { accountId }, LIMITS.aiUsageTimeoutMs + 5000),
        onAccountsChange: (fn) => on("aiUsage.accountsChanged", () => fn()),
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
    lifecycle: {
      onSuspend: (fn) => on("lifecycle.suspend", fn),
      onResume: (fn) => on("lifecycle.resume", fn),
      onDispose: (fn) => on("lifecycle.dispose", fn),
    },
  };
}
