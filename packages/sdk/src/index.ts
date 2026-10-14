// @tavora/sdk: thin typed client for modules running inside Tavora Desktop.
// The host enforces every check; this package only marshals typed calls.
// Protocol reference: docs/sdk/protocol.md.

import {
  HELLO_MESSAGE,
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type Capability,
  type DocumentChange,
  type DocumentSummary,
  type ErrorCode,
  type ErrorPayload,
  type EventName,
  type Events,
  type HandshakeResult,
  type HostMessage,
  type JsonValue,
  type MethodName,
  type Methods,
  type PutDocumentParams,
  type TavoraDocument,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
} from "./protocol.js";

export type {
  Capability,
  DocumentChange,
  DocumentSummary,
  ErrorCode,
  HandshakeResult,
  JsonValue,
  PutDocumentParams,
  TavoraDocument,
  TavoraGame,
  TavoraTheme,
  TavoraViewport,
  ThemeToken,
} from "./protocol.js";
export { LIMITS, PROTOCOL_VERSION, THEME_TOKENS } from "./protocol.js";

/** Version of this SDK package, sent to the host during the handshake. */
export const SDK_VERSION = "0.1.0";

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

export interface TavoraSDK {
  /** What the host reported when this module connected. */
  readonly host: HandshakeResult;
  game: {
    getCurrent(): Promise<TavoraGame>;
  };
  /** Small key/value settings, private to this module in the current game. */
  storage: {
    /** T is not checked at runtime; the host only guarantees the value is JSON. */
    get<T = JsonValue>(key: string): Promise<T | null>;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
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
    getState<T = JsonValue>(): Promise<T | null>;
    setState(value: JsonValue | null): Promise<void>;
  };
  workspace: {
    getViewport(): Promise<TavoraViewport>;
    onResize(fn: (viewport: TavoraViewport) => void): Unsubscribe;
  };
  ui: {
    getTheme(): Promise<TavoraTheme>;
    onThemeChange(fn: (theme: TavoraTheme) => void): Unsubscribe;
  };
  lifecycle: {
    /** The panel is hidden; pause timers and animations. */
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

  port.onmessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;
    if (typeof message !== "object" || message === null || message.v !== PROTOCOL_VERSION) return;

    if ("event" in message) {
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

  function call<M extends MethodName>(method: M, params?: Methods[M]["params"]): Promise<Methods[M]["result"]> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TavoraError({ code: "TIMEOUT", message: `${method} timed out` }));
      }, requestTimeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      port.postMessage({ v: PROTOCOL_VERSION, id, method, params });
    });
  }

  function on<E extends EventName>(event: E, fn: (data: Events[E]) => void): Unsubscribe {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    return () => set.delete(listener);
  }

  const host = await call("bridge.handshake", { protocol: PROTOCOL_VERSION, sdkVersion: SDK_VERSION });

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
      getState: <T = JsonValue>() => call("panel.getState") as Promise<T | null>,
      setState: async (value) => {
        await call("panel.setState", { value });
      },
    },
    workspace: {
      getViewport: () => call("workspace.getViewport"),
      onResize: (fn) => on("workspace.resize", fn),
    },
    ui: {
      getTheme: () => call("ui.getTheme"),
      onThemeChange: (fn) => on("ui.theme", fn),
    },
    lifecycle: {
      onSuspend: (fn) => on("lifecycle.suspend", fn),
      onResume: (fn) => on("lifecycle.resume", fn),
      onDispose: (fn) => on("lifecycle.dispose", fn),
    },
  };
}
